import Link from "next/link";
import {
  AlertCircle,
  Bell,
  CalendarCheck,
  Clock,
  DollarSign,
  MapPin,
  UserCheck,
  Users,
} from "lucide-react";
import { ConversionFunnelChart, DailyLeadsChart, LeadsByLocationChart, LeadsBySourceChart } from "@/components/dashboard/charts";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { businessHoursMs, parseOrgBusinessHours, type OrgBusinessHours } from "@/lib/business-hours";
import { getDateRangeFromParams } from "@/lib/date-range";
import { fetchAllRows } from "@/lib/supabase-pagination";
import {
  LOCATION_STATUS_LABELS,
  normalizeLocationText,
  normalizeState,
  parseServiceArea,
  type ServiceAreaCity,
  type ServiceAreaSettings,
} from "@/lib/lead-location";
import { getOrganizationContext } from "@/lib/organization-context";
import { cn, formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import type { ConversionFunnelItem, DailyLeadsData, LeadStatus, LeadsByLocation, LeadsBySource } from "@/lib/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const PIE_COLORS = ["#22c55e", "#16a34a", "#46e27f", "#0f4f2a", "#8a948d"];

// ─── Types ────────────────────────────────────────────────────────────────────

type ResponseMode = "business_hours" | "real_time";

type DashboardLead = {
  id: string;
  source_id: string | null;
  service_id: string | null;
  stage_id: string | null;
  status: LeadStatus;
  potential_value: number | null;
  closed_value: number | null;
  created_at: string;
  last_interaction_at: string | null;
  source: { name: string | null } | null;
  service: { id: string; name: string | null; active: boolean | null } | null;
  stage: { id: string; name: string; order: number } | null;
  detected_city: string | null;
  detected_state: string | null;
  phone_ddd: string | null;
  service_area_status: "inside" | "possible" | "outside" | "unknown";
};

type DashboardLeadRow = Omit<DashboardLead, "source" | "service" | "stage"> & {
  source: DashboardLead["source"] | NonNullable<DashboardLead["source"]>[];
  service: DashboardLead["service"] | NonNullable<DashboardLead["service"]>[];
  stage: DashboardLead["stage"] | NonNullable<DashboardLead["stage"]>[];
};

// For previous period we only need the fields used in variation calculations
type PreviousLead = {
  id: string;
  service_id: string | null;
  stage_id: string | null;
  status: LeadStatus;
  potential_value: number | null;
  closed_value: number | null;
  created_at: string;
};

type PreviousLeadRow = Omit<PreviousLead, never>;

type StageOption = {
  id: string;
  name: string;
  order: number;
};

type MsgRow = {
  conversation_id: string;
  direction: string;
  created_at: string;
};

export const dynamic = "force-dynamic";

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function percent(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0;
}

function variation(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function wasScheduled(lead: DashboardLead | PreviousLead, hasBeenScheduledIds: Set<string>) {
  return lead.status === "scheduled" || hasBeenScheduledIds.has(lead.id);
}

function getResponseMode(value?: string): ResponseMode {
  return value === "real_time" ? "real_time" : "business_hours";
}

// ─── Metric helpers ───────────────────────────────────────────────────────────

function buildDailyData(leads: DashboardLead[], start: Date, end: Date, hasBeenScheduledIds: Set<string>): DailyLeadsData[] {
  const days: DailyLeadsData[] = [];
  const cursor = startOfDay(start);
  while (cursor < end) {
    const key = cursor.toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(cursor);
    const dayLeads = leads.filter((lead) => lead.created_at.slice(0, 10) === key);
    days.push({
      date: label,
      leads: dayLeads.length,
      scheduled: dayLeads.filter((lead) => wasScheduled(lead, hasBeenScheduledIds)).length,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function buildSourceData(leads: DashboardLead[]): LeadsBySource[] {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const source = lead.source?.name ?? "Sem origem";
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, count]) => ({
      source,
      count,
      percentage: percent(count, leads.length),
    }))
    .sort((a, b) => b.count - a.count);
}

function buildLocationData(leads: DashboardLead[]): LeadsByLocation[] {
  const counts = new Map<
    string,
    {
      city: string;
      state: string;
      count: number;
      serviceAreaStatus: LeadsByLocation["serviceAreaStatus"];
    }
  >();

  for (const lead of leads) {
    const city = lead.detected_city?.trim() || "Sem localizacao";
    const state = lead.detected_state?.trim() || "";
    const key = `${city}|${state}`;
    const previous = counts.get(key);
    counts.set(key, {
      city,
      state,
      count: (previous?.count ?? 0) + 1,
      serviceAreaStatus:
        previous?.serviceAreaStatus === "inside"
          ? "inside"
          : lead.service_area_status ?? previous?.serviceAreaStatus ?? "unknown",
    });
  }

  return [...counts.values()]
    .map((item) => ({
      location: item.state ? `${item.city} / ${item.state}` : item.city,
      city: item.city,
      state: item.state,
      count: item.count,
      percentage: percent(item.count, leads.length),
      serviceAreaStatus: item.serviceAreaStatus,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function uniqueServiceCities(serviceArea: ServiceAreaSettings): ServiceAreaCity[] {
  const cities = new Map<string, ServiceAreaCity>();
  const primaryCity = serviceArea.primaryCity.trim();
  const primaryState = normalizeState(serviceArea.primaryState);

  if (primaryCity && primaryState) {
    cities.set(`${normalizeLocationText(primaryCity)}|${primaryState}`, {
      city: primaryCity,
      state: primaryState,
      priority: "primary",
    });
  }

  for (const item of serviceArea.servedCities) {
    const state = normalizeState(item.state);
    const city = item.city.trim();
    if (!city || !state) continue;
    cities.set(`${normalizeLocationText(city)}|${state}`, {
      city,
      state,
      priority: item.priority ?? "secondary",
    });
  }

  return [...cities.values()];
}

function buildServiceRegionData(leads: DashboardLead[], serviceArea: ServiceAreaSettings): LeadsByLocation[] {
  const serviceCities = uniqueServiceCities(serviceArea);
  if (serviceCities.length === 0) return buildLocationData(leads);

  const citiesByState = serviceCities.reduce<Record<string, ServiceAreaCity[]>>((acc, city) => {
    const state = normalizeState(city.state);
    acc[state] ??= [];
    acc[state].push(city);
    return acc;
  }, {});

  const counts = new Map<
    string,
    {
      location: string;
      city: string;
      state: string;
      count: number;
      serviceAreaStatus: LeadsByLocation["serviceAreaStatus"];
      description: string;
      sortWeight: number;
    }
  >();

  function increment(item: Omit<LeadsByLocation, "count" | "percentage" | "description"> & { description: string; sortWeight: number }) {
    const previous = counts.get(item.location);
    counts.set(item.location, {
      ...item,
      count: (previous?.count ?? 0) + 1,
      sortWeight: previous?.sortWeight ?? item.sortWeight,
    });
  }

  for (const lead of leads) {
    const leadState = normalizeState(lead.detected_state);
    const leadCity = normalizeLocationText(lead.detected_city);

    if (!leadState || !leadCity) {
      increment({
        location: "Sem localizacao",
        city: "Sem localizacao",
        state: "",
        serviceAreaStatus: "unknown",
        description: "Leads sem DDD ou localizacao detectada",
        sortWeight: 4,
      });
      continue;
    }

    const exactCity = serviceCities.find(
      (city) => normalizeState(city.state) === leadState && normalizeLocationText(city.city) === leadCity
    );

    if (exactCity) {
      increment({
        location: `${exactCity.city} / ${exactCity.state}`,
        city: exactCity.city,
        state: exactCity.state,
        serviceAreaStatus: "inside",
        description: "Cidade de atendimento configurada",
        sortWeight: 1,
      });
      continue;
    }

    const sameStateCities = citiesByState[leadState] ?? [];
    if (sameStateCities.length === 1) {
      const region = sameStateCities[0];
      increment({
        location: `Regiao de ${region.city} / ${region.state}`,
        city: region.city,
        state: region.state,
        serviceAreaStatus: "possible",
        description: `Lead de ${lead.detected_city} / ${leadState}, associado ao nucleo mais proximo pelo estado`,
        sortWeight: 2,
      });
      continue;
    }

    if (sameStateCities.length > 1) {
      increment({
        location: `Possivel regiao atendida / ${leadState}`,
        city: "Possivel regiao atendida",
        state: leadState,
        serviceAreaStatus: "possible",
        description: `Lead de ${lead.detected_city} / ${leadState}, mesmo estado de mais de uma cidade atendida`,
        sortWeight: 2,
      });
      continue;
    }

    increment({
      location: "Distante / fora da area",
      city: "Distante",
      state: leadState,
      serviceAreaStatus: "outside",
      description: `Leads de outros estados, fora das regioes configuradas`,
      sortWeight: 3,
    });
  }

  return [...counts.values()]
    .map((item) => ({
      location: item.location,
      city: item.city,
      state: item.state,
      count: item.count,
      percentage: percent(item.count, leads.length),
      serviceAreaStatus: item.serviceAreaStatus,
      description: item.description,
      sortWeight: item.sortWeight,
    }))
    .sort((a, b) => a.sortWeight - b.sortWeight || b.count - a.count)
    .slice(0, 8);
}

function buildFunnelData(leads: DashboardLead[], stages: StageOption[]): ConversionFunnelItem[] {
  if (stages.length > 0) {
    return stages.map((stage, index) => {
      const count = leads.filter((lead) => lead.stage_id === stage.id).length;
      const base =
        index === 0
          ? leads.length
          : leads.filter((lead) => lead.stage_id === stages[0]?.id).length || leads.length;
      return { stage: stage.name, count, rate: percent(count, base) };
    });
  }

  const labels: Record<LeadStatus, string> = {
    new: "Novo",
    contacted: "Contactado",
    qualified: "Qualificado",
    scheduled: "Agendado",
    attended: "Compareceu",
    closed_won: "Fechado",
    closed_lost: "Perdido",
    no_show: "Nao compareceu",
  };
  return (Object.keys(labels) as LeadStatus[]).map((status) => {
    const count = leads.filter((lead) => lead.status === status).length;
    return { stage: labels[status], count, rate: percent(count, leads.length) };
  });
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "--";
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes === 0) return "< 1 min";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}min`;
}

function computeResponseTimes(
  msgs: MsgRow[],
  bhConfig: OrgBusinessHours | null
): { avgFirstResponse: number | null; avgResponseTime: number | null } {
  const byConv = new Map<string, MsgRow[]>();
  for (const msg of msgs) {
    const list = byConv.get(msg.conversation_id) ?? [];
    list.push(msg);
    byConv.set(msg.conversation_id, list);
  }

  const firstDeltas: number[] = [];
  const allDeltas: number[] = [];

  const elapsed = (from: string, to: string) => {
    const s = new Date(from);
    const e = new Date(to);
    return bhConfig ? businessHoursMs(s, e, bhConfig) : e.getTime() - s.getTime();
  };

  for (const convMsgs of byConv.values()) {
    const firstInboundIdx = convMsgs.findIndex((m) => m.direction === "inbound");
    if (firstInboundIdx === -1) continue;

    const firstOutboundAfter = convMsgs
      .slice(firstInboundIdx + 1)
      .find((m) => m.direction === "outbound");
    if (firstOutboundAfter) {
      firstDeltas.push(
        elapsed(convMsgs[firstInboundIdx].created_at, firstOutboundAfter.created_at)
      );
    }

    for (let i = 0; i < convMsgs.length; i++) {
      if (convMsgs[i].direction !== "inbound") continue;
      const nextOut = convMsgs.slice(i + 1).find((m) => m.direction === "outbound");
      if (nextOut) {
        allDeltas.push(elapsed(convMsgs[i].created_at, nextOut.created_at));
      }
    }
  }

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  return { avgFirstResponse: avg(firstDeltas), avgResponseTime: avg(allDeltas) };
}

function computeNoFollowup(openConvIds: string[], recentMsgs: MsgRow[], cutoff: Date): number {
  const lastMsgByConv = new Map<string, MsgRow>();
  for (const msg of recentMsgs) {
    if (!lastMsgByConv.has(msg.conversation_id)) lastMsgByConv.set(msg.conversation_id, msg);
  }
  let count = 0;
  for (const id of openConvIds) {
    const last = lastMsgByConv.get(id);
    if (last && last.direction === "inbound" && new Date(last.created_at) < cutoff) count++;
  }
  return count;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ period?: string; start?: string; end?: string; responseMode?: string; service?: string }>;
}) {
  const params = await searchParams;
  const range = getDateRangeFromParams(params);
  const responseMode = getResponseMode(params?.responseMode);
  const selectedService = params?.service ?? "all";

  const context = await getOrganizationContext();
  const { admin, organizationId, organization } = context;
  const today = new Date();
  const currentStart = range.start;
  const currentEnd = range.end;
  const previousStart = range.previousStart;
  const fortyEightHoursAgo = new Date(today.getTime() - 48 * 60 * 60 * 1000);

  const toggleParams = new URLSearchParams();
  toggleParams.set("period", range.period);
  if (range.period === "custom") {
    if (params?.start) toggleParams.set("start", params.start);
    if (params?.end) toggleParams.set("end", params.end);
  }
  if (selectedService !== "all") toggleParams.set("service", selectedService);
  const businessHoursParams = new URLSearchParams(toggleParams);
  businessHoursParams.set("responseMode", "business_hours");
  const realTimeParams = new URLSearchParams(toggleParams);
  realTimeParams.set("responseMode", "real_time");
  const businessHoursUrl = `?${businessHoursParams.toString()}`;
  const realTimeUrl = `?${realTimeParams.toString()}`;

  // ── Batch 1: all independent queries in parallel ───────────────────────────
  // Leads are now queried per period — no more fetchAllRows loading everything
  const leadsSelect = `id, source_id, service_id, stage_id, status, potential_value, closed_value,
    created_at, last_interaction_at, detected_city, detected_state, phone_ddd, service_area_status,
    source:lead_sources(name),
    service:clinic_services(id, name, active),
    stage:pipeline_stages(id, name, order)`;

  const previousLeadsSelect = `id, service_id, stage_id, status, potential_value, closed_value, created_at`;

  const buildCurrentLeadsQuery = () => {
    let query = admin
      .from("leads")
      .select(leadsSelect)
      .eq("organization_id", organizationId)
      .gte("created_at", currentStart.toISOString())
      .lt("created_at", currentEnd.toISOString())
      .order("created_at", { ascending: false });

    if (selectedService !== "all") query = query.eq("service_id", selectedService);
    return query;
  };

  const buildPreviousLeadsQuery = () => {
    let query = admin
      .from("leads")
      .select(previousLeadsSelect)
      .eq("organization_id", organizationId)
      .gte("created_at", previousStart.toISOString())
      .lt("created_at", currentStart.toISOString())
      .order("created_at", { ascending: false });

    if (selectedService !== "all") query = query.eq("service_id", selectedService);
    return query;
  };

  const [
    currentLeadsResult,
    previousLeadsResult,
    tasksResult,
    openConvsResult,
    allConvsResult,
    pipelinesResult,
    settingsResult,
    servicesResult,
  ] = await Promise.all([
    fetchAllRows<DashboardLeadRow>(buildCurrentLeadsQuery),
    fetchAllRows<PreviousLeadRow>(buildPreviousLeadsQuery),
    admin
      .from("lead_tasks")
      .select("id, due_at, completed_at, lead:leads!inner(id, organization_id)")
      .eq("lead.organization_id", organizationId),
    admin
      .from("conversations")
      .select("id, remote_jid, unread_count")
      .eq("organization_id", organizationId)
      .eq("status", "open")
      .not("lead_id", "is", null),
    admin
      .from("conversations")
      .select("id, remote_jid")
      .eq("organization_id", organizationId)
      .not("lead_id", "is", null),
    admin
      .from("pipelines")
      .select("id, pipeline_stages(id, name, order)")
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .maybeSingle(),
    admin
      .from("organization_settings")
      .select("business_hours, service_area")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    admin
      .from("clinic_services")
      .select("id, name, active, order")
      .eq("organization_id", organizationId)
      .order("order", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  if (currentLeadsResult.error) {
    return (
      <div className="rounded-xl border border-border bg-white p-8 shadow-card">
        <p className="label-eyebrow text-danger-red">Erro</p>
        <h1 className="mt-1 text-xl font-black text-text-primary">Nao foi possivel carregar o dashboard</h1>
        <p className="mt-2 text-sm text-text-secondary">{currentLeadsResult.error.message}</p>
      </div>
    );
  }

  const openConvs = (openConvsResult.data ?? []).filter((c) => !c.remote_jid.includes("@g.us"));
  const openConvIds = openConvs.map((c) => c.id);
  const allLeadConvs = (allConvsResult.data ?? []).filter((c) => !c.remote_jid.includes("@g.us"));
  const allLeadConvIds = allLeadConvs.map((c) => c.id);
  const configuredBusinessHours = parseOrgBusinessHours(settingsResult.data?.business_hours);
  const serviceArea = parseServiceArea(settingsResult.data?.service_area);
  const bhConfig: OrgBusinessHours | null =
    responseMode === "business_hours" ? configuredBusinessHours : null;

  // ── Batch 2: depends on conv IDs from batch 1 ─────────────────────────────
  const emptyMsgs = { data: [] as MsgRow[], error: null };
  const [periodMsgsResult, recentMsgsResult] = await Promise.all([
    allLeadConvIds.length > 0
      ? admin
          .from("messages")
          .select("conversation_id, direction, created_at")
          .in("conversation_id", allLeadConvIds)
          .gte("created_at", currentStart.toISOString())
          .lt("created_at", currentEnd.toISOString())
          .order("created_at", { ascending: true })
      : Promise.resolve(emptyMsgs),
    openConvIds.length > 0
      ? admin
          .from("messages")
          .select("conversation_id, direction, created_at")
          .in("conversation_id", openConvIds)
          .order("created_at", { ascending: false })
      : Promise.resolve(emptyMsgs),
  ]);

  // ── Scheduling history (only for current period leads) ────────────────────
  const currentLeadRaw = (currentLeadsResult.data ?? []) as DashboardLeadRow[];
  const currentLeadIds = currentLeadRaw.map((l) => l.id as string);

  const scheduledEventsResult =
    currentLeadIds.length > 0
      ? await admin
          .from("lead_events")
          .select("lead_id")
          .eq("event_type", "reached_scheduled_stage")
          .in("lead_id", currentLeadIds)
      : { data: [] as { lead_id: string }[] };

  const hasBeenScheduledIds = new Set(
    (scheduledEventsResult.data ?? []).map((e) => e.lead_id as string)
  );

  // ── Normalize lead rows ───────────────────────────────────────────────────
  const services = servicesResult.data ?? [];

  const currentLeads = currentLeadRaw.map((lead) => ({
    ...lead,
    source: Array.isArray(lead.source) ? (lead.source[0] ?? null) : lead.source,
    service: Array.isArray(lead.service) ? (lead.service[0] ?? null) : lead.service,
    stage: Array.isArray(lead.stage) ? (lead.stage[0] ?? null) : lead.stage,
  })) as DashboardLead[];

  const previousLeads = ((previousLeadsResult.data ?? []) as PreviousLeadRow[]) as PreviousLead[];

  const stages = ((pipelinesResult.data?.pipeline_stages ?? []) as StageOption[]).sort(
    (a, b) => a.order - b.order
  );

  // ── Metrics ───────────────────────────────────────────────────────────────
  const scheduledCurrent = currentLeads.filter((lead) => wasScheduled(lead, hasBeenScheduledIds)).length;
  const scheduledPrevious = previousLeads.filter((lead) => wasScheduled(lead, hasBeenScheduledIds)).length;

  const attendedCurrent = currentLeads.filter((lead) =>
    ["attended", "closed_won", "closed_lost"].includes(lead.status)
  ).length;
  const attendedPrevious = previousLeads.filter((lead) =>
    ["attended", "closed_won", "closed_lost"].includes(lead.status)
  ).length;
  const potentialCurrent = currentLeads.reduce((sum, lead) => sum + Number(lead.potential_value ?? 0), 0);
  const potentialPrevious = previousLeads.reduce((sum, lead) => sum + Number(lead.potential_value ?? 0), 0);
  const closedCurrent = currentLeads.reduce((sum, lead) => sum + Number(lead.closed_value ?? 0), 0);
  const closedPrevious = previousLeads.reduce((sum, lead) => sum + Number(lead.closed_value ?? 0), 0);

  // ── Response time ─────────────────────────────────────────────────────────
  const { avgFirstResponse, avgResponseTime } =
    responseMode === "business_hours" && !bhConfig
      ? { avgFirstResponse: null, avgResponseTime: null }
      : computeResponseTimes((periodMsgsResult.data ?? []) as MsgRow[], bhConfig);

  // ── Follow-up 48h+ ────────────────────────────────────────────────────────
  const noFollowupCount = computeNoFollowup(
    openConvIds,
    (recentMsgsResult.data ?? []) as MsgRow[],
    fortyEightHoursAgo
  );

  // ── Alert banners ─────────────────────────────────────────────────────────
  const leadsWithoutResponse = openConvs.filter((c) => c.unread_count > 0).length;
  const leadsWithoutFollowup = (tasksResult.data ?? []).filter((task) => {
    if (task.completed_at || !task.due_at) return false;
    return new Date(task.due_at).getTime() < today.getTime();
  }).length;

  // ── Chart data ────────────────────────────────────────────────────────────
  const dailyData = buildDailyData(currentLeads, currentStart, currentEnd, hasBeenScheduledIds);
  const sourceData = buildSourceData(currentLeads);
  const locationData = buildServiceRegionData(currentLeads, serviceArea);
  const funnelData = buildFunnelData(currentLeads, stages);
  const serviceAreaCounts = currentLeads.reduce<Record<LeadsByLocation["serviceAreaStatus"], number>>(
    (acc, lead) => {
      const status = lead.service_area_status ?? "unknown";
      acc[status] += 1;
      return acc;
    },
    { inside: 0, possible: 0, outside: 0, unknown: 0 }
  );

  const monthLabel = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(today);
  const subscriptionLabel =
    organization?.subscription_status === "active"
      ? "Assessoria ativa"
      : "Periodo de implantacao";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-eyebrow text-text-muted">
            {organization?.name ?? "Sync Marketing"} · {monthLabel} · {range.label}
          </p>
          <h1 className="mt-1 text-2xl font-black text-text-primary">Dashboard</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {services.length > 0 && (
            <form action="/dashboard" className="flex items-center gap-2">
              <input type="hidden" name="period" value={range.period} />
              {range.period === "custom" && params?.start && <input type="hidden" name="start" value={params.start} />}
              {range.period === "custom" && params?.end && <input type="hidden" name="end" value={params.end} />}
              <input type="hidden" name="responseMode" value={responseMode} />
              <select
                name="service"
                defaultValue={selectedService}
                className="h-8 rounded-lg border border-border bg-white px-3 text-xs font-semibold text-text-secondary shadow-card outline-none transition focus:border-brand-green"
              >
                <option value="all">Todos os servicos</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="h-8 rounded-lg bg-brand-green px-3 text-xs font-bold text-white transition hover:bg-brand-green-dark"
              >
                Filtrar
              </button>
            </form>
          )}
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-white p-0.5 text-[11px] font-semibold shadow-card">
            <Link
              href={businessHoursUrl}
              className={cn(
                "rounded-md px-2.5 py-1 transition-colors",
                responseMode === "business_hours"
                  ? "bg-brand-green text-white"
                  : "text-text-muted hover:text-text-secondary"
              )}
            >
              Horario util
            </Link>
            <Link
              href={realTimeUrl}
              className={cn(
                "rounded-md px-2.5 py-1 transition-colors",
                responseMode === "real_time"
                  ? "bg-brand-green text-white"
                  : "text-text-muted hover:text-text-secondary"
              )}
            >
              Tempo real
            </Link>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-brand-green/30 bg-brand-green-soft px-3 py-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-brand-green" />
            <span className="text-xs font-semibold text-brand-green-deep">{subscriptionLabel}</span>
          </div>
        </div>
      </div>

      {responseMode === "business_hours" && !configuredBusinessHours && (
        <div className="rounded-xl border border-warning-amber/30 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Configure o horario de funcionamento da clinica em{" "}
          <Link href="/settings" className="font-semibold underline underline-offset-2">
            Configuracoes
          </Link>{" "}
          para usar as metricas por horario util. O modo Tempo real continua disponivel.
        </div>
      )}

      {/* Alert banners */}
      {(leadsWithoutResponse > 0 || leadsWithoutFollowup > 0) && (
        <div className="flex flex-wrap gap-3">
          {leadsWithoutResponse > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-danger-red/20 bg-danger-soft px-3 py-2 text-xs text-danger-red">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>{leadsWithoutResponse}</strong> conversas com mensagens nao lidas
              </span>
            </div>
          )}
          {leadsWithoutFollowup > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-warning-amber/30 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <Bell className="h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>{leadsWithoutFollowup}</strong> tarefas atrasadas
              </span>
            </div>
          )}
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Total de Leads"
          value={formatNumber(currentLeads.length)}
          variation={variation(currentLeads.length, previousLeads.length)}
          icon={Users}
        />
        <MetricCard
          label="Taxa de Agendamento"
          value={formatPercent(percent(scheduledCurrent, currentLeads.length))}
          variation={variation(
            percent(scheduledCurrent, currentLeads.length),
            percent(scheduledPrevious, previousLeads.length)
          )}
          icon={CalendarCheck}
        />
        <MetricCard
          label="Agendamentos"
          value={formatNumber(scheduledCurrent)}
          variation={variation(scheduledCurrent, scheduledPrevious)}
          icon={CalendarCheck}
        />
        <MetricCard
          label="Taxa de Comparecimento"
          value={formatPercent(percent(attendedCurrent, scheduledCurrent))}
          variation={variation(
            percent(attendedCurrent, scheduledCurrent),
            percent(attendedPrevious, scheduledPrevious)
          )}
          icon={UserCheck}
        />
        <MetricCard
          label="Valor Potencial"
          value={formatCurrency(potentialCurrent)}
          variation={variation(potentialCurrent, potentialPrevious)}
          icon={DollarSign}
        />
        <MetricCard
          label="Valor Fechado"
          value={formatCurrency(closedCurrent)}
          variation={variation(closedCurrent, closedPrevious)}
          icon={DollarSign}
        />
        <MetricCard
          label="Tempo Medio 1a Resposta"
          value={formatDuration(avgFirstResponse)}
          icon={Clock}
        />
        <MetricCard
          label="Tempo Medio de Resposta"
          value={formatDuration(avgResponseTime)}
          icon={Clock}
        />
        <MetricCard
          label="Sem follow-up 48h+"
          value={formatNumber(noFollowupCount)}
          icon={AlertCircle}
          iconColor={noFollowupCount > 0 ? "text-warning-amber" : "text-brand-green"}
          alert={noFollowupCount > 0}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Evolucao de Leads</CardTitle>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1 text-text-muted">
                  <span className="inline-block h-2 w-2 rounded-full bg-brand-green" />
                  Leads
                </span>
                <span className="flex items-center gap-1 text-text-muted">
                  <span className="inline-block h-2 w-2 rounded-full bg-brand-green-bright" />
                  Agendados
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <DailyLeadsChart data={dailyData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Leads por Origem</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <LeadsBySourceChart data={sourceData} />
            <div className="mt-1 w-full space-y-1.5">
              {sourceData.length === 0 && (
                <p className="py-4 text-center text-xs text-text-muted">
                  Nenhum lead no periodo selecionado.
                </p>
              )}
              {sourceData.map((item, index) => (
                <div key={item.source} className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                    />
                    <span className="text-text-secondary">{item.source}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-text-primary">{item.count}</span>
                    <span className="text-text-muted">{item.percentage.toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm">Leads por Regiao de Atendimento</CardTitle>
                <p className="mt-1 text-[11px] text-text-muted">
                  Agrupamento pelo DDD comparando com as cidades atendidas pela clinica.
                </p>
              </div>
              <MapPin className="h-4 w-4 text-brand-green" />
            </div>
          </CardHeader>
          <CardContent>
            <LeadsByLocationChart data={locationData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Area de Atuacao</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(["inside", "possible", "outside", "unknown"] as const).map((status) => {
              const count = serviceAreaCounts[status];
              const rate = percent(count, currentLeads.length);
              return (
                <div key={status} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-text-secondary">{LOCATION_STATUS_LABELS[status]}</span>
                    <span className="font-bold text-text-primary">
                      {count} <span className="font-medium text-text-muted">({rate.toFixed(0)}%)</span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-background-subtle">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        status === "outside"
                          ? "bg-warning-amber"
                          : status === "unknown"
                            ? "bg-text-muted"
                            : "bg-brand-green"
                      )}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Funil de Conversao</CardTitle>
            <Badge variant="secondary" className="text-[10px]">
              {range.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ConversionFunnelChart data={funnelData} />
        </CardContent>
      </Card>
    </div>
  );
}
