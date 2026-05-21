import { redirect } from "next/navigation";
import { AccessDenied } from "@/components/layout/access-denied";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { canAccessRoute } from "@/lib/permissions";
import { SettingsClient, type SettingsData } from "./settings-client";

const defaultNotificationPreferences = {
  new_lead: true,
  lead_without_response: true,
  lead_without_followup: false,
  appointment_confirmed: true,
};

export default async function SettingsPage() {
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
      .select("organization_id, role, organizations(id, name, slug, logo_url, subscription_status)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!membership?.organization_id) {
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

  const effectiveRole = (profile?.role ?? membership.role) as string;
  if (!canAccessRoute(effectiveRole, "/settings")) {
    return <AccessDenied />;
  }

  const organization = Array.isArray(membership.organizations)
    ? membership.organizations[0] ?? null
    : membership.organizations;

  const { data: settings } = await admin
    .from("organization_settings")
    .select("cnpj, city, state, scheduling_url, notification_preferences")
    .eq("organization_id", membership.organization_id)
    .maybeSingle();

  const notificationPreferences =
    settings?.notification_preferences && typeof settings.notification_preferences === "object"
      ? {
          ...defaultNotificationPreferences,
          ...(settings.notification_preferences as Record<string, boolean>),
        }
      : defaultNotificationPreferences;

  const data: SettingsData = {
    organization: {
      id: membership.organization_id as string,
      name: organization?.name ?? "Sync Marketing",
      slug: organization?.slug ?? "",
      logo_url: organization?.logo_url ?? null,
      subscription_status: organization?.subscription_status ?? "trial",
    },
    settings: {
      cnpj: settings?.cnpj ?? "",
      city: settings?.city ?? "",
      state: settings?.state ?? "",
      scheduling_url: settings?.scheduling_url ?? "",
      notification_preferences: notificationPreferences,
    },
    user: {
      role: effectiveRole,
    },
  };

  return <SettingsClient data={data} />;
}
