"use server";

import { revalidatePath } from "next/cache";
import { getOrganizationContext } from "@/lib/organization-context";
import { sendEvolutionText, sendEvolutionMedia, sendEvolutionAudio } from "@/lib/evolution/messages";
import { getSignedMediaUrlForEvolution } from "@/lib/media-signed-url";
import type { InboxMessage } from "./types";

// ─── Shared context helper ────────────────────────────────────────────────────

async function getCurrentContext() {
  const context = await getOrganizationContext();
  return { admin: context.admin, organizationId: context.organizationId };
}

// ─── Existing actions ─────────────────────────────────────────────────────────

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

// ─── Send helpers ─────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function friendlyError(error: string): string {
  const low = error.toLowerCase();
  if (low.includes("timeout") || low.includes("aborterror") || low.includes("timed out")) {
    return "Tempo esgotado. Verifique a conexão com a Evolution API.";
  }
  if (low.includes("401") || low.includes("403")) return "Sem permissão na instância WhatsApp.";
  if (low.includes("404")) return "Instância não encontrada na Evolution API.";
  if (low.includes("http 4")) return "Erro ao enviar. Verifique a configuração da instância.";
  if (low.includes("http 5")) return "Erro no servidor Evolution API. Tente novamente.";
  return "Falha ao enviar. Tente novamente.";
}

const MESSAGE_SELECT =
  "id, conversation_id, direction, message_type, content, media_url, media_mimetype, media_filename, media_duration, media_ptt, created_at, delivered_at, read_at, send_status, send_error, client_message_id";

type InstanceRow = {
  id: string;
  instance_name: string;
  status: string;
  deleted_at: string | null;
};

type ConvRow = {
  id: string;
  remote_jid: string;
  lead_id: string | null;
  instance: InstanceRow | InstanceRow[] | null;
};

function firstInstance(value: InstanceRow | InstanceRow[] | null): InstanceRow | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

// ─── sendInboxMessageAction ───────────────────────────────────────────────────

export type SendInboxMessageInput = {
  conversationId: string;
  clientMessageId: string;
  messageType: "text" | "image" | "audio" | "video" | "document" | "sticker";
  text?: string | null;
  mediaUrl?: string | null;
  mediaMimetype?: string | null;
  mediaFilename?: string | null;
  mediaDuration?: number | null;
  /** true = WhatsApp voice note (PTT); false = regular audio file. Defaults to true. */
  ptt?: boolean;
};

export async function sendInboxMessageAction(
  input: SendInboxMessageInput
): Promise<{ ok: boolean; message: string; data: InboxMessage | null }> {
  try {
    const { admin, organizationId } = await getCurrentContext();
    const { conversationId, clientMessageId, messageType, text, mediaUrl, mediaMimetype, mediaFilename, mediaDuration, ptt } =
      input;

    // Basic validation
    if (!UUID_RE.test(conversationId)) return { ok: false, message: "Conversa inválida.", data: null };
    if (!UUID_RE.test(clientMessageId)) return { ok: false, message: "ID de mensagem inválido.", data: null };

    const VALID_TYPES = new Set(["text", "image", "audio", "video", "document", "sticker"]);
    if (!VALID_TYPES.has(messageType)) return { ok: false, message: "Tipo de mensagem inválido.", data: null };

    const trimmedText = text?.trim() ?? null;
    if (messageType === "text" && !trimmedText) {
      return { ok: false, message: "Mensagem de texto não pode estar vazia.", data: null };
    }
    if (messageType !== "text" && !mediaUrl) {
      return { ok: false, message: "Arquivo obrigatório para este tipo de mensagem.", data: null };
    }

    // Load conversation (verifies org ownership)
    const { data: conv } = await admin
      .from("conversations")
      .select("id, remote_jid, lead_id, instance:whatsapp_instances(id, instance_name, status, deleted_at)")
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!conv) return { ok: false, message: "Conversa não encontrada.", data: null };

    // Groups are not supported
    if (conv.remote_jid.includes("@g.us")) {
      return { ok: false, message: "Envio para grupos não é suportado.", data: null };
    }

    const convRow = conv as unknown as ConvRow;
    const instance = firstInstance(convRow.instance);

    if (!instance || instance.deleted_at) {
      return { ok: false, message: "Instância WhatsApp não encontrada.", data: null };
    }
    if (instance.status !== "connected") {
      return {
        ok: false,
        message: "A instância do WhatsApp está desconectada. Reconecte para enviar mensagens.",
        data: null,
      };
    }

    const phone = conv.remote_jid.split("@")[0].replace(/\D/g, "");
    if (!phone || phone.length < 8) {
      return { ok: false, message: "Número de telefone inválido.", data: null };
    }

    // Idempotency: check for existing message with this client_message_id
    const { data: existing } = await admin
      .from("messages")
      .select("id, send_status")
      .eq("client_message_id", clientMessageId)
      .maybeSingle();

    let messageId: string;

    if (existing) {
      if (existing.send_status === "sent") {
        const { data: msg } = await admin.from("messages").select(MESSAGE_SELECT).eq("id", existing.id).maybeSingle();
        return { ok: true, message: "Mensagem já enviada.", data: msg as InboxMessage | null };
      }
      if (existing.send_status === "sending" || existing.send_status === "pending") {
        return { ok: false, message: "Mensagem já está sendo enviada.", data: null };
      }
      // "failed" → retry allowed
      messageId = existing.id;
      await admin.from("messages").update({ send_status: "sending", send_error: null }).eq("id", messageId);
    } else {
      const { data: inserted, error: insertErr } = await admin
        .from("messages")
        .insert({
          conversation_id: conversationId,
          direction: "outbound",
          message_type: messageType,
          content: trimmedText,
          media_url: mediaUrl ?? null,
          media_mimetype: mediaMimetype ?? null,
          media_filename: mediaFilename ?? null,
          media_duration: mediaDuration ?? null,
          media_ptt: messageType === "audio" ? ptt !== false : null,
          client_message_id: clientMessageId,
          send_status: "sending",
          created_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (insertErr) {
        if (insertErr.code === "23505") {
          // Race condition — fetch existing
          const { data: dup } = await admin
            .from("messages")
            .select("id, send_status")
            .eq("client_message_id", clientMessageId)
            .maybeSingle();
          if (dup) {
            messageId = dup.id;
          } else {
            return { ok: false, message: "Erro ao criar mensagem.", data: null };
          }
        } else {
          console.error("[inbox/send] insert error:", insertErr.message, "conv:", conversationId);
          return { ok: false, message: "Erro ao criar mensagem.", data: null };
        }
      } else {
        messageId = inserted.id;
      }
    }

    // Resolve signed URL for Supabase storage media
    let resolvedMediaUrl: string | null = mediaUrl ?? null;
    if (mediaUrl?.startsWith("supabase://media/")) {
      const signedUrl = await getSignedMediaUrlForEvolution(admin, mediaUrl, 300);
      if (!signedUrl) {
        await admin
          .from("messages")
          .update({ send_status: "failed", send_error: "Falha ao gerar URL de mídia para envio." })
          .eq("id", messageId);
        revalidatePath("/inbox");
        const { data: failedMsg } = await admin.from("messages").select(MESSAGE_SELECT).eq("id", messageId).maybeSingle();
        return {
          ok: false,
          message: "Falha ao gerar URL de mídia para envio.",
          data: failedMsg as InboxMessage | null,
        };
      }
      resolvedMediaUrl = signedUrl;
    }

    // Send via Evolution
    let sendResult;
    if (messageType === "text") {
      sendResult = await sendEvolutionText({
        instanceName: instance.instance_name,
        phone,
        text: trimmedText!,
      });
    } else if (messageType === "audio") {
      if (ptt === false) {
        sendResult = await sendEvolutionMedia({
          instanceName: instance.instance_name,
          phone,
          mediaType: "audio",
          mediaUrl: resolvedMediaUrl!,
          filename: mediaFilename ?? null,
          mimetype: mediaMimetype ?? null,
        });
      } else {
        sendResult = await sendEvolutionAudio({
          instanceName: instance.instance_name,
          phone,
          audioUrl: resolvedMediaUrl!,
          ptt: true,
        });
      }
    } else {
      sendResult = await sendEvolutionMedia({
        instanceName: instance.instance_name,
        phone,
        mediaType: messageType as "image" | "video" | "document" | "sticker",
        mediaUrl: resolvedMediaUrl!,
        caption: trimmedText,
        filename: mediaFilename ?? null,
        mimetype: mediaMimetype ?? null,
      });
    }

    if (!sendResult.ok) {
      const errorMsg = sendResult.error.slice(0, 500);
      await admin
        .from("messages")
        .update({ send_status: "failed", send_error: errorMsg })
        .eq("id", messageId);
      revalidatePath("/inbox");
      const { data: failedMsg } = await admin.from("messages").select(MESSAGE_SELECT).eq("id", messageId).maybeSingle();
      return {
        ok: false,
        message: friendlyError(sendResult.error),
        data: failedMsg as InboxMessage | null,
      };
    }

    // Mark sent
    await admin
      .from("messages")
      .update({
        send_status: "sent",
        send_error: null,
        ...(sendResult.evolutionMsgId ? { evolution_msg_id: sendResult.evolutionMsgId } : {}),
      })
      .eq("id", messageId);

    // Update conversation timestamp
    await admin
      .from("conversations")
      .update({ updated_at: new Date().toISOString(), status: "open" })
      .eq("id", conversationId);

    // Cancel any pending BH auto-replies (attendant just responded)
    await admin
      .from("bh_auto_reply_queue")
      .update({ status: "cancelled", cancel_reason: "outbound_message", updated_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("status", "pending");

    // Lead event (best-effort)
    if (convRow.lead_id) {
      try {
        await admin.from("lead_events").insert({
          lead_id: convRow.lead_id,
          event_type: "whatsapp_outbound",
          description: "Mensagem enviada pelo WhatsApp via CRM Inbox.",
          metadata: { message_type: messageType, message_id: messageId },
        });
      } catch { /* best-effort */ }
    }

    revalidatePath("/inbox");

    const { data: sentMsg } = await admin.from("messages").select(MESSAGE_SELECT).eq("id", messageId).maybeSingle();
    return { ok: true, message: "Mensagem enviada.", data: sentMsg as InboxMessage | null };
  } catch (err) {
    console.error("[inbox/send] unexpected error:", err instanceof Error ? err.message : String(err));
    return { ok: false, message: "Erro inesperado ao enviar mensagem.", data: null };
  }
}

// ─── retryInboxMessageAction ──────────────────────────────────────────────────

export async function retryInboxMessageAction(
  messageId: string
): Promise<{ ok: boolean; message: string; data: InboxMessage | null }> {
  try {
    const { admin, organizationId } = await getCurrentContext();

    if (!UUID_RE.test(messageId)) return { ok: false, message: "ID inválido.", data: null };

    // Load the failed message
    const { data: msg } = await admin
      .from("messages")
      .select(
        "id, conversation_id, message_type, content, media_url, media_mimetype, media_filename, media_duration, media_ptt, client_message_id, send_status"
      )
      .eq("id", messageId)
      .maybeSingle();

    if (!msg) return { ok: false, message: "Mensagem não encontrada.", data: null };
    if (msg.send_status !== "failed") {
      return { ok: false, message: "Somente mensagens com falha podem ser reenviadas.", data: null };
    }

    // Verify conversation belongs to this org
    const { data: conv } = await admin
      .from("conversations")
      .select("id, remote_jid, lead_id, organization_id, instance:whatsapp_instances(id, instance_name, status, deleted_at)")
      .eq("id", msg.conversation_id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!conv) return { ok: false, message: "Conversa não encontrada.", data: null };

    const convRow = conv as unknown as ConvRow & { organization_id: string };
    const instance = firstInstance(convRow.instance);

    if (!instance || instance.deleted_at) {
      return { ok: false, message: "Instância WhatsApp não encontrada.", data: null };
    }
    if (instance.status !== "connected") {
      return {
        ok: false,
        message: "A instância do WhatsApp está desconectada. Reconecte para tentar novamente.",
        data: null,
      };
    }

    const phone = conv.remote_jid.split("@")[0].replace(/\D/g, "");
    if (!phone) return { ok: false, message: "Número de telefone inválido.", data: null };

    // Update to sending
    await admin.from("messages").update({ send_status: "sending", send_error: null }).eq("id", messageId);

    // Resolve signed URL
    let resolvedMediaUrl: string | null = msg.media_url;
    if (msg.media_url?.startsWith("supabase://media/")) {
      const signedUrl = await getSignedMediaUrlForEvolution(admin, msg.media_url, 300);
      if (!signedUrl) {
        await admin
          .from("messages")
          .update({ send_status: "failed", send_error: "Falha ao gerar URL de mídia para reenvio." })
          .eq("id", messageId);
        revalidatePath("/inbox");
        const { data: failedMsg } = await admin.from("messages").select(MESSAGE_SELECT).eq("id", messageId).maybeSingle();
        return { ok: false, message: "Falha ao gerar URL de mídia.", data: failedMsg as InboxMessage | null };
      }
      resolvedMediaUrl = signedUrl;
    }

    // Re-send
    let sendResult;
    const trimmedText = msg.content?.trim() ?? null;
    const msgType = msg.message_type as "text" | "image" | "audio" | "video" | "document" | "sticker";

    if (msgType === "text") {
      sendResult = await sendEvolutionText({ instanceName: instance.instance_name, phone, text: trimmedText ?? "" });
    } else if (msgType === "audio") {
      sendResult = msg.media_ptt === false
        ? await sendEvolutionMedia({
            instanceName: instance.instance_name,
            phone,
            mediaType: "audio",
            mediaUrl: resolvedMediaUrl!,
            filename: msg.media_filename ?? null,
            mimetype: msg.media_mimetype ?? null,
          })
        : await sendEvolutionAudio({
            instanceName: instance.instance_name,
            phone,
            audioUrl: resolvedMediaUrl!,
            ptt: true,
          });
    } else {
      sendResult = await sendEvolutionMedia({
        instanceName: instance.instance_name,
        phone,
        mediaType: msgType as "image" | "video" | "document" | "sticker",
        mediaUrl: resolvedMediaUrl!,
        caption: trimmedText,
        filename: msg.media_filename ?? null,
        mimetype: msg.media_mimetype ?? null,
      });
    }

    if (!sendResult.ok) {
      const errorMsg = sendResult.error.slice(0, 500);
      await admin.from("messages").update({ send_status: "failed", send_error: errorMsg }).eq("id", messageId);
      revalidatePath("/inbox");
      const { data: failedMsg } = await admin.from("messages").select(MESSAGE_SELECT).eq("id", messageId).maybeSingle();
      return { ok: false, message: friendlyError(sendResult.error), data: failedMsg as InboxMessage | null };
    }

    await admin
      .from("messages")
      .update({
        send_status: "sent",
        send_error: null,
        ...(sendResult.evolutionMsgId ? { evolution_msg_id: sendResult.evolutionMsgId } : {}),
      })
      .eq("id", messageId);

    await admin
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", msg.conversation_id);

    revalidatePath("/inbox");

    const { data: sentMsg } = await admin.from("messages").select(MESSAGE_SELECT).eq("id", messageId).maybeSingle();
    return { ok: true, message: "Mensagem reenviada.", data: sentMsg as InboxMessage | null };
  } catch (err) {
    console.error("[inbox/retry] unexpected error:", err instanceof Error ? err.message : String(err));
    return { ok: false, message: "Erro inesperado ao reenviar mensagem.", data: null };
  }
}
