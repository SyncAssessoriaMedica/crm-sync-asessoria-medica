"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarCheck,
  ChevronDown,
  GripVertical,
  Inbox,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  UserRound,
} from "lucide-react";
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
import { loadMoreKanbanLeadsAction } from "./actions";
import type { LeadListItem, LeadOptionData } from "../leads/types";
import type { KanbanColumnData } from "./page";

const NO_STAGE_ID = "__no_stage__";

type ColumnState = KanbanColumnData & {
  offset: number;
  hasMore: boolean;
  loading: boolean;
};

type KanbanClientProps = {
  initialColumns: KanbanColumnData[];
  options: LeadOptionData;
  organizationName: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  currentFilters: { source: string; service: string; q: string };
};

export function KanbanClient({
  initialColumns,
  options,
  organizationName,
  periodLabel,
  periodStart,
  periodEnd,
  currentFilters,
}: KanbanClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navPending, startNavTransition] = useTransition();
  const [movePending, startMoveTransition] = useTransition();

  const [columns, setColumns] = useState<ColumnState[]>(() =>
    initialColumns.map((col) => ({
      ...col,
      offset: col.leads.length,
      hasMore: col.leads.length === 50,
      loading: false,
    }))
  );
  const [message, setMessage] = useState<string | null>(null);
  const [draggingLeadId, setDraggingLeadId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Local search input (debounced to URL)
  const [searchInput, setSearchInput] = useState(currentFilters.q);
  const searchDebounceRef = useRef<number | null>(null);

  const prevColumnsRef = useRef<ColumnState[] | null>(null);

  // ── URL navigation ────────────────────────────────────────────────────────
  function navigateFilter(updates: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === "all") next.delete(key);
      else next.set(key, value);
    }
    startNavTransition(() => router.replace(`?${next.toString()}`));
  }

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = window.setTimeout(() => {
      navigateFilter({ q: value });
    }, 400);
  }

  // ── Load more for a column ────────────────────────────────────────────────
  async function loadMoreColumn(colIndex: number) {
    const col = columns[colIndex];
    if (col.loading || !col.hasMore) return;

    setColumns((prev) =>
      prev.map((c, i) => (i === colIndex ? { ...c, loading: true } : c))
    );

    const result = await loadMoreKanbanLeadsAction(
      col.stageId,
      col.offset,
      periodStart,
      periodEnd,
      currentFilters.source,
      currentFilters.service,
      currentFilters.q,
    );

    setColumns((prev) =>
      prev.map((c, i) => {
        if (i !== colIndex) return c;
        return {
          ...c,
          leads: [...c.leads, ...result.leads],
          offset: c.offset + result.leads.length,
          hasMore: result.hasMore,
          loading: false,
        };
      })
    );
  }

  // ── Move lead between columns ─────────────────────────────────────────────
  function findLead(leadId: string): { lead: LeadListItem; stageId: string | null } | null {
    for (const col of columns) {
      const lead = col.leads.find((l) => l.id === leadId);
      if (lead) return { lead, stageId: col.stageId };
    }
    return null;
  }

  function moveLead(leadId: string, targetStageId: string) {
    const found = findLead(leadId);
    if (!found) return;

    const { lead, stageId: fromStageId } = found;
    const normalizedTarget = targetStageId === NO_STAGE_ID ? null : targetStageId;
    if (fromStageId === normalizedTarget) return;

    const targetStage = options.stages.find((s) => s.id === normalizedTarget) ?? null;
    const updatedLead = { ...lead, stage_id: normalizedTarget, stage: targetStage };

    setColumns((prev) => {
      prevColumnsRef.current = prev;
      return prev.map((col) => {
        if (col.stageId === fromStageId) {
          return { ...col, leads: col.leads.filter((l) => l.id !== leadId), total: col.total - 1 };
        }
        if (col.stageId === normalizedTarget) {
          return { ...col, leads: [updatedLead, ...col.leads], total: col.total + 1 };
        }
        return col;
      });
    });

    setMessage(null);

    startMoveTransition(async () => {
      const result = await updateLeadStageAction(leadId, normalizedTarget ?? "");
      if (!result.ok && prevColumnsRef.current) {
        setColumns(prevColumnsRef.current);
      }
      setMessage(result.message);
    });
  }

  function handleDrop(targetStageId: string) {
    if (!draggingLeadId) return;
    const found = findLead(draggingLeadId);
    if (!found) return;
    const currentStageId = found.stageId ?? NO_STAGE_ID;
    if (currentStageId !== targetStageId) {
      moveLead(draggingLeadId, targetStageId);
    }
    setDraggingLeadId(null);
    setDropTargetId(null);
  }

  // ── Computed totals ───────────────────────────────────────────────────────
  const totalLeads = columns.reduce((sum, col) => sum + col.total, 0);
  const totalPotential = columns.reduce(
    (sum, col) => sum + col.leads.reduce((s, l) => s + Number(l.potential_value ?? 0), 0),
    0
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-eyebrow text-text-muted">{organizationName}</p>
          <h1 className="mt-1 text-2xl font-black text-text-primary">Kanban do Funil</h1>
          <p className="mt-1 text-xs text-text-muted">Periodo: {periodLabel}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <SummaryPill label="Leads" value={totalLeads.toString()} />
          <SummaryPill label="Valor potencial" value={formatCurrency(totalPotential)} />
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <Input
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Buscar lead por nome, telefone ou procedimento..."
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Select
            value={currentFilters.source || "all"}
            onValueChange={(v) => navigateFilter({ source: v })}
          >
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue placeholder="Todas as origens" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as origens</SelectItem>
              {options.sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={currentFilters.service || "all"}
            onValueChange={(v) => navigateFilter({ service: v })}
          >
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue placeholder="Todos os servicos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os servicos</SelectItem>
              {options.services.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(searchInput || currentFilters.source || currentFilters.service) && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearchInput("");
                navigateFilter({ source: undefined, service: undefined, q: undefined });
              }}
            >
              Limpar
            </Button>
          )}
          {navPending && (
            <Loader2 className="ml-auto h-4 w-4 animate-spin text-text-muted" />
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

      {/* ── Kanban board ─────────────────────────────────────────────────────── */}
      <div className="min-h-[620px] overflow-x-scroll pb-3">
        <div className="flex min-w-max gap-4">
          {columns.map((column, colIndex) => {
            const colId = column.stageId ?? NO_STAGE_ID;
            return (
              <section
                key={colId}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropTargetId(colId);
                }}
                onDragLeave={() => setDropTargetId(null)}
                onDrop={() => handleDrop(colId)}
                className={cn(
                  "flex h-[calc(100vh-250px)] min-h-[560px] w-72 flex-col rounded-xl border bg-white shadow-card transition-colors",
                  dropTargetId === colId ? "border-brand-green bg-brand-green-soft/40" : "border-border"
                )}
              >
                {/* Column header */}
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
                        {column.total} lead{column.total === 1 ? "" : "s"} no total
                        {column.leads.length < column.total && ` · ${column.leads.length} carregado${column.leads.length === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    <Badge variant="secondary">{column.total}</Badge>
                  </div>
                </div>

                {/* Column cards */}
                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                  {column.leads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      stages={options.stages}
                      isDragging={draggingLeadId === lead.id}
                      disabled={movePending}
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

                  {/* Load more button */}
                  {column.hasMore && (
                    <button
                      type="button"
                      onClick={() => loadMoreColumn(colIndex)}
                      disabled={column.loading}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs text-text-muted transition-colors hover:border-brand-green/40 hover:text-brand-green-dark disabled:opacity-50"
                    >
                      {column.loading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                      {column.loading ? "Carregando..." : `Carregar mais (${column.total - column.leads.length} restantes)`}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
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
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", lead.id);
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
              <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
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
