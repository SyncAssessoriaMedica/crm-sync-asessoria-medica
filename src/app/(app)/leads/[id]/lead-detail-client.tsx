"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckSquare,
  Clock,
  Copy,
  DollarSign,
  Download,
  Edit2,
  FileText,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  PauseCircle,
  Phone,
  PlayCircle,
  Plus,
  Tag,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  cn,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPhone,
  getInitials,
} from "@/lib/utils";
import { LOCATION_CONFIDENCE_LABELS, LOCATION_STATUS_LABELS } from "@/lib/lead-location";
import { AppointmentScheduler } from "@/components/leads/appointment-scheduler";
import type {
  LeadEventItem,
  LeadListItem,
  LeadNoteItem,
  LeadOptionData,
  LeadTaskItem,
} from "../types";
import {
  addNoteAction,
  addTaskAction,
  applyTagToLeadAction,
  deleteLeadAction,
  removeTagFromLeadAction,
  toggleTaskAction,
  updateLeadAction,
  updateLeadSourceAction,
  updateLeadStageAction,
} from "../actions";
import { toggleLeadFollowupPausedAction } from "../../follow-up/actions";
import { LeadForm } from "../lead-form";

const EVENT_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  status_changed: { icon: Tag, color: "bg-brand-green-soft text-brand-green-dark" },
  stage_changed: { icon: Tag, color: "bg-brand-green-soft text-brand-green-dark" },
  created: { icon: Clock, color: "bg-brand-green-soft text-brand-green-dark" },
  note: { icon: FileText, color: "bg-background-subtle text-text-secondary" },
  message: { icon: MessageSquare, color: "bg-blue-50 text-blue-600" },
};

const DEFAULT_WEBHOOK_FIELD_KEYS = ["campanha", "conjunto", "criativo"];

type TagItem = { id: string; name: string; color: string };

type LeadDetailClientProps = {
  lead: LeadListItem;
  options: LeadOptionData;
  leadTags: TagItem[];
  notes: LeadNoteItem[];
  events: LeadEventItem[];
  tasks: LeadTaskItem[];
  customValues: Record<string, string>;
};

export function LeadDetailClient({ lead, options, leadTags: initialLeadTags, notes, events, tasks, customValues }: LeadDetailClientProps) {
  const router = useRouter();
  const [leadTags, setLeadTags] = useState<TagItem[]>(initialLeadTags);
  const [editOpen, setEditOpen] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [followupPaused, setFollowupPaused] = useState(lead.followup_paused);
  const webhookFields = options.customFields.filter((field) => DEFAULT_WEBHOOK_FIELD_KEYS.includes(field.key));
  const otherCustomFields = options.customFields.filter((field) => !DEFAULT_WEBHOOK_FIELD_KEYS.includes(field.key) && field.key !== "servico");
  const hasWebhookData = webhookFields.some((field) => formatCustomValue(customValues[field.id]));
  const hasOtherCustomData = otherCustomFields.some((field) => formatCustomValue(customValues[field.id]));

  function exportLead() {
    const row = [
      "Nome,Telefone,Email,Origem,Servico,Procedimento,Etapa,Valor potencial,Valor fechado,Criado em",
      [
        lead.name,
        lead.phone,
        lead.email ?? "",
        lead.source?.name ?? "",
        lead.service?.name ?? "",
        lead.procedure ?? "",
        lead.stage?.name ?? "",
        lead.potential_value ?? "",
        lead.closed_value ?? "",
        lead.created_at,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    ].join("\n");
    const blob = new Blob([row], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lead-${lead.name.toLowerCase().replace(/\s+/g, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function saveNote() {
    const formData = new FormData();
    formData.set("lead_id", lead.id);
    formData.set("content", noteContent);
    startTransition(async () => {
      const result = await addNoteAction(formData);
      setMessage(result.message);
      if (result.ok) setNoteContent("");
    });
  }

  function createTask() {
    const formData = new FormData();
    formData.set("lead_id", lead.id);
    formData.set("title", taskTitle);
    formData.set("due_at", taskDueAt);
    startTransition(async () => {
      const result = await addTaskAction(formData);
      setMessage(result.message);
      if (result.ok) {
        setTaskTitle("");
        setTaskDueAt("");
      }
    });
  }

  function removeLead() {
    if (!confirm(`Excluir o lead ${lead.name}? Esta acao nao pode ser desfeita.`)) return;
    startTransition(async () => {
      const result = await deleteLeadAction(lead.id);
      setMessage(result.message);
      if (result.ok) window.location.href = "/leads";
    });
  }

  function changeSource(sourceId: string) {
    startTransition(async () => {
      const result = await updateLeadSourceAction(lead.id, sourceId === "none" ? "" : sourceId);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-start gap-4">
        <Link href="/leads">
          <Button variant="ghost" size="icon-sm" className="mt-0.5">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="label-eyebrow text-text-muted">Lead</p>
            <span className="text-[11px] font-semibold text-brand-green-dark">
              {lead.stage?.name ? `· ${lead.stage.name}` : "· Sem etapa"}
            </span>
          </div>
          <h1 className="text-xl font-black text-text-primary">{lead.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <AppointmentScheduler
            leadId={lead.id}
            appointmentScheduledAt={lead.appointment_scheduled_at}
            className="gap-1.5"
            onResult={(resultMessage) => setMessage(resultMessage)}
            onSuccess={() => router.refresh()}
          />
          <Button variant="outline" size="sm" className="gap-1.5 border-green-500 text-green-700 hover:bg-green-50 hover:text-green-800" asChild>
            <a href={`https://web.whatsapp.com/send?phone=${lead.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
              <MessageCircle className="h-3.5 w-3.5" />
              WhatsApp Web
            </a>
          </Button>
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => setEditOpen(true)}>
            <Edit2 className="h-3.5 w-3.5" />
            Editar
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigator.clipboard.writeText(lead.phone)}>
                <Copy /> Copiar telefone
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                  <MessageCircle /> Abrir WhatsApp
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportLead}>
                <Download /> Exportar lead
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-danger-red focus:text-danger-red" onClick={removeLead}>
                <Trash2 /> Excluir lead
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-border bg-brand-green-soft px-3 py-2 text-xs font-medium text-brand-green-deep">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-green-soft text-sm font-bold text-brand-green-deep">
                  {getInitials(lead.name)}
                </div>
                <div>
                  <p className="text-sm font-semibold leading-none text-text-primary">{lead.name}</p>
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    {[lead.service?.name, lead.procedure].filter(Boolean).join(" · ") || "Sem servico definido"}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-xs">
                <Phone className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                <span className="text-text-secondary">{formatPhone(lead.phone)}</span>
              </div>
              {lead.email && (
                <div className="flex items-center gap-2 text-xs">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <span className="text-text-secondary">{lead.email}</span>
                </div>
              )}
              {(lead.detected_city || lead.detected_state || lead.phone_ddd) && (
                <div className="rounded-lg border border-border bg-background-subtle p-3">
                  <div className="mb-2 flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-brand-green-dark" />
                    <p className="label-eyebrow text-brand-green-dark">Localizacao</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Meta
                      label="Cidade"
                      value={[lead.detected_city, lead.detected_state].filter(Boolean).join(" / ") || undefined}
                    />
                    <Meta label="DDD" value={lead.phone_ddd ? `DDD ${lead.phone_ddd}` : undefined} />
                    <Meta label="Area" value={LOCATION_STATUS_LABELS[lead.service_area_status]} />
                    <Meta label="Confianca" value={LOCATION_CONFIDENCE_LABELS[lead.location_confidence]} />
                  </div>
                  {lead.location_manually_edited && (
                    <p className="mt-2 text-[10px] font-semibold text-text-muted">Localizacao ajustada manualmente.</p>
                  )}
                </div>
              )}
              <Separator />
              <Meta
                label="Consulta agendada"
                value={lead.appointment_scheduled_at ? formatDateTime(lead.appointment_scheduled_at) : undefined}
                strong
              />
              <Separator />
              <div>
                <p className="label-eyebrow mb-1.5">Etapa do Funil</p>
                <div className="grid grid-cols-2 gap-2">
                  {options.stages.map((stage) => {
                    const active = lead.stage_id === stage.id;
                    return (
                      <button
                        key={stage.id}
                        type="button"
                        disabled={isPending || active}
                        onClick={() => {
                          startTransition(async () => {
                            const result = await updateLeadStageAction(lead.id, stage.id);
                            setMessage(result.message);
                          });
                        }}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors",
                          active
                            ? "border-brand-green bg-brand-green-soft text-brand-green-deep"
                            : "border-border bg-white text-text-secondary hover:border-brand-green hover:text-brand-green-dark",
                          isPending && "cursor-wait opacity-70"
                        )}
                      >
                        {stage.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <p className="label-eyebrow text-text-muted">Origem</p>
                  <Select
                    defaultValue={lead.source_id ?? "none"}
                    onValueChange={changeSource}
                    disabled={isPending}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem origem</SelectItem>
                      {options.sources
                        .filter((source) => source.active !== false || source.id === lead.source_id)
                        .map((source) => (
                          <SelectItem key={source.id} value={source.id}>
                            {source.name}{source.active === false ? " (inativa)" : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <Meta label="Valor Pot." value={lead.potential_value ? formatCurrency(lead.potential_value) : undefined} strong />
                <Meta label="Valor Fechado" value={lead.closed_value ? formatCurrency(lead.closed_value) : undefined} strong />
                <Meta label="Servico" value={lead.service?.name ?? undefined} strong />
              </div>
              {options.tags.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="label-eyebrow mb-2">Tags</p>
                    <div className="flex flex-wrap gap-1.5">
                      {leadTags.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
                          style={{ backgroundColor: tag.color }}
                        >
                          {tag.name}
                          <button
                            type="button"
                            className="ml-0.5 hover:opacity-70"
                            onClick={() => {
                              startTransition(async () => {
                                const result = await removeTagFromLeadAction(lead.id, tag.id);
                                if (result.ok) setLeadTags((prev) => prev.filter((t) => t.id !== tag.id));
                                setMessage(result.message);
                              });
                            }}
                          >
                            <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="currentColor">
                              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          </button>
                        </span>
                      ))}
                      {options.tags.filter((t) => !leadTags.some((lt) => lt.id === t.id)).map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-[11px] text-text-muted hover:border-brand-green hover:text-brand-green-dark"
                          onClick={() => {
                            startTransition(async () => {
                              const result = await applyTagToLeadAction(lead.id, tag.id);
                              if (result.ok) setLeadTags((prev) => [...prev, tag]);
                              setMessage(result.message);
                            });
                          }}
                        >
                          + {tag.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <Separator />
              <div>
                <p className="label-eyebrow mb-1.5">Follow-up Automatico</p>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    startTransition(async () => {
                      const result = await toggleLeadFollowupPausedAction(lead.id, !followupPaused);
                      setMessage(result.message);
                      if (result.ok) setFollowupPaused((p) => !p);
                    });
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60",
                    followupPaused
                      ? "border-brand-green/40 bg-brand-green-soft text-brand-green-deep hover:bg-brand-green/20"
                      : "border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
                  )}
                >
                  {followupPaused ? (
                    <><PlayCircle className="h-3.5 w-3.5" /> Retomar follow-up</>
                  ) : (
                    <><PauseCircle className="h-3.5 w-3.5" /> Pausar follow-up</>
                  )}
                </button>
              </div>
              <Separator />
              <Meta label="Entrada" value={formatDate(lead.created_at)} />
              {lead.last_interaction_at && <Meta label="Ultima Interacao" value={formatDate(lead.last_interaction_at)} />}
            </CardContent>
          </Card>

          {lead.potential_value && (
            <Card className="border-l-2 border-l-brand-green">
              <CardContent className="flex items-center gap-3 pt-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-green-soft">
                  <DollarSign className="h-4 w-4 text-brand-green-dark" />
                </div>
                <div>
                  <p className="label-eyebrow">Potencial de Receita</p>
                  <p className="text-lg font-black text-text-primary">{formatCurrency(lead.potential_value)}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {(webhookFields.length > 0 || otherCustomFields.length > 0) && (
            <Card>
              <CardHeader className="pb-2">
                <p className="label-eyebrow text-text-muted">Dados recebidos</p>
                <h2 className="text-sm font-black text-text-primary">Parametros do lead</h2>
              </CardHeader>
              <CardContent className="space-y-4">
                {webhookFields.length > 0 && (
                  <div className="grid grid-cols-1 gap-3">
                    {webhookFields.map((field) => (
                      <Meta key={field.id} label={field.name} value={formatCustomValue(customValues[field.id])} />
                    ))}
                  </div>
                )}
                {!hasWebhookData && webhookFields.length > 0 && (
                  <p className="rounded-lg border border-border bg-background-subtle px-3 py-2 text-xs text-text-muted">
                    Nenhum parametro padrao recebido para este lead.
                  </p>
                )}
                {otherCustomFields.length > 0 && (
                  <>
                    {webhookFields.length > 0 && <Separator />}
                    <div>
                      <p className="label-eyebrow mb-2 text-text-muted">Outros campos</p>
                      <div className="grid grid-cols-2 gap-3">
                        {otherCustomFields.map((field) => (
                          <Meta key={field.id} label={field.name} value={formatCustomValue(customValues[field.id])} />
                        ))}
                      </div>
                    </div>
                    {!hasOtherCustomData && (
                      <p className="rounded-lg border border-border bg-background-subtle px-3 py-2 text-xs text-text-muted">
                        Nenhum outro campo preenchido.
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2">
          <Tabs defaultValue="notes">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="notes" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Notas
              </TabsTrigger>
              <TabsTrigger value="timeline" className="gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Timeline
              </TabsTrigger>
              <TabsTrigger value="tasks" className="gap-1.5">
                <CheckSquare className="h-3.5 w-3.5" />
                Tarefas
              </TabsTrigger>
            </TabsList>

            <TabsContent value="notes" className="space-y-3">
              <Card>
                <CardContent className="pt-4">
                  <textarea
                    placeholder="Adicionar nota interna..."
                    className="min-h-[80px] w-full resize-none rounded-lg border border-border bg-background-subtle p-3 text-xs text-text-primary placeholder:text-text-muted focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green"
                    value={noteContent}
                    onChange={(event) => setNoteContent(event.target.value)}
                  />
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" className="text-xs" onClick={saveNote} disabled={isPending || !noteContent.trim()}>
                      Salvar nota
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2">
                {notes.length === 0 && <EmptyLine text="Nenhuma nota registrada." />}
                {notes.map((note) => (
                  <Card key={note.id}>
                    <CardContent className="space-y-1.5 pt-4">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-text-primary">
                          {note.author?.full_name ?? note.author?.email ?? "Equipe Sync"}
                        </p>
                        <p className="text-[10px] text-text-muted">{formatDateTime(note.created_at)}</p>
                      </div>
                      <p className="text-xs leading-relaxed text-text-secondary">{note.content}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="timeline">
              <Card>
                <CardContent className="pt-4">
                  {events.length === 0 && <EmptyLine text="Nenhum evento registrado." />}
                  {events.map((event, i) => {
                    const cfg = EVENT_ICONS[event.event_type] ?? EVENT_ICONS.note;
                    const Icon = cfg.icon;
                    return (
                      <div key={event.id} className="flex gap-3 pb-5">
                        <div className="flex flex-col items-center">
                          <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px]", cfg.color)}>
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          {i < events.length - 1 && <div className="mt-1 h-full w-px bg-border" />}
                        </div>
                        <div className="pb-1 pt-0.5">
                          <p className="text-xs text-text-primary">{event.description}</p>
                          <p className="mt-0.5 text-[10px] text-text-muted">{formatDateTime(event.created_at)}</p>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="tasks" className="space-y-3">
              <Card>
                <CardContent className="grid gap-3 pt-4 md:grid-cols-[1fr_220px_auto]">
                  <input
                    className="h-9 rounded-lg border border-border px-3 text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green"
                    placeholder="Nova tarefa"
                    value={taskTitle}
                    onChange={(event) => setTaskTitle(event.target.value)}
                  />
                  <input
                    type="datetime-local"
                    className="h-9 rounded-lg border border-border px-3 text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green"
                    value={taskDueAt}
                    onChange={(event) => setTaskDueAt(event.target.value)}
                  />
                  <Button onClick={createTask} disabled={isPending || !taskTitle.trim()}>
                    <Plus className="h-3.5 w-3.5" />
                    Criar
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="divide-y divide-border pt-4">
                  {tasks.length === 0 && <EmptyLine text="Nenhuma tarefa registrada." />}
                  {tasks.map((task) => (
                    <button
                      key={task.id}
                      className="flex w-full items-start gap-3 py-3 text-left first:pt-0 last:pb-0"
                      onClick={() => {
                        startTransition(async () => {
                          const result = await toggleTaskAction(task.id, lead.id, !task.completed_at);
                          setMessage(result.message);
                        });
                      }}
                    >
                      <div
                        className={cn(
                          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2",
                          task.completed_at ? "border-brand-green bg-brand-green" : "border-border"
                        )}
                      >
                        {task.completed_at && (
                          <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10">
                            <path d="M2 5l3 3 3-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className={cn("text-xs text-text-primary", task.completed_at && "text-text-muted line-through")}>{task.title}</p>
                        {task.due_at && <p className="mt-0.5 text-[10px] text-text-muted">Prazo: {formatDate(task.due_at)}</p>}
                      </div>
                    </button>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <LeadForm
        mode="edit"
        open={editOpen}
        options={options}
        lead={lead}
        customValues={customValues}
        onClose={() => setEditOpen(false)}
        onSubmit={(formData) => updateLeadAction(lead.id, formData)}
      />
    </div>
  );
}

function formatCustomValue(value?: string) {
  if (!value) return undefined;
  if (value === "true") return "Sim";
  if (value === "false") return "Nao";
  return value;
}

function Meta({ label, value, strong }: { label: string; value?: string; strong?: boolean }) {
  return (
    <div>
      <p className="label-eyebrow mb-0.5">{label}</p>
      <p className={cn("text-xs text-text-secondary", strong && "font-medium text-text-primary")}>{value ?? "-"}</p>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="py-4 text-center text-xs text-text-muted">{text}</p>;
}
