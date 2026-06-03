export type DatePeriod = "today" | "7d" | "30d" | "month" | "custom";

export type DateRangeParams = {
  period?: string | null;
  start?: string | null;
  end?: string | null;
};

export const PERIOD_OPTIONS: { label: string; value: DatePeriod }[] = [
  { label: "Hoje", value: "today" },
  { label: "7 dias", value: "7d" },
  { label: "30 dias", value: "30d" },
  { label: "Este mes", value: "month" },
  { label: "Personalizado", value: "custom" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseDateInput(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function normalizePeriod(value?: string | null): DatePeriod {
  if (value === "today" || value === "7d" || value === "30d" || value === "month" || value === "custom") {
    return value;
  }
  return "30d";
}

function formatRangeLabel(start: Date, endExclusive: Date) {
  const endInclusive = addDays(endExclusive, -1);
  const formatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  return `${formatter.format(start)} - ${formatter.format(endInclusive)}`;
}

export function formatDateParam(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDateRangeFromParams(params: DateRangeParams = {}, baseDate = new Date()) {
  const today = startOfDay(baseDate);
  const tomorrow = addDays(today, 1);
  const period = normalizePeriod(params.period);

  if (period === "custom") {
    const rawStart = parseDateInput(params.start);
    const rawEnd = parseDateInput(params.end);
    if (rawStart && rawEnd) {
      const start = startOfDay(rawStart <= rawEnd ? rawStart : rawEnd);
      const endInclusive = startOfDay(rawStart <= rawEnd ? rawEnd : rawStart);
      const end = addDays(endInclusive, 1);
      const rangeDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
      return {
        period,
        start,
        end,
        previousStart: addDays(start, -rangeDays),
        label: formatRangeLabel(start, end),
      };
    }
  }

  if (period === "today") {
    return {
      period,
      start: today,
      end: tomorrow,
      previousStart: addDays(today, -1),
      label: "hoje",
    };
  }

  if (period === "7d") {
    const start = addDays(today, -6);
    return {
      period,
      start,
      end: tomorrow,
      previousStart: addDays(start, -7),
      label: "ultimos 7 dias",
    };
  }

  if (period === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return {
      period,
      start,
      end: tomorrow,
      previousStart: new Date(today.getFullYear(), today.getMonth() - 1, 1),
      label: "este mes",
    };
  }

  const start = addDays(today, -29);
  return {
    period: "30d" as DatePeriod,
    start,
    end: tomorrow,
    previousStart: addDays(start, -30),
    label: "ultimos 30 dias",
  };
}

export function buildDateRangeSearchParams(params: DateRangeParams) {
  const period = normalizePeriod(params.period);
  const search = new URLSearchParams();
  search.set("period", period);
  if (period === "custom" && params.start && params.end) {
    search.set("start", params.start);
    search.set("end", params.end);
  }
  return search;
}
