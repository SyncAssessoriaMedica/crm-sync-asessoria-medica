import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { canAccessRoute } from "@/lib/permissions";
import { AccessDenied } from "@/components/layout/access-denied";
import { LeadDetailClient } from "./lead-detail-client";
import type { CustomFieldValueItem, LeadEventItem, LeadListItem, LeadNoteItem, LeadOptionData, LeadTaskItem } from "../types";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return (
      <div className="rounded-xl border border-border bg-white p-8 shadow-card">
        <p className="label-eyebrow text-text-muted">Acesso</p>
        <h1 className="mt-1 text-xl font-black text-text-primary">Organizacao nao configurada</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Este usuario ainda nao possui uma organizacao vinculada.
        </p>
        <Button asChild className="mt-4">
          <Link href="/leads">Voltar para leads</Link>
        </Button>
      </div>
    );
  }

  const organizationId = membership.organization_id as string;
  const userRole = membership.role as string;

  if (!canAccessRoute(userRole, "/leads")) {
    return <AccessDenied />;
  }

  const [leadResult, notesResult, eventsResult, tasksResult, sourcesResult, pipelinesResult, customFieldsResult, customValuesResult, leadTagsResult, orgTagsResult] =
    await Promise.all([
      admin
        .from("leads")
        .select(
          `
          *,
          source:lead_sources(*),
          stage:pipeline_stages(*)
        `
        )
        .eq("id", id)
        .eq("organization_id", organizationId)
        .maybeSingle(),
      admin
        .from("lead_notes")
        .select("id, content, created_at, author:profiles(full_name, email)")
        .eq("lead_id", id)
        .order("created_at", { ascending: false }),
      admin
        .from("lead_events")
        .select("id, event_type, description, created_at")
        .eq("lead_id", id)
        .order("created_at", { ascending: false }),
      admin
        .from("lead_tasks")
        .select("id, title, due_at, completed_at, created_at")
        .eq("lead_id", id)
        .order("created_at", { ascending: false }),
      admin
        .from("lead_sources")
        .select("*")
        .eq("organization_id", organizationId)
        .order("name", { ascending: true }),
      admin
        .from("pipelines")
        .select("id, pipeline_stages(*)")
        .eq("organization_id", organizationId)
        .eq("is_default", true)
        .maybeSingle(),
      admin
        .from("custom_fields")
        .select("*")
        .eq("organization_id", organizationId)
        .order("order", { ascending: true })
        .order("created_at", { ascending: true }),
      admin
        .from("custom_field_values")
        .select("id, lead_id, field_id, value")
        .eq("lead_id", id),
      admin
        .from("lead_tags")
        .select("tag_id, tags(id, name, color)")
        .eq("lead_id", id),
      admin
        .from("tags")
        .select("id, name, color")
        .eq("organization_id", organizationId)
        .order("name", { ascending: true }),
    ]);

  if (leadResult.error) {
    return (
      <div className="rounded-xl border border-border bg-white p-8 shadow-card">
        <p className="label-eyebrow text-danger-red">Erro</p>
        <h1 className="mt-1 text-xl font-black text-text-primary">Nao foi possivel carregar o lead</h1>
        <p className="mt-2 text-sm text-text-secondary">{leadResult.error.message}</p>
      </div>
    );
  }

  if (!leadResult.data) notFound();

  const options: LeadOptionData = {
    sources: (sourcesResult.data ?? []) as LeadOptionData["sources"],
    stages: ((pipelinesResult.data?.pipeline_stages ?? []) as LeadOptionData["stages"]).sort(
      (a, b) => a.order - b.order
    ),
    customFields: (customFieldsResult.data ?? []) as LeadOptionData["customFields"],
    tags: (orgTagsResult.data ?? []) as LeadOptionData["tags"],
  };

  const customValues = Object.fromEntries(
    ((customValuesResult.data ?? []) as CustomFieldValueItem[]).map((item) => [item.field_id, item.value ?? ""])
  );

  type LeadTagRow = { tag_id: string; tags: { id: string; name: string; color: string } | { id: string; name: string; color: string }[] | null };
  const leadTags = ((leadTagsResult.data ?? []) as LeadTagRow[])
    .map((row) => (Array.isArray(row.tags) ? row.tags[0] ?? null : row.tags))
    .filter((tag): tag is { id: string; name: string; color: string } => tag !== null);

  return (
    <LeadDetailClient
      lead={leadResult.data as LeadListItem}
      options={options}
      leadTags={leadTags}
      notes={(notesResult.data ?? []).map((note) => ({
        ...note,
        author: Array.isArray(note.author) ? note.author[0] ?? null : note.author,
      })) as LeadNoteItem[]}
      events={(eventsResult.data ?? []) as LeadEventItem[]}
      tasks={(tasksResult.data ?? []) as LeadTaskItem[]}
      customValues={customValues}
    />
  );
}
