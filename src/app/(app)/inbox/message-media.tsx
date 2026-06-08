"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCheck, Clock, FileText, Loader2, MapPin, RefreshCw, X } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import type { InboxMessage } from "./types";

// ─── Lightbox ──────────────────────────────────────────────────────────────────

function MediaLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <button
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        onClick={onClose}
        aria-label="Fechar"
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─── Content renderers ─────────────────────────────────────────────────────────

function proxyUrl(messageId: string) {
  return `/api/media/message/${messageId}`;
}

function localOrProxy(message: InboxMessage): string {
  // Optimistic messages may have a blob URL stored in media_url
  if (message.media_url?.startsWith("blob:")) return message.media_url;
  return proxyUrl(message.id);
}

function ImageContent({ message }: { message: InboxMessage }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = localOrProxy(message);

  if (failed) {
    return <p className="px-3 py-2 text-xs italic text-text-muted">Imagem indisponível</p>;
  }

  return (
    <>
      <button
        className="block w-full"
        onClick={() => setLightboxOpen(true)}
        aria-label="Ampliar imagem"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={message.media_filename ?? "Imagem"}
          loading="lazy"
          className="max-h-52 w-full object-cover"
          onError={() => setFailed(true)}
        />
      </button>
      {message.content && (
        <p className="px-3 pt-1 text-xs whitespace-pre-wrap">{message.content}</p>
      )}
      {lightboxOpen && (
        <MediaLightbox
          src={url}
          alt={message.media_filename ?? "Imagem"}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}

function AudioContent({ message }: { message: InboxMessage }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const url = localOrProxy(message);

  // Optimistic (no media_url yet) or sending: show skeleton
  if (!message.media_url && message.send_status === "sending") {
    return (
      <div className="px-3 py-2">
        <div className="h-8 w-full animate-pulse rounded bg-black/10" />
      </div>
    );
  }

  if (failed) {
    return (
      <div className="px-3 py-2">
        <p className="text-xs italic text-text-muted">Áudio indisponível</p>
        <button
          onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}
          className="mt-1 text-[10px] font-medium text-brand-green-dark underline underline-offset-2 hover:no-underline"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <audio
        key={attempt}
        src={url}
        controls
        preload="none"
        className="h-8 w-full min-w-[180px]"
        onError={() => setFailed(true)}
      />
      {message.media_duration !== null && message.media_duration !== undefined && message.media_duration > 0 && (
        <p className="mt-0.5 text-[10px] text-text-muted">{formatDuration(message.media_duration)}</p>
      )}
      {message.content && (
        <p className="mt-1 text-xs whitespace-pre-wrap">{message.content}</p>
      )}
    </div>
  );
}

function VideoContent({ message }: { message: InboxMessage }) {
  const [failed, setFailed] = useState(false);
  const url = localOrProxy(message);

  if (!message.media_url && message.send_status === "sending") {
    return <div className="h-40 w-full animate-pulse bg-black/10" />;
  }

  if (failed) {
    return <p className="px-3 py-2 text-xs italic text-text-muted">Vídeo indisponível</p>;
  }

  return (
    <>
      <video
        src={url}
        controls
        preload="none"
        className="max-h-64 w-full"
        onError={() => setFailed(true)}
      />
      {message.content && (
        <p className="px-3 pt-1 text-xs whitespace-pre-wrap">{message.content}</p>
      )}
    </>
  );
}

function DocumentContent({ message }: { message: InboxMessage }) {
  const url = proxyUrl(message.id);
  const filename = message.media_filename ?? "Documento";

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-green-soft text-brand-green-dark">
        <FileText className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{filename}</p>
        {message.media_mimetype && (
          <p className="text-[10px] text-text-muted">{friendlyMime(message.media_mimetype)}</p>
        )}
      </div>
      {/* Don't render download link for optimistic/sending messages */}
      {message.send_status === "sent" && (
        <a
          href={url}
          download={filename}
          className="shrink-0 rounded-md bg-brand-green-soft px-2 py-1 text-[10px] font-semibold text-brand-green-dark hover:bg-brand-green/10"
        >
          Baixar
        </a>
      )}
    </div>
  );
}

function StickerContent({ message }: { message: InboxMessage }) {
  const [failed, setFailed] = useState(false);
  const url = localOrProxy(message);

  if (failed) {
    return <div className="p-2 text-3xl">🙂</div>;
  }

  return (
    <div className="p-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Figurinha"
        loading="lazy"
        className="h-24 w-24 object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function LocationContent({ message }: { message: InboxMessage }) {
  const coords = parseLocation(message.content);

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <MapPin className="h-4 w-4 shrink-0 text-brand-green-dark" />
      {coords ? (
        <a
          href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-brand-green-dark hover:underline"
        >
          Ver no mapa ({coords.lat}, {coords.lng})
        </a>
      ) : (
        <span className="text-xs text-text-muted">{message.content ?? "Localização"}</span>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseLocation(content: string | null): { lat: string; lng: string } | null {
  if (!content) return null;
  const match = content.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  return { lat: match[1], lng: match[2] };
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function friendlyMime(mime: string): string {
  const map: Record<string, string> = {
    "application/pdf": "PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
    "application/msword": "Word",
    "application/vnd.ms-excel": "Excel",
    "text/plain": "Texto",
    "text/csv": "CSV",
    "application/zip": "ZIP",
  };
  return map[mime] ?? mime.split("/")[1]?.toUpperCase() ?? mime;
}

// ─── Send status footer ────────────────────────────────────────────────────────

function SendStatusFooter({
  message,
  onRetry,
}: {
  message: InboxMessage;
  onRetry?: (message: InboxMessage) => void;
}) {
  const isSent = message.direction === "outbound";
  if (!isSent) return null;

  const status = message.send_status ?? "sent";
  const time = formatDateTime(message.created_at).split(", ")[1] ?? formatDateTime(message.created_at);

  return (
    <div className="flex flex-col items-end gap-0.5 px-3 pb-2 pt-0.5">
      {status === "failed" && (
        <div className="flex items-center gap-1">
          {message.send_error && (
            <span className="text-[10px] text-danger-red/80" title={message.send_error}>
              {message.send_error.slice(0, 60)}
            </span>
          )}
          {onRetry && (
            <button
              onClick={() => onRetry(message)}
              className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold text-danger-red hover:bg-danger-red/10"
              title="Tentar novamente"
            >
              <RefreshCw className="h-2.5 w-2.5" />
              Tentar novamente
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-1 text-[10px] text-brand-green-deep/60">
        <span>{time}</span>
        {status === "sending" && <Loader2 className="h-2.5 w-2.5 animate-spin text-brand-green-deep/40" />}
        {status === "failed" && <AlertCircle className="h-2.5 w-2.5 text-danger-red" />}
        {(status === "sent" || status === "pending") && <CheckCheck className="h-2.5 w-2.5 text-brand-green" />}
      </div>
    </div>
  );
}

// ─── MessageBubble ─────────────────────────────────────────────────────────────

const KNOWN_TYPES = new Set(["text", "image", "audio", "video", "document", "sticker", "location"]);

export function MessageBubble({
  message,
  onRetry,
}: {
  message: InboxMessage;
  onRetry?: (message: InboxMessage) => void;
}) {
  const isSent = message.direction === "outbound";
  const isFailed = message.send_status === "failed";

  return (
    <div className={cn("flex", isSent ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] overflow-hidden text-xs leading-relaxed",
          isSent ? "bubble-sent text-text-primary" : "bubble-received text-text-primary",
          isFailed && "opacity-80 ring-1 ring-danger-red/30"
        )}
      >
        {message.message_type === "text" && (
          <p className="px-3 pt-2 whitespace-pre-wrap">{message.content}</p>
        )}
        {message.message_type === "image" && <ImageContent message={message} />}
        {message.message_type === "audio" && <AudioContent message={message} />}
        {message.message_type === "video" && <VideoContent message={message} />}
        {message.message_type === "document" && <DocumentContent message={message} />}
        {message.message_type === "sticker" && <StickerContent message={message} />}
        {message.message_type === "location" && <LocationContent message={message} />}
        {!KNOWN_TYPES.has(message.message_type) && (
          <p className="px-3 pt-2 italic text-text-muted">
            {message.content ?? `Mensagem: ${message.message_type}`}
          </p>
        )}

        {isSent ? (
          <SendStatusFooter message={message} onRetry={onRetry} />
        ) : (
          <div className="flex items-center gap-1 px-3 pb-2 pt-0.5 text-[10px] text-text-muted">
            <span>{formatDateTime(message.created_at).split(", ")[1] ?? formatDateTime(message.created_at)}</span>
            {/* sending state for outbound-only, inbound never shows status */}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sending skeleton bubble ───────────────────────────────────────────────────

export function SendingIndicator() {
  return (
    <div className="flex justify-end">
      <div className="flex items-center gap-1.5 rounded-2xl bg-brand-green-soft px-3 py-2 text-xs text-text-muted">
        <Clock className="h-3 w-3 text-brand-green-dark/60" />
        <span>Enviando...</span>
      </div>
    </div>
  );
}
