"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  CheckCircle2,
  Copy,
  Globe,
  Layers,
  QrCode,
  Settings2,
  Smartphone,
  Tag,
  Users,
  Webhook,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatDateTime } from "@/lib/utils";
import {
  connectWhatsappInstanceAction,
  createInboundWebhookAction,
  createCustomFieldAction,
  createOrganizationAction,
  createPipelineStageAction,
  createSourceAction,
  createTagAction,
  createUserAction,
  createWhatsappInstanceAction,
  deactivateInboundWebhookAction,
  deletePipelineStageAction,
  movePipelineStageAction,
  updateInboundWebhookAction,
  updatePipelineStageAction,
} from "./actions";

type Organization = {
  id: string;
  name: string;
  slug: string;
  subscription_status: string | null;
  created_at: string;
};

type UserRow = {
  id: string;
  role: string;
  organization_id: string;
  organization: { id: string; name: string } | null;
  profile: { id: string; email: string; full_name: string | null; role: string | null } | null;
};

type WhatsappInstance = {
  id: string;
  instance_name: string;
  phone_number: string | null;
  status: string;
  created_at: string;
};

type WebhookConfig = {
  id: string;
  token: string;
  name: string;
  active: boolean;
  mappings: {
    name?: string;
    phone?: string;
    email?: string;
    source?: string;
    procedure?: string;
    potential_value?: string;
    custom?: Record<string, string>;
  };
  created_at: string;
};

type WebhookDelivery = {
  id: string;
  source: string;
  event_type: string | null;
  payload: unknown;
  processed: boolean;
  error: string | null;
  created_at: string;
};

type CustomField = {
  id: string;
  name: string;
  key: string;
  field_type: string;
  options: string[] | null;
  required: boolean;
  order: number;
  created_at: string;
};

type PipelineStageRow = {
  id: string;
  pipeline_id: string;
  name: string;
  order: number;
  color: string | null;
};

type TagRow = {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
};

type SourceRow = {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
};

export type AdminData = {
  isSyncAdmin: boolean;
  baseUrl: string;
  organizationName: string;
  organizations: Organization[];
  users: UserRow[];
  whatsappInstances: WhatsappInstance[];
  webhookConfigs: WebhookConfig[];
  webhookDeliveries: WebhookDelivery[];
  customFields: CustomField[];
  pipelineStages: PipelineStageRow[];
  tags: TagRow[];
  sources: SourceRow[];
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin Sync",
  gestor_sync: "Gestor Sync",
  admin_clinica: "Admin Clinica",
  atendente: "Atendente",
  leitura: "Leitura",
};

const ROLE_HELP: Record<string, string> = {
  gestor_sync: "Acesso Sync para gerenciar clinicas, usuarios e configuracoes.",
  admin_clinica: "Acesso completo da clinica: dashboard, leads, inbox e administrador da propria clinica.",
  atendente: "Acesso operacional para leads e inbox.",
  leitura: "Acesso de acompanhamento para dashboard e leitura.",
};

const FIELD_TYPES = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Numero" },
  { value: "date", label: "Data" },
  { value: "select", label: "Selecao" },
  { value: "multiselect", label: "Lista" },
  { value: "boolean", label: "Sim/Nao" },
  { value: "url", label: "URL" },
];

export function AdminClient({ data }: { data: AdminData }) {
  const sections = useMemo(
    () => [
      ...(data.isSyncAdmin ? [{ id: "clinics", label: "Clinicas", icon: Building2, count: data.organizations.length }] : []),
      { id: "users", label: "Usuarios", icon: Users, count: data.users.length },
      { id: "whatsapp", label: "Numeros WhatsApp", icon: Smartphone, count: data.whatsappInstances.length },
      { id: "webhooks", label: "Webhooks", icon: Webhook, count: data.webhookConfigs.length },
      { id: "custom_fields", label: "Campos customizados", icon: Settings2, count: data.customFields.length },
      { id: "stages", label: "Etapas do funil", icon: Layers, count: data.pipelineStages.length },
      { id: "tags", label: "Tags", icon: Tag, count: data.tags.length },
      { id: "sources", label: "Origens", icon: Globe, count: data.sources.length },
    ],
    [data]
  );
  const [activeSection, setActiveSection] = useState(sections[0]?.id ?? "users");
  const [message, setMessage] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runAction(action: (formData: FormData) => Promise<{ ok: boolean; message: string; data?: unknown }>) {
    return (formData: FormData) => {
      setMessage(null);
      startTransition(async () => {
        const result = await action(formData);
        setMessage(result.message);
      });
    };
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="label-eyebrow text-text-muted">{data.isSyncAdmin ? "Sync Marketing · Admin geral" : data.organizationName}</p>
        <h1 className="mt-1 text-2xl font-black text-text-primary">Administrador</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-secondary">
          Configure acessos, canais de entrada, campos de dados e classificacoes usadas no CRM.
        </p>
      </div>

      {message && (
        <div className="rounded-lg border border-border bg-brand-green-soft px-3 py-2 text-xs font-medium text-brand-green-deep">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
        <Card className="lg:col-span-1">
          <CardContent className="p-2">
            <nav className="space-y-1">
              {sections.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                      activeSection === section.id
                        ? "bg-brand-green-soft font-semibold text-brand-green-deep"
                        : "text-text-secondary hover:bg-background-subtle hover:text-text-primary"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1">{section.label}</span>
                    <span className="text-[10px] text-text-muted">{section.count}</span>
                  </button>
                );
              })}
            </nav>
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-3">
          {activeSection === "clinics" && (
            <Section title="Clinicas" description="Esta area aparece somente para sua conta Sync, que gerencia todas as clinicas.">
              <form action={runAction(createOrganizationAction)} className="grid gap-3 rounded-xl border border-border bg-background-subtle/50 p-4 md:grid-cols-[1fr_180px_auto]">
                <Field label="Nome da clinica" name="name" placeholder="Clinica Exemplo" required />
                <Field label="Slug" name="slug" placeholder="clinica-exemplo" />
                <Button className="self-end" disabled={isPending}>Criar</Button>
              </form>
              <DataTable
                headers={["Clinica", "Slug", "Status", "Criada em"]}
                rows={data.organizations.map((org) => [
                  org.name,
                  org.slug,
                  <Badge key="status" variant={org.subscription_status === "active" ? "green" : "secondary"}>{org.subscription_status ?? "trial"}</Badge>,
                  formatDateTime(org.created_at),
                ])}
              />
            </Section>
          )}

          {activeSection === "users" && (
            <Section title="Usuarios" description="Crie usuarios e defina o perfil de acesso. Os perfis controlam quais areas fazem sentido para cada pessoa.">
              <form action={runAction(createUserAction)} className="grid gap-3 rounded-xl border border-border bg-background-subtle/50 p-4 md:grid-cols-2">
                <Field label="Nome" name="full_name" placeholder="Nome do usuario" required />
                <Field label="Email" name="email" type="email" placeholder="usuario@clinica.com" required />
                <Field label="Senha temporaria" name="password" placeholder="Opcional" />
                <SelectField label="Perfil" name="role" defaultValue="atendente">
                  {(data.isSyncAdmin ? ["gestor_sync", "admin_clinica", "atendente", "leitura"] : ["admin_clinica", "atendente", "leitura"]).map((role) => (
                    <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>
                  ))}
                </SelectField>
                {data.isSyncAdmin && (
                  <SelectField label="Clinica" name="organization_id" defaultValue={data.organizations[0]?.id ?? ""}>
                    {data.organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                    ))}
                  </SelectField>
                )}
                <div className="self-end">
                  <Button disabled={isPending}>Criar usuario</Button>
                </div>
                <div className="md:col-span-2 grid gap-2 md:grid-cols-2">
                  {Object.entries(ROLE_HELP).map(([role, help]) => (
                    <div key={role} className="rounded-lg border border-border bg-white p-3 text-xs">
                      <p className="font-semibold text-text-primary">{ROLE_LABELS[role]}</p>
                      <p className="mt-1 text-text-muted">{help}</p>
                    </div>
                  ))}
                </div>
              </form>
              <DataTable
                headers={["Usuario", "Email", "Perfil", "Clinica"]}
                rows={data.users.map((user) => [
                  user.profile?.full_name ?? "-",
                  user.profile?.email ?? "-",
                  <Badge key="role" variant="secondary">{ROLE_LABELS[user.role] ?? user.role}</Badge>,
                  user.organization?.name ?? "-",
                ])}
              />
            </Section>
          )}

          {activeSection === "whatsapp" && (
            <Section title="Numeros WhatsApp" description="Cadastre instancias da Evolution. Quando EVOLUTION_API_URL e EVOLUTION_API_KEY estiverem na Vercel, o botao Conectar gera o QR Code dentro do CRM.">
              <form action={runAction(createWhatsappInstanceAction)} className="grid gap-3 rounded-xl border border-border bg-background-subtle/50 p-4 md:grid-cols-[1fr_180px_auto]">
                <Field label="Nome da instancia" name="instance_name" placeholder="clinica-atendimento-1" required />
                <Field label="Telefone" name="phone_number" placeholder="5511999999999" />
                <Button className="self-end" disabled={isPending}>Cadastrar</Button>
              </form>
              <div className="grid gap-3">
                {data.whatsappInstances.map((instance) => (
                  <Card key={instance.id}>
                    <CardContent className="flex flex-wrap items-center gap-3 pt-5">
                      <Smartphone className="h-4 w-4 text-brand-green" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-text-primary">{instance.instance_name}</p>
                        <p className="text-xs text-text-muted">{instance.phone_number ?? "Sem telefone informado"}</p>
                      </div>
                      <Badge variant={instance.status === "connected" ? "green" : instance.status === "connecting" ? "warning" : "secondary"}>
                        {instance.status}
                      </Badge>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => {
                          setQrPayload(null);
                          startTransition(async () => {
                            const result = await connectWhatsappInstanceAction(instance.instance_name);
                            setMessage(result.message);
                            if (result.ok) setQrPayload(JSON.stringify(result.data, null, 2));
                          });
                        }}
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        Conectar
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {qrPayload && (
                <pre className="max-h-80 overflow-auto rounded-xl border border-border bg-sidebar-dark p-4 text-xs text-white">
                  {qrPayload}
                </pre>
              )}
            </Section>
          )}

          {activeSection === "webhooks" && (
            <Section title="Webhooks de entrada" description="Crie uma URL unica, cole na ferramenta externa, envie um teste e mapeie os campos recebidos para criar leads.">
              <form action={runAction(createInboundWebhookAction)} className="grid gap-3 rounded-xl border border-border bg-background-subtle/50 p-4 md:grid-cols-[1fr_auto]">
                <Field label="Nome da integracao" name="name" placeholder="Landing page Meta Ads" required />
                <Button className="self-end" disabled={isPending}>Criar URL</Button>
              </form>
              <div className="space-y-3">
                {data.webhookConfigs.length === 0 && (
                  <p className="rounded-xl border border-border bg-white p-6 text-center text-xs text-text-muted">
                    Nenhum webhook configurado.
                  </p>
                )}
                {data.webhookConfigs.map((config) => (
                  <WebhookConfigCard
                    key={config.token}
                    config={config}
                    baseUrl={data.baseUrl}
                    customFields={data.customFields}
                    isPending={isPending}
                    onRun={runAction}
                    onMessage={setMessage}
                    onTransition={startTransition}
                  />
                ))}
              </div>
              <DataTable
                headers={["Webhook", "Evento", "Status", "Recebido em"]}
                rows={data.webhookDeliveries.map((event) => [
                  webhookNameFromPayload(event.payload),
                  event.event_type ?? "-",
                  event.processed ? <StatusOk key="ok" /> : <StatusError key="error" text={event.error ?? "Aguardando mapeamento"} />,
                  formatDateTime(event.created_at),
                ])}
              />
            </Section>
          )}

          {activeSection === "custom_fields" && (
            <Section title="Campos customizados" description="Campos criados aqui aparecem no formulario e na ficha dos leads. Webhooks podem preencher usando custom_fields com a chave do campo.">
              <form action={runAction(createCustomFieldAction)} className="grid gap-3 rounded-xl border border-border bg-background-subtle/50 p-4 md:grid-cols-2">
                <Field label="Nome do campo" name="name" placeholder="Especialidade desejada" required />
                <Field label="Chave tecnica" name="key" placeholder="especialidade_desejada" />
                <SelectField label="Tipo" name="field_type" defaultValue="text">
                  {FIELD_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                </SelectField>
                <Field label="Opcoes" name="options" placeholder="Opcao A, Opcao B" />
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input type="checkbox" name="required" className="h-4 w-4 accent-brand-green" />
                  Campo obrigatorio
                </label>
                <div className="self-end"><Button disabled={isPending}>Criar campo</Button></div>
              </form>
              <DataTable
                headers={["Campo", "Chave", "Tipo", "Obrigatorio"]}
                rows={data.customFields.map((field) => [
                  field.name,
                  field.key,
                  field.field_type,
                  field.required ? "Sim" : "Nao",
                ])}
              />
            </Section>
          )}

          {activeSection === "stages" && (
            <Section title="Etapas do funil" description="Defina as etapas que aparecem nos leads, no dashboard e na troca de status do funil.">
              <form action={runAction(createPipelineStageAction)} className="grid gap-3 rounded-xl border border-border bg-background-subtle/50 p-4 md:grid-cols-[1fr_110px_120px_auto]">
                <Field label="Nome da etapa" name="name" placeholder="Novo contato" required />
                <Field label="Ordem" name="order" type="number" min="1" placeholder="Auto" />
                <Field label="Cor" name="color" type="color" defaultValue="#22c55e" />
                <Button className="self-end" disabled={isPending}>Criar</Button>
              </form>

              {data.pipelineStages.length === 0 ? (
                <p className="rounded-xl border border-border bg-white p-6 text-center text-xs text-text-muted">
                  Nenhuma etapa cadastrada.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.pipelineStages.map((stage, index) => (
                    <form
                      key={stage.id}
                      action={runAction(updatePipelineStageAction)}
                      className="grid gap-3 rounded-xl border border-border bg-white p-3 md:grid-cols-[80px_1fr_100px_110px_auto_auto]"
                    >
                      <input type="hidden" name="id" value={stage.id} />
                      <div className="flex items-end gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon-sm"
                          disabled={isPending || index === 0}
                          onClick={() => {
                            startTransition(async () => {
                              const result = await movePipelineStageAction(stage.id, "up");
                              setMessage(result.message);
                            });
                          }}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon-sm"
                          disabled={isPending || index === data.pipelineStages.length - 1}
                          onClick={() => {
                            startTransition(async () => {
                              const result = await movePipelineStageAction(stage.id, "down");
                              setMessage(result.message);
                            });
                          }}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <Field label="Etapa" name="name" defaultValue={stage.name} required />
                      <Field label="Ordem" name="order" type="number" min="1" defaultValue={stage.order} required />
                      <Field label="Cor" name="color" type="color" defaultValue={stage.color ?? "#22c55e"} />
                      <Button variant="secondary" className="self-end" disabled={isPending}>Salvar</Button>
                      <Button
                        type="button"
                        variant="destructive"
                        className="self-end"
                        disabled={isPending}
                        onClick={() => {
                          if (!confirm(`Remover a etapa ${stage.name}? Leads nesta etapa ficarao sem etapa.`)) return;
                          startTransition(async () => {
                            const result = await deletePipelineStageAction(stage.id);
                            setMessage(result.message);
                          });
                        }}
                      >
                        Apagar
                      </Button>
                    </form>
                  ))}
                </div>
              )}
            </Section>
          )}

          {activeSection === "tags" && (
            <Section title="Tags" description="Padronize etiquetas usadas para classificar leads e conversas.">
              <form action={runAction(createTagAction)} className="grid gap-3 rounded-xl border border-border bg-background-subtle/50 p-4 md:grid-cols-[1fr_130px_auto]">
                <Field label="Nome da tag" name="name" placeholder="Quente" required />
                <Field label="Cor" name="color" type="color" defaultValue="#22c55e" />
                <Button className="self-end" disabled={isPending}>Criar</Button>
              </form>
              <PillList items={data.tags.map((tag) => ({ name: tag.name, color: tag.color ?? "#22c55e" }))} />
            </Section>
          )}

          {activeSection === "sources" && (
            <Section title="Origens" description="Configure as origens que aparecem no cadastro, filtros e relatórios de leads.">
              <form action={runAction(createSourceAction)} className="grid gap-3 rounded-xl border border-border bg-background-subtle/50 p-4 md:grid-cols-[1fr_auto]">
                <Field label="Nome da origem" name="name" placeholder="Meta Ads" required />
                <Button className="self-end" disabled={isPending}>Criar</Button>
              </form>
              <PillList items={data.sources.map((source) => ({ name: source.name, color: source.color ?? "#22c55e" }))} />
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function WebhookConfigCard({
  config,
  baseUrl,
  customFields,
  isPending,
  onRun,
  onMessage,
  onTransition,
}: {
  config: WebhookConfig;
  baseUrl: string;
  customFields: CustomField[];
  isPending: boolean;
  onRun: (action: (formData: FormData) => Promise<{ ok: boolean; message: string; data?: unknown }>) => (formData: FormData) => void;
  onMessage: (message: string | null) => void;
  onTransition: React.TransitionStartFunction;
}) {
  const url = `${baseUrl}/api/webhooks/inbound/${config.token}`;
  const customDefault = JSON.stringify(config.mappings.custom ?? {}, null, 2);

  return (
    <Card className={!config.active ? "opacity-70" : undefined}>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-text-primary">{config.name}</p>
            <p className="mt-1 break-all rounded-lg border border-border bg-background-subtle px-3 py-2 font-mono text-[11px] text-text-secondary">
              {url}
            </p>
          </div>
          <Badge variant={config.active ? "green" : "secondary"}>{config.active ? "Ativo" : "Inativo"}</Badge>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              navigator.clipboard.writeText(url);
              onMessage("URL copiada.");
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            Copiar
          </Button>
        </div>

        <form action={onRun(updateInboundWebhookAction)} className="space-y-3 rounded-xl border border-border bg-background-subtle/50 p-4">
          <input type="hidden" name="token" value={config.token} />
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Nome" name="name" defaultValue={config.name} />
            <Field label="Caminho do nome" name="name_path" placeholder="lead.name" defaultValue={config.mappings.name ?? ""} />
            <Field label="Caminho do telefone" name="phone_path" placeholder="lead.phone" defaultValue={config.mappings.phone ?? ""} />
            <Field label="Caminho do email" name="email_path" placeholder="lead.email" defaultValue={config.mappings.email ?? ""} />
            <Field label="Caminho da origem" name="source_path" placeholder="utm.source" defaultValue={config.mappings.source ?? ""} />
            <Field label="Caminho do procedimento" name="procedure_path" placeholder="lead.procedure" defaultValue={config.mappings.procedure ?? ""} />
            <Field label="Caminho do valor" name="potential_value_path" placeholder="deal.value" defaultValue={config.mappings.potential_value ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`custom-${config.token}`}>Campos customizados em JSON</Label>
            <textarea
              id={`custom-${config.token}`}
              name="custom_mappings"
              className="min-h-24 w-full rounded-lg border border-border bg-white px-3 py-2 font-mono text-xs outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green"
              defaultValue={customDefault}
              placeholder='{"especialidade_desejada": "payload.specialty"}'
            />
            <p className="text-[11px] text-text-muted">
              Use a chave tecnica do campo customizado. Disponiveis: {customFields.map((field) => field.key).join(", ") || "nenhum"}.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" name="active" defaultChecked={config.active} className="h-4 w-4 accent-brand-green" />
            Webhook ativo
          </label>
          <div className="flex flex-wrap gap-2">
            <Button disabled={isPending}>Salvar mapeamento</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending || !config.active}
              onClick={() => {
                if (!confirm(`Desativar o webhook ${config.name}?`)) return;
                onTransition(async () => {
                  const result = await deactivateInboundWebhookAction(config.token);
                  onMessage(result.message);
                });
              }}
            >
              Desativar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-xs text-text-secondary">{description}</p>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </div>
  );
}

function Field({ label, name, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
    </div>
  );
}

function SelectField({ label, name, defaultValue, children }: { label: string; name: string; defaultValue: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select name={name} defaultValue={defaultValue}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  if (rows.length === 0) return <p className="rounded-xl border border-border bg-white p-6 text-center text-xs text-text-muted">Nenhum registro encontrado.</p>;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-border bg-background-subtle">
            <tr>{headers.map((header) => <th key={header} className="px-4 py-2 text-left label-eyebrow">{header}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, index) => (
              <tr key={index} className="hover:bg-background-subtle/50">
                {row.map((cell, cellIndex) => <td key={cellIndex} className="px-4 py-3 text-text-secondary">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PillList({ items }: { items: Array<{ name: string; color: string }> }) {
  if (items.length === 0) return <p className="rounded-xl border border-border bg-white p-6 text-center text-xs text-text-muted">Nenhum registro encontrado.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item.name} className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text-secondary">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
          {item.name}
        </span>
      ))}
    </div>
  );
}

function StatusOk() {
  return <span className="inline-flex items-center gap-1 text-brand-green-deep"><CheckCircle2 className="h-3 w-3" />Processado</span>;
}

function StatusError({ text }: { text: string }) {
  return <span className="inline-flex items-center gap-1 text-danger-red" title={text}><XCircle className="h-3 w-3" />Falhou</span>;
}

function webhookNameFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return "-";
  const name = (payload as { webhook_name?: unknown }).webhook_name;
  return typeof name === "string" && name ? name : "-";
}
