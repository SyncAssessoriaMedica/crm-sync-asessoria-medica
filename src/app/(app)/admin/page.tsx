"use client";

import { useState } from "react";
import {
  Building2,
  Users,
  Smartphone,
  Webhook,
  Sliders,
  Layers,
  Tag,
  Globe,
  BarChart3,
  CreditCard,
  Download,
  Shield,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const adminSections = [
  { id: "clinics", label: "Clínicas / Tenants", icon: Building2, count: 12 },
  { id: "users", label: "Usuários", icon: Users, count: 34 },
  { id: "whatsapp", label: "Números WhatsApp", icon: Smartphone, count: 8 },
  { id: "webhooks", label: "Webhooks", icon: Webhook, count: 5 },
  { id: "custom_fields", label: "Campos Customizados", icon: Sliders, count: 23 },
  { id: "stages", label: "Etapas do Funil", icon: Layers, count: 7 },
  { id: "tags", label: "Tags", icon: Tag, count: 15 },
  { id: "sources", label: "Origens", icon: Globe, count: 6 },
  { id: "campaigns", label: "Campanhas", icon: BarChart3, count: 18 },
  { id: "billing", label: "Planos / Assinatura", icon: CreditCard, count: null },
  { id: "export", label: "Exportação de Dados", icon: Download, count: null },
  { id: "audit", label: "Logs de Auditoria", icon: Shield, count: null },
];

const mockClinicas = [
  {
    id: "org-001",
    name: "Clínica Dr. Mendes",
    city: "São Paulo · SP",
    status: "active" as const,
    users: 4,
    leads: 847,
    whatsapp: 2,
    plan: "Pro",
    expires_at: "2024-08-15",
  },
  {
    id: "org-002",
    name: "Clínica Bella Forma",
    city: "Rio de Janeiro · RJ",
    status: "active" as const,
    users: 3,
    leads: 423,
    whatsapp: 1,
    plan: "Starter",
    expires_at: "2024-07-01",
  },
  {
    id: "org-003",
    name: "Centro Médico Harmonia",
    city: "Belo Horizonte · MG",
    status: "trial" as const,
    users: 2,
    leads: 89,
    whatsapp: 1,
    plan: "Trial",
    expires_at: "2024-06-15",
  },
  {
    id: "org-004",
    name: "Clínica Rejuvenescência",
    city: "Curitiba · PR",
    status: "suspended" as const,
    users: 5,
    leads: 1203,
    whatsapp: 3,
    plan: "Pro",
    expires_at: "2024-05-01",
  },
];

const mockUsers = [
  { id: "u1", name: "Gestor Sync", email: "gestor@syncmarketing.com", role: "gestor_sync", org: "—", active: true },
  { id: "u2", name: "Dr. Carlos Mendes", email: "carlos@clinicamendes.com", role: "admin_clinica", org: "Clínica Dr. Mendes", active: true },
  { id: "u3", name: "Maria Atendente", email: "maria@clinicamendes.com", role: "atendente", org: "Clínica Dr. Mendes", active: true },
  { id: "u4", name: "João Coordenador", email: "joao@bellaforma.com", role: "admin_clinica", org: "Clínica Bella Forma", active: true },
  { id: "u5", name: "Ana Leitora", email: "ana@harmonia.com", role: "leitura", org: "Centro Médico Harmonia", active: false },
];

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  gestor_sync: "Gestor Sync",
  admin_clinica: "Admin Clínica",
  atendente: "Atendente",
  leitura: "Leitura",
};

const STATUS_CONFIG = {
  active: { label: "Ativo", icon: CheckCircle2, color: "text-brand-green" },
  trial: { label: "Trial", icon: AlertCircle, color: "text-warning-amber" },
  suspended: { label: "Suspenso", icon: XCircle, color: "text-danger-red" },
  cancelled: { label: "Cancelado", icon: XCircle, color: "text-text-muted" },
};

export default function AdminPage() {
  const [activeSection, setActiveSection] = useState("clinics");

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <p className="label-eyebrow text-text-muted">Sync Marketing · Super Admin</p>
        <h1 className="mt-1 text-2xl font-black text-text-primary">
          Administrador
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
        {/* Sidebar nav */}
        <div className="lg:col-span-1">
          <Card>
            <CardContent className="p-2">
              <nav className="space-y-0.5">
                {adminSections.map((section) => {
                  const Icon = section.icon;
                  return (
                    <button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                        activeSection === section.id
                          ? "bg-brand-green-soft text-brand-green-deep font-semibold"
                          : "text-text-secondary hover:bg-background-subtle hover:text-text-primary"
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          activeSection === section.id
                            ? "text-brand-green"
                            : "text-text-muted"
                        )}
                      />
                      <span className="flex-1">{section.label}</span>
                      {section.count !== null && (
                        <span className="text-[10px] text-text-muted">
                          {section.count}
                        </span>
                      )}
                      <ChevronRight
                        className={cn(
                          "h-3 w-3 shrink-0",
                          activeSection === section.id
                            ? "text-brand-green"
                            : "text-border-strong"
                        )}
                      />
                    </button>
                  );
                })}
              </nav>
            </CardContent>
          </Card>
        </div>

        {/* Content area */}
        <div className="lg:col-span-3 space-y-4">
          {activeSection === "clinics" && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-text-primary">
                  Clínicas / Tenants
                </h2>
                <Button size="sm" className="text-xs gap-1.5">
                  Nova Clínica
                </Button>
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-white shadow-card">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-background-subtle">
                      {["Clínica", "Status", "Plano", "Leads", "WA", "Validade", ""].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-4 py-2.5 text-left label-eyebrow"
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {mockClinicas.map((clinic) => {
                      const statusCfg = STATUS_CONFIG[clinic.status];
                      const StatusIcon = statusCfg.icon;
                      return (
                        <tr
                          key={clinic.id}
                          className="hover:bg-background-subtle/50 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium text-text-primary">
                                {clinic.name}
                              </p>
                              <p className="text-[10px] text-text-muted">
                                {clinic.city}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div
                              className={cn(
                                "flex items-center gap-1 text-[11px] font-semibold",
                                statusCfg.color
                              )}
                            >
                              <StatusIcon className="h-3 w-3" />
                              {statusCfg.label}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant={
                                clinic.plan === "Pro"
                                  ? "default"
                                  : clinic.plan === "Trial"
                                  ? "warning"
                                  : "secondary"
                              }
                            >
                              {clinic.plan}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-text-secondary">
                            {clinic.leads.toLocaleString("pt-BR")}
                          </td>
                          <td className="px-4 py-3 text-text-secondary">
                            {clinic.whatsapp}
                          </td>
                          <td className="px-4 py-3 text-text-muted">
                            {new Date(clinic.expires_at).toLocaleDateString(
                              "pt-BR"
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] px-2"
                              >
                                Editar
                              </Button>
                              {clinic.status === "active" ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-[10px] px-2 text-danger-red hover:text-danger-red hover:bg-danger-soft"
                                >
                                  Suspender
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-[10px] px-2"
                                >
                                  Ativar
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {activeSection === "users" && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-text-primary">
                  Usuários
                </h2>
                <Button size="sm" className="text-xs gap-1.5">
                  Novo Usuário
                </Button>
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-white shadow-card">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-background-subtle">
                      {["Usuário", "Perfil", "Clínica", "Status", ""].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-2.5 text-left label-eyebrow"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {mockUsers.map((user) => (
                      <tr
                        key={user.id}
                        className="hover:bg-background-subtle/50 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-text-primary">
                              {user.name}
                            </p>
                            <p className="text-[10px] text-text-muted">
                              {user.email}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary">
                            {ROLE_LABELS[user.role]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-text-secondary">
                          {user.org}
                        </td>
                        <td className="px-4 py-3">
                          {user.active ? (
                            <span className="flex items-center gap-1 text-brand-green text-[11px] font-semibold">
                              <CheckCircle2 className="h-3 w-3" />
                              Ativo
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-text-muted text-[11px]">
                              <XCircle className="h-3 w-3" />
                              Inativo
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] px-2"
                          >
                            Editar
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {activeSection === "audit" && (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-text-primary">
                Logs de Auditoria
              </h2>
              <Card>
                <CardContent className="pt-4 divide-y divide-border">
                  {[
                    { action: "lead.created", resource: "Lead #lead-001", actor: "Sistema (Webhook)", time: "19/05/2024 14:20" },
                    { action: "lead.status_changed", resource: "Lead #lead-001", actor: "Gestor Sync", time: "19/05/2024 14:00" },
                    { action: "user.login", resource: "—", actor: "gestor@syncmarketing.com", time: "19/05/2024 08:30" },
                    { action: "lead.note_added", resource: "Lead #lead-001", actor: "Gestor Sync", time: "19/05/2024 10:30" },
                    { action: "organization.suspended", resource: "Clínica Rejuvenescência", actor: "Super Admin", time: "18/05/2024 16:00" },
                  ].map((log, i) => (
                    <div key={i} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <Shield className="h-3.5 w-3.5 shrink-0 text-text-muted mt-0.5" />
                      <div className="flex-1">
                        <p className="text-xs font-medium text-text-primary">
                          {log.action}
                        </p>
                        <p className="text-[11px] text-text-muted">
                          {log.resource} · por {log.actor}
                        </p>
                      </div>
                      <p className="text-[10px] text-text-muted shrink-0">
                        {log.time}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {!["clinics", "users", "audit"].includes(activeSection) && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="h-10 w-10 rounded-full bg-brand-green-soft flex items-center justify-center mb-3">
                  {adminSections.find((s) => s.id === activeSection) && (() => {
                    const Icon = adminSections.find((s) => s.id === activeSection)!.icon;
                    return <Icon className="h-5 w-5 text-brand-green" />;
                  })()}
                </div>
                <p className="text-sm font-semibold text-text-primary">
                  {adminSections.find((s) => s.id === activeSection)?.label}
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Esta seção está sendo construída
                </p>
                <Button size="sm" className="mt-4 text-xs">
                  Em breve
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
