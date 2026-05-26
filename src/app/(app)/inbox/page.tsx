import { canAccessRoute } from "@/lib/permissions";
import { getOrganizationContext } from "@/lib/organization-context";
import { AccessDenied } from "@/components/layout/access-denied";
import { InboxClient } from "./inbox-client";
import type { InboxConversation, InboxInstance, InboxLead, InboxMessage } from "./types";

type ConversationRow = Omit<InboxConversation, "lead" | "instance" | "last_message"> & {
  lead: InboxLead | InboxLead[] | null;
  instance: InboxInstance | InboxInstance[] | null;
};

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; period?: string }>;
}) {
  const params = await searchParams;
  const context = await getOrganizationContext();
  const { admin, organizationId, role: userRole } = context;

  if (!canAccessRoute(userRole, "/inbox")) {
    return <AccessDenied />;
  }

  const [conversationsResult, instancesResult] = await Promise.all([
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
          followup_paused,
          source:lead_sources(name),
          stage:pipeline_stages(name)
        ),
        instance:whatsapp_instances(id, instance_name, phone_number, status, deleted_at)
      `
      )
      .eq("organization_id", organizationId)
      .not("lead_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(80),
    admin
      .from("whatsapp_instances")
      .select("id, instance_name, phone_number, status")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
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

  const rows = ((conversationsResult.data ?? []) as unknown as ConversationRow[]).filter((conversation) => {
    const instance = firstRelation(conversation.instance);
    return !instance?.deleted_at;
  });
  const conversationIds = rows.map((conversation) => conversation.id);
  const { data: messagesData } =
    conversationIds.length > 0
      ? await admin
          .from("messages")
          .select(
            "id, conversation_id, direction, message_type, content, media_url, media_mimetype, media_filename, media_duration, created_at, delivered_at, read_at"
          )
          .in("conversation_id", conversationIds)
          .order("created_at", { ascending: true })
      : { data: [] as InboxMessage[] };

  const messagesByConversation = ((messagesData ?? []) as InboxMessage[]).reduce<Record<string, InboxMessage[]>>(
    (acc, message) => {
      acc[message.conversation_id] ??= [];
      acc[message.conversation_id].push(message);
      return acc;
    },
    {}
  );

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
      key={`${params?.q ?? ""}-${params?.period ?? "30d"}`}
      organizationId={organizationId}
      conversations={conversations}
      messagesByConversation={messagesByConversation}
      instances={(instancesResult.data ?? []) as InboxInstance[]}
      initialSearch={params?.q ?? ""}
      period={params?.period ?? "30d"}
    />
  );
}
