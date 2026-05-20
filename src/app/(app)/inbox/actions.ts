"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";

async function getCurrentContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: membership, error } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !membership) {
    throw new Error("Usuario sem organizacao configurada.");
  }

  return {
    admin,
    organizationId: membership.organization_id as string,
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
