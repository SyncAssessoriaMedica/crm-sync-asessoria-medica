"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ChevronDown,
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
import { createClient } from "@/lib/supabase/client";
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

type LeadsClientProps = {
  leads: LeadListItem[];
  options: LeadOptionData;
  organizationId: string;
  organizationName: string;
  periodLabel: string;
  role: string;
};

export function LeadsClient({ leads, options, organizationId, organizationName, periodLabel, role }: LeadsClientProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [followupFilter, setFollowupFilter] = useState("all");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sortField, setSortField] = useState<keyof LeadListItem>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editingLead, setEditingLead] = useState<LeadListItem | undefined>();
  const [editingCustomValues, setEditingCustomValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    let refreshTimer: number | null = null;

    const refreshSoon = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        if (document.visibilityState === "visible") router.refresh();
      }, 500);
    };

    const channel = supabase
      .channel(`leads-live-${organizationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `organization_id=eq.${organizationId}` },
        refreshSoon
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "webhook_events", filter: `organization_id=eq.${organizationId}` },
        refreshSoon
      )
      .subscribe();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 20_000);
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [organizationId, router]);

  // ── Bulk selection ──────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const canBulkDelete = ["super_admin", "gestor_sync", "admin_clinica"].includes(role);

  const filtered = useMemo(() => {
    const normalizedSearch = search.toLowerCase().trim();
    return leads.filter((lead) => {
      const matchesSearch =
        normalizedSearch === "" ||
        lead.name.toLowerCase().includes(normalizedSearch) ||
        lead.phone.includes(normalizedSearch.replace(/\D/g, "")) ||
        (lead.email?.toLowerCase().includes(normalizedSearch) ?? false) ||
        (lead.procedure?.toLowerCase().includes(normalizedSearch) ?? false);
      const matchesStage = stageFilter === "all" || lead.stage_id === stageFilter;
      const matchesSource = sourceFilter === "all" || lead.source_id === sourceFilter;
      const matchesState = stateFilter === "all" || lead.detected_state === stateFilter;
      const matchesCity = cityFilter === "all" || lead.detected_city === cityFilter;
      const matchesArea = areaFilter === "all" || lead.service_area_status === areaFilter;
      const matchesFollowup = followupFilter === "all" || lead.no_followup_48h === true;
      return matchesSearch && matchesStage && matchesSource && matchesState && matchesCity && matchesArea && matchesFollowup;
    });
  }, [areaFilter, cityFilter, followupFilter, leads, search, sourceFilter, stageFilter, stateFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aVal = a[sortField] ?? "";
      const bVal = b[sortField] ?? "";
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, sortDir, sortField]);

  // Drive the select-all checkbox indeterminate state
  useEffect(() => {
    if (!selectAllRef.current) return;
    const visibleIds = sorted.map((l) => l.id);
    const selectedVisible = visibleIds.filter((id) => selectedIds.has(id));
    const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
    const someSelected = selectedVisible.length > 0 && !allSelected;
    selectAllRef.current.checked = allSelected;
    selectAllRef.current.indeterminate = someSelected;
  }, [sorted, selectedIds]);

  const selectedCount = useMemo(
    () => sorted.filter((l) => selectedIds.has(l.id)).length,
    [sorted, selectedIds]
  );

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const visibleIds = sorted.map((l) => l.id);
    const allSelected = visibleIds.every((id) => selectedIds.has(id));
    if (allSelected) {
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
    const ids = sorted.filter((l) => selectedIds.has(l.id)).map((l) => l.id);
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
      if (result.ok) clearSelection();
    });
  }

  const locationOptions = useMemo(() => {
    const states = Array.from(new Set(leads.map((lead) => lead.detected_state).filter(Boolean) as string[])).sort();
    const cities = Array.from(new Set(leads.map((lead) => lead.detected_city).filter(Boolean) as string[])).sort();
    return { states, cities };
  }, [leads]);

  const activeFilterCount = [stageFilter, sourceFilter, stateFilter, cityFilter, areaFilter, followupFilter].filter(
    (v) => v !== "all"
  ).length;
  const noFollowupCount = useMemo(() => leads.filter((lead) => lead.no_followup_48h).length, [leads]);

  const handleSort = (field: keyof LeadListItem) => {
    if (sortField === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ field }: { field: keyof LeadListItem }) => {
    if (sortField !== field) return <ChevronsUpDown className="h-3 w-3 text-text-muted" />;
    return sortDir === "asc" ? (
      <ChevronUp className="h-3 w-3 text-brand-green" />
    ) : (
      <ChevronDown className="h-3 w-3 text-brand-green" />
    );
  };

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

  function exportCsv(rows: LeadListItem[]) {
    const fieldNames = options.customFields.map((f) => f.name);
    const headers = [
      "Nome",
      "Telefone",
      "Email",
      "Origem",
      "Procedimento",
      "Etapa",
      "Valor potencial",
      "Valor fechado",
      "Tags",
      ...fieldNames,
      "Criado em",
      "Ultima interacao",
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
        lead.name,
        lead.phone,
        lead.email ?? "",
        lead.source?.name ?? "",
        lead.procedure ?? "",
        lead.stage?.name ?? "",
        lead.potential_value ?? "",
        lead.closed_value ?? "",
        leadTagNames,
        ...customValues,
        lead.created_at,
        lead.last_interaction_at ?? "",
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
    });
  }

  const selectedLeadIds = useMemo(
    () => sorted.filter((l) => selectedIds.has(l.id)).map((l) => l.id),
    [sorted, selectedIds]
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="label-eyebrow text-text-muted">{organizationName}</p>
          <h1 className="mt-1 text-2xl font-black text-text-primary">Historico de Leads</h1>
          <p className="mt-1 text-xs text-text-muted">Periodo: {periodLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => exportCsv(sorted)}>
            <Download className="h-3.5 w-3.5" />
            Exportar
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setFormMode("create")}>
            <Plus className="h-3.5 w-3.5" />
            Novo Lead
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <Input
              placeholder="Buscar por nome, telefone, email, procedimento..."
              className="h-8 pl-8 text-xs"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSelectedIds(new Set());
              }}
            />
          </div>
          <Select value={stageFilter} onValueChange={(v) => { setStageFilter(v); setSelectedIds(new Set()); }}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="Todas as etapas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as etapas</SelectItem>
              {options.stages.map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>
                  {stage.name}
                </SelectItem>
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
          <span className="ml-auto text-xs text-text-muted">{sorted.length} leads</span>
        </div>

        {showAdvanced && (
          <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-2 lg:grid-cols-3">
            <FilterSelect label="Origem" value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); setSelectedIds(new Set()); }}>
              <SelectItem value="all">Todas as origens</SelectItem>
              {options.sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.name}
                </SelectItem>
              ))}
            </FilterSelect>
            <FilterSelect label="Estado" value={stateFilter} onValueChange={(v) => { setStateFilter(v); setSelectedIds(new Set()); }}>
              <SelectItem value="all">Todos os estados</SelectItem>
              {locationOptions.states.map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </FilterSelect>
            <FilterSelect label="Cidade provavel" value={cityFilter} onValueChange={(v) => { setCityFilter(v); setSelectedIds(new Set()); }}>
              <SelectItem value="all">Todas as cidades</SelectItem>
              {locationOptions.cities.map((city) => (
                <SelectItem key={city} value={city}>
                  {city}
                </SelectItem>
              ))}
            </FilterSelect>
            <FilterSelect label="Area de atuacao" value={areaFilter} onValueChange={(v) => { setAreaFilter(v); setSelectedIds(new Set()); }}>
              <SelectItem value="all">Todas</SelectItem>
              {Object.entries(LOCATION_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </FilterSelect>
            <FilterSelect label="Follow-up" value={followupFilter} onValueChange={(v) => { setFollowupFilter(v); setSelectedIds(new Set()); }}>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="no_followup_48h">Sem follow-up 48h+</SelectItem>
            </FilterSelect>
            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setStageFilter("all");
                  setSourceFilter("all");
                  setStateFilter("all");
                  setCityFilter("all");
                  setAreaFilter("all");
                  setFollowupFilter("all");
                  setSelectedIds(new Set());
                }}
              >
                Limpar filtros
              </Button>
            </div>
          </div>
        )}
      </div>

      {noFollowupCount > 0 && (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-xl border border-warning-amber/30 bg-amber-50 px-4 py-3 text-left text-xs text-amber-800 transition-colors hover:bg-amber-100"
          onClick={() => {
            setShowAdvanced(true);
            setFollowupFilter("no_followup_48h");
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

      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background-subtle">
                {/* Checkbox column */}
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
                  { label: "Lead", field: "name" as keyof LeadListItem },
                  { label: "Telefone", field: null },
                  { label: "Procedimento", field: "procedure" as keyof LeadListItem },
                  { label: "Etapa", field: null },
                  { label: "Origem", field: null },
                  { label: "Valor Pot.", field: "potential_value" as keyof LeadListItem },
                  { label: "Entrada", field: "created_at" as keyof LeadListItem },
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
                      <span className="label-eyebrow">{label}</span>
                      {field && <SortIcon field={field} />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((lead) => {
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
                        <div>
                          <Link
                            href={`/leads/${lead.id}`}
                            className="font-medium leading-none text-text-primary hover:text-brand-green-dark"
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
                    <td className="px-4 py-3 text-xs text-text-secondary">
                      {lead.procedure ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={lead.stage ? "green" : "secondary"}>
                        {lead.stage?.name ?? "Sem etapa"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-text-muted">
                      {lead.source?.name ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-text-primary">
                      {lead.potential_value ? formatCurrency(lead.potential_value) : "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {formatDate(lead.created_at)}
                    </td>
                    <td className="px-4 py-3">
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
                            {lead.inbox_conversation_id && (
                              <DropdownMenuItem asChild>
                                <Link href={`/inbox?conversation=${lead.inbox_conversation_id}`}>
                                  <Inbox /> Abrir conversa no Inbox
                                </Link>
                              </DropdownMenuItem>
                            )}
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

        {sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-background-subtle">
              <Search className="h-5 w-5 text-text-muted" />
            </div>
            <p className="text-sm font-semibold text-text-secondary">Nenhum lead encontrado</p>
            <p className="mt-1 text-xs text-text-muted">Ajuste os filtros ou adicione um novo lead</p>
          </div>
        )}
      </div>

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
