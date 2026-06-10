export const QUICK_MESSAGE_TYPES = ["text", "image", "audio", "video", "document", "sticker"] as const;
export type QuickMessageType = (typeof QUICK_MESSAGE_TYPES)[number];

export type QuickMessage = {
  id: string;
  title: string;
  shortcut: string;
  message_type: QuickMessageType;
  content: string | null;
  media_url: string | null;
  media_mimetype: string | null;
  media_filename: string | null;
  media_duration: number | null;
  media_ptt: boolean | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export const QUICK_MESSAGE_VARIABLES = [
  { key: "nome", label: "Nome completo", example: "Mariana Souza" },
  { key: "primeiro_nome", label: "Primeiro nome", example: "Mariana" },
  { key: "telefone", label: "Telefone", example: "(11) 98765-4321" },
  { key: "procedimento", label: "Procedimento ou servico", example: "Consulta inicial" },
  { key: "data_agendamento", label: "Data do agendamento", example: "15/06/2026 as 14:30" },
  { key: "cidade", label: "Cidade", example: "Sao Paulo" },
  { key: "estado", label: "Estado", example: "SP" },
] as const;

export type QuickMessageVariable = (typeof QUICK_MESSAGE_VARIABLES)[number]["key"];
const ALLOWED_VARIABLES = new Set<string>(QUICK_MESSAGE_VARIABLES.map((variable) => variable.key));
const VARIABLE_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
const ANY_BRACES_RE = /\{\{([^{}]*)\}\}/g;

export function normalizeQuickMessageShortcut(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function validateQuickMessageVariables(content: string | null | undefined) {
  const text = content ?? "";
  const invalid = new Set<string>();
  for (const match of text.matchAll(ANY_BRACES_RE)) {
    const key = match[1].trim().toLowerCase();
    if (!ALLOWED_VARIABLES.has(key)) invalid.add(key || "(vazia)");
  }
  const withoutValidTokens = text.replace(ANY_BRACES_RE, "");
  if (withoutValidTokens.includes("{{") || withoutValidTokens.includes("}}")) {
    invalid.add("formato invalido");
  }
  return Array.from(invalid);
}

export function renderQuickMessageVariables(
  content: string | null | undefined,
  values: Partial<Record<QuickMessageVariable, string | null | undefined>>
) {
  const missing = new Set<QuickMessageVariable>();
  const text = (content ?? "").replace(VARIABLE_RE, (_full, rawKey: string) => {
    const key = rawKey.toLowerCase() as QuickMessageVariable;
    if (!ALLOWED_VARIABLES.has(key)) return `{{${rawKey}}}`;
    const value = values[key]?.trim();
    if (!value) {
      missing.add(key);
      return `{{${key}}}`;
    }
    return value;
  });
  return { text, missing: Array.from(missing) };
}

export function renderQuickMessagePreview(content: string | null | undefined) {
  const examples = Object.fromEntries(
    QUICK_MESSAGE_VARIABLES.map((variable) => [variable.key, variable.example])
  ) as Record<QuickMessageVariable, string>;
  return renderQuickMessageVariables(content, examples).text;
}
