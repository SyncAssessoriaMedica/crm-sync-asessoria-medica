"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { Bell, Building2, CheckCircle2, Clock, Lock, Shield, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { updateBusinessHoursAction, updateClinicSettingsAction, updateNotificationSettingsAction } from "./actions";
import type { ServiceAreaSettings } from "@/lib/lead-location";

type NotificationPreferences = {
  new_lead: boolean;
  lead_without_response: boolean;
  lead_without_followup: boolean;
  appointment_confirmed: boolean;
};

type BusinessHoursSettings = {
  startTime: string;
  endTime: string;
  workingDays: number[];
  timezone: string;
};

export type SettingsData = {
  organization: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    subscription_status: string;
  };
  settings: {
    cnpj: string;
    city: string;
    state: string;
    scheduling_url: string;
    notification_preferences: NotificationPreferences;
    business_hours: BusinessHoursSettings;
    service_area: ServiceAreaSettings;
  };
  user: {
    role: string;
  };
};

const settingsSections = [
  { id: "clinic", label: "Dados da clinica", icon: Building2 },
  { id: "business-hours", label: "Horario de funcionamento", icon: Clock },
  { id: "notifications", label: "Notificacoes internas", icon: Bell },
  { id: "security", label: "Seguranca", icon: Shield },
] as const;

const weekDays = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sab" },
  { value: 0, label: "Dom" },
];

const notificationOptions = [
  {
    key: "new_lead",
    label: "Novo lead recebido",
    description: "Mostra alerta dentro do CRM quando um lead entra por webhook ou WhatsApp.",
  },
  {
    key: "lead_without_response",
    label: "Lead sem resposta",
    description: "Destaca leads que precisam de resposta do time.",
  },
  {
    key: "lead_without_followup",
    label: "Lead sem follow-up",
    description: "Mostra lembretes internos para leads parados.",
  },
  {
    key: "appointment_confirmed",
    label: "Agendamento confirmado",
    description: "Mostra alertas internos quando a etapa indicar consulta agendada.",
  },
] satisfies Array<{ key: keyof NotificationPreferences; label: string; description: string }>;

export function SettingsClient({ data }: { data: SettingsData }) {
  const [activeSection, setActiveSection] = useState<(typeof settingsSections)[number]["id"]>("clinic");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runAction(action: (formData: FormData) => Promise<{ ok: boolean; message: string }>) {
    return (formData: FormData) => {
      setMessage(null);
      startTransition(async () => {
        const result = await action(formData);
        setMessage(result.message);
      });
    };
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-eyebrow text-text-muted">{data.organization.name}</p>
          <h1 className="mt-1 text-2xl font-black text-text-primary">Configuracoes</h1>
          <p className="mt-2 max-w-2xl text-sm text-text-secondary">
            Ajustes gerais da conta. Integracoes, webhooks, WhatsApp, tags, origens e funil ficam na aba Administrador.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-white px-4 py-3 shadow-card">
          <Image
            src="/logo_sync-marketing.png"
            alt="Sync Marketing"
            width={112}
            height={38}
            className="h-8 w-auto object-contain"
          />
          <div>
            <p className="text-xs font-bold text-text-primary">Padrao Sync</p>
            <p className="text-[11px] text-text-muted">Identidade visual fixa do CRM</p>
          </div>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-brand-green/25 bg-brand-green-soft px-4 py-3 text-sm font-medium text-brand-green-deep">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
        <Card className="h-fit md:col-span-1">
          <CardContent className="p-2">
            <nav className="space-y-0.5">
              {settingsSections.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                      activeSection === section.id
                        ? "bg-brand-green-soft font-semibold text-brand-green-deep"
                        : "text-text-secondary hover:bg-background-subtle"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        activeSection === section.id ? "text-brand-green" : "text-text-muted"
                      )}
                    />
                    <span className="flex-1">{section.label}</span>
                  </button>
                );
              })}
            </nav>
          </CardContent>
        </Card>

        <div className="md:col-span-3">
          {activeSection === "clinic" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Dados da clinica</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={runAction(updateClinicSettingsAction)} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field label="Nome da clinica" name="name" defaultValue={data.organization.name} required />
                    <Field label="CNPJ" name="cnpj" defaultValue={data.settings.cnpj} placeholder="00.000.000/0000-00" />
                    <Field label="Cidade" name="city" defaultValue={data.settings.city} placeholder="Sao Paulo" />
                    <Field label="Estado" name="state" defaultValue={data.settings.state} placeholder="SP" />
                    <div className="md:col-span-2">
                      <Field
                        label="Site ou link de agendamento"
                        name="scheduling_url"
                        defaultValue={data.settings.scheduling_url}
                        placeholder="https://clinica.com.br/agendamento"
                      />
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-4 rounded-xl border border-brand-green/20 bg-brand-green-soft/50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="label-eyebrow text-brand-green-dark">Area de atuacao</p>
                        <p className="mt-1 text-xs text-text-secondary">
                          O CRM usa estes dados para classificar automaticamente leads pelo DDD como dentro, possivel ou fora da area.
                        </p>
                      </div>
                      <label className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-brand-green-deep">
                        <input
                          type="checkbox"
                          name="service_area_enabled"
                          defaultChecked={data.settings.service_area.enabled}
                          className="h-4 w-4 accent-brand-green"
                        />
                        Ativar classificacao
                      </label>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <Field
                        label="Cidade principal atendida"
                        name="primary_city"
                        defaultValue={data.settings.service_area.primaryCity}
                        placeholder="Sao Paulo"
                      />
                      <Field
                        label="Estado principal"
                        name="primary_state"
                        defaultValue={data.settings.service_area.primaryState}
                        placeholder="SP"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <TextAreaField
                        label="Cidades atendidas"
                        name="served_cities"
                        defaultValue={data.settings.service_area.servedCities
                          .map((item) => `${item.city}, ${item.state}`)
                          .join("\n")}
                        placeholder={"Sao Paulo, SP\nGuarulhos, SP\nCampinas, SP"}
                        hint="Uma cidade por linha, no formato Cidade, UF."
                      />
                      <TextAreaField
                        label="Estados atendidos"
                        name="served_states"
                        defaultValue={data.settings.service_area.servedStates.join("\n")}
                        placeholder={"SP\nRJ"}
                        hint="Use para marcar como possivel area quando o DDD cair no mesmo estado."
                      />
                    </div>
                    <TextAreaField
                      label="Observacao interna da area"
                      name="service_area_notes"
                      defaultValue={data.settings.service_area.notes}
                      placeholder="Ex: atende presencial em Sao Paulo e online para todo o estado."
                    />
                  </div>
                  <Separator />
                  <div className="flex justify-end">
                    <Button disabled={isPending}>{isPending ? "Salvando..." : "Salvar dados"}</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {activeSection === "business-hours" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Horario de funcionamento</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={runAction(updateBusinessHoursAction)} className="space-y-5">
                  <div>
                    <Label>Dias de funcionamento</Label>
                    <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
                      {weekDays.map((day) => (
                        <label
                          key={day.value}
                          className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-background-subtle/40 px-2 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-brand-green-soft"
                        >
                          <input
                            type="checkbox"
                            name={`day_${day.value}`}
                            defaultChecked={data.settings.business_hours.workingDays.includes(day.value)}
                            className="h-4 w-4 rounded border-border accent-brand-green"
                          />
                          {day.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <Field
                      label="Inicio do atendimento"
                      name="start_time"
                      type="time"
                      defaultValue={data.settings.business_hours.startTime}
                      required
                    />
                    <Field
                      label="Fim do atendimento"
                      name="end_time"
                      type="time"
                      defaultValue={data.settings.business_hours.endTime}
                      required
                    />
                    <Field
                      label="Fuso horario"
                      name="timezone"
                      defaultValue={data.settings.business_hours.timezone}
                      required
                    />
                  </div>

                  <div className="rounded-xl border border-brand-green/20 bg-brand-green-soft px-4 py-3 text-xs text-brand-green-deep">
                    O Dashboard usa estes dias e horarios no modo Horario util. O modo Tempo real continua mostrando o
                    tempo corrido completo, inclusive noite e fora do expediente.
                  </div>

                  <Separator />
                  <div className="flex justify-end">
                    <Button disabled={isPending}>{isPending ? "Salvando..." : "Salvar horario"}</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {activeSection === "notifications" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Notificacoes internas</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={runAction(updateNotificationSettingsAction)} className="space-y-4">
                  <div className="space-y-3">
                    {notificationOptions.map((option) => (
                      <label
                        key={option.key}
                        className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-border bg-background-subtle/40 p-4 transition-colors hover:bg-brand-green-soft/50"
                      >
                        <span>
                          <span className="block text-sm font-semibold text-text-primary">{option.label}</span>
                          <span className="mt-1 block text-xs text-text-muted">{option.description}</span>
                        </span>
                        <input
                          type="checkbox"
                          name={option.key}
                          defaultChecked={data.settings.notification_preferences[option.key]}
                          className="mt-1 h-5 w-5 rounded border-border text-brand-green accent-brand-green"
                        />
                      </label>
                    ))}
                  </div>
                  <Separator />
                  <div className="flex justify-end">
                    <Button disabled={isPending}>{isPending ? "Salvando..." : "Salvar notificacoes"}</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {activeSection === "security" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Seguranca</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <StatusRow
                  icon={CheckCircle2}
                  title="Acesso por perfil"
                  description="Usuarios seguem as permissoes definidas em Administrador."
                  status="Ativo"
                />
                <StatusRow
                  icon={Lock}
                  title="Autenticacao"
                  description="Login por email e senha. Sem autenticacao de dois fatores nesta fase."
                  status="Padrao"
                />
                <StatusRow
                  icon={Shield}
                  title="Identidade visual"
                  description="A aparencia do CRM permanece fixa no padrao da Sync Marketing."
                  status="Fixo"
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  required,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
      />
    </div>
  );
}

function TextAreaField({
  label,
  name,
  defaultValue,
  placeholder,
  hint,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <textarea
        id={name}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="min-h-24 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green"
      />
      {hint && <p className="text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

function StatusRow({
  icon: Icon,
  title,
  description,
  status,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  status: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-background-subtle/40 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-green-soft">
        <Icon className="h-4 w-4 text-brand-green" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-text-primary">{title}</p>
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-text-muted">
            {status}
          </span>
        </div>
        <p className="mt-1 text-xs text-text-muted">{description}</p>
      </div>
    </div>
  );
}
