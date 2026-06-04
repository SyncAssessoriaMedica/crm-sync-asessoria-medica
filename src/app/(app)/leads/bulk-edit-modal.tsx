"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { LeadOptionData } from "./types";
import { updateLeadsBulkAction } from "./actions";

type BulkEditModalProps = {
  open: boolean;
  count: number;
  leadIds: string[];
  options: LeadOptionData;
  onClose: () => void;
  onSuccess: (message: string) => void;
};

export function BulkEditModal({ open, count, leadIds, options, onClose, onSuccess }: BulkEditModalProps) {
  const [stageId, setStageId] = useState("__no_change__");
  const [sourceId, setSourceId] = useState("__no_change__");
  const [serviceId, setServiceId] = useState("__no_change__");
  const [tagsToAdd, setTagsToAdd] = useState<string[]>([]);
  const [tagsToRemove, setTagsToRemove] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) return null;

  function toggleTagToAdd(tagId: string) {
    setTagsToAdd((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
    // Can't add and remove the same tag
    setTagsToRemove((prev) => prev.filter((id) => id !== tagId));
  }

  function toggleTagToRemove(tagId: string) {
    setTagsToRemove((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
    // Can't add and remove the same tag
    setTagsToAdd((prev) => prev.filter((id) => id !== tagId));
  }

  function handleClose() {
    setStageId("__no_change__");
    setSourceId("__no_change__");
    setServiceId("__no_change__");
    setTagsToAdd([]);
    setTagsToRemove([]);
    setMessage(null);
    onClose();
  }

  function handleSubmit() {
    const updates: Parameters<typeof updateLeadsBulkAction>[1] = {};

    if (stageId !== "__no_change__") updates.stage_id = stageId === "__clear__" ? "" : stageId;
    if (sourceId !== "__no_change__") updates.source_id = sourceId === "__clear__" ? "" : sourceId;
    if (serviceId !== "__no_change__") updates.service_id = serviceId === "__clear__" ? "" : serviceId;
    if (tagsToAdd.length) updates.tagsToAdd = tagsToAdd;
    if (tagsToRemove.length) updates.tagsToRemove = tagsToRemove;

    const hasAnyChange =
      stageId !== "__no_change__" ||
      sourceId !== "__no_change__" ||
      serviceId !== "__no_change__" ||
      tagsToAdd.length > 0 ||
      tagsToRemove.length > 0;

    if (!hasAnyChange) {
      setMessage("Selecione pelo menos um campo para alterar.");
      return;
    }

    setMessage(null);
    startTransition(async () => {
      const result = await updateLeadsBulkAction(leadIds, updates);
      if (result.ok) {
        onSuccess(result.message);
        handleClose();
      } else {
        setMessage(result.message);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sidebar-dark/30 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-white shadow-card-hover">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="label-eyebrow text-text-muted">Edicao em massa</p>
            <h2 className="text-lg font-black text-text-primary">
              Editar {count} lead{count !== 1 ? "s" : ""}
            </h2>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <p className="text-xs text-text-muted">
            Campos vazios (<em>Nao alterar</em>) serao ignorados - somente os campos preenchidos serao
            atualizados nos {count} lead{count !== 1 ? "s" : ""} selecionados.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="label-eyebrow text-text-muted">Etapa do funil</p>
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__no_change__">Nao alterar</SelectItem>
                  <SelectItem value="__clear__">Remover etapa</SelectItem>
                  {options.stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="label-eyebrow text-text-muted">Origem</p>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__no_change__">Nao alterar</SelectItem>
                  <SelectItem value="__clear__">Remover origem</SelectItem>
                  {options.sources.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {options.services.length > 0 && (
              <div className="space-y-1.5 sm:col-span-2">
                <p className="label-eyebrow text-text-muted">Servico</p>
                <Select value={serviceId} onValueChange={setServiceId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__no_change__">Nao alterar</SelectItem>
                    <SelectItem value="__clear__">Remover servico</SelectItem>
                    {options.services
                      .filter((service) => service.active !== false)
                      .map((service) => (
                        <SelectItem key={service.id} value={service.id}>
                          {service.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {options.tags.length > 0 && (
            <>
              <div className="space-y-2">
                <p className="label-eyebrow text-text-muted">Adicionar tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {options.tags.map((tag) => {
                    const selected = tagsToAdd.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTagToAdd(tag.id)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all",
                          selected ? "opacity-100" : "opacity-60 hover:opacity-90"
                        )}
                        style={{
                          backgroundColor: selected ? tag.color : `${tag.color}33`,
                          color: selected ? "#fff" : tag.color,
                          outline: selected ? `2px solid ${tag.color}` : undefined,
                          outlineOffset: selected ? "1px" : undefined,
                        }}
                      >
                        {selected && <span>+</span>}
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <p className="label-eyebrow text-text-muted">Remover tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {options.tags.map((tag) => {
                    const selected = tagsToRemove.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTagToRemove(tag.id)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all",
                          selected
                            ? "border-danger-red bg-danger-red/10 text-danger-red"
                            : "border-border text-text-muted hover:border-danger-red/50 hover:text-danger-red"
                        )}
                      >
                        {selected && <span>x</span>}
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {message && (
            <p className="rounded-lg border border-danger-red/20 bg-danger-red/5 px-3 py-2 text-xs text-danger-red">
              {message}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Salvando..." : `Salvar alteracoes`}
          </Button>
        </div>
      </div>
    </div>
  );
}
