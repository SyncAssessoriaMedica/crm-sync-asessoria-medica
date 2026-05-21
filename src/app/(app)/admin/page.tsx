import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { AdminClient, type AdminData } from "./admin-client";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: profile }, { data: membership }] = await Promise.all([
    admin.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    admin
      .from("organization_members")
      .select("organization_id, role, organizations(name)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!membership) {
    return (
      <div className="rounded-xl border border-border bg-white p-8 shadow-card">
        <p className="label-eyebrow text-text-muted">Acesso</p>
        <h1 className="mt-1 text-xl font-black text-text-primary">Organizacao nao configurada</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Este usuario ainda nao possui uma organizacao vinculada.
        </p>
      </div>
    );
  }

  const organizationId = membership.organization_id as string;
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const userRole = (profile?.role ?? membership.role) as string;
  const isSyncAdmin = userRole === "super_admin" || userRole === "gestor_sync";
  const canManage = isSyncAdmin || membership.role === "admin_clinica";

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

  const orgFilter = isSyncAdmin ? undefined : organizationId;
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
  ] = await Promise.all([
    admin.from("organizations").select("id, name, slug, subscription_status, created_at").order("created_at", { ascending: false }),
    admin
      .from("organization_members")
      .select("id, role, organization_id, organizations(id, name), profiles(id, email, full_name, role)")
      .order("created_at", { ascending: false }),
    (isSyncAdmin
      ? admin.from("whatsapp_instances").select("id, instance_name, phone_number, status, created_at, organizations(id, name)").order("created_at", { ascending: false })
      : admin.from("whatsapp_instances").select("id, instance_name, phone_number, status, created_at, organizations(id, name)").eq("organization_id", organizationId).order("created_at", { ascending: false })),
    admin.from("webhook_events").select("id, source, event_type, payload, processed, error, created_at").eq("organization_id", organizationId).eq("source", "inbound_webhook_config").order("created_at", { ascending: false }).limit(50),
    admin.from("webhook_events").select("id, source, event_type, payload, processed, error, created_at").eq("organization_id", organizationId).eq("source", "inbound_webhook_incoming").order("created_at", { ascending: false }).limit(10),
    admin.from("custom_fields").select("id, name, key, field_type, options, required, order, created_at").eq("organization_id", organizationId).order("order", { ascending: true }).order("created_at", { ascending: true }),
    admin
      .from("pipelines")
      .select("id, pipeline_stages(id, pipeline_id, name, order, color)")
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .maybeSingle(),
    admin.from("tags").select("id, name, color, created_at").eq("organization_id", organizationId).order("name", { ascending: true }),
    admin.from("lead_sources").select("id, name, color, created_at").eq("organization_id", organizationId).order("name", { ascending: true }),
  ]);

  const rawUsers = usersResult.data ?? [];
  const scopedUsers = orgFilter ? rawUsers.filter((item) => item.organization_id === orgFilter) : rawUsers;
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

  const data: AdminData = {
    isSyncAdmin,
    baseUrl: `${protocol}://${host}`,
    organizationName: ((membership.organizations as { name?: string } | null)?.name ?? "Sync Marketing"),
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
  };

  return <AdminClient data={data} />;
}
