"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrganizationContext } from "@/lib/organization-context";
import { createAdminClient } from "@/lib/supabase/server";
import type { LeadStatus } from "@/lib/types";

type ActionResult = { ok: true; message: string; id?: string } | { ok: false; message: string };

const LeadSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do lead."),
  phone: z.string().trim().min(8, "Informe um telefone valido."),
  email: z.string().trim().email("Email invalido.").optional().or(z.literal("")),
  source_id: z.string().uuid().optional().or(z.literal("")),
  procedure: z.string().trim().optional(),
  stage_id: z.string().uuid().optional().or(z.literal("")),
  potential_value: z.coerce.number().nonnegative().optional().or(z.literal("")),
  closed_value: z.coerce.number().nonnegative().optional().or(z.literal("")),
  observations: z.string().trim().optional(),
});

const NoteSchema = z.object({
  lead_id: z.string().uuid(),
  content: z.string().trim().min(1, "Escreva uma nota antes de salvar."),
});

const TaskSchema = z.object({
  lead_id: z.string().uuid(),
  title: z.string().trim().min(2, "Informe o titulo da tarefa."),
  due_at: z.string().optional(),
});

async function getCurrentContext() {
  const context = await getOrganizationContext();

  return {
    admin: context.admin,
    user: context.user,
    organizationId: context.organizationId,
    role: context.role,
    isSyncAdmin: context.isSyncAdmin,
  };
}

function optionalString(value: unknown) {
  const str = typeof value === "string" ? value.trim() : "";
  return str.length > 0 ? str : null;
}

function optionalNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function optionalDate(value: unknown) {
  const str = typeof value === "string" ? value.trim() : "";
  return str.length > 0 ? new Date(str).toISOString() : null;
}

function statusFromStageName(stageName?: string | null): LeadStatus {
  const normalized = (stageName ?? "").toLowerCase();
  if (normalized.includes("contact")) return "contacted";
  if (normalized.includes("qualific")) return "qualified";
  if (normalized.includes("agend")) return "scheduled";
  if (normalized.includes("nao compareceu") || normalized.includes("não compareceu")) return "no_show";
  if (normalized.includes("compareceu")) return "attended";
  if (normalized.includes("fechado")) return "closed_won";
  if (normalized.includes("perdido")) return "closed_lost";
  return "new";
}

async function getStatusForStage(admin: ReturnType<typeof createAdminClient>, stageId: string | null): Promise<LeadStatus> {
  if (!stageId) return "new";
  const { data } = await admin.from("pipeline_stages").select("name").eq("id", stageId).maybeSingle();
  return statusFromStageName(data?.name);
}

async function saveCustomFieldValues(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  leadId: string,
  formData: FormData
) {
  const { data: fields, error } = await admin
    .from("custom_fields")
    .select("id, key, field_type")
    .eq("organization_id", organizationId);

  if (error || !fields?.length) return;

  const values = fields.map((field) => {
    const rawValue = formData.get(`custom_${field.key}`);
    const value =
      field.field_type === "boolean"
        ? rawValue === "on"
          ? "true"
          : "false"
        : typeof rawValue === "string" && rawValue !== "none"
          ? rawValue.trim()
          : "";

    return {
      lead_id: leadId,
      field_id: field.id,
      value: value || null,
    };
  });

  await admin.from("custom_field_values").upsert(values, { onConflict: "lead_id,field_id" });
}

function formToLeadPayload(formData: FormData) {
  const parsed = LeadSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    source_id: formData.get("source_id"),
    procedure: formData.get("procedure"),
    stage_id: formData.get("stage_id"),
    potential_value: formData.get("potential_value") ?? "",
    closed_value: formData.get("closed_value") ?? "",
    observations: formData.get("observations"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados invalidos." };
  }

  const data = parsed.data;
  return {
    payload: {
      name: data.name,
      phone: data.phone.replace(/\D/g, ""),
      email: optionalString(data.email),
      source_id: optionalString(data.source_id),
      procedure: optionalString(data.procedure),
      stage_id: optionalString(data.stage_id),
      potential_value: optionalNumber(data.potential_value),
      closed_value: optionalNumber(data.closed_value),
      observations: optionalString(data.observations),
    },
  };
}

export async function createLeadAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getCurrentContext();
    const result = formToLeadPayload(formData);
    if ("error" in result) return { ok: false, message: result.error ?? "Dados invalidos." };
    const status = await getStatusForStage(admin, result.payload.stage_id);

    const { data, error } = await admin
      .from("leads")
      .insert({ ...result.payload, status, organization_id: organizationId })
      .select("id")
      .single();

    if (error) return { ok: false, message: error.message };

    await saveCustomFieldValues(admin, organizationId, data.id as string, formData);

    revalidatePath("/leads");
    return { ok: true, message: "Lead criado com sucesso.", id: data.id as string };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao criar lead." };
  }
}

export async function updateLeadAction(leadId: string, formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getCurrentContext();
    const result = formToLeadPayload(formData);
    if ("error" in result) return { ok: false, message: result.error ?? "Dados invalidos." };
    const status = await getStatusForStage(admin, result.payload.stage_id);

    const { error } = await admin
      .from("leads")
      .update({ ...result.payload, status })
      .eq("id", leadId)
      .eq("organization_id", organizationId);

    if (error) return { ok: false, message: error.message };

    await saveCustomFieldValues(admin, organizationId, leadId, formData);

    revalidatePath("/leads");
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: "Lead atualizado." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar lead." };
  }
}

export async function deleteLeadAction(leadId: string): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getCurrentContext();
    const { error } = await admin
      .from("leads")
      .delete()
      .eq("id", leadId)
      .eq("organization_id", organizationId);

    if (error) return { ok: false, message: error.message };

    revalidatePath("/leads");
    return { ok: true, message: "Lead excluido." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao excluir lead." };
  }
}

export async function addNoteAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, user, organizationId } = await getCurrentContext();
    const parsed = NoteSchema.safeParse({
      lead_id: formData.get("lead_id"),
      content: formData.get("content"),
    });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Nota invalida." };

    const { data: lead } = await admin
      .from("leads")
      .select("id")
      .eq("id", parsed.data.lead_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!lead) return { ok: false, message: "Lead nao encontrado." };

    const { error } = await admin.from("lead_notes").insert({
      lead_id: parsed.data.lead_id,
      author_id: user.id,
      content: parsed.data.content,
    });
    if (error) return { ok: false, message: error.message };

    revalidatePath(`/leads/${parsed.data.lead_id}`);
    return { ok: true, message: "Nota salva." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao salvar nota." };
  }
}

export async function addTaskAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getCurrentContext();
    const parsed = TaskSchema.safeParse({
      lead_id: formData.get("lead_id"),
      title: formData.get("title"),
      due_at: formData.get("due_at"),
    });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Tarefa invalida." };

    const { data: lead } = await admin
      .from("leads")
      .select("id")
      .eq("id", parsed.data.lead_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!lead) return { ok: false, message: "Lead nao encontrado." };

    const { error } = await admin.from("lead_tasks").insert({
      lead_id: parsed.data.lead_id,
      title: parsed.data.title,
      due_at: optionalDate(parsed.data.due_at),
    });
    if (error) return { ok: false, message: error.message };

    revalidatePath(`/leads/${parsed.data.lead_id}`);
    return { ok: true, message: "Tarefa criada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao criar tarefa." };
  }
}

export async function toggleTaskAction(taskId: string, leadId: string, completed: boolean): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getCurrentContext();
    const { error } = await admin
      .from("lead_tasks")
      .update({ completed_at: completed ? new Date().toISOString() : null })
      .eq("id", taskId)
      .eq("lead_id", leadId)
      .in(
        "lead_id",
        (
          await admin.from("leads").select("id").eq("organization_id", organizationId)
        ).data?.map((lead) => lead.id) ?? []
      );

    if (error) return { ok: false, message: error.message };

    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: completed ? "Tarefa concluida." : "Tarefa reaberta." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar tarefa." };
  }
}

export async function getLeadCustomValuesAction(leadId: string): Promise<Record<string, string>> {
  try {
    const { admin, organizationId } = await getCurrentContext();
    const { data: lead } = await admin.from("leads").select("id").eq("id", leadId).eq("organization_id", organizationId).maybeSingle();
    if (!lead) return {};
    const { data } = await admin.from("custom_field_values").select("field_id, value").eq("lead_id", leadId);
    return Object.fromEntries((data ?? []).map((row) => [row.field_id, row.value ?? ""]));
  } catch {
    return {};
  }
}

export async function applyTagToLeadAction(leadId: string, tagId: string): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getCurrentContext();
    const { data: lead } = await admin.from("leads").select("id").eq("id", leadId).eq("organization_id", organizationId).maybeSingle();
    if (!lead) return { ok: false, message: "Lead nao encontrado." };
    const { error } = await admin.from("lead_tags").upsert({ lead_id: leadId, tag_id: tagId });
    if (error) return { ok: false, message: error.message };
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    return { ok: true, message: "Tag aplicada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao aplicar tag." };
  }
}

export async function removeTagFromLeadAction(leadId: string, tagId: string): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getCurrentContext();
    const { data: lead } = await admin.from("leads").select("id").eq("id", leadId).eq("organization_id", organizationId).maybeSingle();
    if (!lead) return { ok: false, message: "Lead nao encontrado." };
    const { error } = await admin.from("lead_tags").delete().eq("lead_id", leadId).eq("tag_id", tagId);
    if (error) return { ok: false, message: error.message };
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    return { ok: true, message: "Tag removida." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao remover tag." };
  }
}

export async function updateLeadStageAction(leadId: string, stageId: string): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getCurrentContext();
    const nextStageId = stageId || null;
    const status = await getStatusForStage(admin, nextStageId);
    const { error } = await admin
      .from("leads")
      .update({ stage_id: nextStageId, status })
      .eq("id", leadId)
      .eq("organization_id", organizationId);

    if (error) return { ok: false, message: error.message };

    revalidatePath("/leads");
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: "Etapa atualizada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar etapa." };
  }
}

// ─── Bulk actions ─────────────────────────────────────────────────────────────

const BULK_DELETE_ROLES = ["super_admin", "gestor_sync", "admin_clinica"];

export async function deleteLeadsBulkAction(leadIds: string[]): Promise<ActionResult> {
  try {
    const { admin, organizationId, role } = await getCurrentContext();

    if (!BULK_DELETE_ROLES.includes(role)) {
      return { ok: false, message: "Sem permissao para apagar leads em massa." };
    }
    if (!leadIds.length) return { ok: false, message: "Nenhum lead selecionado." };
    if (leadIds.length > 500) return { ok: false, message: "Maximo de 500 leads por operacao." };

    // Confirm all IDs belong to the active org (prevents cross-tenant delete)
    const { data: owned, error: checkError } = await admin
      .from("leads")
      .select("id")
      .eq("organization_id", organizationId)
      .in("id", leadIds);

    if (checkError) return { ok: false, message: checkError.message };

    const ownedIds = (owned ?? []).map((row) => row.id as string);
    if (ownedIds.length !== leadIds.length) {
      return { ok: false, message: "Alguns leads nao pertencem a esta clinica." };
    }

    const { data: linkedConversations, error: conversationLookupError } = await admin
      .from("conversations")
      .select("id")
      .in("lead_id", ownedIds);

    if (conversationLookupError) return { ok: false, message: conversationLookupError.message };
    const conversationIds = (linkedConversations ?? []).map((row) => row.id as string);

    // Delete dependencies explicitly (safe regardless of whether CASCADE is set)
    await admin.from("custom_field_values").delete().in("lead_id", ownedIds);
    await admin.from("lead_tags").delete().in("lead_id", ownedIds);
    await admin.from("lead_notes").delete().in("lead_id", ownedIds);
    await admin.from("lead_events").delete().in("lead_id", ownedIds);
    await admin.from("lead_tasks").delete().in("lead_id", ownedIds);

    if (conversationIds.length > 0) {
      await admin.from("messages").delete().in("conversation_id", conversationIds);
      await admin.from("conversations").delete().in("id", conversationIds);
    }

    const { error } = await admin.from("leads").delete().in("id", ownedIds);
    if (error) return { ok: false, message: error.message };

    revalidatePath("/leads");
    revalidatePath("/dashboard");
    revalidatePath("/inbox");
    return { ok: true, message: `${ownedIds.length} lead(s) apagado(s) com sucesso.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao apagar leads." };
  }
}

export async function updateLeadsBulkAction(
  leadIds: string[],
  updates: {
    stage_id?: string;
    source_id?: string;
    tagsToAdd?: string[];
    tagsToRemove?: string[];
  }
): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getCurrentContext();

    if (!leadIds.length) return { ok: false, message: "Nenhum lead selecionado." };
    if (leadIds.length > 500) return { ok: false, message: "Maximo de 500 leads por operacao." };

    // Confirm all IDs belong to the active org
    const { data: owned, error: checkError } = await admin
      .from("leads")
      .select("id")
      .eq("organization_id", organizationId)
      .in("id", leadIds);

    if (checkError) return { ok: false, message: checkError.message };

    const ownedIds = (owned ?? []).map((row) => row.id as string);
    if (ownedIds.length !== leadIds.length) {
      return { ok: false, message: "Alguns leads nao pertencem a esta clinica." };
    }

    const leadUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.stage_id !== undefined) {
      const stageId = updates.stage_id || null;
      leadUpdates.stage_id = stageId;
      leadUpdates.status = await getStatusForStage(admin, stageId);
    }
    if (updates.source_id !== undefined) {
      leadUpdates.source_id = updates.source_id || null;
    }

    if (Object.keys(leadUpdates).length > 1) {
      const { error } = await admin
        .from("leads")
        .update(leadUpdates)
        .in("id", ownedIds)
        .eq("organization_id", organizationId);
      if (error) return { ok: false, message: error.message };
    }

    if (updates.tagsToAdd?.length) {
      const tagRows = ownedIds.flatMap((leadId) =>
        updates.tagsToAdd!.map((tagId) => ({ lead_id: leadId, tag_id: tagId }))
      );
      await admin
        .from("lead_tags")
        .upsert(tagRows, { onConflict: "lead_id,tag_id", ignoreDuplicates: true });
    }

    if (updates.tagsToRemove?.length) {
      for (const tagId of updates.tagsToRemove) {
        await admin.from("lead_tags").delete().in("lead_id", ownedIds).eq("tag_id", tagId);
      }
    }

    revalidatePath("/leads");
    revalidatePath("/dashboard");
    return { ok: true, message: `${ownedIds.length} lead(s) atualizado(s) com sucesso.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar leads." };
  }
}
