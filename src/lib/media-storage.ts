import type { createAdminClient } from "@/lib/supabase/server";

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

// Default MIME types when Evolution doesn't include one
const MIME_DEFAULTS: Record<string, string> = {
  audio:    "audio/ogg; codecs=opus",
  image:    "image/jpeg",
  video:    "video/mp4",
  document: "application/octet-stream",
  sticker:  "image/webp",
};

function mimeExtension(mime: string, mediaType: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  const extMap: Record<string, string> = {
    "audio/ogg":  "ogg",  "audio/mpeg":  "mp3", "audio/mp4":  "m4a",
    "audio/opus": "opus", "audio/wav":   "wav",  "audio/webm": "weba",
    "image/jpeg": "jpg",  "image/png":   "png",  "image/webp": "webp",
    "image/gif":  "gif",  "image/avif":  "avif",
    "video/mp4":  "mp4",  "video/webm":  "webm", "video/3gpp": "3gp",
    "application/pdf": "pdf",   "text/plain": "txt",
    "application/zip": "zip",   "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  };
  if (extMap[base]) return extMap[base];
  const sub = base.split("/")[1];
  if (sub && /^[a-z0-9]+$/.test(sub) && sub.length <= 6) return sub;
  return ({ audio: "ogg", image: "jpg", video: "mp4", document: "bin", sticker: "webp" }[mediaType] ?? "bin");
}

export type MediaStoreResult = { url: string; mimetype: string };

/**
 * Downloads WhatsApp media via Evolution's decryption endpoint and uploads it
 * to Supabase Storage. WhatsApp media is AES-CBC encrypted; a raw CDN fetch
 * returns unusable bytes. Evolution's getBase64FromMediaMessage decrypts it.
 *
 * Returns { url: "supabase://media/<path>", mimetype } on success, null on failure.
 * Logs errors without exposing API keys, base64 payloads, or internal URLs.
 */
export async function fetchAndStoreWhatsAppMedia(
  admin: SupabaseAdmin,
  instanceName: string,
  messageObj: { key?: unknown; message?: unknown; messageType?: string },
  organizationId: string,
  evolutionMsgId: string,
  mediaType: string
): Promise<MediaStoreResult | null> {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey  = process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !apiKey) return null;

  try {
    const res = await fetch(
      `${baseUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({
          message: {
            key:         messageObj.key         ?? {},
            message:     messageObj.message     ?? {},
            messageType: messageObj.messageType,
          },
          convertToMp4: false,
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!res.ok) {
      console.error("[media] getBase64 HTTP", res.status, "msgId:", evolutionMsgId, "type:", mediaType);
      return null;
    }

    const json = await res.json() as { base64?: string; mimetype?: string };
    if (!json.base64) {
      console.error("[media] getBase64 empty response msgId:", evolutionMsgId, "type:", mediaType);
      return null;
    }

    const mimeRaw     = json.mimetype ?? MIME_DEFAULTS[mediaType] ?? "application/octet-stream";
    const ext         = mimeExtension(mimeRaw, mediaType);
    const storagePath = `${organizationId}/${mediaType}/${evolutionMsgId}.${ext}`;

    const buffer = Buffer.from(json.base64, "base64");
    const { error: uploadErr } = await admin.storage
      .from("media")
      .upload(storagePath, buffer, { contentType: mimeRaw, upsert: false });

    if (uploadErr) {
      // Duplicate upload from a retried webhook — return existing path
      if (uploadErr.message?.includes("already exists")) {
        return { url: `supabase://media/${storagePath}`, mimetype: mimeRaw };
      }
      console.error("[media] Storage upload error:", uploadErr.message, "msgId:", evolutionMsgId);
      return null;
    }

    return { url: `supabase://media/${storagePath}`, mimetype: mimeRaw };
  } catch (err) {
    console.error(
      "[media] fetchAndStoreWhatsAppMedia error:",
      err instanceof Error ? err.message : String(err),
      "msgId:", evolutionMsgId
    );
    return null;
  }
}
