"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Edit2,
  ExternalLink,
  FileImage,
  Mic,
  Plus,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn, formatDateTime } from "@/lib/utils";
import type { OrgBusinessHours } from "@/lib/business-hours";
import {
  cancelQueueItemAction,
  deleteFollowupStepAction,
  saveFollowupSettingsAction,
  toggleBlockedStageAction,
  toggleBlockedTagAction,
  upsertFollowupStepAction,
} from "./actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type FollowupSettings = {
  id: string;
  enabled: boolean;
  timezone: string;
} | null;

export type FollowupStep = {
  id: string;
  step_order: number;
  delay_days: number;
  message_template: string;
  message_type: string;
  media_url: string | null;
  media_mimetype: string | null;
  media_filename: string | null;
};

type Stage = { id: string; name: string };
type Tag   = { id: string; name: string; color: string };

type QueueItem = {
  id: string;
  status: string;
  scheduled_for: string;
  sent_at: string | null;
  error: string | null;
  cycle_started_at: string;
  created_at: string;
  step: { step_order: number; delay_days: number; message_template: string; message_type?: string } | null;
  conversation: {
    id: string;
    remote_jid: string;
    lead: { id: string; name: string; phone: string } | null;
  } | null;
};

type FollowupEvent = {
  id: string;
  event_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  queue_item: {
    step: { step_order: number } | null;
    conversation: { remote_jid: string; lead: { name: string; phone: string } | null } | null;
  } | null;
};

type Props = {
  settings: FollowupSettings;
  steps: FollowupStep[];
  orgBusinessHours: OrgBusinessHours | null;
  blockedStageIds: string[];
  blockedTagIds: string[];
  stages: Stage[];
  tags: Tag[];
  queue: QueueItem[];
  events: FollowupEvent[];
  instances: { id: string; instance_name: string; status: string }[];
};

const DAYS_PT = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];

const EVENT_LABELS: Record<string, string> = {
  queued:                   "Agendado",
  sent:                     "Enviado",
  skipped:                  "Ignorado",
  cancelled:                "Cancelado",
  deferred:                 "Adiado",
  failed:                   "Falhou",
  cycle_reset:              "Ciclo reiniciado",
  cancelled_due_to_inbound: "Cancelado por resposta",
  skipped_due_to_inbound:   "Ignorado por resposta",
};

const TYPE_LABELS: Record<string, string> = {
  text:  "Texto",
  audio: "Audio",
  image: "Imagem",
};

// ─── Main Component ───────────────────────────────────────────────────────────

export function FollowUpClient({
  settings: initialSettings,
  steps: initialSteps,
  orgBusinessHours,
  blockedStageIds: initialBlockedStages,
  blockedTagIds: initialBlockedTags,
  stages,
  tags,
  queue,
  events,
  instances,
}: Props) {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  const [settings, setSettings] = useState(initialSettings);
  const [steps, setSteps] = useState(initialSteps);
  const [blockedStages, setBlockedStages] = useState(initialBlockedStages);
  const [blockedTags, setBlockedTags] = useState(initialBlockedTags);

  const [editingStep, setEditingStep] = useState<FollowupStep | null>(null);
  const [addingStep, setAddingStep] = useState(false);

  function notify(result: { ok: boolean; message: string }) {
    setMessage({ text: result.message, ok: result.ok });
    setTimeout(() => setMessage(null), 4000);
  }

  // ─── Settings actions ──────────────────────────────────────────────────────

  function toggleEnabled() {
    const enabling = !settings?.enabled;
    if (enabling) {
      if (steps.length === 0) {
        notify({ ok: false, message: "Adicione ao menos uma mensagem antes de ativar o follow-up." });
        return;
      }
      if (!orgBusinessHours || !orgBusinessHours.workingDays?.length) {
        notify({
          ok: false,
          message: "Configure o horario de funcionamento em Configuracoes antes de ativar o follow-up.",
        });
        return;
      }
    }
    const fd = new FormData();
    fd.set("enabled", enabling ? "true" : "false");
    fd.set("timezone", orgBusinessHours?.timezone ?? settings?.timezone ?? "America/Sao_Paulo");
    startTransition(async () => {
      const result = await saveFollowupSettingsAction(fd);
      notify(result);
      if (result.ok) {
        setSettings((prev) =>
          prev ? { ...prev, enabled: !prev.enabled } : { id: "", enabled: true, timezone: "America/Sao_Paulo" }
        );
      }
    });
  }

  // ─── Step actions ──────────────────────────────────────────────────────────

  function saveStep(stepId: string | null, fd: FormData) {
    startTransition(async () => {
      const result = await upsertFollowupStepAction(stepId, fd);
      notify(result);
      if (result.ok) {
        setEditingStep(null);
        setAddingStep(false);
        router.refresh();
      }
    });
  }

  function removeStep(stepId: string) {
    if (!confirm("Remover este passo?")) return;
    startTransition(async () => {
      const result = await deleteFollowupStepAction(stepId);
      notify(result);
      if (result.ok) setSteps((prev) => prev.filter((s) => s.id !== stepId));
    });
  }

  // ─── Blocked stage/tag ─────────────────────────────────────────────────────

  function toggleStage(stageId: string) {
    const isBlocked = blockedStages.includes(stageId);
    startTransition(async () => {
      const result = await toggleBlockedStageAction(stageId, !isBlocked);
      notify(result);
      if (result.ok) {
        setBlockedStages((prev) =>
          isBlocked ? prev.filter((id) => id !== stageId) : [...prev, stageId]
        );
      }
    });
  }

  function toggleTag(tagId: string) {
    const isBlocked = blockedTags.includes(tagId);
    startTransition(async () => {
      const result = await toggleBlockedTagAction(tagId, !isBlocked);
      notify(result);
      if (result.ok) {
        setBlockedTags((prev) =>
          isBlocked ? prev.filter((id) => id !== tagId) : [...prev, tagId]
        );
      }
    });
  }

  // ─── Queue cancel ──────────────────────────────────────────────────────────

  function cancelItem(itemId: string) {
    if (!confirm("Cancelar este item da fila?")) return;
    startTransition(async () => {
      const result = await cancelQueueItemAction(itemId);
      notify(result);
    });
  }

  const noBusinessHours = !orgBusinessHours || !orgBusinessHours.workingDays?.length;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-black text-text-primary">Follow-up Automatico</h1>
        <p className="mt-0.5 text-xs text-text-muted">
          Configure mensagens automaticas de acompanhamento via WhatsApp.
        </p>
      </div>

      {message && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium",
            message.ok
              ? "border-brand-green/30 bg-brand-green-soft text-brand-green-deep"
              : "border-danger-red/30 bg-red-50 text-danger-red"
          )}
        >
          {message.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
          {message.text}
        </div>
      )}

      {/* Avisos */}
      {instances.every((i) => i.status !== "connected") && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          Nenhuma instancia WhatsApp conectada. O follow-up nao conseguira enviar mensagens ate que uma instancia esteja ativa.
        </div>
      )}
      {steps.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Nenhuma mensagem de follow-up configurada. Adicione ao menos uma na secao &quot;Sequencia de Mensagens&quot; abaixo.
        </div>
      )}
      {noBusinessHours && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Horario de funcionamento nao configurado.{" "}
          <Link href="/settings" className="underline underline-offset-2 font-medium">
            Configure em Configuracoes
          </Link>{" "}
          antes de ativar o follow-up.
        </div>
      )}

      {/* ── 1. Status ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-text-primary">Status do Follow-up</p>
              <p className="mt-0.5 text-xs text-text-muted">Ativa ou desativa o envio automatico para toda a organizacao.</p>
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={toggleEnabled}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-60",
                settings?.enabled ? "bg-brand-green" : "bg-border"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                  settings?.enabled ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>
        </CardHeader>
      </Card>

      {/* ── 2. Sequence ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-text-primary">Sequencia de Mensagens</p>
              <p className="mt-0.5 text-xs text-text-muted">
                Cada passo e enviado apos a janela de dias contada desde o ultimo contato manual.
              </p>
            </div>
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddingStep(true)} disabled={isPending}>
              <Plus className="h-3.5 w-3.5" /> Adicionar passo
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {steps.length === 0 && !addingStep && (
            <p className="py-4 text-center text-xs text-text-muted">Nenhum passo configurado.</p>
          )}
          {steps.map((step) =>
            editingStep?.id === step.id ? (
              <StepForm
                key={step.id}
                step={step}
                disabled={isPending}
                onSave={(fd) => saveStep(step.id, fd)}
                onCancel={() => setEditingStep(null)}
              />
            ) : (
              <StepCard
                key={step.id}
                step={step}
                isPending={isPending}
                onEdit={() => setEditingStep(step)}
                onRemove={() => removeStep(step.id)}
              />
            )
          )}
          {addingStep && (
            <StepForm
              step={null}
              disabled={isPending}
              onSave={(fd) => saveStep(null, fd)}
              onCancel={() => setAddingStep(false)}
            />
          )}
        </CardContent>
      </Card>

      {/* ── 3. Business Hours — read-only from Configuracoes ─────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-text-primary">Horario de Envio</p>
              <p className="text-xs text-text-muted">
                Os follow-ups fora desta janela sao adiados para o proximo horario valido. O horario e definido em{" "}
                <Link href="/settings" className="underline underline-offset-2 text-brand-green-deep">
                  Configuracoes
                </Link>.
              </p>
            </div>
            <Link href="/settings">
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-text-muted">
                <ExternalLink className="h-3 w-3" />
                Editar
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {noBusinessHours ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
              Nenhum horario configurado. Acesse{" "}
              <Link href="/settings" className="underline underline-offset-2 font-medium">
                Configuracoes &rarr; Horario de funcionamento
              </Link>{" "}
              para definir os dias e horarios de atendimento da clinica.
            </p>
          ) : (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {DAYS_PT.map((name, dow) => {
                  const active = orgBusinessHours?.workingDays?.includes(dow);
                  return (
                    <span
                      key={dow}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                        active
                          ? "border-brand-green/40 bg-brand-green-soft text-brand-green-deep"
                          : "border-border bg-background-subtle text-text-muted"
                      )}
                    >
                      {name}
                    </span>
                  );
                })}
              </div>
              {orgBusinessHours && (
                <p className="text-xs text-text-secondary">
                  {orgBusinessHours.startTime} — {orgBusinessHours.endTime}
                  <span className="ml-2 text-text-muted">({orgBusinessHours.timezone})</span>
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 4. Blocked Stages ─────────────────────────────────────────────── */}
      {stages.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <p className="text-sm font-semibold text-text-primary">Etapas Bloqueadas</p>
            <p className="text-xs text-text-muted">Leads nestas etapas nao recebem follow-up automatico.</p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stages.map((stage) => {
                const blocked = blockedStages.includes(stage.id);
                return (
                  <button
                    key={stage.id}
                    type="button"
                    disabled={isPending}
                    onClick={() => toggleStage(stage.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60",
                      blocked
                        ? "border-danger-red bg-red-50 text-danger-red"
                        : "border-border text-text-secondary hover:border-brand-green hover:text-brand-green-dark"
                    )}
                  >
                    {blocked && <X className="mr-1 inline h-3 w-3" />}
                    {stage.name}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 5. Blocked Tags ───────────────────────────────────────────────── */}
      {tags.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <p className="text-sm font-semibold text-text-primary">Tags Bloqueadas</p>
            <p className="text-xs text-text-muted">Leads com estas tags nao recebem follow-up automatico.</p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const blocked = blockedTags.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    disabled={isPending}
                    onClick={() => toggleTag(tag.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60",
                      blocked ? "border-danger-red text-danger-red" : "border-border text-text-secondary hover:border-brand-green"
                    )}
                    style={!blocked ? { borderColor: tag.color + "80" } : undefined}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: blocked ? undefined : tag.color }} />
                    {tag.name}
                    {blocked && <X className="h-3 w-3" />}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 6. Queue ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-text-primary">Fila de Envio</p>
              <p className="text-xs text-text-muted">Proximos follow-ups agendados (pendentes).</p>
            </div>
            <span className="rounded-full bg-brand-green-soft px-2.5 py-0.5 text-[11px] font-semibold text-brand-green-deep">
              {queue.length} pendentes
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <p className="py-4 text-center text-xs text-text-muted">Nenhum item na fila.</p>
          ) : (
            <div className="space-y-2">
              {queue.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                  <Clock className="h-4 w-4 shrink-0 text-text-muted" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-xs font-semibold text-text-primary">
                      {item.conversation?.lead?.name ?? item.conversation?.remote_jid ?? "—"}
                    </p>
                    <p className="text-[10px] text-text-muted">
                      Passo {item.step?.step_order ?? "?"}
                      {item.step?.message_type && item.step.message_type !== "text" && (
                        <span className="ml-1">· {TYPE_LABELS[item.step.message_type] ?? item.step.message_type}</span>
                      )}
                      {" · "}Agendado para {formatDateTime(item.scheduled_for)}
                    </p>
                  </div>
                  <StatusBadge status={item.status} />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-danger-red hover:text-danger-red"
                    disabled={isPending}
                    onClick={() => cancelItem(item.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 7. History ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <p className="text-sm font-semibold text-text-primary">Historico</p>
          <p className="text-xs text-text-muted">Ultimos 100 eventos de follow-up.</p>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="py-4 text-center text-xs text-text-muted">Nenhum evento registrado.</p>
          ) : (
            <div className="divide-y divide-border">
              {events.map((ev) => (
                <div key={ev.id} className="flex items-start gap-2.5 py-2.5">
                  <EventDot type={ev.event_type} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text-primary">
                      <span className="font-medium">{EVENT_LABELS[ev.event_type] ?? ev.event_type}</span>
                      {ev.queue_item?.conversation?.lead?.name && (
                        <> — {ev.queue_item.conversation.lead.name}</>
                      )}
                      {ev.queue_item?.step?.step_order && (
                        <span className="ml-1 text-text-muted">(passo {ev.queue_item.step.step_order})</span>
                      )}
                    </p>
                    {ev.metadata?.error != null && (
                      <p className="mt-0.5 text-[10px] text-danger-red">{String(ev.metadata.error)}</p>
                    )}
                  </div>
                  <p className="shrink-0 text-[10px] text-text-muted">{formatDateTime(ev.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── StepCard ─────────────────────────────────────────────────────────────────

function StepCard({
  step,
  isPending,
  onEdit,
  onRemove,
}: {
  step: FollowupStep;
  isPending: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const isMedia = step.message_type === "audio" || step.message_type === "image";
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-green-soft text-xs font-bold text-brand-green-deep">
        {step.step_order}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] font-semibold text-text-muted">
            Dia {step.delay_days} — Passo {step.step_order}
          </p>
          {step.message_type !== "text" && (
            <span className="flex items-center gap-0.5 rounded-full border border-border bg-background-subtle px-1.5 py-0.5 text-[10px] text-text-muted">
              {step.message_type === "audio" ? <Mic className="h-2.5 w-2.5" /> : <FileImage className="h-2.5 w-2.5" />}
              {TYPE_LABELS[step.message_type]}
            </span>
          )}
        </div>
        {isMedia ? (
          <p className="mt-0.5 text-xs text-text-muted italic">
            {step.media_filename ?? step.media_url ?? "(midia sem nome)"}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-text-primary whitespace-pre-wrap line-clamp-3">
            {step.message_template}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon-sm" onClick={onEdit} disabled={isPending}>
          <Edit2 className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" className="text-danger-red hover:text-danger-red" onClick={onRemove} disabled={isPending}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── StepForm ─────────────────────────────────────────────────────────────────

function StepForm({
  step,
  disabled,
  onSave,
  onCancel,
}: {
  step: FollowupStep | null;
  disabled: boolean;
  onSave: (fd: FormData) => void;
  onCancel: () => void;
}) {
  const [order, setOrder]   = useState(String(step?.step_order ?? ""));
  const [delay, setDelay]   = useState(String(step?.delay_days ?? ""));
  const [type, setType]     = useState<"text" | "audio" | "image">(
    (step?.message_type as "text" | "audio" | "image") ?? "text"
  );
  const [msg, setMsg]       = useState(step?.message_template ?? "");

  // Media state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading]       = useState(false);
  const [uploadError, setUploadError]   = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const existingMedia = step?.media_url
    ? { url: step.media_url, mimetype: step.media_mimetype, filename: step.media_filename }
    : null;

  const hasMedia = selectedFile !== null || existingMedia !== null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setUploadError(null);
  }

  async function handleSave() {
    if (!order || !delay) return;

    const fd = new FormData();
    fd.set("step_order", order);
    fd.set("delay_days", delay);
    fd.set("message_type", type);

    if (type === "text") {
      if (!msg.trim()) {
        setUploadError("Mensagem e obrigatoria para passos de texto.");
        return;
      }
      fd.set("message_template", msg);
    } else {
      fd.set("message_template", msg);

      if (selectedFile) {
        setUploading(true);
        setUploadError(null);
        try {
          const uploadFd = new FormData();
          uploadFd.append("file", selectedFile);
          uploadFd.append("type", type);

          const resp = await fetch("/api/follow-up/upload-media", {
            method: "POST",
            body: uploadFd,
          });
          const data = await resp.json() as { ok: boolean; error?: string; url?: string; mimetype?: string; filename?: string };

          if (!data.ok) {
            setUploadError(data.error ?? "Erro ao fazer upload da midia.");
            return;
          }

          fd.set("media_url",      data.url      ?? "");
          fd.set("media_mimetype", data.mimetype ?? "");
          fd.set("media_filename", data.filename ?? "");
        } catch {
          setUploadError("Erro de conexao ao fazer upload. Tente novamente.");
          return;
        } finally {
          setUploading(false);
        }
      } else if (existingMedia?.url) {
        fd.set("media_url",      existingMedia.url);
        fd.set("media_mimetype", existingMedia.mimetype ?? "");
        fd.set("media_filename", existingMedia.filename ?? "");
      } else {
        setUploadError(type === "audio" ? "Selecione um arquivo de audio." : "Selecione uma imagem.");
        return;
      }
    }

    onSave(fd);
  }

  const acceptAttr = type === "audio"
    ? "audio/ogg,audio/mpeg,audio/mp3,audio/wav,audio/webm,audio/mp4"
    : "image/jpeg,image/png,image/webp";

  const canSave = !uploading && !disabled && order && delay && (
    type === "text" ? msg.trim().length > 0 : hasMedia
  );

  return (
    <div className="rounded-lg border border-brand-green/40 bg-brand-green-soft/30 p-3 space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label-eyebrow mb-1">Ordem</label>
          <input
            type="number"
            min={1}
            className="h-8 w-full rounded-lg border border-border px-2 text-xs focus:border-brand-green focus:outline-none"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
          />
        </div>
        <div>
          <label className="label-eyebrow mb-1">Apos X dias</label>
          <input
            type="number"
            min={1}
            className="h-8 w-full rounded-lg border border-border px-2 text-xs focus:border-brand-green focus:outline-none"
            value={delay}
            onChange={(e) => setDelay(e.target.value)}
          />
        </div>
        <div>
          <label className="label-eyebrow mb-1">Tipo</label>
          <select
            className="h-8 w-full rounded-lg border border-border bg-white px-2 text-xs focus:border-brand-green focus:outline-none"
            value={type}
            onChange={(e) => {
              setType(e.target.value as "text" | "audio" | "image");
              setSelectedFile(null);
              setUploadError(null);
            }}
          >
            <option value="text">Texto</option>
            <option value="audio">Audio</option>
            <option value="image">Imagem</option>
          </select>
        </div>
      </div>

      {type === "text" ? (
        <div>
          <label className="label-eyebrow mb-1">Mensagem</label>
          <textarea
            rows={4}
            className="w-full resize-none rounded-lg border border-border px-2 py-2 text-xs focus:border-brand-green focus:outline-none"
            placeholder="Ola {nome}, passando para saber se tem alguma duvida..."
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <label className="label-eyebrow">{type === "audio" ? "Arquivo de Audio" : "Imagem"}</label>

          {/* Existing media preview */}
          {existingMedia && !selectedFile && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-2.5 py-2">
              {type === "audio" ? <Mic className="h-3.5 w-3.5 shrink-0 text-text-muted" /> : <FileImage className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
              <span className="flex-1 truncate text-xs text-text-secondary">
                {existingMedia.filename ?? existingMedia.url}
              </span>
              <span className="text-[10px] text-text-muted">Atual</span>
            </div>
          )}

          {/* File input */}
          <div
            className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed border-border bg-white px-3 py-4 text-center hover:border-brand-green/50 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            {type === "audio" ? <Mic className="h-5 w-5 text-text-muted" /> : <FileImage className="h-5 w-5 text-text-muted" />}
            <p className="text-xs text-text-muted">
              {selectedFile
                ? selectedFile.name
                : existingMedia
                  ? "Clique para substituir"
                  : type === "audio"
                    ? "Selecione ogg, mp3, wav ou webm (max 10 MB)"
                    : "Selecione jpeg, png ou webp (max 10 MB)"}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept={acceptAttr}
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {/* Caption for image (optional) */}
          {type === "image" && (
            <div>
              <label className="label-eyebrow mb-1">Legenda (opcional)</label>
              <input
                type="text"
                maxLength={1000}
                className="h-8 w-full rounded-lg border border-border px-2 text-xs focus:border-brand-green focus:outline-none"
                placeholder="Texto que aparece abaixo da imagem..."
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      {uploadError && (
        <p className="flex items-center gap-1 text-xs text-danger-red">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {uploadError}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={disabled || uploading}>
          Cancelar
        </Button>
        <Button size="sm" onClick={handleSave} disabled={!canSave}>
          {uploading ? "Enviando..." : "Salvar"}
        </Button>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:   "bg-yellow-50 text-yellow-700 border-yellow-200",
    sending:   "bg-blue-50 text-blue-700 border-blue-200",
    sent:      "bg-brand-green-soft text-brand-green-deep border-brand-green/30",
    skipped:   "bg-background-subtle text-text-muted border-border",
    failed:    "bg-red-50 text-danger-red border-danger-red/30",
    cancelled: "bg-background-subtle text-text-muted border-border",
  };
  const labels: Record<string, string> = {
    pending: "Pendente", sending: "Enviando", sent: "Enviado",
    skipped: "Ignorado", failed: "Falhou", cancelled: "Cancelado",
  };
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", map[status] ?? "bg-background-subtle text-text-muted")}>
      {labels[status] ?? status}
    </span>
  );
}

function EventDot({ type }: { type: string }) {
  const colors: Record<string, string> = {
    sent:                     "bg-brand-green",
    queued:                   "bg-blue-400",
    deferred:                 "bg-yellow-400",
    skipped:                  "bg-gray-300",
    failed:                   "bg-danger-red",
    cancelled:                "bg-gray-300",
    cycle_reset:              "bg-purple-400",
    cancelled_due_to_inbound: "bg-gray-400",
    skipped_due_to_inbound:   "bg-gray-400",
  };
  return (
    <div className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", colors[type] ?? "bg-gray-300")} />
  );
}
