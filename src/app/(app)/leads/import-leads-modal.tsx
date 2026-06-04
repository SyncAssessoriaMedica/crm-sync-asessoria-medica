"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { LeadImportRow } from "./actions";
import { importLeadsAction } from "./actions";
import type { LeadOptionData } from "./types";

// ─── Types ─────────────────────────────────────────────────────────────────

type RawRow = Record<string, string>;

type Step = 1 | 2 | 3;

// ─── Constants ──────────────────────────────────────────────────────────────

const BASE_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: "ignore", label: "Ignorar" },
  { value: "name", label: "Nome *" },
  { value: "phone", label: "Telefone *" },
  { value: "email", label: "Email" },
  { value: "procedure", label: "Procedimento" },
  { value: "observations", label: "Observações" },
  { value: "potential_value", label: "Valor potencial" },
  { value: "source_name", label: "Origem" },
  { value: "service_name", label: "Serviço" },
];

const FIELD_MATCHERS: Record<string, string[]> = {
  name: ["nome", "name", "cliente", "contato", "lead"],
  phone: ["telefone", "phone", "tel", "celular", "fone", "whatsapp", "numero"],
  email: ["email", "e-mail", "mail"],
  procedure: ["procedimento", "procedure", "tratamento", "interesse"],
  observations: ["observacoes", "observacoes", "obs", "notas", "notes", "comentario"],
  potential_value: ["valor", "value", "potencial", "potential", "preco"],
  source_name: ["origem", "source", "canal", "midia"],
  service_name: ["servico", "service", "produto"],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeStr(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function autoDetectField(col: string): string {
  const n = normalizeStr(col);
  for (const [field, matchers] of Object.entries(FIELD_MATCHERS)) {
    if (matchers.some((m) => n.includes(m))) return field;
  }
  return "ignore";
}

async function parseFile(file: File): Promise<{ headers: string[]; rows: RawRow[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type.includes("csv")) {
    const Papa = (await import("papaparse")).default;
    return new Promise((resolve, reject) => {
      Papa.parse<RawRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => resolve({ headers: result.meta.fields ?? [], rows: result.data }),
        error: (err: Error) => reject(err),
      });
    });
  }
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" });
  return { headers: data.length > 0 ? Object.keys(data[0]) : [], rows: data };
}

function buildMappedLeads(
  rawRows: RawRow[],
  mapping: Record<string, string>
): { valid: LeadImportRow[]; invalidCount: number } {
  const valid: LeadImportRow[] = [];
  let invalidCount = 0;

  for (const row of rawRows) {
    const lead: Partial<LeadImportRow> = {};
    const customFieldValues: Record<string, string> = {};

    for (const [col, field] of Object.entries(mapping)) {
      if (field === "ignore") continue;
      const val = row[col]?.toString().trim();
      if (!val) continue;

      if (field.startsWith("custom:")) {
        const fieldId = field.slice(7);
        customFieldValues[fieldId] = val;
      } else if (field === "potential_value") {
        const num = parseFloat(val.replace(/[^\d.,]/g, "").replace(",", "."));
        if (!isNaN(num)) lead.potential_value = num;
      } else {
        (lead as Record<string, string>)[field] = val;
      }
    }

    if (Object.keys(customFieldValues).length > 0) {
      lead.customFieldValues = customFieldValues;
    }

    if (lead.name && lead.phone) {
      valid.push(lead as LeadImportRow);
    } else {
      invalidCount++;
    }
  }
  return { valid, invalidCount };
}

// ─── Component ──────────────────────────────────────────────────────────────

type ImportLeadsModalProps = {
  open: boolean;
  options: LeadOptionData;
  onClose: () => void;
  onSuccess: (message: string) => void;
};

export function ImportLeadsModal({ open, options, onClose, onSuccess }: ImportLeadsModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [stageId, setStageId] = useState("none");
  const [globalSourceId, setGlobalSourceId] = useState("none");
  const [globalServiceId, setGlobalServiceId] = useState("none");
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const reset = useCallback(() => {
    setStep(1);
    setFileName("");
    setHeaders([]);
    setRawRows([]);
    setMapping({});
    setStageId("none");
    setGlobalSourceId("none");
    setGlobalServiceId("none");
    setParseError(null);
    setResult(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  async function handleFile(file: File) {
    setParseError(null);
    setIsParsing(true);
    try {
      const { headers: h, rows: r } = await parseFile(file);
      if (!h.length) throw new Error("Nenhuma coluna encontrada no arquivo.");
      setFileName(file.name);
      setHeaders(h);
      setRawRows(r);
      const initialMapping: Record<string, string> = {};
      for (const col of h) {
        // First try standard field detection
        const standard = autoDetectField(col);
        if (standard !== "ignore") {
          initialMapping[col] = standard;
          continue;
        }
        // Then try matching against custom field names
        const n = normalizeStr(col);
        const matchedCustom = options.customFields.find((f) => normalizeStr(f.name) === n || normalizeStr(f.key) === n);
        initialMapping[col] = matchedCustom ? `custom:${matchedCustom.id}` : "ignore";
      }
      setMapping(initialMapping);
      setStep(2);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Erro ao ler o arquivo.");
    } finally {
      setIsParsing(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  }

  const mappedFields = Object.values(mapping);
  const hasName = mappedFields.includes("name");
  const hasPhone = mappedFields.includes("phone");
  const canProceedStep2 = hasName && hasPhone;

  const { valid, invalidCount } = step >= 3 ? buildMappedLeads(rawRows, mapping) : { valid: [], invalidCount: 0 };

  function handleImport() {
    const finalStageId = stageId === "none" ? undefined : stageId;
    const finalSourceId = globalSourceId === "none" ? undefined : globalSourceId;
    const finalServiceId = globalServiceId === "none" ? undefined : globalServiceId;
    startTransition(async () => {
      const res = await importLeadsAction(valid, finalStageId, finalSourceId, finalServiceId);
      if (res.ok) {
        setResult({ created: res.created, updated: res.updated, message: res.message });
        onSuccess(res.message);
      } else {
        setResult({ created: 0, updated: 0, message: res.message });
      }
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sidebar-dark/30 px-4 py-6 backdrop-blur-sm">
      <div className="flex w-full max-w-2xl flex-col rounded-2xl border border-border bg-white shadow-card-hover">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="label-eyebrow text-text-muted">
              Etapa {step} de 3 — {step === 1 ? "Upload" : step === 2 ? "Mapeamento" : "Confirmação"}
            </p>
            <h2 className="text-lg font-black text-text-primary">Importar leads em bloco</h2>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-0 border-b border-border px-5">
          {(["Upload", "Mapeamento", "Confirmação"] as const).map((label, i) => {
            const n = (i + 1) as Step;
            return (
              <div key={label} className="flex items-center">
                <div className={cn("flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-colors",
                  step === n ? "border-b-2 border-brand-green text-brand-green-dark" : step > n ? "text-text-muted" : "text-text-muted"
                )}>
                  <span className={cn("flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold",
                    step > n ? "bg-brand-green text-white" : step === n ? "bg-brand-green text-white" : "bg-border text-text-muted"
                  )}>{step > n ? "✓" : n}</span>
                  {label}
                </div>
                {i < 2 && <span className="text-border">›</span>}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto p-5">

          {/* ── Step 1: Upload ── */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-xs text-text-muted">
                Faça upload de uma planilha <strong>CSV</strong> ou <strong>Excel (.xlsx)</strong> com os dados dos leads.
                Na próxima etapa você mapeia quais colunas correspondem a quais campos.
              </p>
              <div
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition-colors",
                  isDragging ? "border-brand-green bg-brand-green-soft" : "border-border hover:border-brand-green/40 hover:bg-background-subtle"
                )}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={handleFileInput}
                />
                {isParsing ? (
                  <p className="text-sm font-medium text-text-muted">Lendo arquivo...</p>
                ) : (
                  <>
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-soft">
                      <Upload className="h-6 w-6 text-brand-green-dark" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-text-primary">Arraste o arquivo aqui ou clique para selecionar</p>
                      <p className="mt-1 text-xs text-text-muted">CSV, XLSX ou XLS · máximo 10.000 linhas</p>
                    </div>
                  </>
                )}
              </div>
              {parseError && (
                <div className="flex items-center gap-2 rounded-lg border border-danger-red/20 bg-danger-soft px-3 py-2 text-xs text-danger-red">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {parseError}
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Mapping ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg bg-background-subtle px-3 py-2">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-text-muted" />
                <p className="text-xs text-text-muted">
                  <span className="font-semibold text-text-primary">{fileName}</span>
                  {" "}· {rawRows.length} linha{rawRows.length !== 1 ? "s" : ""} detectada{rawRows.length !== 1 ? "s" : ""}
                </p>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold text-text-primary">Mapeamento de colunas</p>
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-background-subtle">
                        <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted">Coluna da planilha</th>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted">Campo do CRM</th>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted">Exemplo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {headers.map((col) => (
                        <tr key={col} className="bg-white">
                          <td className="px-3 py-2 text-xs font-medium text-text-primary">{col}</td>
                          <td className="px-3 py-2">
                            <Select
                              value={mapping[col] ?? "ignore"}
                              onValueChange={(val) => setMapping((prev) => ({ ...prev, [col]: val }))}
                            >
                              <SelectTrigger className="h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectLabel className="text-[10px]">Campos padrão</SelectLabel>
                                  {BASE_FIELD_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                  ))}
                                </SelectGroup>
                                {options.customFields.length > 0 && (
                                  <>
                                    <SelectSeparator />
                                    <SelectGroup>
                                      <SelectLabel className="text-[10px]">Parâmetros customizados</SelectLabel>
                                      {options.customFields.map((field) => (
                                        <SelectItem key={field.id} value={`custom:${field.id}`}>
                                          {field.name}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </>
                                )}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="max-w-[140px] truncate px-3 py-2 text-[11px] text-text-muted">
                            {rawRows[0]?.[col] ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {!canProceedStep2 && (
                <div className="flex items-center gap-2 rounded-lg border border-warning-amber/30 bg-warning-amber/10 px-3 py-2 text-xs font-medium text-warning-amber">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Mapeie pelo menos os campos <strong>Nome</strong> e <strong>Telefone</strong> para continuar.
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Confirm ── */}
          {step === 3 && (
            <div className="space-y-4">
              {result ? (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-green-soft">
                    <CheckCircle2 className="h-6 w-6 text-brand-green-dark" />
                  </div>
                  <p className="text-sm font-bold text-text-primary">{result.message}</p>
                  <Button size="sm" onClick={handleClose}>Fechar</Button>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-border bg-background-subtle p-3">
                    <p className="mb-3 text-xs font-semibold text-text-primary">Aplicar a todos os leads</p>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <p className="label-eyebrow text-text-muted">Etapa do funil</p>
                        <Select value={stageId} onValueChange={setStageId}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sem etapa</SelectItem>
                            {options.stages.map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <p className="label-eyebrow text-text-muted">Origem</p>
                        <Select value={globalSourceId} onValueChange={setGlobalSourceId}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sem origem</SelectItem>
                            {options.sources.filter((s) => s.active !== false).map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <p className="label-eyebrow text-text-muted">Serviço</p>
                        <Select value={globalServiceId} onValueChange={setGlobalServiceId}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sem serviço</SelectItem>
                            {options.services.filter((s) => s.active !== false).map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-border bg-background-subtle p-3 text-center">
                      <p className="text-2xl font-black text-text-primary">{valid.length}</p>
                      <p className="mt-0.5 text-[11px] text-text-muted">leads válidos</p>
                    </div>
                    <div className="rounded-lg border border-border bg-background-subtle p-3 text-center">
                      <p className="text-2xl font-black text-brand-green-dark">{valid.length - (invalidCount)}</p>
                      <p className="mt-0.5 text-[11px] text-text-muted">para importar</p>
                    </div>
                    <div className={cn("rounded-lg border p-3 text-center", invalidCount > 0 ? "border-warning-amber/30 bg-warning-amber/10" : "border-border bg-background-subtle")}>
                      <p className={cn("text-2xl font-black", invalidCount > 0 ? "text-warning-amber" : "text-text-muted")}>{invalidCount}</p>
                      <p className="mt-0.5 text-[11px] text-text-muted">sem nome/telefone</p>
                    </div>
                  </div>

                  {valid.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold text-text-primary">Prévia (primeiros {Math.min(valid.length, 5)} leads)</p>
                      <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="border-b border-border bg-background-subtle">
                              <th className="px-2 py-1.5 text-left font-semibold text-text-muted">Nome</th>
                              <th className="px-2 py-1.5 text-left font-semibold text-text-muted">Telefone</th>
                              <th className="px-2 py-1.5 text-left font-semibold text-text-muted">Email</th>
                              <th className="px-2 py-1.5 text-left font-semibold text-text-muted">Procedimento</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {valid.slice(0, 5).map((lead, i) => (
                              <tr key={i} className="bg-white">
                                <td className="max-w-[120px] truncate px-2 py-1.5 font-medium text-text-primary">{lead.name}</td>
                                <td className="px-2 py-1.5 text-text-secondary">{lead.phone}</td>
                                <td className="max-w-[120px] truncate px-2 py-1.5 text-text-muted">{lead.email ?? "—"}</td>
                                <td className="max-w-[120px] truncate px-2 py-1.5 text-text-muted">{lead.procedure ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {valid.length === 0 && (
                    <div className="flex items-center gap-2 rounded-lg border border-danger-red/20 bg-danger-soft px-3 py-2 text-xs text-danger-red">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      Nenhum lead válido encontrado. Verifique o mapeamento de colunas.
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!result && (
          <div className="flex items-center justify-between border-t border-border px-5 py-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={step === 1 ? handleClose : () => setStep((s) => (s - 1) as Step)}
            >
              {step === 1 ? "Cancelar" : "← Voltar"}
            </Button>
            <div className="flex items-center gap-2">
              {step === 1 && (
                <Button size="sm" disabled>
                  Próximo →
                </Button>
              )}
              {step === 2 && (
                <Button
                  size="sm"
                  disabled={!canProceedStep2}
                  onClick={() => setStep(3)}
                >
                  Próximo →
                </Button>
              )}
              {step === 3 && (
                <Button
                  size="sm"
                  disabled={isPending || valid.length === 0}
                  onClick={handleImport}
                >
                  {isPending ? "Importando..." : `Importar ${valid.length} lead${valid.length !== 1 ? "s" : ""}`}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
