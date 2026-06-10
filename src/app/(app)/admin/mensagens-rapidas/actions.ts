"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAccessRoute } from "@/lib/permissions";
import { getOrganizationContext } from "@/lib/organization-context";
import {
  normalizeQuickMessageShortcut,
  QUICK_MESSAGE_TYPES,
  validateQuickMessageVariables,
} from "@/lib/quick-messages";

type ActionResult = { ok: boolean; message: string };

const quickMessageSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2).max(100),
  shortcut: z.string().trim().min(2).max(50),
  message_type: z.enum(QUICK_MESSAGE_TYPES),
  content: z.string().max(4000).nullable().optional(),
  media_url: z.string().max(1000).nullable().optional(),
  media_mimetype: z.string().max(150).nullable().optional(),
  media_filename: z.string().max(250).nullable().optional(),
  media_duration: z.number().int().min(0).max(3600).nullable().optional(),
  media_ptt: z.boolean().nullable().optional(),
});

async function getQuickMessageContext() {
  const context = await getOrganizationContext();
  if (!canAccessRoute(context.role, "/admin/mensagens-rapidas")) {
    throw new Error("Sem permissao para gerenciar mensagens rapidas.");
  }
  return context;
}

async function auditQuickMessage(
  context: Awaited<ReturnType<typeof getQuickMessageContext>>,
  action: string,
  resourceId: string | null,
  metadata?: Record<string, unknown>
) {
  try {
    await context.admin.from("audit_logs").insert({
      organization_id: context.organizationId,
      actor_id: context.user.id,
      action,
      resource_type: "quick_message",
      resource_id: resourceId,
      metadata: metadata ?? null,
    });
  } catch {
    // Audit logging must not prevent the primary operation.
  }
}

function validatePayload(
  organizationId: string,
  payload: z.infer<typeof quickMessageSchema>
): string | null {
  const content = payload.content?.trim() || null;
  const invalidVariables = validateQuickMessageVariables(content);
  if (invalidVariables.length > 0) {
    return `Variaveis invalidas: ${invalidVariables.map((item) => `{{${item}}}`).join(", ")}.`;
  }

  if (payload.message_type === "text" && !content) {
    return "A mensagem de texto nao pode ficar vazia.";
  }
  if (payload.message_type !== "text") {
    if (!payload.media_url) return "Selecione ou grave um arquivo antes de salvar.";
    const expectedPrefix = `supabase://media/${organizationId}/quick-messages/`;
    if (!payload.media_url.startsWith(expectedPrefix)) {
      return "O arquivo informado nao pertence a esta organizacao.";
    }
  }
  return null;
}

export async function saveQuickMessageAction(input: unknown): Promise<ActionResult> {
  try {
    const context = await getQuickMessageContext();
    const parsed = quickMessageSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados invalidos." };
    }

    const shortcut = normalizeQuickMessageShortcut(parsed.data.shortcut);
    if (shortcut.length < 2) return { ok: false, message: "Informe um atalho com pelo menos 2 caracteres." };

    const validationError = validatePayload(context.organizationId, parsed.data);
    if (validationError) return { ok: false, message: validationError };

    const row = {
      organization_id: context.organizationId,
      title: parsed.data.title.trim(),
      shortcut,
      message_type: parsed.data.message_type,
      content: parsed.data.content?.trim() || null,
      media_url: parsed.data.message_type === "text" ? null : parsed.data.media_url ?? null,
      media_mimetype: parsed.data.message_type === "text" ? null : parsed.data.media_mimetype ?? null,
      media_filename: parsed.data.message_type === "text" ? null : parsed.data.media_filename ?? null,
      media_duration: parsed.data.message_type === "text" ? null : parsed.data.media_duration ?? null,
      media_ptt: parsed.data.message_type === "audio" ? parsed.data.media_ptt === true : null,
      updated_by: context.user.id,
    };

    const result = parsed.data.id
      ? await context.admin
          .from("quick_messages")
          .update(row)
          .eq("id", parsed.data.id)
          .eq("organization_id", context.organizationId)
          .is("deleted_at", null)
          .select("id")
          .maybeSingle()
      : await context.admin.from("quick_messages").insert({ ...row, created_by: context.user.id }).select("id").single();

    if (result.error) {
      if (result.error.code === "23505") return { ok: false, message: "Este atalho ja esta sendo usado." };
      return { ok: false, message: result.error.message };
    }

    const resourceId = result.data?.id ?? parsed.data.id ?? null;
    await auditQuickMessage(context, parsed.data.id ? "update_quick_message" : "create_quick_message", resourceId, {
      title: row.title,
      shortcut,
      message_type: row.message_type,
    });
    revalidatePath("/admin/mensagens-rapidas");
    revalidatePath("/inbox");
    return { ok: true, message: parsed.data.id ? "Mensagem rapida atualizada." : "Mensagem rapida criada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao salvar mensagem rapida." };
  }
}

export async function toggleQuickMessageAction(id: string, active: boolean): Promise<ActionResult> {
  try {
    const context = await getQuickMessageContext();
    const { error } = await context.admin
      .from("quick_messages")
      .update({ active, updated_by: context.user.id })
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .is("deleted_at", null);
    if (error) return { ok: false, message: error.message };
    await auditQuickMessage(context, active ? "activate_quick_message" : "deactivate_quick_message", id);
    revalidatePath("/admin/mensagens-rapidas");
    revalidatePath("/inbox");
    return { ok: true, message: active ? "Mensagem ativada." : "Mensagem desativada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao alterar mensagem." };
  }
}

export async function deleteQuickMessageAction(id: string): Promise<ActionResult> {
  try {
    const context = await getQuickMessageContext();
    const { error } = await context.admin
      .from("quick_messages")
      .update({ active: false, deleted_at: new Date().toISOString(), updated_by: context.user.id })
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .is("deleted_at", null);
    if (error) return { ok: false, message: error.message };
    await auditQuickMessage(context, "delete_quick_message", id);
    revalidatePath("/admin/mensagens-rapidas");
    revalidatePath("/inbox");
    return { ok: true, message: "Mensagem rapida removida." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao remover mensagem." };
  }
}
