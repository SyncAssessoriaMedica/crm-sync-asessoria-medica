import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getOrganizationContext } from "@/lib/organization-context";
import { canAccessRoute } from "@/lib/permissions";

const ALLOWED: Record<string, Set<string>> = {
  image: new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]),
  audio: new Set(["audio/ogg", "audio/mpeg", "audio/mp3", "audio/wav", "audio/webm", "audio/mp4", "audio/x-m4a"]),
  video: new Set(["video/mp4", "video/webm", "video/3gpp", "video/quicktime"]),
  document: new Set(["application/pdf", "text/plain", "text/csv", "application/zip", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
  sticker: new Set(["image/webp"]),
};
const MAX_SIZE: Record<string, number> = { image: 10e6, audio: 16e6, video: 50e6, document: 50e6, sticker: 5e6 };
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/webm": "webm", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
  "video/mp4": "mp4", "video/webm": "webm", "video/3gpp": "3gp", "video/quicktime": "mov",
  "application/pdf": "pdf", "text/plain": "txt", "text/csv": "csv", "application/zip": "zip", "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Nao autorizado." }, { status: 401 });
    const context = await getOrganizationContext();
    if (!canAccessRoute(context.role, "/admin/mensagens-rapidas")) {
      return NextResponse.json({ ok: false, error: "Sem permissao." }, { status: 403 });
    }
    const body = await request.json() as { type?: string; mimetype?: string; size?: number; filename?: string };
    const type = body.type ?? "";
    const mime = (body.mimetype ?? "").toLowerCase().split(";")[0].trim();
    const size = Number(body.size);
    if (!ALLOWED[type] || !ALLOWED[type].has(mime)) {
      return NextResponse.json({ ok: false, error: "Tipo de arquivo invalido." }, { status: 415 });
    }
    if (!Number.isFinite(size) || size <= 0 || size > MAX_SIZE[type]) {
      return NextResponse.json({ ok: false, error: "Arquivo vazio ou acima do limite permitido." }, { status: 413 });
    }
    const extension = EXT[mime] ?? "bin";
    const storagePath = `${context.organizationId}/quick-messages/${type}/${randomUUID()}.${extension}`;
    const { data, error } = await createAdminClient().storage.from("media").createSignedUploadUrl(storagePath);
    if (error || !data) return NextResponse.json({ ok: false, error: "Erro ao preparar upload." }, { status: 502 });
    return NextResponse.json({
      ok: true,
      signedUrl: data.signedUrl,
      storagePath,
      mimetype: mime,
      filename: (body.filename || `${type}.${extension}`).replace(/[^\w\s\-.()[\]]/g, "_").slice(0, 200),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Requisicao invalida." }, { status: 400 });
  }
}
