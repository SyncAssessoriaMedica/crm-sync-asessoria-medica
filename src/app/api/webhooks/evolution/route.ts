import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { sanitizePayload } from "@/lib/sanitize";
import { createOrUpdateLeadByPhone } from "@/lib/lead-upsert";

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Return the effective webhook secret.
 *
 * EVOLUTION_WEBHOOK_SECRET — dedicated secret for incoming webhooks.
 *
 * In production this must be configured. Local development may temporarily
 * fall back to EVOLUTION_API_KEY so older local setups keep working, but
 * production never exposes the server-to-server Evolution key as a webhook
 * URL token.
 */
function getWebhookSecret(): string | null {
  if (process.env.EVOLUTION_WEBHOOK_SECRET) return process.env.EVOLUTION_WEBHOOK_SECRET;
  if (process.env.NODE_ENV !== "production") return process.env.EVOLUTION_API_KEY ?? null;
  return null;
}

function verifyEvolutionSignature(request: NextRequest): boolean {
  const secret = getWebhookSecret();
  // Fail closed: no secret configured → reject every request.
  if (!secret) return false;

  // Primary: Evolution sends the API key in the "apikey" header.
  if (request.headers.get("apikey") === secret) return true;

  // Fallback: webhook URL contains ?token=<secret> (used when Evolution
  // doesn't support custom headers on delivery).
  const url = new URL(request.url);
  return url.searchParams.get("token") === secret;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const EvolutionWebhookSchema = z.object({
  event: z.string(),
  instance: z.string().optional(),
  instanceName: z.string().optional(),
  data: z
    .object({
      key: z
        .object({
          remoteJid: z.string().optional(),
          fromMe: z.boolean().optional(),
          id: z.string().optional(),
        })
        .optional(),
      message: z.record(z.unknown()).optional(),
      messageType: z.string().optional(),
      pushName: z.string().optional(),
      timestamp: z.union([z.number(), z.string()]).optional(),
      messageTimestamp: z.union([z.number(), z.string()]).optional(),
      status: z.string().optional(),
      state: z.string().optional(),
      qrcode: z.string().optional(),
      base64: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

type EvolutionPayload = z.infer<typeof EvolutionWebhookSchema>;
type NormalizedPayload = Omit<EvolutionPayload, "instance"> & { instance: string };
type SupabaseAdmin = ReturnType<typeof createAdminClient>;

const MESSAGE_EVENTS = new Set(["messages.upsert", "MESSAGES_UPSERT", "SEND_MESSAGE", "send.message"]);
const CONNECTION_EVENTS = new Set(["connection.update", "CONNECTION_UPDATE"]);
const QRCODE_EVENTS = new Set(["qrcode.updated", "QRCODE_UPDATED"]);
const ALLOWED_MESSAGE_TYPES = new Set(["text", "image", "audio", "video", "document", "sticker", "location"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isGroupMessage(remoteJid: string) {
  return remoteJid.includes("@g.us");
}

function normalizePhone(value: string) {
  return value.split("@")[0].replace(/\D/g, "");
}

function getTimestamp(value: EvolutionPayload["data"]) {
  const raw = (value as Record<string, unknown> | undefined)?.messageTimestamp ?? value?.timestamp;
  if (!raw) return new Date().toISOString();
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return new Date().toISOString();
  return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000).toISOString();
}

function textFromUnknown(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function nestedText(source: Record<string, unknown> | undefined, keys: string[]) {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

// ─── Log helper ───────────────────────────────────────────────────────────────

async function logWebhook(
  admin: SupabaseAdmin,
  organizationId: string | null,
  eventType: string,
  payload: unknown,
  processed: boolean,
  error?: string
) {
  // Sanitize before storing: remove secrets, truncate QR base64 blobs, etc.
  const safePayload = sanitizePayload(payload);
  await admin.from("webhook_events").insert({
    organization_id: organizationId,
    source: "evolution",
    event_type: eventType,
    payload: safePayload,
    processed,
    error: error ?? null,
  });
}

// ─── Message content extraction ───────────────────────────────────────────────

function getMessageContent(data: NonNullable<EvolutionPayload["data"]>) {
  const message = (data.message ?? {}) as Record<string, unknown>;
  const messageType = data.messageType ?? "text";

  if (typeof message.conversation === "string") {
    return { type: "text", content: message.conversation };
  }

  const extendedText = message.extendedTextMessage as Record<string, unknown> | undefined;
  if (extendedText) {
    return { type: "text", content: nestedText(extendedText, ["text", "caption"]) };
  }

  const image = message.imageMessage as Record<string, unknown> | undefined;
  if (image) {
    return {
      type: "image",
      content: nestedText(image, ["caption"]),
      mediaUrl: nestedText(image, ["url", "mediaUrl"]),
      mediaMimetype: nestedText(image, ["mimetype"]),
    };
  }

  const audio = message.audioMessage as Record<string, unknown> | undefined;
  if (audio) {
    return {
      type: "audio",
      mediaUrl: nestedText(audio, ["url", "mediaUrl"]),
      mediaMimetype: nestedText(audio, ["mimetype"]),
      mediaDuration: Number(audio.seconds ?? audio.duration) || null,
    };
  }

  const video = message.videoMessage as Record<string, unknown> | undefined;
  if (video) {
    return {
      type: "video",
      content: nestedText(video, ["caption"]),
      mediaUrl: nestedText(video, ["url", "mediaUrl"]),
      mediaMimetype: nestedText(video, ["mimetype"]),
      mediaDuration: Number(video.seconds ?? video.duration) || null,
    };
  }

  const document = message.documentMessage as Record<string, unknown> | undefined;
  if (document) {
    return {
      type: "document",
      content: nestedText(document, ["caption", "title"]),
      mediaUrl: nestedText(document, ["url", "mediaUrl"]),
      mediaMimetype: nestedText(document, ["mimetype"]),
      mediaFilename: nestedText(document, ["fileName", "filename", "title"]),
    };
  }

  const sticker = message.stickerMessage as Record<string, unknown> | undefined;
  if (sticker) {
    return {
      type: "sticker",
      mediaUrl: nestedText(sticker, ["url", "mediaUrl"]),
      mediaMimetype: nestedText(sticker, ["mimetype"]),
    };
  }

  const location = message.locationMessage as Record<string, unknown> | undefined;
  if (location) {
    const latitude = textFromUnknown(location.degreesLatitude ?? location.latitude);
    const longitude = textFromUnknown(location.degreesLongitude ?? location.longitude);
    return {
      type: "location",
      content: [nestedText(location, ["name", "address"]), latitude && longitude ? `${latitude}, ${longitude}` : null]
        .filter(Boolean)
        .join("\n"),
    };
  }

  const normalizedType = messageType.toLowerCase().replace("message", "");
  return {
    type: ALLOWED_MESSAGE_TYPES.has(normalizedType) ? normalizedType : "text",
    content: nestedText(message, ["text", "caption"]) ?? `[${messageType}]`,
  };
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function resolveWhatsAppInstance(admin: SupabaseAdmin, instanceName: string) {
  const { data, error } = await admin
    .from("whatsapp_instances")
    .select("id, organization_id, instance_name, phone_number, status")
    .eq("instance_name", instanceName)
    .maybeSingle();

  if (error) throw error;
  return data as { id: string; organization_id: string; instance_name: string; phone_number: string | null; status: string } | null;
}

async function resolveWhatsappSource(admin: SupabaseAdmin, organizationId: string) {
  const { data: existing } = await admin
    .from("lead_sources")
    .select("id")
    .eq("organization_id", organizationId)
    .ilike("name", "WhatsApp")
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data } = await admin
    .from("lead_sources")
    .insert({ organization_id: organizationId, name: "WhatsApp", color: "#22c55e" })
    .select("id")
    .single();

  return data?.id as string | undefined;
}

async function resolveLead(admin: SupabaseAdmin, organizationId: string, phone: string, name: string | undefined, inbound: boolean) {
  const sourceId = await resolveWhatsappSource(admin, organizationId);
  return createOrUpdateLeadByPhone(
    admin,
    {
      organizationId,
      phone,
      name,
      sourceId: sourceId ?? null,
      status: "new",
      lastInteractionAt: new Date().toISOString(),
    },
    {
      createIfMissing: inbound,
      nameMode: "fill_if_blank_or_phone",
    }
  );
}

async function resolveConversation(
  admin: SupabaseAdmin,
  organizationId: string,
  instanceId: string,
  remoteJid: string,
  leadId: string | null
) {
  const { data: existing, error } = await admin
    .from("conversations")
    .select("id, unread_count")
    .eq("instance_id", instanceId)
    .eq("remote_jid", remoteJid)
    .maybeSingle();

  if (error) throw error;
  if (existing?.id) {
    if (leadId) await admin.from("conversations").update({ lead_id: leadId }).eq("id", existing.id);
    return existing as { id: string; unread_count: number };
  }

  const { data, error: insertError } = await admin
    .from("conversations")
    .insert({
      organization_id: organizationId,
      instance_id: instanceId,
      lead_id: leadId,
      remote_jid: remoteJid,
      unread_count: 0,
      status: "open",
    })
    .select("id, unread_count")
    .single();

  if (insertError) throw insertError;
  return data as { id: string; unread_count: number };
}

async function handleConnectionEvent(admin: SupabaseAdmin, payload: NormalizedPayload) {
  const instance = await resolveWhatsAppInstance(admin, payload.instance);
  const rawStatus = payload.data?.state ?? payload.data?.status ?? "";
  const normalized = rawStatus.toLowerCase();
  const status = normalized.includes("open") || normalized.includes("connect")
    ? "connected"
    : normalized.includes("connecting") || normalized.includes("qr")
      ? "connecting"
      : "disconnected";

  if (!instance) {
    await logWebhook(admin, null, payload.event, payload, false, `Instancia desconhecida: ${payload.instance}`);
    return NextResponse.json({ received: true, processed: false, reason: "Unknown instance" });
  }

  await admin.from("whatsapp_instances").update({ status }).eq("id", instance.id);
  await logWebhook(admin, instance.organization_id, payload.event, payload, true);
  return NextResponse.json({ success: true, processed: true, status });
}

async function handleQrCodeEvent(admin: SupabaseAdmin, payload: NormalizedPayload) {
  const instance = await resolveWhatsAppInstance(admin, payload.instance);
  // Strip QR base64 before logging (sanitizePayload in logWebhook handles this)
  await logWebhook(
    admin,
    instance?.organization_id ?? null,
    payload.event,
    payload,
    Boolean(instance),
    instance ? undefined : `Instancia desconhecida: ${payload.instance}`
  );
  if (instance) await admin.from("whatsapp_instances").update({ status: "connecting" }).eq("id", instance.id);
  return NextResponse.json({ success: true, processed: Boolean(instance), event: payload.event });
}

async function handleMessageEvent(admin: SupabaseAdmin, payload: NormalizedPayload) {
  const data = payload.data;
  const remoteJid = data?.key?.remoteJid;
  const evolutionMessageId = data?.key?.id;
  if (!data || !remoteJid || !evolutionMessageId) {
    await logWebhook(admin, null, payload.event, payload, false, "Payload de mensagem incompleto.");
    return NextResponse.json({ received: true, processed: false, reason: "Incomplete message payload" });
  }

  if (isGroupMessage(remoteJid)) {
    await logWebhook(admin, null, payload.event, { event: payload.event, instance: payload.instance }, false, "Mensagem de grupo ignorada.");
    return NextResponse.json({ received: true, processed: false, reason: "Group ignored" });
  }

  const instance = await resolveWhatsAppInstance(admin, payload.instance);
  if (!instance) {
    await logWebhook(admin, null, payload.event, payload, false, `Instancia desconhecida: ${payload.instance}`);
    return NextResponse.json({ received: true, processed: false, reason: "Unknown instance" }, { status: 202 });
  }

  const inbound = data.key?.fromMe !== true;
  const phone = normalizePhone(remoteJid);
  const lead = await resolveLead(admin, instance.organization_id, phone, data.pushName, inbound);
  const conversation = await resolveConversation(admin, instance.organization_id, instance.id, remoteJid, lead.id);
  const messageContent = getMessageContent(data);

  const messagePayload = {
    conversation_id: conversation.id,
    evolution_msg_id: evolutionMessageId,
    direction: inbound ? "inbound" : "outbound",
    message_type: messageContent.type,
    content: messageContent.content ?? null,
    media_url: messageContent.mediaUrl ?? null,
    media_mimetype: messageContent.mediaMimetype ?? null,
    media_filename: messageContent.mediaFilename ?? null,
    media_duration: messageContent.mediaDuration ?? null,
    created_at: getTimestamp(data),
  };

  const { data: insertedMessage, error: messageError } = await admin
    .from("messages")
    .upsert(messagePayload, { onConflict: "evolution_msg_id", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();

  if (messageError) throw messageError;

  if (insertedMessage?.id) {
    await admin
      .from("conversations")
      .update({
        unread_count: inbound ? conversation.unread_count + 1 : conversation.unread_count,
        status: "open",
      })
      .eq("id", conversation.id);

    if (lead.id) {
      await admin.from("lead_events").insert({
        lead_id: lead.id,
        event_type: inbound ? "whatsapp_inbound" : "whatsapp_outbound",
        description: inbound ? "Mensagem recebida pelo WhatsApp." : "Mensagem enviada pelo WhatsApp.",
        metadata: {
          instance: payload.instance,
          remote_jid: remoteJid,
          message_type: messageContent.type,
          evolution_msg_id: evolutionMessageId,
          // Never log media_url or actual message content here
        },
      });
    }
  }

  await logWebhook(
    admin,
    instance.organization_id,
    payload.event,
    { event: payload.event, instance: payload.instance, lead_id: lead.id, conversation_id: conversation.id },
    true
  );

  return NextResponse.json({
    success: true,
    processed: true,
    lead_id: lead.id,
    lead_created: lead.created,
    conversation_id: conversation.id,
    message_created: Boolean(insertedMessage?.id),
    message_type: messageContent.type,
  });
}

// ─── Rate limit config ────────────────────────────────────────────────────────

// 120 requests per minute per IP — well above normal Evolution delivery rates
// (~1–5 messages/s burst in busy deployments) but blocks flooding.
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Rate limit — before any other work to protect DB from flooding
  const rlKey = getRateLimitKey(request, "evolution");
  const rl = checkRateLimit(rlKey, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests", retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  // 2. Auth — fail closed: if EVOLUTION_WEBHOOK_SECRET (or EVOLUTION_API_KEY)
  //    is not configured, reject the request rather than accepting it blindly.
  if (!verifyEvolutionSignature(request)) {
    // Best-effort log — do not expose the secret in the log payload.
    try {
      const admin = createAdminClient();
      await logWebhook(
        admin,
        null,
        "AUTH_FAILURE",
        { apikeyPresent: request.headers.get("apikey") !== null },
        false,
        process.env.EVOLUTION_WEBHOOK_SECRET || process.env.EVOLUTION_API_KEY
          ? "Unauthorized: apikey header or token mismatch"
          : "Service misconfigured: EVOLUTION_WEBHOOK_SECRET not set"
      );
    } catch { /* best-effort */ }

    if (!getWebhookSecret()) {
      return NextResponse.json(
        { error: "Service Unavailable", code: "WEBHOOK_NOT_CONFIGURED" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. Parse body
  let body: unknown;
  let rawBodySnippet: string | undefined;
  try {
    const text = await request.text();
    rawBodySnippet = text.slice(0, 500); // keep snippet for debug, not full payload
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // body stays undefined; handled below
  }

  const admin = createAdminClient();

  if (body === undefined) {
    await logWebhook(admin, null, "PARSE_FAILURE", { rawBodySnippet }, false, "Invalid or empty JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = EvolutionWebhookSchema.safeParse(body);
  if (!parsed.success) {
    await logWebhook(admin, null, "SCHEMA_FAILURE", { eventHint: (body as Record<string, unknown>)?.event }, false, `Schema validation failed: ${parsed.error.message}`);
    return NextResponse.json({ received: true, processed: false, reason: "Unsupported payload" });
  }

  const rawPayload = parsed.data;
  const instanceName = rawPayload.instance ?? rawPayload.instanceName ?? "";
  if (!instanceName) {
    await logWebhook(admin, null, rawPayload.event ?? "UNKNOWN", {}, false, "Missing instance identifier");
    return NextResponse.json({ received: true, processed: false, reason: "Missing instance identifier" });
  }
  const payload = { ...rawPayload, instance: instanceName };

  try {
    if (MESSAGE_EVENTS.has(payload.event)) return handleMessageEvent(admin, payload);
    if (CONNECTION_EVENTS.has(payload.event)) return handleConnectionEvent(admin, payload);
    if (QRCODE_EVENTS.has(payload.event)) return handleQrCodeEvent(admin, payload);

    if (payload.event === "MESSAGES_UPDATE" || payload.event === "messages.update") {
      await logWebhook(admin, null, payload.event, { event: payload.event, instance: payload.instance }, true);
      return NextResponse.json({ received: true, processed: true, reason: "Status update logged" });
    }

    await logWebhook(admin, null, payload.event, { event: payload.event, instance: payload.instance }, false, "Evento ignorado pelo CRM.");
    return NextResponse.json({ received: true, processed: false, reason: "Event not handled" });
  } catch (error) {
    await logWebhook(admin, null, payload.event, { event: payload.event, instance: payload.instance }, false, error instanceof Error ? error.message : "Internal server error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "POST /api/webhooks/evolution",
    handled_events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED", "SEND_MESSAGE"],
    auth: "Header: apikey (EVOLUTION_WEBHOOK_SECRET)",
  });
}
