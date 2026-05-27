"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManageActiveOrganization, getOrganizationContext } from "@/lib/organization-context";

type ActionResult = { ok: true; message: string; data?: unknown } | { ok: false; message: string };

async function getContext() {
  const context = await getOrganizationContext();
  const canManage = canManageActiveOrganization(context);
  if (!canManage) throw new Error("Sem permissao para administrar esta organizacao.");
  return {
    admin: context.admin,
    organizationId: context.organizationId,
  };
}

// ─── Settings ─────────────────────────────────────────────────────────────────

const settingsSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().min(1).max(100),
});

export async function saveFollowupSettingsAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();

    const parsed = settingsSchema.safeParse({
      enabled: formData.get("enabled") === "true",
      timezone: formData.get("timezone") ?? "America/Sao_Paulo",
    });
    if (!parsed.success) return { ok: false, message: "Dados invalidos." };

    const { error } = await admin
      .from("followup_settings")
      .upsert({ organization_id: organizationId, ...parsed.data }, { onConflict: "organization_id" });

    if (error) throw error;
    revalidatePath("/follow-up");
    return { ok: true, message: parsed.data.enabled ? "Follow-up ativado." : "Follow-up desativado." };
  } catch (err) {
    console.error("saveFollowupSettingsAction:", err);
    return { ok: false, message: "Erro ao salvar configuracoes." };
  }
}

// ─── Steps ────────────────────────────────────────────────────────────────────

const textStepSchema = z.object({
  step_order: z.coerce.number().int().min(1),
  delay_days: z.coerce.number().int().min(1).max(365),
  message_type: z.literal("text"),
  message_template: z.string().min(1, "Mensagem e obrigatoria para passos de texto.").max(4096),
  media_url: z.null().optional(),
  media_mimetype: z.null().optional(),
  media_filename: z.null().optional(),
});

const mediaStepSchema = z.object({
  step_order: z.coerce.number().int().min(1),
  delay_days: z.coerce.number().int().min(1).max(365),
  message_type: z.enum(["audio", "image"]),
  message_template: z.string().max(1000).optional().default(""),
  media_url: z.string().min(1, "URL da midia e obrigatoria."),
  media_mimetype: z.string().min(1).max(128).optional(),
  media_filename: z.string().max(255).optional(),
});

function parseStepFormData(formData: FormData) {
  const raw = {
    step_order: formData.get("step_order"),
    delay_days: formData.get("delay_days"),
    message_type: formData.get("message_type") ?? "text",
    message_template: formData.get("message_template") ?? "",
    media_url: formData.get("media_url") ?? undefined,
    media_mimetype: formData.get("media_mimetype") ?? undefined,
    media_filename: formData.get("media_filename") ?? undefined,
  };

  if (raw.message_type === "text") {
    return textStepSchema.safeParse({ ...raw, media_url: null });
  }
  return mediaStepSchema.safeParse(raw);
}

export async function upsertFollowupStepAction(
  stepId: string | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();

    const parsed = parseStepFormData(formData);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Dados invalidos.";
      return { ok: false, message: msg };
    }

    const payload = {
      step_order:       parsed.data.step_order,
      delay_days:       parsed.data.delay_days,
      message_type:     parsed.data.message_type,
      message_template: parsed.data.message_type === "text" ? parsed.data.message_template : (parsed.data.message_template ?? ""),
      media_url:        parsed.data.message_type !== "text" ? parsed.data.media_url : null,
      media_mimetype:   parsed.data.message_type !== "text" ? (parsed.data.media_mimetype ?? null) : null,
      media_filename:   parsed.data.message_type !== "text" ? (parsed.data.media_filename ?? null) : null,
    };

    if (stepId) {
      const { error } = await admin
        .from("followup_steps")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", stepId)
        .eq("organization_id", organizationId);
      if (error) throw error;
    } else {
      const { error } = await admin
        .from("followup_steps")
        .insert({ organization_id: organizationId, ...payload });
      if (error) {
        if (error.code === "23505") return { ok: false, message: "Ja existe um passo com essa ordem." };
        throw error;
      }
    }

    revalidatePath("/follow-up");
    return { ok: true, message: "Passo salvo com sucesso." };
  } catch (err) {
    console.error("upsertFollowupStepAction:", err);
    return { ok: false, message: "Erro ao salvar passo." };
  }
}

export async function deleteFollowupStepAction(stepId: string): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();

    const { error } = await admin
      .from("followup_steps")
      .delete()
      .eq("id", stepId)
      .eq("organization_id", organizationId);

    if (error) throw error;
    revalidatePath("/follow-up");
    return { ok: true, message: "Passo removido." };
  } catch (err) {
    console.error("deleteFollowupStepAction:", err);
    return { ok: false, message: "Erro ao remover passo." };
  }
}

// ─── Blocked Stages ───────────────────────────────────────────────────────────

export async function toggleBlockedStageAction(stageId: string, block: boolean): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();

    if (block) {
      const { error } = await admin
        .from("followup_blocked_stages")
        .upsert({ organization_id: organizationId, stage_id: stageId }, { onConflict: "organization_id,stage_id" });
      if (error) throw error;
    } else {
      const { error } = await admin
        .from("followup_blocked_stages")
        .delete()
        .eq("organization_id", organizationId)
        .eq("stage_id", stageId);
      if (error) throw error;
    }

    revalidatePath("/follow-up");
    return { ok: true, message: block ? "Etapa bloqueada." : "Etapa desbloqueada." };
  } catch (err) {
    console.error("toggleBlockedStageAction:", err);
    return { ok: false, message: "Erro ao atualizar etapa bloqueada." };
  }
}

// ─── Blocked Tags ─────────────────────────────────────────────────────────────

export async function toggleBlockedTagAction(tagId: string, block: boolean): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();

    if (block) {
      const { error } = await admin
        .from("followup_blocked_tags")
        .upsert({ organization_id: organizationId, tag_id: tagId }, { onConflict: "organization_id,tag_id" });
      if (error) throw error;
    } else {
      const { error } = await admin
        .from("followup_blocked_tags")
        .delete()
        .eq("organization_id", organizationId)
        .eq("tag_id", tagId);
      if (error) throw error;
    }

    revalidatePath("/follow-up");
    return { ok: true, message: block ? "Tag bloqueada." : "Tag desbloqueada." };
  } catch (err) {
    console.error("toggleBlockedTagAction:", err);
    return { ok: false, message: "Erro ao atualizar tag bloqueada." };
  }
}

// ─── Lead: pause / resume ─────────────────────────────────────────────────────

export async function toggleLeadFollowupPausedAction(
  leadId: string,
  paused: boolean
): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();

    const { error } = await admin
      .from("leads")
      .update({ followup_paused: paused, updated_at: new Date().toISOString() })
      .eq("id", leadId)
      .eq("organization_id", organizationId);

    if (error) throw error;
    revalidatePath("/leads");
    revalidatePath(`/leads/${leadId}`);
    return {
      ok: true,
      message: paused ? "Follow-up pausado para este lead." : "Follow-up retomado para este lead.",
    };
  } catch (err) {
    console.error("toggleLeadFollowupPausedAction:", err);
    return { ok: false, message: "Erro ao atualizar follow-up do lead." };
  }
}

// ─── Queue: cancel ────────────────────────────────────────────────────────────

export async function cancelQueueItemAction(queueItemId: string): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();

    const { error } = await admin
      .from("followup_queue")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", queueItemId)
      .eq("organization_id", organizationId)
      .in("status", ["pending", "sending"]);

    if (error) throw error;
    revalidatePath("/follow-up");
    return { ok: true, message: "Item da fila cancelado." };
  } catch (err) {
    console.error("cancelQueueItemAction:", err);
    return { ok: false, message: "Erro ao cancelar item." };
  }
}
