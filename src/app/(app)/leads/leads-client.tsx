"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Copy,
  Download,
  Edit2,
  Filter,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
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
import type { LeadStatus } from "@/lib/types";
import type { LeadListItem, LeadOptionData } from "./types";
import { createLeadAction, deleteLeadAction, updateLeadAction } from "./actions";
import { LeadForm } from "./lead-form";

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
  no_show: { label: "Nao compareceu", variant: "warning" },
};

type LeadsClientProps = {
  leads: LeadListItem[];
  options: LeadOptionData;
  organizationName: string;
};

export function LeadsClient({ leads, options, organizationName }: LeadsClientProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sortField, setSortField] = useState<keyof LeadListItem>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editingLead, setEditingLead] = useState<LeadListItem | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const normalizedSearch = search.toLowerCase().trim();
    return leads.filter((lead) => {
      const matchesSearch =
        normalizedSearch === "" ||
        lead.name.toLowerCase().includes(normalizedSearch) ||
        lead.phone.includes(normalizedSearch.replace(/\D/g, "")) ||
        (lead.email?.toLowerCase().includes(normalizedSearch) ?? false) ||
        (lead.procedure?.toLowerCase().includes(normalizedSearch) ?? false);
      const matchesStatus = statusFilter === "all" || lead.status === statusFilter;
      const matchesStage = stageFilter === "all" || lead.stage_id === stageFilter;
      const matchesSource = sourceFilter === "all" || lead.source_id === sourceFilter;
      const matchesCampaign = campaignFilter === "all" || lead.campaign_id === campaignFilter;
      return matchesSearch && matchesStatus && matchesStage && matchesSource && matchesCampaign;
    });
  }, [campaignFilter, leads, search, sourceFilter, stageFilter, statusFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aVal = a[sortField] ?? "";
      const bVal = b[sortField] ?? "";
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, sortDir, sortField]);

  const activeFilterCount = [statusFilter, stageFilter, sourceFilter, campaignFilter].filter(
    (value) => value !== "all"
  ).length;

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
    setEditingLead(lead);
    setFormMode("edit");
  }

  function closeForm() {
    setFormMode(null);
    setEditingLead(undefined);
  }

  function exportCsv(rows: LeadListItem[]) {
    const headers = [
      "Nome",
      "Telefone",
      "Email",
      "Origem",
      "Campanha",
      "Procedimento",
      "Status",
      "Etapa",
      "Valor potencial",
      "Valor fechado",
      "Criado em",
      "Ultima interacao",
      "Proxima acao",
    ];
    const csvRows = rows.map((lead) =>
      [
        lead.name,
        lead.phone,
        lead.email ?? "",
        lead.source?.name ?? "",
        lead.campaign?.name ?? "",
        lead.procedure ?? "",
        STATUS_CONFIG[lead.status].label,
        lead.stage?.name ?? "",
        lead.potential_value ?? "",
        lead.closed_value ?? "",
        lead.created_at,
        lead.last_interaction_at ?? "",
        lead.next_action_at ?? "",
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([[headers.join(","), ...csvRows].join("\n")], {
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="label-eyebrow text-text-muted">{organizationName}</p>
          <h1 className="mt-1 text-2xl font-black text-text-primary">Historico de Leads</h1>
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
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-44 text-xs">
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
          <Button
            variant={showAdvanced ? "outline" : "ghost"}
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setShowAdvanced((value) => !value)}
          >
            <Filter className="h-3.5 w-3.5" />
            Filtros {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
          </Button>
          <span className="ml-auto text-xs text-text-muted">{sorted.length} leads</span>
        </div>

        {showAdvanced && (
          <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-3">
            <FilterSelect label="Etapa" value={stageFilter} onValueChange={setStageFilter}>
              <SelectItem value="all">Todas as etapas</SelectItem>
              {options.stages.map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>
                  {stage.name}
                </SelectItem>
              ))}
            </FilterSelect>
            <FilterSelect label="Origem" value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectItem value="all">Todas as origens</SelectItem>
              {options.sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.name}
                </SelectItem>
              ))}
            </FilterSelect>
            <FilterSelect label="Campanha" value={campaignFilter} onValueChange={setCampaignFilter}>
              <SelectItem value="all">Todas as campanhas</SelectItem>
              {options.campaigns.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </FilterSelect>
            <div className="md:col-span-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setStageFilter("all");
                  setSourceFilter("all");
                  setCampaignFilter("all");
                }}
              >
                Limpar filtros
              </Button>
            </div>
          </div>
        )}
      </div>

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
                {[
                  { label: "Lead", field: "name" as keyof LeadListItem },
                  { label: "Telefone", field: null },
                  { label: "Procedimento", field: "procedure" as keyof LeadListItem },
                  { label: "Etapa", field: null },
                  { label: "Status", field: "status" as keyof LeadListItem },
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
                const status = STATUS_CONFIG[lead.status];
                return (
                  <tr key={lead.id} className="group transition-colors hover:bg-background-subtle/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-green-soft text-[10px] font-bold text-brand-green-deep">
                          {getInitials(lead.name)}
                        </div>
                        <div>
                          <Link href={`/leads/${lead.id}`} className="font-medium leading-none text-text-primary hover:text-brand-green-dark">
                            {lead.name}
                          </Link>
                          {lead.email && <p className="mt-0.5 text-[11px] text-text-muted">{lead.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-secondary">{formatPhone(lead.phone)}</td>
                    <td className="px-4 py-3 text-xs text-text-secondary">{lead.procedure ?? "-"}</td>
                    <td className="px-4 py-3 text-xs text-text-secondary">{lead.stage?.name ?? "-"}</td>
                    <td className="px-4 py-3">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-text-muted">{lead.source?.name ?? "-"}</td>
                    <td className="px-4 py-3 text-xs font-medium text-text-primary">
                      {lead.potential_value ? formatCurrency(lead.potential_value) : "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">{formatDate(lead.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/leads/${lead.id}`} className="text-xs font-medium text-brand-green hover:underline">
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
                              <a href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                                <MessageCircle /> Abrir WhatsApp
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => exportCsv([lead])}>
                              <Download /> Exportar este lead
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-danger-red focus:text-danger-red" onClick={() => deleteLead(lead)} disabled={isPending}>
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
        onClose={closeForm}
        onSubmit={(formData) =>
          formMode === "edit" && editingLead
            ? updateLeadAction(editingLead.id, formData)
            : createLeadAction(formData)
        }
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
