import {
  Users,
  CalendarCheck,
  UserCheck,
  TrendingUp,
  Clock,
  AlertCircle,
  Bell,
  DollarSign,
} from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DailyLeadsChart,
  LeadsBySourceChart,
  ConversionFunnelChart,
} from "@/components/dashboard/charts";
import {
  mockMetrics,
  mockLeadsBySource,
  mockConversionFunnel,
  mockDailyLeads,
} from "@/lib/mock-data/dashboard";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

const PIE_COLORS = ["#22c55e", "#16a34a", "#46e27f", "#0f4f2a", "#8a948d"];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="label-eyebrow text-text-muted">Clínica Dr. Mendes · Maio 2024</p>
          <h1 className="mt-1 text-2xl font-black text-text-primary">Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-brand-green/30 bg-brand-green-soft px-3 py-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-brand-green animate-pulse" />
            <span className="text-xs font-semibold text-brand-green-deep">
              Assessoria ativa
            </span>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {(mockMetrics.leads_without_response > 0 || mockMetrics.leads_without_followup > 0) && (
        <div className="flex flex-wrap gap-3">
          {mockMetrics.leads_without_response > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-danger-red/20 bg-danger-soft px-3 py-2 text-xs text-danger-red">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>{mockMetrics.leads_without_response}</strong> leads sem resposta
              </span>
            </div>
          )}
          {mockMetrics.leads_without_followup > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-warning-amber/30 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <Bell className="h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>{mockMetrics.leads_without_followup}</strong> leads sem follow-up
              </span>
            </div>
          )}
        </div>
      )}

      {/* Primary KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Total de Leads" value={formatNumber(mockMetrics.total_leads)} icon={Users} />
        <MetricCard label="Novos Leads" value={formatNumber(mockMetrics.new_leads)} variation={mockMetrics.new_leads_variation} icon={TrendingUp} />
        <MetricCard label="Taxa de Agendamento" value={formatPercent(mockMetrics.scheduling_rate)} variation={mockMetrics.scheduling_rate_variation} icon={CalendarCheck} />
        <MetricCard label="Taxa de Fechamento" value={formatPercent(mockMetrics.closing_rate)} variation={mockMetrics.closing_rate_variation} icon={UserCheck} />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Taxa de Comparecimento" value={formatPercent(mockMetrics.attendance_rate)} variation={mockMetrics.attendance_rate_variation} icon={UserCheck} />
        <MetricCard label="Tempo Médio 1ª Resposta" value={`${mockMetrics.avg_first_response_minutes}`} suffix="min" icon={Clock} alert={mockMetrics.avg_first_response_minutes > 30} />
        <MetricCard label="Ticket Médio" value={formatCurrency(mockMetrics.avg_ticket)} icon={DollarSign} />
        <MetricCard label="Receita Estimada" value={formatCurrency(mockMetrics.estimated_revenue)} variation={mockMetrics.estimated_revenue_variation} icon={TrendingUp} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Daily leads chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Evolução de Leads</CardTitle>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1 text-text-muted">
                  <span className="h-2 w-2 rounded-full bg-brand-green inline-block" />
                  Leads
                </span>
                <span className="flex items-center gap-1 text-text-muted">
                  <span className="h-2 w-2 rounded-full bg-brand-green-bright inline-block" />
                  Agendados
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <DailyLeadsChart data={mockDailyLeads} />
          </CardContent>
        </Card>

        {/* Source pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Leads por Origem</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <LeadsBySourceChart data={mockLeadsBySource} />
            <div className="w-full space-y-1.5 mt-1">
              {mockLeadsBySource.map((item, index) => (
                <div key={item.source} className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
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

      {/* Funnel */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Funil de Conversão</CardTitle>
            <Badge variant="secondary" className="text-[10px]">Último mês</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ConversionFunnelChart data={mockConversionFunnel} />
        </CardContent>
      </Card>
    </div>
  );
}
