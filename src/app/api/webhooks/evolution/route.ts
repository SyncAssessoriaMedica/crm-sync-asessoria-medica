import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Schema do webhook da Evolution API
// Docs: https://doc.evolution-api.com/v2/api-reference/events
const EvolutionMessageSchema = z.object({
  event: z.string(),
  instance: z.string(),
  data: z.object({
    key: z.object({
      remoteJid: z.string(),
      fromMe: z.boolean(),
      id: z.string(),
    }),
    message: z
      .object({
        conversation: z.string().optional(),
        extendedTextMessage: z.object({ text: z.string() }).optional(),
        imageMessage: z
          .object({ url: z.string(), mimetype: z.string(), caption: z.string().optional() })
          .optional(),
        audioMessage: z
          .object({ url: z.string(), mimetype: z.string(), seconds: z.number() })
          .optional(),
        videoMessage: z
          .object({ url: z.string(), mimetype: z.string(), caption: z.string().optional() })
          .optional(),
        documentMessage: z
          .object({ url: z.string(), mimetype: z.string(), fileName: z.string() })
          .optional(),
      })
      .optional(),
    messageType: z.string(),
    pushName: z.string().optional(),
    timestamp: z.number(),
  }),
});

type EvolutionPayload = z.infer<typeof EvolutionMessageSchema>;

function extractPhone(remoteJid: string): string {
  // "5511987654321@s.whatsapp.net" → "5511987654321"
  // "5511987654321-1234567890@g.us" → null (grupo, ignorar)
  return remoteJid.split("@")[0];
}

function isGroupMessage(remoteJid: string): boolean {
  return remoteJid.includes("@g.us");
}

function getMessageContent(data: EvolutionPayload["data"]): {
  type: string;
  content?: string;
  mediaUrl?: string;
} {
  const { message, messageType } = data;
  if (!message) return { type: messageType };

  if (message.conversation) {
    return { type: "text", content: message.conversation };
  }
  if (message.extendedTextMessage) {
    return { type: "text", content: message.extendedTextMessage.text };
  }
  if (message.imageMessage) {
    return {
      type: "image",
      content: message.imageMessage.caption,
      mediaUrl: message.imageMessage.url,
    };
  }
  if (message.audioMessage) {
    return { type: "audio", mediaUrl: message.audioMessage.url };
  }
  if (message.videoMessage) {
    return {
      type: "video",
      content: message.videoMessage.caption,
      mediaUrl: message.videoMessage.url,
    };
  }
  if (message.documentMessage) {
    return {
      type: "document",
      content: message.documentMessage.fileName,
      mediaUrl: message.documentMessage.url,
    };
  }

  return { type: messageType };
}

function verifyEvolutionSignature(request: NextRequest): boolean {
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!apiKey) return true; // Sem key configurada, aceitar em dev

  const headerKey = request.headers.get("apikey");
  return headerKey === apiKey;
}

export async function POST(request: NextRequest) {
  if (!verifyEvolutionSignature(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validar payload
  const result = EvolutionMessageSchema.safeParse(body);
  if (!result.success) {
    // Evolution pode enviar outros eventos (connection.update, etc.) — aceitar silenciosamente
    return NextResponse.json({ received: true, processed: false });
  }

  const payload = result.data;

  // Processar apenas eventos de mensagem
  if (!["messages.upsert", "MESSAGES_UPSERT"].includes(payload.event)) {
    return NextResponse.json({ received: true, processed: false, reason: "Event not handled" });
  }

  // Ignorar grupos
  if (isGroupMessage(payload.data.key.remoteJid)) {
    return NextResponse.json({ received: true, processed: false, reason: "Group message ignored" });
  }

  const phone = extractPhone(payload.data.key.remoteJid);
  const isFromMe = payload.data.key.fromMe;
  const direction = isFromMe ? "outbound" : "inbound";
  const messageContent = getMessageContent(payload.data);

  try {
    // TODO: Substituir por lógica real com Supabase quando configurado
    // const { createAdminClient } = await import("@/lib/supabase/server");
    // const supabase = await createAdminClient();

    // Lógica completa:
    // 1. Identificar a organização pelo instance_name
    // 2. Buscar whatsapp_instance pela instance
    // 3. Buscar conversa existente pelo remote_jid
    //    - Se não existe: criar conversa
    //    - Buscar lead pelo telefone
    //    - Se lead não existe e mensagem é inbound: criar lead com origem "WhatsApp"
    // 4. Inserir mensagem na conversa
    // 5. Atualizar updated_at da conversa
    // 6. Se inbound e lead não tinha conversa: criar evento no timeline do lead
    // 7. Registrar no webhook_events

    console.log(`[EVOLUTION WEBHOOK] Instance: ${payload.instance} | Phone: ${phone} | Direction: ${direction} | Type: ${messageContent.type}`);

    return NextResponse.json({
      success: true,
      processed: true,
      instance: payload.instance,
      phone,
      direction,
      message_type: messageContent.type,
      // Em produção: retornar lead_id e conversation_id criados/atualizados
    });
  } catch (error) {
    console.error("[WEBHOOK/EVOLUTION] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "POST /api/webhooks/evolution",
    description: "Receive WhatsApp messages from Evolution API",
    handled_events: ["messages.upsert", "MESSAGES_UPSERT"],
    auth: "Header: apikey",
    behavior: {
      new_lead: "Creates lead with source=WhatsApp if phone not found",
      existing_lead: "Attaches message to existing lead conversation",
      groups: "Ignored",
      from_me: "Logged as outbound message",
    },
  });
}
