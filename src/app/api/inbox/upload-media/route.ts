import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { canAccessInbox } from "@/lib/permissions";
import { getOrganizationContext } from "@/lib/organization-context";

// ─── Allowed MIME types by media category ─────────────────────────────────────

const ALLOWED: Record<string, Set<string>> = {
  image: new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]),
  audio: new Set(["audio/ogg", "audio/mpeg", "audio/mp3", "audio/wav", "audio/webm", "audio/mp4", "audio/x-m4a"]),
  video: new Set(["video/mp4", "video/webm", "video/3gpp", "video/quicktime"]),
  document: new Set([
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/zip",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/rtf",
    "application/x-zip-compressed",
  ]),
  sticker: new Set(["image/webp"]),
};

// Max sizes in bytes
const MAX_SIZE: Record<string, number> = {
  image: 10 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  document: 50 * 1024 * 1024,
  sticker: 5 * 1024 * 1024,
};

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp3": "mp3",
  "audio/wav": "wav", "audio/webm": "webm", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
  "video/mp4": "mp4", "video/webm": "webm", "video/3gpp": "3gp", "video/quicktime": "mov",
  "application/pdf": "pdf", "text/plain": "txt", "text/csv": "csv",
  "application/zip": "zip", "application/x-zip-compressed": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

function sanitizeFilename(raw: string): string {
  return raw
    .replace(/[^\w\s\-.()[\]]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 200) || "file";
}

const VALID_TYPES = new Set(["image", "audio", "video", "document", "sticker"]);

export async function POST(request: NextRequest) {
  // 1. Auth
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 });
  }

  // 2. Org context + inbox permission
  let organizationId: string;
  try {
    const context = await getOrganizationContext();
    if (!canAccessInbox(context.role)) {
      return NextResponse.json({ ok: false, error: "Sem permissão para acessar o Inbox." }, { status: 403 });
    }
    organizationId = context.organizationId;
  } catch {
    return NextResponse.json({ ok: false, error: "Erro ao obter contexto da organização." }, { status: 403 });
  }

  // 3. Parse form
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Formato de requisição inválido." }, { status: 400 });
  }

  const file = formData.get("file");
  const typeField = formData.get("type");

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Campo 'file' ausente ou inválido." }, { status: 400 });
  }
  if (typeof typeField !== "string" || !VALID_TYPES.has(typeField)) {
    return NextResponse.json({ ok: false, error: "Campo 'type' inválido." }, { status: 400 });
  }
  const type = typeField as "image" | "audio" | "video" | "document" | "sticker";

  // 4. Size
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "Arquivo vazio." }, { status: 400 });
  }
  const maxBytes = MAX_SIZE[type];
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / 1024 / 1024);
    return NextResponse.json({ ok: false, error: `Arquivo muito grande. Limite para ${type}: ${mb} MB.` }, { status: 413 });
  }

  // 5. MIME
  const rawMime = (file.type ?? "").toLowerCase().split(";")[0].trim();
  if (!rawMime || !ALLOWED[type].has(rawMime)) {
    return NextResponse.json(
      { ok: false, error: `Tipo de arquivo inválido para ${type}. MIME recebido: ${rawMime || "(vazio)"}` },
      { status: 415 }
    );
  }

  // 6. Upload
  const ext = MIME_TO_EXT[rawMime] ?? rawMime.split("/")[1] ?? "bin";
  const safeFilename = sanitizeFilename(file.name || `${type}.${ext}`);
  const storagePath = `${organizationId}/inbox/${type}/${randomUUID()}.${ext}`;

  const admin = createAdminClient();
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from("media")
    .upload(storagePath, buffer, { contentType: rawMime, upsert: false });

  if (uploadError) {
    console.error("[inbox/upload-media] storage error:", uploadError.message, "org:", organizationId, "type:", type);
    return NextResponse.json({ ok: false, error: "Erro ao salvar arquivo. Tente novamente." }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    url: `supabase://media/${storagePath}`,
    mimetype: rawMime,
    filename: safeFilename,
    size: file.size,
    type,
  });
}
