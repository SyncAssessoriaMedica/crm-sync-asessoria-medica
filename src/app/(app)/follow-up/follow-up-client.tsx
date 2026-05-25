"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, Clock, Edit2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn, formatDateTime } from "@/lib/utils";
import {
  cancelQueueItemAction,
  deleteFollowupStepAction,
  saveFollowupSettingsAction,
  toggleBlockedStageAction,
  toggleBlockedTagAction,
  upsertBusinessHoursAction,
  upsertFollowupStepAction,
} from "./actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type FollowupSettings = {
  id: string;
  enabled: boolean;
  timezone: string;
} | null;

type FollowupStep = {
  id: string;
  step_order: number;
  delay_days: number;
  message_template: string;
};

type BusinessHour = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled: boolean;
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
  step: { step_order: number; delay_days: number; message_template: string } | null;
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
  businessHours: BusinessHour[];
  blockedStageIds: string[];
  blockedTagIds: string[];
  stages: Stage[];
  tags: Tag[];
  queue: QueueItem[];
  events: FollowupEvent[];
};

const DAYS = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];

const TIMEZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Belem",
  "America/Recife",
  "America/Fortaleza",
  "America/Cuiaba",
  "America/Porto_Velho",
  "America/Boa_Vista",
  "America/Rio_Branco",
  "America/Noronha",
];

const EVENT_LABELS: Record<string, string> = {
  queued: "Agendado",
  sent: "Enviado",
  skipped: "Ignorado",
  cancelled: "Cancelado",
  deferred: "Adiado",
  failed: "Falhou",
  cycle_reset: "Ciclo reiniciado",
};

// ─── Main Component ───────────────────────────────────────────────────────────

export function FollowUpClient({
  settings: initialSettings,
  steps: initialSteps,
  businessHours: initialHours,
  blockedStageIds: initialBlockedStages,
  blockedTagIds: initialBlockedTags,
  stages,
  tags,
  queue,
  events,
}: Props) {
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  const [settings, setSettings] = useState(initialSettings);
  const [steps, setSteps] = useState(initialSteps);
  const [hours, setHours] = useState(initialHours);
  const [blockedStages, setBlockedStages] = useState(initialBlockedStages);
  const [blockedTags, setBlockedTags] = useState(initialBlockedTags);

  // Step edit state
  const [editingStep, setEditingStep] = useState<FollowupStep | null>(null);
  const [addingStep, setAddingStep] = useState(false);

  function notify(result: { ok: boolean; message: string }) {
    setMessage({ text: result.message, ok: result.ok });
    setTimeout(() => setMessage(null), 4000);
  }

  // ─── Settings actions ──────────────────────────────────────────────────────

  function toggleEnabled() {
    const fd = new FormData();
    fd.set("enabled", settings?.enabled ? "false" : "true");
    fd.set("timezone", settings?.timezone ?? "America/Sao_Paulo");
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

  function saveTimezone(tz: string) {
    const fd = new FormData();
    fd.set("enabled", settings?.enabled ? "true" : "false");
    fd.set("timezone", tz);
    startTransition(async () => {
      const result = await saveFollowupSettingsAction(fd);
      notify(result);
      if (result.ok) setSettings((prev) => (prev ? { ...prev, timezone: tz } : null));
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

  // ─── Business hours ────────────────────────────────────────────────────────

  function saveHour(day: number, startTime: string, endTime: string, enabled: boolean) {
    const fd = new FormData();
    fd.set("day_of_week", String(day));
    fd.set("start_time", startTime);
    fd.set("end_time", endTime);
    fd.set("enabled", enabled ? "true" : "false");
    startTransition(async () => {
      const result = await upsertBusinessHoursAction(fd);
      notify(result);
      if (result.ok) {
        setHours((prev) => {
          const idx = prev.findIndex((h) => h.day_of_week === day);
          const updated = { id: "", day_of_week: day, start_time: startTime, end_time: endTime, enabled };
          if (idx >= 0) return prev.map((h, i) => (i === idx ? updated : h));
          return [...prev, updated];
        });
      }
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
        <CardContent>
          <div className="flex items-center gap-3">
            <label className="text-xs text-text-secondary">Fuso horario:</label>
            <select
              className="rounded-lg border border-border bg-white px-2 py-1 text-xs text-text-primary focus:border-brand-green focus:outline-none"
              value={settings?.timezone ?? "America/Sao_Paulo"}
              disabled={isPending}
              onChange={(e) => saveTimezone(e.target.value)}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz.replace("America/", "")}</option>
              ))}
            </select>
          </div>
        </CardContent>
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
              <div key={step.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-green-soft text-xs font-bold text-brand-green-deep">
                  {step.step_order}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-text-muted">
                    Dia {step.delay_days} — Passo {step.step_order}
                  </p>
                  <p className="mt-0.5 text-xs text-text-primary whitespace-pre-wrap line-clamp-3">
                    {step.message_template}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditingStep(step)} disabled={isPending}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" className="text-danger-red hover:text-danger-red" onClick={() => removeStep(step.id)} disabled={isPending}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
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

      {/* ── 3. Business Hours ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <p className="text-sm font-semibold text-text-primary">Horario de Envio</p>
          <p className="text-xs text-text-muted">Follow-ups fora desta janela sao adiados para o proximo horario valido.</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {DAYS.map((dayName, dow) => {
            const h = hours.find((x) => x.day_of_week === dow);
            const enabled = h?.enabled ?? false;
            const startTime = h?.start_time ?? "08:00";
            const endTime   = h?.end_time   ?? "18:00";
            return (
              <DayRow
                key={dow}
                dayName={dayName}
                enabled={enabled}
                startTime={startTime}
                endTime={endTime}
                disabled={isPending}
                onChange={(s, e, en) => saveHour(dow, s, e, en)}
              />
            );
          })}
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
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: blocked ? undefined : tag.color }}
                    />
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
                      Passo {item.step?.step_order ?? "?"} · Agendado para {formatDateTime(item.scheduled_for)}
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

// ─── Sub-components ───────────────────────────────────────────────────────────

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
  const [order, setOrder] = useState(String(step?.step_order ?? ""));
  const [delay, setDelay] = useState(String(step?.delay_days ?? ""));
  const [msg, setMsg] = useState(step?.message_template ?? "");

  function handleSave() {
    const fd = new FormData();
    fd.set("step_order", order);
    fd.set("delay_days", delay);
    fd.set("message_template", msg);
    onSave(fd);
  }

  return (
    <div className="rounded-lg border border-brand-green/40 bg-brand-green-soft/30 p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
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
      </div>
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
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={disabled}>Cancelar</Button>
        <Button size="sm" onClick={handleSave} disabled={disabled || !order || !delay || !msg.trim()}>Salvar</Button>
      </div>
    </div>
  );
}

function DayRow({
  dayName,
  enabled,
  startTime,
  endTime,
  disabled,
  onChange,
}: {
  dayName: string;
  enabled: boolean;
  startTime: string;
  endTime: string;
  disabled: boolean;
  onChange: (start: string, end: string, enabled: boolean) => void;
}) {
  const [localStart, setLocalStart] = useState(startTime);
  const [localEnd, setLocalEnd] = useState(endTime);
  const [localEnabled, setLocalEnabled] = useState(enabled);

  function commit(s: string, e: string, en: boolean) {
    onChange(s, e, en);
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const next = !localEnabled;
          setLocalEnabled(next);
          commit(localStart, localEnd, next);
        }}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
          localEnabled ? "bg-brand-green" : "bg-border"
        )}
      >
        <span className={cn("inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform", localEnabled ? "translate-x-4" : "translate-x-0.5")} />
      </button>
      <span className="w-16 text-xs font-medium text-text-primary">{dayName}</span>
      {localEnabled ? (
        <>
          <input
            type="time"
            className="h-7 rounded-lg border border-border px-1.5 text-xs focus:border-brand-green focus:outline-none"
            value={localStart}
            disabled={disabled}
            onChange={(e) => setLocalStart(e.target.value)}
            onBlur={() => commit(localStart, localEnd, localEnabled)}
          />
          <span className="text-xs text-text-muted">ate</span>
          <input
            type="time"
            className="h-7 rounded-lg border border-border px-1.5 text-xs focus:border-brand-green focus:outline-none"
            value={localEnd}
            disabled={disabled}
            onChange={(e) => setLocalEnd(e.target.value)}
            onBlur={() => commit(localStart, localEnd, localEnabled)}
          />
        </>
      ) : (
        <span className="text-xs text-text-muted">Inativo</span>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
    sending: "bg-blue-50 text-blue-700 border-blue-200",
    sent:    "bg-brand-green-soft text-brand-green-deep border-brand-green/30",
    skipped: "bg-background-subtle text-text-muted border-border",
    failed:  "bg-red-50 text-danger-red border-danger-red/30",
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
    sent:         "bg-brand-green",
    queued:       "bg-blue-400",
    deferred:     "bg-yellow-400",
    skipped:      "bg-gray-300",
    failed:       "bg-danger-red",
    cancelled:    "bg-gray-300",
    cycle_reset:  "bg-purple-400",
  };
  return (
    <div className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", colors[type] ?? "bg-gray-300")} />
  );
}
