import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { sanitizePayload } from "@/lib/sanitize";
import { createOrUpdateLeadByPhone } from "@/lib/lead-upsert";
import { fetchAndStoreWhatsAppMedia } from "@/lib/media-storage";

export const maxDuration = 30;

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Return the effective webhook secret.
 *
 * EVOLUTION_WEBHOOK_SECRET — dedicated secret for incoming webhooks.
 *
 * In production this must be configured. Local development may temporarily
 * fall back to EVOLUTION_API_KEY so older local setups keep working, but
 * production never exposes the server-to-server Evolution key as a webhook
 * URL token.
 */
function getWebhookSecret(): string | null {
  if (process.env.EVOLUTION_WEBHOOK_SECRET) return process.env.EVOLUTION_WEBHOOK_SECRET;
  if (process.env.NODE_ENV !== "production") return process.env.EVOLUTION_API_KEY ?? null;
  return null;
}

function verifyEvolutionSignature(request: NextRequest): boolean {
  const secret = getWebhookSecret();
  // Fail closed: no secret configured → reject every request.
  if (!secret) return false;

  // Primary: Evolution sends the API key in the "apikey" header.
  if (request.headers.get("apikey") === secret) return true;

  // Fallback: webhook URL contains ?token=<secret> (used when Evolution
  // doesn't support custom headers on delivery).
  const url = new URL(request.url);
  return url.searchParams.get("token") === secret;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const EvolutionWebhookSchema = z.object({
  event: z.string(),
  instance: z.string().optional(),
  instanceName: z.string().optional(),
  data: z
    .object({
      key: z
        .object({
          remoteJid: z.string().optional(),
          fromMe: z.boolean().optional(),
          id: z.string().optional(),
        })
        .optional(),
      message: z.record(z.unknown()).optional(),
      messageType: z.string().optional(),
      pushName: z.string().optional(),
      timestamp: z.union([z.number(), z.string()]).optional(),
      messageTimestamp: z.union([z.number(), z.string()]).optional(),
      status: z.string().optional(),
      state: z.string().optional(),
      qrcode: z.string().optional(),
      base64: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

type EvolutionPayload = z.infer<typeof EvolutionWebhookSchema>;
type NormalizedPayload = Omit<EvolutionPayload, "instance"> & { instance: string };
type SupabaseAdmin = ReturnType<typeof createAdminClient>;

const MESSAGE_EVENTS = new Set(["messages.upsert", "MESSAGES_UPSERT", "SEND_MESSAGE", "send.message"]);
const CONNECTION_EVENTS = new Set(["connection.update", "CONNECTION_UPDATE"]);
const QRCODE_EVENTS = new Set(["qrcode.updated", "QRCODE_UPDATED"]);
const ALLOWED_MESSAGE_TYPES = new Set(["text", "image", "audio", "video", "document", "sticker", "location"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isGroupMessage(remoteJid: string) {
  return remoteJid.includes("@g.us");
}

function normalizePhone(value: string) {
  return value.split("@")[0].replace(/\D/g, "");
}

function getTimestamp(value: EvolutionPayload["data"]) {
  const raw = (value as Record<string, unknown> | undefined)?.messageTimestamp ?? value?.timestamp;
  if (!raw) return new Date().toISOString();
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return new Date().toISOString();
  return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000).toISOString();
}

function textFromUnknown(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function nestedText(source: Record<string, unknown> | undefined, keys: string[]) {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

// ─── Log helper ───────────────────────────────────────────────────────────────

async function logWebhook(
  admin: SupabaseAdmin,
  organizationId: string | null,
  eventType: string,
  payload: unknown,
  processed: boolean,
  error?: string
) {
  // Sanitize before storing: remove secrets, truncate QR base64 blobs, etc.
  const safePayload = sanitizePayload(payload);
  await admin.from("webhook_events").insert({
    organization_id: organizationId,
    source: "evolution",
    event_type: eventType,
    payload: safePayload,
    processed,
    error: error ?? null,
  });
}

// ─── Message content extraction ───────────────────────────────────────────────

function getMessageContent(data: NonNullable<EvolutionPayload["data"]>) {
  const message = (data.message ?? {}) as Record<string, unknown>;
  const messageType = data.messageType ?? "text";

  if (typeof message.conversation === "string") {
    return { type: "text", content: message.conversation };
  }

  const extendedText = message.extendedTextMessage as Record<string, unknown> | undefined;
  if (extendedText) {
    return { type: "text", content: nestedText(extendedText, ["text", "caption"]) };
  }

  const image = message.imageMessage as Record<string, unknown> | undefined;
  if (image) {
    return {
      type: "image",
      content: nestedText(image, ["caption"]),
      mediaUrl: nestedText(image, ["url", "mediaUrl"]),
      mediaMimetype: nestedText(image, ["mimetype"]),
    };
  }

  const audio = message.audioMessage as Record<string, unknown> | undefined;
  if (audio) {
    return {
      type: "audio",
      mediaUrl: nestedText(audio, ["url", "mediaUrl"]),
      mediaMimetype: nestedText(audio, ["mimetype"]) ?? "audio/ogg; codecs=opus",
      mediaDuration: Number(audio.seconds ?? audio.duration) || null,
    };
  }

  const video = message.videoMessage as Record<string, unknown> | undefined;
  if (video) {
    return {
      type: "video",
      content: nestedText(video, ["caption"]),
      mediaUrl: nestedText(video, ["url", "mediaUrl"]),
      mediaMimetype: nestedText(video, ["mimetype"]),
      mediaDuration: Number(video.seconds ?? video.duration) || null,
    };
  }

  const document = message.documentMessage as Record<string, unknown> | undefined;
  if (document) {
    return {
      type: "document",
      content: nestedText(document, ["caption", "title"]),
      mediaUrl: nestedText(document, ["url", "mediaUrl"]),
      mediaMimetype: nestedText(document, ["mimetype"]),
      mediaFilename: nestedText(document, ["fileName", "filename", "title"]),
    };
  }

  const sticker = message.stickerMessage as Record<string, unknown> | undefined;
  if (sticker) {
    return {
      type: "sticker",
      mediaUrl: nestedText(sticker, ["url", "mediaUrl"]),
      mediaMimetype: nestedText(sticker, ["mimetype"]),
    };
  }

  const location = message.locationMessage as Record<string, unknown> | undefined;
  if (location) {
    const latitude = textFromUnknown(location.degreesLatitude ?? location.latitude);
    const longitude = textFromUnknown(location.degreesLongitude ?? location.longitude);
    return {
      type: "location",
      content: [nestedText(location, ["name", "address"]), latitude && longitude ? `${latitude}, ${longitude}` : null]
        .filter(Boolean)
        .join("\n"),
    };
  }

  const normalizedType = messageType.toLowerCase().replace("message", "");
  return {
    type: ALLOWED_MESSAGE_TYPES.has(normalizedType) ? normalizedType : "text",
    content: nestedText(message, ["text", "caption"]) ?? `[${messageType}]`,
  };
}

// ─── Business-hours auto-reply ───────────────────────────────────────────────

type BusinessHour = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled: boolean;
};

const BH_AUTO_REPLY_BUFFER_MINUTES = 90;

function isWithinBhHours(now: Date, timezone: string, hours: BusinessHour[]): boolean {
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
  return currentTime >= rule.start_time.substring(0, 5) && currentTime < rule.end_time.substring(0, 5);
}

function minutesUntilNextBhMinute(now: Date, timezone: string, hours: BusinessHour[]): number | null {
  const slot = new Date(now);
  for (let i = 1; i <= 8 * 24 * 60; i++) {
    slot.setMinutes(slot.getMinutes() + 1, 0, 0);
    if (isWithinBhHours(slot, timezone, hours)) return i;
  }
  return null;
}

function minutesSincePreviousBhMinute(now: Date, timezone: string, hours: BusinessHour[]): number | null {
  const slot = new Date(now);
  for (let i = 1; i <= 8 * 24 * 60; i++) {
    slot.setMinutes(slot.getMinutes() - 1, 0, 0);
    if (isWithinBhHours(slot, timezone, hours)) return i;
  }
  return null;
}

function isSafelyOutsideBhHours(now: Date, timezone: string, hours: BusinessHour[]): boolean {
  if (isWithinBhHours(now, timezone, hours)) return false;

  const sincePrevious = minutesSincePreviousBhMinute(now, timezone, hours);
  const untilNext = minutesUntilNextBhMinute(now, timezone, hours);

  if (sincePrevious === null || untilNext === null) return false;
  return sincePrevious >= BH_AUTO_REPLY_BUFFER_MINUTES && untilNext >= BH_AUTO_REPLY_BUFFER_MINUTES;
}

function nextBhSlot(now: Date, timezone: string, hours: BusinessHour[]): Date {
  const slot = new Date(now);
  for (let i = 1; i <= 8 * 24 * 60; i++) {
    slot.setMinutes(slot.getMinutes() + 1, 0, 0);
    if (isWithinBhHours(slot, timezone, hours)) return slot;
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

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
    year: get("year"),
    month: get("month"),
    day: get("day"),
    dow: Math.max(0, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"))),
    hour: parseInt(get("hour"), 10),
    minute: parseInt(get("minute"), 10),
  };
}

function formatNextBhSlotPt(nextSlot: Date, now: Date, timezone: string): string {
  const nowP = getLocalDateParts(now, timezone);
  const slotP = getLocalDateParts(nextSlot, timezone);
  const tomorrowP = getLocalDateParts(new Date(now.getTime() + 24 * 60 * 60 * 1000), timezone);

  const isSameDay = nowP.year === slotP.year && nowP.month === slotP.month && nowP.day === slotP.day;
  const isTomorrow = tomorrowP.year === slotP.year && tomorrowP.month === slotP.month && tomorrowP.day === slotP.day;
  const hourStr = String(slotP.hour).padStart(2, "0");
  const minuteStr = String(slotP.minute).padStart(2, "0");
  const timeText = slotP.minute === 0 ? `${hourStr} horas` : `${hourStr}:${minuteStr}`;

  if (isSameDay) return `hoje as ${timeText}`;
  if (isTomorrow) return `amanha as ${timeText}`;
  return `${PT_DAY_NAMES[slotP.dow]} as ${timeText}`;
}

async function sendBhWhatsAppText(
  instanceName: string,
  phone: string,
  text: string
): Promise<{ ok: boolean; error?: string; evolutionMsgId?: string }> {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !apiKey) return { ok: false, error: "Evolution API not configured" };

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "").replace(/\/manager$/, "");
  const url = `${normalizedBaseUrl}/message/sendText/${encodeURIComponent(instanceName)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({
        number: phone.replace(/\D/g, ""),
        text,
        delay: 1200,
        linkPreview: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }

    const json = await res.json().catch(() => null);
    const record = json as Record<string, unknown> | null;
    const key = record?.key as Record<string, unknown> | undefined;
    const evolutionMsgId =
      typeof key?.id === "string" ? key.id :
      typeof record?.id === "string" ? record.id :
      typeof record?.messageId === "string" ? record.messageId :
      undefined;

    return { ok: true, evolutionMsgId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function maybeSendBhAutoReply(
  admin: SupabaseAdmin,
  organizationId: string,
  conversationId: string,
  leadId: string | null,
  triggerMessageId: string,
  instanceName: string,
  remoteJid: string
): Promise<void> {
  const { data: settings } = await admin
    .from("bh_auto_reply_settings")
    .select("enabled, message_template, cooldown_hours, timezone")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!settings?.enabled) return;

  const { data: hours } = await admin
    .from("followup_business_hours")
    .select("day_of_week, start_time, end_time, enabled")
    .eq("organization_id", organizationId);

  const activeHours = (hours ?? []) as BusinessHour[];
  if (!activeHours.some((h) => h.enabled)) return;

  const now = new Date();
  if (!isSafelyOutsideBhHours(now, settings.timezone, activeHours)) return;

  const cooldownThreshold = new Date(now.getTime() - (settings.cooldown_hours as number) * 60 * 60 * 1000);
  const { data: recentSent } = await admin
    .from("bh_auto_reply_queue")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("status", "sent")
    .gte("sent_at", cooldownThreshold.toISOString())
    .limit(1)
    .maybeSingle();

  if (recentSent) return;

  const nextSlot = nextBhSlot(now, settings.timezone, activeHours);
  const message = (settings.message_template as string).replace(
    /\{\{proximo_horario_util\}\}/g,
    formatNextBhSlotPt(nextSlot, now, settings.timezone)
  );
  const result = await sendBhWhatsAppText(instanceName, normalizePhone(remoteJid), message);

  let messageId: string | null = null;
  if (result.ok) {
    const { data: msgRecord, error: msgError } = await admin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        evolution_msg_id: result.evolutionMsgId ?? `bh-auto:${triggerMessageId}`,
        direction: "outbound",
        message_type: "text",
        content: message,
        is_automatic: true,
        automation_type: "bh_auto_reply",
      })
      .select("id")
      .maybeSingle();

    if (msgError && msgError.code !== "23505") {
      console.error("[bh_auto_reply] local message insert error:", msgError.message, "convId:", conversationId);
    }
    messageId = msgRecord?.id ?? null;

    await admin.from("conversations").update({ updated_at: now.toISOString() }).eq("id", conversationId);
  }

  const { error } = await admin.from("bh_auto_reply_queue").insert({
    organization_id: organizationId,
    conversation_id: conversationId,
    lead_id: leadId,
    trigger_message_id: triggerMessageId,
    scheduled_for: now.toISOString(),
    status: result.ok ? "sent" : "failed",
    sent_at: result.ok ? now.toISOString() : null,
    message_sent: result.ok ? message : null,
    message_id: messageId,
    error: result.ok ? null : (result.error ?? "unknown").slice(0, 400),
  });

  if (error && error.code !== "23505") {
    console.error("[bh_auto_reply] audit insert error:", error.message, "convId:", conversationId);
  }
}

async function cancelPendingBhAutoReplies(
  admin: SupabaseAdmin,
  conversationId: string
): Promise<void> {
  await admin
    .from("bh_auto_reply_queue")
    .update({ status: "cancelled", cancel_reason: "outbound_message", updated_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("status", "pending");
}

// ─── Follow-up: cancel on inbound ────────────────────────────────────────────

// When a lead replies, any pending follow-up items for that conversation become
// irrelevant. Cancel them and log an audit event. Best-effort: errors are logged
// but must never block the webhook response.
async function cancelPendingFollowups(
  admin: SupabaseAdmin,
  conversationId: string,
  leadId: string | null,
  organizationId: string
): Promise<void> {
  try {
    const { data: pendingItems } = await admin
      .from("followup_queue")
      .select("id")
      .eq("conversation_id", conversationId)
      .in("status", ["pending", "sending"]);

    if (!pendingItems?.length) return;

    const itemIds = pendingItems.map((r) => r.id as string);
    const now = new Date().toISOString();

    await admin
      .from("followup_queue")
      .update({ status: "cancelled", updated_at: now })
      .in("id", itemIds);

    if (leadId) {
      await admin.from("followup_events").insert(
        itemIds.map((queueItemId) => ({
          organization_id: organizationId,
          queue_item_id: queueItemId,
          conversation_id: conversationId,
          lead_id: leadId,
          event_type: "cancelled_due_to_inbound",
          metadata: { reason: "lead_replied" },
        }))
      );
    }
  } catch (err) {
    console.error(
      "[followup] cancelPendingFollowups error:",
      err instanceof Error ? err.message : String(err),
      "convId:", conversationId
    );
  }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function resolveWhatsAppInstance(admin: SupabaseAdmin, instanceName: string) {
  const { data, error } = await admin
    .from("whatsapp_instances")
    .select("id, organization_id, instance_name, phone_number, status")
    .eq("instance_name", instanceName)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return data as { id: string; organization_id: string; instance_name: string; phone_number: string | null; status: string } | null;
}

// ─── Lead source rule matching ────────────────────────────────────────────────

type SourceRule = {
  id: string;
  source_id: string;
  match_type: string;
  pattern: string;
  case_sensitive: boolean;
  normalize_whitespace: boolean;
  overwrite_existing: boolean;
};

function normalizeForMatch(text: string, caseSensitive: boolean, normalizeWs: boolean): string {
  let result = text.trim();
  if (normalizeWs) result = result.replace(/\s+/g, " ");
  if (!caseSensitive) result = result.toLowerCase();
  return result;
}

function ruleMatches(rule: SourceRule, messageText: string): boolean {
  const normMsg = normalizeForMatch(messageText, rule.case_sensitive, rule.normalize_whitespace);
  const normPat = normalizeForMatch(rule.pattern, rule.case_sensitive, rule.normalize_whitespace);

  switch (rule.match_type) {
    case "exact":       return normMsg === normPat;
    case "contains":    return normMsg.includes(normPat);
    case "starts_with": return normMsg.startsWith(normPat);
    case "regex": {
      if (rule.pattern.length > 200) return false;
      try {
        const flags = rule.case_sensitive ? "" : "i";
        return new RegExp(rule.pattern, flags).test(messageText.trim());
      } catch {
        return false;
      }
    }
    default: return false;
  }
}

async function applyLeadSourceRule(
  admin: SupabaseAdmin,
  organizationId: string,
  leadId: string,
  conversationId: string,
  messageId: string,
  messageText: string | undefined
): Promise<void> {
  if (!messageText?.trim()) return;

  // Only apply on first inbound message of the conversation
  const { count } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .neq("id", messageId);

  if ((count ?? 0) > 0) return; // Not the first inbound message

  // Fetch active rules ordered by priority and only allow active origins.
  const { data: rules } = await admin
    .from("lead_source_rules")
    .select("id, source_id, match_type, pattern, case_sensitive, normalize_whitespace, overwrite_existing, source:lead_sources!inner(active)")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .eq("source.active", true)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  if (!rules?.length) return;

  const matched = (rules as SourceRule[]).find((rule) => ruleMatches(rule, messageText));
  if (!matched) return;

  // Check current lead source
  const { data: lead } = await admin
    .from("leads")
    .select("id, source_id")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return;

  const hasSource = Boolean(lead.source_id);
  if (hasSource && !matched.overwrite_existing) return;

  await admin.from("leads").update({ source_id: matched.source_id }).eq("id", leadId);

  await admin.from("lead_events").insert({
    lead_id: leadId,
    event_type: "source_auto_detected",
    description: "Origem identificada automaticamente pela primeira mensagem do WhatsApp.",
    metadata: {
      rule_id: matched.id,
      match_type: matched.match_type,
      source_id: matched.source_id,
      message_id: messageId,
      overwritten: hasSource,
    },
  });
}

async function resolveLead(admin: SupabaseAdmin, organizationId: string, phone: string, name: string | undefined, inbound: boolean) {
  return createOrUpdateLeadByPhone(
    admin,
    {
      organizationId,
      phone,
      name,
      status: "new",
      lastInteractionAt: new Date().toISOString(),
    },
    {
      createIfMissing: inbound,
      nameMode: "fill_if_blank_or_phone",
    }
  );
}

async function resolveConversation(
  admin: SupabaseAdmin,
  organizationId: string,
  instanceId: string,
  remoteJid: string,
  leadId: string | null
) {
  const { data: existing, error } = await admin
    .from("conversations")
    .select("id, unread_count")
    .eq("instance_id", instanceId)
    .eq("remote_jid", remoteJid)
    .maybeSingle();

  if (error) throw error;
  if (existing?.id) {
    if (leadId) await admin.from("conversations").update({ lead_id: leadId }).eq("id", existing.id);
    return existing as { id: string; unread_count: number };
  }

  const { data, error: insertError } = await admin
    .from("conversations")
    .insert({
      organization_id: organizationId,
      instance_id: instanceId,
      lead_id: leadId,
      remote_jid: remoteJid,
      unread_count: 0,
      status: "open",
    })
    .select("id, unread_count")
    .single();

  if (insertError) throw insertError;
  return data as { id: string; unread_count: number };
}

async function handleConnectionEvent(admin: SupabaseAdmin, payload: NormalizedPayload) {
  const instance = await resolveWhatsAppInstance(admin, payload.instance);
  const rawStatus = payload.data?.state ?? payload.data?.status ?? "";
  const normalized = rawStatus.toLowerCase();
  const status = normalized.includes("open") || normalized.includes("connect")
    ? "connected"
    : normalized.includes("connecting") || normalized.includes("qr")
      ? "connecting"
      : "disconnected";

  if (!instance) {
    await logWebhook(admin, null, payload.event, payload, false, `Instancia desconhecida: ${payload.instance}`);
    return NextResponse.json({ received: true, processed: false, reason: "Unknown instance" });
  }

  await admin.from("whatsapp_instances").update({ status }).eq("id", instance.id);
  await logWebhook(admin, instance.organization_id, payload.event, payload, true);
  return NextResponse.json({ success: true, processed: true, status });
}

async function handleQrCodeEvent(admin: SupabaseAdmin, payload: NormalizedPayload) {
  const instance = await resolveWhatsAppInstance(admin, payload.instance);
  // Strip QR base64 before logging (sanitizePayload in logWebhook handles this)
  await logWebhook(
    admin,
    instance?.organization_id ?? null,
    payload.event,
    payload,
    Boolean(instance),
    instance ? undefined : `Instancia desconhecida: ${payload.instance}`
  );
  if (instance) await admin.from("whatsapp_instances").update({ status: "connecting" }).eq("id", instance.id);
  return NextResponse.json({ success: true, processed: Boolean(instance), event: payload.event });
}

async function handleMessageEvent(admin: SupabaseAdmin, payload: NormalizedPayload) {
  const data = payload.data;
  const remoteJid = data?.key?.remoteJid;
  const evolutionMessageId = data?.key?.id;
  if (!data || !remoteJid || !evolutionMessageId) {
    await logWebhook(admin, null, payload.event, payload, false, "Payload de mensagem incompleto.");
    return NextResponse.json({ received: true, processed: false, reason: "Incomplete message payload" });
  }

  if (isGroupMessage(remoteJid)) {
    await logWebhook(admin, null, payload.event, { event: payload.event, instance: payload.instance }, false, "Mensagem de grupo ignorada.");
    return NextResponse.json({ received: true, processed: false, reason: "Group ignored" });
  }

  const instance = await resolveWhatsAppInstance(admin, payload.instance);
  if (!instance) {
    await logWebhook(admin, null, payload.event, payload, false, `Instancia desconhecida: ${payload.instance}`);
    return NextResponse.json({ received: true, processed: false, reason: "Unknown instance" }, { status: 202 });
  }

  const inbound = data.key?.fromMe !== true;
  const phone = normalizePhone(remoteJid);
  const lead = await resolveLead(admin, instance.organization_id, phone, data.pushName, inbound);
  const conversation = await resolveConversation(admin, instance.organization_id, instance.id, remoteJid, lead.id);
  const messageContent = getMessageContent(data);

  const messagePayload = {
    conversation_id: conversation.id,
    evolution_msg_id: evolutionMessageId,
    direction: inbound ? "inbound" : "outbound",
    message_type: messageContent.type,
    content: messageContent.content ?? null,
    media_url: messageContent.mediaUrl ?? null,
    media_mimetype: messageContent.mediaMimetype ?? null,
    media_filename: messageContent.mediaFilename ?? null,
    media_duration: messageContent.mediaDuration ?? null,
    created_at: getTimestamp(data),
  };

  const { data: insertedMessage, error: messageError } = await admin
    .from("messages")
    .upsert(messagePayload, { onConflict: "evolution_msg_id", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();

  if (messageError) throw messageError;

  if (insertedMessage?.id) {
    await admin
      .from("conversations")
      .update({
        unread_count: inbound ? conversation.unread_count + 1 : conversation.unread_count,
        status: "open",
      })
      .eq("id", conversation.id);

    if (lead.id) {
      await admin.from("lead_events").insert({
        lead_id: lead.id,
        event_type: inbound ? "whatsapp_inbound" : "whatsapp_outbound",
        description: inbound ? "Mensagem recebida pelo WhatsApp." : "Mensagem enviada pelo WhatsApp.",
        metadata: {
          instance: payload.instance,
          remote_jid: remoteJid,
          message_type: messageContent.type,
          evolution_msg_id: evolutionMessageId,
          // Never log media_url or actual message content here
        },
      });
    }

    // All WhatsApp media is AES-CBC encrypted. Fetch + decrypt via Evolution after
    // the response so Evolution doesn't retry the webhook while we wait.
    const STORABLE_TYPES = new Set(["audio", "image", "video", "document", "sticker"]);
    if (STORABLE_TYPES.has(messageContent.type)) {
      const msgId    = insertedMessage.id;
      const mediaType = messageContent.type;
      after(async () => {
        const stored = await fetchAndStoreWhatsAppMedia(
          admin,
          payload.instance,
          { key: data.key, message: data.message, messageType: data.messageType },
          instance.organization_id,
          evolutionMessageId,
          mediaType
        );
        if (stored) {
          await admin
            .from("messages")
            .update({ media_url: stored.url, media_mimetype: stored.mimetype })
            .eq("id", msgId);
        }
      });
    }

    // Inbound: cancel pending follow-ups + auto-detect lead source + send BH auto-reply when eligible.
    // Outbound: cancel any pending BH auto-reply (attendant responded).
    // Both run after response so Evolution gets a fast ACK.
    if (inbound) {
      const msgId = insertedMessage.id;
      const msgText = messageContent.type === "text" ? (messageContent.content ?? undefined) : undefined;
      after(async () => {
        await cancelPendingFollowups(
          admin,
          conversation.id,
          lead.id ?? null,
          instance.organization_id
        );
        if (lead.id && msgText) {
          try {
            await applyLeadSourceRule(
              admin,
              instance.organization_id,
              lead.id,
              conversation.id,
              msgId,
              msgText
            );
          } catch { /* best-effort: never block the webhook */ }
        }
        try {
          await maybeSendBhAutoReply(
            admin,
            instance.organization_id,
            conversation.id,
            lead.id ?? null,
            msgId,
            payload.instance,
            remoteJid
          );
        } catch { /* best-effort */ }
      });
    } else {
      // Outbound message: cancel any pending BH auto-reply for this conversation.
      after(async () => {
        try {
          await cancelPendingBhAutoReplies(admin, conversation.id);
        } catch { /* best-effort */ }
      });
    }
  }

  await logWebhook(
    admin,
    instance.organization_id,
    payload.event,
    { event: payload.event, instance: payload.instance, lead_id: lead.id, conversation_id: conversation.id },
    true
  );

  return NextResponse.json({
    success: true,
    processed: true,
    lead_id: lead.id,
    lead_created: lead.created,
    conversation_id: conversation.id,
    message_created: Boolean(insertedMessage?.id),
    message_type: messageContent.type,
  });
}

// ─── Rate limit config ────────────────────────────────────────────────────────

// 120 requests per minute per IP — well above normal Evolution delivery rates
// (~1–5 messages/s burst in busy deployments) but blocks flooding.
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Rate limit — before any other work to protect DB from flooding
  const rlKey = getRateLimitKey(request, "evolution");
  const rl = checkRateLimit(rlKey, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests", retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  // 2. Auth — fail closed: if EVOLUTION_WEBHOOK_SECRET (or EVOLUTION_API_KEY)
  //    is not configured, reject the request rather than accepting it blindly.
  if (!verifyEvolutionSignature(request)) {
    // Best-effort log — do not expose the secret in the log payload.
    try {
      const admin = createAdminClient();
      await logWebhook(
        admin,
        null,
        "AUTH_FAILURE",
        { apikeyPresent: request.headers.get("apikey") !== null },
        false,
        process.env.EVOLUTION_WEBHOOK_SECRET || process.env.EVOLUTION_API_KEY
          ? "Unauthorized: apikey header or token mismatch"
          : "Service misconfigured: EVOLUTION_WEBHOOK_SECRET not set"
      );
    } catch { /* best-effort */ }

    if (!getWebhookSecret()) {
      return NextResponse.json(
        { error: "Service Unavailable", code: "WEBHOOK_NOT_CONFIGURED" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. Parse body
  let body: unknown;
  let rawBodySnippet: string | undefined;
  try {
    const text = await request.text();
    rawBodySnippet = text.slice(0, 500); // keep snippet for debug, not full payload
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // body stays undefined; handled below
  }

  const admin = createAdminClient();

  if (body === undefined) {
    await logWebhook(admin, null, "PARSE_FAILURE", { rawBodySnippet }, false, "Invalid or empty JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = EvolutionWebhookSchema.safeParse(body);
  if (!parsed.success) {
    await logWebhook(admin, null, "SCHEMA_FAILURE", { eventHint: (body as Record<string, unknown>)?.event }, false, `Schema validation failed: ${parsed.error.message}`);
    return NextResponse.json({ received: true, processed: false, reason: "Unsupported payload" });
  }

  const rawPayload = parsed.data;
  const instanceName = rawPayload.instance ?? rawPayload.instanceName ?? "";
  if (!instanceName) {
    await logWebhook(admin, null, rawPayload.event ?? "UNKNOWN", {}, false, "Missing instance identifier");
    return NextResponse.json({ received: true, processed: false, reason: "Missing instance identifier" });
  }
  const payload = { ...rawPayload, instance: instanceName };

  try {
    if (MESSAGE_EVENTS.has(payload.event)) return handleMessageEvent(admin, payload);
    if (CONNECTION_EVENTS.has(payload.event)) return handleConnectionEvent(admin, payload);
    if (QRCODE_EVENTS.has(payload.event)) return handleQrCodeEvent(admin, payload);

    if (payload.event === "MESSAGES_UPDATE" || payload.event === "messages.update") {
      await logWebhook(admin, null, payload.event, { event: payload.event, instance: payload.instance }, true);
      return NextResponse.json({ received: true, processed: true, reason: "Status update logged" });
    }

    await logWebhook(admin, null, payload.event, { event: payload.event, instance: payload.instance }, false, "Evento ignorado pelo CRM.");
    return NextResponse.json({ received: true, processed: false, reason: "Event not handled" });
  } catch (error) {
    await logWebhook(admin, null, payload.event, { event: payload.event, instance: payload.instance }, false, error instanceof Error ? error.message : "Internal server error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "POST /api/webhooks/evolution",
    handled_events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED", "SEND_MESSAGE"],
    auth: "Header: apikey (EVOLUTION_WEBHOOK_SECRET)",
  });
}
