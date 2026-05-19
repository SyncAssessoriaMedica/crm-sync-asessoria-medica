"use client";

import { useMemo, useState, useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LeadStatus } from "@/lib/types";
import type { LeadListItem, LeadOptionData } from "./types";

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "Novo" },
  { value: "contacted", label: "Contactado" },
  { value: "qualified", label: "Qualificado" },
  { value: "scheduled", label: "Agendado" },
  { value: "attended", label: "Compareceu" },
  { value: "closed_won", label: "Fechado" },
  { value: "closed_lost", label: "Perdido" },
  { value: "no_show", label: "Nao compareceu" },
];

type LeadFormProps = {
  mode: "create" | "edit";
  open: boolean;
  options: LeadOptionData;
  lead?: LeadListItem;
  onClose: () => void;
  onSubmit: (formData: FormData) => Promise<{ ok: boolean; message: string }>;
};

function dateTimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export function LeadForm({ mode, open, options, lead, onClose, onSubmit }: LeadFormProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const defaults = useMemo(
    () => ({
      name: lead?.name ?? "",
      phone: lead?.phone ?? "",
      email: lead?.email ?? "",
      source_id: lead?.source_id ?? "none",
      campaign_id: lead?.campaign_id ?? "none",
      procedure: lead?.procedure ?? "",
      stage_id: lead?.stage_id ?? "none",
      status: lead?.status ?? "new",
      potential_value: lead?.potential_value ?? "",
      closed_value: lead?.closed_value ?? "",
      observations: lead?.observations ?? "",
      next_action_at: dateTimeLocal(lead?.next_action_at),
      next_action_note: lead?.next_action_note ?? "",
    }),
    [lead]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sidebar-dark/30 px-4 py-6 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-white shadow-card-hover">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-white px-5 py-4">
          <div>
            <p className="label-eyebrow text-text-muted">
              {mode === "create" ? "Novo registro" : "Atualizar lead"}
            </p>
            <h2 className="text-lg font-black text-text-primary">
              {mode === "create" ? "Adicionar lead" : "Editar lead"}
            </h2>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form
          className="space-y-5 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(null);
            const formData = new FormData(event.currentTarget);
            for (const key of ["source_id", "campaign_id", "stage_id"]) {
              if (formData.get(key) === "none") formData.set(key, "");
            }
            startTransition(async () => {
              const result = await onSubmit(formData);
              setMessage(result.message);
              if (result.ok) onClose();
            });
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome" name="name" defaultValue={defaults.name} required />
            <Field label="Telefone" name="phone" defaultValue={defaults.phone} required />
            <Field label="Email" name="email" type="email" defaultValue={defaults.email} />
            <Field label="Procedimento/interesse" name="procedure" defaultValue={defaults.procedure} />

            <SelectField label="Origem" name="source_id" defaultValue={defaults.source_id}>
              <SelectItem value="none">Sem origem</SelectItem>
              {options.sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.name}
                </SelectItem>
              ))}
            </SelectField>

            <SelectField label="Campanha" name="campaign_id" defaultValue={defaults.campaign_id}>
              <SelectItem value="none">Sem campanha</SelectItem>
              {options.campaigns.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectField>

            <SelectField label="Etapa do funil" name="stage_id" defaultValue={defaults.stage_id}>
              <SelectItem value="none">Sem etapa</SelectItem>
              {options.stages.map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>
                  {stage.name}
                </SelectItem>
              ))}
            </SelectField>

            <SelectField label="Status" name="status" defaultValue={defaults.status}>
              {STATUS_OPTIONS.map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectField>

            <Field label="Valor potencial" name="potential_value" type="number" step="0.01" defaultValue={defaults.potential_value} />
            <Field label="Valor fechado" name="closed_value" type="number" step="0.01" defaultValue={defaults.closed_value} />
            <Field label="Proxima acao" name="next_action_at" type="datetime-local" defaultValue={defaults.next_action_at} />
            <Field label="Nota da proxima acao" name="next_action_note" defaultValue={defaults.next_action_note} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="observations">Observacoes</Label>
            <textarea
              id="observations"
              name="observations"
              defaultValue={defaults.observations}
              className="min-h-24 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green"
            />
          </div>

          {message && <p className="text-xs font-medium text-text-secondary">{message}</p>}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Salvando..." : mode === "create" ? "Criar lead" : "Salvar alteracoes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={defaultValue} {...props} />
    </div>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  children,
}: {
  label: string;
  name: string;
  defaultValue: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select name={name} defaultValue={defaultValue}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

