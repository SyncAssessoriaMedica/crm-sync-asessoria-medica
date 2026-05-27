import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  type OrgBusinessHours,
  isWithinBusinessHours,
  nextBusinessHoursSlot,
} from "@/lib/business-hours";

// ─── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (request.nextUrl.searchParams.get("secret") === secret) return true;
  return false;
}

// ─── Evolution API ────────────────────────────────────────────────────────────

function evolutionBase(): string | null {
  const raw = process.env.EVOLUTION_API_URL;
  if (!raw) return null;
  return raw.replace(/\/+$/, "").replace(/\/manager$/, "");
}

async function sendWhatsAppText(
  instanceName: string,
  phone: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const base   = evolutionBase();
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!base || !apiKey) return { ok: false, error: "Evolution API not configured" };

  try {
    const res = await fetch(
      `${base}/message/sendText/${encodeURIComponent(instanceName)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({ number: phone, text, delay: 1200, linkPreview: false }),
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function sendWhatsAppImage(
  instanceName: string,
  phone: string,
  mediaUrl: string,
  caption: string
): Promise<{ ok: boolean; error?: string }> {
  const base   = evolutionBase();
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!base || !apiKey) return { ok: false, error: "Evolution API not configured" };

  try {
    const res = await fetch(
      `${base}/message/sendMedia/${encodeURIComponent(instanceName)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({
          number: phone,
          mediatype: "image",
          media: mediaUrl,
          caption,
          delay: 1200,
        }),
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function sendWhatsAppAudio(
  instanceName: string,
  phone: string,
  audioUrl: string
): Promise<{ ok: boolean; error?: string }> {
  const base   = evolutionBase();
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!base || !apiKey) return { ok: false, error: "Evolution API not configured" };

  try {
    const res = await fetch(
      `${base}/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({ number: phone, audio: audioUrl, delay: 1200, encoding: true }),
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Storage signed URL ───────────────────────────────────────────────────────

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

async function getSignedMediaUrl(admin: SupabaseAdmin, storageRef: string): Promise<string | null> {
  if (!storageRef.startsWith("supabase://media/")) return null;
  const path = storageRef.slice("supabase://media/".length);
  const { data, error } = await admin.storage.from("media").createSignedUrl(path, 300); // 5 min
  if (error || !data?.signedUrl) {
    console.error("[followup] signed URL error:", error?.message, "path:", path);
    return null;
  }
  return data.signedUrl;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export const maxDuration = 55;

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
    // Load all enabled orgs
    const { data: orgs } = await admin
      .from("followup_settings")
      .select("organization_id, enabled")
      .eq("enabled", true);

    if (!orgs || orgs.length === 0) {
      return NextResponse.json({ ok: true, stats });
    }

    // ── PHASE 1: Scheduler ───────────────────────────────────────────────────

    for (const org of orgs) {
      const orgId = org.organization_id;
      stats.orgsProcessed++;

      const [stepsRes, blockedStagesRes, blockedTagsRes] = await Promise.all([
        admin
          .from("followup_steps")
          .select("id, step_order, delay_days, message_template, message_type, media_url, media_mimetype, media_filename")
          .eq("organization_id", orgId)
          .order("step_order"),
        admin.from("followup_blocked_stages").select("stage_id").eq("organization_id", orgId),
        admin.from("followup_blocked_tags").select("tag_id").eq("organization_id", orgId),
      ]);

      const steps         = stepsRes.data ?? [];
      const blockedStages = new Set((blockedStagesRes.data ?? []).map((r) => r.stage_id));
      const blockedTags   = new Set((blockedTagsRes.data ?? []).map((r) => r.tag_id));

      if (steps.length === 0) continue;

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

        if (!lead || lead.followup_paused) continue;
        if (lead.stage_id && blockedStages.has(lead.stage_id)) continue;
        const leadTagIds = (lead.lead_tags ?? []).map((t) => t.tag_id);
        if (leadTagIds.some((tid) => blockedTags.has(tid))) continue;

        const instance = conv.instance as unknown as { id: string; instance_name: string; status: string; deleted_at: string | null } | null;
        if (!instance || instance.deleted_at || instance.status !== "connected") continue;

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

        const { data: inboundAfterManual } = await admin
          .from("messages")
          .select("id")
          .eq("conversation_id", conv.id)
          .eq("direction", "inbound")
          .gt("created_at", cycleStartedAt)
          .limit(1)
          .maybeSingle();

        if (inboundAfterManual) continue;

        const { data: sentItems } = await admin
          .from("followup_queue")
          .select("step_id")
          .eq("conversation_id", conv.id)
          .eq("cycle_started_at", cycleStartedAt)
          .eq("status", "sent");

        const sentStepIds = new Set((sentItems ?? []).map((r) => r.step_id));
        const nextStep = steps.find((s) => !sentStepIds.has(s.id));
        if (!nextStep) continue;

        const { data: existing } = await admin
          .from("followup_queue")
          .select("id")
          .eq("conversation_id", conv.id)
          .eq("step_id", nextStep.id)
          .eq("cycle_started_at", cycleStartedAt)
          .in("status", ["pending", "sending"])
          .single();

        if (existing) continue;

        const cycleMs      = new Date(cycleStartedAt).getTime();
        const scheduledFor = new Date(cycleMs + nextStep.delay_days * 24 * 60 * 60 * 1000);

        if (scheduledFor > now) continue;

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
          if (insertErr.code !== "23505") {
            console.error("followup queue insert error:", insertErr);
          }
          continue;
        }

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

    const { data: pendingItems } = await admin
      .from("followup_queue")
      .select(`
        id, organization_id, conversation_id, lead_id, step_id,
        cycle_started_at, scheduled_for,
        step:followup_steps(message_template, step_order, message_type, media_url, media_mimetype, media_filename),
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

    // Cache org business hours to avoid redundant queries per item
    const bhCache = new Map<string, OrgBusinessHours | null>();

    async function getOrgBh(orgId: string): Promise<OrgBusinessHours | null> {
      if (bhCache.has(orgId)) return bhCache.get(orgId)!;
      const { data } = await admin
        .from("organization_settings")
        .select("business_hours")
        .eq("organization_id", orgId)
        .maybeSingle();
      const bh = (data?.business_hours as OrgBusinessHours | null) ?? null;
      bhCache.set(orgId, bh);
      return bh;
    }

    for (const item of toProcess) {
      const conv = item.conversation as unknown as {
        remote_jid: string;
        lead: { name: string; phone: string; followup_paused: boolean; stage_id: string | null; lead_tags: { tag_id: string }[] } | null;
        instance: { id: string; instance_name: string; status: string; deleted_at: string | null } | null;
      } | null;

      const step = item.step as unknown as {
        message_template: string;
        step_order: number;
        message_type: string;
        media_url: string | null;
        media_mimetype: string | null;
        media_filename: string | null;
      } | null;

      if (!conv?.instance || conv.instance.deleted_at || !step) {
        await admin
          .from("followup_queue")
          .update({ status: "skipped", updated_at: now.toISOString() })
          .eq("id", item.id);
        stats.skipped++;
        continue;
      }

      const lead  = conv.lead;
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
        const nextSlot = new Date(now.getTime() + 15 * 60 * 1000);
        await admin
          .from("followup_queue")
          .update({ scheduled_for: nextSlot.toISOString(), updated_at: now.toISOString() })
          .eq("id", item.id);
        stats.deferred++;
        continue;
      }

      // Business hours check — from organization_settings
      const bh = await getOrgBh(orgId);

      if (bh && bh.workingDays?.length && !isWithinBusinessHours(now, bh)) {
        const nextBizSlot = nextBusinessHoursSlot(now, bh);
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

      // Lock item
      const { error: lockErr } = await admin
        .from("followup_queue")
        .update({ status: "sending", updated_at: now.toISOString() })
        .eq("id", item.id)
        .eq("status", "pending");

      if (lockErr) continue;

      // Final inbound guard
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

      const phone        = conv.remote_jid.replace(/@.*$/, "").replace(/\D/g, "");
      const messageType  = step.message_type ?? "text";
      const personalized = (step.message_template ?? "").replace(/\{nome\}/gi, lead.name ?? "");

      let result: { ok: boolean; error?: string };

      if (messageType === "image" || messageType === "audio") {
        if (!step.media_url) {
          await admin
            .from("followup_queue")
            .update({
              status: "failed",
              error: "media_url ausente no passo",
              updated_at: now.toISOString(),
            })
            .eq("id", item.id);
          await admin.from("followup_events").insert({
            organization_id: orgId,
            queue_item_id: item.id,
            conversation_id: item.conversation_id,
            lead_id: item.lead_id,
            event_type: "failed",
            metadata: { error: "media_url ausente", step_order: step.step_order },
          });
          stats.failed++;
          continue;
        }

        const signedUrl = await getSignedMediaUrl(admin, step.media_url);
        if (!signedUrl) {
          await admin
            .from("followup_queue")
            .update({
              status: "failed",
              error: "nao foi possivel gerar URL assinada para a midia",
              updated_at: now.toISOString(),
            })
            .eq("id", item.id);
          stats.failed++;
          continue;
        }

        if (messageType === "image") {
          result = await sendWhatsAppImage(conv.instance.instance_name, phone, signedUrl, personalized);
        } else {
          result = await sendWhatsAppAudio(conv.instance.instance_name, phone, signedUrl);
        }
      } else {
        result = await sendWhatsAppText(conv.instance.instance_name, phone, personalized);
      }

      if (result.ok) {
        const { data: msgRecord } = await admin
          .from("messages")
          .insert({
            conversation_id: item.conversation_id,
            direction: "outbound",
            message_type: messageType,
            content: messageType === "text" ? personalized : null,
            media_url: step.media_url ?? null,
            media_mimetype: step.media_mimetype ?? null,
            media_filename: step.media_filename ?? null,
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
          metadata: { step_order: step.step_order, instance: conv.instance.instance_name, message_type: messageType },
        });

        stats.sent++;
      } else {
        await admin
          .from("followup_queue")
          .update({
            status: "failed",
            error: (result.error ?? "unknown").slice(0, 400),
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
