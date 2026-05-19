"use client";

import { useState } from "react";
import {
  Building2,
  Bell,
  Shield,
  Palette,
  Key,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const settingsSections = [
  { id: "clinic", label: "Dados da Clínica", icon: Building2 },
  { id: "notifications", label: "Notificações", icon: Bell },
  { id: "security", label: "Segurança", icon: Shield },
  { id: "appearance", label: "Aparência", icon: Palette },
  { id: "api", label: "API & Integrações", icon: Key },
];

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState("clinic");

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <p className="label-eyebrow text-text-muted">Clínica Dr. Mendes</p>
        <h1 className="mt-1 text-2xl font-black text-text-primary">
          Configurações
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
        {/* Nav */}
        <Card className="h-fit md:col-span-1">
          <CardContent className="p-2">
            <nav className="space-y-0.5">
              {settingsSections.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveSection(s.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                      activeSection === s.id
                        ? "bg-brand-green-soft text-brand-green-deep font-semibold"
                        : "text-text-secondary hover:bg-background-subtle"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        activeSection === s.id
                          ? "text-brand-green"
                          : "text-text-muted"
                      )}
                    />
                    <span className="flex-1">{s.label}</span>
                    <ChevronRight className="h-3 w-3 text-border-strong" />
                  </button>
                );
              })}
            </nav>
          </CardContent>
        </Card>

        {/* Content */}
        <div className="md:col-span-3">
          {activeSection === "clinic" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Dados da Clínica</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Nome da Clínica</Label>
                    <Input defaultValue="Clínica Dr. Mendes" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>CNPJ</Label>
                    <Input placeholder="00.000.000/0000-00" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Cidade</Label>
                    <Input defaultValue="São Paulo" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Estado</Label>
                    <Input defaultValue="SP" />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label>Site / Link de agendamento</Label>
                    <Input placeholder="https://clinicamendes.com.br" />
                  </div>
                </div>
                <Separator />
                <div className="flex justify-end">
                  <Button size="sm">Salvar alterações</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "notifications" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Notificações</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: "Novo lead recebido", desc: "Quando um lead entra via webhook ou WhatsApp", enabled: true },
                  { label: "Lead sem resposta (30 min)", desc: "Alertas de leads aguardando atendimento", enabled: true },
                  { label: "Lead sem follow-up (3 dias)", desc: "Leads parados sem contato", enabled: false },
                  { label: "Agendamento confirmado", desc: "Quando uma consulta é agendada", enabled: true },
                ].map((notif) => (
                  <div key={notif.label} className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium text-text-primary">{notif.label}</p>
                      <p className="text-[11px] text-text-muted">{notif.desc}</p>
                    </div>
                    <div
                      className={cn(
                        "h-5 w-9 rounded-full transition-colors cursor-pointer shrink-0",
                        notif.enabled ? "bg-brand-green" : "bg-border-strong"
                      )}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {activeSection === "api" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">API & Integrações</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg bg-background-subtle border border-border p-4 space-y-3">
                  <div>
                    <p className="label-eyebrow mb-1">Endpoint de Webhook (Leads)</p>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value="https://crm.syncmarketing.com.br/api/webhooks/leads"
                        className="text-xs font-mono bg-white"
                      />
                      <Button variant="secondary" size="sm" className="shrink-0">
                        Copiar
                      </Button>
                    </div>
                    <p className="text-[11px] text-text-muted mt-1">
                      Use este endpoint para receber leads de formulários, Meta Ads e outras fontes.
                    </p>
                  </div>
                  <Separator />
                  <div>
                    <p className="label-eyebrow mb-1">Token de Autenticação</p>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value="wh_••••••••••••••••••••••••"
                        className="text-xs font-mono bg-white"
                        type="password"
                      />
                      <Button variant="secondary" size="sm" className="shrink-0">
                        Revelar
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg bg-background-subtle border border-border p-4 space-y-3">
                  <div>
                    <p className="label-eyebrow mb-1">Evolution API (WhatsApp)</p>
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label className="text-[10px]">URL da Evolution API</Label>
                        <Input placeholder="https://api.seudominio.com" className="text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">API Key</Label>
                        <Input placeholder="••••••••••••••••" type="password" className="text-xs" />
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <Button size="sm" className="text-xs">Salvar</Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {!["clinic", "notifications", "api"].includes(activeSection) && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-sm font-semibold text-text-primary">
                  {settingsSections.find((s) => s.id === activeSection)?.label}
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Em construção
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
