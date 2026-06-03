import { canAccessRoute } from "@/lib/permissions";
import { getDateRangeFromParams } from "@/lib/date-range";
import { getOrganizationContext } from "@/lib/organization-context";
import { AccessDenied } from "@/components/layout/access-denied";
import { InboxClient } from "./inbox-client";
import type { BhAutoReplyQueueItem, InboxConversation, InboxInstance, InboxLead, InboxMessage, InboxSource } from "./types";

type ConversationRow = Omit<InboxConversation, "lead" | "instance" | "last_message"> & {
  lead: InboxLead | InboxLead[] | null;
  instance: InboxInstance | InboxInstance[] | null;
};

type InboxDateMode = "activity" | "created";

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function getDateMode(value?: string): InboxDateMode {
  return value === "created" ? "created" : "activity";
}

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; period?: string; start?: string; end?: string; dateMode?: string; conversation?: string }>;
}) {
  const params = await searchParams;
  const range = getDateRangeFromParams(params);
  const dateMode = getDateMode(params?.dateMode);
  const dateColumn = dateMode === "created" ? "created_at" : "updated_at";
  const context = await getOrganizationContext();
  const { admin, organizationId, role: userRole } = context;

  if (!canAccessRoute(userRole, "/inbox")) {
    return <AccessDenied />;
  }

  const [conversationsResult, instancesResult, sourcesResult] = await Promise.all([
    admin
      .from("conversations")
      .select(
        `
        id,
        remote_jid,
        unread_count,
        status,
        created_at,
        updated_at,
        lead:leads(
          id,
          name,
          phone,
          procedure,
          status,
          potential_value,
          appointment_scheduled_at,
          followup_paused,
          phone_ddd,
          detected_state,
          detected_city,
          service_area_status,
          source_id,
          source:lead_sources(id, name, active),
          stage:pipeline_stages(name)
        ),
        instance:whatsapp_instances(id, instance_name, phone_number, status, deleted_at)
      `
      )
      .eq("organization_id", organizationId)
      .not("lead_id", "is", null)
      .gte(dateColumn, range.start.toISOString())
      .lt(dateColumn, range.end.toISOString())
      .order(dateColumn, { ascending: false })
      .limit(80),
    admin
      .from("whatsapp_instances")
      .select("id, instance_name, phone_number, status")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    admin
      .from("lead_sources")
      .select("id, name, color, active")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true }),
  ]);

  if (conversationsResult.error) {
    return (
      <div className="rounded-xl border border-border bg-white p-8 shadow-card">
        <p className="label-eyebrow text-danger-red">Erro</p>
        <h1 className="mt-1 text-xl font-black text-text-primary">Nao foi possivel carregar o Inbox</h1>
        <p className="mt-2 text-sm text-text-secondary">{conversationsResult.error.message}</p>
      </div>
    );
  }

  const selectedConversationId = params?.conversation ?? "";
  const initialRows = ((conversationsResult.data ?? []) as unknown as ConversationRow[]).filter((conversation) => {
    const instance = firstRelation(conversation.instance);
    return !instance?.deleted_at;
  });
  let rows = initialRows;

  if (selectedConversationId && !initialRows.some((conversation) => conversation.id === selectedConversationId)) {
    const { data: selectedConversation } = await admin
      .from("conversations")
      .select(
        `
        id,
        remote_jid,
        unread_count,
        status,
        created_at,
        updated_at,
        lead:leads(
          id,
          name,
          phone,
          procedure,
          status,
          potential_value,
          appointment_scheduled_at,
          followup_paused,
          phone_ddd,
          detected_state,
          detected_city,
          service_area_status,
          source_id,
          source:lead_sources(id, name, active),
          stage:pipeline_stages(name)
        ),
        instance:whatsapp_instances(id, instance_name, phone_number, status, deleted_at)
      `
      )
      .eq("id", selectedConversationId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (selectedConversation) {
      const instance = firstRelation((selectedConversation as unknown as ConversationRow).instance);
      if (!instance?.deleted_at) {
        rows = [selectedConversation as unknown as ConversationRow, ...initialRows];
      }
    }
  }
  const conversationIds = rows.map((conversation) => conversation.id);
  const [{ data: messagesData }, { data: bhAutoReplyData }] =
    conversationIds.length > 0
      ? await Promise.all([
          admin
            .from("messages")
            .select(
              "id, conversation_id, direction, message_type, content, media_url, media_mimetype, media_filename, media_duration, created_at, delivered_at, read_at"
            )
            .in("conversation_id", conversationIds)
            .order("created_at", { ascending: true }),
          admin
            .from("bh_auto_reply_queue")
            .select("id, conversation_id, scheduled_for, status")
            .in("conversation_id", conversationIds)
            .in("status", ["pending", "sending"]),
        ])
      : [{ data: [] as InboxMessage[] }, { data: [] as BhAutoReplyQueueItem[] }];

  const messagesByConversation = ((messagesData ?? []) as InboxMessage[]).reduce<Record<string, InboxMessage[]>>(
    (acc, message) => {
      acc[message.conversation_id] ??= [];
      acc[message.conversation_id].push(message);
      return acc;
    },
    {}
  );

  const bhAutoRepliesByConversation = ((bhAutoReplyData ?? []) as BhAutoReplyQueueItem[]).reduce<
    Record<string, BhAutoReplyQueueItem>
  >((acc, item) => {
    acc[item.conversation_id] = item;
    return acc;
  }, {});

  const conversations = rows.map((conversation) => {
    const lead = firstRelation(conversation.lead);
    const instance = firstRelation(conversation.instance);
    const messages = messagesByConversation[conversation.id] ?? [];
    return {
      ...conversation,
      lead: lead
        ? {
            ...lead,
            source: firstRelation(lead.source),
            stage: firstRelation(lead.stage),
          }
        : null,
      instance,
      last_message: messages[messages.length - 1] ?? null,
    };
  }) as InboxConversation[];

  return (
    <InboxClient
      key={`${params?.q ?? ""}-${dateMode}-${range.start.toISOString()}-${range.end.toISOString()}-${selectedConversationId}`}
      organizationId={organizationId}
      conversations={conversations}
      messagesByConversation={messagesByConversation}
      bhAutoRepliesByConversation={bhAutoRepliesByConversation}
      instances={(instancesResult.data ?? []) as InboxInstance[]}
      sources={(sourcesResult.data ?? []) as InboxSource[]}
      initialSearch={params?.q ?? ""}
      initialActiveConversationId={selectedConversationId}
      dateMode={dateMode}
    />
  );
}
