"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Copy,
  Download,
  Edit2,
  Edit3,
  Filter,
  Inbox,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatCurrency, formatDate, formatPhone, getInitials } from "@/lib/utils";
import { LOCATION_STATUS_LABELS } from "@/lib/lead-location";
import type { LeadListItem, LeadOptionData } from "./types";
import {
  createLeadAction,
  deleteLeadAction,
  deleteLeadsBulkAction,
  getLeadCustomValuesAction,
  updateLeadAction,
} from "./actions";
import { LeadForm } from "./lead-form";
import { BulkEditModal } from "./bulk-edit-modal";
import { ImportLeadsModal } from "./import-leads-modal";

type EnrichedLead = LeadListItem & {
  no_followup_48h: boolean;
  inbox_conversation_id: string | null;
};

type PaginationInfo = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  from: number;
  to: number;
};

type FilterState = {
  q: string;
  stage: string;
  source: string;
  service: string;
  state: string;
  city: string;
  area: string;
  followup: string;
  sort: string;
  dir: string;
};

type LeadsClientProps = {
  leads: EnrichedLead[];
  options: LeadOptionData;
  locationOptions: { states: string[]; cities: string[] };
  organizationId: string;
  organizationName: string;
  periodLabel: string;
  role: string;
  pagination: PaginationInfo;
  filters: FilterState;
  noFollowupCount: number;
};

export function LeadsClient({
  leads,
  options,
  locationOptions,
  organizationName,
  periodLabel,
  role,
  pagination,
  filters,
  noFollowupCount,
}: LeadsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Local state only for UI that doesn't need URL persistence
  const [searchInput, setSearchInput] = useState(filters.q);
  const searchDebounceRef = useRef<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(
    !!(filters.stage || filters.source || filters.service || filters.state || filters.city || filters.area || filters.followup)
  );
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editingLead, setEditingLead] = useState<LeadListItem | undefined>();
  const [importOpen, setImportOpen] = useState(false);
  const [editingCustomValues, setEditingCustomValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const canBulkDelete = ["super_admin", "gestor_sync", "admin_clinica"].includes(role);

  // ── URL navigation helpers ────────────────────────────────────────────────
  function navigateFilter(updates: Record<string, string | number | undefined>) {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("page"); // always reset to page 1 on filter change
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === "" || value === "all") {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    }
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  function navigatePage(newPage: number) {
    const next = new URLSearchParams(searchParams.toString());
    if (newPage <= 1) {
      next.delete("page");
    } else {
      next.set("page", String(newPage));
    }
    startTransition(() => router.push(`?${next.toString()}`));
  }

  // ── Search with debounce ──────────────────────────────────────────────────
  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = window.setTimeout(() => {
      navigateFilter({ q: value });
    }, 400);
  }

  // ── Sort ──────────────────────────────────────────────────────────────────
  function handleSort(field: string) {
    const newDir = filters.sort === field && filters.dir === "asc" ? "desc" : "asc";
    navigateFilter({ sort: field, dir: newDir });
  }

  function SortIcon({ field }: { field: string }) {
    if (filters.sort !== field) return <ChevronsUpDown className="h-3 w-3 text-text-muted" />;
    return filters.dir === "asc" ? (
      <ChevronUp className="h-3 w-3 text-brand-green" />
    ) : (
      <ChevronDown className="h-3 w-3 text-brand-green" />
    );
  }

  // ── Clear all filters ─────────────────────────────────────────────────────
  function clearFilters() {
    setSearchInput("");
    const next = new URLSearchParams(searchParams.toString());
    for (const key of ["q", "stage", "source", "service", "state", "city", "area", "followup", "page"]) {
      next.delete(key);
    }
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  // ── Bulk selection ────────────────────────────────────────────────────────
  const visibleIds = leads.map((l) => l.id);
  const selectedVisible = visibleIds.filter((id) => selectedIds.has(id));
  const allVisibleSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  const someSelected = selectedVisible.length > 0 && !allVisibleSelected;

  // Drive the select-all checkbox indeterminate state outside render.
  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.checked = allVisibleSelected;
    selectAllRef.current.indeterminate = someSelected;
  }, [allVisibleSelected, someSelected]);

  const selectedCount = selectedVisible.length;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => new Set([...prev, ...visibleIds]));
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function handleBulkDelete() {
    const ids = leads.filter((l) => selectedIds.has(l.id)).map((l) => l.id);
    if (!ids.length) return;
    if (
      !confirm(
        `Tem certeza que deseja apagar ${ids.length} lead${ids.length !== 1 ? "s" : ""}? Esta acao nao pode ser desfeita.`
      )
    )
      return;
    startTransition(async () => {
      const result = await deleteLeadsBulkAction(ids);
      setMessage(result.message);
      if (result.ok) {
        clearSelection();
        router.refresh();
      }
    });
  }

  // ── Active filter count ───────────────────────────────────────────────────
  const activeFilterCount = [
    filters.stage, filters.source, filters.service,
    filters.state, filters.city, filters.area, filters.followup,
  ].filter((v) => v !== "" && v !== "all").length;

  // ── Lead form ─────────────────────────────────────────────────────────────
  function openEdit(lead: LeadListItem) {
    const existingValues = Object.fromEntries(
      (lead.custom_field_values ?? []).map((cv) => [cv.field_id, cv.value ?? ""])
    );
    setEditingCustomValues(existingValues);
    setEditingLead(lead);
    setFormMode("edit");
    if (Object.keys(existingValues).length === 0 && options.customFields.length > 0) {
      startTransition(async () => {
        const values = await getLeadCustomValuesAction(lead.id);
        setEditingCustomValues(values);
      });
    }
  }

  function closeForm() {
    setFormMode(null);
    setEditingLead(undefined);
    setEditingCustomValues({});
  }

  // ── Export CSV (current page) ─────────────────────────────────────────────
  function exportCsv(rows: LeadListItem[]) {
    const fieldNames = options.customFields.map((f) => f.name);
    const headers = [
      "Nome", "Telefone", "Email", "Origem", "Servico", "Procedimento",
      "Etapa", "Valor potencial", "Valor fechado", "Tags", ...fieldNames,
      "Criado em", "Ultima interacao",
    ];

    const csvRows = rows.map((lead) => {
      const leadTagNames = (lead.lead_tags ?? [])
        .map((lt) => (Array.isArray(lt.tags) ? lt.tags[0] : lt.tags)?.name ?? "")
        .filter(Boolean)
        .join("; ");
      const customValueMap = Object.fromEntries(
        (lead.custom_field_values ?? []).map((cv) => [cv.field_id, cv.value ?? ""])
      );
      const customValues = options.customFields.map((f) => customValueMap[f.id] ?? "");
      return [
        lead.name, lead.phone, lead.email ?? "", lead.source?.name ?? "",
        lead.service?.name ?? "", lead.procedure ?? "", lead.stage?.name ?? "",
        lead.potential_value ?? "", lead.closed_value ?? "", leadTagNames,
        ...customValues, lead.created_at, lead.last_interaction_at ?? "",
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",");
    });

    const BOM = "﻿";
    const blob = new Blob([BOM + [headers.join(","), ...csvRows].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `leads-sync-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function copyPhone(phone: string) {
    navigator.clipboard.writeText(phone);
    setMessage("Telefone copiado.");
  }

  function deleteLead(lead: LeadListItem) {
    if (!confirm(`Excluir o lead ${lead.name}? Esta acao nao pode ser desfeita.`)) return;
    startTransition(async () => {
      const result = await deleteLeadAction(lead.id);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  const selectedLeadIds = leads.filter((l) => selectedIds.has(l.id)).map((l) => l.id);

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="label-eyebrow text-text-muted">{organizationName}</p>
          <h1 className="mt-1 text-2xl font-black text-text-primary">Historico de Leads</h1>
          <p className="mt-1 text-xs text-text-muted">Periodo: {periodLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => exportCsv(leads)}>
            <Download className="h-3.5 w-3.5" />
            Exportar pagina
          </Button>
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}>
            <Upload className="h-3.5 w-3.5" />
            Importar
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setFormMode("create")}>
            <Plus className="h-3.5 w-3.5" />
            Novo Lead
          </Button>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <Input
              placeholder="Buscar por nome, telefone, procedimento..."
              className="h-8 pl-8 text-xs"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>
          <Select
            value={filters.stage || "all"}
            onValueChange={(v) => { navigateFilter({ stage: v }); setSelectedIds(new Set()); }}
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="Todas as etapas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as etapas</SelectItem>
              {options.stages.map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={showAdvanced ? "outline" : "ghost"}
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <Filter className="h-3.5 w-3.5" />
            Filtros {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
          </Button>
          <span className={cn("ml-auto text-xs text-text-muted", isPending && "opacity-50")}>
            {pagination.total === 0
              ? "Nenhum lead"
              : `Exibindo ${pagination.from}–${pagination.to} de ${pagination.total} leads`}
          </span>
        </div>

        {showAdvanced && (
          <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-2 lg:grid-cols-3">
            <FilterSelect
              label="Origem"
              value={filters.source || "all"}
              onValueChange={(v) => { navigateFilter({ source: v }); setSelectedIds(new Set()); }}
            >
              <SelectItem value="all">Todas as origens</SelectItem>
              {options.sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </FilterSelect>
            <FilterSelect
              label="Servico"
              value={filters.service || "all"}
              onValueChange={(v) => { navigateFilter({ service: v }); setSelectedIds(new Set()); }}
            >
              <SelectItem value="all">Todos os servicos</SelectItem>
              {options.services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </FilterSelect>
            <FilterSelect
              label="Estado"
              value={filters.state || "all"}
              onValueChange={(v) => { navigateFilter({ state: v }); setSelectedIds(new Set()); }}
            >
              <SelectItem value="all">Todos os estados</SelectItem>
              {locationOptions.states.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </FilterSelect>
            <FilterSelect
              label="Cidade provavel"
              value={filters.city || "all"}
              onValueChange={(v) => { navigateFilter({ city: v }); setSelectedIds(new Set()); }}
            >
              <SelectItem value="all">Todas as cidades</SelectItem>
              {locationOptions.cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </FilterSelect>
            <FilterSelect
              label="Area de atuacao"
              value={filters.area || "all"}
              onValueChange={(v) => { navigateFilter({ area: v }); setSelectedIds(new Set()); }}
            >
              <SelectItem value="all">Todas</SelectItem>
              {Object.entries(LOCATION_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </FilterSelect>
            <FilterSelect
              label="Follow-up"
              value={filters.followup || "all"}
              onValueChange={(v) => { navigateFilter({ followup: v }); setSelectedIds(new Set()); }}
            >
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="no_followup_48h">Sem follow-up 48h+</SelectItem>
            </FilterSelect>
            <div className="flex items-end">
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Limpar filtros
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── No-followup banner ───────────────────────────────────────────────── */}
      {noFollowupCount > 0 && (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-xl border border-warning-amber/30 bg-amber-50 px-4 py-3 text-left text-xs text-amber-800 transition-colors hover:bg-amber-100"
          onClick={() => {
            setShowAdvanced(true);
            navigateFilter({ followup: "no_followup_48h" });
            setSelectedIds(new Set());
          }}
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{noFollowupCount}</strong> lead{noFollowupCount !== 1 ? "s" : ""} com conversa aberta sem follow-up ha mais de 48h.
          </span>
        </button>
      )}

      {/* ── Bulk action bar ──────────────────────────────────────────────────── */}
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-green/30 bg-brand-green-soft px-4 py-3">
          <span className="text-xs font-semibold text-brand-green-deep">
            {selectedCount} lead{selectedCount !== 1 ? "s" : ""} selecionado{selectedCount !== 1 ? "s" : ""}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="gap-1.5"
              disabled={isPending}
              onClick={() => setBulkEditOpen(true)}
            >
              <Edit3 className="h-3.5 w-3.5" />
              Editar selecionados
            </Button>
            {canBulkDelete && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="gap-1.5"
                disabled={isPending}
                onClick={handleBulkDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isPending ? "Apagando..." : "Apagar selecionados"}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5 text-text-secondary"
              onClick={clearSelection}
            >
              <X className="h-3.5 w-3.5" />
              Limpar selecao
            </Button>
          </div>
        </div>
      )}

      {message && (
        <div className="rounded-lg border border-border bg-brand-green-soft px-3 py-2 text-xs font-medium text-brand-green-deep">
          {message}
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1380px] table-fixed text-sm">
            <colgroup>
              <col className="w-12" />
              <col className="w-[300px]" />
              <col className="w-[220px]" />
              <col className="w-[130px]" />
              <col className="w-[160px]" />
              <col className="w-[180px]" />
              <col className="w-[130px]" />
              <col className="w-[110px]" />
              <col className="w-[120px]" />
              <col className="w-[90px]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-background-subtle">
                <th className="w-10 px-3 py-2.5">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    aria-label="Selecionar todos os leads visiveis"
                    className="h-4 w-4 cursor-pointer accent-brand-green"
                    onChange={toggleSelectAll}
                  />
                </th>
                {[
                  { label: "Lead", field: "name" },
                  { label: "Telefone", field: null },
                  { label: "Servico", field: null },
                  { label: "Procedimento", field: "procedure" },
                  { label: "Etapa", field: null },
                  { label: "Origem", field: null },
                  { label: "Valor Pot.", field: "potential_value" },
                  { label: "Entrada", field: "created_at" },
                  { label: "", field: null },
                ].map(({ label, field }) => (
                  <th
                    key={label}
                    className={cn(
                      "px-4 py-2.5 text-left",
                      field && "cursor-pointer select-none hover:bg-background-subtle/80"
                    )}
                    onClick={field ? () => handleSort(field) : undefined}
                  >
                    <div className="flex items-center gap-1">
                      <span className="label-eyebrow whitespace-nowrap">{label}</span>
                      {field && <SortIcon field={field} />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={cn("divide-y divide-border", isPending && "opacity-60")}>
              {leads.map((lead) => {
                const isSelected = selectedIds.has(lead.id);
                return (
                  <tr
                    key={lead.id}
                    className={cn(
                      "group transition-colors",
                      isSelected
                        ? "bg-brand-green-soft/60 hover:bg-brand-green-soft"
                        : "hover:bg-background-subtle/50"
                    )}
                  >
                    <td className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${lead.name}`}
                        checked={isSelected}
                        onChange={() => toggleSelect(lead.id)}
                        className="h-4 w-4 cursor-pointer accent-brand-green"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-green-soft text-[10px] font-bold text-brand-green-deep">
                          {getInitials(lead.name)}
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/leads/${lead.id}`}
                            className="block truncate font-medium leading-none text-text-primary hover:text-brand-green-dark"
                            title={lead.name}
                          >
                            {lead.name}
                          </Link>
                          {lead.email && (
                            <p className="mt-0.5 text-[11px] text-text-muted">{lead.email}</p>
                          )}
                          {lead.no_followup_48h && (
                            <Badge variant="outline" className="mt-1 border-warning-amber/40 bg-amber-50 text-[9px] text-amber-700">
                              Sem follow-up 48h+
                            </Badge>
                          )}
                          {(lead.lead_tags ?? []).length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {(lead.lead_tags ?? []).map((lt) => {
                                const tag = Array.isArray(lt.tags) ? lt.tags[0] : lt.tags;
                                if (!tag) return null;
                                return (
                                  <span
                                    key={tag.id}
                                    className="inline-block rounded-full px-1.5 py-0 text-[9px] font-semibold text-white"
                                    style={{ backgroundColor: tag.color }}
                                  >
                                    {tag.name}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-secondary">
                      <div>{formatPhone(lead.phone)}</div>
                      {(lead.detected_city || lead.detected_state || lead.phone_ddd) && (
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-text-muted">
                          <MapPin className="h-3 w-3" />
                          <span className="truncate">
                            {[lead.detected_city, lead.detected_state].filter(Boolean).join(" / ") || "Localizacao provavel"}
                            {lead.phone_ddd ? ` · DDD ${lead.phone_ddd}` : ""}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="truncate px-4 py-3 text-xs text-text-secondary" title={lead.service?.name ?? undefined}>
                      {lead.service?.name ?? "-"}
                    </td>
                    <td className="truncate px-4 py-3 text-xs text-text-secondary" title={lead.procedure ?? undefined}>
                      {lead.procedure ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={lead.stage ? "green" : "secondary"}
                        className="max-w-full whitespace-nowrap"
                        title={lead.stage?.name ?? "Sem etapa"}
                      >
                        {lead.stage?.name ?? "Sem etapa"}
                      </Badge>
                    </td>
                    <td className="truncate px-4 py-3 text-[11px] text-text-muted" title={lead.source?.name ?? undefined}>
                      {lead.source?.name ?? "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs font-medium text-text-primary">
                      {lead.potential_value ? formatCurrency(lead.potential_value) : "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-text-muted">
                      {formatDate(lead.created_at)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="text-xs font-medium text-brand-green hover:underline"
                        >
                          Ver
                        </Link>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(lead)}>
                              <Edit2 /> Editar lead
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => copyPhone(lead.phone)}>
                              <Copy /> Copiar telefone
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a
                                href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <MessageCircle /> Abrir WhatsApp
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={lead.inbox_conversation_id ? `/inbox?conversation=${lead.inbox_conversation_id}` : `/inbox?lead=${lead.id}`}>
                                <Inbox /> Abrir conversa no Inbox
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => exportCsv([lead])}>
                              <Download /> Exportar este lead
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-danger-red focus:text-danger-red"
                              onClick={() => deleteLead(lead)}
                              disabled={isPending}
                            >
                              <Trash2 /> Excluir lead
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {leads.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-background-subtle">
              <Search className="h-5 w-5 text-text-muted" />
            </div>
            <p className="text-sm font-semibold text-text-secondary">Nenhum lead encontrado</p>
            <p className="mt-1 text-xs text-text-muted">Ajuste os filtros ou adicione um novo lead</p>
          </div>
        )}

        {/* ── Pagination controls ───────────────────────────────────────────── */}
        {pagination.total > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <span className="text-xs text-text-muted">
              {pagination.from}–{pagination.to} de {pagination.total} leads
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={pagination.page <= 1 || isPending}
                onClick={() => navigatePage(pagination.page - 1)}
                aria-label="Pagina anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[4rem] text-center text-xs text-text-secondary">
                {pagination.page} / {pagination.totalPages}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={pagination.page >= pagination.totalPages || isPending}
                onClick={() => navigatePage(pagination.page + 1)}
                aria-label="Proxima pagina"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────────── */}
      <LeadForm
        mode={formMode === "edit" ? "edit" : "create"}
        open={formMode !== null}
        options={options}
        lead={editingLead}
        customValues={editingCustomValues}
        onClose={closeForm}
        onSubmit={(formData) =>
          formMode === "edit" && editingLead
            ? updateLeadAction(editingLead.id, formData)
            : createLeadAction(formData)
        }
      />

      <BulkEditModal
        open={bulkEditOpen}
        count={selectedCount}
        leadIds={selectedLeadIds}
        options={options}
        onClose={() => setBulkEditOpen(false)}
        onSuccess={(msg) => {
          setMessage(msg);
          clearSelection();
          router.refresh();
        }}
      />

      <ImportLeadsModal
        open={importOpen}
        options={options}
        onClose={() => setImportOpen(false)}
        onSuccess={(msg) => {
          setMessage(msg);
          // After import, go back to page 1 to show fresh data
          const next = new URLSearchParams(searchParams.toString());
          next.delete("page");
          startTransition(() => router.replace(`?${next.toString()}`));
        }}
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onValueChange,
  children,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="label-eyebrow text-text-muted">{label}</p>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}
