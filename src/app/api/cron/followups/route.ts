import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// ─── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  // Vercel passes the secret in the Authorization header: "Bearer <secret>"
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  // Allow direct call with query param for local testing
  if (request.nextUrl.searchParams.get("secret") === secret) return true;
  return false;
}

// ─── Business hours check ─────────────────────────────────────────────────────

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
  return currentTime >= rule.start_time && currentTime < rule.end_time;
}

function nextBusinessHoursSlot(now: Date, timezone: string, hours: BusinessHour[]): Date {
  // Try each 15-min slot for up to 7 days
  const slot = new Date(now);
  for (let i = 0; i < 7 * 24 * 4; i++) {
    slot.setMinutes(slot.getMinutes() + 15);
    if (isWithinBusinessHours(slot, timezone, hours)) return slot;
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
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

  const url = `${baseUrl}/message/sendText/${encodeURIComponent(instanceName)}`;
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

export const maxDuration = 55; // seconds (Vercel Pro limit)

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now   = new Date();

  const stats = {
    orgsProcessed: 0,
    queued: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    deferred: 0,
    cancelled: 0,
  };

  try {
    // Load all enabled orgs with their settings
    const { data: orgs } = await admin
      .from("followup_settings")
      .select("organization_id, timezone, enabled")
      .eq("enabled", true);

    if (!orgs || orgs.length === 0) {
      return NextResponse.json({ ok: true, stats });
    }

    // ── PHASE 1: Scheduler ───────────────────────────────────────────────────
    // For each org, find conversations that need new queue items.

    for (const org of orgs) {
      const orgId = org.organization_id;
      stats.orgsProcessed++;

      // Load org config
      const [stepsRes, blockedStagesRes, blockedTagsRes] = await Promise.all([
        admin
          .from("followup_steps")
          .select("id, step_order, delay_days, message_template")
          .eq("organization_id", orgId)
          .order("step_order"),
        admin.from("followup_blocked_stages").select("stage_id").eq("organization_id", orgId),
        admin.from("followup_blocked_tags").select("tag_id").eq("organization_id", orgId),
      ]);

      const steps         = stepsRes.data ?? [];
      const blockedStages = new Set((blockedStagesRes.data ?? []).map((r) => r.stage_id));
      const blockedTags   = new Set((blockedTagsRes.data ?? []).map((r) => r.tag_id));

      if (steps.length === 0) continue;

      // Get open conversations with a linked lead
      const { data: conversations } = await admin
        .from("conversations")
        .select(`
          id, lead_id,
          lead:leads(id, followup_paused, stage_id, lead_tags(tag_id)),
          instance:whatsapp_instances(id, instance_name, status, deleted_at)
        `)
        .eq("organization_id", orgId)
        .eq("status", "open")
        .not("lead_id", "is", null);

      if (!conversations) continue;

      for (const conv of conversations) {
        const lead = conv.lead as unknown as {
          id: string;
          followup_paused: boolean;
          stage_id: string | null;
          lead_tags: { tag_id: string }[];
        } | null;

        // Skip if no lead or lead is paused
        if (!lead || lead.followup_paused) continue;

        // Skip if lead's stage is blocked
        if (lead.stage_id && blockedStages.has(lead.stage_id)) continue;

        // Skip if lead has any blocked tag
        const leadTagIds = (lead.lead_tags ?? []).map((t) => t.tag_id);
        if (leadTagIds.some((tid) => blockedTags.has(tid))) continue;

        // Skip if WhatsApp instance is not connected
        const instance = conv.instance as unknown as { id: string; instance_name: string; status: string; deleted_at: string | null } | null;
        if (!instance || instance.deleted_at || instance.status !== "connected") continue;

        // Find cycle_started_at: most recent manual, non-imported outbound message.
        // Imported historical messages are excluded so they don't trigger follow-up.
        const { data: lastManual } = await admin
          .from("messages")
          .select("created_at")
          .eq("conversation_id", conv.id)
          .eq("direction", "outbound")
          .eq("is_automatic", false)
          .eq("is_imported", false)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (!lastManual) continue;

        const cycleStartedAt = lastManual.created_at;

        // Guard: if the lead replied after the last manual message, do not queue.
        const { data: inboundAfterManual } = await admin
          .from("messages")
          .select("id")
          .eq("conversation_id", conv.id)
          .eq("direction", "inbound")
          .gt("created_at", cycleStartedAt)
          .limit(1)
          .maybeSingle();

        if (inboundAfterManual) continue; // lead replied — cycle is over

        // Count how many steps have been sent in this cycle
        const { data: sentItems } = await admin
          .from("followup_queue")
          .select("step_id")
          .eq("conversation_id", conv.id)
          .eq("cycle_started_at", cycleStartedAt)
          .eq("status", "sent");

        const sentStepIds = new Set((sentItems ?? []).map((r) => r.step_id));

        // Find the next step to queue (first not yet sent)
        const nextStep = steps.find((s) => !sentStepIds.has(s.id));
        if (!nextStep) continue; // all steps done for this cycle

        // Check if already queued (pending or sending)
        const { data: existing } = await admin
          .from("followup_queue")
          .select("id")
          .eq("conversation_id", conv.id)
          .eq("step_id", nextStep.id)
          .eq("cycle_started_at", cycleStartedAt)
          .in("status", ["pending", "sending"])
          .single();

        if (existing) continue; // already in queue

        // Compute scheduled_for
        const cycleMs    = new Date(cycleStartedAt).getTime();
        const scheduledFor = new Date(cycleMs + nextStep.delay_days * 24 * 60 * 60 * 1000);

        // Only queue if delay has elapsed
        if (scheduledFor > now) continue;

        // Create queue item
        const { error: insertErr } = await admin.from("followup_queue").insert({
          organization_id: orgId,
          conversation_id: conv.id,
          lead_id: lead.id,
          step_id: nextStep.id,
          cycle_started_at: cycleStartedAt,
          status: "pending",
          scheduled_for: scheduledFor.toISOString(),
        });

        if (insertErr) {
          // 23505 = unique violation (race condition from another cron run) — ignore
          if (insertErr.code !== "23505") {
            console.error("followup queue insert error:", insertErr);
          }
          continue;
        }

        // Log event
        await admin.from("followup_events").insert({
          organization_id: orgId,
          conversation_id: conv.id,
          lead_id: lead.id,
          event_type: "queued",
          metadata: { step_order: nextStep.step_order, delay_days: nextStep.delay_days },
        });

        stats.queued++;
      }
    }

    // ── PHASE 2: Sender ──────────────────────────────────────────────────────
    // Pick up to 20 pending items (1 per WhatsApp instance), send them.

    const { data: pendingItems } = await admin
      .from("followup_queue")
      .select(`
        id, organization_id, conversation_id, lead_id, step_id,
        cycle_started_at, scheduled_for,
        step:followup_steps(message_template, step_order),
        conversation:conversations(
          remote_jid,
          lead:leads(name, phone, followup_paused, stage_id, lead_tags(tag_id)),
          instance:whatsapp_instances(id, instance_name, status, deleted_at)
        )
      `)
      .eq("status", "pending")
      .lte("scheduled_for", now.toISOString())
      .order("scheduled_for")
      .limit(60);

    const seenInstances = new Set<string>();
    const toProcess = (pendingItems ?? []).filter((item) => {
      const instance = (item.conversation as { instance?: { id: string } } | null)?.instance;
      if (!instance?.id || seenInstances.has(instance.id)) return false;
      seenInstances.add(instance.id);
      return true;
    }).slice(0, 20);

    for (const item of toProcess) {
      const conv = item.conversation as unknown as {
        remote_jid: string;
        lead: { name: string; phone: string; followup_paused: boolean; stage_id: string | null; lead_tags: { tag_id: string }[] } | null;
        instance: { id: string; instance_name: string; status: string; deleted_at: string | null } | null;
      } | null;

      const step = item.step as unknown as { message_template: string; step_order: number } | null;

      if (!conv?.instance || conv.instance.deleted_at || !step) {
        await admin
          .from("followup_queue")
          .update({ status: "skipped", updated_at: now.toISOString() })
          .eq("id", item.id);
        stats.skipped++;
        continue;
      }

      // Re-check blocking conditions
      const lead = conv.lead;
      const orgId = item.organization_id;

      if (!lead || lead.followup_paused) {
        await admin
          .from("followup_queue")
          .update({ status: "skipped", updated_at: now.toISOString() })
          .eq("id", item.id);
        await admin.from("followup_events").insert({
          organization_id: orgId,
          queue_item_id: item.id,
          conversation_id: item.conversation_id,
          lead_id: item.lead_id,
          event_type: "skipped",
          metadata: { reason: "lead_paused" },
        });
        stats.skipped++;
        continue;
      }

      if (conv.instance.status !== "connected") {
        // Defer: instance offline
        const nextSlot = new Date(now.getTime() + 15 * 60 * 1000);
        await admin
          .from("followup_queue")
          .update({ scheduled_for: nextSlot.toISOString(), updated_at: now.toISOString() })
          .eq("id", item.id);
        stats.deferred++;
        continue;
      }

      // Load business hours for this org
      const { data: orgHours } = await admin
        .from("followup_business_hours")
        .select("day_of_week, start_time, end_time, enabled")
        .eq("organization_id", orgId);

      const orgSettings = orgs.find((o) => o.organization_id === orgId);
      const timezone = orgSettings?.timezone ?? "America/Sao_Paulo";
      const hours = orgHours ?? [];

      if (!isWithinBusinessHours(now, timezone, hours)) {
        const nextBizSlot = nextBusinessHoursSlot(now, timezone, hours);
        await admin
          .from("followup_queue")
          .update({ scheduled_for: nextBizSlot.toISOString(), updated_at: now.toISOString() })
          .eq("id", item.id);
        await admin.from("followup_events").insert({
          organization_id: orgId,
          queue_item_id: item.id,
          conversation_id: item.conversation_id,
          lead_id: item.lead_id,
          event_type: "deferred",
          metadata: { reason: "outside_business_hours", next_slot: nextBizSlot.toISOString() },
        });
        stats.deferred++;
        continue;
      }

      // Mark as sending (lock)
      const { error: lockErr } = await admin
        .from("followup_queue")
        .update({ status: "sending", updated_at: now.toISOString() })
        .eq("id", item.id)
        .eq("status", "pending");

      if (lockErr) {
        // Another process grabbed it
        continue;
      }

      // Final guard: lead may have replied between queue creation and now.
      const { data: lateInbound } = await admin
        .from("messages")
        .select("id")
        .eq("conversation_id", item.conversation_id)
        .eq("direction", "inbound")
        .gt("created_at", item.cycle_started_at)
        .limit(1)
        .maybeSingle();

      if (lateInbound) {
        await admin
          .from("followup_queue")
          .update({ status: "cancelled", updated_at: now.toISOString() })
          .eq("id", item.id);
        await admin.from("followup_events").insert({
          organization_id: orgId,
          queue_item_id: item.id,
          conversation_id: item.conversation_id,
          lead_id: item.lead_id,
          event_type: "cancelled_due_to_inbound",
          metadata: { reason: "lead_replied_after_queue_creation" },
        });
        stats.cancelled++;
        continue;
      }

      // Personalise message
      const message = step.message_template.replace(/\{nome\}/gi, lead.name ?? "");

      // Send via Evolution API
      const phone = conv.remote_jid.replace(/@.*$/, "");
      const result = await sendWhatsAppText(conv.instance.instance_name, phone, message);

      if (result.ok) {
        // Insert message record
        const { data: msgRecord } = await admin
          .from("messages")
          .insert({
            conversation_id: item.conversation_id,
            direction: "outbound",
            message_type: "text",
            content: message,
            is_automatic: true,
          })
          .select("id")
          .single();

        await admin
          .from("followup_queue")
          .update({
            status: "sent",
            sent_at: now.toISOString(),
            message_id: msgRecord?.id ?? null,
            updated_at: now.toISOString(),
          })
          .eq("id", item.id);

        await admin.from("followup_events").insert({
          organization_id: orgId,
          queue_item_id: item.id,
          conversation_id: item.conversation_id,
          lead_id: item.lead_id,
          event_type: "sent",
          metadata: { step_order: step.step_order, instance: conv.instance.instance_name },
        });

        stats.sent++;
      } else {
        await admin
          .from("followup_queue")
          .update({
            status: "failed",
            error: result.error ?? "unknown",
            updated_at: now.toISOString(),
          })
          .eq("id", item.id);

        await admin.from("followup_events").insert({
          organization_id: orgId,
          queue_item_id: item.id,
          conversation_id: item.conversation_id,
          lead_id: item.lead_id,
          event_type: "failed",
          metadata: { error: result.error, step_order: step.step_order },
        });

        stats.failed++;
      }
    }

    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    console.error("followups cron error:", err);
    return NextResponse.json({ ok: false, error: String(err), stats }, { status: 500 });
  }
}
