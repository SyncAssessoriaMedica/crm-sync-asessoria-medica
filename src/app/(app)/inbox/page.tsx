"use client";

import { useState } from "react";
import {
  Search,
  Filter,
  Phone,
  Check,
  CheckCheck,
  Image,
  Mic,
  Video,
  FileText,
  ChevronDown,
  Tag,
  User,
  CalendarCheck,
  DollarSign,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { mockConversations, mockMessages } from "@/lib/mock-data/conversations";
import type { Conversation, Message } from "@/lib/types";
import { formatTimeAgo, formatDateTime, formatPhone, getInitials } from "@/lib/utils";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  new: "Novo",
  contacted: "Contactado",
  qualified: "Qualificado",
  scheduled: "Agendado",
  attended: "Compareceu",
  closed_won: "Fechado",
  closed_lost: "Perdido",
};

function MessageTypeIcon({ type }: { type: string }) {
  const cls = "h-3 w-3";
  if (type === "image") return <Image className={cls} />;
  if (type === "audio") return <Mic className={cls} />;
  if (type === "video") return <Video className={cls} />;
  if (type === "document") return <FileText className={cls} />;
  return null;
}

function MessageBubble({ message }: { message: Message }) {
  const isSent = message.direction === "outbound";
  return (
    <div className={cn("flex", isSent ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] px-3 py-2 text-xs leading-relaxed",
          isSent
            ? "bubble-sent text-text-primary"
            : "bubble-received text-text-primary"
        )}
      >
        {message.message_type !== "text" && (
          <div className="mb-1 flex items-center gap-1.5 text-text-muted">
            <MessageTypeIcon type={message.message_type} />
            <span className="capitalize">{message.message_type}</span>
          </div>
        )}
        {message.content && (
          <p className="whitespace-pre-wrap">{message.content}</p>
        )}
        <div
          className={cn(
            "mt-1 flex items-center gap-1 text-[10px]",
            isSent ? "justify-end text-brand-green-deep/60" : "text-text-muted"
          )}
        >
          <span>{formatDateTime(message.created_at).split(" ")[1]}</span>
          {isSent && (
            <CheckCheck className="h-2.5 w-2.5 text-brand-green" />
          )}
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
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
}) {
  const messages = mockMessages[conversation.id] ?? [];
  const lastMsg = messages[messages.length - 1];
  const lead = conversation.lead;

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors border-b border-border",
        isActive ? "bg-brand-green-soft" : "hover:bg-background-subtle"
      )}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-green-soft text-sm font-bold text-brand-green-deep border border-brand-green/20">
          {getInitials(lead?.name ?? "?")}
        </div>
        {conversation.unread_count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-green text-[9px] font-bold text-white">
            {conversation.unread_count}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-text-primary truncate">
            {lead?.name ?? formatPhone(conversation.remote_jid)}
          </p>
          <p className="text-[10px] text-text-muted shrink-0 ml-1">
            {lastMsg
              ? formatTimeAgo(lastMsg.created_at)
              : formatTimeAgo(conversation.created_at)}
          </p>
        </div>
        {lead?.procedure && (
          <p className="text-[10px] text-brand-green-dark font-medium">
            {lead.procedure}
          </p>
        )}
        <p className="text-[11px] text-text-muted truncate mt-0.5">
          {lastMsg?.content ?? "Conversa iniciada"}
        </p>
      </div>
    </button>
  );
}

export default function InboxPage() {
  const [activeConvId, setActiveConvId] = useState<string>(
    mockConversations[0].id
  );

  const activeConv = mockConversations.find((c) => c.id === activeConvId)!;
  const messages = mockMessages[activeConvId] ?? [];
  const lead = activeConv.lead;

  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Column 1 — conversation list */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border bg-white">
        {/* Search + filter */}
        <div className="border-b border-border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="label-eyebrow">Inbox WhatsApp</p>
            <Button variant="ghost" size="icon-sm">
              <Filter className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Buscar conversa..."
              className="h-7 w-full rounded-lg border border-border bg-background-subtle pl-7 pr-3 text-[11px] placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-green"
            />
          </div>
        </div>

        {/* List */}
        <ScrollArea className="flex-1">
          {mockConversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={conv.id === activeConvId}
              onClick={() => setActiveConvId(conv.id)}
            />
          ))}
        </ScrollArea>

        {/* Instance badge */}
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2 rounded-lg bg-brand-green-soft px-3 py-2">
            <div className="h-1.5 w-1.5 rounded-full bg-brand-green animate-pulse" />
            <div className="text-[10px]">
              <p className="font-semibold text-brand-green-deep">
                clinica-sp-principal
              </p>
              <p className="text-brand-green-dark/60">(11) 9 3333-4444</p>
            </div>
          </div>
        </div>
      </div>

      {/* Column 2 — chat */}
      <div className="flex flex-1 flex-col bg-background-subtle">
        {/* Chat header */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-white px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-green-soft text-sm font-bold text-brand-green-deep">
            {getInitials(lead?.name ?? "?")}
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-text-primary leading-none">
              {lead?.name ?? "Desconhecido"}
            </p>
            <p className="text-[11px] text-text-muted mt-0.5">
              {formatPhone(activeConv.remote_jid.replace("@s.whatsapp.net", ""))}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lead?.status && (
              <Badge variant="default" className="text-[10px]">
                {STATUS_LABELS[lead.status]}
              </Badge>
            )}
            <Button variant="ghost" size="icon-sm">
              <Phone className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-2 pb-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        </ScrollArea>

        {/* Compose — disabled in MVP (audit only) */}
        <div className="border-t border-border bg-white p-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background-subtle px-3 py-2">
            <p className="flex-1 text-xs text-text-muted">
              Envio de mensagens disponível na Fase 2 (Evolution API)
            </p>
            <Button size="sm" disabled className="text-xs h-7">
              Enviar
            </Button>
          </div>
        </div>
      </div>

      {/* Column 3 — lead panel */}
      <div className="w-64 shrink-0 flex flex-col border-l border-border bg-white overflow-y-auto">
        <div className="border-b border-border p-4">
          <p className="label-eyebrow">Ficha do Lead</p>
        </div>

        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          {lead ? (
            <>
              {/* Avatar + name */}
              <div className="flex flex-col items-center text-center gap-2 pt-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-green-soft text-base font-bold text-brand-green-deep">
                  {getInitials(lead.name)}
                </div>
                <div>
                  <p className="text-sm font-bold text-text-primary">
                    {lead.name}
                  </p>
                  {lead.procedure && (
                    <p className="text-[11px] text-text-muted">{lead.procedure}</p>
                  )}
                </div>
              </div>

              <Separator />

              {/* Details */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 text-text-muted shrink-0" />
                  <div>
                    <p className="label-eyebrow">Status</p>
                    <p className="text-xs text-text-secondary">
                      {STATUS_LABELS[lead.status] ?? lead.status}
                    </p>
                  </div>
                </div>

                {lead.stage && (
                  <div className="flex items-center gap-2">
                    <Tag className="h-3.5 w-3.5 text-text-muted shrink-0" />
                    <div>
                      <p className="label-eyebrow">Etapa</p>
                      <p className="text-xs text-text-secondary">
                        {lead.stage.name}
                      </p>
                    </div>
                  </div>
                )}

                {lead.source && (
                  <div className="flex items-center gap-2">
                    <ChevronDown className="h-3.5 w-3.5 text-text-muted shrink-0 rotate-270" />
                    <div>
                      <p className="label-eyebrow">Origem</p>
                      <p className="text-xs text-text-secondary">
                        {lead.source.name}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              {/* Value */}
              {lead.potential_value && (
                <div className="rounded-lg bg-brand-green-soft p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <DollarSign className="h-3.5 w-3.5 text-brand-green-dark" />
                    <p className="label-eyebrow text-brand-green-dark">
                      Potencial
                    </p>
                  </div>
                  <p className="text-base font-black text-brand-green-deep">
                    R$ {lead.potential_value.toLocaleString("pt-BR")}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2 pt-2">
                <Button
                  size="sm"
                  className="w-full text-xs gap-1.5"
                  variant="default"
                >
                  <CalendarCheck className="h-3.5 w-3.5" />
                  Agendar Consulta
                </Button>
                <Button
                  size="sm"
                  className="w-full text-xs"
                  variant="secondary"
                  asChild
                >
                  <a href={`/leads/${lead.id}`}>Ver ficha completa →</a>
                </Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-text-muted text-center pt-8">
              Nenhum lead vinculado a esta conversa
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
