"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Search,
  Filter,
  Download,
  Plus,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mockLeads } from "@/lib/mock-data/leads";
import type { Lead, LeadStatus } from "@/lib/types";
import { formatDate, formatCurrency, formatPhone, getInitials } from "@/lib/utils";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  LeadStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "warning" | "green" }
> = {
  new: { label: "Novo", variant: "secondary" },
  contacted: { label: "Contactado", variant: "default" },
  qualified: { label: "Qualificado", variant: "green" },
  scheduled: { label: "Agendado", variant: "default" },
  attended: { label: "Compareceu", variant: "default" },
  closed_won: { label: "Fechado", variant: "green" },
  closed_lost: { label: "Perdido", variant: "destructive" },
  no_show: { label: "Não Compareceu", variant: "warning" },
};

export default function LeadsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<keyof Lead>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = mockLeads.filter((lead) => {
    const matchSearch =
      search === "" ||
      lead.name.toLowerCase().includes(search.toLowerCase()) ||
      lead.phone.includes(search) ||
      (lead.email?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (lead.procedure?.toLowerCase().includes(search.toLowerCase()) ?? false);
    const matchStatus =
      statusFilter === "all" || lead.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortField] ?? "";
    const bVal = b[sortField] ?? "";
    if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const handleSort = (field: keyof Lead) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ field }: { field: keyof Lead }) => {
    if (sortField !== field) return <ChevronsUpDown className="h-3 w-3 text-text-muted" />;
    return sortDir === "asc" ? (
      <ChevronUp className="h-3 w-3 text-brand-green" />
    ) : (
      <ChevronDown className="h-3 w-3 text-brand-green" />
    );
  };

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="label-eyebrow text-text-muted">Clínica Dr. Mendes</p>
          <h1 className="mt-1 text-2xl font-black text-text-primary">
            Histórico de Leads
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Exportar
          </Button>
          <Button size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Novo Lead
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-white p-4 shadow-card">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <Input
            placeholder="Buscar por nome, telefone, procedimento..."
            className="pl-8 h-8 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs w-44">
            <SelectValue placeholder="Todos os status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>
                {cfg.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-text-muted">
          <Filter className="h-3.5 w-3.5" />
          Filtros
        </Button>
        <span className="ml-auto text-xs text-text-muted">
          {sorted.length} leads
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background-subtle">
                {[
                  { label: "Lead", field: "name" as keyof Lead },
                  { label: "Telefone", field: null },
                  { label: "Procedimento", field: "procedure" as keyof Lead },
                  { label: "Etapa", field: null },
                  { label: "Status", field: "status" as keyof Lead },
                  { label: "Origem", field: null },
                  { label: "Valor Pot.", field: "potential_value" as keyof Lead },
                  { label: "Entrada", field: "created_at" as keyof Lead },
                  { label: "", field: null },
                ].map(({ label, field }) => (
                  <th
                    key={label}
                    className={cn(
                      "px-4 py-2.5 text-left",
                      field && "cursor-pointer hover:bg-background-subtle/80 select-none"
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
                const status = STATUS_CONFIG[lead.status];
                return (
                  <tr
                    key={lead.id}
                    className="group hover:bg-background-subtle/50 transition-colors"
                  >
                    {/* Name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-green-soft text-[10px] font-bold text-brand-green-deep">
                          {getInitials(lead.name)}
                        </div>
                        <div>
                          <p className="font-medium text-text-primary leading-none">
                            {lead.name}
                          </p>
                          {lead.email && (
                            <p className="text-[11px] text-text-muted mt-0.5">
                              {lead.email}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Phone */}
                    <td className="px-4 py-3 text-xs text-text-secondary">
                      {formatPhone(lead.phone)}
                    </td>

                    {/* Procedure */}
                    <td className="px-4 py-3 text-xs text-text-secondary">
                      {lead.procedure ?? "—"}
                    </td>

                    {/* Stage */}
                    <td className="px-4 py-3 text-xs text-text-secondary">
                      {lead.stage?.name ?? "—"}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>

                    {/* Source */}
                    <td className="px-4 py-3">
                      {lead.source ? (
                        <span className="text-[11px] text-text-muted">
                          {lead.source.name}
                        </span>
                      ) : (
                        <span className="text-[11px] text-text-muted">—</span>
                      )}
                    </td>

                    {/* Potential value */}
                    <td className="px-4 py-3 text-xs font-medium text-text-primary">
                      {lead.potential_value
                        ? formatCurrency(lead.potential_value)
                        : "—"}
                    </td>

                    {/* Date */}
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {formatDate(lead.created_at)}
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="text-xs font-medium text-brand-green opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
                      >
                        Ver →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-10 w-10 rounded-full bg-background-subtle flex items-center justify-center mb-3">
              <Search className="h-5 w-5 text-text-muted" />
            </div>
            <p className="text-sm font-semibold text-text-secondary">
              Nenhum lead encontrado
            </p>
            <p className="text-xs text-text-muted mt-1">
              Ajuste os filtros ou adicione um novo lead
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
