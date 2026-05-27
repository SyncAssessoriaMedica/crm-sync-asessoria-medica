import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { canManageActiveOrganization, getOrganizationContext } from "@/lib/organization-context";

// ─── Allowed types & limits ───────────────────────────────────────────────────

const ALLOWED_AUDIO = new Set([
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/webm",
  "audio/mp4",
]);

const ALLOWED_IMAGE = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const MIME_TO_EXT: Record<string, string> = {
  "audio/ogg":  "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3":  "mp3",
  "audio/wav":  "wav",
  "audio/webm": "webm",
  "audio/mp4":  "m4a",
  "image/jpeg": "jpg",
  "image/jpg":  "jpg",
  "image/png":  "png",
  "image/webp": "webp",
};

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Auth
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // 2. Check permissions and get org context
  let organizationId: string;
  try {
    const context = await getOrganizationContext();
    if (!canManageActiveOrganization(context)) {
      return NextResponse.json({ ok: false, error: "Sem permissao para gerenciar esta organizacao." }, { status: 403 });
    }
    organizationId = context.organizationId;
  } catch {
    return NextResponse.json({ ok: false, error: "Erro ao obter contexto da organizacao." }, { status: 403 });
  }

  // 3. Parse multipart form
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Formato de requisicao invalido." }, { status: 400 });
  }

  const file = formData.get("file");
  const type = formData.get("type");

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Campo 'file' ausente ou invalido." }, { status: 400 });
  }
  if (typeof type !== "string" || (type !== "audio" && type !== "image")) {
    return NextResponse.json({ ok: false, error: "Campo 'type' deve ser 'audio' ou 'image'." }, { status: 400 });
  }

  // 4. Validate size
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "Arquivo vazio." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "Arquivo muito grande. Limite: 10 MB." }, { status: 413 });
  }

  // 5. Validate MIME type (use file.type from client AND sniff extension)
  const rawMime = (file.type ?? "").toLowerCase().split(";")[0].trim();
  const allowed = type === "audio" ? ALLOWED_AUDIO : ALLOWED_IMAGE;
  if (!allowed.has(rawMime)) {
    const allowedList = type === "audio"
      ? "ogg, mp3, wav, webm"
      : "jpeg, png, webp";
    return NextResponse.json(
      { ok: false, error: `Tipo de arquivo invalido para ${type}. Aceitos: ${allowedList}.` },
      { status: 415 }
    );
  }

  // 6. Upload to Supabase Storage
  const ext         = MIME_TO_EXT[rawMime] ?? (type === "audio" ? "ogg" : "jpg");
  const filename    = file.name || `${type}.${ext}`;
  const storagePath = `${organizationId}/followup/${randomUUID()}.${ext}`;

  const admin = createAdminClient();
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from("media")
    .upload(storagePath, buffer, { contentType: rawMime, upsert: false });

  if (uploadError) {
    console.error("[upload-media] storage error:", uploadError.message, "org:", organizationId);
    return NextResponse.json({ ok: false, error: "Erro ao salvar arquivo. Tente novamente." }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    url: `supabase://media/${storagePath}`,
    mimetype: rawMime,
    filename,
  });
}
