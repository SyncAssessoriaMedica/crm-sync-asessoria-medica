"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { canManageActiveOrganization, getOrganizationContext } from "@/lib/organization-context";
import { slugify } from "@/lib/utils";

type ActionResult = { ok: true; message: string; data?: unknown } | { ok: false; message: string };

const roles = ["super_admin", "gestor_sync", "admin_clinica", "atendente", "leitura"] as const;
const fieldTypes = ["text", "number", "date", "select", "multiselect", "boolean", "url"] as const;

async function getContext() {
  const context = await getOrganizationContext();
  const canManage = canManageActiveOrganization(context);
  if (!canManage) throw new Error("Sem permissao para administrar esta organizacao.");

  return {
    admin: context.admin,
    user: context.user,
    organizationId: context.organizationId,
    isSyncAdmin: context.isSyncAdmin,
  };
}

function asText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

async function getOrCreateDefaultPipeline(admin: ReturnType<typeof createAdminClient>, organizationId: string) {
  const { data: existing, error } = await admin
    .from("pipelines")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_default", true)
    .maybeSingle();

  if (error) throw error;
  if (existing?.id) return existing.id as string;

  const { data, error: insertError } = await admin
    .from("pipelines")
    .insert({ organization_id: organizationId, name: "Funil principal", is_default: true })
    .select("id")
    .single();

  if (insertError) throw insertError;
  return data.id as string;
}

export async function createOrganizationAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, isSyncAdmin } = await getContext();
    if (!isSyncAdmin) return { ok: false, message: "Apenas admin Sync pode criar clinicas." };
    const name = asText(formData.get("name"));
    const slug = asText(formData.get("slug")) || slugify(name);
    if (name.length < 2) return { ok: false, message: "Informe o nome da clinica." };
    const { error } = await admin.from("organizations").insert({ name, slug, subscription_status: "trial" });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    return { ok: true, message: "Clinica criada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao criar clinica." };
  }
}

export async function createUserAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId, isSyncAdmin } = await getContext();
    const parsed = z
      .object({
        email: z.string().email(),
        full_name: z.string().trim().min(2),
        role: z.enum(roles),
        organization_id: z.string().uuid().optional().or(z.literal("")),
      })
      .safeParse({
        email: formData.get("email"),
        full_name: formData.get("full_name"),
        role: formData.get("role"),
        organization_id: formData.get("organization_id"),
      });
    if (!parsed.success) return { ok: false, message: "Dados de usuario invalidos." };
    if (!isSyncAdmin && (parsed.data.role === "super_admin" || parsed.data.role === "gestor_sync")) {
      return { ok: false, message: "Sem permissao para criar usuario com este perfil." };
    }
    const targetOrg = isSyncAdmin && parsed.data.organization_id ? parsed.data.organization_id : organizationId;
    const password = asText(formData.get("password")) || `Sync@${Math.floor(100000 + Math.random() * 900000)}`;
    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email: parsed.data.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: parsed.data.full_name },
    });
    if (authError) return { ok: false, message: authError.message };
    const userId = authUser.user.id;
    await admin.from("profiles").upsert({
      id: userId,
      email: parsed.data.email,
      full_name: parsed.data.full_name,
      role: parsed.data.role,
    });
    const { error } = await admin.from("organization_members").upsert({
      organization_id: targetOrg,
      user_id: userId,
      role: parsed.data.role,
    });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    return { ok: true, message: `Usuario criado. Senha temporaria: ${password}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao criar usuario." };
  }
}

export async function createSourceAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const name = asText(formData.get("name"));
    if (name.length < 2) return { ok: false, message: "Informe uma origem." };
    const { error } = await admin.from("lead_sources").insert({ organization_id: organizationId, name, color: "#22c55e" });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    return { ok: true, message: "Origem criada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao criar origem." };
  }
}

export async function createTagAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const name = asText(formData.get("name"));
    const color = asText(formData.get("color")) || "#22c55e";
    if (name.length < 2) return { ok: false, message: "Informe uma tag." };
    const { error } = await admin.from("tags").insert({ organization_id: organizationId, name, color });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    return { ok: true, message: "Tag criada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao criar tag." };
  }
}

export async function createPipelineStageAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const name = asText(formData.get("name"));
    const color = asText(formData.get("color")) || "#22c55e";
    const orderValue = Number(formData.get("order") ?? 0);
    if (name.length < 2) return { ok: false, message: "Informe o nome da etapa." };

    const pipelineId = await getOrCreateDefaultPipeline(admin, organizationId);
    const { data: lastStage } = await admin
      .from("pipeline_stages")
      .select("order")
      .eq("pipeline_id", pipelineId)
      .order("order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const stageOrder = Number.isFinite(orderValue) && orderValue > 0 ? orderValue : Number(lastStage?.order ?? 0) + 1;
    const { error } = await admin.from("pipeline_stages").insert({
      pipeline_id: pipelineId,
      name,
      color,
      order: stageOrder,
    });

    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    revalidatePath("/leads");
    revalidatePath("/dashboard");
    return { ok: true, message: "Etapa criada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao criar etapa." };
  }
}

export async function updatePipelineStageAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const id = asText(formData.get("id"));
    const name = asText(formData.get("name"));
    const color = asText(formData.get("color")) || "#22c55e";
    const order = Number(formData.get("order") ?? 0);
    if (!id) return { ok: false, message: "Etapa nao encontrada." };
    if (name.length < 2) return { ok: false, message: "Informe o nome da etapa." };

    const pipelineId = await getOrCreateDefaultPipeline(admin, organizationId);
    const { error } = await admin
      .from("pipeline_stages")
      .update({ name, color, order: Number.isFinite(order) && order > 0 ? order : 1 })
      .eq("id", id)
      .eq("pipeline_id", pipelineId);

    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    revalidatePath("/leads");
    revalidatePath("/dashboard");
    return { ok: true, message: "Etapa atualizada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar etapa." };
  }
}

export async function movePipelineStageAction(stageId: string, direction: "up" | "down"): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const pipelineId = await getOrCreateDefaultPipeline(admin, organizationId);
    const { data: stages, error } = await admin
      .from("pipeline_stages")
      .select("id, order")
      .eq("pipeline_id", pipelineId)
      .order("order", { ascending: true });

    if (error) return { ok: false, message: error.message };
    const index = (stages ?? []).findIndex((stage) => stage.id === stageId);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapIndex < 0 || swapIndex >= (stages ?? []).length) {
      return { ok: false, message: "Nao ha etapa para trocar de posicao." };
    }

    const current = stages![index];
    const target = stages![swapIndex];
    const first = admin.from("pipeline_stages").update({ order: target.order }).eq("id", current.id);
    const second = admin.from("pipeline_stages").update({ order: current.order }).eq("id", target.id);
    const [firstResult, secondResult] = await Promise.all([first, second]);
    const swapError = firstResult.error ?? secondResult.error;
    if (swapError) return { ok: false, message: swapError.message };

    revalidatePath("/admin");
    revalidatePath("/leads");
    revalidatePath("/dashboard");
    return { ok: true, message: "Ordem atualizada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao reordenar etapa." };
  }
}

export async function deletePipelineStageAction(stageId: string): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const pipelineId = await getOrCreateDefaultPipeline(admin, organizationId);
    const { error } = await admin
      .from("pipeline_stages")
      .delete()
      .eq("id", stageId)
      .eq("pipeline_id", pipelineId);

    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    revalidatePath("/leads");
    revalidatePath("/dashboard");
    return { ok: true, message: "Etapa removida." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao remover etapa." };
  }
}

export async function createCustomFieldAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const parsed = z
      .object({
        name: z.string().trim().min(2),
        key: z.string().trim().optional(),
        field_type: z.enum(fieldTypes),
        required: z.boolean(),
        options: z.string().optional(),
      })
      .safeParse({
        name: formData.get("name"),
        key: formData.get("key") || undefined,
        field_type: formData.get("field_type") || "text",
        required: formData.get("required") === "on",
        options: formData.get("options") || "",
      });
    if (!parsed.success) return { ok: false, message: "Campo customizado invalido." };
    const options = parsed.data.options
      ? parsed.data.options.split(",").map((item) => item.trim()).filter(Boolean)
      : null;
    const { error } = await admin.from("custom_fields").insert({
      organization_id: organizationId,
      name: parsed.data.name,
      key: parsed.data.key ? slugify(parsed.data.key).replace(/-/g, "_") : slugify(parsed.data.name).replace(/-/g, "_"),
      field_type: parsed.data.field_type,
      required: parsed.data.required,
      options,
    });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    revalidatePath("/leads");
    return { ok: true, message: "Campo customizado criado." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao criar campo." };
  }
}

export async function createWhatsappInstanceAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId, isSyncAdmin } = await getContext();
    const instanceName = asText(formData.get("instance_name"));
    const phone = asText(formData.get("phone_number")).replace(/\D/g, "");
    const targetOrgId = isSyncAdmin ? (asText(formData.get("organization_id")) || organizationId) : organizationId;
    if (instanceName.length < 2) return { ok: false, message: "Informe o nome da instancia." };
    const { error } = await admin.from("whatsapp_instances").insert({
      organization_id: targetOrgId,
      instance_name: instanceName,
      phone_number: phone || null,
      status: "disconnected",
    });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    return { ok: true, message: "Numero cadastrado." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao cadastrar WhatsApp." };
  }
}

export async function connectWhatsappInstanceAction(instanceName: string): Promise<ActionResult> {
  try {
    const { admin, organizationId, isSyncAdmin } = await getContext();
    const baseUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    if (!baseUrl || !apiKey) {
      return {
        ok: false,
        message: "A conexao WhatsApp ainda nao esta disponivel neste deploy. Confirme EVOLUTION_API_URL e EVOLUTION_API_KEY no projeto da Vercel e faca um novo deploy.",
      };
    }

    const { data: instance } = await admin
      .from("whatsapp_instances")
      .select("id, organization_id, instance_name")
      .eq("instance_name", instanceName)
      .maybeSingle();

    if (!instance?.id) return { ok: false, message: "Instancia nao encontrada no CRM." };
    if (!isSyncAdmin && instance.organization_id !== organizationId) {
      return { ok: false, message: "Sem permissao para conectar esta instancia." };
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
    if (!appUrl) {
      return {
        ok: false,
        message: "Configure NEXT_PUBLIC_APP_URL no projeto da Vercel para gerar o webhook automaticamente.",
      };
    }

    const webhookResponse = await fetch(`${baseUrl.replace(/\/$/, "")}/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
      },
      body: JSON.stringify({
        enabled: true,
        url: `${appUrl}/api/webhooks/evolution`,
        webhookByEvents: false,
        webhookBase64: false,
        events: ["MESSAGES_UPSERT", "SEND_MESSAGE", "CONNECTION_UPDATE", "QRCODE_UPDATED", "MESSAGES_UPDATE"],
      }),
      cache: "no-store",
    });

    if (!webhookResponse.ok) {
      const data = await webhookResponse.json().catch(() => ({}));
      return { ok: false, message: data?.message ?? "Nao foi possivel configurar o webhook na Evolution." };
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/instance/connect/${encodeURIComponent(instanceName)}`, {
      headers: { apikey: apiKey },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, message: data?.message ?? "Evolution nao retornou QR Code." };

    const rawQr = data?.base64 ?? data?.qrcode ?? data?.qrCode ?? data?.code;
    let qrCodeDataUrl: string | null = null;
    if (typeof rawQr === "string" && rawQr.startsWith("data:image")) {
      qrCodeDataUrl = rawQr;
    } else if (typeof rawQr === "string" && rawQr.match(/^[A-Za-z0-9+/=]+$/) && rawQr.length > 200) {
      qrCodeDataUrl = `data:image/png;base64,${rawQr}`;
    } else if (typeof data?.code === "string" && data.code.length > 0) {
      qrCodeDataUrl = await QRCode.toDataURL(data.code, { margin: 1, width: 320 });
    }

    await admin
      .from("whatsapp_instances")
      .update({ status: "connecting" })
      .eq("id", instance.id);
    revalidatePath("/admin");
    return {
      ok: true,
      message: qrCodeDataUrl ? "QR Code gerado no CRM." : "Conexao iniciada, mas a Evolution nao retornou imagem de QR Code.",
      data: {
        qrCodeDataUrl,
        pairingCode: data?.pairingCode ?? null,
        count: data?.count ?? null,
        instanceName,
      },
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao conectar WhatsApp." };
  }
}

export async function createInboundWebhookAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const name = asText(formData.get("name")) || "Nova integracao";
    const token = crypto.randomUUID().replace(/-/g, "");
    await admin.from("webhook_events").insert({
      organization_id: organizationId,
      source: "inbound_webhook_config",
      event_type: "config.created",
      payload: {
        token,
        name,
        active: true,
        mappings: {
          name: "",
          phone: "",
          email: "",
          source: "",
          procedure: "",
          potential_value: "",
          custom: {},
        },
      },
      processed: true,
    });
    revalidatePath("/admin");
    return { ok: true, message: "Webhook criado. Copie a URL e envie um teste pela ferramenta externa." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao criar webhook." };
  }
}

export async function updateInboundWebhookAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const token = asText(formData.get("token"));
    const name = asText(formData.get("name")) || "Webhook";
    if (!token) return { ok: false, message: "Webhook nao encontrado." };

    let custom: Record<string, string> = {};
    const rawCustom = asText(formData.get("custom_mappings"));
    if (rawCustom) {
      try {
        custom = JSON.parse(rawCustom) as Record<string, string>;
      } catch {
        return { ok: false, message: "Campos customizados precisam estar em JSON valido." };
      }
    }

    await admin.from("webhook_events").insert({
      organization_id: organizationId,
      source: "inbound_webhook_config",
      event_type: "config.updated",
      payload: {
        token,
        name,
        active: formData.get("active") !== "off",
        mappings: {
          name: asText(formData.get("name_path")),
          phone: asText(formData.get("phone_path")),
          email: asText(formData.get("email_path")),
          source: asText(formData.get("source_path")),
          procedure: asText(formData.get("procedure_path")),
          potential_value: asText(formData.get("potential_value_path")),
          custom,
        },
      },
      processed: true,
    });
    revalidatePath("/admin");
    return { ok: true, message: "Mapeamento salvo." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao salvar webhook." };
  }
}

// ─── User management ────────────────────────────────────────────────────────

export async function updateUserAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId, isSyncAdmin } = await getContext();
    const userId = asText(formData.get("user_id"));
    const fullName = asText(formData.get("full_name"));
    const role = asText(formData.get("role")) as typeof roles[number];
    const targetOrgId = isSyncAdmin ? (asText(formData.get("organization_id")) || organizationId) : organizationId;

    if (!userId) return { ok: false, message: "Usuario nao identificado." };
    if (!roles.includes(role)) return { ok: false, message: "Perfil invalido." };
    if (!isSyncAdmin && (role === "super_admin" || role === "gestor_sync")) {
      return { ok: false, message: "Sem permissao para atribuir este perfil." };
    }

    const updates: Record<string, unknown> = { role };
    if (fullName.length >= 2) {
      updates.full_name = fullName;
      await admin.auth.admin.updateUserById(userId, { user_metadata: { full_name: fullName } });
    }

    const { data: targetMembership } = await admin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const userCurrentOrgId = (targetMembership?.organization_id as string | undefined) ?? organizationId;

    if (!isSyncAdmin && userCurrentOrgId !== organizationId) {
      return { ok: false, message: "Sem permissao para editar este usuario." };
    }

    await admin.from("profiles").update(updates).eq("id", userId);
    await admin.from("organization_members")
      .update({ role, organization_id: targetOrgId })
      .eq("user_id", userId)
      .eq("organization_id", userCurrentOrgId);

    revalidatePath("/admin");
    return { ok: true, message: "Usuario atualizado." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar usuario." };
  }
}

export async function generatePasswordAction(userId: string): Promise<ActionResult> {
  try {
    const { admin } = await getContext();
    const password = `Sync@${Math.floor(100000 + Math.random() * 900000)}`;
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: `Nova senha gerada: ${password}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao gerar senha." };
  }
}

export async function toggleUserBanAction(userId: string, ban: boolean): Promise<ActionResult> {
  try {
    const { admin, isSyncAdmin } = await getContext();
    if (!isSyncAdmin) return { ok: false, message: "Apenas admin Sync pode desativar usuarios." };
    const { error } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: ban ? "876600h" : "none",
    });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    return { ok: true, message: ban ? "Usuario desativado." : "Usuario reativado." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao alterar status do usuario." };
  }
}

// ─── Tag management ──────────────────────────────────────────────────────────

export async function updateTagAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const id = asText(formData.get("id"));
    const name = asText(formData.get("name"));
    const color = asText(formData.get("color")) || "#22c55e";
    if (!id) return { ok: false, message: "Tag nao encontrada." };
    if (name.length < 2) return { ok: false, message: "Informe o nome da tag." };
    const { error } = await admin.from("tags").update({ name, color }).eq("id", id).eq("organization_id", organizationId);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    revalidatePath("/leads");
    return { ok: true, message: "Tag atualizada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar tag." };
  }
}

export async function deleteTagAction(tagId: string): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const { error } = await admin.from("tags").delete().eq("id", tagId).eq("organization_id", organizationId);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    revalidatePath("/leads");
    return { ok: true, message: "Tag removida." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao remover tag." };
  }
}

// ─── Source management ───────────────────────────────────────────────────────

export async function updateSourceAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const id = asText(formData.get("id"));
    const name = asText(formData.get("name"));
    const color = asText(formData.get("color")) || "#22c55e";
    if (!id) return { ok: false, message: "Origem nao encontrada." };
    if (name.length < 2) return { ok: false, message: "Informe o nome da origem." };
    const { error } = await admin.from("lead_sources").update({ name, color }).eq("id", id).eq("organization_id", organizationId);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    revalidatePath("/leads");
    return { ok: true, message: "Origem atualizada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar origem." };
  }
}

export async function deleteSourceAction(sourceId: string): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const { count } = await admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("source_id", sourceId)
      .eq("organization_id", organizationId);

    if ((count ?? 0) > 0) {
      return { ok: false, message: `Esta origem esta em uso por ${count} lead(s). Remova a origem dos leads antes de apagar.` };
    }

    const { error } = await admin.from("lead_sources").delete().eq("id", sourceId).eq("organization_id", organizationId);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    revalidatePath("/leads");
    return { ok: true, message: "Origem removida." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao remover origem." };
  }
}

// ─── Custom field management ─────────────────────────────────────────────────

export async function updateCustomFieldAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const id = asText(formData.get("id"));
    const name = asText(formData.get("name"));
    const fieldType = asText(formData.get("field_type")) as typeof fieldTypes[number];
    const required = formData.get("required") === "on";
    const optionsRaw = asText(formData.get("options"));
    if (!id) return { ok: false, message: "Campo nao encontrado." };
    if (name.length < 2) return { ok: false, message: "Informe o nome do campo." };
    if (!fieldTypes.includes(fieldType)) return { ok: false, message: "Tipo invalido." };
    const options = optionsRaw ? optionsRaw.split(",").map((item) => item.trim()).filter(Boolean) : null;
    const { error } = await admin.from("custom_fields")
      .update({ name, field_type: fieldType, required, options })
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    revalidatePath("/leads");
    return { ok: true, message: "Campo atualizado." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar campo." };
  }
}

export async function deleteCustomFieldAction(fieldId: string): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const { error } = await admin.from("custom_fields").delete().eq("id", fieldId).eq("organization_id", organizationId);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    revalidatePath("/leads");
    return { ok: true, message: "Campo removido." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao remover campo." };
  }
}

export async function deactivateInboundWebhookAction(token: string): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const { data: config } = await admin
      .from("webhook_events")
      .select("payload")
      .eq("organization_id", organizationId)
      .eq("source", "inbound_webhook_config")
      .filter("payload->>token", "eq", token)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = (config?.payload ?? {}) as Record<string, unknown>;
    await admin.from("webhook_events").insert({
      organization_id: organizationId,
      source: "inbound_webhook_config",
      event_type: "config.disabled",
      payload: { ...payload, token, active: false },
      processed: true,
    });
    revalidatePath("/admin");
    return { ok: true, message: "Webhook desativado." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao desativar webhook." };
  }
}
