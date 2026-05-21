"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarCheck,
  CheckCheck,
  ChevronDown,
  DollarSign,
  FileText,
  Filter,
  ImageIcon,
  Inbox,
  MessageCircle,
  Mic,
  Phone,
  Search,
  Tag,
  User,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";
import { cn, formatCurrency, formatDateTime, formatPhone, formatTimeAgo, getInitials } from "@/lib/utils";
import { markConversationReadAction, updateConversationStatusAction } from "./actions";
import type { InboxConversation, InboxMessage } from "./types";

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

const MEDIA_LABELS: Record<string, string> = {
  image: "Imagem",
  audio: "Audio",
  video: "Video",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localizacao",
};

type InboxClientProps = {
  organizationId: string;
  conversations: InboxConversation[];
  messagesByConversation: Record<string, InboxMessage[]>;
  instances: { id: string; instance_name: string; phone_number: string | null; status: string }[];
  initialSearch: string;
  period: string;
};

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function periodStart(period: string) {
  const now = new Date();
  if (period === "today") return startOfDay(now);
  if (period === "7d") {
    const start = startOfDay(now);
    start.setDate(start.getDate() - 6);
    return start;
  }
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  const start = startOfDay(now);
  start.setDate(start.getDate() - 29);
  return start;
}

function cleanJid(remoteJid: string) {
  return remoteJid.replace("@s.whatsapp.net", "").replace("@c.us", "");
}

function MessageTypeIcon({ type }: { type: string }) {
  const cls = "h-3 w-3";
  if (type === "image") return <ImageIcon className={cls} />;
  if (type === "audio") return <Mic className={cls} />;
  if (type === "video") return <Video className={cls} />;
  if (type === "document") return <FileText className={cls} />;
  return <MessageCircle className={cls} />;
}

function lastMessagePreview(message: InboxMessage | null) {
  if (!message) return "Conversa iniciada";
  if (message.message_type !== "text") return MEDIA_LABELS[message.message_type] ?? message.message_type;
  return message.content ?? "Mensagem";
}

function MessageBubble({ message }: { message: InboxMessage }) {
  const isSent = message.direction === "outbound";
  return (
    <div className={cn("flex", isSent ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] px-3 py-2 text-xs leading-relaxed",
          isSent ? "bubble-sent text-text-primary" : "bubble-received text-text-primary"
        )}
      >
        {message.message_type !== "text" && (
          <div className="mb-1 flex items-center gap-1.5 text-text-muted">
            <MessageTypeIcon type={message.message_type} />
            {message.media_url ? (
              <a href={message.media_url} target="_blank" rel="noreferrer" className="font-medium text-brand-green-dark hover:underline">
                {MEDIA_LABELS[message.message_type] ?? message.message_type}
              </a>
            ) : (
              <span>{MEDIA_LABELS[message.message_type] ?? message.message_type}</span>
            )}
          </div>
        )}
        {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
        {message.media_filename && <p className="mt-1 text-[11px] text-text-muted">{message.media_filename}</p>}
        <div
          className={cn(
            "mt-1 flex items-center gap-1 text-[10px]",
            isSent ? "justify-end text-brand-green-deep/60" : "text-text-muted"
          )}
        >
          <span>{formatDateTime(message.created_at).split(", ")[1] ?? formatDateTime(message.created_at)}</span>
          {isSent && <CheckCheck className="h-2.5 w-2.5 text-brand-green" />}
        </div>
      </div>
    </div>
  );
}

function ConversationItem({
  conversation,
  isActive,
  onClick,
}: {
  conversation: InboxConversation;
  isActive: boolean;
  onClick: () => void;
}) {
  const lead = conversation.lead;
  const title = lead?.name ?? formatPhone(cleanJid(conversation.remote_jid));

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
        {conversation.unread_count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-green px-1 text-[9px] font-bold text-white">
            {conversation.unread_count}
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

export function InboxClient({ organizationId, conversations, messagesByConversation, instances, initialSearch, period }: InboxClientProps) {
  const router = useRouter();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeConvId, setActiveConvId] = useState(conversations[0]?.id ?? "");
  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<"all" | "unread" | "open" | "closed">("all");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredConversations = useMemo(() => {
    const term = search.toLowerCase().trim();
    const start = periodStart(period);
    return conversations.filter((conversation) => {
      const lead = conversation.lead;
      const haystack = [
        lead?.name,
        lead?.phone,
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
        conversation.status === filter;
      const matchesPeriod = new Date(conversation.updated_at).getTime() >= start.getTime();
      return matchesSearch && matchesFilter && matchesPeriod;
    });
  }, [conversations, filter, period, search]);

  const activeConv =
    filteredConversations.find((conversation) => conversation.id === activeConvId) ??
    filteredConversations[0] ??
    null;
  const messages = activeConv ? messagesByConversation[activeConv.id] ?? [] : [];
  const lead = activeConv?.lead ?? null;
  const activeInstance = activeConv?.instance ?? instances[0] ?? null;
  const conversationIdsKey = useMemo(
    () => conversations.map((conversation) => conversation.id).sort().join(","),
    [conversations]
  );

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

  function markRead() {
    if (!activeConv) return;
    startTransition(async () => {
      const result = await markConversationReadAction(activeConv.id);
      setMessage(result.message);
    });
  }

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
          <div className="grid grid-cols-3 gap-1">
            {[
              ["all", "Todas"],
              ["open", "Abertas"],
              ["closed", "Fechadas"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value as "all" | "open" | "closed")}
                className={cn(
                  "rounded-md px-2 py-1 text-[10px] font-semibold",
                  filter === value ? "bg-brand-green-soft text-brand-green-deep" : "text-text-muted hover:bg-background-subtle"
                )}
              >
                {label}
              </button>
            ))}
          </div>
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
                <Button variant="secondary" size="sm" onClick={markRead} disabled={isPending || activeConv.unread_count === 0}>
                  Marcar lida
                </Button>
                <Button variant="ghost" size="icon-sm" asChild>
                  <a href={`https://wa.me/${cleanJid(activeConv.remote_jid)}`} target="_blank" rel="noreferrer">
                    <Phone className="h-3.5 w-3.5" />
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
                {lead.stage?.name && <Info icon={<Tag />} label="Etapa" value={lead.stage.name} />}
                {lead.source?.name && <Info icon={<ChevronDown className="rotate-270" />} label="Origem" value={lead.source.name} />}
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
                <Button size="sm" className="w-full gap-1.5 text-xs" variant="default" disabled>
                  <CalendarCheck className="h-3.5 w-3.5" />
                  Agendar Consulta
                </Button>
                <Button size="sm" className="w-full text-xs" variant="secondary" asChild>
                  <Link href={`/leads/${lead.id}`}>Ver ficha completa</Link>
                </Button>
                <Button size="sm" className="w-full text-xs" variant="outline" onClick={toggleClosed} disabled={isPending}>
                  {activeConv?.status === "closed" ? "Reabrir conversa" : "Fechar conversa"}
                </Button>
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
