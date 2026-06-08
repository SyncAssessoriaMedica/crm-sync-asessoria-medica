import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { canAccessInbox } from "@/lib/permissions";
import { fetchAndStoreWhatsAppMedia } from "@/lib/media-storage";

const SYNC_ROLES = new Set(["super_admin", "gestor_sync"]);
const RETRYABLE_TYPES = new Set(["image", "audio", "video", "document", "sticker"]);

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;

  // 1. Auth
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // 2. Load message + conversation for org lookup
  const { data: message } = await admin
    .from("messages")
    .select("id, conversation_id, message_type, media_status, media_attempts, media_payload, direction")
    .eq("id", messageId)
    .maybeSingle();

  if (!message) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!RETRYABLE_TYPES.has(message.message_type ?? "")) {
    return NextResponse.json({ error: "Not a retryable media message" }, { status: 400 });
  }

  if (message.media_status === "ready") {
    return NextResponse.json({ status: "ready", message: "Media already downloaded" }, { status: 200 });
  }

  // 3. Org auth (same logic as proxy)
  const { data: conversation } = await admin
    .from("conversations")
    .select("organization_id")
    .eq("id", message.conversation_id)
    .single();

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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
  const effectiveRole = isSyncStaff ? profileRole : membershipRole;

  if (!effectiveRole || !canAccessInbox(effectiveRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 4. Resolve instance
  const { data: conv2 } = await admin
    .from("conversations")
    .select("instance:whatsapp_instances(id, instance_name, organization_id)")
    .eq("id", message.conversation_id)
    .single();

  const instance = Array.isArray(conv2?.instance) ? conv2.instance[0] : conv2?.instance;
  if (!instance?.instance_name) {
    return NextResponse.json({ error: "WhatsApp instance not found" }, { status: 404 });
  }

  // 5. Validate we have a payload to retry with
  const payload = message.media_payload as Record<string, unknown> | null;
  if (!payload || !payload.key || !payload.message) {
    return NextResponse.json(
      { error: "No media payload available for retry (message too old)" },
      { status: 422 }
    );
  }

  // 6. Mark as pending so the proxy returns 202 while we work
  await admin
    .from("messages")
    .update({ media_status: "pending" })
    .eq("id", messageId);

  // 7. Re-attempt download
  const stored = await fetchAndStoreWhatsAppMedia(
    admin,
    instance.instance_name,
    {
      key:         payload.key,
      message:     payload.message,
      messageType: typeof payload.messageType === "string" ? payload.messageType : undefined,
    },
    conversation.organization_id,
    // Use message ID as the deduplicated storage path key on retry
    `retry-${messageId}`,
    message.message_type ?? "document"
  );

  const newAttempts = (message.media_attempts ?? 0) + 1;

  if (stored) {
    await admin
      .from("messages")
      .update({
        media_url:      stored.url,
        media_mimetype: stored.mimetype,
        media_status:   "ready",
        media_attempts: newAttempts,
        media_error:    null,
      })
      .eq("id", messageId);

    return NextResponse.json({ status: "ready", media_url: stored.url }, { status: 200 });
  }

  await admin
    .from("messages")
    .update({
      media_status:   "failed",
      media_error:    "Falha ao baixar midia da Evolution.",
      media_attempts: newAttempts,
    })
    .eq("id", messageId);

  return NextResponse.json({ status: "failed", error: "Media download failed" }, { status: 502 });
}
