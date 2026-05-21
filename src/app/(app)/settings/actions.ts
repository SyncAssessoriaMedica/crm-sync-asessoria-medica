"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManageActiveOrganization, getOrganizationContext } from "@/lib/organization-context";

type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const notificationKeys = [
  "new_lead",
  "lead_without_response",
  "lead_without_followup",
  "appointment_confirmed",
] as const;

async function getSettingsContext() {
  const context = await getOrganizationContext();
  const canManage = canManageActiveOrganization(context);

  if (!canManage) throw new Error("Sem permissao para alterar configuracoes.");

  return {
    admin: context.admin,
    organizationId: context.organizationId,
  };
}

function asText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function updateClinicSettingsAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getSettingsContext();
    const parsed = z
      .object({
        name: z.string().trim().min(2, "Informe o nome da clinica."),
        cnpj: z.string().trim().max(32).optional(),
        city: z.string().trim().max(80).optional(),
        state: z.string().trim().max(40).optional(),
        scheduling_url: z.string().trim().max(240).optional(),
      })
      .safeParse({
        name: formData.get("name"),
        cnpj: asText(formData.get("cnpj")) || undefined,
        city: asText(formData.get("city")) || undefined,
        state: asText(formData.get("state")) || undefined,
        scheduling_url: asText(formData.get("scheduling_url")) || undefined,
      });

    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados invalidos." };
    }

    if (parsed.data.scheduling_url && !/^https?:\/\//i.test(parsed.data.scheduling_url)) {
      return { ok: false, message: "Informe um link que comece com http:// ou https://." };
    }

    const { error: orgError } = await admin
      .from("organizations")
      .update({ name: parsed.data.name })
      .eq("id", organizationId);

    if (orgError) return { ok: false, message: orgError.message };

    const { error: settingsError } = await admin.from("organization_settings").upsert({
      organization_id: organizationId,
      cnpj: parsed.data.cnpj ?? null,
      city: parsed.data.city ?? null,
      state: parsed.data.state ?? null,
      scheduling_url: parsed.data.scheduling_url ?? null,
    });

    if (settingsError) return { ok: false, message: settingsError.message };

    revalidatePath("/settings");
    revalidatePath("/dashboard");
    return { ok: true, message: "Dados da clinica salvos." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao salvar dados." };
  }
}

export async function updateNotificationSettingsAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getSettingsContext();
    const notificationPreferences = Object.fromEntries(
      notificationKeys.map((key) => [key, formData.get(key) === "on"])
    );

    const { error } = await admin.from("organization_settings").upsert({
      organization_id: organizationId,
      notification_preferences: notificationPreferences,
    });

    if (error) return { ok: false, message: error.message };

    revalidatePath("/settings");
    revalidatePath("/dashboard");
    return { ok: true, message: "Notificacoes internas atualizadas." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao salvar notificacoes." };
  }
}
