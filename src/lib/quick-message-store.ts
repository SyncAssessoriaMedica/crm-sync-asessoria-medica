import "server-only";
import { randomUUID } from "crypto";
import type { createAdminClient } from "@/lib/supabase/server";
import type { QuickMessage } from "@/lib/quick-messages";

const SOURCE = "quick_message_config";

type AdminClient = ReturnType<typeof createAdminClient>;
type QuickMessageEvent = {
  id: string;
  event_type: string | null;
  payload: unknown;
  created_at: string;
};

export async function listQuickMessages(
  admin: AdminClient,
  organizationId: string,
  options: { activeOnly?: boolean } = {}
) {
  const { data, error } = await admin
    .from("webhook_events")
    .select("id, event_type, payload, created_at")
    .eq("organization_id", organizationId)
    .eq("source", SOURCE)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return { data: [] as QuickMessage[], error };

  const latest = new Map<string, QuickMessage>();
  for (const event of (data ?? []) as QuickMessageEvent[]) {
    const payload = event.payload as Partial<QuickMessage> & { id?: string };
    if (!payload.id || latest.has(payload.id)) continue;
    latest.set(payload.id, {
      id: payload.id,
      title: payload.title ?? "Mensagem rapida",
      shortcut: payload.shortcut ?? "",
      message_type: payload.message_type ?? "text",
      content: payload.content ?? null,
      media_url: payload.media_url ?? null,
      media_mimetype: payload.media_mimetype ?? null,
      media_filename: payload.media_filename ?? null,
      media_duration: payload.media_duration ?? null,
      media_ptt: payload.media_ptt ?? null,
      active: event.event_type !== "quick_message.deleted" && payload.active !== false,
      created_at: payload.created_at ?? event.created_at,
      updated_at: event.created_at,
    });
  }

  const messages = Array.from(latest.values())
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
  return admin.from("webhook_events").insert({
    organization_id: organizationId,
    source: SOURCE,
    event_type: eventType,
    payload: { ...message, id: message.id || randomUUID() },
    processed: true,
  });
}
