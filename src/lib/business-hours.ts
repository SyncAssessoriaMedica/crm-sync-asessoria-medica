// Central helper for business-hours logic.
// Source of truth: organization_settings.business_hours (single time range per day group).
// Used by: webhook bh-auto-reply, followup cron, follow-up UI.

export type OrgBusinessHours = {
  startTime: string;      // "HH:MM"
  endTime: string;        // "HH:MM"
  workingDays: number[];  // 0=Sun, 1=Mon, …, 6=Sat
  timezone: string;       // IANA tz string e.g. "America/Sao_Paulo"
};

const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const PT_DAY_NAMES = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function parseOrgBusinessHours(value: unknown): OrgBusinessHours | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const startTime = typeof data.startTime === "string" ? data.startTime : "";
  const endTime = typeof data.endTime === "string" ? data.endTime : "";
  const timezone = typeof data.timezone === "string" ? data.timezone : "America/Sao_Paulo";
  const workingDays = Array.isArray(data.workingDays)
    ? data.workingDays.filter((day): day is number => typeof day === "number" && day >= 0 && day <= 6)
    : [];

  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) return null;
  if (workingDays.length === 0) return null;
  if (timeToMinutes(startTime) >= timeToMinutes(endTime)) return null;

  return { startTime, endTime, workingDays, timezone };
}

function localParts(date: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year:   get("year"),
    month:  get("month"),
    day:    get("day"),
    dow:    Math.max(0, DAYS_EN.indexOf(get("weekday") as typeof DAYS_EN[number])),
    hour:   parseInt(get("hour"), 10),
    minute: parseInt(get("minute"), 10),
  };
}

/** True if `now` falls inside the business-hours window. */
export function isWithinBusinessHours(now: Date, bh: OrgBusinessHours): boolean {
  const { timezone, workingDays, startTime, endTime } = bh;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const dow = DAYS_EN.indexOf(parts.find((p) => p.type === "weekday")?.value as typeof DAYS_EN[number] ?? "");
  if (dow < 0 || !workingDays.includes(dow)) return false;
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  const current = `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
  const norm = (t: string) => t.substring(0, 5);
  return current >= norm(startTime) && current < norm(endTime);
}

/** Find the next minute that is within business hours (searches up to 7 days ahead). */
export function nextBusinessHoursSlot(now: Date, bh: OrgBusinessHours): Date {
  const slot = new Date(now);
  for (let i = 0; i < 7 * 24 * 60; i++) {
    slot.setMinutes(slot.getMinutes() + 1);
    if (isWithinBusinessHours(slot, bh)) return new Date(slot);
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

/** Format `nextSlot` as a human-readable Portuguese string ("hoje as 08 horas", "amanha as 09:30", etc.). */
export function formatNextSlotPt(nextSlot: Date, now: Date, timezone: string): string {
  const nowP  = localParts(now, timezone);
  const slotP = localParts(nextSlot, timezone);
  const tomP  = localParts(new Date(now.getTime() + 24 * 60 * 60 * 1000), timezone);

  const isSameDay  = nowP.year  === slotP.year  && nowP.month  === slotP.month  && nowP.day  === slotP.day;
  const isTomorrow = tomP.year  === slotP.year  && tomP.month  === slotP.month  && tomP.day  === slotP.day;

  const hourStr   = String(slotP.hour).padStart(2, "0");
  const minuteStr = String(slotP.minute).padStart(2, "0");
  const timeText  = slotP.minute === 0 ? `${hourStr} horas` : `${hourStr}:${minuteStr}`;

  if (isSameDay)  return `hoje as ${timeText}`;
  if (isTomorrow) return `amanha as ${timeText}`;
  return `${PT_DAY_NAMES[slotP.dow]} as ${timeText}`;
}

// ─── BH auto-reply buffer helpers ────────────────────────────────────────────

/** Minutes elapsed since the business-hours window last closed (scan backwards, max 8 days). */
export function minutesSinceLastBh(now: Date, bh: OrgBusinessHours): number | null {
  const slot = new Date(now);
  for (let i = 1; i <= 8 * 24 * 60; i++) {
    slot.setMinutes(slot.getMinutes() - 1, 0, 0);
    if (isWithinBusinessHours(slot, bh)) return i;
  }
  return null;
}

/** Minutes until business hours start again (scan forwards, max 8 days). */
export function minutesUntilNextBh(now: Date, bh: OrgBusinessHours): number | null {
  const slot = new Date(now);
  for (let i = 1; i <= 8 * 24 * 60; i++) {
    slot.setMinutes(slot.getMinutes() + 1, 0, 0);
    if (isWithinBusinessHours(slot, bh)) return i;
  }
  return null;
}

/**
 * True only when we are comfortably outside business hours.
 * Requires both `bufferMinutes` elapsed since closing AND `bufferMinutes` until next opening.
 * Prevents sending auto-replies near the start/end of the workday.
 */
export function isSafelyOutsideBhHours(now: Date, bh: OrgBusinessHours, bufferMinutes = 90): boolean {
  if (isWithinBusinessHours(now, bh)) return false;
  const since = minutesSinceLastBh(now, bh);
  const until = minutesUntilNextBh(now, bh);
  if (since === null || until === null) return false;
  return since >= bufferMinutes && until >= bufferMinutes;
}

// Dashboard response-time helper.
function localWeekday(date: Date, timezone: string): number {
  return localParts(date, timezone).dow;
}

function localMinuteOfDay(date: Date, timezone: string): number {
  const parts = localParts(date, timezone);
  return (parts.hour === 24 ? 0 : parts.hour) * 60 + parts.minute;
}

function utcForLocalMinuteOfDay(refDate: Date, minuteOfDay: number, timezone: string): Date {
  const localStr = refDate.toLocaleString("sv", { timeZone: timezone });
  const datePart = localStr.slice(0, 10);
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  const targetLocal = new Date(
    `${datePart}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`
  );
  const refLocal = new Date(localStr.replace(" ", "T"));
  const tzOffsetMs = refDate.getTime() - refLocal.getTime();
  return new Date(targetLocal.getTime() + tzOffsetMs);
}

function nextWorkingPeriodStart(afterDate: Date, bh: OrgBusinessHours): Date {
  const startMinute = timeToMinutes(bh.startTime);
  let candidate = new Date(afterDate.getTime() + 24 * 3_600_000);
  for (let i = 0; i < 7; i++) {
    if (bh.workingDays.includes(localWeekday(candidate, bh.timezone))) {
      return utcForLocalMinuteOfDay(candidate, startMinute, bh.timezone);
    }
    candidate = new Date(candidate.getTime() + 24 * 3_600_000);
  }
  return new Date(afterDate.getTime() + 8 * 24 * 3_600_000);
}

export function businessHoursMs(start: Date, end: Date, bh: OrgBusinessHours): number {
  if (start.getTime() >= end.getTime()) return 0;

  let current = new Date(start.getTime());
  let total = 0;
  const startMinute = timeToMinutes(bh.startTime);
  const endMinute = timeToMinutes(bh.endTime);

  for (let iter = 0; iter < 60 && current < end; iter++) {
    const wd = localWeekday(current, bh.timezone);
    const minute = localMinuteOfDay(current, bh.timezone);

    if (!bh.workingDays.includes(wd)) {
      current = nextWorkingPeriodStart(current, bh);
      continue;
    }

    if (minute < startMinute) {
      current = utcForLocalMinuteOfDay(current, startMinute, bh.timezone);
      continue;
    }

    if (minute >= endMinute) {
      current = nextWorkingPeriodStart(current, bh);
      continue;
    }

    const periodEnd = utcForLocalMinuteOfDay(current, endMinute, bh.timezone);
    const intervalEnd = end < periodEnd ? end : periodEnd;
    total += intervalEnd.getTime() - current.getTime();

    if (end.getTime() <= periodEnd.getTime()) break;
    current = nextWorkingPeriodStart(periodEnd, bh);
  }

  return total;
}
