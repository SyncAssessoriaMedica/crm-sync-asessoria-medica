import { canAccessRoute } from "@/lib/permissions";
import { getDateRangeFromParams } from "@/lib/date-range";
import { getOrganizationContext } from "@/lib/organization-context";
import { AccessDenied } from "@/components/layout/access-denied";
import { KanbanClient } from "./kanban-client";
import type { LeadListItem, LeadOptionData } from "../leads/types";

export const dynamic = "force-dynamic";

export default async function KanbanPage({
  searchParams,
}: {
  searchParams?: Promise<{ period?: string; start?: string; end?: string }>;
}) {
  const params = await searchParams;
  const range = getDateRangeFromParams(params);
  const context = await getOrganizationContext();
  const { admin, organizationId, organization, role: userRole } = context;

  if (!canAccessRoute(userRole, "/kanban")) {
    return <AccessDenied />;
  }

  const [leadsResult, sourcesResult, pipelinesResult] = await Promise.all([
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
      .gte("created_at", range.start.toISOString())
      .lt("created_at", range.end.toISOString())
      .order("updated_at", { ascending: false }),
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
  ]);

  const options: LeadOptionData = {
    sources: (sourcesResult.data ?? []) as LeadOptionData["sources"],
    stages: ((pipelinesResult.data?.pipeline_stages ?? []) as LeadOptionData["stages"]).sort(
      (a, b) => a.order - b.order
    ),
    customFields: [],
    tags: [],
  };

  if (leadsResult.error) {
    return (
      <div className="rounded-xl border border-border bg-white p-8 shadow-card">
        <p className="label-eyebrow text-danger-red">Erro</p>
        <h1 className="mt-1 text-xl font-black text-text-primary">Nao foi possivel carregar o Kanban</h1>
        <p className="mt-2 text-sm text-text-secondary">{leadsResult.error.message}</p>
      </div>
    );
  }

  return (
    <KanbanClient
      leads={(leadsResult.data ?? []) as LeadListItem[]}
      options={options}
      organizationName={organization?.name ?? "Sync Marketing"}
      periodLabel={range.label}
    />
  );
}
