import { canAccessRoute } from "@/lib/permissions";
import { getDateRangeFromParams } from "@/lib/date-range";
import { getOrganizationContext } from "@/lib/organization-context";
import { AccessDenied } from "@/components/layout/access-denied";
import { LeadsClient } from "./leads-client";
import type { LeadListItem, LeadOptionData } from "./types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const VALID_SORT_FIELDS = ["created_at", "updated_at", "name", "potential_value", "procedure"] as const;
type SortField = typeof VALID_SORT_FIELDS[number];

type LeadsSearchParams = {
  period?: string;
  start?: string;
  end?: string;
  page?: string;
  q?: string;
  stage?: string;
  source?: string;
  service?: string;
  state?: string;
  city?: string;
  area?: string;
  followup?: string;
  sort?: string;
  dir?: string;
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: Promise<LeadsSearchParams>;
}) {
  const params = await searchParams;
  const range = getDateRangeFromParams(params);
  const context = await getOrganizationContext();
  const { admin, organizationId, organization, role: userRole } = context;

  if (!canAccessRoute(userRole, "/leads")) {
    return <AccessDenied />;
  }

  // ── Parse filter + pagination params ─────────────────────────────────────
  const page = Math.max(1, Number(params?.page ?? "1") || 1);
  const q = (params?.q ?? "").trim();
  const stageFilter = params?.stage ?? "";
  const sourceFilter = params?.source ?? "";
  const serviceFilter = params?.service ?? "";
  const stateFilter = params?.state ?? "";
  const cityFilter = params?.city ?? "";
  const areaFilter = params?.area ?? "";
  const followupFilter = params?.followup ?? "";
  const sortParam = (params?.sort ?? "created_at") as string;
  const sortField: SortField = (VALID_SORT_FIELDS as readonly string[]).includes(sortParam)
    ? (sortParam as SortField)
    : "created_at";
  const sortDir = params?.dir === "asc" ? "asc" : "desc";

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const now = new Date();
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  // ── Batch 1: options + open conversations (for follow-up) ─────────────────
  const [
    sourcesResult,
    servicesResult,
    pipelinesResult,
    customFieldsResult,
    tagsResult,
    statesResult,
    citiesResult,
    openConvsResult,
  ] = await Promise.all([
    admin.from("lead_sources").select("*").eq("organization_id", organizationId).order("name", { ascending: true }),
    admin.from("clinic_services").select("*").eq("organization_id", organizationId).order("order", { ascending: true }).order("name", { ascending: true }),
    admin.from("pipelines").select("id, pipeline_stages(*)").eq("organization_id", organizationId).eq("is_default", true).maybeSingle(),
    admin.from("custom_fields").select("*").eq("organization_id", organizationId).neq("key", "servico").order("order", { ascending: true }).order("created_at", { ascending: true }),
    admin.from("tags").select("id, name, color").eq("organization_id", organizationId).order("name", { ascending: true }),
    // Distinct states for filter dropdown
    admin.from("leads").select("detected_state").eq("organization_id", organizationId).not("detected_state", "is", null),
    // Distinct cities for filter dropdown
    admin.from("leads").select("detected_city").eq("organization_id", organizationId).not("detected_city", "is", null),
    // Open conversations (non-group) for follow-up detection
    admin.from("conversations").select("id, lead_id, remote_jid").eq("organization_id", organizationId).eq("status", "open").not("lead_id", "is", null),
  ]);

  // ── Compute no-followup lead IDs (for banner count + filter) ─────────────
  const openConvs = (openConvsResult.data ?? []).filter(
    (c) => !String(c.remote_jid ?? "").includes("@g.us")
  ) as { id: string; lead_id: string; remote_jid: string }[];
  const openConvIds = openConvs.map((c) => c.id);

  const recentMsgsResult =
    openConvIds.length > 0
      ? await admin
          .from("messages")
          .select("conversation_id, direction, created_at")
          .in("conversation_id", openConvIds)
          .order("created_at", { ascending: false })
      : { data: [] as { conversation_id: string; direction: string; created_at: string }[] };

  const lastMsgByConv = new Map<string, { direction: string; created_at: string }>();
  for (const msg of recentMsgsResult.data ?? []) {
    if (!lastMsgByConv.has(msg.conversation_id)) {
      lastMsgByConv.set(msg.conversation_id, msg);
    }
  }

  const noFollowupLeadIds = new Set<string>();
  for (const conv of openConvs) {
    const last = lastMsgByConv.get(conv.id);
    if (
      last?.direction === "inbound" &&
      new Date(last.created_at).getTime() < fortyEightHoursAgo.getTime()
    ) {
      noFollowupLeadIds.add(conv.lead_id);
    }
  }
  const noFollowupCount = noFollowupLeadIds.size;

  // ── Build main leads query with server-side filters ───────────────────────
  type LeadRow = LeadListItem;

  let query = admin
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
    .lt("created_at", range.end.toISOString());

  // Apply filters
  if (stageFilter) query = query.eq("stage_id", stageFilter);
  if (sourceFilter) query = query.eq("source_id", sourceFilter);
  if (serviceFilter) query = query.eq("service_id", serviceFilter);
  if (stateFilter) query = query.eq("detected_state", stateFilter);
  if (cityFilter) query = query.eq("detected_city", cityFilter);
  if (areaFilter) query = query.eq("service_area_status", areaFilter);

  if (q) {
    const digits = q.replace(/\D/g, "");
    const conditions: string[] = [`name.ilike.%${q}%`, `procedure.ilike.%${q}%`];
    if (digits.length >= 4) conditions.push(`phone.ilike.%${digits}%`);
    if (q.includes("@")) conditions.push(`email.ilike.%${q}%`);
    query = query.or(conditions.join(","));
  }

  if (followupFilter === "no_followup_48h") {
    const ids = Array.from(noFollowupLeadIds);
    if (ids.length === 0) {
      // No matching leads — ensure empty result
      query = query.eq("id", "00000000-0000-0000-0000-000000000000");
    } else {
      query = query.in("id", ids);
    }
  }

  // Apply sort + pagination
  query = query
    .order(sortField, { ascending: sortDir === "asc" })
    .range(from, to);

  const leadsResult = await query;

  if (leadsResult.error) {
    return (
      <div className="rounded-xl border border-border bg-white p-8 shadow-card">
        <p className="label-eyebrow text-danger-red">Erro</p>
        <h1 className="mt-1 text-xl font-black text-text-primary">Nao foi possivel carregar leads</h1>
        <p className="mt-2 text-sm text-text-secondary">{leadsResult.error.message}</p>
      </div>
    );
  }

  const totalCount = leadsResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // ── Fetch conversations for current page only ─────────────────────────────
  const currentPageLeadIds = (leadsResult.data ?? []).map((l) => l.id as string);

  const pageConvsResult =
    currentPageLeadIds.length > 0
      ? await admin
          .from("conversations")
          .select("id, lead_id, remote_jid, updated_at")
          .eq("organization_id", organizationId)
          .in("lead_id", currentPageLeadIds)
          .not("lead_id", "is", null)
          .order("updated_at", { ascending: false })
      : { data: [] as { id: string; lead_id: string; remote_jid: string; updated_at: string }[] };

  const inboxConvByLeadId = new Map<string, string>();
  for (const conv of pageConvsResult.data ?? []) {
    if (!conv.lead_id || String(conv.remote_jid ?? "").includes("@g.us")) continue;
    if (!inboxConvByLeadId.has(conv.lead_id)) {
      inboxConvByLeadId.set(conv.lead_id, conv.id);
    }
  }

  // ── Combine lead data with computed flags ─────────────────────────────────
  const leads = ((leadsResult.data ?? []) as LeadRow[]).map((lead) => ({
    ...lead,
    no_followup_48h: noFollowupLeadIds.has(lead.id),
    inbox_conversation_id: inboxConvByLeadId.get(lead.id) ?? null,
  }));

  // ── Build options ─────────────────────────────────────────────────────────
  const options: LeadOptionData = {
    sources: (sourcesResult.data ?? []) as LeadOptionData["sources"],
    services: (servicesResult.data ?? []) as LeadOptionData["services"],
    stages: ((pipelinesResult.data?.pipeline_stages ?? []) as LeadOptionData["stages"]).sort(
      (a, b) => a.order - b.order
    ),
    customFields: (customFieldsResult.data ?? []) as LeadOptionData["customFields"],
    tags: (tagsResult.data ?? []) as LeadOptionData["tags"],
  };

  // Distinct states and cities for filter dropdowns
  const distinctStates = [
    ...new Set(
      (statesResult.data ?? [])
        .map((r) => r.detected_state as string | null)
        .filter((s): s is string => s !== null && s.trim() !== "")
    ),
  ].sort();

  const distinctCities = [
    ...new Set(
      (citiesResult.data ?? [])
        .map((r) => r.detected_city as string | null)
        .filter((c): c is string => c !== null && c.trim() !== "")
    ),
  ].sort();

  return (
    <LeadsClient
      leads={leads}
      options={options}
      locationOptions={{ states: distinctStates, cities: distinctCities }}
      organizationId={organizationId}
      organizationName={organization?.name ?? "Sync Marketing"}
      periodLabel={range.label}
      role={userRole}
      pagination={{
        page,
        pageSize: PAGE_SIZE,
        total: totalCount,
        totalPages,
        from: totalCount === 0 ? 0 : from + 1,
        to: Math.min(to + 1, totalCount),
      }}
      filters={{
        q,
        stage: stageFilter,
        source: sourceFilter,
        service: serviceFilter,
        state: stateFilter,
        city: cityFilter,
        area: areaFilter,
        followup: followupFilter,
        sort: sortField,
        dir: sortDir,
      }}
      noFollowupCount={noFollowupCount}
    />
  );
}
