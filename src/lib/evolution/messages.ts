// Central Evolution API send helper — server-only, never import in client code.

export type EvolutionSendResult =
  | { ok: true; evolutionMsgId?: string }
  | { ok: false; error: string; status?: number };

export type SendMediaKind = "image" | "video" | "document" | "sticker";

export function evolutionBase(): string | null {
  const raw = process.env.EVOLUTION_API_URL;
  if (!raw) return null;
  return raw.replace(/\/+$/, "").replace(/\/manager$/, "");
}

function extractEvolutionMsgId(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const r = json as Record<string, unknown>;
  const key = r.key as Record<string, unknown> | undefined;
  if (typeof key?.id === "string") return key.id;
  if (typeof r.id === "string") return r.id;
  if (typeof r.messageId === "string") return r.messageId;
  const data = r.data as Record<string, unknown> | undefined;
  if (data) {
    const dataKey = data.key as Record<string, unknown> | undefined;
    if (typeof dataKey?.id === "string") return dataKey.id;
    if (typeof data.id === "string") return data.id;
  }
  return undefined;
}

export async function sendEvolutionText(params: {
  instanceName: string;
  phone: string;
  text: string;
  delayMs?: number;
}): Promise<EvolutionSendResult> {
  const base = evolutionBase();
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!base || !apiKey) return { ok: false, error: "Evolution API não configurada." };

  const endpoint = `/message/sendText/${encodeURIComponent(params.instanceName)}`;
  try {
    const res = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({
        number: params.phone.replace(/\D/g, ""),
        text: params.text,
        delay: params.delayMs ?? 1200,
        linkPreview: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[evolution] sendText HTTP", res.status, "instance:", params.instanceName);
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}`, status: res.status };
    }

    const json = await res.json().catch(() => null);
    return { ok: true, evolutionMsgId: extractEvolutionMsgId(json) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[evolution] sendText error:", msg.slice(0, 100), "instance:", params.instanceName);
    return { ok: false, error: msg };
  }
}

export async function sendEvolutionMedia(params: {
  instanceName: string;
  phone: string;
  mediaType: SendMediaKind;
  mediaUrl: string;
  caption?: string | null;
  filename?: string | null;
  mimetype?: string | null;
  delayMs?: number;
}): Promise<EvolutionSendResult> {
  const base = evolutionBase();
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!base || !apiKey) return { ok: false, error: "Evolution API não configurada." };

  const endpoint = `/message/sendMedia/${encodeURIComponent(params.instanceName)}`;
  try {
    const body: Record<string, unknown> = {
      number: params.phone.replace(/\D/g, ""),
      mediatype: params.mediaType,
      media: params.mediaUrl,
      delay: params.delayMs ?? 1200,
    };
    if (params.caption) body.caption = params.caption;
    if (params.filename) body.fileName = params.filename;

    const res = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const respBody = await res.text().catch(() => "");
      console.error("[evolution] sendMedia HTTP", res.status, "type:", params.mediaType, "instance:", params.instanceName);
      return { ok: false, error: `HTTP ${res.status}: ${respBody.slice(0, 200)}`, status: res.status };
    }

    const json = await res.json().catch(() => null);
    return { ok: true, evolutionMsgId: extractEvolutionMsgId(json) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[evolution] sendMedia error:", msg.slice(0, 100), "type:", params.mediaType, "instance:", params.instanceName);
    return { ok: false, error: msg };
  }
}

export async function sendEvolutionAudio(params: {
  instanceName: string;
  phone: string;
  audioUrl: string;
  delayMs?: number;
}): Promise<EvolutionSendResult> {
  const base = evolutionBase();
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!base || !apiKey) return { ok: false, error: "Evolution API não configurada." };

  const endpoint = `/message/sendWhatsAppAudio/${encodeURIComponent(params.instanceName)}`;
  try {
    const res = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({
        number: params.phone.replace(/\D/g, ""),
        audio: params.audioUrl,
        delay: params.delayMs ?? 1200,
        encoding: true,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[evolution] sendAudio HTTP", res.status, "instance:", params.instanceName);
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}`, status: res.status };
    }

    const json = await res.json().catch(() => null);
    return { ok: true, evolutionMsgId: extractEvolutionMsgId(json) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[evolution] sendAudio error:", msg.slice(0, 100), "instance:", params.instanceName);
    return { ok: false, error: msg };
  }
}
