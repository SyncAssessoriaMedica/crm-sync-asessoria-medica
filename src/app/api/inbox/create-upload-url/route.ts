import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { canAccessInbox } from "@/lib/permissions";
import { getOrganizationContext } from "@/lib/organization-context";

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

const MAX_SIZE: Record<string, number> = {
  image: 10 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  document: 50 * 1024 * 1024,
  sticker: 5 * 1024 * 1024,
};

const TYPE_LABEL: Record<string, string> = {
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Arquivo",
  sticker: "Figurinha",
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

const VALID_TYPES = new Set(["image", "audio", "video", "document", "sticker"]);

function sanitizeFilename(raw: string): string {
  return raw
    .replace(/[^\w\s\-.()[\]]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 200) || "file";
}

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

  // 3. Parse JSON body
  let body: { type?: unknown; mimetype?: unknown; size?: unknown; filename?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { type: typeField, mimetype: rawMimeField, size: sizeField, filename: filenameField } = body;

  if (typeof typeField !== "string" || !VALID_TYPES.has(typeField)) {
    return NextResponse.json({ ok: false, error: "Campo 'type' inválido." }, { status: 400 });
  }
  const type = typeField as "image" | "audio" | "video" | "document" | "sticker";

  // 4. Size validation
  const size = typeof sizeField === "number" ? sizeField : Number(sizeField);
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ ok: false, error: "Campo 'size' inválido." }, { status: 400 });
  }
  const maxBytes = MAX_SIZE[type];
  if (size > maxBytes) {
    const limitMb = Math.round(maxBytes / 1024 / 1024);
    const fileMb = (size / 1024 / 1024).toFixed(1);
    return NextResponse.json({
      ok: false,
      error: `${TYPE_LABEL[type]} muito grande. Limite: ${limitMb} MB. Este arquivo tem ${fileMb} MB.`,
    }, { status: 413 });
  }

  // 5. MIME validation
  const rawMime = typeof rawMimeField === "string" ? rawMimeField.toLowerCase().split(";")[0].trim() : "";
  if (!rawMime || !ALLOWED[type].has(rawMime)) {
    return NextResponse.json({
      ok: false,
      error: `Tipo de arquivo inválido para ${TYPE_LABEL[type].toLowerCase()}. MIME recebido: ${rawMime || "(vazio)"}`,
    }, { status: 415 });
  }

  // 6. Build storage path + generate signed upload URL
  const ext = MIME_TO_EXT[rawMime] ?? rawMime.split("/")[1] ?? "bin";
  const rawFilename = typeof filenameField === "string" ? filenameField : `${type}.${ext}`;
  const storagePath = `${organizationId}/inbox/${type}/${randomUUID()}.${ext}`;

  const admin = createAdminClient();
  const { data: signedData, error: signedError } = await admin.storage
    .from("media")
    .createSignedUploadUrl(storagePath);

  if (signedError || !signedData) {
    console.error("[inbox/create-upload-url] signed URL error:", signedError?.message, "org:", organizationId);
    return NextResponse.json({ ok: false, error: "Erro ao gerar URL de upload. Tente novamente." }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    signedUrl: signedData.signedUrl,
    storagePath,
    mimetype: rawMime,
    filename: sanitizeFilename(rawFilename),
  });
}
