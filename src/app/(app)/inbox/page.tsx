import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { InboxClient } from "./inbox-client";
import type { InboxConversation, InboxInstance, InboxLead, InboxMessage } from "./types";

type ConversationRow = Omit<InboxConversation, "lead" | "instance" | "last_message"> & {
  lead: InboxLead | InboxLead[] | null;
  instance: InboxInstance | InboxInstance[] | null;
};

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; period?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return (
      <div className="rounded-xl border border-border bg-white p-8 shadow-card">
        <p className="label-eyebrow text-text-muted">Acesso</p>
        <h1 className="mt-1 text-xl font-black text-text-primary">Organizacao nao configurada</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Este usuario ainda nao possui uma organizacao vinculada.
        </p>
      </div>
    );
  }

  const organizationId = membership.organization_id as string;
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
          source:lead_sources(name),
          stage:pipeline_stages(name)
        ),
        instance:whatsapp_instances(id, instance_name, phone_number, status)
      `
      )
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(80),
    admin
      .from("whatsapp_instances")
      .select("id, instance_name, phone_number, status")
      .eq("organization_id", organizationId)
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

  const rows = (conversationsResult.data ?? []) as unknown as ConversationRow[];
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
      conversations={conversations}
      messagesByConversation={messagesByConversation}
      instances={(instancesResult.data ?? []) as InboxInstance[]}
      initialSearch={params?.q ?? ""}
      period={params?.period ?? "30d"}
    />
  );
}
