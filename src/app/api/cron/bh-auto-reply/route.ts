import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// ─── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (request.nextUrl.searchParams.get("secret") === secret) return true;
  return false;
}

// ─── Business hours helpers ───────────────────────────────────────────────────

type BusinessHour = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled: boolean;
};

function isWithinBusinessHours(now: Date, timezone: string, hours: BusinessHour[]): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.find((p) => p.type === "weekday")?.value ?? ""
  );
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minStr  = parts.find((p) => p.type === "minute")?.value ?? "00";
  const currentTime = `${hourStr.padStart(2, "0")}:${minStr.padStart(2, "0")}`;

  const rule = hours.find((h) => h.day_of_week === dow);
  if (!rule || !rule.enabled) return false;

  const normStart = rule.start_time.substring(0, 5);
  const normEnd   = rule.end_time.substring(0, 5);
  return currentTime >= normStart && currentTime < normEnd;
}

function nextBusinessHoursSlot(now: Date, timezone: string, hours: BusinessHour[]): Date {
  const slot = new Date(now);
  for (let i = 0; i < 7 * 24 * 60; i++) {
    slot.setMinutes(slot.getMinutes() + 1);
    if (isWithinBusinessHours(slot, timezone, hours)) return slot;
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

// ─── Portuguese date formatting ───────────────────────────────────────────────

const PT_DAY_NAMES = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

function getLocalDateParts(date: Date, timezone: string) {
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
    year:  get("year"),
    month: get("month"),
    day:   get("day"),
    dow:   Math.max(0, ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(get("weekday"))),
    hour:  parseInt(get("hour"), 10),
    minute: parseInt(get("minute"), 10),
  };
}

function formatNextSlotPt(nextSlot: Date, now: Date, timezone: string): string {
  const nowP  = getLocalDateParts(now, timezone);
  const slotP = getLocalDateParts(nextSlot, timezone);

  const isSameDay = nowP.year === slotP.year && nowP.month === slotP.month && nowP.day === slotP.day;

  const tomorrowMs = now.getTime() + 24 * 60 * 60 * 1000;
  const tomorrowP  = getLocalDateParts(new Date(tomorrowMs), timezone);
  const isTomorrow = tomorrowP.year === slotP.year && tomorrowP.month === slotP.month && tomorrowP.day === slotP.day;

  const hourStr = String(slotP.hour).padStart(2, "0");
  const minuteStr = String(slotP.minute).padStart(2, "0");
  const timeText = slotP.minute === 0 ? `${hourStr} horas` : `${hourStr}:${minuteStr}`;

  if (isSameDay)  return `hoje as ${timeText}`;
  if (isTomorrow) return `amanha as ${timeText}`;
  return `${PT_DAY_NAMES[slotP.dow]} as ${timeText}`;
}

// ─── Evolution API ────────────────────────────────────────────────────────────

async function sendWhatsAppText(
  instanceName: string,
  phone: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey  = process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !apiKey) return { ok: false, error: "Evolution API not configured" };

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "").replace(/\/manager$/, "");
  const url    = `${normalizedBaseUrl}/message/sendText/${encodeURIComponent(instanceName)}`;
  const number = phone.replace(/\D/g, "");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({ number, text, delay: 1200, linkPreview: false }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export const maxDuration = 55;

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now   = new Date();

  const stats = { processed: 0, sent: 0, failed: 0, cancelled: 0, skipped: 0 };

  try {
    // Load pending items due now (up to 20)
    const { data: pendingItems } = await admin
      .from("bh_auto_reply_queue")
      .select(`
        id, organization_id, conversation_id, lead_id, scheduled_for, created_at,
        conversation:conversations(
          remote_jid,
          lead:leads(name, phone),
          instance:whatsapp_instances(id, instance_name, status, deleted_at)
        )
      `)
      .eq("status", "pending")
      .lte("scheduled_for", now.toISOString())
      .order("scheduled_for")
      .limit(20);

    if (!pendingItems?.length) {
      return NextResponse.json({ ok: true, stats });
    }

    // Cache settings + business hours per org to avoid redundant queries
    const settingsCache = new Map<string, {
      settings: { enabled: boolean; message_template: string; timezone: string; cooldown_hours: number } | null;
      hours: BusinessHour[];
    }>();

    for (const item of pendingItems) {
      const orgId = item.organization_id as string;

      // Load and cache org config
      if (!settingsCache.has(orgId)) {
        const [settingsRes, hoursRes] = await Promise.all([
          admin
            .from("bh_auto_reply_settings")
            .select("enabled, message_template, timezone, cooldown_hours")
            .eq("organization_id", orgId)
            .maybeSingle(),
          admin
            .from("followup_business_hours")
            .select("day_of_week, start_time, end_time, enabled")
            .eq("organization_id", orgId),
        ]);
        settingsCache.set(orgId, {
          settings: settingsRes.data as { enabled: boolean; message_template: string; timezone: string; cooldown_hours: number } | null,
          hours: (hoursRes.data ?? []) as BusinessHour[],
        });
      }

      const cached = settingsCache.get(orgId)!;
      if (!cached.settings) {
        // Settings deleted between queue creation and now — skip
        await admin
          .from("bh_auto_reply_queue")
          .update({ status: "skipped", cancel_reason: "settings_missing", updated_at: now.toISOString() })
          .eq("id", item.id);
        stats.skipped++;
        continue;
      }

      if (!cached.settings.enabled) {
        await admin
          .from("bh_auto_reply_queue")
          .update({ status: "cancelled", cancel_reason: "feature_disabled", updated_at: now.toISOString() })
          .eq("id", item.id);
        stats.cancelled++;
        continue;
      }

      if (cached.hours.length === 0 || isWithinBusinessHours(now, cached.settings.timezone, cached.hours)) {
        await admin
          .from("bh_auto_reply_queue")
          .update({ status: "skipped", cancel_reason: "business_hours_started", updated_at: now.toISOString() })
          .eq("id", item.id);
        stats.skipped++;
        continue;
      }

      // Optimistic lock — only proceed if this process wins
      const { error: lockErr } = await admin
        .from("bh_auto_reply_queue")
        .update({ status: "sending", updated_at: now.toISOString() })
        .eq("id", item.id)
        .eq("status", "pending");

      if (lockErr) continue; // Another process grabbed it

      // Guard: cancel if an attendant sent a message after the queue item was created
      const { data: outboundAfterQueue } = await admin
        .from("messages")
        .select("id")
        .eq("conversation_id", item.conversation_id as string)
        .eq("direction", "outbound")
        .eq("is_automatic", false)
        .gt("created_at", item.created_at as string)
        .limit(1)
        .maybeSingle();

      if (outboundAfterQueue) {
        await admin
          .from("bh_auto_reply_queue")
          .update({ status: "cancelled", cancel_reason: "attendant_replied", updated_at: now.toISOString() })
          .eq("id", item.id);
        stats.cancelled++;
        continue;
      }

      const cooldownThreshold = new Date(now.getTime() - cached.settings.cooldown_hours * 60 * 60 * 1000);
      const { data: recentSent } = await admin
        .from("bh_auto_reply_queue")
        .select("id")
        .eq("conversation_id", item.conversation_id as string)
        .eq("status", "sent")
        .gte("sent_at", cooldownThreshold.toISOString())
        .limit(1)
        .maybeSingle();

      if (recentSent) {
        await admin
          .from("bh_auto_reply_queue")
          .update({ status: "skipped", cancel_reason: "cooldown_active", updated_at: now.toISOString() })
          .eq("id", item.id);
        stats.skipped++;
        continue;
      }

      // Validate conversation / instance
      const conv = item.conversation as unknown as {
        remote_jid: string;
        lead: { name: string; phone: string } | null;
        instance: { id: string; instance_name: string; status: string; deleted_at: string | null } | null;
      } | null;

      if (!conv?.instance || conv.instance.deleted_at || conv.instance.status !== "connected") {
        await admin
          .from("bh_auto_reply_queue")
          .update({ status: "skipped", cancel_reason: "instance_unavailable", updated_at: now.toISOString() })
          .eq("id", item.id);
        stats.skipped++;
        continue;
      }

      // Render template — compute next business hours slot at send time
      const nextSlot        = nextBusinessHoursSlot(now, cached.settings.timezone, cached.hours);
      const nextSlotFormatted = formatNextSlotPt(nextSlot, now, cached.settings.timezone);
      const message = cached.settings.message_template
        .replace(/\{\{proximo_horario_util\}\}/g, nextSlotFormatted);

      // Send
      const phone  = (conv.remote_jid as string).replace(/@.*$/, "");
      const result = await sendWhatsAppText(conv.instance.instance_name, phone, message);

      if (result.ok) {
        const { data: msgRecord } = await admin
          .from("messages")
          .insert({
            conversation_id: item.conversation_id,
            direction: "outbound",
            message_type: "text",
            content: message,
            is_automatic: true,
            automation_type: "bh_auto_reply",
          })
          .select("id")
          .single();

        await admin
          .from("bh_auto_reply_queue")
          .update({
            status: "sent",
            sent_at: now.toISOString(),
            message_sent: message,
            message_id: msgRecord?.id ?? null,
            updated_at: now.toISOString(),
          })
          .eq("id", item.id);

        await admin
          .from("conversations")
          .update({ updated_at: now.toISOString() })
          .eq("id", item.conversation_id as string);

        stats.sent++;
      } else {
        await admin
          .from("bh_auto_reply_queue")
          .update({
            status: "failed",
            error: (result.error ?? "unknown").slice(0, 400),
            updated_at: now.toISOString(),
          })
          .eq("id", item.id);

        stats.failed++;
      }

      stats.processed++;
    }

    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    console.error("bh-auto-reply cron error:", err);
    return NextResponse.json({ ok: false, error: String(err), stats }, { status: 500 });
  }
}
