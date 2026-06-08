import { canAccessRoute } from "@/lib/permissions";
import { getDateRangeFromParams } from "@/lib/date-range";
import { getOrganizationContext } from "@/lib/organization-context";
import { AccessDenied } from "@/components/layout/access-denied";
import { KanbanClient } from "./kanban-client";
import type { LeadListItem, LeadOptionData } from "../leads/types";

export const dynamic = "force-dynamic";

// Initial leads per column — keeps the page load fast
const KANBAN_COLUMN_PAGE_SIZE = 50;

const NO_STAGE_ID = "__no_stage__";

export type KanbanColumnData = {
  stageId: string | null;
  name: string;
  color: string | null;
  leads: LeadListItem[];
  total: number;
};

type KanbanSearchParams = {
  period?: string;
  start?: string;
  end?: string;
  source?: string;
  service?: string;
  q?: string;
};

export default async function KanbanPage({
  searchParams,
}: {
  searchParams?: Promise<KanbanSearchParams>;
}) {
  const params = await searchParams;
  const range = getDateRangeFromParams(params);
  const context = await getOrganizationContext();
  const { admin, organizationId, organization, role: userRole } = context;

  if (!canAccessRoute(userRole, "/kanban")) {
    return <AccessDenied />;
  }

  const sourceFilter = params?.source ?? "";
  const serviceFilter = params?.service ?? "";
  const q = (params?.q ?? "").trim();

  // ── Load options ──────────────────────────────────────────────────────────
  const [sourcesResult, servicesResult, pipelinesResult] = await Promise.all([
    admin.from("lead_sources").select("*").eq("organization_id", organizationId).order("name", { ascending: true }),
    admin.from("clinic_services").select("*").eq("organization_id", organizationId).order("order", { ascending: true }).order("name", { ascending: true }),
    admin.from("pipelines").select("id, pipeline_stages(*)").eq("organization_id", organizationId).eq("is_default", true).maybeSingle(),
  ]);

  const stages = ((pipelinesResult.data?.pipeline_stages ?? []) as LeadOptionData["stages"]).sort(
    (a, b) => a.order - b.order
  );

  const options: LeadOptionData = {
    sources: (sourcesResult.data ?? []) as LeadOptionData["sources"],
    services: (servicesResult.data ?? []) as LeadOptionData["services"],
    stages,
    customFields: [],
    tags: [],
  };

  // ── Helper: build a filtered column query ─────────────────────────────────
  function buildColumnBase() {
    let q2 = admin
      .from("leads")
      .select(
        `*,
        source:lead_sources(*),
        service:clinic_services(*),
        stage:pipeline_stages(*),
        lead_tags(tags(*)),
        custom_field_values(field_id, value)`,
        { count: "exact" }
      )
      .eq("organization_id", organizationId)
      .gte("created_at", range.start.toISOString())
      .lt("created_at", range.end.toISOString())
      .order("updated_at", { ascending: false });

    if (sourceFilter) q2 = q2.eq("source_id", sourceFilter);
    if (serviceFilter) q2 = q2.eq("service_id", serviceFilter);
    if (q) {
      const digits = q.replace(/\D/g, "");
      const conditions = [`name.ilike.%${q}%`, `procedure.ilike.%${q}%`];
      if (digits.length >= 4) conditions.push(`phone.ilike.%${digits}%`);
      q2 = q2.or(conditions.join(","));
    }
    return q2;
  }

  // ── Fetch all columns in parallel ─────────────────────────────────────────
  const allColumnIds: Array<string | null> = [null, ...stages.map((s) => s.id)];

  const columnResults = await Promise.all(
    allColumnIds.map((stageId) => {
      const base = buildColumnBase();
      if (stageId === null) {
        return base.is("stage_id", null).range(0, KANBAN_COLUMN_PAGE_SIZE - 1);
      }
      return base.eq("stage_id", stageId).range(0, KANBAN_COLUMN_PAGE_SIZE - 1);
    })
  );

  if (columnResults.some((r) => r.error)) {
    const err = columnResults.find((r) => r.error)!.error;
    return (
      <div className="rounded-xl border border-border bg-white p-8 shadow-card">
        <p className="label-eyebrow text-danger-red">Erro</p>
        <h1 className="mt-1 text-xl font-black text-text-primary">Nao foi possivel carregar o Kanban</h1>
        <p className="mt-2 text-sm text-text-secondary">{err?.message}</p>
      </div>
    );
  }

  const columnNames: Record<string, string> = { [NO_STAGE_ID]: "Sem etapa" };
  const columnColors: Record<string, string | null> = { [NO_STAGE_ID]: "#94a3b8" };
  for (const stage of stages) {
    columnNames[stage.id] = stage.name;
    columnColors[stage.id] = stage.color ?? null;
  }

  const initialColumns: KanbanColumnData[] = allColumnIds.map((stageId, i) => {
    const result = columnResults[i];
    const key = stageId ?? NO_STAGE_ID;
    return {
      stageId,
      name: columnNames[key] ?? "Desconhecido",
      color: columnColors[key] ?? null,
      leads: (result.data ?? []) as LeadListItem[],
      total: result.count ?? 0,
    };
  });

  return (
    <KanbanClient
      key={`${range.start.toISOString()}-${range.end.toISOString()}-${sourceFilter}-${serviceFilter}-${q}`}
      initialColumns={initialColumns}
      options={options}
      organizationName={organization?.name ?? "Sync Marketing"}
      periodLabel={range.label}
      periodStart={range.start.toISOString()}
      periodEnd={range.end.toISOString()}
      currentFilters={{ source: sourceFilter, service: serviceFilter, q }}
    />
  );
}
