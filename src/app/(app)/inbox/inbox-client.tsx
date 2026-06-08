"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ChevronDown,
  Clock,
  DollarSign,
  FileText,
  Filter,
  ImageIcon,
  Inbox,
  MapPin,
  MessageCircle,
  Mic,
  Paperclip,
  Search,
  Send,
  Smile,
  Tag,
  User,
  Video,
  X,
} from "lucide-react";
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
import {
  cancelBhAutoReplyAction,
  markConversationReadAction,
  retryInboxMessageAction,
  sendInboxMessageAction,
  updateConversationStatusAction,
} from "./actions";
import { updateLeadSourceAction, updateLeadStageAction } from "../leads/actions";
import { MessageBubble } from "./message-media";
import type {
  BhAutoReplyQueueItem,
  InboxConversation,
  InboxMessage,
  InboxService,
  InboxSource,
  InboxStage,
} from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

type AttachmentType = "image" | "audio" | "video" | "document" | "sticker";

type ComposerAttachment = {
  type: AttachmentType;
  file: File;
  localUrl: string;
  uploadedUrl?: string;
  mimetype: string;
  filename: string;
  size: number;
  uploadStatus: "uploading" | "uploaded" | "failed";
  error?: string;
};

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanJid(remoteJid: string) {
  return remoteJid.replace("@s.whatsapp.net", "").replace("@c.us", "");
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
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

function mergeMessages(
  serverMessages: InboxMessage[],
  optimisticMessages: InboxMessage[],
  statusOverrides: Record<string, { send_status: InboxMessage["send_status"]; send_error: string | null }>
): InboxMessage[] {
  // Server messages whose client_message_id we already have — don't duplicate optimistic
  const serverClientIds = new Set(serverMessages.map((m) => m.client_message_id).filter(Boolean) as string[]);

  const result: InboxMessage[] = serverMessages.map((m) => {
    const override = statusOverrides[m.id];
    return override ? { ...m, ...override } : m;
  });

  // Only include optimistic messages not yet confirmed by server
  for (const opt of optimisticMessages) {
    if (!opt.client_message_id || !serverClientIds.has(opt.client_message_id)) {
      const override = statusOverrides[opt.id];
      result.push(override ? { ...opt, ...override } : opt);
    }
  }

  result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return result;
}

const ACCEPT_BY_TYPE: Record<AttachmentType, string> = {
  image: "image/jpeg,image/png,image/webp",
  audio: "audio/ogg,audio/mpeg,audio/mp3,audio/wav,audio/webm,audio/mp4,audio/x-m4a",
  video: "video/mp4,video/webm,video/3gpp,video/quicktime",
  document:
    "application/pdf,text/plain,text/csv,application/zip,application/msword," +
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
    "application/vnd.ms-excel," +
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  sticker: "image/webp",
};

// ─── ConversationItem ─────────────────────────────────────────────────────────

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

// ─── AttachmentPreview ────────────────────────────────────────────────────────

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: ComposerAttachment;
  onRemove: () => void;
}) {
  const isUploading = attachment.uploadStatus === "uploading";
  const isFailed = attachment.uploadStatus === "failed";

  return (
    <div className="relative mb-2 rounded-lg border border-border bg-background-subtle p-2">
      <button
        type="button"
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-text-muted text-white hover:bg-danger-red"
        aria-label="Remover anexo"
      >
        <X className="h-2.5 w-2.5" />
      </button>

      {attachment.type === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.localUrl}
          alt="Preview"
          className="max-h-28 max-w-full rounded object-contain"
        />
      )}
      {attachment.type === "sticker" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.localUrl}
          alt="Figurinha"
          className="h-20 w-20 object-contain"
        />
      )}
      {attachment.type === "audio" && (
        <div className="flex items-center gap-2">
          <Mic className="h-4 w-4 shrink-0 text-brand-green-dark" />
          <span className="truncate text-xs font-medium text-text-secondary">{attachment.filename}</span>
        </div>
      )}
      {attachment.type === "video" && (
        <div className="flex items-center gap-2">
          <Video className="h-4 w-4 shrink-0 text-brand-green-dark" />
          <span className="truncate text-xs font-medium text-text-secondary">{attachment.filename}</span>
        </div>
      )}
      {attachment.type === "document" && (
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-brand-green-dark" />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-text-secondary">{attachment.filename}</p>
            <p className="text-[10px] text-text-muted">{(attachment.size / 1024).toFixed(0)} KB</p>
          </div>
        </div>
      )}

      {isUploading && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-text-muted">
          <span className="inline-block h-2 w-2 animate-spin rounded-full border border-brand-green border-t-transparent" />
          Enviando arquivo...
        </div>
      )}
      {isFailed && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-danger-red">
          <AlertCircle className="h-3 w-3" />
          {attachment.error ?? "Falha no upload"}
        </div>
      )}
    </div>
  );
}

// ─── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  activeConvId,
  isConnected,
  onOptimisticAdd,
  onOptimisticUpdate,
}: {
  activeConvId: string;
  isConnected: boolean;
  onOptimisticAdd: (message: InboxMessage) => void;
  onOptimisticUpdate: (clientMessageId: string, patch: Partial<InboxMessage>) => void;
}) {
  const [draftText, setDraftText] = useState("");
  const [attachment, setAttachment] = useState<ComposerAttachment | null>(null);
  const [sending, setSending] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachTypeRef = useRef<AttachmentType>("image");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const attachmentUrlRef = useRef<string | null>(null);

  useEffect(() => {
    attachmentUrlRef.current = attachment?.localUrl ?? null;
  }, [attachment?.localUrl]);

  // Cleanup the currently selected preview when the composer unmounts.
  useEffect(() => {
    return () => {
      if (attachmentUrlRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(attachmentUrlRef.current);
      }
    };
  }, []);

  // Close attach menu on outside click
  useEffect(() => {
    if (!attachMenuOpen) return;
    function handleOutside(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [attachMenuOpen]);

  function openFilePicker(type: AttachmentType) {
    attachTypeRef.current = type;
    setAttachMenuOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.accept = ACCEPT_BY_TYPE[type];
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const type = attachTypeRef.current;
    const localUrl = URL.createObjectURL(file);
    if (attachment?.localUrl.startsWith("blob:")) URL.revokeObjectURL(attachment.localUrl);
    const newAttachment: ComposerAttachment = {
      type,
      file,
      localUrl,
      mimetype: file.type || "application/octet-stream",
      filename: file.name,
      size: file.size,
      uploadStatus: "uploading",
    };
    setAttachment(newAttachment);

    // Upload immediately
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("type", type);
      const res = await fetch("/api/inbox/upload-media", { method: "POST", body: form });
      const json = (await res.json()) as { ok: boolean; url?: string; mimetype?: string; filename?: string; error?: string };

      if (!json.ok || !json.url) {
        setAttachment((prev) =>
          prev?.localUrl === localUrl
            ? { ...prev, uploadStatus: "failed", error: json.error ?? "Falha no upload" }
            : prev
        );
      } else {
        setAttachment((prev) =>
          prev?.localUrl === localUrl
            ? {
                ...prev,
                uploadStatus: "uploaded",
                uploadedUrl: json.url,
                mimetype: json.mimetype ?? prev.mimetype,
                filename: json.filename ?? prev.filename,
              }
            : prev
        );
      }
    } catch {
      setAttachment((prev) =>
        prev?.localUrl === localUrl
          ? { ...prev, uploadStatus: "failed", error: "Erro de rede no upload" }
          : prev
      );
    }
  }

  function removeAttachment() {
    if (attachment?.localUrl.startsWith("blob:")) URL.revokeObjectURL(attachment.localUrl);
    setAttachment(null);
  }

  const canSend =
    isConnected &&
    !sending &&
    (!attachment || attachment.uploadStatus === "uploaded") &&
    (draftText.trim().length > 0 || attachment !== null);

  async function handleSend() {
    if (!canSend) return;

    const clientMessageId = crypto.randomUUID();
    const now = new Date().toISOString();
    const trimmedText = draftText.trim();
    const hasAttachment = attachment && attachment.uploadStatus === "uploaded";
    const sentLocalUrl = hasAttachment ? attachment.localUrl : null;

    const messageType = hasAttachment ? attachment.type : "text";

    // Build optimistic message with a temporary ID
    const optimistic: InboxMessage = {
      id: `opt-${clientMessageId}`,
      conversation_id: activeConvId,
      direction: "outbound",
      message_type: messageType as InboxMessage["message_type"],
      content: trimmedText || null,
      media_url: hasAttachment ? attachment.localUrl : null,
      media_mimetype: hasAttachment ? attachment.mimetype : null,
      media_filename: hasAttachment ? attachment.filename : null,
      media_duration: null,
      created_at: now,
      delivered_at: null,
      read_at: null,
      send_status: "sending",
      send_error: null,
      client_message_id: clientMessageId,
      media_status: null,
      media_error: null,
      media_attempts: null,
    };

    onOptimisticAdd(optimistic);

    // Clear composer
    setDraftText("");
    setAttachment(null);
    setSending(true);

    const result = await sendInboxMessageAction({
      conversationId: activeConvId,
      clientMessageId,
      messageType: messageType as "text" | "image" | "audio" | "video" | "document" | "sticker",
      text: trimmedText || null,
      mediaUrl: hasAttachment ? attachment.uploadedUrl : null,
      mediaMimetype: hasAttachment ? attachment.mimetype : null,
      mediaFilename: hasAttachment ? attachment.filename : null,
      mediaDuration: null,
    });

    setSending(false);

    if (result.data) {
      onOptimisticUpdate(clientMessageId, {
        id: result.data.id,
        send_status: result.data.send_status,
        send_error: result.data.send_error,
        media_url: result.data.media_url,
      });
      if (sentLocalUrl?.startsWith("blob:")) URL.revokeObjectURL(sentLocalUrl);
    } else {
      onOptimisticUpdate(clientMessageId, {
        send_status: "failed",
        send_error: result.message,
      });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const disabledReason = !isConnected
    ? "WhatsApp desconectado"
    : attachment?.uploadStatus === "uploading"
    ? "Aguardando upload..."
    : attachment?.uploadStatus === "failed"
    ? "Falha no upload do arquivo"
    : sending
    ? "Enviando..."
    : null;

  return (
    <div className="border-t border-border bg-white px-3 pb-3 pt-2">
      {attachment && (
        <AttachmentPreview attachment={attachment} onRemove={removeAttachment} />
      )}

      {!isConnected && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-warning-amber/10 px-3 py-2 text-[11px] font-medium text-warning-amber">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          WhatsApp desconectado — reconecte a instância para enviar mensagens.
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Attach button */}
        <div className="relative" ref={attachMenuRef}>
          <button
            type="button"
            onClick={() => setAttachMenuOpen((v) => !v)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-text-muted hover:bg-background-subtle hover:text-text-secondary"
            aria-label="Anexar arquivo"
            disabled={!isConnected}
          >
            <Paperclip className="h-4 w-4" />
          </button>

          {attachMenuOpen && (
            <div className="absolute bottom-10 left-0 z-20 flex flex-col overflow-hidden rounded-xl border border-border bg-white shadow-lg">
              {(
                [
                  ["image", ImageIcon, "Imagem"],
                  ["audio", Mic, "Áudio"],
                  ["video", Video, "Vídeo"],
                  ["document", FileText, "Documento"],
                  ["sticker", Smile, "Figurinha"],
                ] as const
              ).map(([type, Icon, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => openFilePicker(type)}
                  className="flex items-center gap-2 px-4 py-2 text-left text-xs hover:bg-background-subtle"
                >
                  <Icon className="h-3.5 w-3.5 text-brand-green-dark" />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConnected ? "Escreva uma mensagem... (Enter envia)" : "WhatsApp desconectado"}
          disabled={!isConnected || sending}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-lg border border-border bg-background-subtle px-3 py-2 text-xs leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-green",
            "min-h-[2rem] max-h-28 overflow-y-auto",
            (!isConnected || sending) && "opacity-60 cursor-not-allowed"
          )}
          style={{ height: "auto" }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
          }}
        />

        {/* Send button */}
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!canSend}
          title={disabledReason ?? "Enviar"}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
            canSend
              ? "bg-brand-green text-white hover:bg-brand-green-dark"
              : "bg-border text-text-muted cursor-not-allowed"
          )}
          aria-label="Enviar"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

// ─── InboxClient ──────────────────────────────────────────────────────────────

export function InboxClient({
  organizationId,
  conversations,
  messagesByConversation,
  bhAutoRepliesByConversation,
  instances,
  sources,
  services,
  stages,
  initialSearch,
  initialActiveConversationId,
  dateMode,
}: InboxClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markedReadRef = useRef<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevConvIdRef = useRef<string>("");

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

  // Optimistic messages (per conversation)
  const [optimisticMessages, setOptimisticMessages] = useState<InboxMessage[]>([]);
  // Status overrides for retry tracking (keyed by message id OR optimistic id)
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, { send_status: InboxMessage["send_status"]; send_error: string | null }>
  >({});

  const filteredConversations = useMemo(() => {
    const term = search.toLowerCase().trim();
    const termDigits = onlyDigits(term);
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
      const digitHaystack = [
        lead?.phone,
        conversation.remote_jid,
      ]
        .filter(Boolean)
        .map((value) => onlyDigits(String(value)))
        .join(" ");
      const matchesSearch =
        term === "" ||
        haystack.includes(term) ||
        (termDigits.length >= 4 && digitHaystack.includes(termDigits));
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
    filteredConversations.find((c) => c.id === activeConvId) ??
    filteredConversations[0] ??
    null;

  const serverMessages = useMemo(
    () => (activeConv ? messagesByConversation[activeConv.id] ?? [] : []),
    [activeConv, messagesByConversation]
  );
  const activeOptimistic = useMemo(
    () => optimisticMessages.filter((m) => m.conversation_id === activeConv?.id),
    [optimisticMessages, activeConv?.id]
  );
  const visibleMessages = useMemo(
    () => mergeMessages(serverMessages, activeOptimistic, statusOverrides),
    [serverMessages, activeOptimistic, statusOverrides]
  );

  const lead = activeConv?.lead ?? null;
  const leadSourceValue = lead
    ? (localLeadSources[lead.id] !== undefined ? localLeadSources[lead.id] : lead.source_id) ?? "none"
    : "none";
  const leadStageValue = lead
    ? (localLeadStages[lead.id] !== undefined ? localLeadStages[lead.id] : lead.stage_id) ?? "none"
    : "none";
  const activeInstance = activeConv?.instance ?? instances[0] ?? null;
  const isConnected = activeInstance?.status === "connected";
  const noFollowupCount = useMemo(
    () => conversations.filter((c) => needsFollowup48h(c)).length,
    [conversations]
  );
  const conversationIdsKey = useMemo(
    () => conversations.map((c) => c.id).sort().join(","),
    [conversations]
  );

  // Auto-scroll to bottom when messages change or conversation switches
  useEffect(() => {
    if (!messagesEndRef.current) return;
    const behavior = prevConvIdRef.current === (activeConv?.id ?? "") ? "smooth" : "instant";
    prevConvIdRef.current = activeConv?.id ?? "";
    messagesEndRef.current.scrollIntoView({ behavior, block: "end" });
  }, [activeConv?.id, visibleMessages.length]);

  // Realtime + periodic refresh
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
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `organization_id=eq.${organizationId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        const nextConversationId =
          (payload.new as { conversation_id?: string } | null)?.conversation_id ??
          (payload.old as { conversation_id?: string } | null)?.conversation_id;
        if (!nextConversationId || conversationIds.has(nextConversationId)) scheduleRefresh();
      })
      .subscribe();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 60000);

    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      if (refreshTimerRef.current) { clearTimeout(refreshTimerRef.current); refreshTimerRef.current = null; }
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [conversationIdsKey, organizationId, router]);

  // Auto-mark as read
  useEffect(() => {
    if (!activeConv) return;
    if (activeConv.unread_count === 0) { markedReadRef.current.delete(activeConv.id); return; }
    if (markedReadRef.current.has(activeConv.id)) return;
    markedReadRef.current.add(activeConv.id);
    setLocallyReadIds((prev) => new Set([...prev, activeConv.id]));
    void markConversationReadAction(activeConv.id);
  }, [activeConv?.id, activeConv?.unread_count]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeDateMode(nextMode: "activity" | "created") {
    const params = new URLSearchParams(searchParams.toString());
    if (nextMode === "activity") { params.delete("dateMode"); } else { params.set("dateMode", nextMode); }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function selectConversation(conversationId: string) {
    setActiveConvId(conversationId);
    const params = new URLSearchParams(searchParams.toString());
    params.set("conversation", conversationId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function toggleClosed() {
    if (!activeConv) return;
    startTransition(async () => {
      const result = await updateConversationStatusAction(activeConv.id, activeConv.status === "closed" ? "open" : "closed");
      setMessage(result.message);
    });
  }

  function changeLeadStage(leadId: string, stageId: string) {
    const nextStageId = stageId === "none" ? null : stageId;
    setLocalLeadStages((prev) => ({ ...prev, [leadId]: nextStageId }));
    startTransition(async () => {
      const result = await updateLeadStageAction(leadId, nextStageId ?? "");
      setMessage(result.message);
      if (result.ok) { router.refresh(); }
      else { setLocalLeadStages((prev) => { const next = { ...prev }; delete next[leadId]; return next; }); }
    });
  }

  function changeLeadSource(leadId: string, sourceId: string) {
    const nextSourceId = sourceId === "none" ? null : sourceId;
    setLocalLeadSources((prev) => ({ ...prev, [leadId]: nextSourceId }));
    startTransition(async () => {
      const result = await updateLeadSourceAction(leadId, nextSourceId ?? "");
      setMessage(result.message);
      if (result.ok) { router.refresh(); }
      else { setLocalLeadSources((prev) => { const next = { ...prev }; delete next[leadId]; return next; }); }
    });
  }

  const handleOptimisticAdd = useCallback((msg: InboxMessage) => {
    setOptimisticMessages((prev) => [...prev, msg]);
  }, []);

  const handleOptimisticUpdate = useCallback(
    (clientMessageId: string, patch: Partial<InboxMessage>) => {
      setOptimisticMessages((prev) =>
        prev.map((m) => {
          if (m.client_message_id !== clientMessageId) return m;
          // If the server returned a real ID, update it so proxy URLs work
          return { ...m, ...patch };
        })
      );
    },
    []
  );

  // Detect pending inbound media in the active conversation.
  // While any message is still downloading, poll every 2s for up to 30s so the
  // UI updates even if the Supabase Realtime message arrives late or is missed.
  const hasPendingMedia = useMemo(
    () => visibleMessages.some(
      (m) => m.direction !== "outbound" && (
        m.media_status === "pending" ||
        (m.media_url === null && m.media_status === null && ["image", "audio", "video", "document", "sticker"].includes(m.message_type))
      )
    ),
    [visibleMessages]
  );

  useEffect(() => {
    if (!hasPendingMedia) return;
    const startTime = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startTime > 30_000) { clearInterval(timer); return; }
      router.refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [hasPendingMedia, router]);

  // Retry failed inbound media: calls the retry API endpoint, then refreshes.
  const handleMediaRetry = useCallback(
    async (messageId: string) => {
      try {
        await fetch(`/api/media/message/${messageId}/retry`, { method: "POST" });
      } catch { /* ignore */ }
      router.refresh();
    },
    [router]
  );

  const handleRetry = useCallback(async (failedMessage: InboxMessage) => {
    // Optimistic: mark as sending
    if (failedMessage.id.startsWith("opt-")) {
      // Pure client-side message that was never persisted — re-send via action
      setStatusOverrides((prev) => ({ ...prev, [failedMessage.id]: { send_status: "sending", send_error: null } }));
      const result = await sendInboxMessageAction({
        conversationId: failedMessage.conversation_id,
        clientMessageId: failedMessage.client_message_id!,
        messageType: failedMessage.message_type as "text" | "image" | "audio" | "video" | "document" | "sticker",
        text: failedMessage.content,
        mediaUrl: failedMessage.media_url,
        mediaMimetype: failedMessage.media_mimetype,
        mediaFilename: failedMessage.media_filename,
        mediaDuration: failedMessage.media_duration,
      });
      if (result.data) {
        handleOptimisticUpdate(failedMessage.client_message_id!, {
          id: result.data.id,
          send_status: result.data.send_status,
          send_error: result.data.send_error,
        });
      } else {
        setStatusOverrides((prev) => ({
          ...prev,
          [failedMessage.id]: { send_status: "failed", send_error: result.message },
        }));
      }
    } else {
      // DB-persisted message — use retryInboxMessageAction
      setStatusOverrides((prev) => ({ ...prev, [failedMessage.id]: { send_status: "sending", send_error: null } }));
      const result = await retryInboxMessageAction(failedMessage.id);
      if (result.data) {
        setStatusOverrides((prev) => ({
          ...prev,
          [failedMessage.id]: { send_status: result.data!.send_status, send_error: result.data!.send_error },
        }));
      } else {
        setStatusOverrides((prev) => ({
          ...prev,
          [failedMessage.id]: { send_status: "failed", send_error: result.message },
        }));
      }
    }
  }, [handleOptimisticUpdate]);

  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* ── Left sidebar: conversation list ── */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border bg-white">
        <div className="space-y-2 border-b border-border p-3">
          <div className="flex items-center justify-between">
            <p className="label-eyebrow">Inbox WhatsApp</p>
            <Button
              variant={filter === "unread" ? "outline" : "ghost"}
              size="icon-sm"
              onClick={() => setFilter((v) => (v === "unread" ? "all" : "unread"))}
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
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 w-full rounded-lg border border-border bg-background-subtle pl-7 pr-3 text-[11px] placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-green"
            />
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-background-subtle p-1">
            {[["activity", "Ativas"], ["created", "Iniciadas"]].map(([value, label]) => (
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
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
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
          {filteredConversations.map((c) => (
            <ConversationItem
              key={c.id}
              conversation={c}
              isActive={c.id === activeConv?.id}
              locallyRead={locallyReadIds.has(c.id)}
              onClick={() => selectConversation(c.id)}
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

      {/* ── Center: chat area ── */}
      <div className="flex flex-1 flex-col bg-background-subtle">
        {activeConv ? (
          <>
            {/* Header */}
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-white px-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-green-soft text-sm font-bold text-brand-green-deep">
                {getInitials(lead?.name ?? cleanJid(activeConv.remote_jid))}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold leading-none text-text-primary">
                  {lead?.name ?? "Contato sem lead vinculado"}
                </p>
                <p className="mt-0.5 text-[11px] text-text-muted">{formatPhone(cleanJid(activeConv.remote_jid))}</p>
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

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-2 pb-4">
                {visibleMessages.length === 0 && (
                  <div className="py-12 text-center text-xs text-text-muted">Nenhuma mensagem salva nesta conversa.</div>
                )}
                {visibleMessages.map((item) => (
                  <MessageBubble key={item.id} message={item} onRetry={handleRetry} onMediaRetry={handleMediaRetry} />
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Composer */}
            <Composer
              key={activeConv.id}
              activeConvId={activeConv.id}
              isConnected={isConnected}
              onOptimisticAdd={handleOptimisticAdd}
              onOptimisticUpdate={handleOptimisticUpdate}
            />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <Inbox className="mb-3 h-8 w-8 text-text-muted" />
            <p className="text-sm font-semibold text-text-secondary">Inbox vazio</p>
            <p className="mt-1 max-w-sm text-xs text-text-muted">Conecte uma instancia da Evolution API para receber conversas reais aqui.</p>
          </div>
        )}
      </div>

      {/* ── Right sidebar: lead card ── */}
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
                        <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {lead.service?.name && <Info icon={<Tag />} label="Servico" value={lead.service.name} />}
                {lead.appointment_scheduled_at && (
                  <Info icon={<Clock />} label="Consulta agendada" value={formatDateTime(lead.appointment_scheduled_at)} />
                )}
                {(lead.detected_city || lead.detected_state || lead.phone_ddd) && (
                  <Info
                    icon={<MapPin />}
                    label="Localizacao"
                    value={[
                      [lead.detected_city, lead.detected_state].filter(Boolean).join(" / "),
                      lead.phone_ddd ? `DDD ${lead.phone_ddd}` : null,
                      LOCATION_STATUS_LABELS[lead.service_area_status] ?? null,
                    ].filter(Boolean).join(" · ")}
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
                        .filter((s) => s.active !== false || s.id === lead.source_id)
                        .map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}{s.active === false ? " (inativa)" : ""}
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
                  const scheduledTime = new Date(bhItem.scheduled_for).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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
                            if (result.ok) setCancelledBhIds((prev) => new Set([...prev, bhItem.id]));
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
