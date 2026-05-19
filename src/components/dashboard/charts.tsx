"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import type {
  DailyLeadsData,
  LeadsBySource,
  ConversionFunnelItem,
} from "@/lib/types";

const PIE_COLORS = ["#22c55e", "#16a34a", "#46e27f", "#0f4f2a", "#8a948d"];

export function DailyLeadsChart({ data }: { data: DailyLeadsData[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorScheduled" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#46e27f" stopOpacity={0.1} />
            <stop offset="95%" stopColor="#46e27f" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#dfe7e1" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "#8a948d" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#8a948d" }}
          axisLine={false}
          tickLine={false}
          width={28}
        />
        <Tooltip
          contentStyle={{
            background: "#fff",
            border: "1px solid #dfe7e1",
            borderRadius: "10px",
            fontSize: "12px",
            boxShadow: "0 4px 12px rgba(7,16,11,0.08)",
          }}
        />
        <Area
          type="monotone"
          dataKey="leads"
          stroke="#22c55e"
          strokeWidth={2}
          fill="url(#colorLeads)"
          name="Leads"
        />
        <Area
          type="monotone"
          dataKey="scheduled"
          stroke="#46e27f"
          strokeWidth={1.5}
          fill="url(#colorScheduled)"
          name="Agendados"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LeadsBySourceChart({ data }: { data: LeadsBySource[] }) {
  return (
    <ResponsiveContainer width="100%" height={170}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={48}
          outerRadius={72}
          dataKey="count"
          nameKey="source"
          strokeWidth={2}
          stroke="#fff"
        >
          {data.map((_, index) => (
            <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: "#fff",
            border: "1px solid #dfe7e1",
            borderRadius: "10px",
            fontSize: "12px",
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function ConversionFunnelChart({ data }: { data: ConversionFunnelItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#dfe7e1" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: "#8a948d" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="stage"
          tick={{ fontSize: 11, fill: "#526058" }}
          axisLine={false}
          tickLine={false}
          width={100}
        />
        <Tooltip
          contentStyle={{
            background: "#fff",
            border: "1px solid #dfe7e1",
            borderRadius: "10px",
            fontSize: "12px",
          }}
          formatter={(value: number) => [`${value} leads`, "Leads"]}
        />
        <Bar
          dataKey="count"
          name="Leads"
          radius={[0, 6, 6, 0]}
          label={{
            position: "right" as const,
            formatter: (_v: number, entry: { payload?: { rate?: number } }) =>
              `${entry?.payload?.rate?.toFixed(0) ?? 0}%`,
            fontSize: 10,
            fill: "#8a948d",
          }}
        >
          {data.map((_, index) => (
            <Cell
              key={index}
              fill={
                index === 0
                  ? "#dfe7e1"
                  : index < data.length - 1
                  ? `rgba(34, 197, 94, ${0.3 + index * 0.12})`
                  : "#22c55e"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
