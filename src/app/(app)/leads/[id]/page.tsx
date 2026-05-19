"use client";

import { use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Phone,
  Mail,
  Tag,
  FileText,
  Clock,
  CheckSquare,
  MessageSquare,
  Edit2,
  MoreHorizontal,
  CalendarClock,
  DollarSign,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { mockLeads } from "@/lib/mock-data/leads";
import {
  formatDate,
  formatDateTime,
  formatCurrency,
  formatPhone,
  getInitials,
} from "@/lib/utils";
import type { LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<LeadStatus, { label: string; color: string }> = {
  new: { label: "Novo", color: "text-text-muted" },
  contacted: { label: "Contactado", color: "text-brand-green" },
  qualified: { label: "Qualificado", color: "text-brand-green-dark" },
  scheduled: { label: "Agendado", color: "text-brand-green-deep" },
  attended: { label: "Compareceu", color: "text-brand-green-deep" },
  closed_won: { label: "Fechado ✓", color: "text-brand-green" },
  closed_lost: { label: "Perdido", color: "text-danger-red" },
  no_show: { label: "Não Compareceu", color: "text-warning-amber" },
};

const mockNotes = [
  {
    id: "note-1",
    author: "Gestor Sync",
    content:
      "Paciente bem informada. Pesquisou em outras clínicas mas quer atendimento mais personalizado. Ponto forte: nosso médico tem mais casos antes/depois de rinoplastia no Instagram.",
    created_at: "2024-05-19T10:30:00Z",
  },
  {
    id: "note-2",
    author: "Atendente Maria",
    content:
      "Enviamos os materiais de apresentação da clínica via WhatsApp. Aguardando resposta.",
    created_at: "2024-05-17T14:20:00Z",
  },
];

const mockTimeline = [
  {
    id: "ev-1",
    type: "status_change",
    description: "Status alterado para Qualificado",
    created_at: "2024-05-19T14:00:00Z",
  },
  {
    id: "ev-2",
    type: "note",
    description: "Nota adicionada pelo Gestor Sync",
    created_at: "2024-05-19T10:30:00Z",
  },
  {
    id: "ev-3",
    type: "message",
    description: "Mensagem recebida via WhatsApp",
    created_at: "2024-05-19T07:45:00Z",
  },
  {
    id: "ev-4",
    type: "created",
    description: "Lead criado via Meta Ads",
    created_at: "2024-05-14T09:30:00Z",
  },
];

const mockTasks = [
  {
    id: "task-1",
    title: "Confirmar agendamento de consulta",
    due_at: "2024-05-20T10:00:00Z",
    completed_at: null,
  },
  {
    id: "task-2",
    title: "Enviar apresentação do médico",
    due_at: "2024-05-18T16:00:00Z",
    completed_at: "2024-05-18T15:30:00Z",
  },
];

const EVENT_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  status_change: { icon: Tag, color: "bg-brand-green-soft text-brand-green-dark" },
  note: { icon: FileText, color: "bg-background-subtle text-text-secondary" },
  message: { icon: MessageSquare, color: "bg-blue-50 text-blue-600" },
  created: { icon: Clock, color: "bg-brand-green-soft text-brand-green-dark" },
};

export default function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const lead = mockLeads.find((l) => l.id === id) ?? mockLeads[0];
  const status = STATUS_CONFIG[lead.status];

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Back + header */}
      <div className="flex items-start gap-4">
        <Link href="/leads">
          <Button variant="ghost" size="icon-sm" className="mt-0.5">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="label-eyebrow text-text-muted">Lead</p>
            <span className={cn("text-[11px] font-semibold", status.color)}>
              · {status.label}
            </span>
          </div>
          <h1 className="text-xl font-black text-text-primary">{lead.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="gap-1.5">
            <Edit2 className="h-3.5 w-3.5" />
            Editar
          </Button>
          <Button variant="ghost" size="icon-sm">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left — lead details */}
        <div className="space-y-4">
          {/* Contact card */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-green-soft text-sm font-bold text-brand-green-deep">
                  {getInitials(lead.name)}
                </div>
                <div>
                  <p className="font-semibold text-text-primary text-sm leading-none">
                    {lead.name}
                  </p>
                  {lead.procedure && (
                    <p className="text-[11px] text-text-muted mt-0.5">
                      {lead.procedure}
                    </p>
                  )}
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
              <Separator />
              {/* Stage */}
              <div>
                <p className="label-eyebrow mb-1.5">Etapa do Funil</p>
                <div className="flex flex-wrap gap-1">
                  {["Novo", "Contactado", "Qualificado", "Agendado", "Compareceu", "Fechado"].map(
                    (stageName) => (
                      <span
                        key={stageName}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          stageName === lead.stage?.name
                            ? "bg-brand-green text-white"
                            : "bg-background-subtle text-text-muted"
                        )}
                      >
                        {stageName}
                      </span>
                    )
                  )}
                </div>
              </div>
              <Separator />
              {/* Meta */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="label-eyebrow mb-0.5">Origem</p>
                  <p className="text-xs text-text-secondary">
                    {lead.source?.name ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="label-eyebrow mb-0.5">Campanha</p>
                  <p className="text-xs text-text-secondary">
                    {lead.campaign?.name ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="label-eyebrow mb-0.5">Valor Pot.</p>
                  <p className="text-xs font-medium text-text-primary">
                    {lead.potential_value
                      ? formatCurrency(lead.potential_value)
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="label-eyebrow mb-0.5">Valor Fechado</p>
                  <p className="text-xs font-medium text-brand-green-dark">
                    {lead.closed_value
                      ? formatCurrency(lead.closed_value)
                      : "—"}
                  </p>
                </div>
              </div>
              <Separator />
              <div>
                <p className="label-eyebrow mb-0.5">Entrada</p>
                <p className="text-xs text-text-secondary">
                  {formatDate(lead.created_at)}
                </p>
              </div>
              {lead.last_interaction_at && (
                <div>
                  <p className="label-eyebrow mb-0.5">Última Interação</p>
                  <p className="text-xs text-text-secondary">
                    {formatDate(lead.last_interaction_at)}
                  </p>
                </div>
              )}
              {/* Tags */}
              {lead.tags && lead.tags.length > 0 && (
                <div>
                  <p className="label-eyebrow mb-1.5">Tags</p>
                  <div className="flex flex-wrap gap-1">
                    {lead.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                        style={{ backgroundColor: tag.color }}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Next action card */}
          {lead.next_action_at && (
            <Card className="border-l-2 border-l-warning-amber">
              <CardContent className="pt-4 space-y-2">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-warning-amber" />
                  <p className="text-xs font-semibold text-text-primary">
                    Próxima Ação
                  </p>
                </div>
                <p className="text-[11px] text-text-muted">
                  {formatDate(lead.next_action_at)}
                </p>
                {lead.next_action_note && (
                  <p className="text-xs text-text-secondary">
                    {lead.next_action_note}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Revenue potential */}
          {lead.potential_value && (
            <Card className="border-l-2 border-l-brand-green">
              <CardContent className="pt-4 flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-green-soft">
                  <DollarSign className="h-4 w-4 text-brand-green-dark" />
                </div>
                <div>
                  <p className="label-eyebrow">Potencial de Receita</p>
                  <p className="text-lg font-black text-text-primary">
                    {formatCurrency(lead.potential_value)}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right — tabs */}
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

            {/* Notes */}
            <TabsContent value="notes" className="space-y-3">
              <Card>
                <CardContent className="pt-4">
                  <textarea
                    placeholder="Adicionar nota interna..."
                    className="w-full min-h-[80px] resize-none rounded-lg border border-border bg-background-subtle p-3 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-brand-green"
                  />
                  <div className="flex justify-end mt-2">
                    <Button size="sm" className="text-xs">
                      Salvar nota
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2">
                {mockNotes.map((note) => (
                  <Card key={note.id}>
                    <CardContent className="pt-4 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-text-primary">
                          {note.author}
                        </p>
                        <p className="text-[10px] text-text-muted">
                          {formatDateTime(note.created_at)}
                        </p>
                      </div>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        {note.content}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* Timeline */}
            <TabsContent value="timeline">
              <Card>
                <CardContent className="pt-4">
                  <div className="relative space-y-0">
                    {mockTimeline.map((event, i) => {
                      const cfg = EVENT_ICONS[event.type] ?? EVENT_ICONS.note;
                      const Icon = cfg.icon;
                      return (
                        <div key={event.id} className="flex gap-3 pb-5">
                          <div className="flex flex-col items-center">
                            <div
                              className={cn(
                                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px]",
                                cfg.color
                              )}
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            {i < mockTimeline.length - 1 && (
                              <div className="mt-1 h-full w-px bg-border" />
                            )}
                          </div>
                          <div className="pt-0.5 pb-1">
                            <p className="text-xs text-text-primary">
                              {event.description}
                            </p>
                            <p className="text-[10px] text-text-muted mt-0.5">
                              {formatDateTime(event.created_at)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tasks */}
            <TabsContent value="tasks" className="space-y-3">
              <div className="flex justify-end">
                <Button size="sm" variant="secondary" className="gap-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" />
                  Nova tarefa
                </Button>
              </div>
              <Card>
                <CardContent className="pt-4 divide-y divide-border">
                  {mockTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center",
                          task.completed_at
                            ? "border-brand-green bg-brand-green"
                            : "border-border"
                        )}
                      >
                        {task.completed_at && (
                          <svg
                            className="h-2.5 w-2.5 text-white"
                            viewBox="0 0 10 10"
                          >
                            <path
                              d="M2 5l3 3 3-4"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              fill="none"
                            />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1">
                        <p
                          className={cn(
                            "text-xs text-text-primary",
                            task.completed_at &&
                              "line-through text-text-muted"
                          )}
                        >
                          {task.title}
                        </p>
                        {task.due_at && (
                          <p className="text-[10px] text-text-muted mt-0.5">
                            Prazo: {formatDate(task.due_at)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

