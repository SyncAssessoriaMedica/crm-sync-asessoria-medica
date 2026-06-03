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
import type { LeadListItem, LeadOptionData } from "./types";
import { LOCATION_STATUS_LABELS } from "@/lib/lead-location";

type LeadFormProps = {
  mode: "create" | "edit";
  open: boolean;
  options: LeadOptionData;
  lead?: LeadListItem;
  customValues?: Record<string, string>;
  onClose: () => void;
  onSubmit: (formData: FormData) => Promise<{ ok: boolean; message: string }>;
};

export function LeadForm({ mode, open, options, lead, customValues = {}, onClose, onSubmit }: LeadFormProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const defaults = useMemo(
    () => ({
      name: lead?.name ?? "",
      phone: lead?.phone ?? "",
      email: lead?.email ?? "",
      source_id: lead?.source_id ?? "none",
      procedure: lead?.procedure ?? "",
      stage_id: lead?.stage_id ?? "none",
      potential_value: lead?.potential_value ?? "",
      closed_value: lead?.closed_value ?? "",
      observations: lead?.observations ?? "",
      phone_ddd: lead?.phone_ddd ?? "",
      detected_state: lead?.detected_state ?? "",
      detected_region: lead?.detected_region ?? "",
      detected_city: lead?.detected_city ?? "",
      service_area_status: lead?.service_area_status ?? "unknown",
      location_manually_edited: lead?.location_manually_edited ?? false,
    }),
    [lead]
  );

  const displaySources = useMemo(() => {
    const currentSourceId = lead?.source_id;
    if (mode === "create") {
      return options.sources.filter((s) => s.active !== false);
    }
    return options.sources.filter((s) => s.active !== false || s.id === currentSourceId);
  }, [mode, options.sources, lead?.source_id]);

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
            for (const key of ["source_id", "stage_id"]) {
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
              {displaySources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.name}{source.active === false ? " (inativa)" : ""}
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

            <Field label="Valor potencial" name="potential_value" type="number" step="0.01" defaultValue={defaults.potential_value} />
            <Field label="Valor fechado" name="closed_value" type="number" step="0.01" defaultValue={defaults.closed_value} />
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

          <div className="space-y-4 rounded-xl border border-border bg-background-subtle/40 p-4">
            <div>
              <p className="label-eyebrow text-text-muted">Localizacao do lead</p>
              <p className="mt-1 text-xs text-text-secondary">
                O CRM preenche pelo DDD automaticamente. Marque a correcao manual para ajustar cidade, estado ou status.
              </p>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-text-secondary">
              <input
                type="checkbox"
                name="location_manually_edited"
                defaultChecked={defaults.location_manually_edited}
                className="h-4 w-4 accent-brand-green"
              />
              Localizacao corrigida manualmente
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="DDD" name="phone_ddd" defaultValue={defaults.phone_ddd} placeholder="11" />
              <Field label="Estado" name="detected_state" defaultValue={defaults.detected_state} placeholder="SP" />
              <Field label="Cidade provavel" name="detected_city" defaultValue={defaults.detected_city} placeholder="Sao Paulo" />
              <Field label="Regiao provavel" name="detected_region" defaultValue={defaults.detected_region} placeholder="Grande Sao Paulo" />
              <SelectField label="Status da area" name="service_area_status" defaultValue={defaults.service_area_status}>
                {Object.entries(LOCATION_STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectField>
            </div>
          </div>

          {options.customFields.length > 0 && (
            <div className="space-y-3 rounded-xl border border-border bg-background-subtle/40 p-4">
              <div>
                <p className="label-eyebrow text-text-muted">Campos personalizados</p>
                <p className="mt-1 text-xs text-text-secondary">
                  Informacoes criadas no administrador para enriquecer a ficha do lead.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {options.customFields.map((field) => (
                  <CustomFieldInput
                    key={field.id}
                    field={field}
                    defaultValue={customValues[field.id] ?? ""}
                  />
                ))}
              </div>
            </div>
          )}

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

function CustomFieldInput({
  field,
  defaultValue,
}: {
  field: LeadOptionData["customFields"][number];
  defaultValue: string;
}) {
  const name = `custom_${field.key}`;
  if (field.field_type === "select") {
    return (
      <SelectField label={field.name} name={name} defaultValue={defaultValue || "none"}>
        <SelectItem value="none">Sem valor</SelectItem>
        {(field.options ?? []).map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectField>
    );
  }

  if (field.field_type === "boolean") {
    return (
      <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm text-text-secondary">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultValue === "true"}
          className="h-4 w-4 accent-brand-green"
        />
        {field.name}
      </label>
    );
  }

  const type = field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : field.field_type === "url" ? "url" : "text";
  return (
    <Field
      label={field.name}
      name={name}
      type={type}
      defaultValue={defaultValue}
      required={field.required}
      placeholder={field.field_type === "multiselect" ? "Separe valores por virgula" : undefined}
    />
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
