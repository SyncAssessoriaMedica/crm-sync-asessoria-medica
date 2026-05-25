import { NextResponse, type NextRequest } from "next/server";
import dns from "dns";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { canAccessInbox } from "@/lib/permissions";

// ─── Internal-IP detection ────────────────────────────────────────────────────

function isInternalIp(ip: string): boolean {
  // IPv6 loopback / IPv4-mapped loopback
  if (ip === "::1" || ip.startsWith("::ffff:127.")) return true;
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 127) return true;                          // loopback
  if (a === 10) return true;                           // RFC 1918 class A
  if (a === 172 && b >= 16 && b <= 31) return true;   // RFC 1918 class B
  if (a === 192 && b === 168) return true;             // RFC 1918 class C
  if (a === 169 && b === 254) return true;             // link-local / metadata
  return false;
}

// ─── SSRF guard with allowlist ─────────────────────────────────────────────────

// Trusted domain suffixes. Subdomains are implicitly allowed.
// e.g. "mmg.whatsapp.net" passes because it ends with ".whatsapp.net".
// Trick hostnames like "whatsapp.net.evil.com" are blocked because
// they don't end with *exactly* ".whatsapp.net".
const TRUSTED_SUFFIXES = ["whatsapp.net", "fbcdn.net"];

function getEvolutionHostname(): string | null {
  const raw = process.env.EVOLUTION_API_URL;
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAllowlistedDomain(hostname: string): boolean {
  const evolutionHost = getEvolutionHostname();
  const candidates = evolutionHost
    ? [...TRUSTED_SUFFIXES, evolutionHost]
    : TRUSTED_SUFFIXES;
  return candidates.some(
    (trusted) => hostname === trusted || hostname.endsWith(`.${trusted}`)
  );
}

// Resolves all IP addresses for a hostname and returns true only if every
// resolved address is a public (non-internal) IP. Returns false on DNS failure.
async function resolveAndValidatePublicIps(hostname: string): Promise<boolean> {
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    return !addresses.some(({ address }) => isInternalIp(address));
  } catch {
    return false;
  }
}

async function guardSsrf(rawUrl: string): Promise<{ ok: boolean }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false };
  }

  if (url.protocol !== "https:") return { ok: false };

  const hostname = url.hostname.toLowerCase();

  // Block known-bad hostnames before any network work
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return { ok: false };
  }

  // Allowlist is mandatory — any hostname not on it is rejected outright.
  // No fallback to arbitrary public HTTPS domains.
  if (!isAllowlistedDomain(hostname)) return { ok: false };

  // Even for allowlisted domains: resolve ALL IPs and block if any is internal.
  // Prevents a trusted hostname from being CNAME'd to a private address.
  const allPublic = await resolveAndValidatePublicIps(hostname);
  return { ok: allPublic };
}

// ─── Content-Disposition builder ───────────────────────────────────────────────

function buildContentDisposition(type: "inline" | "attachment", rawFilename: string): string {
  // Strip characters that break header syntax
  const safe = rawFilename
    .replace(/["\\\r\n\x00-\x1f\x7f]/g, "")
    .trim() || "file";

  // ASCII-only fallback (non-ASCII → underscore)
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");

  if (ascii === safe) {
    // Pure ASCII: compact form, widely compatible
    return `${type}; filename="${ascii}"`;
  }
  // Contains non-ASCII: ASCII fallback + RFC 5987 UTF-8 form
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

// ─── Route handler ─────────────────────────────────────────────────────────────

// Global-scope roles that can access any org's media without an org membership row.
const SYNC_ROLES = new Set(["super_admin", "gestor_sync"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;

  // 1. Validate session
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // 2. Load message
  const { data: message } = await admin
    .from("messages")
    .select("id, conversation_id, media_url, media_mimetype, media_filename, message_type")
    .eq("id", messageId)
    .single();

  if (!message?.media_url) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 3. Load conversation to get the owning org
  const { data: conversation } = await admin
    .from("conversations")
    .select("organization_id")
    .eq("id", message.conversation_id)
    .single();

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 4. Role-based authorization
  //    - super_admin / gestor_sync: global role, may access any org's media.
  //    - admin_clinica / atendente:  per-org role, must be a member of this org.
  //    - leitura and unlisted roles: denied (Inbox access not granted).
  const [profileResult, membershipResult] = await Promise.all([
    admin.from("profiles").select("role").eq("id", user.id).single(),
    admin
      .from("organization_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", conversation.organization_id)
      .single(),
  ]);

  const profileRole = profileResult.data?.role ?? null;
  const membershipRole = membershipResult.data?.role ?? null;

  const isSyncStaff = profileRole !== null && SYNC_ROLES.has(profileRole);
  // Sync staff use their global profile role; org members use their per-org role
  const effectiveRole = isSyncStaff ? profileRole : membershipRole;

  if (!effectiveRole || !canAccessInbox(effectiveRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 5. Supabase Storage path — no SSRF guard needed, served via admin client
  if (message.media_url.startsWith("supabase://media/")) {
    const storagePath = message.media_url.slice("supabase://media/".length);

    const { data: fileData, error: storageErr } = await admin.storage
      .from("media")
      .download(storagePath);

    if (storageErr || !fileData) {
      console.error("[proxy] storage download failed:", storageErr?.message ?? "no data", "msgId:", messageId);
      return NextResponse.json({ error: "Media unavailable" }, { status: 502 });
    }

    const contentType  = message.media_mimetype ?? "audio/ogg; codecs=opus";
    const rawFilename  = message.media_filename ?? `audio.${storagePath.split(".").pop() ?? "ogg"}`;
    const disposition  = buildContentDisposition("inline", rawFilename);

    return new NextResponse(fileData, {
      status: 200,
      headers: new Headers({
        "Content-Type": contentType,
        "Content-Length": String(fileData.size),
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": disposition,
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "none",
      }),
    });
  }

  // 5b. SSRF guard for external URLs
  const ssrf = await guardSsrf(message.media_url);
  if (!ssrf.ok) {
    return NextResponse.json({ error: "Invalid media URL" }, { status: 422 });
  }

  // 6. Fetch from Evolution, forwarding Range header for streaming audio/video
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 503 });
  }

  const fetchHeaders: Record<string, string> = { apikey: apiKey };
  const rangeHeader = request.headers.get("range");
  if (rangeHeader) fetchHeaders["Range"] = rangeHeader;

  let upstream: Response;
  try {
    upstream = await fetch(message.media_url, { headers: fetchHeaders });
  } catch (err) {
    const urlHost = (() => { try { return new URL(message.media_url).hostname; } catch { return "unknown"; } })();
    console.error("[proxy] fetch error:", err instanceof Error ? err.message : String(err), "host:", urlHost, "msgId:", messageId);
    return NextResponse.json({ error: "Media unavailable" }, { status: 502 });
  }

  if (!upstream.ok) {
    const urlHost = (() => { try { return new URL(message.media_url).hostname; } catch { return "unknown"; } })();
    console.error("[proxy] upstream HTTP", upstream.status, "host:", urlHost, "msgId:", messageId, "type:", message.message_type);
    return NextResponse.json({ error: "Media unavailable" }, { status: 502 });
  }

  // 7. Build safe response — stream body, never buffer
  const contentType =
    message.media_mimetype ??
    upstream.headers.get("content-type") ??
    "application/octet-stream";
  const filename = message.media_filename ?? "file";
  const isDocument = message.message_type === "document";
  const disposition = buildContentDisposition(isDocument ? "attachment" : "inline", filename);

  const responseStatus = upstream.status === 206 ? 206 : 200;

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": disposition,
    "X-Content-Type-Options": "nosniff",
  });

  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);

  // Forward Range-related headers from upstream so the browser can seek
  if (upstream.status === 206) {
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) headers.set("Content-Range", contentRange);
  }
  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);

  return new NextResponse(upstream.body, { status: responseStatus, headers });
}
