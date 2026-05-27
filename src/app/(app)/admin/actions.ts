"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { canManageActiveOrganization, getOrganizationContext } from "@/lib/organization-context";
import { createOrUpdateLeadByPhone } from "@/lib/lead-upsert";
import { slugify } from "@/lib/utils";
import { fetchAndStoreWhatsAppMedia } from "@/lib/media-storage";

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

function normalizeEvolutionApiUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    // The Evolution manager UI lives at /manager, but API routes live at the origin.
    if (url.pathname === "/manager" || url.pathname.startsWith("/manager/")) {
      return url.origin;
    }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/manager\/?$/, "").replace(/\/+$/, "");
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEvolutionWebhookSecret() {
  if (process.env.EVOLUTION_WEBHOOK_SECRET) return process.env.EVOLUTION_WEBHOOK_SECRET;
  if (process.env.NODE_ENV !== "production") return process.env.EVOLUTION_API_KEY ?? null;
  return null;
}

async function evolutionFetch(url: string, apiKey: string, init: RequestInit = {}): Promise<Response> {
  const { headers: extra, ...rest } = init;
  return fetch(url, {
    ...rest,
    headers: { apikey: apiKey, ...(extra as Record<string, string> | undefined) },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
}

// ─── Audit log helper ────────────────────────────────────────────────────────

async function insertAuditLog(
  admin: ReturnType<typeof createAdminClient>,
  actorId: string,
  organizationId: string | null,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata?: Record<string, unknown>
) {
  try {
    await admin.from("audit_logs").insert({
      organization_id: organizationId,
      actor_id: actorId,
      action,
      resource_type: resourceType,
      resource_id: resourceId ?? null,
      metadata: metadata ?? null,
    });
  } catch {
    // Audit log failure must never break the primary action.
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function tryConfigureWebhook(
  evolutionApiUrl: string,
  instanceName: string,
  apiKey: string,
  webhookUrl: string,
  publicWebhookUrl: string
): Promise<string | null> {
  const endpoint = `${evolutionApiUrl}/webhook/set/${encodeURIComponent(instanceName)}`;
  const events = ["MESSAGES_UPSERT", "SEND_MESSAGE", "CONNECTION_UPDATE", "QRCODE_UPDATED", "MESSAGES_UPDATE"];

  try {
    // Try nested format (Evolution v2 standard)
    const nestedRes = await evolutionFetch(endpoint, apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events },
      }),
    });
    if (nestedRes.ok) return null;

    // Try flat format (some Evolution v2 deployments)
    const flatRes = await evolutionFetch(endpoint, apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events }),
    });
    if (flatRes.ok) return null;

    const errData = await nestedRes.json().catch(() => ({})) as Record<string, unknown>;
    const msg = (errData?.message ?? errData?.error ?? `HTTP ${nestedRes.status}`) as string;
    return `Webhook nao configurado automaticamente (${msg}). Configure na Evolution usando a URL do CRM: ${publicWebhookUrl}`;
  } catch {
    return `Webhook nao configurado automaticamente (erro de rede). Configure na Evolution usando a URL do CRM: ${publicWebhookUrl}`;
  }
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

export async function deleteOrganizationAction(organizationId: string): Promise<ActionResult> {
  try {
    const { admin, user, isSyncAdmin } = await getContext();
    if (!isSyncAdmin) return { ok: false, message: "Apenas admin Sync pode apagar clinicas." };

    const { data: org, error: fetchError } = await admin
      .from("organizations")
      .select("id, name, slug")
      .eq("id", organizationId)
      .maybeSingle();

    if (fetchError) return { ok: false, message: fetchError.message };
    if (!org?.id) return { ok: false, message: "Clinica nao encontrada." };
    if (org.slug === "sync-marketing") {
      return { ok: false, message: "A clinica Sync Marketing nao pode ser apagada." };
    }

    const { count } = await admin
      .from("organizations")
      .select("id", { count: "exact", head: true });
    if ((count ?? 0) <= 1) {
      return { ok: false, message: "Nao e possivel apagar a unica clinica do sistema." };
    }

    const { error } = await admin.from("organizations").delete().eq("id", organizationId);
    if (error) return { ok: false, message: error.message };

    await insertAuditLog(admin, user.id, null, "delete_organization", "organization", organizationId, {
      name: org.name,
      slug: org.slug,
    });

    revalidatePath("/admin");
    revalidatePath("/dashboard");
    revalidatePath("/leads");
    revalidatePath("/inbox");

    return { ok: true, message: `Clinica "${org.name}" apagada permanentemente.`, data: { organizationId } };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao apagar clinica." };
  }
}

export async function createUserAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, user, organizationId, isSyncAdmin } = await getContext();
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
    await insertAuditLog(admin, user.id, targetOrg, "create_user", "profile", userId, {
      email: parsed.data.email,
      role: parsed.data.role,
    });
    revalidatePath("/admin");
    // Temporary password returned to the admin who created the user.
    // Advise changing it on first login. Never log this value to console or DB.
    return { ok: true, message: `Usuario criado. Senha temporaria: ${password} (oriente o usuario a alterar no primeiro acesso)` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao criar usuario." };
  }
}

const sourceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Informe o nome da origem (minimo 2 caracteres).")
    .max(60, "Nome muito longo (maximo 60 caracteres).")
    .transform((value) => value.replace(/\s+/g, " ")),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Cor invalida. Use formato hexadecimal (#RRGGBB).")
    .default("#22c55e"),
});

export async function createSourceAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, user, organizationId } = await getContext();
    const parsed = sourceSchema.safeParse({
      name: asText(formData.get("name")),
      color: asText(formData.get("color")) || "#22c55e",
    });
    if (!parsed.success) return { ok: false, message: parsed.error.errors[0].message };
    const { name, color } = parsed.data;

    const { data: existing } = await admin
      .from("lead_sources")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("active", true)
      .ilike("name", name)
      .maybeSingle();
    if (existing) return { ok: false, message: `Ja existe uma origem ativa com o nome "${name}".` };

    const { data, error } = await admin
      .from("lead_sources")
      .insert({ organization_id: organizationId, name, color })
      .select("id")
      .single();
    if (error) return { ok: false, message: error.message };
    after(() => insertAuditLog(admin, user.id, organizationId, "create_source", "lead_source", data.id, { name, color }));
    revalidatePath("/admin");
    revalidatePath("/leads");
    revalidatePath("/dashboard");
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
    const { admin, user, organizationId } = await getContext();
    const pipelineId = await getOrCreateDefaultPipeline(admin, organizationId);
    const { error } = await admin
      .from("pipeline_stages")
      .delete()
      .eq("id", stageId)
      .eq("pipeline_id", pipelineId);

    if (error) return { ok: false, message: error.message };
    await insertAuditLog(admin, user.id, organizationId, "delete_pipeline_stage", "pipeline_stage", stageId);
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
    const evolutionApiUrl = normalizeEvolutionApiUrl(baseUrl);

    const { data: instance } = await admin
      .from("whatsapp_instances")
      .select("id, organization_id, instance_name")
      .eq("instance_name", instanceName)
      .is("deleted_at", null)
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

    // Attempt webhook configuration — non-blocking so QR Code still shows on failure.
    // In production, EVOLUTION_WEBHOOK_SECRET is mandatory so the API key is
    // never exposed in webhook URLs or provider logs.
    const webhookSecret = getEvolutionWebhookSecret();
    const missingWebhookSecretWarning = webhookSecret
      ? null
      : "Configure EVOLUTION_WEBHOOK_SECRET na Vercel para registrar o webhook automaticamente.";
    const publicWebhookUrl = `${appUrl}/api/webhooks/evolution`;
    const webhookUrl = webhookSecret ? `${publicWebhookUrl}?token=${encodeURIComponent(webhookSecret)}` : publicWebhookUrl;
    const webhookWarning = webhookSecret
      ? await tryConfigureWebhook(evolutionApiUrl, instanceName, apiKey, webhookUrl, publicWebhookUrl)
      : missingWebhookSecretWarning;

    try {
      const stateResponse = await fetch(`${evolutionApiUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`, {
        headers: { apikey: apiKey },
        cache: "no-store",
      });
      const stateData = await stateResponse.json().catch(() => ({})) as { instance?: { state?: string } };
      if (stateResponse.ok && stateData.instance?.state !== "open") {
        await fetch(`${evolutionApiUrl}/instance/logout/${encodeURIComponent(instanceName)}`, {
          method: "DELETE",
          headers: { apikey: apiKey },
          cache: "no-store",
        }).catch(() => null);
        await wait(600);
      }
    } catch {
      // Se a checagem de estado falhar, seguimos para gerar o QR normalmente.
    }

    const response = await fetch(`${evolutionApiUrl}/instance/connect/${encodeURIComponent(instanceName)}`, {
      headers: { apikey: apiKey },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const evMsg = (data?.message ?? data?.error ?? JSON.stringify(data).slice(0, 200)) as string;
      const hint = response.status === 404
        ? " Verifique se EVOLUTION_API_URL esta sem /manager no final e se o nome da instancia existe na Evolution."
        : "";
      return { ok: false, message: `Evolution ${response.status}: ${evMsg}.${hint}` };
    }

    // Evolution v2 nests QR under data.qrcode; v1 exposes at root
    const qrObj = (data?.qrcode ?? data?.qrCode) as Record<string, unknown> | undefined;
    const rawQr = qrObj?.base64 ?? qrObj?.code ?? data?.base64 ?? data?.code;
    const rawPairing = qrObj?.pairingCode ?? data?.pairingCode;

    let qrCodeDataUrl: string | null = null;
    if (typeof rawQr === "string" && rawQr.startsWith("data:image")) {
      qrCodeDataUrl = rawQr;
    } else if (typeof rawQr === "string" && /^[A-Za-z0-9+/=]+$/.test(rawQr) && rawQr.length > 200) {
      qrCodeDataUrl = `data:image/png;base64,${rawQr}`;
    } else if (typeof rawQr === "string" && rawQr.length > 0) {
      qrCodeDataUrl = await QRCode.toDataURL(rawQr, { margin: 1, width: 320 });
    }

    await admin
      .from("whatsapp_instances")
      .update({ status: "connecting" })
      .eq("id", instance.id);
    revalidatePath("/admin");
    return {
      ok: true,
      message: (qrCodeDataUrl ? "QR Code gerado." : "Conexao iniciada, mas a Evolution nao retornou imagem de QR Code.") + (webhookWarning ? ` ${webhookWarning}` : ""),
      data: {
        qrCodeDataUrl,
        pairingCode: (rawPairing as string | null | undefined) ?? null,
        count: (data?.count as number | null | undefined) ?? null,
        instanceName,
      },
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao conectar WhatsApp." };
  }
}

export async function syncWhatsappInstanceStatusAction(instanceName: string): Promise<ActionResult> {
  try {
    const { admin, organizationId, isSyncAdmin } = await getContext();
    const baseUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    if (!baseUrl || !apiKey) {
      return { ok: false, message: "Evolution API nao configurada neste deploy." };
    }
    const evolutionApiUrl = normalizeEvolutionApiUrl(baseUrl);

    const { data: instance } = await admin
      .from("whatsapp_instances")
      .select("id, organization_id, instance_name")
      .eq("instance_name", instanceName)
      .is("deleted_at", null)
      .maybeSingle();

    if (!instance?.id) return { ok: false, message: "Instancia nao encontrada no CRM." };
    if (!isSyncAdmin && instance.organization_id !== organizationId) {
      return { ok: false, message: "Sem permissao para consultar esta instancia." };
    }

    const response = await fetch(`${evolutionApiUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`, {
      headers: { apikey: apiKey },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({})) as { instance?: { state?: string } };
    if (!response.ok) {
      const msg = JSON.stringify(data).slice(0, 160);
      return { ok: false, message: `Nao foi possivel consultar a Evolution (${response.status}). ${msg}` };
    }

    const state = data.instance?.state ?? "close";
    const status = state === "open" ? "connected" : state === "connecting" ? "connecting" : "disconnected";
    await admin.from("whatsapp_instances").update({ status }).eq("id", instance.id);
    revalidatePath("/admin");

    return {
      ok: true,
      message: status === "connected" ? "WhatsApp conectado com sucesso." : `Status atualizado: ${status}.`,
      data: { status, instanceName },
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao sincronizar WhatsApp." };
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
    const { admin, user, organizationId, isSyncAdmin } = await getContext();
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

    await insertAuditLog(admin, user.id, targetOrgId, "update_user", "profile", userId, { role });
    revalidatePath("/admin");
    return { ok: true, message: "Usuario atualizado." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar usuario." };
  }
}

export async function generatePasswordAction(userId: string): Promise<ActionResult> {
  try {
    const { admin, user, isSyncAdmin } = await getContext();
    // Only sync admins may reset passwords for other users.
    if (!isSyncAdmin) return { ok: false, message: "Apenas admin Sync pode gerar nova senha." };
    const password = `Sync@${Math.floor(100000 + Math.random() * 900000)}`;
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return { ok: false, message: error.message };
    // Audit without logging the password itself.
    await insertAuditLog(admin, user.id, null, "generate_password", "profile", userId, {
      note: "Temporary password generated by sync admin",
    });
    // Password returned to the admin — never stored in DB or console.
    return { ok: true, message: `Nova senha gerada: ${password} (oriente o usuario a alterar no primeiro acesso)` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao gerar senha." };
  }
}

export async function toggleUserBanAction(userId: string, ban: boolean): Promise<ActionResult> {
  try {
    const { admin, user, isSyncAdmin } = await getContext();
    if (!isSyncAdmin) return { ok: false, message: "Apenas admin Sync pode desativar usuarios." };
    const { error } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: ban ? "876600h" : "none",
    });
    if (error) return { ok: false, message: error.message };
    await insertAuditLog(admin, user.id, null, ban ? "ban_user" : "unban_user", "profile", userId);
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
    const { admin, user, organizationId } = await getContext();
    const { error } = await admin.from("tags").delete().eq("id", tagId).eq("organization_id", organizationId);
    if (error) return { ok: false, message: error.message };
    await insertAuditLog(admin, user.id, organizationId, "delete_tag", "tag", tagId);
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
    const { admin, user, organizationId } = await getContext();
    const id = asText(formData.get("id"));
    if (!id) return { ok: false, message: "Origem nao encontrada." };

    const parsed = sourceSchema.safeParse({
      name: asText(formData.get("name")),
      color: asText(formData.get("color")) || "#22c55e",
    });
    if (!parsed.success) return { ok: false, message: parsed.error.errors[0].message };
    const { name, color } = parsed.data;

    const { data: existing } = await admin
      .from("lead_sources")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("active", true)
      .ilike("name", name)
      .neq("id", id)
      .maybeSingle();
    if (existing) return { ok: false, message: `Ja existe outra origem ativa com o nome "${name}".` };

    const { error } = await admin
      .from("lead_sources")
      .update({ name, color })
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (error) return { ok: false, message: error.message };
    after(() => insertAuditLog(admin, user.id, organizationId, "update_source", "lead_source", id, { name, color }));
    revalidatePath("/admin");
    revalidatePath("/leads");
    revalidatePath("/dashboard");
    return { ok: true, message: "Origem atualizada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar origem." };
  }
}

export async function toggleSourceActiveAction(sourceId: string, active: boolean): Promise<ActionResult> {
  try {
    const { admin, user, organizationId } = await getContext();
    const { data: source } = await admin
      .from("lead_sources")
      .select("id, is_default")
      .eq("id", sourceId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!source) return { ok: false, message: "Origem nao encontrada." };
    if (!active && source.is_default) {
      return { ok: false, message: "Origens padrao nao podem ser desativadas." };
    }

    const { error } = await admin
      .from("lead_sources")
      .update({ active })
      .eq("id", sourceId)
      .eq("organization_id", organizationId);
    if (error) return { ok: false, message: error.message };
    after(() => insertAuditLog(admin, user.id, organizationId, active ? "activate_source" : "deactivate_source", "lead_source", sourceId));
    revalidatePath("/admin");
    revalidatePath("/leads");
    revalidatePath("/dashboard");
    return { ok: true, message: active ? "Origem ativada." : "Origem desativada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar origem." };
  }
}

export async function deleteSourceAction(sourceId: string): Promise<ActionResult> {
  try {
    const { admin, user, organizationId } = await getContext();
    const { data: source } = await admin
      .from("lead_sources")
      .select("id, is_default")
      .eq("id", sourceId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!source) return { ok: false, message: "Origem nao encontrada." };
    if (source.is_default) {
      return { ok: false, message: "Origens padrao nao podem ser apagadas." };
    }

    const [{ count: leadCount }, { count: ruleCount }] = await Promise.all([
      admin
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("source_id", sourceId)
        .eq("organization_id", organizationId),
      admin
        .from("lead_source_rules")
        .select("id", { count: "exact", head: true })
        .eq("source_id", sourceId)
        .eq("organization_id", organizationId),
    ]);

    if ((leadCount ?? 0) > 0) {
      return {
        ok: false,
        message: `Nao e possivel apagar: ${leadCount} lead(s) usam esta origem. Desative a origem em vez de apagar.`,
      };
    }
    if ((ruleCount ?? 0) > 0) {
      return {
        ok: false,
        message: `Nao e possivel apagar: ${ruleCount} regra(s) automatica(s) usam esta origem. Remova as regras primeiro.`,
      };
    }

    const { error } = await admin.from("lead_sources").delete().eq("id", sourceId).eq("organization_id", organizationId);
    if (error) return { ok: false, message: error.message };
    after(() => insertAuditLog(admin, user.id, organizationId, "delete_source", "lead_source", sourceId));
    revalidatePath("/admin");
    revalidatePath("/leads");
    revalidatePath("/dashboard");
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
    const { admin, user, organizationId } = await getContext();
    const { error } = await admin.from("custom_fields").delete().eq("id", fieldId).eq("organization_id", organizationId);
    if (error) return { ok: false, message: error.message };
    await insertAuditLog(admin, user.id, organizationId, "delete_custom_field", "custom_field", fieldId);
    revalidatePath("/admin");
    revalidatePath("/leads");
    return { ok: true, message: "Campo removido." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao remover campo." };
  }
}

export async function setWebhookForInstanceAction(instanceName: string): Promise<ActionResult> {
  try {
    const { admin, organizationId, isSyncAdmin } = await getContext();
    const baseUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    if (!baseUrl || !apiKey) {
      return { ok: false, message: "Evolution API nao configurada neste deploy." };
    }
    const evolutionApiUrl = normalizeEvolutionApiUrl(baseUrl);

    const { data: instance } = await admin
      .from("whatsapp_instances")
      .select("id, organization_id")
      .eq("instance_name", instanceName)
      .is("deleted_at", null)
      .maybeSingle();

    if (!instance?.id) return { ok: false, message: "Instancia nao encontrada no CRM." };
    if (!isSyncAdmin && instance.organization_id !== organizationId) {
      return { ok: false, message: "Sem permissao para configurar esta instancia." };
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
    if (!appUrl) {
      return { ok: false, message: "Configure NEXT_PUBLIC_APP_URL no projeto da Vercel." };
    }

    // In production, EVOLUTION_WEBHOOK_SECRET is mandatory so the API key is
    // never exposed in webhook URLs or provider logs.
    const webhookSecret = getEvolutionWebhookSecret();
    if (!webhookSecret) {
      return { ok: false, message: "Configure EVOLUTION_WEBHOOK_SECRET na Vercel antes de registrar o webhook." };
    }
    const publicWebhookUrl = `${appUrl}/api/webhooks/evolution`;
    const webhookUrl = `${publicWebhookUrl}?token=${encodeURIComponent(webhookSecret)}`;
    const warning = await tryConfigureWebhook(evolutionApiUrl, instanceName, apiKey, webhookUrl, publicWebhookUrl);
    if (warning) return { ok: false, message: warning };
    return { ok: true, message: `Webhook configurado com sucesso: ${publicWebhookUrl}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao configurar webhook." };
  }
}

// ─── Evolution contact name helpers ─────────────────────────────────────────

const NAME_FIELDS = ["name", "pushName", "notify", "verifiedName", "displayName", "profileName", "fullName", "shortName"] as const;

function extractBestName(obj: Record<string, unknown>, phone: string): string | null {
  for (const field of NAME_FIELDS) {
    const val = obj[field];
    if (typeof val !== "string") continue;
    const trimmed = val.trim();
    if (!trimmed) continue;
    // Reject if the value is phone-like (no letters, numerically matches the phone)
    if (!/[a-zA-ZÀ-ÿ]/.test(trimmed)) {
      const digits = trimmed.replace(/\D/g, "");
      if (digits === phone || phone.endsWith(digits) || digits.endsWith(phone)) continue;
    }
    return trimmed;
  }
  // Recurse into nested `contact` sub-object (some Evolution forks wrap it)
  const nested = obj.contact;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return extractBestName(nested as Record<string, unknown>, phone);
  }
  return null;
}

function isValidPhoneNumber(phone: string): boolean {
  return phone.length >= 7 && phone !== "0" && !/^0+$/.test(phone);
}

export async function fetchWhatsappChatsAction(instanceName: string): Promise<ActionResult> {
  try {
    const { admin, organizationId, isSyncAdmin } = await getContext();
    const baseUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    if (!baseUrl || !apiKey) {
      return { ok: false, message: "Evolution API nao configurada neste deploy." };
    }
    const evolutionApiUrl = normalizeEvolutionApiUrl(baseUrl);

    const { data: instance } = await admin
      .from("whatsapp_instances")
      .select("id, organization_id")
      .eq("instance_name", instanceName)
      .is("deleted_at", null)
      .maybeSingle();

    if (!instance?.id) return { ok: false, message: "Instancia nao encontrada no CRM." };
    if (!isSyncAdmin && instance.organization_id !== organizationId) {
      return { ok: false, message: "Sem permissao para acessar esta instancia." };
    }

    const orgId = instance.organization_id as string;
    const chatEndpoint = `${evolutionApiUrl}/chat/findChats/${encodeURIComponent(instanceName)}`;

    let response: Response;
    let httpMethod = "GET";
    try {
      // GET first — simpler, works on more Evolution versions
      response = await evolutionFetch(chatEndpoint, apiKey, { method: "GET" });
      // Some versions return 405 Method Not Allowed for GET; retry with POST
      if (response.status === 405 || response.status === 404) {
        httpMethod = "POST";
        response = await evolutionFetch(chatEndpoint, apiKey, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ where: {} }),
        });
      }
    } catch (networkError) {
      const isTimeout = networkError instanceof Error && (networkError.name === "TimeoutError" || networkError.name === "AbortError");
      const cause = networkError instanceof Error
        ? ((networkError as NodeJS.ErrnoException).cause instanceof Error
          ? (networkError as NodeJS.ErrnoException & { cause: Error }).cause.message
          : networkError.message)
        : String(networkError);
      return {
        ok: false,
        message: isTimeout
          ? `Timeout (12s) ao buscar conversas. Verifique se a Evolution esta ativa: ${evolutionApiUrl}`
          : `Erro de rede (${cause}). URL tentada: ${chatEndpoint}. Confirme EVOLUTION_API_URL e que a instancia esta conectada.`,
      };
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
      const msg = (errorData?.message ?? errorData?.error ?? `HTTP ${response.status}`) as string;
      return { ok: false, message: `Evolution retornou erro em ${httpMethod} /chat/findChats: ${msg}` };
    }

    const rawData = await response.json().catch(() => []) as unknown;
    const chatsArray: Record<string, unknown>[] = Array.isArray(rawData)
      ? rawData as Record<string, unknown>[]
      : Array.isArray((rawData as Record<string, unknown>)?.chats)
        ? (rawData as { chats: Record<string, unknown>[] }).chats
        : Array.isArray((rawData as Record<string, unknown>)?.data)
          ? (rawData as { data: Record<string, unknown>[] }).data
          : [];

    // Keep only valid individual chats (no groups, broadcasts, or invalid JIDs)
    const individualChats = chatsArray.filter((chat) => {
      const jid = (chat.id ?? chat.remoteJid ?? "") as string;
      if (typeof jid !== "string" || !jid.endsWith("@s.whatsapp.net")) return false;
      if (jid.startsWith("status@") || jid.includes("broadcast")) return false;
      const phone = jid.split("@")[0].replace(/\D/g, "");
      return isValidPhoneNumber(phone);
    });

    if (individualChats.length === 0) {
      return {
        ok: true,
        message: "Nenhuma conversa individual encontrada. O WhatsApp pode estar desconectado ou sem historico.",
        data: { chats: [], instanceId: instance.id },
      };
    }

    // Enrich with real contact names from address book (best-effort)
    // Checks all known Evolution name fields; handles nested contact sub-object and wrapped responses
    const contactNameMap = new Map<string, string>();
    try {
      const contactRes = await evolutionFetch(
        `${evolutionApiUrl}/contact/findContacts/${encodeURIComponent(instanceName)}`,
        apiKey,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ where: {} }) }
      );
      if (contactRes.ok) {
        const contactData = await contactRes.json().catch(() => []) as unknown;
        const contactList: Record<string, unknown>[] = Array.isArray(contactData)
          ? contactData as Record<string, unknown>[]
          : Array.isArray((contactData as Record<string, unknown>)?.contacts)
            ? (contactData as { contacts: Record<string, unknown>[] }).contacts
            : Array.isArray((contactData as Record<string, unknown>)?.data)
              ? (contactData as { data: Record<string, unknown>[] }).data
              : [];
        for (const c of contactList) {
          const jid = (c.id ?? c.remoteJid ?? "") as string;
          if (!jid) continue;
          const phone = jid.split("@")[0].replace(/\D/g, "");
          const name = extractBestName(c, phone);
          if (name) contactNameMap.set(jid, name);
        }
      }
    } catch { /* contacts endpoint is best-effort */ }

    const phones = individualChats
      .map((chat) => (chat.id ?? chat.remoteJid ?? "") as string)
      .map((jid) => jid.split("@")[0].replace(/\D/g, ""))
      .filter(Boolean);

    const { data: existingLeads } = await admin
      .from("leads")
      .select("id, phone")
      .eq("organization_id", orgId)
      .in("phone", phones);

    const phoneToLeadId = new Map(
      (existingLeads ?? []).map((lead) => [lead.phone as string, lead.id as string])
    );

    const chats = individualChats.map((chat) => {
      const jid = (chat.id ?? chat.remoteJid ?? "") as string;
      const phone = jid.split("@")[0].replace(/\D/g, "");
      const leadId = phoneToLeadId.get(phone) ?? null;
      // Contact endpoint is preferred; fall back to fields on the chat object itself
      const name = contactNameMap.get(jid) ?? extractBestName(chat, phone);
      const displayName = name ?? phone;
      return {
        remoteJid: jid,
        phone,
        name,
        displayName,
        lastMessageTimestamp: (chat.lastMsgTimestamp ?? chat.lastMessageTimestamp ?? null) as number | null,
        hasLead: leadId !== null,
        leadId,
      };
    });

    chats.sort((a, b) => {
      if (a.hasLead !== b.hasLead) return a.hasLead ? 1 : -1;
      return (b.lastMessageTimestamp ?? 0) - (a.lastMessageTimestamp ?? 0);
    });

    return {
      ok: true,
      message: `${chats.length} conversa(s) encontrada(s).`,
      data: { chats, instanceId: instance.id as string },
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao buscar conversas." };
  }
}

// ─── Message history import helpers ─────────────────────────────────────────

const ALLOWED_IMPORT_MSG_TYPES = new Set(["text", "image", "audio", "video", "document", "sticker", "location"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function recordsFromUnknown(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)));

  const obj = asRecord(value);
  if (!obj) return [];

  for (const key of ["records", "messages", "data", "items", "rows", "response"]) {
    const records = recordsFromUnknown(obj[key]);
    if (records.length > 0) return records;
  }

  return [];
}

function nestedTextMsg(source: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function extractMsgContent(msgData: Record<string, unknown>): {
  type: string;
  content?: string;
  mediaUrl?: string;
  mediaMimetype?: string;
  mediaFilename?: string;
  mediaDuration?: number | null;
} {
  const rawMessage = msgData.message;
  const parsedMessage = typeof rawMessage === "string"
    ? (() => {
        try {
          return JSON.parse(rawMessage) as unknown;
        } catch {
          return {};
        }
      })()
    : rawMessage;
  const message = asRecord(parsedMessage) ?? {};
  const messageType = (msgData.messageType ?? "text") as string;

  if (typeof message.conversation === "string") return { type: "text", content: message.conversation };

  const extendedText = message.extendedTextMessage as Record<string, unknown> | undefined;
  if (extendedText) return { type: "text", content: nestedTextMsg(extendedText, ["text", "caption"]) };

  const image = message.imageMessage as Record<string, unknown> | undefined;
  if (image) return { type: "image", content: nestedTextMsg(image, ["caption"]), mediaUrl: nestedTextMsg(image, ["url", "mediaUrl"]), mediaMimetype: nestedTextMsg(image, ["mimetype"]) };

  const audio = message.audioMessage as Record<string, unknown> | undefined;
  if (audio) return { type: "audio", mediaUrl: nestedTextMsg(audio, ["url", "mediaUrl"]), mediaMimetype: nestedTextMsg(audio, ["mimetype"]), mediaDuration: Number(audio.seconds ?? audio.duration) || null };

  const video = message.videoMessage as Record<string, unknown> | undefined;
  if (video) return { type: "video", content: nestedTextMsg(video, ["caption"]), mediaUrl: nestedTextMsg(video, ["url", "mediaUrl"]), mediaMimetype: nestedTextMsg(video, ["mimetype"]), mediaDuration: Number(video.seconds ?? video.duration) || null };

  const document = message.documentMessage as Record<string, unknown> | undefined;
  if (document) return { type: "document", content: nestedTextMsg(document, ["caption", "title"]), mediaUrl: nestedTextMsg(document, ["url", "mediaUrl"]), mediaMimetype: nestedTextMsg(document, ["mimetype"]), mediaFilename: nestedTextMsg(document, ["fileName", "filename", "title"]) };

  const sticker = message.stickerMessage as Record<string, unknown> | undefined;
  if (sticker) return { type: "sticker", mediaUrl: nestedTextMsg(sticker, ["url", "mediaUrl"]), mediaMimetype: nestedTextMsg(sticker, ["mimetype"]) };

  const location = message.locationMessage as Record<string, unknown> | undefined;
  if (location) {
    const lat = location.degreesLatitude ?? location.latitude;
    const lon = location.degreesLongitude ?? location.longitude;
    return { type: "location", content: [nestedTextMsg(location, ["name", "address"]), lat != null && lon != null ? `${lat}, ${lon}` : null].filter(Boolean).join("\n") };
  }

  const normalizedType = messageType.toLowerCase().replace("message", "");
  return { type: ALLOWED_IMPORT_MSG_TYPES.has(normalizedType) ? normalizedType : "text", content: nestedTextMsg(message, ["text", "caption"]) ?? `[${messageType}]` };
}

function extractMsgTimestamp(msgData: Record<string, unknown>): string {
  const raw = msgData.messageTimestamp ?? msgData.timestamp;
  if (!raw) return new Date().toISOString();
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return new Date().toISOString();
  return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000).toISOString();
}

function timestampNumber(msgData: Record<string, unknown>): number {
  const raw = msgData.messageTimestamp ?? msgData.timestamp;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return 0;
  return numeric > 10_000_000_000 ? numeric : numeric * 1000;
}

async function fetchAndInsertMessages(
  admin: ReturnType<typeof createAdminClient>,
  evolutionApiUrl: string,
  apiKey: string,
  instanceName: string,
  remoteJid: string,
  conversationId: string,
  organizationId: string
): Promise<{ imported: number; failed: boolean }> {
  const endpoint = `${evolutionApiUrl}/chat/findMessages/${encodeURIComponent(instanceName)}`;

  let response: Response;
  try {
    response = await evolutionFetch(endpoint, apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        where: { key: { remoteJid } },
        limit: 10,
        order: { messageTimestamp: "desc" },
      }),
    });
  } catch {
    return { imported: 0, failed: true };
  }

  if (!response.ok) return { imported: 0, failed: true };

  const rawData = await response.json().catch(() => null) as unknown;
  if (!rawData) return { imported: 0, failed: false };

  const messagesArray = recordsFromUnknown(rawData);

  const toProcess = messagesArray
    .slice(0, 10)
    .sort((a, b) => timestampNumber(a) - timestampNumber(b));
  let imported = 0;
  let failed = false;

  for (const msg of toProcess) {
    const key = msg.key as Record<string, unknown> | undefined;
    if (!key) continue;
    const evolutionMsgId = key.id as string | undefined;
    if (!evolutionMsgId) continue;
    if (typeof key.remoteJid === "string" && key.remoteJid.includes("@g.us")) continue;

    const inbound = key.fromMe !== true;
    const content = extractMsgContent(msg);
    if (!ALLOWED_IMPORT_MSG_TYPES.has(content.type)) continue;

    const { data: insertedMsg, error: insertError } = await admin
      .from("messages")
      .upsert(
        {
          conversation_id: conversationId,
          evolution_msg_id: evolutionMsgId,
          direction: inbound ? "inbound" : "outbound",
          message_type: content.type,
          content: content.content ?? null,
          // Historical CDN URLs are expired/encrypted — leave null; media storage
          // runs via after() for recently importable messages (< ~60 days old).
          media_url: null,
          media_mimetype: content.mediaMimetype ?? null,
          media_filename: content.mediaFilename ?? null,
          media_duration: content.mediaDuration ?? null,
          created_at: extractMsgTimestamp(msg),
          is_imported: true,  // prevents follow-up cycle from using these as trigger
        },
        { onConflict: "evolution_msg_id", ignoreDuplicates: true }
      )
      .select("id")
      .maybeSingle();

    if (insertError) {
      failed = true;
      continue;
    }

    if (insertedMsg?.id) {
      imported++;
      // Try to decrypt + store media in Supabase Storage after the action responds.
      // WhatsApp keeps messages ~60 days; older ones will fail gracefully.
      const STORABLE_TYPES = new Set(["audio", "image", "video", "document", "sticker"]);
      if (STORABLE_TYPES.has(content.type)) {
        const msgId     = insertedMsg.id;
        const mediaType = content.type;
        after(async () => {
          const stored = await fetchAndStoreWhatsAppMedia(
            admin,
            instanceName,
            { key: msg.key, message: msg.message, messageType: msg.messageType as string | undefined },
            organizationId,
            evolutionMsgId,
            mediaType
          );
          if (stored) {
            await admin
              .from("messages")
              .update({ media_url: stored.url, media_mimetype: stored.mimetype })
              .eq("id", msgId);
          }
        });
      }
    }
  }

  return { imported, failed };
}

// ─────────────────────────────────────────────────────────────────────────────

export async function importWhatsappConversationsAction(
  instanceName: string,
  contacts: { remoteJid: string; name?: string | null }[]
): Promise<ActionResult> {
  try {
    const { admin, organizationId, isSyncAdmin } = await getContext();

    if (!contacts.length) return { ok: false, message: "Nenhuma conversa selecionada." };
    if (contacts.length > 200) return { ok: false, message: "Maximo de 200 conversas por vez." };

    const { data: instance } = await admin
      .from("whatsapp_instances")
      .select("id, organization_id")
      .eq("instance_name", instanceName)
      .is("deleted_at", null)
      .maybeSingle();

    if (!instance?.id) return { ok: false, message: "Instancia nao encontrada no CRM." };
    if (!isSyncAdmin && instance.organization_id !== organizationId) {
      return { ok: false, message: "Sem permissao para acessar esta instancia." };
    }

    const orgId = instance.organization_id as string;

    const evolutionBaseUrl = process.env.EVOLUTION_API_URL;
    const evolutionApiKey = process.env.EVOLUTION_API_KEY;
    const evolutionApiUrl = evolutionBaseUrl ? normalizeEvolutionApiUrl(evolutionBaseUrl) : null;
    const canFetchMessages = Boolean(evolutionApiUrl && evolutionApiKey);

    let sourceId: string | null = null;
    const { data: waSource } = await admin
      .from("lead_sources")
      .select("id")
      .eq("organization_id", orgId)
      .ilike("name", "WhatsApp")
      .maybeSingle();
    if (waSource?.id) {
      sourceId = waSource.id as string;
    } else {
      const { data: newSource } = await admin
        .from("lead_sources")
        .insert({ organization_id: orgId, name: "WhatsApp", color: "#22c55e" })
        .select("id")
        .single();
      sourceId = (newSource?.id as string | undefined) ?? null;
    }

    let leadsCreated = 0;
    let conversationsCreated = 0;
    let messagesImported = 0;
    let messagesFailed = 0;

    for (const contact of contacts) {
      const { remoteJid, name: contactName } = contact;
      if (!remoteJid.endsWith("@s.whatsapp.net")) continue;
      const phone = remoteJid.split("@")[0].replace(/\D/g, "");
      if (!phone) continue;

      const lead = await createOrUpdateLeadByPhone(
        admin,
        {
          organizationId: orgId,
          name: contactName || phone,
          phone,
          sourceId,
          status: "new",
          lastInteractionAt: new Date().toISOString(),
        },
        { nameMode: "fill_if_blank_or_phone" }
      );
      if (!lead.id) continue;
      const leadId = lead.id;
      if (lead.created) leadsCreated++;

      const { data: existingConv } = await admin
        .from("conversations")
        .select("id")
        .eq("instance_id", instance.id)
        .eq("remote_jid", remoteJid)
        .maybeSingle();

      let conversationId: string;
      if (!existingConv?.id) {
        const { data: newConv, error: convError } = await admin
          .from("conversations")
          .insert({
            organization_id: orgId,
            instance_id: instance.id,
            lead_id: leadId,
            remote_jid: remoteJid,
            unread_count: 0,
            status: "open",
          })
          .select("id")
          .single();
        if (convError || !newConv?.id) continue;
        conversationId = newConv.id as string;
        conversationsCreated++;
      } else {
        conversationId = existingConv.id as string;
        await admin
          .from("conversations")
          .update({ lead_id: leadId })
          .eq("id", conversationId)
          .is("lead_id", null);
      }

      if (canFetchMessages) {
        const msgResult = await fetchAndInsertMessages(
          admin,
          evolutionApiUrl!,
          evolutionApiKey!,
          instanceName,
          remoteJid,
          conversationId,
          orgId
        );
        messagesImported += msgResult.imported;
        if (msgResult.failed) messagesFailed++;
      }
    }

    revalidatePath("/admin");
    revalidatePath("/inbox");
    revalidatePath("/leads");

    const parts: string[] = [];
    if (leadsCreated > 0) parts.push(`${leadsCreated} lead(s) criado(s)`);
    if (conversationsCreated > 0) parts.push(`${conversationsCreated} conversa(s) nova(s)`);
    if (messagesImported > 0) parts.push(`${messagesImported} mensagem(ns) importada(s)`);
    const summary = parts.length > 0
      ? `Importacao concluida: ${parts.join(", ")}.`
      : "Importacao concluida: nenhum registro novo.";
    const failureNote = messagesFailed > 0
      ? ` (${messagesFailed} conversa(s) sem historico importado)`
      : "";

    return { ok: true, message: summary + failureNote };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao importar conversas." };
  }
}

export async function disconnectWhatsappInstanceAction(instanceName: string): Promise<ActionResult> {
  try {
    const { admin, user, organizationId, isSyncAdmin } = await getContext();
    const baseUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    if (!baseUrl || !apiKey) {
      return { ok: false, message: "Evolution API nao configurada neste deploy." };
    }
    const evolutionApiUrl = normalizeEvolutionApiUrl(baseUrl);

    const { data: instance } = await admin
      .from("whatsapp_instances")
      .select("id, organization_id, instance_name")
      .eq("instance_name", instanceName)
      .is("deleted_at", null)
      .maybeSingle();

    if (!instance?.id) return { ok: false, message: "Instancia nao encontrada no CRM." };
    if (!isSyncAdmin && instance.organization_id !== organizationId) {
      return { ok: false, message: "Sem permissao para desconectar esta instancia." };
    }

    const response = await evolutionFetch(
      `${evolutionApiUrl}/instance/logout/${encodeURIComponent(instanceName)}`,
      apiKey,
      { method: "DELETE" }
    );

    // 404 = already logged out on Evolution side — treat as success
    if (!response.ok && response.status !== 404) {
      const errData = await response.json().catch(() => ({})) as Record<string, unknown>;
      const msg = (errData?.message ?? errData?.error ?? `HTTP ${response.status}`) as string;
      return { ok: false, message: `Evolution ${response.status}: ${msg}` };
    }

    const { error: updateError } = await admin
      .from("whatsapp_instances")
      .update({ status: "disconnected", phone_number: null })
      .eq("id", instance.id);
    if (updateError) return { ok: false, message: updateError.message };

    await insertAuditLog(admin, user.id, instance.organization_id as string, "disconnect_whatsapp", "whatsapp_instance", instance.id as string, {
      instance_name: instanceName,
    });

    revalidatePath("/admin");
    revalidatePath("/inbox");
    revalidatePath("/dashboard");

    return {
      ok: true,
      message: "WhatsApp desconectado. Voce pode conectar outro numero agora.",
      data: { instanceName },
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao desconectar WhatsApp." };
  }
}

// ─── Delete WhatsApp instance (soft delete) ──────────────────────────────────

export async function deleteWhatsappInstanceAction(instanceId: string): Promise<ActionResult> {
  try {
    const { admin, user, organizationId, isSyncAdmin } = await getContext();

    const { data: instance } = await admin
      .from("whatsapp_instances")
      .select("id, organization_id, instance_name, status")
      .eq("id", instanceId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!instance?.id) return { ok: false, message: "Instancia nao encontrada." };
    if (!isSyncAdmin && instance.organization_id !== organizationId) {
      return { ok: false, message: "Sem permissao para remover esta instancia." };
    }

    const instanceName = instance.instance_name as string;
    let evolutionWarning: string | null = null;

    const baseUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    if (baseUrl && apiKey) {
      const evolutionApiUrl = normalizeEvolutionApiUrl(baseUrl);
      // Logout first (best-effort)
      try {
        await evolutionFetch(
          `${evolutionApiUrl}/instance/logout/${encodeURIComponent(instanceName)}`,
          apiKey,
          { method: "DELETE" }
        );
      } catch { /* best-effort */ }
      // Delete from Evolution
      try {
        const deleteRes = await evolutionFetch(
          `${evolutionApiUrl}/instance/delete/${encodeURIComponent(instanceName)}`,
          apiKey,
          { method: "DELETE" }
        );
        if (!deleteRes.ok && deleteRes.status !== 404) {
          evolutionWarning = "Instancia removida do CRM, mas nao foi possivel remover na Evolution.";
        }
      } catch {
        evolutionWarning = "Instancia removida do CRM, mas nao foi possivel remover na Evolution (erro de rede).";
      }
    }

    const { error } = await admin
      .from("whatsapp_instances")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
        status: "disconnected",
      })
      .eq("id", instanceId);

    if (error) return { ok: false, message: error.message };

    await insertAuditLog(admin, user.id, instance.organization_id as string, "delete_whatsapp_instance", "whatsapp_instance", instanceId, {
      instance_name: instanceName,
    });

    revalidatePath("/admin");
    revalidatePath("/inbox");
    revalidatePath("/dashboard");

    return {
      ok: true,
      message: evolutionWarning ?? "Instancia removida.",
      data: { instanceId },
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao remover instancia." };
  }
}

// ─── Lead source rules ────────────────────────────────────────────────────────

const matchTypes = ["exact", "contains", "starts_with", "regex"] as const;

async function ensureSourceBelongsToOrg(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  sourceId: string,
  activeOnly = false
) {
  let query = admin
    .from("lead_sources")
    .select("id, active")
    .eq("id", sourceId)
    .eq("organization_id", organizationId);
  if (activeOnly) query = query.eq("active", true);

  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}

export async function createSourceRuleAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const parsed = z
      .object({
        name: z.string().trim().min(2),
        source_id: z.string().uuid(),
        match_type: z.enum(matchTypes),
        pattern: z.string().trim().min(1).max(500),
        case_sensitive: z.boolean(),
        normalize_whitespace: z.boolean(),
        overwrite_existing: z.boolean(),
        priority: z.coerce.number().int().min(1).max(9999).default(100),
      })
      .safeParse({
        name: formData.get("name"),
        source_id: formData.get("source_id"),
        match_type: formData.get("match_type"),
        pattern: formData.get("pattern"),
        case_sensitive: formData.get("case_sensitive") === "on",
        normalize_whitespace: formData.get("normalize_whitespace") === "on",
        overwrite_existing: formData.get("overwrite_existing") === "on",
        priority: formData.get("priority") || 100,
      });

    if (!parsed.success) return { ok: false, message: "Dados invalidos: " + parsed.error.issues[0]?.message };

    const sourceAllowed = await ensureSourceBelongsToOrg(admin, organizationId, parsed.data.source_id, true);
    if (!sourceAllowed) return { ok: false, message: "Origem nao pertence a organizacao atual ou esta inativa." };

    // Validate regex safety before saving
    if (parsed.data.match_type === "regex") {
      if (parsed.data.pattern.length > 200) {
        return { ok: false, message: "Regex muito longa (max 200 caracteres)." };
      }
      try {
        new RegExp(parsed.data.pattern);
      } catch {
        return { ok: false, message: "Expressao regular invalida." };
      }
    }

    const { error } = await admin.from("lead_source_rules").insert({
      organization_id: organizationId,
      source_id: parsed.data.source_id,
      name: parsed.data.name,
      match_type: parsed.data.match_type,
      pattern: parsed.data.pattern,
      case_sensitive: parsed.data.case_sensitive,
      normalize_whitespace: parsed.data.normalize_whitespace,
      overwrite_existing: parsed.data.overwrite_existing,
      priority: parsed.data.priority,
      active: true,
    });

    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    return { ok: true, message: "Regra criada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao criar regra." };
  }
}

export async function updateSourceRuleAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const id = asText(formData.get("id"));
    if (!id) return { ok: false, message: "Regra nao encontrada." };

    const parsed = z
      .object({
        name: z.string().trim().min(2),
        source_id: z.string().uuid(),
        match_type: z.enum(matchTypes),
        pattern: z.string().trim().min(1).max(500),
        case_sensitive: z.boolean(),
        normalize_whitespace: z.boolean(),
        overwrite_existing: z.boolean(),
        active: z.boolean(),
        priority: z.coerce.number().int().min(1).max(9999).default(100),
      })
      .safeParse({
        name: formData.get("name"),
        source_id: formData.get("source_id"),
        match_type: formData.get("match_type"),
        pattern: formData.get("pattern"),
        case_sensitive: formData.get("case_sensitive") === "on",
        normalize_whitespace: formData.get("normalize_whitespace") === "on",
        overwrite_existing: formData.get("overwrite_existing") === "on",
        active: formData.get("active") === "on",
        priority: formData.get("priority") || 100,
      });

    if (!parsed.success) return { ok: false, message: "Dados invalidos: " + parsed.error.issues[0]?.message };

    const sourceAllowed = await ensureSourceBelongsToOrg(admin, organizationId, parsed.data.source_id, parsed.data.active);
    if (!sourceAllowed) return { ok: false, message: "Origem nao pertence a organizacao atual ou esta inativa." };

    if (parsed.data.match_type === "regex") {
      if (parsed.data.pattern.length > 200) {
        return { ok: false, message: "Regex muito longa (max 200 caracteres)." };
      }
      try {
        new RegExp(parsed.data.pattern);
      } catch {
        return { ok: false, message: "Expressao regular invalida." };
      }
    }

    const { error } = await admin
      .from("lead_source_rules")
      .update({
        source_id: parsed.data.source_id,
        name: parsed.data.name,
        match_type: parsed.data.match_type,
        pattern: parsed.data.pattern,
        case_sensitive: parsed.data.case_sensitive,
        normalize_whitespace: parsed.data.normalize_whitespace,
        overwrite_existing: parsed.data.overwrite_existing,
        active: parsed.data.active,
        priority: parsed.data.priority,
      })
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    return { ok: true, message: "Regra atualizada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao atualizar regra." };
  }
}

export async function deleteSourceRuleAction(ruleId: string): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const { error } = await admin
      .from("lead_source_rules")
      .delete()
      .eq("id", ruleId)
      .eq("organization_id", organizationId);

    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    return { ok: true, message: "Regra removida." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao remover regra." };
  }
}

export async function toggleSourceRuleActiveAction(ruleId: string, active: boolean): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    if (active) {
      const { data: rule } = await admin
        .from("lead_source_rules")
        .select("source_id")
        .eq("id", ruleId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!rule) return { ok: false, message: "Regra nao encontrada." };
      const sourceAllowed = await ensureSourceBelongsToOrg(admin, organizationId, rule.source_id as string, true);
      if (!sourceAllowed) return { ok: false, message: "Nao e possivel ativar regra com origem inativa." };
    }

    const { error } = await admin
      .from("lead_source_rules")
      .update({ active })
      .eq("id", ruleId)
      .eq("organization_id", organizationId);

    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    return { ok: true, message: active ? "Regra ativada." : "Regra desativada." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao alterar regra." };
  }
}

// ─── Business-hours auto-reply settings ──────────────────────────────────────

export async function saveBhAutoReplySettingsAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const parsed = z
      .object({
        enabled: z.boolean(),
        message_template: z.string().trim().min(5).max(2000),
        delay_minutes: z.coerce.number().int().min(1).max(120),
        cooldown_hours: z.coerce.number().int().min(1).max(168),
        timezone: z.string().trim().min(3).max(80),
      })
      .safeParse({
        enabled: formData.get("enabled") === "on",
        message_template: formData.get("message_template"),
        delay_minutes: formData.get("delay_minutes") || 15,
        cooldown_hours: formData.get("cooldown_hours") || 12,
        timezone: formData.get("timezone") || "America/Sao_Paulo",
      });

    if (!parsed.success) return { ok: false, message: "Dados invalidos: " + parsed.error.issues[0]?.message };

    const { error } = await admin.from("bh_auto_reply_settings").upsert(
      {
        organization_id: organizationId,
        enabled: parsed.data.enabled,
        message_template: parsed.data.message_template,
        delay_minutes: parsed.data.delay_minutes,
        cooldown_hours: parsed.data.cooldown_hours,
        timezone: parsed.data.timezone,
      },
      { onConflict: "organization_id" }
    );

    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin");
    return { ok: true, message: parsed.data.enabled ? "Resposta automatica ativada." : "Configuracoes salvas." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao salvar configuracoes." };
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
