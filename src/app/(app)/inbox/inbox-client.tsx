"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Clock, DollarSign, Filter, Inbox, MapPin, MessageCircle, Phone, Search, Tag, User, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { LOCATION_STATUS_LABELS } from "@/lib/lead-location";
import { cn, formatCurrency, formatDateTime, formatPhone, formatTimeAgo, getInitials } from "@/lib/utils";
import { AppointmentScheduler } from "@/components/leads/appointment-scheduler";
import { cancelBhAutoReplyAction, markConversationReadAction, updateConversationStatusAction } from "./actions";
import { updateLeadSourceAction, updateLeadStageAction } from "../leads/actions";
import { MessageBubble } from "./message-media";
import type { BhAutoReplyQueueItem, InboxConversation, InboxMessage, InboxService, InboxSource, InboxStage } from "./types";

const MEDIA_LABELS: Record<string, string> = {
  image: "Imagem",
  audio: "Audio",
  video: "Video",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localizacao",
};

const STATUS_LABELS: Record<string, string> = {
  new: "Novo",
  contacted: "Contactado",
  qualified: "Qualificado",
  scheduled: "Agendado",
  attended: "Compareceu",
  closed_won: "Fechado",
  closed_lost: "Perdido",
  no_show: "Nao compareceu",
};

const FOLLOWUP_CUTOFF_MS = 48 * 60 * 60 * 1000;

type InboxClientProps = {
  organizationId: string;
  conversations: InboxConversation[];
  messagesByConversation: Record<string, InboxMessage[]>;
  bhAutoRepliesByConversation: Record<string, BhAutoReplyQueueItem>;
  instances: { id: string; instance_name: string; phone_number: string | null; status: string }[];
  sources: InboxSource[];
  services: InboxService[];
  stages: InboxStage[];
  initialSearch: string;
  initialActiveConversationId?: string;
  dateMode: "activity" | "created";
};

function cleanJid(remoteJid: string) {
  return remoteJid.replace("@s.whatsapp.net", "").replace("@c.us", "");
}

function lastMessagePreview(message: InboxMessage | null) {
  if (!message) return "Conversa iniciada";
  if (message.message_type !== "text") return MEDIA_LABELS[message.message_type] ?? message.message_type;
  return message.content ?? "Mensagem";
}

function needsFollowup48h(conversation: InboxConversation) {
  const lastMessage = conversation.last_message;
  if (!lastMessage || conversation.status !== "open") return false;
  return lastMessage.direction === "inbound" && Date.now() - new Date(lastMessage.created_at).getTime() > FOLLOWUP_CUTOFF_MS;
}

function ConversationItem({
  conversation,
  isActive,
  locallyRead,
  onClick,
}: {
  conversation: InboxConversation;
  isActive: boolean;
  locallyRead: boolean;
  onClick: () => void;
}) {
  const lead = conversation.lead;
  const title = lead?.name ?? formatPhone(cleanJid(conversation.remote_jid));
  const effectiveUnread = locallyRead ? 0 : conversation.unread_count;

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors",
        isActive ? "bg-brand-green-soft" : "hover:bg-background-subtle"
      )}
    >
      <div className="relative shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-brand-green/20 bg-brand-green-soft text-sm font-bold text-brand-green-deep">
          {getInitials(title)}
        </div>
        {effectiveUnread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-green px-1 text-[9px] font-bold text-white">
            {effectiveUnread}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <p className="truncate text-xs font-semibold text-text-primary">{title}</p>
          <p className="ml-1 shrink-0 text-[10px] text-text-muted">
            {formatTimeAgo(conversation.last_message?.created_at ?? conversation.updated_at)}
          </p>
        </div>
        {lead?.procedure && <p className="text-[10px] font-medium text-brand-green-dark">{lead.procedure}</p>}
        <p className="mt-0.5 truncate text-[11px] text-text-muted">{lastMessagePreview(conversation.last_message)}</p>
      </div>
    </button>
  );
}

export function InboxClient({ organizationId, conversations, messagesByConversation, bhAutoRepliesByConversation, instances, sources, services, stages, initialSearch, initialActiveConversationId, dateMode }: InboxClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markedReadRef = useRef<Set<string>>(new Set());
  const [activeConvId, setActiveConvId] = useState(initialActiveConversationId || conversations[0]?.id || "");
  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<"all" | "unread" | "open" | "closed" | "no_followup_48h">("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [locallyReadIds, setLocallyReadIds] = useState<Set<string>>(new Set());
  const [cancelledBhIds, setCancelledBhIds] = useState<Set<string>>(new Set());
  const [localLeadSources, setLocalLeadSources] = useState<Record<string, string | null>>({});
  const [localLeadStages, setLocalLeadStages] = useState<Record<string, string | null>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredConversations = useMemo(() => {
    const term = search.toLowerCase().trim();
    return conversations.filter((conversation) => {
      const lead = conversation.lead;
      const haystack = [
        lead?.name,
        lead?.phone,
        lead?.service?.name,
        lead?.procedure,
        conversation.remote_jid,
        conversation.instance?.instance_name,
        conversation.last_message?.content,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = term === "" || haystack.includes(term);
      const matchesFilter =
        filter === "all" ||
        (filter === "unread" && conversation.unread_count > 0) ||
        (filter === "no_followup_48h" && needsFollowup48h(conversation)) ||
        conversation.status === filter;
      const matchesService = serviceFilter === "all" || lead?.service_id === serviceFilter;
      return matchesSearch && matchesFilter && matchesService;
    });
  }, [conversations, filter, search, serviceFilter]);

  const activeConv =
    filteredConversations.find((conversation) => conversation.id === activeConvId) ??
    filteredConversations[0] ??
    null;
  const messages = activeConv ? messagesByConversation[activeConv.id] ?? [] : [];
  const lead = activeConv?.lead ?? null;
  const leadSourceValue = lead
    ? (localLeadSources[lead.id] !== undefined ? localLeadSources[lead.id] : lead.source_id) ?? "none"
    : "none";
  const leadStageValue = lead
    ? (localLeadStages[lead.id] !== undefined ? localLeadStages[lead.id] : lead.stage_id) ?? "none"
    : "none";
  const activeInstance = activeConv?.instance ?? instances[0] ?? null;
  const noFollowupCount = useMemo(
    () => conversations.filter((conversation) => needsFollowup48h(conversation)).length,
    [conversations]
  );
  const conversationIdsKey = useMemo(
    () => conversations.map((conversation) => conversation.id).sort().join(","),
    [conversations]
  );

  function changeDateMode(nextMode: "activity" | "created") {
    const params = new URLSearchParams(searchParams.toString());
    if (nextMode === "activity") {
      params.delete("dateMode");
    } else {
      params.set("dateMode", nextMode);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) return;
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        router.refresh();
      }, 350);
    };

    const supabase = createClient();
    const conversationIds = new Set(conversationIdsKey.split(",").filter(Boolean));
    const channel = supabase
      .channel(`inbox-live-${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `organization_id=eq.${organizationId}`,
        },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const nextConversationId =
            (payload.new as { conversation_id?: string } | null)?.conversation_id ??
            (payload.old as { conversation_id?: string } | null)?.conversation_id;
          if (!nextConversationId || conversationIds.has(nextConversationId)) scheduleRefresh();
        }
      )
      .subscribe();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 4000);

    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [conversationIdsKey, organizationId, router]);

  // Auto-mark conversation as read when it becomes active or when unread_count increases
  useEffect(() => {
    if (!activeConv) return;

    if (activeConv.unread_count === 0) {
      // Server confirmed read — clear dedup block so future inbound messages auto-mark again
      markedReadRef.current.delete(activeConv.id);
      return;
    }

    // Prevent duplicate calls for the same (id, unread_count) cycle
    if (markedReadRef.current.has(activeConv.id)) return;
    markedReadRef.current.add(activeConv.id);

    // Optimistic: remove badge immediately without waiting for server refresh
    setLocallyReadIds((prev) => new Set([...prev, activeConv.id]));

    void markConversationReadAction(activeConv.id);
  }, [activeConv?.id, activeConv?.unread_count]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleClosed() {
    if (!activeConv) return;
    startTransition(async () => {
      const result = await updateConversationStatusAction(
        activeConv.id,
        activeConv.status === "closed" ? "open" : "closed"
      );
      setMessage(result.message);
    });
  }

  function changeLeadStage(leadId: string, stageId: string) {
    const nextStageId = stageId === "none" ? null : stageId;
    setLocalLeadStages((prev) => ({ ...prev, [leadId]: nextStageId }));
    startTransition(async () => {
      const result = await updateLeadStageAction(leadId, nextStageId ?? "");
      setMessage(result.message);
      if (result.ok) {
        router.refresh();
      } else {
        setLocalLeadStages((prev) => {
          const next = { ...prev };
          delete next[leadId];
          return next;
        });
      }
    });
  }

  function changeLeadSource(leadId: string, sourceId: string) {
    const nextSourceId = sourceId === "none" ? null : sourceId;
    setLocalLeadSources((prev) => ({ ...prev, [leadId]: nextSourceId }));
    startTransition(async () => {
      const result = await updateLeadSourceAction(leadId, nextSourceId ?? "");
      setMessage(result.message);
      if (result.ok) {
        router.refresh();
      } else {
        setLocalLeadSources((prev) => {
          const next = { ...prev };
          delete next[leadId];
          return next;
        });
      }
    });
  }

  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] overflow-hidden">
      <div className="flex w-72 shrink-0 flex-col border-r border-border bg-white">
        <div className="space-y-2 border-b border-border p-3">
          <div className="flex items-center justify-between">
            <p className="label-eyebrow">Inbox WhatsApp</p>
            <Button
              variant={filter === "unread" ? "outline" : "ghost"}
              size="icon-sm"
              onClick={() => setFilter((value) => (value === "unread" ? "all" : "unread"))}
            >
              <Filter className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Buscar conversa..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-7 w-full rounded-lg border border-border bg-background-subtle pl-7 pr-3 text-[11px] placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-green"
            />
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-background-subtle p-1">
            {[
              ["activity", "Ativas"],
              ["created", "Iniciadas"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => changeDateMode(value as "activity" | "created")}
                className={cn(
                  "rounded-md px-2 py-1 text-[10px] font-semibold transition-colors",
                  dateMode === value
                    ? "bg-white text-brand-green-deep shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-1">
            {[
              ["all", "Todas"],
              ["open", "Abertas"],
              ["closed", "Fechadas"],
              ["no_followup_48h", `48h+${noFollowupCount > 0 ? ` (${noFollowupCount})` : ""}`],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value as "all" | "open" | "closed" | "no_followup_48h")}
                className={cn(
                  "rounded-md px-2 py-1 text-[10px] font-semibold",
                  filter === value
                    ? value === "no_followup_48h"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-brand-green-soft text-brand-green-deep"
                    : "text-text-muted hover:bg-background-subtle"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {services.length > 0 && (
            <Select value={serviceFilter} onValueChange={setServiceFilter}>
              <SelectTrigger className="h-8 text-[11px]">
                <SelectValue placeholder="Todos os servicos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os servicos</SelectItem>
                {services.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <ScrollArea className="flex-1">
          {filteredConversations.length === 0 && (
            <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
              <Inbox className="mb-2 h-6 w-6 text-text-muted" />
              <p className="text-xs font-semibold text-text-secondary">Nenhuma conversa encontrada</p>
              <p className="mt-1 text-[11px] text-text-muted">As conversas aparecerao aqui quando a Evolution API gravar mensagens.</p>
            </div>
          )}
          {filteredConversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isActive={conversation.id === activeConv?.id}
              locallyRead={locallyReadIds.has(conversation.id)}
              onClick={() => setActiveConvId(conversation.id)}
            />
          ))}
        </ScrollArea>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2 rounded-lg bg-brand-green-soft px-3 py-2">
            <div
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                activeInstance?.status === "connected" ? "bg-brand-green" : "bg-warning-amber"
              )}
            />
            <div className="min-w-0 text-[10px]">
              <p className="truncate font-semibold text-brand-green-deep">{activeInstance?.instance_name ?? "Nenhuma instancia"}</p>
              <p className="text-brand-green-dark/60">{activeInstance?.phone_number ? formatPhone(activeInstance.phone_number) : "WhatsApp nao conectado"}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col bg-background-subtle">
        {activeConv ? (
          <>
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-white px-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-green-soft text-sm font-bold text-brand-green-deep">
                {getInitials(lead?.name ?? cleanJid(activeConv.remote_jid))}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold leading-none text-text-primary">
                  {lead?.name ?? "Contato sem lead vinculado"}
                </p>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  {formatPhone(cleanJid(activeConv.remote_jid))}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {lead?.status && (
                  <Badge variant="default" className="text-[10px]">
                    {STATUS_LABELS[lead.status] ?? lead.status}
                  </Badge>
                )}
                <Button variant="outline" size="sm" className="gap-1.5 border-green-500 text-green-700 hover:bg-green-50 hover:text-green-800 h-7 text-xs" asChild>
                  <a href={`https://web.whatsapp.com/send?phone=${cleanJid(activeConv.remote_jid).replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                    <MessageCircle className="h-3.5 w-3.5" />
                    WhatsApp Web
                  </a>
                </Button>
              </div>
            </div>

            {message && (
              <div className="border-b border-border bg-brand-green-soft px-4 py-2 text-xs font-medium text-brand-green-deep">
                {message}
              </div>
            )}

            <ScrollArea className="flex-1 p-4">
              <div className="space-y-2 pb-4">
                {messages.length === 0 && (
                  <div className="py-12 text-center text-xs text-text-muted">Nenhuma mensagem salva nesta conversa.</div>
                )}
                {messages.map((item) => (
                  <MessageBubble key={item.id} message={item} />
                ))}
              </div>
            </ScrollArea>

            <div className="border-t border-border bg-white p-3">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background-subtle px-3 py-2">
                <p className="flex-1 text-xs text-text-muted">
                  Envio de mensagens sera habilitado quando a Evolution API estiver conectada para envio.
                </p>
                <Button size="sm" disabled className="h-7 text-xs">
                  Enviar
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <Inbox className="mb-3 h-8 w-8 text-text-muted" />
            <p className="text-sm font-semibold text-text-secondary">Inbox vazio</p>
            <p className="mt-1 max-w-sm text-xs text-text-muted">Conecte uma instancia da Evolution API para receber conversas reais aqui.</p>
          </div>
        )}
      </div>

      <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-border bg-white">
        <div className="border-b border-border p-4">
          <p className="label-eyebrow">Ficha do Lead</p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {lead ? (
            <>
              <div className="flex flex-col items-center gap-2 pt-2 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-green-soft text-base font-bold text-brand-green-deep">
                  {getInitials(lead.name)}
                </div>
                <div>
                  <p className="text-sm font-bold text-text-primary">{lead.name}</p>
                  {lead.procedure && <p className="text-[11px] text-text-muted">{lead.procedure}</p>}
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <Info icon={<User />} label="Status" value={STATUS_LABELS[lead.status] ?? lead.status} />
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    <ChevronDown className="h-3.5 w-3.5 rotate-270" />
                    <span className="font-semibold uppercase tracking-wide">Etapa do funil</span>
                  </div>
                  <Select
                    key={lead.id}
                    value={leadStageValue}
                    onValueChange={(stageId) => changeLeadStage(lead.id, stageId)}
                    disabled={isPending}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem etapa</SelectItem>
                      {stages.map((stage) => (
                        <SelectItem key={stage.id} value={stage.id}>
                          {stage.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {lead.service?.name && <Info icon={<Tag />} label="Servico" value={lead.service.name} />}
                {lead.appointment_scheduled_at && (
                  <Info
                    icon={<Clock />}
                    label="Consulta agendada"
                    value={formatDateTime(lead.appointment_scheduled_at)}
                  />
                )}
                {(lead.detected_city || lead.detected_state || lead.phone_ddd) && (
                  <Info
                    icon={<MapPin />}
                    label="Localizacao"
                    value={[
                      [lead.detected_city, lead.detected_state].filter(Boolean).join(" / "),
                      lead.phone_ddd ? `DDD ${lead.phone_ddd}` : null,
                      LOCATION_STATUS_LABELS[lead.service_area_status] ?? null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                )}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    <ChevronDown className="h-3.5 w-3.5 rotate-270" />
                    <span className="font-semibold uppercase tracking-wide">Origem</span>
                  </div>
                  <Select
                    key={lead.id}
                    value={leadSourceValue}
                    onValueChange={(sourceId) => changeLeadSource(lead.id, sourceId)}
                    disabled={isPending}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem origem</SelectItem>
                      {sources
                        .filter((source) => source.active !== false || source.id === lead.source_id)
                        .map((source) => (
                          <SelectItem key={source.id} value={source.id}>
                            {source.name}{source.active === false ? " (inativa)" : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {lead.potential_value && (
                <div className="rounded-lg bg-brand-green-soft p-3">
                  <div className="mb-1 flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-brand-green-dark" />
                    <p className="label-eyebrow text-brand-green-dark">Potencial</p>
                  </div>
                  <p className="text-base font-black text-brand-green-deep">{formatCurrency(lead.potential_value)}</p>
                </div>
              )}

              <div className="space-y-2 pt-2">
                <Button size="sm" className="w-full gap-1.5 text-xs border-green-500 text-green-700 hover:bg-green-50 hover:text-green-800" variant="outline" asChild>
                  <a href={`https://web.whatsapp.com/send?phone=${cleanJid(activeConv?.remote_jid ?? "").replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                    <MessageCircle className="h-3.5 w-3.5" />
                    Abrir no WhatsApp Web
                  </a>
                </Button>
                <AppointmentScheduler
                  leadId={lead.id}
                  appointmentScheduledAt={lead.appointment_scheduled_at}
                  className="w-full gap-1.5 text-xs"
                  onResult={(resultMessage) => setMessage(resultMessage)}
                  onSuccess={() => router.refresh()}
                />
                <Button size="sm" className="w-full text-xs" variant="secondary" asChild>
                  <Link href={`/leads/${lead.id}`}>Ver ficha completa</Link>
                </Button>
                <Button size="sm" className="w-full text-xs" variant="outline" onClick={toggleClosed} disabled={isPending}>
                  {activeConv?.status === "closed" ? "Reabrir conversa" : "Fechar conversa"}
                </Button>
                {lead.followup_paused && (
                  <div className="flex items-center gap-1.5 rounded-lg bg-yellow-50 px-2.5 py-2 text-[10px] font-semibold text-yellow-700">
                    <Clock className="h-3 w-3 shrink-0" />
                    Follow-up pausado
                  </div>
                )}
                {(() => {
                  const bhItem = activeConv ? bhAutoRepliesByConversation[activeConv.id] : null;
                  if (!bhItem || cancelledBhIds.has(bhItem.id)) return null;
                  const scheduledTime = new Date(bhItem.scheduled_for).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  return (
                    <div className="flex items-start gap-1.5 rounded-lg border border-warning-amber/30 bg-warning-amber/10 px-2.5 py-2 text-[10px]">
                      <Clock className="mt-0.5 h-3 w-3 shrink-0 text-warning-amber" />
                      <span className="flex-1 font-semibold text-warning-amber">
                        Resposta automatica agendada para {scheduledTime}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-warning-amber hover:text-danger-red"
                        title="Cancelar resposta automatica"
                        onClick={() => {
                          startTransition(async () => {
                            const result = await cancelBhAutoReplyAction(bhItem.id);
                            if (result.ok) {
                              setCancelledBhIds((prev) => new Set([...prev, bhItem.id]));
                            }
                            setMessage(result.message);
                          });
                        }}
                        disabled={isPending}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })()}
              </div>
            </>
          ) : (
            <p className="pt-8 text-center text-xs text-text-muted">Nenhum lead vinculado a esta conversa</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Info({ icon, label, value }: { icon: React.ReactElement; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-text-muted [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
      <div>
        <p className="label-eyebrow">{label}</p>
        <p className="text-xs text-text-secondary">{value}</p>
      </div>
    </div>
  );
}
