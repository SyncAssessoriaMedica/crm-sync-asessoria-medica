import { headers } from "next/headers";
import { getOrganizationContext } from "@/lib/organization-context";
import { parseOrgBusinessHours } from "@/lib/business-hours";
import { AdminClient, type AdminData } from "./admin-client";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const context = await getOrganizationContext();
  const { admin, organizationId, organization, membershipRole, isSyncAdmin } = context;
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const canManage = isSyncAdmin || membershipRole === "admin_clinica";

  if (!canManage) {
    return (
      <div className="rounded-xl border border-border bg-white p-8 shadow-card">
        <p className="label-eyebrow text-danger-red">Permissao</p>
        <h1 className="mt-1 text-xl font-black text-text-primary">Administrador restrito</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Sua conta nao tem permissao para alterar configuracoes da organizacao.
        </p>
      </div>
    );
  }

  const [
    organizationsResult,
    usersResult,
    whatsappResult,
    webhookConfigResult,
    webhookDeliveryResult,
    customFieldsResult,
    stagesResult,
    tagsResult,
    sourcesResult,
    servicesResult,
    sourceRulesResult,
    bhAutoReplySettingsResult,
    organizationSettingsResult,
    bhQueueResult,
  ] = await Promise.all([
    admin.from("organizations").select("id, name, slug, subscription_status, created_at").order("created_at", { ascending: false }),
    admin
      .from("organization_members")
      .select("id, role, organization_id, organizations(id, name), profiles(id, email, full_name, role)")
      .order("created_at", { ascending: false }),
    admin.from("whatsapp_instances").select("id, instance_name, phone_number, status, created_at, organizations(id, name)").eq("organization_id", organizationId).is("deleted_at", null).order("created_at", { ascending: false }),
    admin.from("webhook_events").select("id, source, event_type, payload, processed, error, created_at").eq("organization_id", organizationId).eq("source", "inbound_webhook_config").order("created_at", { ascending: false }).limit(50),
    admin.from("webhook_events").select("id, source, event_type, payload, processed, error, created_at").eq("organization_id", organizationId).eq("source", "inbound_webhook_incoming").order("created_at", { ascending: false }).limit(10),
    admin.from("custom_fields").select("id, name, key, field_type, options, required, order, created_at").eq("organization_id", organizationId).neq("key", "servico").order("order", { ascending: true }).order("created_at", { ascending: true }),
    admin
      .from("pipelines")
      .select("id, pipeline_stages(id, pipeline_id, name, order, color)")
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .maybeSingle(),
    admin.from("tags").select("id, name, color, created_at").eq("organization_id", organizationId).order("name", { ascending: true }),
    admin.from("lead_sources").select("id, name, color, active, is_default, created_at").eq("organization_id", organizationId).order("name", { ascending: true }),
    admin.from("clinic_services").select("id, name, active, order").eq("organization_id", organizationId).order("order", { ascending: true }).order("name", { ascending: true }),
    admin.from("lead_source_rules").select("id, source_id, name, match_type, pattern, case_sensitive, normalize_whitespace, overwrite_existing, active, priority, created_at").eq("organization_id", organizationId).order("priority", { ascending: true }).order("created_at", { ascending: true }),
    admin.from("bh_auto_reply_settings").select("enabled, message_template, delay_minutes, cooldown_hours, timezone").eq("organization_id", organizationId).maybeSingle(),
    admin.from("organization_settings").select("business_hours").eq("organization_id", organizationId).maybeSingle(),
    admin.from("bh_auto_reply_queue").select("status").eq("organization_id", organizationId),
  ]);

  const rawUsers = usersResult.data ?? [];
  const scopedUsers = rawUsers.filter((item) => item.organization_id === organizationId);
  const webhookConfigsByToken = new Map<string, AdminData["webhookConfigs"][number]>();
  for (const event of webhookConfigResult.data ?? []) {
    const payload = event.payload as {
      token?: string;
      name?: string;
      active?: boolean;
      mappings?: AdminData["webhookConfigs"][number]["mappings"];
    };
    if (!payload.token || webhookConfigsByToken.has(payload.token)) continue;
    webhookConfigsByToken.set(payload.token, {
      id: event.id,
      token: payload.token,
      name: payload.name ?? "Webhook",
      active: payload.active !== false,
      mappings: payload.mappings ?? {},
      created_at: event.created_at,
    });
  }

  const { data: authListData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const now = new Date();
  const bannedUserIds = (authListData?.users ?? [])
    .filter((u) => u.banned_until && new Date(u.banned_until) > now)
    .map((u) => u.id);

  const lastDeliveryByToken: Record<string, AdminData["webhookDeliveries"][number]> = {};
  for (const delivery of webhookDeliveryResult.data ?? []) {
    const token = (delivery.payload as Record<string, unknown>)?.token as string | undefined;
    if (token && !lastDeliveryByToken[token]) {
      lastDeliveryByToken[token] = delivery;
    }
    if (!token && !lastDeliveryByToken["__unknown"]) {
      lastDeliveryByToken["__unknown"] = delivery;
    }
  }

  const bhQueueItems = (bhQueueResult.data ?? []) as { status: string }[];
  const bhAutoReplyStats = { pending: 0, sent: 0, failed: 0, cancelled: 0 };
  for (const item of bhQueueItems) {
    if (item.status === "pending") bhAutoReplyStats.pending++;
    else if (item.status === "sent") bhAutoReplyStats.sent++;
    else if (item.status === "failed") bhAutoReplyStats.failed++;
    else if (item.status === "cancelled") bhAutoReplyStats.cancelled++;
  }

  const data: AdminData = {
    isSyncAdmin,
    baseUrl: `${protocol}://${host}`,
    organizationName: organization.name ?? "Sync Marketing",
    organizations: organizationsResult.data ?? [],
    users: scopedUsers.map((item) => ({
      id: item.id,
      role: item.role,
      organization_id: item.organization_id,
      organization: Array.isArray(item.organizations) ? item.organizations[0] ?? null : item.organizations,
      profile: Array.isArray(item.profiles) ? item.profiles[0] ?? null : item.profiles,
    })),
    whatsappInstances: whatsappResult.data ?? [],
    webhookConfigs: Array.from(webhookConfigsByToken.values()),
    webhookDeliveries: webhookDeliveryResult.data ?? [],
    bannedUserIds,
    lastDeliveryByToken,
    customFields: customFieldsResult.data ?? [],
    pipelineStages: ((stagesResult.data?.pipeline_stages ?? []) as AdminData["pipelineStages"]).sort((a, b) => a.order - b.order),
    tags: tagsResult.data ?? [],
    sources: sourcesResult.data ?? [],
    services: servicesResult.data ?? [],
    sourceRules: sourceRulesResult.data ?? [],
    bhAutoReplySettings: bhAutoReplySettingsResult.data as AdminData["bhAutoReplySettings"],
    businessHours: parseOrgBusinessHours(organizationSettingsResult.data?.business_hours),
    bhAutoReplyStats,
  };

  return <AdminClient data={data} />;
}
