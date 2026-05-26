import { redirect } from "next/navigation";
import { getOrganizationContext } from "@/lib/organization-context";
import { canAccessRoute } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/server";
import { FollowUpClient } from "./follow-up-client";

export default async function FollowUpPage() {
  const context = await getOrganizationContext();
  if (!canAccessRoute(context.role, "/follow-up")) redirect("/dashboard");

  const admin = createAdminClient();
  const orgId = context.organizationId;

  const [
    settingsResult,
    stepsResult,
    hoursResult,
    blockedStagesResult,
    blockedTagsResult,
    stagesResult,
    tagsResult,
    queueResult,
    eventsResult,
    instancesResult,
  ] = await Promise.all([
    admin.from("followup_settings").select("*").eq("organization_id", orgId).single(),
    admin.from("followup_steps").select("*").eq("organization_id", orgId).order("step_order"),
    admin.from("followup_business_hours").select("*").eq("organization_id", orgId).order("day_of_week"),
    admin.from("followup_blocked_stages").select("stage_id").eq("organization_id", orgId),
    admin.from("followup_blocked_tags").select("tag_id").eq("organization_id", orgId),
    admin
      .from("pipeline_stages")
      .select("id, name, pipeline_id, pipelines!inner(organization_id)")
      .eq("pipelines.organization_id", orgId)
      .order("order"),
    admin.from("tags").select("id, name, color").eq("organization_id", orgId).order("name"),
    admin
      .from("followup_queue")
      .select(`
        id, status, scheduled_for, sent_at, error, cycle_started_at, created_at,
        step:followup_steps(step_order, delay_days, message_template),
        conversation:conversations(id, remote_jid, lead:leads(id, name, phone))
      `)
      .eq("organization_id", orgId)
      .in("status", ["pending", "sending"])
      .order("scheduled_for")
      .limit(50),
    admin
      .from("followup_events")
      .select(`
        id, event_type, metadata, created_at,
        queue_item:followup_queue(
          step:followup_steps(step_order),
          conversation:conversations(remote_jid, lead:leads(name, phone))
        )
      `)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("whatsapp_instances")
      .select("id, instance_name, status")
      .eq("organization_id", orgId)
      .is("deleted_at", null),
  ]);

  return (
    <FollowUpClient
      settings={settingsResult.data ?? null}
      steps={stepsResult.data ?? []}
      businessHours={hoursResult.data ?? []}
      blockedStageIds={(blockedStagesResult.data ?? []).map((r) => r.stage_id)}
      blockedTagIds={(blockedTagsResult.data ?? []).map((r) => r.tag_id)}
      stages={stagesResult.data ?? []}
      tags={tagsResult.data ?? []}
      queue={(queueResult.data ?? []) as unknown as Parameters<typeof FollowUpClient>[0]["queue"]}
      events={(eventsResult.data ?? []) as unknown as Parameters<typeof FollowUpClient>[0]["events"]}
      instances={(instancesResult.data ?? []) as { id: string; instance_name: string; status: string }[]}
    />
  );
}
