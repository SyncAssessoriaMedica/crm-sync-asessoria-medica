import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { LeadsClient } from "./leads-client";
import type { LeadListItem, LeadOptionData } from "./types";

export default async function LeadsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id, organizations(name)")
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
      </div>
    );
  }

  const organizationId = membership.organization_id as string;
  const organization = membership.organizations as { name?: string } | null;

  const [leadsResult, sourcesResult, campaignsResult, pipelinesResult] = await Promise.all([
    admin
      .from("leads")
      .select(
        `
        *,
        source:lead_sources(*),
        campaign:campaigns(*),
        stage:pipeline_stages(*)
      `
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
    admin
      .from("lead_sources")
      .select("*")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true }),
    admin
      .from("campaigns")
      .select("*")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true }),
    admin
      .from("pipelines")
      .select("id, pipeline_stages(*)")
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .maybeSingle(),
  ]);

  const options: LeadOptionData = {
    sources: (sourcesResult.data ?? []) as LeadOptionData["sources"],
    campaigns: (campaignsResult.data ?? []) as LeadOptionData["campaigns"],
    stages: ((pipelinesResult.data?.pipeline_stages ?? []) as LeadOptionData["stages"]).sort(
      (a, b) => a.order - b.order
    ),
  };

  if (leadsResult.error) {
    return (
      <div className="rounded-xl border border-border bg-white p-8 shadow-card">
        <p className="label-eyebrow text-danger-red">Erro</p>
        <h1 className="mt-1 text-xl font-black text-text-primary">Nao foi possivel carregar leads</h1>
        <p className="mt-2 text-sm text-text-secondary">{leadsResult.error.message}</p>
      </div>
    );
  }

  return (
    <LeadsClient
      leads={(leadsResult.data ?? []) as LeadListItem[]}
      options={options}
      organizationName={organization?.name ?? "Sync Marketing"}
    />
  );
}

