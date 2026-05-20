"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";

type ActionResult = { ok: true; message: string; data?: unknown } | { ok: false; message: string };

const roles = ["super_admin", "gestor_sync", "admin_clinica", "atendente", "leitura"] as const;
const fieldTypes = ["text", "number", "date", "select", "multiselect", "boolean", "url"] as const;

async function getContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) throw new Error("Usuario sem organizacao configurada.");

  const role = (profile?.role ?? membership.role) as string;
  const isSyncAdmin = role === "super_admin" || role === "gestor_sync";
  const canManage = isSyncAdmin || membership.role === "admin_clinica";
  if (!canManage) throw new Error("Sem permissao para administrar esta organizacao.");

  return {
    admin,
    user,
    organizationId: membership.organization_id as string,
    isSyncAdmin,
  };
}

function asText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
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
    const { admin, organizationId } = await getContext();
    const instanceName = asText(formData.get("instance_name"));
    const phone = asText(formData.get("phone_number")).replace(/\D/g, "");
    if (instanceName.length < 2) return { ok: false, message: "Informe o nome da instancia." };
    const { error } = await admin.from("whatsapp_instances").insert({
      organization_id: organizationId,
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
    const { admin, organizationId } = await getContext();
    const baseUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    if (!baseUrl || !apiKey) return { ok: false, message: "Configure EVOLUTION_API_URL e EVOLUTION_API_KEY na Vercel." };
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/instance/connect/${encodeURIComponent(instanceName)}`, {
      headers: { apikey: apiKey },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, message: data?.message ?? "Evolution nao retornou QR Code." };
    await admin
      .from("whatsapp_instances")
      .update({ status: "connecting" })
      .eq("organization_id", organizationId)
      .eq("instance_name", instanceName);
    revalidatePath("/admin");
    return { ok: true, message: "QR Code gerado.", data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao conectar WhatsApp." };
  }
}

export async function sendWebhookAction(formData: FormData): Promise<ActionResult> {
  try {
    const { admin, organizationId } = await getContext();
    const url = asText(formData.get("url"));
    const eventType = asText(formData.get("event_type")) || "manual";
    const rawPayload = asText(formData.get("payload"));
    if (!url.startsWith("https://")) return { ok: false, message: "Use uma URL HTTPS." };
    let payload: unknown;
    try {
      payload = rawPayload ? JSON.parse(rawPayload) : {};
    } catch {
      return { ok: false, message: "Payload precisa ser JSON valido." };
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-event": eventType },
      body: JSON.stringify(payload),
    });
    await admin.from("webhook_events").insert({
      organization_id: organizationId,
      source: "outbound_admin",
      event_type: eventType,
      payload: { url, payload, status: response.status },
      processed: response.ok,
      error: response.ok ? null : await response.text().catch(() => "Erro ao enviar webhook"),
    });
    revalidatePath("/admin");
    return { ok: response.ok, message: response.ok ? "Webhook enviado." : `Falha no webhook: ${response.status}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro ao enviar webhook." };
  }
}
