"use server";

import { revalidatePath } from "next/cache";
import { getOrganizationContext } from "@/lib/organization-context";

async function getCurrentContext() {
  const context = await getOrganizationContext();

  return {
    admin: context.admin,
    organizationId: context.organizationId,
  };
}

export async function markConversationReadAction(conversationId: string) {
  try {
    const { admin, organizationId } = await getCurrentContext();
    const { error } = await admin
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .eq("organization_id", organizationId);

    if (error) return { ok: false, message: error.message };
    revalidatePath("/inbox");
    return { ok: true, message: "Conversa marcada como lida." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar conversa." };
  }
}

export async function updateConversationStatusAction(
  conversationId: string,
  status: "open" | "closed" | "archived"
) {
  try {
    const { admin, organizationId } = await getCurrentContext();
    const { error } = await admin
      .from("conversations")
      .update({ status })
      .eq("id", conversationId)
      .eq("organization_id", organizationId);

    if (error) return { ok: false, message: error.message };
    revalidatePath("/inbox");
    return { ok: true, message: status === "closed" ? "Conversa fechada." : "Conversa reaberta." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar conversa." };
  }
}

export async function cancelBhAutoReplyAction(queueItemId: string) {
  try {
    const { admin, organizationId } = await getCurrentContext();
    const { error } = await admin
      .from("bh_auto_reply_queue")
      .update({ status: "cancelled", cancel_reason: "manual_cancel" })
      .eq("id", queueItemId)
      .eq("organization_id", organizationId)
      .eq("status", "pending");

    if (error) return { ok: false, message: error.message };
    revalidatePath("/inbox");
    return { ok: true, message: "Resposta agendada cancelada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao cancelar." };
  }
}
