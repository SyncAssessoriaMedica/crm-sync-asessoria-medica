import "server-only";
import type { createAdminClient } from "@/lib/supabase/server";
import type { QuickMessage } from "@/lib/quick-messages";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function listQuickMessages(
  admin: AdminClient,
  organizationId: string,
  options: { activeOnly?: boolean } = {}
) {
  const { data, error } = await admin
    .from("quick_messages")
    .select("id, title, shortcut, message_type, content, media_url, media_mimetype, media_filename, media_duration, media_ptt, active, created_at, updated_at")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("title", { ascending: true });
  if (error) return { data: [] as QuickMessage[], error };

  const messages = (data as QuickMessage[])
    .filter((message) => !options.activeOnly || message.active)
    .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
  return { data: messages, error: null };
}

export async function findQuickMessage(admin: AdminClient, organizationId: string, id: string) {
  const result = await listQuickMessages(admin, organizationId);
  return result.data.find((message) => message.id === id) ?? null;
}

export async function writeQuickMessage(
  admin: AdminClient,
  organizationId: string,
  eventType: "quick_message.created" | "quick_message.updated" | "quick_message.activated" | "quick_message.deactivated" | "quick_message.deleted",
  message: Omit<QuickMessage, "updated_at"> & { updated_at?: string }
) {
  if (eventType === "quick_message.created") {
    return admin.from("quick_messages").insert({ ...message, organization_id: organizationId });
  }
  if (eventType === "quick_message.deleted") {
    return admin
      .from("quick_messages")
      .update({ active: false, deleted_at: new Date().toISOString() })
      .eq("id", message.id)
      .eq("organization_id", organizationId);
  }
  return admin
    .from("quick_messages")
    .update(message)
    .eq("id", message.id)
    .eq("organization_id", organizationId)
    .is("deleted_at", null);
}
