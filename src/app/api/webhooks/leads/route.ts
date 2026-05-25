import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { sanitizePayload, sanitizeLeadEventMeta } from "@/lib/sanitize";

// ─── Auth ─────────────────────────────────────────────────────────────────────

type AuthResult = "ok" | "missing_config" | "invalid_secret";

/**
 * Verify the shared WEBHOOK_SECRET.
 *
 * Preferred: x-webhook-secret header.
 * Deprecated: ?secret= query param (kept for backward compatibility).
 *
 * Returns "missing_config" when WEBHOOK_SECRET is not set — the endpoint
 * must then respond with 503 so the caller knows to check configuration
 * rather than silently accepting the request (fail-closed).
 */
function verifyWebhookSecret(request: NextRequest): AuthResult {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return "missing_config";

  const headerSecret = request.headers.get("x-webhook-secret");
  if (headerSecret === secret) return "ok";

  // ?secret= query param — deprecated, kept for backward compatibility.
  const querySecret = request.nextUrl.searchParams.get("secret");
  if (querySecret === secret) return "ok";

  return "invalid_secret";
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const LeadWebhookSchema = z.object({
  name: z.string().min(2).max(200),
  phone: z.string().regex(/^\+?[\d\s\-()]{8,20}$/, "Telefone invalido"),
  email: z.string().email().optional(),
  source: z.string().max(100).optional(),
  procedure: z.string().max(200).optional(),
  potential_value: z.number().positive().optional(),
  custom_fields: z.record(z.unknown()).optional(),
  organization_id: z.string().uuid().optional(),
  organization_slug: z.string().optional(),
});

type LeadPayload = z.infer<typeof LeadWebhookSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

async function resolveOrganization(admin: ReturnType<typeof createAdminClient>, payload: LeadPayload) {
  if (payload.organization_id) {
    const { data } = await admin.from("organizations").select("id").eq("id", payload.organization_id).maybeSingle();
    return data?.id as string | undefined;
  }

  if (payload.organization_slug) {
    const { data } = await admin.from("organizations").select("id").eq("slug", payload.organization_slug).maybeSingle();
    return data?.id as string | undefined;
  }

  // Single-org deployments: auto-resolve only when exactly one org exists.
  const { data } = await admin.from("organizations").select("id").limit(2);
  return data?.length === 1 ? (data[0].id as string) : undefined;
}

async function resolveSource(admin: ReturnType<typeof createAdminClient>, organizationId: string, sourceName?: string) {
  const name = sourceName?.trim() || "Webhook";
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
  customFields?: Record<string, unknown>
) {
  if (!customFields) return;
  const { data: fields } = await admin
    .from("custom_fields")
    .select("id, key, name")
    .eq("organization_id", organizationId);

  const values: Array<{ lead_id: string; field_id: string; value: string }> = [];

  for (const field of fields ?? []) {
    const raw = customFields[field.key] ?? customFields[field.name];
    if (raw === undefined || raw === null) continue;
    values.push({
      lead_id: leadId,
      field_id: field.id,
      value: Array.isArray(raw) ? raw.join(", ") : String(raw),
    });
  }

  if (values.length > 0) {
    await admin.from("custom_field_values").upsert(values, { onConflict: "lead_id,field_id" });
  }
}

// ─── Rate limit config ────────────────────────────────────────────────────────

// 60 per minute per IP — generous for legitimate integrations, limits flooding.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Rate limit
  const rlKey = getRateLimitKey(request, "leads");
  const rl = checkRateLimit(rlKey, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests", retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  // 2. Auth — fail closed
  const authResult = verifyWebhookSecret(request);
  if (authResult === "missing_config") {
    return NextResponse.json(
      { error: "Service Unavailable", code: "WEBHOOK_NOT_CONFIGURED" },
      { status: 503 }
    );
  }
  if (authResult === "invalid_secret") {
    return NextResponse.json({ error: "Unauthorized", code: "INVALID_SECRET" }, { status: 401 });
  }

  // 3. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = LeadWebhookSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 422 });
  }

  const payload = result.data;
  const admin = createAdminClient();
  const organizationId = await resolveOrganization(admin, payload);

  if (!organizationId) {
    return NextResponse.json(
      { error: "Organization not found. Send organization_id or organization_slug." },
      { status: 422 }
    );
  }

  const normalizedPhone = normalizePhone(payload.phone);
  const sourceId = await resolveSource(admin, organizationId, payload.source);

  try {
    const { data: existingLead } = await admin
      .from("leads")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("phone", normalizedPhone)
      .maybeSingle();

    const leadPayload = {
      organization_id: organizationId,
      name: payload.name,
      phone: normalizedPhone,
      email: payload.email ?? null,
      source_id: sourceId ?? null,
      procedure: payload.procedure ?? null,
      potential_value: payload.potential_value ?? null,
      last_interaction_at: new Date().toISOString(),
    };

    const leadResult = existingLead?.id
      ? await admin.from("leads").update(leadPayload).eq("id", existingLead.id).select("id").single()
      : await admin.from("leads").insert({ ...leadPayload, status: "new" }).select("id").single();

    if (leadResult.error || !leadResult.data) throw leadResult.error;

    const leadId = leadResult.data.id as string;
    await saveCustomFields(admin, organizationId, leadId, payload.custom_fields);

    // Store sanitized metadata — no phone/email in the event timeline.
    await admin.from("lead_events").insert({
      lead_id: leadId,
      event_type: existingLead?.id ? "updated" : "created",
      description: existingLead?.id ? "Lead atualizado via webhook." : "Lead criado via webhook.",
      metadata: sanitizeLeadEventMeta(payload),
    });

    // Sanitize full payload before storing in webhook_events.
    await admin.from("webhook_events").insert({
      organization_id: organizationId,
      source: "leads_endpoint",
      event_type: existingLead?.id ? "lead.updated" : "lead.created",
      payload: sanitizePayload(payload),
      processed: true,
    });

    return NextResponse.json(
      {
        success: true,
        action: existingLead?.id ? "updated" : "created",
        lead_id: leadId,
        message: existingLead?.id ? "Lead atualizado com sucesso" : "Lead criado com sucesso",
      },
      { status: existingLead?.id ? 200 : 201 }
    );
  } catch (error) {
    // Log error without echoing the payload (which contains PII).
    await admin.from("webhook_events").insert({
      organization_id: organizationId,
      source: "leads_endpoint",
      event_type: "lead.error",
      payload: { organization_id: organizationId, source: payload.source ?? null },
      processed: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  const secretConfigured = Boolean(process.env.WEBHOOK_SECRET);
  return NextResponse.json({
    status: "ok",
    endpoint: "POST /api/webhooks/leads",
    secret_configured: secretConfigured,
    required_fields: ["name", "phone"],
    optional_fields: ["email", "source", "procedure", "potential_value", "custom_fields", "organization_id", "organization_slug"],
    auth: {
      preferred: "Header: x-webhook-secret",
      deprecated: "Query param ?secret= (still accepted, avoid in new integrations)",
    },
    custom_fields_format: { custom_fields: { chave_do_campo: "valor" } },
  });
}
