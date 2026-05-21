import {
  AlertCircle,
  Bell,
  CalendarCheck,
  Clock,
  DollarSign,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import { ConversionFunnelChart, DailyLeadsChart, LeadsBySourceChart } from "@/components/dashboard/charts";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOrganizationContext } from "@/lib/organization-context";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import type { ConversionFunnelItem, DailyLeadsData, LeadStatus, LeadsBySource } from "@/lib/types";

const PIE_COLORS = ["#22c55e", "#16a34a", "#46e27f", "#0f4f2a", "#8a948d"];
const PERIOD_LABELS = {
  today: "hoje",
  "7d": "ultimos 7 dias",
  "30d": "ultimos 30 dias",
  month: "este mes",
} as const;

type DashboardPeriod = keyof typeof PERIOD_LABELS;

type DashboardLead = {
  id: string;
  source_id: string | null;
  stage_id: string | null;
  status: LeadStatus;
  potential_value: number | null;
  closed_value: number | null;
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

function numberValue(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isScheduledStatus(status: LeadStatus) {
  return ["scheduled", "attended", "closed_won", "closed_lost", "no_show"].includes(status);
}

function isAttendanceBase(status: LeadStatus) {
  return ["attended", "closed_won", "closed_lost", "no_show"].includes(status);
}

function getPeriod(value?: string): DashboardPeriod {
  if (value === "today" || value === "7d" || value === "30d" || value === "month") return value;
  return "30d";
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
      const base = index === 0 ? leads.length : leads.filter((lead) => lead.stage_id === stages[0]?.id).length || leads.length;
      return {
        stage: stage.name,
        count,
        rate: percent(count, base),
      };
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const period = getPeriod(params?.period);
  const context = await getOrganizationContext();
  const { admin, organizationId, organization } = context;
  const today = new Date();
  const { start: currentStart, end: currentEnd, previousStart } = getPeriodRange(period, today);

  const [leadsResult, tasksResult, conversationsResult, pipelinesResult] = await Promise.all([
    admin
      .from("leads")
      .select(
        `
        id,
        source_id,
        stage_id,
        status,
        potential_value,
        closed_value,
        created_at,
        last_interaction_at,
        source:lead_sources(name),
        stage:pipeline_stages(id, name, order)
      `
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
    admin
      .from("lead_tasks")
      .select("id, due_at, completed_at, lead:leads!inner(id, organization_id)")
      .eq("lead.organization_id", organizationId),
    admin
      .from("conversations")
      .select("id, unread_count, status")
      .eq("organization_id", organizationId)
      .eq("status", "open"),
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

  const leads = (leadsResult.data ?? []).map((lead) => ({
    ...lead,
    source: Array.isArray(lead.source) ? lead.source[0] ?? null : lead.source,
    stage: Array.isArray(lead.stage) ? lead.stage[0] ?? null : lead.stage,
  })) as DashboardLead[];
  const stages = ((pipelinesResult.data?.pipeline_stages ?? []) as StageOption[]).sort((a, b) => a.order - b.order);
  const currentLeads = leads.filter((lead) => inRange(lead.created_at, currentStart, currentEnd));
  const previousLeads = leads.filter((lead) => inRange(lead.created_at, previousStart, currentStart));
  const scheduledCurrent = currentLeads.filter((lead) => isScheduledStatus(lead.status)).length;
  const scheduledPrevious = previousLeads.filter((lead) => isScheduledStatus(lead.status)).length;
  const attendedCurrent = currentLeads.filter((lead) => ["attended", "closed_won", "closed_lost"].includes(lead.status)).length;
  const attendedPrevious = previousLeads.filter((lead) => ["attended", "closed_won", "closed_lost"].includes(lead.status)).length;
  const attendanceBaseCurrent = currentLeads.filter((lead) => isAttendanceBase(lead.status)).length;
  const attendanceBasePrevious = previousLeads.filter((lead) => isAttendanceBase(lead.status)).length;
  const closedCurrent = currentLeads.filter((lead) => lead.status === "closed_won").length;
  const closedPrevious = previousLeads.filter((lead) => lead.status === "closed_won").length;
  const revenueCurrent = currentLeads.reduce((sum, lead) => sum + numberValue(lead.closed_value), 0);
  const wonWithValue = leads.filter((lead) => lead.status === "closed_won" && numberValue(lead.closed_value) > 0);
  const avgTicket =
    wonWithValue.length > 0
      ? wonWithValue.reduce((sum, lead) => sum + numberValue(lead.closed_value), 0) / wonWithValue.length
      : 0;
  const projectedRevenue = currentLeads.reduce((sum, lead) => {
    if (lead.status === "closed_won") return sum + numberValue(lead.closed_value);
    return sum + numberValue(lead.potential_value);
  }, 0);
  const projectedRevenuePrevious = previousLeads.reduce((sum, lead) => {
    if (lead.status === "closed_won") return sum + numberValue(lead.closed_value);
    return sum + numberValue(lead.potential_value);
  }, 0);
  const leadsWithoutResponse = (conversationsResult.data ?? []).filter((conversation) => conversation.unread_count > 0).length;
  const leadsWithoutFollowup = (tasksResult.data ?? []).filter((task) => {
    if (task.completed_at || !task.due_at) return false;
    return new Date(task.due_at).getTime() < today.getTime();
  }).length;
  const dailyData = buildDailyData(currentLeads, currentStart, currentEnd);
  const sourceData = buildSourceData(currentLeads);
  const funnelData = buildFunnelData(currentLeads, stages);
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(today);
  const subscriptionLabel = organization?.subscription_status === "active" ? "Assessoria ativa" : "Periodo de implantacao";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-eyebrow text-text-muted">
            {organization?.name ?? "Sync Marketing"} · {monthLabel} · {PERIOD_LABELS[period]}
          </p>
          <h1 className="mt-1 text-2xl font-black text-text-primary">Dashboard</h1>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-brand-green/30 bg-brand-green-soft px-3 py-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-brand-green" />
          <span className="text-xs font-semibold text-brand-green-deep">{subscriptionLabel}</span>
        </div>
      </div>

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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Total de Leads" value={formatNumber(leads.length)} icon={Users} />
        <MetricCard label="Novos Leads" value={formatNumber(currentLeads.length)} variation={variation(currentLeads.length, previousLeads.length)} icon={TrendingUp} />
        <MetricCard label="Taxa de Agendamento" value={formatPercent(percent(scheduledCurrent, currentLeads.length))} variation={variation(percent(scheduledCurrent, currentLeads.length), percent(scheduledPrevious, previousLeads.length))} icon={CalendarCheck} />
        <MetricCard label="Taxa de Fechamento" value={formatPercent(percent(closedCurrent, attendedCurrent))} variation={variation(percent(closedCurrent, attendedCurrent), percent(closedPrevious, attendedPrevious))} icon={UserCheck} />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Taxa de Comparecimento" value={formatPercent(percent(attendedCurrent, attendanceBaseCurrent))} variation={variation(percent(attendedCurrent, attendanceBaseCurrent), percent(attendedPrevious, attendanceBasePrevious))} icon={UserCheck} />
        <MetricCard label="Tempo Medio 1a Resposta" value="--" icon={Clock} />
        <MetricCard label="Ticket Medio" value={formatCurrency(avgTicket)} icon={DollarSign} />
        <MetricCard label="Receita Projetada" value={formatCurrency(projectedRevenue || revenueCurrent)} variation={variation(projectedRevenue, projectedRevenuePrevious)} icon={TrendingUp} />
      </div>

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
                <p className="py-4 text-center text-xs text-text-muted">Nenhum lead no periodo selecionado.</p>
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
