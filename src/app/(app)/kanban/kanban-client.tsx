"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarCheck, GripVertical, Inbox, MapPin, MessageCircle, Phone, Search, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatCurrency, formatDate, formatPhone, getInitials } from "@/lib/utils";
import { updateLeadStageAction } from "../leads/actions";
import type { LeadListItem, LeadOptionData } from "../leads/types";

type KanbanClientProps = {
  leads: LeadListItem[];
  options: LeadOptionData;
  organizationName: string;
  periodLabel: string;
};

type KanbanColumn = {
  id: string;
  name: string;
  color?: string | null;
  leads: LeadListItem[];
};

const NO_STAGE_ID = "__no_stage__";

export function KanbanClient({ leads, options, organizationName, periodLabel }: KanbanClientProps) {
  const [items, setItems] = useState(leads);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [draggingLeadId, setDraggingLeadId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredLeads = useMemo(() => {
    const query = search.toLowerCase().trim();
    const digits = search.replace(/\D/g, "");

    return items.filter((lead) => {
      const matchesSearch =
        query === "" ||
        lead.name.toLowerCase().includes(query) ||
        lead.phone.includes(digits) ||
        (lead.email?.toLowerCase().includes(query) ?? false) ||
        (lead.procedure?.toLowerCase().includes(query) ?? false) ||
        (lead.service?.name.toLowerCase().includes(query) ?? false);
      const matchesSource = sourceFilter === "all" || lead.source_id === sourceFilter;
      const matchesService = serviceFilter === "all" || lead.service_id === serviceFilter;
      return matchesSearch && matchesSource && matchesService;
    });
  }, [items, search, serviceFilter, sourceFilter]);

  const columns = useMemo<KanbanColumn[]>(() => {
    const stageColumns = options.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      color: stage.color,
      leads: filteredLeads.filter((lead) => lead.stage_id === stage.id),
    }));

    return [
      {
        id: NO_STAGE_ID,
        name: "Sem etapa",
        color: "#94a3b8",
        leads: filteredLeads.filter((lead) => !lead.stage_id),
      },
      ...stageColumns,
    ];
  }, [filteredLeads, options.stages]);

  const totalPotential = useMemo(
    () => filteredLeads.reduce((sum, lead) => sum + Number(lead.potential_value ?? 0), 0),
    [filteredLeads]
  );

  function moveLead(leadId: string, targetStageId: string) {
    const previous = items;
    const normalizedStageId = targetStageId === NO_STAGE_ID ? null : targetStageId;
    const targetStage = options.stages.find((stage) => stage.id === normalizedStageId) ?? null;

    const nextItems = items.map((lead) =>
      lead.id === leadId
        ? {
            ...lead,
            stage_id: normalizedStageId,
            stage: targetStage,
          }
        : lead
    );

    setItems(nextItems);
    setMessage(null);

    startTransition(async () => {
      const result = await updateLeadStageAction(leadId, normalizedStageId ?? "");
      if (!result.ok) {
        setItems(previous);
      }
      setMessage(result.message);
    });
  }

  function handleDrop(targetStageId: string) {
    if (!draggingLeadId) return;
    const lead = items.find((item) => item.id === draggingLeadId);
    if (!lead) return;
    const currentStageId = lead.stage_id ?? NO_STAGE_ID;
    if (currentStageId !== targetStageId) {
      moveLead(draggingLeadId, targetStageId);
    }
    setDraggingLeadId(null);
    setDropTargetId(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-eyebrow text-text-muted">{organizationName}</p>
          <h1 className="mt-1 text-2xl font-black text-text-primary">Kanban do Funil</h1>
          <p className="mt-1 text-xs text-text-muted">Periodo: {periodLabel}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <SummaryPill label="Leads" value={filteredLeads.length.toString()} />
          <SummaryPill label="Valor potencial" value={formatCurrency(totalPotential)} />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar lead por nome, telefone, email ou procedimento..."
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue placeholder="Todas as origens" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as origens</SelectItem>
              {options.sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={serviceFilter} onValueChange={setServiceFilter}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue placeholder="Todos os servicos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os servicos</SelectItem>
              {options.services.map((service) => (
                <SelectItem key={service.id} value={service.id}>
                  {service.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(search || sourceFilter !== "all" || serviceFilter !== "all") && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch("");
                setSourceFilter("all");
                setServiceFilter("all");
              }}
            >
              Limpar
            </Button>
          )}
        </div>
      </div>

      {message && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-xs font-medium",
            message.toLowerCase().includes("erro")
              ? "border-danger-red/20 bg-danger-soft text-danger-red"
              : "border-brand-green/20 bg-brand-green-soft text-brand-green-deep"
          )}
        >
          {message}
        </div>
      )}

      <div className="min-h-[620px] overflow-x-scroll pb-3">
        <div className="flex min-w-max gap-4">
          {columns.map((column) => (
            <section
              key={column.id}
              onDragOver={(event) => {
                event.preventDefault();
                setDropTargetId(column.id);
              }}
              onDragLeave={() => setDropTargetId(null)}
              onDrop={() => handleDrop(column.id)}
              className={cn(
                "flex h-[calc(100vh-250px)] min-h-[560px] w-72 flex-col rounded-xl border bg-white shadow-card transition-colors",
                dropTargetId === column.id ? "border-brand-green bg-brand-green-soft/40" : "border-border"
              )}
            >
              <div className="shrink-0 border-b border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: column.color ?? "#22c55e" }}
                      />
                      <h2 className="truncate text-sm font-bold text-text-primary">{column.name}</h2>
                    </div>
                    <p className="mt-1 text-[11px] text-text-muted">
                      {column.leads.length} lead{column.leads.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Badge variant="secondary">{column.leads.length}</Badge>
                </div>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {column.leads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    stages={options.stages}
                    isDragging={draggingLeadId === lead.id}
                    disabled={isPending}
                    onDragStart={() => setDraggingLeadId(lead.id)}
                    onDragEnd={() => {
                      setDraggingLeadId(null);
                      setDropTargetId(null);
                    }}
                    onStageChange={(stageId) => moveLead(lead.id, stageId)}
                  />
                ))}

                {column.leads.length === 0 && (
                  <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border bg-background-subtle/50 text-center text-xs text-text-muted">
                    Arraste leads para esta etapa
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3 shadow-card">
      <p className="label-eyebrow text-text-muted">{label}</p>
      <p className="mt-1 text-lg font-black text-text-primary">{value}</p>
    </div>
  );
}

function LeadCard({
  lead,
  stages,
  isDragging,
  disabled,
  onDragStart,
  onDragEnd,
  onStageChange,
}: {
  lead: LeadListItem;
  stages: LeadOptionData["stages"];
  isDragging: boolean;
  disabled: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onStageChange: (stageId: string) => void;
}) {
  return (
    <article
      draggable={!disabled}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", lead.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "rounded-lg border border-border bg-white p-3 shadow-sm transition-all hover:border-brand-green/40 hover:shadow-card",
        disabled && "cursor-wait opacity-70",
        !disabled && "cursor-grab active:cursor-grabbing",
        isDragging && "scale-[0.98] opacity-60"
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green-soft text-[11px] font-bold text-brand-green-deep">
          {getInitials(lead.name)}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/leads/${lead.id}`}
            className="line-clamp-2 text-sm font-bold leading-snug text-text-primary hover:text-brand-green-dark"
          >
            {lead.name}
          </Link>
          <div className="mt-1 flex items-center gap-1.5">
            <p className="flex items-center gap-1 text-[11px] text-text-muted">
              <Phone className="h-3 w-3" />
              {formatPhone(lead.phone)}
            </p>
            <a
              href={`https://web.whatsapp.com/send?phone=${lead.phone.replace(/\D/g, "")}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="ml-auto flex h-5 w-5 items-center justify-center rounded-md text-green-600 hover:bg-green-50 hover:text-green-700"
              title="Abrir no WhatsApp Web"
            >
              <MessageCircle className="h-3 w-3" />
            </a>
          </div>
        </div>
        <GripVertical className="mt-1 h-4 w-4 shrink-0 text-text-muted" />
      </div>

      <div className="mt-3 space-y-1.5 text-[11px] text-text-secondary">
        {lead.procedure && (
          <p className="flex items-center gap-1.5">
            <UserRound className="h-3 w-3 text-text-muted" />
            <span className="truncate">{lead.procedure}</span>
          </p>
        )}
        {(lead.detected_city || lead.detected_state || lead.phone_ddd) && (
          <p className="flex items-center gap-1.5">
            <MapPin className="h-3 w-3 text-text-muted" />
            <span className="truncate">
              {[lead.detected_city, lead.detected_state].filter(Boolean).join(" / ") || "Localizacao provavel"}
              {lead.phone_ddd ? ` - DDD ${lead.phone_ddd}` : ""}
            </span>
          </p>
        )}
        <p className="flex items-center gap-1.5">
          <CalendarCheck className="h-3 w-3 text-text-muted" />
          Entrada {formatDate(lead.created_at)}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {lead.source?.name && <Badge variant="secondary">{lead.source.name}</Badge>}
        {lead.potential_value ? <Badge variant="outline">{formatCurrency(lead.potential_value)}</Badge> : null}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Select value={lead.stage_id ?? NO_STAGE_ID} onValueChange={onStageChange} disabled={disabled}>
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_STAGE_ID}>Sem etapa</SelectItem>
            {stages.map((stage) => (
              <SelectItem key={stage.id} value={stage.id}>
                {stage.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Link
          href={`/inbox?lead=${lead.id}`}
          onClick={(e) => e.stopPropagation()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background-subtle text-text-muted hover:border-brand-green/40 hover:text-brand-green-dark"
          title="Ver conversa no Inbox"
        >
          <Inbox className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}
