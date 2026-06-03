"use client";

import { useState, useTransition } from "react";
import { CalendarCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { markLeadScheduledAction } from "@/app/(app)/leads/actions";

type AppointmentSchedulerProps = {
  leadId: string;
  appointmentScheduledAt?: string | null;
  onResult?: (message: string, ok: boolean) => void;
  onSuccess?: () => void;
  className?: string;
};

function defaultDateTimeLocal(value?: string | null) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AppointmentScheduler({
  leadId,
  appointmentScheduledAt,
  onResult,
  onSuccess,
  className,
}: AppointmentSchedulerProps) {
  const [open, setOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(defaultDateTimeLocal(appointmentScheduledAt));
  const [isPending, startTransition] = useTransition();
  const hasAppointment = Boolean(appointmentScheduledAt);

  function openScheduler() {
    setScheduledAt(defaultDateTimeLocal(appointmentScheduledAt));
    setOpen(true);
  }

  function submit() {
    const formData = new FormData();
    formData.set("appointment_scheduled_at", scheduledAt);
    startTransition(async () => {
      const result = await markLeadScheduledAction(leadId, formData);
      onResult?.(result.message, result.ok);
      if (result.ok) {
        setOpen(false);
        onSuccess?.();
      }
    });
  }

  return (
    <>
      <Button
        size="sm"
        className={className}
        variant={hasAppointment ? "secondary" : "default"}
        disabled={isPending}
        onClick={openScheduler}
      >
        <CalendarCheck className="h-3.5 w-3.5" />
        {hasAppointment ? "Alterar agendamento" : "Marcar consulta agendada"}
      </Button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="label-eyebrow text-brand-green-dark">Consulta</p>
                <h2 className="mt-1 text-lg font-black text-text-primary">
                  {hasAppointment ? "Alterar agendamento" : "Marcar consulta agendada"}
                </h2>
                {appointmentScheduledAt && (
                  <p className="mt-1 text-xs text-text-muted">
                    Agendamento atual: {formatDateTime(appointmentScheduledAt)}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-text-muted hover:bg-background-subtle hover:text-text-primary"
                onClick={() => setOpen(false)}
                disabled={isPending}
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-5 block space-y-1.5">
              <span className="text-xs font-semibold text-text-secondary">Data e horario da consulta</span>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
                Cancelar
              </Button>
              <Button type="button" size="sm" onClick={submit} disabled={isPending || !scheduledAt}>
                {isPending ? "Salvando..." : "Salvar agendamento"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
