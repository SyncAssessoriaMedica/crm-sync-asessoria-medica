import { canAccessRoute } from "@/lib/permissions";
import { getDateRangeFromParams } from "@/lib/date-range";
import { getOrganizationContext } from "@/lib/organization-context";
import { AccessDenied } from "@/components/layout/access-denied";
import { LeadsClient } from "./leads-client";
import type { LeadListItem, LeadOptionData } from "./types";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: Promise<{ period?: string; start?: string; end?: string }>;
}) {
  const params = await searchParams;
  const range = getDateRangeFromParams(params);
  const context = await getOrganizationContext();
  const { admin, organizationId, organization, role: userRole } = context;
  const now = new Date();
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  if (!canAccessRoute(userRole, "/leads")) {
    return <AccessDenied />;
  }

  const [leadsResult, sourcesResult, pipelinesResult, customFieldsResult, tagsResult] = await Promise.all([
    admin
      .from("leads")
      .select(
        `
        *,
        source:lead_sources(*),
        stage:pipeline_stages(*),
        lead_tags(tags(*)),
        custom_field_values(field_id, value)
      `
      )
      .eq("organization_id", organizationId)
      .gte("created_at", range.start.toISOString())
      .lt("created_at", range.end.toISOString())
      .order("created_at", { ascending: false }),
    admin
      .from("lead_sources")
      .select("*")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true }),
    admin
      .from("pipelines")
      .select("id, pipeline_stages(*)")
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .maybeSingle(),
    admin
      .from("custom_fields")
      .select("*")
      .eq("organization_id", organizationId)
      .order("order", { ascending: true })
      .order("created_at", { ascending: true }),
    admin
      .from("tags")
      .select("id, name, color")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true }),
  ]);

  const options: LeadOptionData = {
    sources: (sourcesResult.data ?? []) as LeadOptionData["sources"],
    stages: ((pipelinesResult.data?.pipeline_stages ?? []) as LeadOptionData["stages"]).sort(
      (a, b) => a.order - b.order
    ),
    customFields: (customFieldsResult.data ?? []) as LeadOptionData["customFields"],
    tags: (tagsResult.data ?? []) as LeadOptionData["tags"],
  };

  if (leadsResult.error) {
    return (
      <div className="rounded-xl border border-border bg-white p-8 shadow-card">
        <p className="label-eyebrow text-danger-red">Erro</p>
        <h1 className="mt-1 text-xl font-black text-text-primary">Nao foi possivel carregar leads</h1>
        <p className="mt-2 text-sm text-text-secondary">{leadsResult.error.message}</p>
      </div>
    );
  }

  const openConversationsResult = await admin
    .from("conversations")
    .select("id, lead_id, remote_jid")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .not("lead_id", "is", null);
  const allConversationsResult = await admin
    .from("conversations")
    .select("id, lead_id, remote_jid, updated_at")
    .eq("organization_id", organizationId)
    .not("lead_id", "is", null)
    .order("updated_at", { ascending: false });

  const openConversations = (openConversationsResult.data ?? []).filter(
    (conversation) => !String(conversation.remote_jid ?? "").includes("@g.us")
  ) as { id: string; lead_id: string; remote_jid: string }[];
  const conversationIds = openConversations.map((conversation) => conversation.id);
  const recentMessagesResult =
    conversationIds.length > 0
      ? await admin
          .from("messages")
          .select("conversation_id, direction, created_at")
          .in("conversation_id", conversationIds)
          .order("created_at", { ascending: false })
      : { data: [] as { conversation_id: string; direction: string; created_at: string }[] };

  const lastMessageByConversation = new Map<string, { direction: string; created_at: string }>();
  for (const message of recentMessagesResult.data ?? []) {
    if (!lastMessageByConversation.has(message.conversation_id)) {
      lastMessageByConversation.set(message.conversation_id, message);
    }
  }

  const noFollowupLeadIds = new Set<string>();
  for (const conversation of openConversations) {
    const lastMessage = lastMessageByConversation.get(conversation.id);
    if (
      lastMessage?.direction === "inbound" &&
      new Date(lastMessage.created_at).getTime() < fortyEightHoursAgo.getTime()
    ) {
      noFollowupLeadIds.add(conversation.lead_id);
    }
  }

  const inboxConversationByLeadId = new Map<string, string>();
  for (const conversation of allConversationsResult.data ?? []) {
    if (!conversation.lead_id || String(conversation.remote_jid ?? "").includes("@g.us")) continue;
    if (!inboxConversationByLeadId.has(conversation.lead_id)) {
      inboxConversationByLeadId.set(conversation.lead_id, conversation.id);
    }
  }

  const leads = ((leadsResult.data ?? []) as LeadListItem[]).map((lead) => ({
    ...lead,
    no_followup_48h: noFollowupLeadIds.has(lead.id),
    inbox_conversation_id: inboxConversationByLeadId.get(lead.id) ?? null,
  }));

  return (
    <LeadsClient
      leads={leads}
      options={options}
      organizationId={organizationId}
      organizationName={organization?.name ?? "Sync Marketing"}
      periodLabel={range.label}
      role={userRole}
    />
  );
}
