import { redirect } from "next/navigation";
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
    webhookResult,
    customFieldsResult,
    tagsResult,
    sourcesResult,
  ] = await Promise.all([
    admin.from("organizations").select("id, name, slug, subscription_status, created_at").order("created_at", { ascending: false }),
    admin
      .from("organization_members")
      .select("id, role, organization_id, organizations(id, name), profiles(id, email, full_name, role)")
      .order("created_at", { ascending: false }),
    admin.from("whatsapp_instances").select("id, instance_name, phone_number, status, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    admin.from("webhook_events").select("id, source, event_type, processed, error, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(8),
    admin.from("custom_fields").select("id, name, key, field_type, options, required, order, created_at").eq("organization_id", organizationId).order("order", { ascending: true }).order("created_at", { ascending: true }),
    admin.from("tags").select("id, name, color, created_at").eq("organization_id", organizationId).order("name", { ascending: true }),
    admin.from("lead_sources").select("id, name, color, created_at").eq("organization_id", organizationId).order("name", { ascending: true }),
  ]);

  const rawUsers = usersResult.data ?? [];
  const scopedUsers = orgFilter ? rawUsers.filter((item) => item.organization_id === orgFilter) : rawUsers;

  const data: AdminData = {
    isSyncAdmin,
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
    webhookEvents: webhookResult.data ?? [],
    customFields: customFieldsResult.data ?? [],
    tags: tagsResult.data ?? [],
    sources: sourcesResult.data ?? [],
  };

  return <AdminClient data={data} />;
}
