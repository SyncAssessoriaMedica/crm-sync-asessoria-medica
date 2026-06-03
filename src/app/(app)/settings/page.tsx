import { AccessDenied } from "@/components/layout/access-denied";
import { canAccessRoute } from "@/lib/permissions";
import { parseServiceArea } from "@/lib/lead-location";
import { getOrganizationContext } from "@/lib/organization-context";
import { SettingsClient, type SettingsData } from "./settings-client";

const defaultNotificationPreferences = {
  new_lead: true,
  lead_without_response: true,
  lead_without_followup: false,
  appointment_confirmed: true,
};

const defaultBusinessHours = {
  startTime: "",
  endTime: "",
  workingDays: [] as number[],
  timezone: "America/Sao_Paulo",
};

function parseBusinessHours(value: unknown) {
  if (!value || typeof value !== "object") return defaultBusinessHours;
  const data = value as Record<string, unknown>;
  const workingDays = Array.isArray(data.workingDays)
    ? data.workingDays.filter((day): day is number => typeof day === "number" && day >= 0 && day <= 6)
    : [];

  return {
    startTime: typeof data.startTime === "string" ? data.startTime : "",
    endTime: typeof data.endTime === "string" ? data.endTime : "",
    workingDays,
    timezone: typeof data.timezone === "string" ? data.timezone : "America/Sao_Paulo",
  };
}

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const context = await getOrganizationContext();
  const { admin, organizationId, organization, role: effectiveRole } = context;
  if (!canAccessRoute(effectiveRole, "/settings")) {
    return <AccessDenied />;
  }

  const { data: settings } = await admin
    .from("organization_settings")
    .select("cnpj, city, state, scheduling_url, notification_preferences, business_hours, service_area")
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
      business_hours: parseBusinessHours(settings?.business_hours),
      service_area: parseServiceArea(settings?.service_area),
    },
    user: {
      role: effectiveRole,
    },
  };

  return <SettingsClient data={data} />;
}
