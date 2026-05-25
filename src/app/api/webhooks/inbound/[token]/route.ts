import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { sanitizePayload } from "@/lib/sanitize";

type WebhookConfigPayload = {
  token?: string;
  name?: string;
  active?: boolean;
  mappings?: {
    name?: string;
    phone?: string;
    email?: string;
    source?: string;
    procedure?: string;
    potential_value?: string;
    custom?: Record<string, string>;
  };
};

function getByPath(payload: unknown, path?: string) {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((value, segment) => {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value) && /^\d+$/.test(segment)) return value[Number(segment)];
    if (typeof value === "object") return (value as Record<string, unknown>)[segment];
    return undefined;
  }, payload);
}

function toText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizePhone(value: unknown) {
  return toText(value).replace(/\D/g, "");
}

async function resolveSource(admin: ReturnType<typeof createAdminClient>, organizationId: string, sourceValue: unknown) {
  const name = toText(sourceValue) || "Webhook";
  const { data: existing } = await admin
    .from("lead_sources")
    .select("id")
    .eq("organization_id", organizationId)
    .ilike("name", name)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data } = await admin
    .from("lead_sources")
    .insert({ organization_id: organizationId, name, color: "#22c55e" })
    .select("id")
    .single();

  return data?.id as string | undefined;
}

async function saveCustomFields(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  leadId: string,
  payload: unknown,
  customMappings?: Record<string, string>
) {
  if (!customMappings || Object.keys(customMappings).length === 0) return;
  const { data: fields } = await admin
    .from("custom_fields")
    .select("id, key")
    .eq("organization_id", organizationId);

  const rows: Array<{ lead_id: string; field_id: string; value: string }> = [];
  for (const field of fields ?? []) {
    const path = customMappings[field.key];
    if (!path) continue;
    const value = getByPath(payload, path);
    if (value === undefined || value === null || value === "") continue;
    rows.push({
      lead_id: leadId,
      field_id: field.id,
      value: Array.isArray(value) ? value.join(", ") : String(value),
    });
  }

  if (rows.length > 0) {
    await admin.from("custom_field_values").upsert(rows, { onConflict: "lead_id,field_id" });
  }
}

// ─── Rate limit config ────────────────────────────────────────────────────────

// 60 per minute per IP. These tokens are per-org so legitimate use is low.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  // 1. Rate limit — before DB lookup to protect against token enumeration
  const rlKey = getRateLimitKey(request, "inbound");
  const rl = checkRateLimit(rlKey, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests", retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const { token } = await params;
  const admin = createAdminClient();
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const { data: configRow } = await admin
    .from("webhook_events")
    .select("organization_id, payload")
    .eq("source", "inbound_webhook_config")
    .filter("payload->>token", "eq", token)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const config = (configRow?.payload ?? {}) as WebhookConfigPayload;
  const organizationId = configRow?.organization_id as string | undefined;

  if (!organizationId || config.active === false) {
    return NextResponse.json({ error: "Webhook not found or inactive" }, { status: 404 });
  }

  // Event payload for logging — sanitized: strip token from stored record.
  const eventPayload = {
    webhook_name: config.name ?? "Webhook",
    body: sanitizePayload(body),
  };

  const name = toText(getByPath(body, config.mappings?.name));
  const phone = normalizePhone(getByPath(body, config.mappings?.phone));

  if (!name || !phone) {
    await admin.from("webhook_events").insert({
      organization_id: organizationId,
      source: "inbound_webhook_incoming",
      event_type: "webhook.received",
      payload: eventPayload,
      processed: false,
      error: "Payload recebido. Configure pelo menos os caminhos de nome e telefone para criar leads.",
    });
    return NextResponse.json({ success: true, processed: false, message: "Payload recebido para mapeamento." });
  }

  try {
    const sourceId = await resolveSource(admin, organizationId, getByPath(body, config.mappings?.source));
    const { data: existingLead } = await admin
      .from("leads")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("phone", phone)
      .maybeSingle();

    const potential = Number(getByPath(body, config.mappings?.potential_value));
    const leadPayload = {
      organization_id: organizationId,
      name,
      phone,
      email: toText(getByPath(body, config.mappings?.email)) || null,
      source_id: sourceId ?? null,
      procedure: toText(getByPath(body, config.mappings?.procedure)) || null,
      potential_value: Number.isFinite(potential) && potential > 0 ? potential : null,
      last_interaction_at: new Date().toISOString(),
    };

    const leadResult = existingLead?.id
      ? await admin.from("leads").update(leadPayload).eq("id", existingLead.id).select("id").single()
      : await admin.from("leads").insert({ ...leadPayload, status: "new" }).select("id").single();

    if (leadResult.error || !leadResult.data) throw leadResult.error;
    const leadId = leadResult.data.id as string;
    await saveCustomFields(admin, organizationId, leadId, body, config.mappings?.custom);

    // Lead event: minimal metadata, no raw PII
    await admin.from("lead_events").insert({
      lead_id: leadId,
      event_type: existingLead?.id ? "updated" : "created",
      description: existingLead?.id ? "Lead atualizado via webhook configurado." : "Lead criado via webhook configurado.",
      metadata: { webhook_name: config.name ?? "Webhook" },
    });

    await admin.from("webhook_events").insert({
      organization_id: organizationId,
      source: "inbound_webhook_incoming",
      event_type: existingLead?.id ? "lead.updated" : "lead.created",
      payload: { ...eventPayload, lead_id: leadId },
      processed: true,
    });

    return NextResponse.json({ success: true, processed: true, lead_id: leadId });
  } catch (error) {
    await admin.from("webhook_events").insert({
      organization_id: organizationId,
      source: "inbound_webhook_incoming",
      event_type: "webhook.error",
      payload: eventPayload,
      processed: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    method: "POST",
    description: "Envie um payload JSON para esta URL e depois configure o mapeamento no CRM.",
  });
}
