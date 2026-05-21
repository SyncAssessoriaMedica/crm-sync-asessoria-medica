import { canAccessRoute } from "@/lib/permissions";
import { getOrganizationContext } from "@/lib/organization-context";
import { AccessDenied } from "@/components/layout/access-denied";
import { LeadsClient } from "./leads-client";
import type { LeadListItem, LeadOptionData } from "./types";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const context = await getOrganizationContext();
  const { admin, organizationId, organization, role: userRole } = context;

  if (!canAccessRoute(userRole, "/leads")) {
    return <AccessDenied />;
  }

  const [leadsResult, sourcesResult, pipelinesResult, customFieldsResult, tagsResult] = await Promise.all([
    admin
      .from("leads")
      .select(
        `
        *,
        source:lead_sources(*),
        stage:pipeline_stages(*),
        lead_tags(tags(*)),
        custom_field_values(field_id, value)
      `
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
    admin
      .from("lead_sources")
      .select("*")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true }),
    admin
      .from("pipelines")
      .select("id, pipeline_stages(*)")
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .maybeSingle(),
    admin
      .from("custom_fields")
      .select("*")
      .eq("organization_id", organizationId)
      .order("order", { ascending: true })
      .order("created_at", { ascending: true }),
    admin
      .from("tags")
      .select("id, name, color")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true }),
  ]);

  const options: LeadOptionData = {
    sources: (sourcesResult.data ?? []) as LeadOptionData["sources"],
    stages: ((pipelinesResult.data?.pipeline_stages ?? []) as LeadOptionData["stages"]).sort(
      (a, b) => a.order - b.order
    ),
    customFields: (customFieldsResult.data ?? []) as LeadOptionData["customFields"],
    tags: (tagsResult.data ?? []) as LeadOptionData["tags"],
  };

  if (leadsResult.error) {
    return (
      <div className="rounded-xl border border-border bg-white p-8 shadow-card">
        <p className="label-eyebrow text-danger-red">Erro</p>
        <h1 className="mt-1 text-xl font-black text-text-primary">Nao foi possivel carregar leads</h1>
        <p className="mt-2 text-sm text-text-secondary">{leadsResult.error.message}</p>
      </div>
    );
  }

  return (
    <LeadsClient
      leads={(leadsResult.data ?? []) as LeadListItem[]}
      options={options}
      organizationName={organization?.name ?? "Sync Marketing"}
    />
  );
}
