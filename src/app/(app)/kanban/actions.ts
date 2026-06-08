"use server";

import { getOrganizationContext } from "@/lib/organization-context";
import type { LeadListItem } from "../leads/types";

const KANBAN_PAGE_SIZE = 50;

export async function loadMoreKanbanLeadsAction(
  stageId: string | null,
  offset: number,
  periodStart: string,
  periodEnd: string,
  sourceFilter: string,
  serviceFilter: string,
  searchQuery: string,
): Promise<{ leads: LeadListItem[]; hasMore: boolean; error?: string }> {
  try {
    const { admin, organizationId } = await getOrganizationContext();

    let query = admin
      .from("leads")
      .select(
        `*,
        source:lead_sources(*),
        service:clinic_services(*),
        stage:pipeline_stages(*),
        lead_tags(tags(*)),
        custom_field_values(field_id, value)`
      )
      .eq("organization_id", organizationId)
      .gte("created_at", periodStart)
      .lt("created_at", periodEnd)
      .order("updated_at", { ascending: false })
      .range(offset, offset + KANBAN_PAGE_SIZE - 1);

    if (stageId === null) {
      query = query.is("stage_id", null);
    } else {
      query = query.eq("stage_id", stageId);
    }

    if (sourceFilter) query = query.eq("source_id", sourceFilter);
    if (serviceFilter) query = query.eq("service_id", serviceFilter);

    if (searchQuery) {
      const q = searchQuery.trim();
      if (q) {
        const digits = q.replace(/\D/g, "");
        const conditions = [`name.ilike.%${q}%`, `procedure.ilike.%${q}%`];
        if (digits.length >= 4) conditions.push(`phone.ilike.%${digits}%`);
        query = query.or(conditions.join(","));
      }
    }

    const { data, error } = await query;
    if (error) return { leads: [], hasMore: false, error: error.message };

    const leads = (data ?? []) as LeadListItem[];
    return { leads, hasMore: leads.length === KANBAN_PAGE_SIZE };
  } catch (err) {
    return { leads: [], hasMore: false, error: err instanceof Error ? err.message : "Erro ao carregar leads." };
  }
}
