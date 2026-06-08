// Server-only helper — creates short-lived signed URLs for the Evolution API
// to download media from Supabase Storage. Never expose signed URLs to clients.

import type { createAdminClient } from "@/lib/supabase/server";

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

export async function getSignedMediaUrlForEvolution(
  admin: SupabaseAdmin,
  storageRef: string,
  expiresInSeconds = 300
): Promise<string | null> {
  if (!storageRef.startsWith("supabase://media/")) return null;
  const path = storageRef.slice("supabase://media/".length);
  const logPath = path.split("/").slice(0, 2).join("/") + "/...";

  try {
    const { data, error } = await admin.storage
      .from("media")
      .createSignedUrl(path, expiresInSeconds);

    if (error || !data?.signedUrl) {
      console.error("[signed-url] createSignedUrl error:", error?.message ?? "no url", "path:", logPath);
      return null;
    }

    return data.signedUrl;
  } catch (err) {
    console.error("[signed-url] error:", err instanceof Error ? err.message : String(err), "path:", logPath);
    return null;
  }
}
