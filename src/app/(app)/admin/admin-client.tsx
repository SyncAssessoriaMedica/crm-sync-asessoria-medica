"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Globe,
  Layers,
  Loader2,
  LogOut,
  QrCode,
  RefreshCw,
  Settings2,
  Smartphone,
  Tag,
  Trash2,
  Users,
  Webhook,
  XCircle,
  Zap,
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
  createSourceRuleAction,
  createTagAction,
  createUserAction,
  createWhatsappInstanceAction,
  deactivateInboundWebhookAction,
  deleteCustomFieldAction,
  deleteOrganizationAction,
  deletePipelineStageAction,
  deleteSourceAction,
  deleteSourceRuleAction,
  toggleSourceActiveAction,
  deleteTagAction,
  deleteWhatsappInstanceAction,
  disconnectWhatsappInstanceAction,
  fetchWhatsappChatsAction,
  generatePasswordAction,
  importWhatsappConversationsAction,
  saveBhAutoReplySettingsAction,
  saveBhBusinessHoursAction,
  setWebhookForInstanceAction,
  movePipelineStageAction,
  syncWhatsappInstanceStatusAction,
  toggleSourceRuleActiveAction,
  toggleUserBanAction,
  updateCustomFieldAction,
  updateInboundWebhookAction,
  updatePipelineStageAction,
  updateSourceAction,
  updateSourceRuleAction,
  updateTagAction,
  updateUserAction,
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
  organizations?: { id: string; name: string } | { id: string; name: string }[] | null;
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
  active: boolean;
  is_default: boolean;
  created_at: string;
};

type SourceRuleRow = {
  id: string;
  source_id: string;
  name: string;
  match_type: string;
  pattern: string;
  case_sensitive: boolean;
  normalize_whitespace: boolean;
  overwrite_existing: boolean;
  active: boolean;
  priority: number;
  created_at: string;
};

type BhAutoReplySettingsRow = {
  enabled: boolean;
  message_template: string;
  delay_minutes: number;
  cooldown_hours: number;
  timezone: string;
} | null;

type BusinessHourRow = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled: boolean;
};

type BhAutoReplyStats = {
  pending: number;
  sent: number;
  failed: number;
  cancelled: number;
};

type ChatPreview = {
  remoteJid: string;
  phone: string;
  name: string | null;
  displayName: string;
  lastMessageTimestamp: number | null;
  hasLead: boolean;
  leadId: string | null;
};

export type AdminData = {
  isSyncAdmin: boolean;
  baseUrl: string;
  organizationName: string;
  organizations: Organization[];
  users: UserRow[];
  bannedUserIds: string[];
  whatsappInstances: WhatsappInstance[];
  webhookConfigs: WebhookConfig[];
  webhookDeliveries: WebhookDelivery[];
  lastDeliveryByToken: Record<string, WebhookDelivery>;
  customFields: CustomField[];
  pipelineStages: PipelineStageRow[];
  tags: TagRow[];
  sources: SourceRow[];
  sourceRules: SourceRuleRow[];
  bhAutoReplySettings: BhAutoReplySettingsRow;
  bhBusinessHours: BusinessHourRow[];
  bhAutoReplyStats: BhAutoReplyStats;
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin Sync",
  gestor_sync: "Gestor Sync",
  admin_clinica: "Admin Clinica",
  atendente: "Atendente",
  leitura: "Leitura",
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
  const router = useRouter();
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
      { id: "source_rules", label: "Origem automatica", icon: Zap, count: data.sourceRules.length },
      { id: "bh_auto_reply", label: "Resposta fora do horario", icon: Clock, count: data.bhAutoReplyStats.pending },
    ],
    [data]
  );
  const [activeSection, setActiveSection] = useState(sections[0]?.id ?? "users");
  const [message, setMessage] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<{
    instanceName: string;
    qrCodeDataUrl: string | null;
    pairingCode: string | null;
    count: number | null;
  } | null>(null);
  const [instanceStatuses, setInstanceStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.whatsappInstances.map((instance) => [instance.instance_name, instance.status]))
  );
  const [isPending, startTransition] = useTransition();
  const [deletedInstanceIds, setDeletedInstanceIds] = useState<Set<string>>(new Set());
  const [chatsByInstance, setChatsByInstance] = useState<
    Record<string, { chats: ChatPreview[]; instanceId: string } | "loading">
  >({});
  const [selectedJids, setSelectedJids] = useState<Record<string, string[]>>({});

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
                headers={["Clinica", "Slug", "Status", "Criada em", ""]}
                rows={data.organizations.map((org) => [
                  <span key="name" className="font-medium text-text-primary">{org.name}</span>,
                  <span key="slug" className="font-mono text-[11px]">{org.slug}</span>,
                  <Badge key="status" variant={org.subscription_status === "active" ? "green" : "secondary"}>{org.subscription_status ?? "trial"}</Badge>,
                  formatDateTime(org.created_at),
                  org.slug === "sync-marketing" ? (
                    <span key="protected" className="text-[11px] text-text-muted">Protegida</span>
                  ) : (
                    <Button
                      key="delete"
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-danger-red hover:bg-danger-red/5 hover:text-danger-red"
                      disabled={isPending}
                      onClick={() => {
                        if (!window.confirm(
                          `Apagar a clinica "${org.name}"?\n\nEsta acao e irreversivel. Todos os leads, conversas, mensagens, instancias WhatsApp e configuracoes desta clinica serao apagados permanentemente.`
                        )) return;
                        startTransition(async () => {
                          const result = await deleteOrganizationAction(org.id);
                          setMessage(result.message);
                          if (result.ok) router.refresh();
                        });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Apagar
                    </Button>
                  ),
                ])}
              />
            </Section>
          )}

          {activeSection === "users" && (
            <Section title="Usuarios" description="Crie e gerencie usuarios. Edite perfis, troque de organizacao (admin Sync) ou gere uma nova senha temporaria.">
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
              </form>

              <div className="space-y-2">
                {data.users.length === 0 && (
                  <p className="rounded-xl border border-border bg-white p-6 text-center text-xs text-text-muted">Nenhum usuario encontrado.</p>
                )}
                {data.users.map((user) => (
                  <UserEditRow
                    key={user.id}
                    user={user}
                    organizations={data.organizations}
                    isSyncAdmin={data.isSyncAdmin}
                    isBanned={data.bannedUserIds.includes(user.profile?.id ?? user.id)}
                    isPending={isPending}
                    onRun={runAction}
                    onMessage={setMessage}
                    onTransition={startTransition}
                  />
                ))}
              </div>
            </Section>
          )}

          {activeSection === "whatsapp" && (
            <Section title="Numeros WhatsApp" description="Cadastre os canais de atendimento e conecte o celular pelo QR Code dentro do CRM.">
              <form action={runAction(createWhatsappInstanceAction)} className="grid gap-3 rounded-xl border border-border bg-background-subtle/50 p-4 md:grid-cols-[1fr_180px_auto]">
                <Field label="Nome da instancia" name="instance_name" placeholder="clinica-atendimento-1" required />
                <Field label="Telefone" name="phone_number" placeholder="5511999999999" />
                {data.isSyncAdmin && (
                  <div className="md:col-span-2">
                    <SelectField label="Clinica" name="organization_id" defaultValue={data.organizations[0]?.id}>
                      {data.organizations.map((org) => (
                        <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                      ))}
                    </SelectField>
                  </div>
                )}
                <Button className="self-end" disabled={isPending}>Cadastrar</Button>
              </form>
              <div className="grid gap-3">
                {data.whatsappInstances.filter((i) => !deletedInstanceIds.has(i.id)).map((instance) => {
                  const organization = Array.isArray(instance.organizations) ? instance.organizations[0] ?? null : instance.organizations;
                  const status = instanceStatuses[instance.instance_name] ?? instance.status;
                  const isConnected = status === "connected";
                  return (
                  <Card key={instance.id}>
                    <CardContent className="flex flex-wrap items-center gap-3 pt-5">
                      <Smartphone className="h-4 w-4 text-brand-green" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-text-primary">{instance.instance_name}</p>
                        <p className="text-xs text-text-muted">
                          {instance.phone_number ?? "Sem telefone informado"}
                          {organization?.name ? ` · ${organization.name}` : ""}
                        </p>
                      </div>
                      <Badge variant={status === "connected" ? "green" : status === "connecting" ? "warning" : "secondary"}>
                        {status}
                      </Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                        title="Configurar webhook na Evolution"
                        disabled={isPending}
                        onClick={() => {
                          startTransition(async () => {
                            const result = await setWebhookForInstanceAction(instance.instance_name);
                            setMessage(result.message);
                          });
                        }}
                      >
                        <Webhook className="h-3.5 w-3.5" />
                        Webhook
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                        disabled={isPending}
                        onClick={() => {
                          startTransition(async () => {
                            const result = await syncWhatsappInstanceStatusAction(instance.instance_name);
                            setMessage(result.message);
                            if (result.ok) {
                              const payload = result.data as { status?: string; instanceName?: string } | undefined;
                              if (payload?.instanceName && payload.status) {
                                setInstanceStatuses((current) => ({ ...current, [payload.instanceName!]: payload.status! }));
                                if (payload.status === "connected") setQrPayload(null);
                              }
                            }
                          });
                        }}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Atualizar
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-1.5"
                        disabled={isPending || isConnected}
                        onClick={() => {
                          setQrPayload(null);
                          startTransition(async () => {
                            const result = await connectWhatsappInstanceAction(instance.instance_name);
                            setMessage(result.message);
                            if (result.ok) {
                              setInstanceStatuses((current) => ({ ...current, [instance.instance_name]: "connecting" }));
                              setQrPayload(result.data as {
                                instanceName: string;
                                qrCodeDataUrl: string | null;
                                pairingCode: string | null;
                                count: number | null;
                              });
                            }
                          });
                        }}
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        {isConnected ? "Conectado" : "Conectar"}
                      </Button>
                      {isConnected && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5 border-danger-red/30 text-danger-red hover:bg-danger-red/5 hover:text-danger-red"
                          disabled={isPending}
                          onClick={() => {
                            if (!window.confirm("Desconectar este WhatsApp? Voce podera conectar outro numero depois.")) return;
                            startTransition(async () => {
                              const result = await disconnectWhatsappInstanceAction(instance.instance_name);
                              setMessage(result.message);
                              if (result.ok) {
                                setInstanceStatuses((current) => ({ ...current, [instance.instance_name]: "disconnected" }));
                                if (qrPayload?.instanceName === instance.instance_name) setQrPayload(null);
                                router.refresh();
                              }
                            });
                          }}
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          {isPending ? "Desconectando..." : "Desconectar"}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-danger-red hover:bg-danger-red/5 hover:text-danger-red"
                        title="Remover instancia do CRM"
                        disabled={isPending}
                        onClick={() => {
                          if (!window.confirm(
                            `Remover a instancia "${instance.instance_name}"?\n\n` +
                            "• A instancia sera removida do CRM.\n" +
                            "• Historico de conversas e mensagens sera preservado.\n" +
                            "• Se configurada na Evolution, o sistema tentara remover de la tambem.\n\n" +
                            "Esta acao nao pode ser desfeita."
                          )) return;
                          startTransition(async () => {
                            const result = await deleteWhatsappInstanceAction(instance.id);
                            setMessage(result.message);
                            if (result.ok) {
                              setDeletedInstanceIds((prev) => new Set([...prev, instance.id]));
                              const name = instance.instance_name;
                              setChatsByInstance((prev) => { const next = { ...prev }; delete next[name]; return next; });
                              setSelectedJids((prev) => { const next = { ...prev }; delete next[name]; return next; });
                              if (qrPayload?.instanceName === name) setQrPayload(null);
                            }
                          });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remover
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                        disabled={isPending}
                        onClick={() => {
                          const name = instance.instance_name;
                          if (chatsByInstance[name] !== undefined) {
                            setChatsByInstance((prev) => { const next = { ...prev }; delete next[name]; return next; });
                            setSelectedJids((prev) => { const next = { ...prev }; delete next[name]; return next; });
                            return;
                          }
                          setChatsByInstance((prev) => ({ ...prev, [name]: "loading" }));
                          startTransition(async () => {
                            const result = await fetchWhatsappChatsAction(name);
                            if (result.ok) {
                              const d = result.data as { chats: ChatPreview[]; instanceId: string };
                              setChatsByInstance((prev) => ({ ...prev, [name]: d }));
                              setMessage(result.message);
                            } else {
                              setMessage(result.message);
                              setChatsByInstance((prev) => { const next = { ...prev }; delete next[name]; return next; });
                            }
                          });
                        }}
                      >
                        <Download className="h-3.5 w-3.5" />
                        {chatsByInstance[instance.instance_name] !== undefined ? "Fechar lista" : "Buscar conversas"}
                      </Button>
                    </CardContent>
                    {chatsByInstance[instance.instance_name] !== undefined && (
                      <WhatsappChatPanel
                        instanceName={instance.instance_name}
                        chatsState={chatsByInstance[instance.instance_name] as { chats: ChatPreview[]; instanceId: string } | "loading"}
                        selectedJids={selectedJids[instance.instance_name] ?? []}
                        isPending={isPending}
                        onSelectChange={(jid, checked) => {
                          setSelectedJids((prev) => {
                            const current = prev[instance.instance_name] ?? [];
                            return {
                              ...prev,
                              [instance.instance_name]: checked
                                ? [...current, jid]
                                : current.filter((j) => j !== jid),
                            };
                          });
                        }}
                        onSelectAll={() => {
                          const state = chatsByInstance[instance.instance_name];
                          if (!state || state === "loading") return;
                          const newJids = state.chats.filter((c) => !c.hasLead).map((c) => c.remoteJid);
                          setSelectedJids((prev) => ({ ...prev, [instance.instance_name]: newJids }));
                        }}
                        onClearSelection={() => {
                          setSelectedJids((prev) => ({ ...prev, [instance.instance_name]: [] }));
                        }}
                        onImport={() => {
                          const jids = selectedJids[instance.instance_name] ?? [];
                          if (!jids.length) return;
                          const state = chatsByInstance[instance.instance_name];
                          const chatMap = state && state !== "loading"
                            ? new Map(state.chats.map((c) => [c.remoteJid, c]))
                            : new Map<string, ChatPreview>();
                          const contactsToImport = jids.map((jid) => ({
                            remoteJid: jid,
                            name: chatMap.get(jid)?.name ?? null,
                          }));
                          startTransition(async () => {
                            const result = await importWhatsappConversationsAction(instance.instance_name, contactsToImport);
                            setMessage(result.message);
                            if (result.ok) {
                              setChatsByInstance((prev) => { const next = { ...prev }; delete next[instance.instance_name]; return next; });
                              setSelectedJids((prev) => { const next = { ...prev }; delete next[instance.instance_name]; return next; });
                            }
                          });
                        }}
                      />
                    )}
                  </Card>
                  );
                })}
              </div>
              {qrPayload && (
                <Card>
                  <CardContent className="flex flex-col items-center gap-4 pt-5 text-center">
                    <div>
                      <p className="text-sm font-bold text-text-primary">Escaneie o QR Code no WhatsApp</p>
                      <p className="mt-1 text-xs text-text-muted">
                        Instancia: {qrPayload.instanceName}. Abra o WhatsApp no celular, toque em Aparelhos conectados e escaneie.
                      </p>
                    </div>
                    {qrPayload.qrCodeDataUrl ? (
                      <Image
                        src={qrPayload.qrCodeDataUrl}
                        alt="QR Code WhatsApp"
                        width={288}
                        height={288}
                        unoptimized
                        className="h-72 w-72 rounded-xl border border-border bg-white p-3 shadow-card"
                      />
                    ) : (
                      <div className="rounded-xl border border-warning-amber/30 bg-warning-amber/10 p-4 text-xs text-text-secondary">
                        A Evolution iniciou a conexao, mas nao retornou uma imagem de QR Code. Tente clicar em Conectar novamente em alguns segundos.
                      </div>
                    )}
                    {qrPayload.pairingCode && (
                      <div className="rounded-lg border border-border bg-background-subtle px-4 py-2">
                        <p className="text-[10px] font-bold uppercase text-text-muted">Codigo de pareamento</p>
                        <p className="font-mono text-lg font-black text-text-primary">{qrPayload.pairingCode}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
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
                    lastDelivery={data.lastDeliveryByToken[config.token] ?? null}
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
            <Section title="Campos customizados" description="Campos criados aqui aparecem no formulario e na ficha dos leads. Ao apagar, os valores dos leads tambem sao removidos.">
              <form action={runAction(createCustomFieldAction)} className="grid gap-3 rounded-xl border border-border bg-background-subtle/50 p-4 md:grid-cols-2">
                <Field label="Nome do campo" name="name" placeholder="Especialidade desejada" required />
                <Field label="Chave tecnica" name="key" placeholder="especialidade_desejada" />
                <SelectField label="Tipo" name="field_type" defaultValue="text">
                  {FIELD_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                </SelectField>
                <Field label="Opcoes (para select/lista)" name="options" placeholder="Opcao A, Opcao B" />
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input type="checkbox" name="required" className="h-4 w-4 accent-brand-green" />
                  Campo obrigatorio
                </label>
                <div className="self-end"><Button disabled={isPending}>Criar campo</Button></div>
              </form>
              {data.customFields.length === 0 ? (
                <p className="rounded-xl border border-border bg-white p-6 text-center text-xs text-text-muted">Nenhum campo cadastrado.</p>
              ) : (
                <div className="space-y-2">
                  {data.customFields.map((field) => (
                    <form
                      key={field.id}
                      action={runAction(updateCustomFieldAction)}
                      className="grid gap-3 rounded-xl border border-border bg-white p-3 md:grid-cols-2"
                    >
                      <input type="hidden" name="id" value={field.id} />
                      <Field label="Nome" name="name" defaultValue={field.name} required />
                      <SelectField label="Tipo" name="field_type" defaultValue={field.field_type}>
                        {FIELD_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                      </SelectField>
                      <Field label="Opcoes (separar por virgula)" name="options" defaultValue={(field.options ?? []).join(", ")} />
                      <div className="flex items-end gap-2">
                        <label className="flex h-9 items-center gap-2 text-sm text-text-secondary">
                          <input type="checkbox" name="required" defaultChecked={field.required} className="h-4 w-4 accent-brand-green" />
                          Obrigatorio
                        </label>
                      </div>
                      <div className="flex items-end gap-2 md:col-span-2">
                        <p className="flex-1 text-xs text-text-muted">Chave: <code className="font-mono">{field.key}</code></p>
                        <Button variant="secondary" className="self-end" disabled={isPending}>Salvar</Button>
                        <Button
                          type="button"
                          variant="destructive"
                          className="self-end"
                          disabled={isPending}
                          onClick={() => {
                            if (!confirm(`Apagar o campo "${field.name}"? Os valores nos leads tambem serao removidos.`)) return;
                            startTransition(async () => {
                              const result = await deleteCustomFieldAction(field.id);
                              setMessage(result.message);
                            });
                          }}
                        >
                          Apagar
                        </Button>
                      </div>
                    </form>
                  ))}
                </div>
              )}
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
            <Section title="Tags" description="Padronize etiquetas para classificar leads. Tags podem ser aplicadas diretamente na ficha do lead.">
              <form action={runAction(createTagAction)} className="grid gap-3 rounded-xl border border-border bg-background-subtle/50 p-4 md:grid-cols-[1fr_130px_auto]">
                <Field label="Nome da tag" name="name" placeholder="Quente" required />
                <Field label="Cor" name="color" type="color" defaultValue="#22c55e" />
                <Button className="self-end" disabled={isPending}>Criar</Button>
              </form>
              {data.tags.length === 0 ? (
                <p className="rounded-xl border border-border bg-white p-6 text-center text-xs text-text-muted">Nenhuma tag cadastrada.</p>
              ) : (
                <div className="space-y-2">
                  {data.tags.map((tag) => (
                    <form
                      key={tag.id}
                      action={runAction(updateTagAction)}
                      className="grid gap-3 rounded-xl border border-border bg-white p-3 md:grid-cols-[1fr_120px_auto_auto]"
                    >
                      <input type="hidden" name="id" value={tag.id} />
                      <Field label="Nome" name="name" defaultValue={tag.name} required />
                      <Field label="Cor" name="color" type="color" defaultValue={tag.color ?? "#22c55e"} />
                      <Button variant="secondary" className="self-end" disabled={isPending}>Salvar</Button>
                      <Button
                        type="button"
                        variant="destructive"
                        className="self-end"
                        disabled={isPending}
                        onClick={() => {
                          if (!confirm(`Remover a tag "${tag.name}"?`)) return;
                          startTransition(async () => {
                            const result = await deleteTagAction(tag.id);
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

          {activeSection === "sources" && (
            <Section
              title="Origens"
              description="Configure as origens de leads. Desative origens em vez de apagar para preservar o historico."
            >
              <form
                action={runAction(createSourceAction)}
                className="grid gap-3 rounded-xl border border-border bg-background-subtle/50 p-4 md:grid-cols-[auto_1fr_auto]"
              >
                <div className="space-y-1.5">
                  <Label>Cor</Label>
                  <input
                    type="color"
                    name="color"
                    defaultValue="#22c55e"
                    className="h-9 w-12 cursor-pointer rounded-lg border border-border p-0.5"
                  />
                </div>
                <Field label="Nome da origem" name="name" placeholder="Meta Ads" required />
                <Button className="self-end" disabled={isPending}>Criar</Button>
              </form>
              {data.sources.length === 0 ? (
                <p className="rounded-xl border border-border bg-white p-6 text-center text-xs text-text-muted">Nenhuma origem cadastrada.</p>
              ) : (
                <div className="space-y-2">
                  {data.sources.map((source) => (
                    <form
                      key={source.id}
                      action={runAction(updateSourceAction)}
                      className={cn(
                        "flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3",
                        source.active ? "border-border" : "border-border/50 bg-background-subtle/40 opacity-75"
                      )}
                    >
                      <input type="hidden" name="id" value={source.id} />
                      <div className="space-y-1.5">
                        <Label>Cor</Label>
                        <input
                          type="color"
                          name="color"
                          defaultValue={source.color ?? "#22c55e"}
                          className="h-9 w-12 cursor-pointer rounded-lg border border-border p-0.5"
                        />
                      </div>
                      <div className="min-w-[160px] flex-1 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Label>Nome</Label>
                          {!source.active && (
                            <span className="inline-flex items-center rounded-full border border-yellow-300 bg-yellow-50 px-2 py-0.5 text-[10px] font-semibold text-yellow-700">
                              Inativa
                            </span>
                          )}
                          {source.is_default && (
                            <span className="text-[10px] text-text-muted">padrao</span>
                          )}
                        </div>
                        <Input name="name" defaultValue={source.name} required />
                      </div>
                      <div className="flex gap-2 self-end">
                        <Button variant="secondary" size="sm" disabled={isPending}>Salvar</Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isPending || (source.is_default && source.active)}
                          onClick={() => {
                            startTransition(async () => {
                              const result = await toggleSourceActiveAction(source.id, !source.active);
                              setMessage(result.message);
                            });
                          }}
                        >
                          {source.active ? "Desativar" : "Ativar"}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={isPending || source.is_default}
                          onClick={() => {
                            if (!confirm(`Apagar permanentemente a origem "${source.name}"?\n\nEsta acao nao pode ser desfeita. Origens em uso por leads ou regras automaticas nao podem ser apagadas.`)) return;
                            startTransition(async () => {
                              const result = await deleteSourceAction(source.id);
                              setMessage(result.message);
                            });
                          }}
                        >
                          Apagar
                        </Button>
                      </div>
                    </form>
                  ))}
                </div>
              )}
            </Section>
          )}

          {activeSection === "bh_auto_reply" && (
            <BhAutoReplySection
              settings={data.bhAutoReplySettings}
              businessHours={data.bhBusinessHours}
              stats={data.bhAutoReplyStats}
              isPending={isPending}
              onRun={runAction}
            />
          )}

          {activeSection === "source_rules" && (
            <Section
              title="Origem automatica"
              description="Regras que detectam a origem do lead pela primeira mensagem recebida no WhatsApp. A regra de menor prioridade (numero menor) e aplicada primeiro."
            >
              {data.sources.filter((s) => s.active).length === 0 ? (
                <p className="rounded-xl border border-border bg-white p-6 text-center text-xs text-text-muted">
                  Crie ao menos uma Origem ativa antes de configurar regras.
                </p>
              ) : (
                <form
                  action={runAction(createSourceRuleAction)}
                  className="grid gap-3 rounded-xl border border-border bg-background-subtle/50 p-4"
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Nome da regra" name="name" placeholder="Google Ads — palavra-chave" required />
                    <div className="space-y-1.5">
                      <Label>Origem</Label>
                      <Select name="source_id" defaultValue={data.sources.find((s) => s.active)?.id ?? ""}>
                        <SelectTrigger><SelectValue placeholder="Selecione uma origem" /></SelectTrigger>
                        <SelectContent>
                          {data.sources.filter((s) => s.active).map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Tipo de correspondencia</Label>
                      <Select name="match_type" defaultValue="contains">
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="exact">Exata</SelectItem>
                          <SelectItem value="contains">Contem</SelectItem>
                          <SelectItem value="starts_with">Comeca com</SelectItem>
                          <SelectItem value="regex">Regex</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Field label="Padrao / mensagem" name="pattern" placeholder="vim pelo anuncio do Google" required />
                    <Field label="Prioridade" name="priority" type="number" min="1" max="9999" defaultValue="100" />
                    <div className="flex flex-wrap gap-4 text-sm text-text-secondary">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="case_sensitive" className="h-4 w-4 accent-brand-green" />
                        Diferenciar maiusculas
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="normalize_whitespace" defaultChecked className="h-4 w-4 accent-brand-green" />
                        Normalizar espacos
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="overwrite_existing" className="h-4 w-4 accent-brand-green" />
                        Sobrescrever origem ja definida
                      </label>
                    </div>
                  </div>
                  <Button className="w-fit" disabled={isPending}>Criar regra</Button>
                </form>
              )}

              {data.sourceRules.length > 0 && (
                <SourceRuleTester rules={data.sourceRules} sources={data.sources} />
              )}

              {data.sourceRules.length === 0 ? (
                <p className="rounded-xl border border-border bg-white p-6 text-center text-xs text-text-muted">
                  Nenhuma regra configurada. Crie uma acima para comecar.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.sourceRules.map((rule) => (
                    <SourceRuleRow
                      key={rule.id}
                      rule={rule}
                      sources={data.sources}
                      isPending={isPending}
                      onRun={runAction}
                      onMessage={setMessage}
                      onTransition={startTransition}
                    />
                  ))}
                </div>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

const MATCH_TYPE_LABELS: Record<string, string> = {
  exact: "Exata",
  contains: "Contem",
  starts_with: "Comeca com",
  regex: "Regex",
};

function normalizeRuleText(value: string, normalizeWhitespace: boolean, caseSensitive: boolean) {
  const trimmed = normalizeWhitespace ? value.replace(/\s+/g, " ").trim() : value.trim();
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

function sourceRuleMatches(rule: SourceRuleRow, message: string) {
  try {
    const text = normalizeRuleText(message, rule.normalize_whitespace, rule.case_sensitive);
    const pattern = normalizeRuleText(rule.pattern, rule.normalize_whitespace, rule.case_sensitive);
    if (!text || !pattern) return false;
    if (rule.match_type === "exact") return text === pattern;
    if (rule.match_type === "contains") return text.includes(pattern);
    if (rule.match_type === "starts_with") return text.startsWith(pattern);
    if (rule.match_type === "regex") {
      const flags = rule.case_sensitive ? "" : "i";
      return new RegExp(rule.pattern, flags).test(message);
    }
    return false;
  } catch {
    return false;
  }
}

function SourceRuleTester({ rules, sources }: { rules: SourceRuleRow[]; sources: SourceRow[] }) {
  const [sample, setSample] = useState("");
  const activeRules = useMemo(
    () => [...rules].filter((rule) => rule.active).sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at)),
    [rules]
  );
  const matched = useMemo(
    () => activeRules.find((rule) => sourceRuleMatches(rule, sample)) ?? null,
    [activeRules, sample]
  );
  const sourceName = matched ? sources.find((source) => source.id === matched.source_id)?.name ?? "Origem encontrada" : null;

  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <div className="space-y-1.5">
          <Label>Testar mensagem</Label>
          <Input
            value={sample}
            onChange={(event) => setSample(event.target.value)}
            placeholder="Cole aqui a primeira mensagem enviada pelo lead"
          />
        </div>
        <Badge variant={matched ? "green" : "secondary"} className="h-9 justify-center px-3">
          {matched ? `${sourceName} via ${matched.name}` : "Nenhuma regra ativa encontrada"}
        </Badge>
      </div>
    </div>
  );
}

const BH_DAYS = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];

const BH_DEFAULT_SETTINGS = {
  enabled: false,
  message_template:
    "Ola! Estamos fora do horario de atendimento no momento. O proximo horario disponivel e {{proximo_horario_util}}. Entraremos em contato assim que possivel!",
  delay_minutes: 15,
  cooldown_hours: 12,
  timezone: "America/Sao_Paulo",
};

function BhAutoReplySection({
  settings,
  businessHours,
  stats,
  isPending,
  onRun,
}: {
  settings: BhAutoReplySettingsRow;
  businessHours: BusinessHourRow[];
  stats: BhAutoReplyStats;
  isPending: boolean;
  onRun: (action: (formData: FormData) => Promise<{ ok: boolean; message: string; data?: unknown }>) => (formData: FormData) => void;
}) {
  const s = settings ?? BH_DEFAULT_SETTINGS;

  const getHour = (day: number) =>
    businessHours.find((h) => h.day_of_week === day) ??
    { day_of_week: day, start_time: "08:00", end_time: "18:00", enabled: day >= 1 && day <= 5 };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resposta fora do horario de atendimento</CardTitle>
          <p className="text-xs text-text-secondary">
            Quando ativo, o CRM responde automaticamente apenas se a mensagem chegar claramente fora
            do expediente: no minimo 1h30 depois do fim do atendimento e 1h30 antes do proximo inicio.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Settings form */}
          <form action={onRun(saveBhAutoReplySettingsAction)} className="space-y-4 rounded-xl border border-border bg-background-subtle/50 p-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Ativar resposta automatica</Label>
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={s.enabled}
                  className="h-4 w-4 accent-brand-green"
                />
                {s.enabled ? "Ativada" : "Desativada"}
              </label>
            </div>

            <div className="space-y-1.5">
              <Label>Mensagem automatica</Label>
              <textarea
                name="message_template"
                defaultValue={s.message_template}
                rows={4}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green"
              />
              <p className="text-[11px] text-text-muted">
                Use <code className="rounded bg-background-subtle px-1 py-0.5 font-mono">{"{{proximo_horario_util}}"}</code> para inserir o proximo horario disponivel. Ex.: &ldquo;hoje as 09 horas&rdquo;, &ldquo;amanha as 08 horas&rdquo;, &ldquo;segunda as 10 horas&rdquo;.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label="Intervalo minimo entre envios (h)"
                name="cooldown_hours"
                type="number"
                min="1"
                max="168"
                defaultValue={s.cooldown_hours}
              />
              <Field
                label="Fuso horario"
                name="timezone"
                defaultValue={s.timezone}
                placeholder="America/Sao_Paulo"
              />
            </div>

            <Button disabled={isPending}>Salvar configuracoes</Button>
          </form>

          {/* Business hours form */}
          <form action={onRun(saveBhBusinessHoursAction)} className="space-y-3 rounded-xl border border-border bg-background-subtle/50 p-4">
            <p className="text-sm font-semibold text-text-primary">Horario de atendimento</p>
            <p className="text-xs text-text-secondary">
              Fora deste horario, mensagens recebidas podem acionar a resposta automatica se a regra
              estiver ativa e a conversa estiver dentro da janela segura. Este horario tambem e usado
              pelo Follow-up automatico.
            </p>
            <div className="overflow-hidden rounded-xl border border-border bg-white">
              <table className="w-full text-xs">
                <thead className="border-b border-border bg-background-subtle">
                  <tr>
                    <th className="px-3 py-2 text-left label-eyebrow">Dia</th>
                    <th className="px-3 py-2 text-left label-eyebrow">Ativo</th>
                    <th className="px-3 py-2 text-left label-eyebrow">Inicio</th>
                    <th className="px-3 py-2 text-left label-eyebrow">Fim</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                    const h = getHour(day);
                    return (
                      <tr key={day} className="hover:bg-background-subtle/50">
                        <td className="px-3 py-2 font-medium text-text-primary">{BH_DAYS[day]}</td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            name={`day_${day}_enabled`}
                            defaultChecked={h.enabled}
                            className="h-4 w-4 accent-brand-green"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="time"
                            name={`day_${day}_start`}
                            defaultValue={h.start_time.substring(0, 5)}
                            className="rounded border border-border bg-white px-2 py-1 text-xs outline-none focus:border-brand-green"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="time"
                            name={`day_${day}_end`}
                            defaultValue={h.end_time.substring(0, 5)}
                            className="rounded border border-border bg-white px-2 py-1 text-xs outline-none focus:border-brand-green"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Button variant="secondary" disabled={isPending}>Salvar horarios</Button>
          </form>

          {/* Queue stats */}
          <div className="rounded-xl border border-border bg-white p-4">
            <p className="mb-3 text-sm font-semibold text-text-primary">Historico de respostas automaticas</p>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Pendentes", value: stats.pending, color: "text-warning-amber" },
                { label: "Enviadas", value: stats.sent, color: "text-brand-green-deep" },
                { label: "Falhas", value: stats.failed, color: "text-danger-red" },
                { label: "Canceladas", value: stats.cancelled, color: "text-text-muted" },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-lg border border-border bg-background-subtle/50 px-3 py-3">
                  <p className={`text-xl font-black ${color}`}>{value}</p>
                  <p className="mt-0.5 text-[10px] text-text-muted">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SourceRuleRow({
  rule,
  sources,
  isPending,
  onRun,
  onMessage,
  onTransition,
}: {
  rule: SourceRuleRow;
  sources: SourceRow[];
  isPending: boolean;
  onRun: (action: (formData: FormData) => Promise<{ ok: boolean; message: string; data?: unknown }>) => (formData: FormData) => void;
  onMessage: (message: string | null) => void;
  onTransition: React.TransitionStartFunction;
}) {
  const [expanded, setExpanded] = useState(false);
  const sourceInfo = sources.find((s) => s.id === rule.source_id);
  const sourceName = sourceInfo?.name ?? rule.source_id;
  const sourceInactive = sourceInfo !== undefined && sourceInfo.active === false;

  return (
    <div className={cn("rounded-xl border border-border bg-white", !rule.active && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Zap className={cn("h-3.5 w-3.5 shrink-0", rule.active ? "text-brand-green" : "text-text-muted")} />
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold text-text-primary">{rule.name}</p>
          <p className="text-xs text-text-muted">
            {MATCH_TYPE_LABELS[rule.match_type] ?? rule.match_type}
            {" · "}
            <span className="font-mono">&ldquo;{rule.pattern.slice(0, 40)}{rule.pattern.length > 40 ? "…" : ""}&rdquo;</span>
            {" → "}
            {sourceName}
            {" · Prioridade "}{rule.priority}
          </p>
          {sourceInactive && (
            <p className="mt-0.5 text-[11px] font-semibold text-yellow-600">
              Aviso: a origem &ldquo;{sourceName}&rdquo; esta inativa. Esta regra nao sera aplicada a novos leads.
            </p>
          )}
        </div>
        <Badge variant={rule.active ? "green" : "secondary"}>{rule.active ? "Ativa" : "Inativa"}</Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs"
          disabled={isPending}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Fechar edicao" : "Editar regra"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs"
          disabled={isPending}
          onClick={() => {
            onTransition(async () => {
              const result = await toggleSourceRuleActiveAction(rule.id, !rule.active);
              onMessage(result.message);
            });
          }}
        >
          {rule.active ? "Desativar" : "Ativar"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1 text-danger-red hover:bg-danger-red/5 hover:text-danger-red"
          disabled={isPending}
          onClick={() => {
            if (!confirm(`Remover a regra "${rule.name}"?`)) return;
            onTransition(async () => {
              const result = await deleteSourceRuleAction(rule.id);
              onMessage(result.message);
            });
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {expanded && (
        <form
          action={onRun(updateSourceRuleAction)}
          className="grid gap-3 border-t border-border p-4 md:grid-cols-2"
        >
          <input type="hidden" name="id" value={rule.id} />
          <div className="md:col-span-2">
            <p className="label-eyebrow text-text-muted">Editar origem automatica</p>
            <p className="mt-1 text-xs text-text-secondary">
              Ajuste a mensagem de entrada, a origem atribuida e a prioridade desta regra.
            </p>
          </div>
          <Field label="Nome" name="name" defaultValue={rule.name} required />
          <div className="space-y-1.5">
            <Label>Origem</Label>
            <Select name="source_id" defaultValue={rule.source_id}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {sources.filter((s) => s.active !== false || s.id === rule.source_id).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de correspondencia</Label>
            <Select name="match_type" defaultValue={rule.match_type}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="exact">Exata</SelectItem>
                <SelectItem value="contains">Contem</SelectItem>
                <SelectItem value="starts_with">Comeca com</SelectItem>
                <SelectItem value="regex">Regex</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Field label="Padrao / mensagem" name="pattern" defaultValue={rule.pattern} required />
          <Field label="Prioridade" name="priority" type="number" min="1" max="9999" defaultValue={rule.priority} />
          <div className="flex flex-wrap gap-4 text-sm text-text-secondary md:col-span-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="case_sensitive" defaultChecked={rule.case_sensitive} className="h-4 w-4 accent-brand-green" />
              Diferenciar maiusculas
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="normalize_whitespace" defaultChecked={rule.normalize_whitespace} className="h-4 w-4 accent-brand-green" />
              Normalizar espacos
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="overwrite_existing" defaultChecked={rule.overwrite_existing} className="h-4 w-4 accent-brand-green" />
              Sobrescrever origem ja definida
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="active" defaultChecked={rule.active} className="h-4 w-4 accent-brand-green" />
              Regra ativa
            </label>
          </div>
          <div className="md:col-span-2">
            <Button variant="secondary" disabled={isPending}>Salvar</Button>
          </div>
        </form>
      )}
    </div>
  );
}

function WebhookConfigCard({
  config,
  baseUrl,
  customFields,
  lastDelivery,
  isPending,
  onRun,
  onMessage,
  onTransition,
}: {
  config: WebhookConfig;
  baseUrl: string;
  customFields: CustomField[];
  lastDelivery: WebhookDelivery | null;
  isPending: boolean;
  onRun: (action: (formData: FormData) => Promise<{ ok: boolean; message: string; data?: unknown }>) => (formData: FormData) => void;
  onMessage: (message: string | null) => void;
  onTransition: React.TransitionStartFunction;
}) {
  const [showPayload, setShowPayload] = useState(false);
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

        {lastDelivery && (
          <div className="rounded-lg border border-border bg-background-subtle/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {lastDelivery.processed
                  ? <StatusOk />
                  : <StatusError text={lastDelivery.error ?? "Aguardando mapeamento"} />}
                <span className="text-xs text-text-muted">Ultimo recebimento: {formatDateTime(lastDelivery.created_at)}</span>
              </div>
              <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => setShowPayload((v) => !v)}>
                {showPayload ? "Ocultar payload" : "Ver payload"}
              </Button>
            </div>
            {showPayload && (
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border bg-sidebar-dark p-3 text-[10px] text-white">
                {JSON.stringify(lastDelivery.payload, null, 2)}
              </pre>
            )}
          </div>
        )}
        {!lastDelivery && (
          <p className="rounded-lg border border-border bg-background-subtle/50 px-3 py-2 text-xs text-text-muted">
            Nenhum payload recebido ainda. Cole a URL acima na ferramenta externa e envie um teste.
          </p>
        )}

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

function WhatsappChatPanel({
  chatsState,
  selectedJids,
  isPending,
  onSelectChange,
  onSelectAll,
  onClearSelection,
  onImport,
}: {
  instanceName: string;
  chatsState: { chats: ChatPreview[]; instanceId: string } | "loading";
  selectedJids: string[];
  isPending: boolean;
  onSelectChange: (jid: string, checked: boolean) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onImport: () => void;
}) {
  if (chatsState === "loading") {
    return (
      <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Buscando conversas na Evolution...
      </div>
    );
  }

  const { chats } = chatsState;
  const newChats = chats.filter((c) => !c.hasLead);

  return (
    <div className="space-y-3 border-t border-border px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-text-secondary">
          <span className="font-semibold text-text-primary">{chats.length}</span> conversa(s){" · "}
          <span className="font-semibold text-brand-green-deep">{newChats.length}</span> nova(s){" · "}
          <span className="font-semibold">{selectedJids.length}</span> selecionada(s)
        </p>
        <Button type="button" variant="ghost" size="sm" disabled={isPending || newChats.length === 0} onClick={onSelectAll}>
          Selecionar novas
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={isPending || selectedJids.length === 0} onClick={onClearSelection}>
          Limpar
        </Button>
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={isPending || selectedJids.length === 0}
          onClick={onImport}
        >
          <Download className="h-3.5 w-3.5" />
          Importar {selectedJids.length > 0 ? selectedJids.length : ""}
        </Button>
      </div>

      {chats.length === 0 ? (
        <p className="rounded-lg border border-border bg-background-subtle px-3 py-2 text-xs text-text-muted">
          Nenhuma conversa individual encontrada. Certifique-se de que o WhatsApp esta conectado.
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
          {chats.map((chat) => {
            const isSelected = selectedJids.includes(chat.remoteJid);
            return (
              <label
                key={chat.remoteJid}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors",
                  chat.hasLead
                    ? "cursor-default bg-background-subtle/50"
                    : isSelected
                      ? "bg-brand-green-soft"
                      : "bg-white hover:bg-background-subtle"
                )}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-brand-green"
                  checked={isSelected}
                  disabled={chat.hasLead || isPending}
                  onChange={(e) => onSelectChange(chat.remoteJid, e.target.checked)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-text-primary">
                    {chat.displayName}
                  </p>
                  {chat.name && (
                    <p className="text-[10px] text-text-muted">{chat.phone}</p>
                  )}
                </div>
                {chat.hasLead ? (
                  <Badge variant="green">Lead</Badge>
                ) : (
                  <Badge variant="secondary">Novo</Badge>
                )}
                {chat.lastMessageTimestamp !== null && (
                  <span className="shrink-0 text-[10px] text-text-muted">
                    {new Date(chat.lastMessageTimestamp * 1000).toLocaleDateString("pt-BR")}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UserEditRow({
  user,
  organizations,
  isSyncAdmin,
  isBanned,
  isPending,
  onRun,
  onMessage,
  onTransition,
}: {
  user: UserRow;
  organizations: Organization[];
  isSyncAdmin: boolean;
  isBanned: boolean;
  isPending: boolean;
  onRun: (action: (formData: FormData) => Promise<{ ok: boolean; message: string; data?: unknown }>) => (formData: FormData) => void;
  onMessage: (message: string | null) => void;
  onTransition: React.TransitionStartFunction;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex-1">
          <p className="text-sm font-semibold text-text-primary">{user.profile?.full_name ?? "-"}</p>
          <p className="text-xs text-text-muted">{user.profile?.email ?? "-"}</p>
        </div>
        <Badge variant="secondary">{ROLE_LABELS[user.role] ?? user.role}</Badge>
        {isBanned && <Badge variant="destructive">Desativado</Badge>}
        <span className="text-xs text-text-muted">{user.organization?.name ?? "-"}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Fechar" : "Editar"}
        </Button>
      </div>

      {expanded && (
        <form
          action={onRun(updateUserAction)}
          className="grid gap-3 border-t border-border bg-background-subtle/50 p-4 md:grid-cols-2"
        >
          <input type="hidden" name="user_id" value={user.profile?.id ?? user.id} />
          <Field label="Nome" name="full_name" defaultValue={user.profile?.full_name ?? ""} />
          <SelectField label="Perfil" name="role" defaultValue={user.role}>
            {(isSyncAdmin
              ? ["super_admin", "gestor_sync", "admin_clinica", "atendente", "leitura"]
              : ["admin_clinica", "atendente", "leitura"]
            ).map((role) => (
              <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>
            ))}
          </SelectField>
          {isSyncAdmin && (
            <SelectField label="Clinica" name="organization_id" defaultValue={user.organization_id}>
              {organizations.map((org) => (
                <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
              ))}
            </SelectField>
          )}
          <div className="flex flex-wrap items-end gap-2 md:col-span-2">
            <Button disabled={isPending}>Salvar alteracoes</Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => {
                if (!confirm("Gerar nova senha temporaria para este usuario?")) return;
                onTransition(async () => {
                  const result = await generatePasswordAction(user.profile?.id ?? user.id);
                  onMessage(result.message);
                });
              }}
            >
              Gerar nova senha
            </Button>
            {isSyncAdmin && (
              <Button
                type="button"
                variant={isBanned ? "secondary" : "destructive"}
                disabled={isPending}
                onClick={() => {
                  const action = isBanned ? "Reativar" : "Desativar";
                  if (!confirm(`${action} este usuario?`)) return;
                  onTransition(async () => {
                    const result = await toggleUserBanAction(user.profile?.id ?? user.id, !isBanned);
                    onMessage(result.message);
                  });
                }}
              >
                {isBanned ? "Reativar" : "Desativar"}
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
