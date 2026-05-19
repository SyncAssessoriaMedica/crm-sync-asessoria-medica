import type {
  DashboardMetrics,
  LeadsBySource,
  LeadsByStatus,
  ConversionFunnelItem,
  DailyLeadsData,
} from "@/lib/types";

export const mockMetrics: DashboardMetrics = {
  total_leads: 847,
  new_leads: 124,
  new_leads_variation: 12.4,
  scheduling_rate: 38.5,
  scheduling_rate_variation: 3.2,
  attendance_rate: 72.1,
  attendance_rate_variation: -1.8,
  closing_rate: 41.3,
  closing_rate_variation: 5.7,
  avg_first_response_minutes: 18,
  leads_without_response: 23,
  leads_without_followup: 47,
  avg_ticket: 2850,
  estimated_revenue: 142500,
  estimated_revenue_variation: 8.9,
};

export const mockLeadsBySource: LeadsBySource[] = [
  { source: "Meta Ads", count: 312, percentage: 36.8 },
  { source: "WhatsApp Orgânico", count: 198, percentage: 23.4 },
  { source: "Google Ads", count: 156, percentage: 18.4 },
  { source: "Indicação", count: 112, percentage: 13.2 },
  { source: "Instagram", count: 69, percentage: 8.2 },
];

export const mockLeadsByStatus: LeadsByStatus[] = [
  { status: "new", label: "Novos", count: 89, color: "#8a948d" },
  { status: "contacted", label: "Contactados", count: 134, color: "#22c55e" },
  { status: "qualified", label: "Qualificados", count: 98, color: "#16a34a" },
  { status: "scheduled", label: "Agendados", count: 76, color: "#46e27f" },
  { status: "attended", label: "Compareceram", count: 54, color: "#0f4f2a" },
  { status: "closed_won", label: "Fechados", count: 41, color: "#22c55e" },
  { status: "closed_lost", label: "Perdidos", count: 67, color: "#dc2626" },
  { status: "no_show", label: "Não Compareceram", count: 21, color: "#f59e0b" },
];

export const mockConversionFunnel: ConversionFunnelItem[] = [
  { stage: "Leads Totais", count: 847, rate: 100 },
  { stage: "Contactados", count: 623, rate: 73.6 },
  { stage: "Qualificados", count: 421, rate: 49.7 },
  { stage: "Agendados", count: 326, rate: 38.5 },
  { stage: "Compareceram", count: 235, rate: 27.7 },
  { stage: "Fechados", count: 97, rate: 11.5 },
];

export const mockDailyLeads: DailyLeadsData[] = [
  { date: "01/05", leads: 18, scheduled: 6 },
  { date: "02/05", leads: 22, scheduled: 9 },
  { date: "03/05", leads: 15, scheduled: 5 },
  { date: "05/05", leads: 28, scheduled: 11 },
  { date: "06/05", leads: 31, scheduled: 13 },
  { date: "07/05", leads: 24, scheduled: 8 },
  { date: "08/05", leads: 19, scheduled: 7 },
  { date: "09/05", leads: 26, scheduled: 10 },
  { date: "12/05", leads: 33, scheduled: 14 },
  { date: "13/05", leads: 29, scheduled: 11 },
  { date: "14/05", leads: 21, scheduled: 8 },
  { date: "15/05", leads: 35, scheduled: 15 },
  { date: "16/05", leads: 28, scheduled: 10 },
  { date: "19/05", leads: 41, scheduled: 18 },
];
