import { AccessDenied } from "@/components/layout/access-denied";
import { canAccessRoute } from "@/lib/permissions";
import { getOrganizationContext } from "@/lib/organization-context";
import { SettingsClient, type SettingsData } from "./settings-client";

const defaultNotificationPreferences = {
  new_lead: true,
  lead_without_response: true,
  lead_without_followup: false,
  appointment_confirmed: true,
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const context = await getOrganizationContext();
  const { admin, organizationId, organization, role: effectiveRole } = context;
  if (!canAccessRoute(effectiveRole, "/settings")) {
    return <AccessDenied />;
  }

  const { data: settings } = await admin
    .from("organization_settings")
    .select("cnpj, city, state, scheduling_url, notification_preferences")
    .eq("organization_id", organizationId)
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
      id: organizationId,
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
