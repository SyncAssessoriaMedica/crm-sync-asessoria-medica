"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  FileText,
  ImageIcon,
  Loader2,
  MessageSquareText,
  Mic,
  Pencil,
  Plus,
  Save,
  Square,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  normalizeQuickMessageShortcut,
  QUICK_MESSAGE_TYPES,
  QUICK_MESSAGE_VARIABLES,
  renderQuickMessagePreview,
  type QuickMessage,
  type QuickMessageType,
} from "@/lib/quick-messages";
import { cn } from "@/lib/utils";
import { deleteQuickMessageAction, saveQuickMessageAction, toggleQuickMessageAction } from "./actions";

const TYPE_LABEL: Record<QuickMessageType, string> = {
  text: "Texto",
  image: "Imagem",
  audio: "Audio",
  video: "Video",
  document: "Documento",
  sticker: "Figurinha",
};
const ACCEPT: Record<Exclude<QuickMessageType, "text">, string> = {
  image: "image/jpeg,image/png,image/webp",
  audio: "audio/ogg,audio/mpeg,audio/wav,audio/webm,audio/mp4,audio/x-m4a",
  video: "video/mp4,video/webm,video/3gpp,video/quicktime",
  document: "application/pdf,text/plain,text/csv,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  sticker: "image/webp",
};

type Draft = {
  id?: string;
  title: string;
  shortcut: string;
  message_type: QuickMessageType;
  content: string;
  media_url: string | null;
  media_mimetype: string | null;
  media_filename: string | null;
  media_duration: number | null;
  media_ptt: boolean;
  preview_url: string | null;
};

const EMPTY_DRAFT: Draft = {
  title: "",
  shortcut: "",
  message_type: "text",
  content: "",
  media_url: null,
  media_mimetype: null,
  media_filename: null,
  media_duration: null,
  media_ptt: false,
  preview_url: null,
};

function messageToDraft(message: QuickMessage): Draft {
  return {
    id: message.id,
    title: message.title,
    shortcut: message.shortcut,
    message_type: message.message_type,
    content: message.content ?? "",
    media_url: message.media_url,
    media_mimetype: message.media_mimetype,
    media_filename: message.media_filename,
    media_duration: message.media_duration,
    media_ptt: message.media_ptt === true,
    preview_url: message.media_url ? `/api/quick-messages/${message.id}/media` : null,
  };
}

export function QuickMessagesClient({
  initialMessages,
  loadError,
}: {
  initialMessages: QuickMessage[];
  loadError: string | null;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [filter, setFilter] = useState("");
  const [feedback, setFeedback] = useState<string | null>(loadError);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [isPending, startTransition] = useTransition();
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return messages.filter((message) =>
      !term || message.title.toLowerCase().includes(term) || message.shortcut.includes(term) || message.content?.toLowerCase().includes(term)
    );
  }, [filter, messages]);

  function resetDraft() {
    if (draft.preview_url?.startsWith("blob:")) URL.revokeObjectURL(draft.preview_url);
    setDraft(EMPTY_DRAFT);
  }

  function insertVariable(key: string) {
    const token = `{{${key}}}`;
    const textarea = contentRef.current;
    const start = textarea?.selectionStart ?? draft.content.length;
    const end = textarea?.selectionEnd ?? draft.content.length;
    setDraft((current) => ({ ...current, content: `${current.content.slice(0, start)}${token}${current.content.slice(end)}` }));
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function uploadBlob(blob: Blob, type: Exclude<QuickMessageType, "text">, filename: string) {
    const mime = (blob.type || "application/octet-stream").split(";")[0].trim();
    setUploading(true);
    setFeedback(null);
    try {
      const prepare = await fetch("/api/quick-messages/create-upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, mimetype: mime, size: blob.size, filename }),
      });
      const prepared = await prepare.json() as { ok?: boolean; error?: string; signedUrl?: string; storagePath?: string; mimetype?: string; filename?: string };
      if (!prepare.ok || !prepared.signedUrl || !prepared.storagePath) throw new Error(prepared.error ?? "Erro ao preparar upload.");
      const uploaded = await fetch(prepared.signedUrl, { method: "PUT", body: blob, headers: { "Content-Type": mime } });
      if (!uploaded.ok) throw new Error("Falha ao enviar arquivo.");
      const preview = URL.createObjectURL(blob);
      if (draft.preview_url?.startsWith("blob:")) URL.revokeObjectURL(draft.preview_url);
      setDraft((current) => ({
        ...current,
        message_type: type,
        media_url: `supabase://media/${prepared.storagePath}`,
        media_mimetype: prepared.mimetype ?? mime,
        media_filename: prepared.filename ?? filename,
        media_ptt: type === "audio" ? current.media_ptt : false,
        preview_url: preview,
      }));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Erro no upload.");
    } finally {
      setUploading(false);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file || draft.message_type === "text") return;
    await uploadBlob(file, draft.message_type, file.name);
  }

  async function startRecording() {
    setFeedback(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find(MediaRecorder.isTypeSupported) ?? "";
      const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) return setFeedback("A gravacao ficou vazia.");
        await uploadBlob(blob, "audio", `audio-rapido-${Date.now()}.${blob.type.includes("ogg") ? "ogg" : "webm"}`);
        setDraft((current) => ({ ...current, media_ptt: true }));
      };
      recorder.start(200);
      recorderRef.current = recorder;
      setDraft((current) => ({ ...current, message_type: "audio", media_ptt: true }));
      setRecording(true);
    } catch {
      setFeedback("Nao foi possivel acessar o microfone. Confira a permissao do navegador.");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
  }

  function save() {
    setFeedback(null);
    startTransition(async () => {
      const result = await saveQuickMessageAction({
        ...draft,
        shortcut: normalizeQuickMessageShortcut(draft.shortcut),
      });
      setFeedback(result.message);
      if (result.ok) window.location.reload();
    });
  }

  function toggle(message: QuickMessage) {
    startTransition(async () => {
      const result = await toggleQuickMessageAction(message.id, !message.active);
      setFeedback(result.message);
      if (result.ok) setMessages((current) => current.map((item) => item.id === message.id ? { ...item, active: !item.active } : item));
    });
  }

  function remove(message: QuickMessage) {
    if (!window.confirm(`Remover a mensagem rapida "${message.title}"?`)) return;
    startTransition(async () => {
      const result = await deleteQuickMessageAction(message.id);
      setFeedback(result.message);
      if (result.ok) setMessages((current) => current.filter((item) => item.id !== message.id));
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="label-eyebrow text-text-muted">Administrador</p>
        <h1 className="mt-1 text-2xl font-black text-text-primary">Mensagens rapidas</h1>
        <p className="mt-1 max-w-3xl text-sm text-text-secondary">
          Crie respostas reutilizaveis para a equipe. As variaveis sao preenchidas com os dados do lead ao selecionar a mensagem no Inbox.
        </p>
      </div>

      {feedback && <div className="rounded-lg border border-border bg-brand-green-soft px-3 py-2 text-xs font-medium text-brand-green-deep">{feedback}</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Biblioteca da clinica</CardTitle>
              <p className="mt-1 text-xs text-text-muted">{messages.length} mensagem(ns)</p>
            </div>
            <Button size="sm" variant="secondary" onClick={resetDraft}><Plus />Nova</Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Pesquisar por nome, atalho ou texto..." />
            {filtered.length === 0 && <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-text-muted">Nenhuma mensagem encontrada.</p>}
            {filtered.map((message) => (
              <div key={message.id} className={cn("rounded-xl border p-3", message.active ? "border-border bg-white" : "border-border bg-background-subtle opacity-70")}>
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-green-soft text-brand-green-deep">
                    {message.message_type === "text" ? <MessageSquareText /> : message.message_type === "audio" ? <Mic /> : message.message_type === "video" ? <Video /> : message.message_type === "document" ? <FileText /> : <ImageIcon />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-text-primary">{message.title}</p>
                      <Badge variant={message.active ? "green" : "secondary"}>{message.active ? "Ativa" : "Inativa"}</Badge>
                      <Badge variant="secondary">{TYPE_LABEL[message.message_type]}</Badge>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-brand-green-dark">/{message.shortcut}</p>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-text-muted">{message.content || message.media_filename || "Arquivo salvo"}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setDraft(messageToDraft(message))}><Pencil /></Button>
                    <Button size="sm" variant="ghost" onClick={() => toggle(message)} disabled={isPending}>{message.active ? "Desativar" : "Ativar"}</Button>
                    <Button size="icon-sm" variant="ghost" className="text-danger-red" aria-label="Remover" onClick={() => remove(message)}><Trash2 /></Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader><CardTitle>{draft.id ? "Editar mensagem" : "Nova mensagem"}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1"><span className="text-xs font-semibold">Nome interno</span><Input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Ex.: Confirmacao de consulta" /></label>
            <label className="block space-y-1"><span className="text-xs font-semibold">Atalho</span><Input value={draft.shortcut} onChange={(event) => setDraft((current) => ({ ...current, shortcut: normalizeQuickMessageShortcut(event.target.value) }))} placeholder="confirmacao" /><span className="text-[10px] text-text-muted">Use no Inbox como /{draft.shortcut || "atalho"}.</span></label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold">Tipo</span>
              <select
                value={draft.message_type}
                onChange={(event) => {
                  const nextType = event.target.value as QuickMessageType;
                  if (draft.preview_url?.startsWith("blob:")) URL.revokeObjectURL(draft.preview_url);
                  setDraft((current) => ({
                    ...current,
                    message_type: nextType,
                    media_url: null,
                    media_mimetype: null,
                    media_filename: null,
                    media_duration: null,
                    media_ptt: false,
                    preview_url: null,
                  }));
                }}
                className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm"
              >
                {QUICK_MESSAGE_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABEL[type]}</option>)}
              </select>
            </label>

            {draft.message_type !== "text" && (
              <div className="space-y-2 rounded-lg border border-border bg-background-subtle p-3">
                <input type="file" accept={ACCEPT[draft.message_type]} disabled={uploading || recording} onChange={(event) => void handleFile(event.target.files?.[0])} className="block w-full text-xs" />
                {draft.message_type === "audio" && (
                  <Button type="button" size="sm" variant={recording ? "destructive" : "secondary"} onClick={recording ? stopRecording : () => void startRecording()} disabled={uploading}>
                    {recording ? <><Square />Parar gravacao</> : <><Mic />Gravar audio agora</>}
                  </Button>
                )}
                {uploading && <p className="flex items-center gap-1 text-xs text-text-muted"><Loader2 className="h-3 w-3 animate-spin" />Enviando arquivo...</p>}
                {draft.preview_url && draft.message_type === "audio" && <audio controls src={draft.preview_url} className="h-9 w-full" />}
                {draft.preview_url && (draft.message_type === "image" || draft.message_type === "sticker") && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.preview_url} alt="Previa" className="max-h-40 rounded-lg object-contain" />
                )}
                {draft.media_filename && <p className="truncate text-[11px] text-text-muted">{draft.media_filename}{draft.media_ptt ? " - mensagem de voz" : ""}</p>}
              </div>
            )}

            {draft.message_type !== "audio" && draft.message_type !== "sticker" && (
              <label className="block space-y-1">
                <span className="text-xs font-semibold">{draft.message_type === "text" ? "Texto" : "Legenda opcional"}</span>
                <textarea ref={contentRef} value={draft.content} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} rows={6} maxLength={4000} className="w-full resize-y rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green" placeholder="Digite a mensagem..." />
              </label>
            )}

            {draft.message_type !== "audio" && draft.message_type !== "sticker" && (
              <div>
                <p className="mb-2 text-xs font-semibold">Inserir variavel</p>
                <div className="flex flex-wrap gap-1.5">{QUICK_MESSAGE_VARIABLES.map((variable) => <button key={variable.key} type="button" onClick={() => insertVariable(variable.key)} className="rounded-md border border-border bg-white px-2 py-1 font-mono text-[10px] text-brand-green-deep hover:bg-brand-green-soft">{`{{${variable.key}}}`}</button>)}</div>
              </div>
            )}

            {draft.content && (
              <div className="rounded-lg border border-dashed border-border p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Previa com dados de exemplo</p>
                <p className="mt-1 whitespace-pre-wrap text-xs text-text-secondary">{renderQuickMessagePreview(draft.content)}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              {draft.id && <Button variant="ghost" onClick={resetDraft}><X />Cancelar</Button>}
              <Button onClick={save} disabled={isPending || uploading || recording || !draft.title || !draft.shortcut}>
                {isPending ? <Loader2 className="animate-spin" /> : <Save />}Salvar
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
