import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Schema de validação do payload de lead externo
const LeadWebhookSchema = z.object({
  // Campos obrigatórios
  name: z.string().min(2).max(200),
  phone: z
    .string()
    .regex(/^\+?[\d\s\-()]{8,20}$/, "Telefone inválido"),

  // Campos opcionais
  email: z.string().email().optional(),
  source: z.string().max(100).optional(),
  campaign: z.string().max(100).optional(),
  procedure: z.string().max(200).optional(),
  potential_value: z.number().positive().optional(),
  custom_fields: z.record(z.unknown()).optional(),

  // Identificação da organização
  organization_id: z.string().uuid().optional(),
  organization_slug: z.string().optional(),
});

type LeadPayload = z.infer<typeof LeadWebhookSchema>;

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function verifyWebhookSecret(request: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true; // Sem secret configurado, aceitar (apenas dev)

  const headerSecret = request.headers.get("x-webhook-secret");
  const querySecret = request.nextUrl.searchParams.get("secret");

  return headerSecret === secret || querySecret === secret;
}

export async function POST(request: NextRequest) {
  // Verificar autenticação do webhook
  if (!verifyWebhookSecret(request)) {
    return NextResponse.json(
      { error: "Unauthorized", code: "INVALID_SECRET" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  // Validar com Zod
  const result = LeadWebhookSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: result.error.flatten().fieldErrors,
      },
      { status: 422 }
    );
  }

  const payload: LeadPayload = result.data;
  const normalizedPhone = normalizePhone(payload.phone);

  try {
    // TODO: Substituir por chamada real ao Supabase quando configurado
    // const { createAdminClient } = await import("@/lib/supabase/server");
    // const supabase = await createAdminClient();

    // Lógica de criação/atualização de lead:
    // 1. Buscar organização pelo ID ou slug
    // 2. Verificar se lead já existe pelo telefone (upsert)
    // 3. Criar ou atualizar lead
    // 4. Criar evento de timeline
    // 5. Logar no webhook_events

    // Mock response para MVP
    const mockLeadId = `lead_${Date.now()}`;
    const isNew = Math.random() > 0.3; // simulação

    return NextResponse.json(
      {
        success: true,
        action: isNew ? "created" : "updated",
        lead_id: mockLeadId,
        data: {
          name: payload.name,
          phone: normalizedPhone,
          email: payload.email,
          source: payload.source ?? "webhook",
          procedure: payload.procedure,
        },
        message: isNew
          ? "Lead criado com sucesso"
          : "Lead atualizado com sucesso",
      },
      { status: isNew ? 201 : 200 }
    );
  } catch (error) {
    console.error("[WEBHOOK/LEADS] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "POST /api/webhooks/leads",
    description: "Receive leads from external sources",
    required_fields: ["name", "phone"],
    optional_fields: [
      "email",
      "source",
      "campaign",
      "procedure",
      "potential_value",
      "custom_fields",
      "organization_id",
    ],
    auth: "Header: x-webhook-secret or Query: ?secret=",
  });
}
