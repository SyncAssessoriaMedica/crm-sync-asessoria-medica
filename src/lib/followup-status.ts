import "server-only";
import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

function normalizeStageName(value?: string | null) {
  return (value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function isFollowupExhaustedStage(stageName?: string | null) {
  return normalizeStageName(stageName).includes("mais de 2 follow");
}

export function isExcludedFromFollowup48h(stageName?: string | null) {
  const normalized = normalizeStageName(stageName);
  return normalized === "agendado" || normalized === "retorno" || normalized.includes("mais de 2 follow");
}

export async function getNoFollowup48hStatus(admin: AdminClient, organizationId: string) {
  const { data: conversations, error } = await admin
    .from("conversations")
    .select("id, lead_id, remote_jid, lead:leads(stage:pipeline_stages(name))")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .not("lead_id", "is", null);
  if (error) throw error;

  const eligible = (conversations ?? []).filter((conversation) => {
    if (String(conversation.remote_jid ?? "").includes("@g.us")) return false;
    const lead = Array.isArray(conversation.lead) ? conversation.lead[0] : conversation.lead;
    const stage = Array.isArray(lead?.stage) ? lead.stage[0] : lead?.stage;
    return !isExcludedFromFollowup48h(stage?.name);
  });

  const ids = eligible.map((conversation) => conversation.id);
  const { data: latestMessages, error: latestError } = ids.length
    ? await admin.rpc("get_latest_inbox_messages", { conversation_ids: ids })
    : { data: [], error: null };
  if (latestError) throw latestError;

  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const conversationIds = new Set<string>();
  for (const message of latestMessages ?? []) {
    if (message.direction === "inbound" && new Date(message.created_at).getTime() < cutoff) {
      conversationIds.add(message.conversation_id);
    }
  }

  const leadIds = new Set<string>();
  for (const conversation of eligible) {
    if (conversation.lead_id && conversationIds.has(conversation.id)) leadIds.add(conversation.lead_id);
  }
  return { conversationIds, leadIds };
}
