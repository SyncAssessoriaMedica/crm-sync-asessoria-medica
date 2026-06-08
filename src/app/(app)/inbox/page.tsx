import { redirect } from "next/navigation";
import { canAccessRoute } from "@/lib/permissions";
import { getDateRangeFromParams } from "@/lib/date-range";
import { getOrganizationContext } from "@/lib/organization-context";
import { AccessDenied } from "@/components/layout/access-denied";
import { InboxClient } from "./inbox-client";
import type { BhAutoReplyQueueItem, InboxConversation, InboxInstance, InboxLead, InboxMessage, InboxService, InboxSource, InboxStage } from "./types";

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

function phoneToRemoteJid(phone: string | null | undefined) {
  let digits = (phone ?? "").replace(/\D/g, "");
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
    digits = `55${digits}`;
  }
  return digits ? `${digits}@s.whatsapp.net` : null;
}

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; period?: string; start?: string; end?: string; dateMode?: string; conversation?: string; lead?: string }>;
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

  const [conversationsResult, instancesResult, sourcesResult, servicesResult, pipelineResult] = await Promise.all([
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
          service_id,
          source:lead_sources(id, name, active),
          service:clinic_services(id, name, active),
          stage_id,
          stage:pipeline_stages(id, name)
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
    admin
      .from("clinic_services")
      .select("id, name, active, order")
      .eq("organization_id", organizationId)
      .order("order", { ascending: true })
      .order("name", { ascending: true }),
    admin
      .from("pipelines")
      .select("pipeline_stages(id, name, color, order)")
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .maybeSingle(),
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
  const leadParam = params?.lead ?? "";
  const initialRows = ((conversationsResult.data ?? []) as unknown as ConversationRow[]).filter((conversation) => {
    const instance = firstRelation(conversation.instance);
    return !instance?.deleted_at;
  });
  let rows = initialRows;

  const CONVERSATION_SELECT = `
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
      service_id,
      source:lead_sources(id, name, active),
      service:clinic_services(id, name, active),
      stage_id,
      stage:pipeline_stages(id, name)
    ),
    instance:whatsapp_instances(id, instance_name, phone_number, status, deleted_at)
  `;

  if (selectedConversationId && !initialRows.some((conversation) => conversation.id === selectedConversationId)) {
    const { data: selectedConversation } = await admin
      .from("conversations")
      .select(CONVERSATION_SELECT)
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

  if (leadParam && !selectedConversationId) {
    const existingRow = initialRows.find((conversation) => {
      const lead = firstRelation(conversation.lead);
      return lead?.id === leadParam;
    });
    if (existingRow) {
      redirect(`/inbox?conversation=${existingRow.id}`);
    } else {
      const { data: leadConversation } = await admin
        .from("conversations")
        .select("id")
        .eq("lead_id", leadParam)
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (leadConversation?.id) {
        redirect(`/inbox?conversation=${leadConversation.id}`);
      }

      const instances = ((instancesResult.data ?? []) as InboxInstance[]).filter((instance) => !instance.deleted_at);
      const selectedInstance =
        instances.find((instance) => instance.status === "connected") ??
        instances[0] ??
        null;

      if (selectedInstance?.id) {
        const { data: lead } = await admin
          .from("leads")
          .select("id, phone")
          .eq("id", leadParam)
          .eq("organization_id", organizationId)
          .maybeSingle();

        const remoteJid = phoneToRemoteJid(lead?.phone);

        if (lead?.id && remoteJid) {
          const { data: existingByPhone } = await admin
            .from("conversations")
            .select("id, lead_id")
            .eq("instance_id", selectedInstance.id)
            .eq("remote_jid", remoteJid)
            .maybeSingle();

          if (existingByPhone?.id) {
            if (!existingByPhone.lead_id) {
              await admin.from("conversations").update({ lead_id: lead.id }).eq("id", existingByPhone.id);
            }
            redirect(`/inbox?conversation=${existingByPhone.id}`);
          }

          const { data: createdConversation, error: createConversationError } = await admin
            .from("conversations")
            .insert({
              organization_id: organizationId,
              instance_id: selectedInstance.id,
              lead_id: lead.id,
              remote_jid: remoteJid,
              unread_count: 0,
              status: "open",
            })
            .select("id")
            .maybeSingle();

          if (createdConversation?.id) {
            redirect(`/inbox?conversation=${createdConversation.id}`);
          }

          if (createConversationError?.code === "23505") {
            const { data: racedConversation } = await admin
              .from("conversations")
              .select("id, lead_id")
              .eq("instance_id", selectedInstance.id)
              .eq("remote_jid", remoteJid)
              .maybeSingle();

            if (racedConversation?.id) {
              if (!racedConversation.lead_id) {
                await admin.from("conversations").update({ lead_id: lead.id }).eq("id", racedConversation.id);
              }
              redirect(`/inbox?conversation=${racedConversation.id}`);
            }
          }
        }
      }
    }
  }
  const conversationIds = rows.map((conversation) => conversation.id);
  const activeConversationId = selectedConversationId || conversationIds[0] || "";
  const [{ data: messagesData }, { data: latestMessagesData }, { data: bhAutoReplyData }] =
    conversationIds.length > 0
      ? await Promise.all([
          activeConversationId
            ? admin
                .from("messages")
                .select(
                  "id, conversation_id, direction, message_type, content, media_url, media_mimetype, media_filename, media_duration, created_at, delivered_at, read_at, send_status, send_error, client_message_id"
                )
                .eq("conversation_id", activeConversationId)
                .order("created_at", { ascending: true })
            : Promise.resolve({ data: [] as InboxMessage[] }),
          admin.rpc("get_latest_inbox_messages", { conversation_ids: conversationIds }),
          admin
            .from("bh_auto_reply_queue")
            .select("id, conversation_id, scheduled_for, status")
            .in("conversation_id", conversationIds)
            .in("status", ["pending", "sending"]),
        ])
      : [{ data: [] as InboxMessage[] }, { data: [] as InboxMessage[] }, { data: [] as BhAutoReplyQueueItem[] }];

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

  const latestMessagesByConversation = ((latestMessagesData ?? []) as InboxMessage[]).reduce<Record<string, InboxMessage>>(
    (acc, message) => {
      acc[message.conversation_id] = message;
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
            service: firstRelation(lead.service),
            stage: firstRelation(lead.stage),
          }
        : null,
      instance,
      last_message: latestMessagesByConversation[conversation.id] ?? messages[messages.length - 1] ?? null,
    };
  }) as InboxConversation[];

  return (
    <InboxClient
      key={`${params?.q ?? ""}-${dateMode}-${range.start.toISOString()}-${range.end.toISOString()}-${selectedConversationId}-${leadParam}`}
      organizationId={organizationId}
      conversations={conversations}
      messagesByConversation={messagesByConversation}
      bhAutoRepliesByConversation={bhAutoRepliesByConversation}
      instances={(instancesResult.data ?? []) as InboxInstance[]}
      sources={(sourcesResult.data ?? []) as InboxSource[]}
      services={(servicesResult.data ?? []) as InboxService[]}
      stages={((pipelineResult.data?.pipeline_stages ?? []) as InboxStage[]).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))}
      initialSearch={params?.q ?? ""}
      initialActiveConversationId={activeConversationId}
      dateMode={dateMode}
    />
  );
}
