import Link from "next/link";
import {
  AlertCircle,
  Bell,
  CalendarCheck,
  Clock,
  UserCheck,
  Users,
} from "lucide-react";
import { ConversionFunnelChart, DailyLeadsChart, LeadsBySourceChart } from "@/components/dashboard/charts";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOrganizationContext } from "@/lib/organization-context";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
import type { ConversionFunnelItem, DailyLeadsData, LeadStatus, LeadsBySource } from "@/lib/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const PIE_COLORS = ["#22c55e", "#16a34a", "#46e27f", "#0f4f2a", "#8a948d"];
const PERIOD_LABELS = {
  today: "hoje",
  "7d": "ultimos 7 dias",
  "30d": "ultimos 30 dias",
  month: "este mes",
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type DashboardPeriod = keyof typeof PERIOD_LABELS;
type ResponseMode = "business_hours" | "real_time";

type DashboardLead = {
  id: string;
  source_id: string | null;
  stage_id: string | null;
  status: LeadStatus;
  created_at: string;
  last_interaction_at: string | null;
  source: { name: string | null } | null;
  stage: { id: string; name: string; order: number } | null;
};

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

// Structured so future code can replace this with per-org DB config.
type BusinessHoursConfig = {
  startHour: number;     // inclusive, e.g. 7  → counts from 07:00
  endHour: number;       // exclusive,  e.g. 22 → counts until 22:00
  workingDays: number[]; // 0=Sun … 6=Sat
  timezone: string;
};

const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  startHour: 7,
  endHour: 22,
  workingDays: [1, 2, 3, 4, 5, 6], // Mon–Sat
  timezone: "America/Sao_Paulo",
};

// ─── Period helpers ───────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function daysAgo(days: number, base = new Date()) {
  const date = new Date(base);
  date.setDate(date.getDate() - days);
  return date;
}

function inRange(date: string, start: Date, end: Date) {
  const value = new Date(date).getTime();
  return value >= start.getTime() && value < end.getTime();
}

function percent(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0;
}

function variation(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function isScheduledStatus(status: LeadStatus) {
  return ["scheduled", "attended", "closed_won", "closed_lost", "no_show"].includes(status);
}

function getPeriod(value?: string): DashboardPeriod {
  if (value === "today" || value === "7d" || value === "30d" || value === "month") return value;
  return "30d";
}

function getResponseMode(value?: string): ResponseMode {
  return value === "real_time" ? "real_time" : "business_hours";
}

function getPeriodRange(period: DashboardPeriod, baseDate: Date) {
  const tomorrow = new Date(baseDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const end = startOfDay(tomorrow);

  if (period === "today") {
    const start = startOfDay(baseDate);
    return { start, end, previousStart: daysAgo(1, start) };
  }

  if (period === "7d") {
    const start = daysAgo(6, startOfDay(baseDate));
    return { start, end, previousStart: daysAgo(7, start) };
  }

  if (period === "month") {
    const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    const previousStart = new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, 1);
    return { start, end, previousStart };
  }

  const start = daysAgo(29, startOfDay(baseDate));
  return { start, end, previousStart: daysAgo(30, start) };
}

// ─── Business hours calculation ───────────────────────────────────────────────

// Returns 0–6 (Sun–Sat) in the given timezone for a UTC timestamp.
function localWeekday(date: Date, tz: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

// Returns the local hour (0–23) in the given timezone for a UTC timestamp.
function localHour(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
  return h === 24 ? 0 : h;
}

// Returns the UTC timestamp for `hour:00:00` on the same local date as `refDate` in `tz`.
// Uses the "sv" locale trick to extract local date components without a library.
function utcForLocalHour(refDate: Date, hour: number, tz: string): Date {
  const localStr = refDate.toLocaleString("sv", { timeZone: tz }); // "YYYY-MM-DD HH:MM:SS"
  const datePart = localStr.slice(0, 10);
  const targetLocal = new Date(`${datePart}T${String(hour).padStart(2, "0")}:00:00`);
  const refLocal = new Date(localStr.replace(" ", "T"));
  // offset = how far ahead UTC is from local time (positive for western timezones)
  const tzOffsetMs = refDate.getTime() - refLocal.getTime();
  return new Date(targetLocal.getTime() + tzOffsetMs);
}

// Advances `afterDate` to the start of the next working period.
// Adds 24 h to safely cross into the next calendar day in the local timezone,
// then searches up to 7 days forward for the first working day.
function nextWorkingPeriodStart(afterDate: Date, config: BusinessHoursConfig): Date {
  let candidate = new Date(afterDate.getTime() + 24 * 3_600_000);
  for (let i = 0; i < 7; i++) {
    if (config.workingDays.includes(localWeekday(candidate, config.timezone))) {
      return utcForLocalHour(candidate, config.startHour, config.timezone);
    }
    candidate = new Date(candidate.getTime() + 24 * 3_600_000);
  }
  return new Date(afterDate.getTime() + 8 * 24 * 3_600_000); // safety fallback
}

// Returns how many milliseconds of business hours fall between `start` and `end`.
// Equivalent to real elapsed time when start/end are both within working hours.
function businessHoursMs(start: Date, end: Date, config: BusinessHoursConfig): number {
  if (start.getTime() >= end.getTime()) return 0;

  let current = new Date(start.getTime());
  let total = 0;

  // Safety cap: max 60 calendar-day iterations
  for (let iter = 0; iter < 60 && current < end; iter++) {
    const wd = localWeekday(current, config.timezone);
    const hr = localHour(current, config.timezone);

    if (!config.workingDays.includes(wd)) {
      current = nextWorkingPeriodStart(current, config);
      continue;
    }

    if (hr < config.startHour) {
      current = utcForLocalHour(current, config.startHour, config.timezone);
      continue;
    }

    if (hr >= config.endHour) {
      current = nextWorkingPeriodStart(current, config);
      continue;
    }

    // Inside working hours — accumulate until end of this period or target end
    const periodEnd = utcForLocalHour(current, config.endHour, config.timezone);
    const intervalEnd = end < periodEnd ? end : periodEnd;
    total += intervalEnd.getTime() - current.getTime();

    if (end.getTime() <= periodEnd.getTime()) break;

    current = nextWorkingPeriodStart(periodEnd, config);
  }

  return total;
}

// ─── Metric helpers ───────────────────────────────────────────────────────────

function buildDailyData(leads: DashboardLead[], start: Date, end: Date): DailyLeadsData[] {
  const days: DailyLeadsData[] = [];
  const cursor = startOfDay(start);
  while (cursor < end) {
    const key = cursor.toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(cursor);
    const dayLeads = leads.filter((lead) => lead.created_at.slice(0, 10) === key);
    days.push({
      date: label,
      leads: dayLeads.length,
      scheduled: dayLeads.filter((lead) => isScheduledStatus(lead.status)).length,
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

// Format milliseconds to human-readable duration (e.g. "3 min", "1h 12min")
function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "--";
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes === 0) return "< 1 min";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}min`;
}

// Compute avg first response and avg general response times.
// msgs must be ordered ASC by created_at within each conversation.
// Pass bhConfig=null to use raw elapsed time (real_time mode).
function computeResponseTimes(
  msgs: MsgRow[],
  bhConfig: BusinessHoursConfig | null
): { avgFirstResponse: number | null; avgResponseTime: number | null } {
  const byConv = new Map<string, MsgRow[]>();
  for (const msg of msgs) {
    const list = byConv.get(msg.conversation_id) ?? [];
    list.push(msg);
    byConv.set(msg.conversation_id, list);
  }

  const firstDeltas: number[] = [];
  const allDeltas: number[] = [];

  // Compute elapsed ms between two ISO timestamps, respecting the chosen mode
  const elapsed = (from: string, to: string) => {
    const s = new Date(from);
    const e = new Date(to);
    return bhConfig ? businessHoursMs(s, e, bhConfig) : e.getTime() - s.getTime();
  };

  for (const convMsgs of byConv.values()) {
    const firstInboundIdx = convMsgs.findIndex((m) => m.direction === "inbound");
    if (firstInboundIdx === -1) continue;

    // First response: first inbound → first outbound after it
    const firstOutboundAfter = convMsgs
      .slice(firstInboundIdx + 1)
      .find((m) => m.direction === "outbound");
    if (firstOutboundAfter) {
      firstDeltas.push(
        elapsed(convMsgs[firstInboundIdx].created_at, firstOutboundAfter.created_at)
      );
    }

    // General: for each inbound, time to the next outbound
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

// Count open conversations whose last message was inbound and older than cutoff.
// recentMsgs must be ordered DESC (first entry per conv = last message).
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
  searchParams?: Promise<{ period?: string; responseMode?: string }>;
}) {
  const params = await searchParams;
  const period = getPeriod(params?.period);
  const responseMode = getResponseMode(params?.responseMode);

  const context = await getOrganizationContext();
  const { admin, organizationId, organization } = context;
  const today = new Date();
  const { start: currentStart, end: currentEnd, previousStart } = getPeriodRange(period, today);
  const fortyEightHoursAgo = new Date(today.getTime() - 48 * 60 * 60 * 1000);

  // Business hours config: use DEFAULT or null for real-time mode.
  // Replace DEFAULT_BUSINESS_HOURS with a DB lookup per-org when ready.
  const bhConfig: BusinessHoursConfig | null =
    responseMode === "business_hours" ? DEFAULT_BUSINESS_HOURS : null;

  // Toggle URLs — preserve the current period when switching mode
  const toggleBase = `?period=${period}`;
  const businessHoursUrl = `${toggleBase}&responseMode=business_hours`;
  const realTimeUrl = `${toggleBase}&responseMode=real_time`;

  // Batch 1 — all independent queries in parallel
  const [leadsResult, tasksResult, openConvsResult, allConvsResult, pipelinesResult] =
    await Promise.all([
      admin
        .from("leads")
        .select(
          `id, source_id, stage_id, status, created_at, last_interaction_at,
           source:lead_sources(name),
           stage:pipeline_stages(id, name, order)`
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
      admin
        .from("lead_tasks")
        .select("id, due_at, completed_at, lead:leads!inner(id, organization_id)")
        .eq("lead.organization_id", organizationId),
      // Open conversations with leads (groups filtered in JS below)
      admin
        .from("conversations")
        .select("id, remote_jid, unread_count")
        .eq("organization_id", organizationId)
        .eq("status", "open")
        .not("lead_id", "is", null),
      // All lead-linked conversations in the org. Response metrics filter messages by period.
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
    ]);

  if (leadsResult.error) {
    return (
      <div className="rounded-xl border border-border bg-white p-8 shadow-card">
        <p className="label-eyebrow text-danger-red">Erro</p>
        <h1 className="mt-1 text-xl font-black text-text-primary">Nao foi possivel carregar o dashboard</h1>
        <p className="mt-2 text-sm text-text-secondary">{leadsResult.error.message}</p>
      </div>
    );
  }

  // Filter out WhatsApp group JIDs in JS (avoids PostgREST LIKE syntax complexity)
  const openConvs = (openConvsResult.data ?? []).filter((c) => !c.remote_jid.includes("@g.us"));
  const openConvIds = openConvs.map((c) => c.id);
  const allLeadConvs = (allConvsResult.data ?? []).filter((c) => !c.remote_jid.includes("@g.us"));
  const allLeadConvIds = allLeadConvs.map((c) => c.id);

  // Batch 2 — depends on conversation IDs from batch 1
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

  // ── Lead metrics ────────────────────────────────────────────────────────────
  const leads = (leadsResult.data ?? []).map((lead) => ({
    ...lead,
    source: Array.isArray(lead.source) ? (lead.source[0] ?? null) : lead.source,
    stage: Array.isArray(lead.stage) ? (lead.stage[0] ?? null) : lead.stage,
  })) as DashboardLead[];

  const stages = ((pipelinesResult.data?.pipeline_stages ?? []) as StageOption[]).sort(
    (a, b) => a.order - b.order
  );

  const currentLeads = leads.filter((lead) => inRange(lead.created_at, currentStart, currentEnd));
  const previousLeads = leads.filter((lead) =>
    inRange(lead.created_at, previousStart, currentStart)
  );

  const scheduledCurrent = currentLeads.filter((lead) => isScheduledStatus(lead.status)).length;
  const scheduledPrevious = previousLeads.filter((lead) => isScheduledStatus(lead.status)).length;

  const attendedCurrent = currentLeads.filter((lead) =>
    ["attended", "closed_won", "closed_lost"].includes(lead.status)
  ).length;
  const attendedPrevious = previousLeads.filter((lead) =>
    ["attended", "closed_won", "closed_lost"].includes(lead.status)
  ).length;

  // ── Response time metrics ───────────────────────────────────────────────────
  const { avgFirstResponse, avgResponseTime } = computeResponseTimes(
    (periodMsgsResult.data ?? []) as MsgRow[],
    bhConfig
  );

  // ── Follow-up 48h+ ──────────────────────────────────────────────────────────
  // Period-independent: reflects current operational state
  const noFollowupCount = computeNoFollowup(
    openConvIds,
    (recentMsgsResult.data ?? []) as MsgRow[],
    fortyEightHoursAgo
  );

  // ── Alert banners ───────────────────────────────────────────────────────────
  const leadsWithoutResponse = openConvs.filter((c) => c.unread_count > 0).length;
  const leadsWithoutFollowup = (tasksResult.data ?? []).filter((task) => {
    if (task.completed_at || !task.due_at) return false;
    return new Date(task.due_at).getTime() < today.getTime();
  }).length;

  // ── Chart data ──────────────────────────────────────────────────────────────
  const dailyData = buildDailyData(currentLeads, currentStart, currentEnd);
  const sourceData = buildSourceData(currentLeads);
  const funnelData = buildFunnelData(currentLeads, stages);

  const monthLabel = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(today);
  const subscriptionLabel =
    organization?.subscription_status === "active"
      ? "Assessoria ativa"
      : "Periodo de implantacao";

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-eyebrow text-text-muted">
            {organization?.name ?? "Sync Marketing"} · {monthLabel} · {PERIOD_LABELS[period]}
          </p>
          <h1 className="mt-1 text-2xl font-black text-text-primary">Dashboard</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Response mode toggle — affects only the two response-time cards */}
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

      {/* 6 metric cards — 3 columns on desktop */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
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
          label="Taxa de Comparecimento"
          value={formatPercent(percent(attendedCurrent, scheduledCurrent))}
          variation={variation(
            percent(attendedCurrent, scheduledCurrent),
            percent(attendedPrevious, scheduledPrevious)
          )}
          icon={UserCheck}
        />
        {/* Response-time cards — affected by the business hours toggle */}
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

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Funil de Conversao</CardTitle>
            <Badge variant="secondary" className="text-[10px]">
              {PERIOD_LABELS[period]}
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
