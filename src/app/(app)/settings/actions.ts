"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { refreshLeadLocationsForOrg } from "@/lib/lead-location";
import { canManageActiveOrganization, getOrganizationContext } from "@/lib/organization-context";

type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const notificationKeys = [
  "new_lead",
  "lead_without_response",
  "lead_without_followup",
  "appointment_confirmed",
] as const;

const workingDayKeys = ["0", "1", "2", "3", "4", "5", "6"] as const;

function parseLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseServedCities(value: string) {
  return parseLines(value)
    .map((line) => {
      const [cityPart, statePart] = line.split(/[,;-]/).map((part) => part.trim());
      const city = cityPart ?? "";
      const state = (statePart ?? "").toUpperCase().slice(0, 2);
      return city && state ? { city, state, priority: "secondary" as const } : null;
    })
    .filter((item): item is { city: string; state: string; priority: "secondary" } => item !== null);
}

function parseServedStates(value: string) {
  return [...new Set(parseLines(value).flatMap((line) => line.split(/[,;]/)).map((state) => state.trim().toUpperCase().slice(0, 2)).filter(Boolean))];
}

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
        service_area_enabled: z.boolean(),
        primary_city: z.string().trim().max(80).optional(),
        primary_state: z.string().trim().max(2).optional(),
        served_cities: z.string().trim().max(4000).optional(),
        served_states: z.string().trim().max(400).optional(),
        service_area_notes: z.string().trim().max(1000).optional(),
        services: z.string().trim().max(4000).optional(),
      })
      .safeParse({
        name: formData.get("name"),
        cnpj: asText(formData.get("cnpj")) || undefined,
        city: asText(formData.get("city")) || undefined,
        state: asText(formData.get("state")) || undefined,
        scheduling_url: asText(formData.get("scheduling_url")) || undefined,
        service_area_enabled: formData.get("service_area_enabled") === "on",
        primary_city: asText(formData.get("primary_city")) || undefined,
        primary_state: asText(formData.get("primary_state")) || undefined,
        served_cities: asText(formData.get("served_cities")) || undefined,
        served_states: asText(formData.get("served_states")) || undefined,
        service_area_notes: asText(formData.get("service_area_notes")) || undefined,
        services: asText(formData.get("services")) || undefined,
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

    const serviceArea = {
      enabled: parsed.data.service_area_enabled,
      primaryCity: parsed.data.primary_city ?? "",
      primaryState: (parsed.data.primary_state ?? "").toUpperCase(),
      servedCities: parseServedCities(parsed.data.served_cities ?? ""),
      servedStates: parseServedStates(parsed.data.served_states ?? ""),
      notes: parsed.data.service_area_notes ?? "",
    };

    const { error: settingsError } = await admin.from("organization_settings").upsert({
      organization_id: organizationId,
      cnpj: parsed.data.cnpj ?? null,
      city: parsed.data.city ?? null,
      state: parsed.data.state ?? null,
      scheduling_url: parsed.data.scheduling_url ?? null,
      service_area: serviceArea,
    });

    if (settingsError) return { ok: false, message: settingsError.message };

    const nextServices = [...new Set(parseLines(parsed.data.services ?? ""))];
    const { data: currentServices, error: servicesFetchError } = await admin
      .from("clinic_services")
      .select("id, name")
      .eq("organization_id", organizationId);

    if (servicesFetchError) return { ok: false, message: servicesFetchError.message };

    const currentByName = new Map(
      (currentServices ?? []).map((service) => [String(service.name).trim().toLowerCase(), service])
    );
    const nextNames = new Set(nextServices.map((name) => name.toLowerCase()));

    for (const [index, serviceName] of nextServices.entries()) {
      const existing = currentByName.get(serviceName.toLowerCase());
      if (existing?.id) {
        const { error } = await admin
          .from("clinic_services")
          .update({ name: serviceName, active: true, order: index })
          .eq("id", existing.id)
          .eq("organization_id", organizationId);
        if (error) return { ok: false, message: error.message };
      } else {
        const { error } = await admin.from("clinic_services").insert({
          organization_id: organizationId,
          name: serviceName,
          active: true,
          order: index,
        });
        if (error) return { ok: false, message: error.message };
      }
    }

    for (const service of currentServices ?? []) {
      if (!nextNames.has(String(service.name).trim().toLowerCase())) {
        const { error } = await admin
          .from("clinic_services")
          .update({ active: false })
          .eq("id", service.id)
          .eq("organization_id", organizationId);
        if (error) return { ok: false, message: error.message };
      }
    }

    await refreshLeadLocationsForOrg(admin, organizationId, serviceArea);

    revalidatePath("/settings");
    revalidatePath("/dashboard");
    revalidatePath("/leads");
    revalidatePath("/inbox");
    revalidatePath("/kanban");
    revalidatePath("/admin");
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

export async function updateBusinessHoursAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getSettingsContext();
    const startTime = asText(formData.get("start_time"));
    const endTime = asText(formData.get("end_time"));
    const timezone = asText(formData.get("timezone")) || "America/Sao_Paulo";
    const workingDays = workingDayKeys
      .filter((key) => formData.get(`day_${key}`) === "on")
      .map((key) => Number(key));

    const parsed = z
      .object({
        startTime: z.string().regex(/^\d{2}:\d{2}$/, "Informe o horario inicial."),
        endTime: z.string().regex(/^\d{2}:\d{2}$/, "Informe o horario final."),
        timezone: z.string().trim().min(3).max(80),
        workingDays: z.array(z.number().int().min(0).max(6)).min(1, "Selecione ao menos um dia de funcionamento."),
      })
      .safeParse({ startTime, endTime, timezone, workingDays });

    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados invalidos." };
    }

    if (parsed.data.startTime >= parsed.data.endTime) {
      return { ok: false, message: "O horario inicial precisa ser menor que o horario final." };
    }

    const { error } = await admin.from("organization_settings").upsert({
      organization_id: organizationId,
      business_hours: parsed.data,
    });

    if (error) return { ok: false, message: error.message };

    revalidatePath("/settings");
    revalidatePath("/dashboard");
    return { ok: true, message: "Horario de funcionamento salvo." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao salvar horario." };
  }
}
