// Keys whose values must never appear in logs or stored payloads.
const REDACTED_KEYS = new Set([
  "password",
  "secret",
  "token",
  "key",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "x-webhook-secret",
  "x-api-key",
  "x-hub-signature",
]);

/**
 * Deep-clone a payload while redacting sensitive keys and truncating large
 * binary blobs (QR code base64 strings from the Evolution API).
 *
 * Safe to pass to any log / DB insert.
 */
export function sanitizePayload(payload: unknown, depth = 0): unknown {
  if (depth > 10 || payload === null || payload === undefined) return payload;
  if (typeof payload !== "object") return payload;

  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizePayload(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const lk = key.toLowerCase();
    if (REDACTED_KEYS.has(lk)) {
      result[key] = "[REDACTED]";
    } else if (lk === "base64" || lk === "qrcode") {
      // QR images can be hundreds of KB — store a placeholder to keep rows small.
      result[key] = typeof value === "string" ? "[QR_BASE64_OMITTED]" : value;
    } else if (lk === "media_url" || lk === "mediaurl") {
      // Media URLs from Evolution can contain short-lived signed tokens.
      result[key] = typeof value === "string" ? "[MEDIA_URL_OMITTED]" : value;
    } else {
      result[key] = sanitizePayload(value, depth + 1);
    }
  }
  return result;
}

/** Mask a phone number, preserving only the last 4 digits. */
export function maskPhone(phone: string): string {
  if (phone.length <= 4) return "****";
  return "*".repeat(phone.length - 4) + phone.slice(-4);
}

/** Mask an email address, preserving only the first character and domain. */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return "***";
  return email[0] + "***" + email.slice(atIndex);
}

/**
 * Sanitize a lead webhook payload before inserting it into lead_events.
 * Keeps useful context for debugging but masks PII.
 */
export function sanitizeLeadEventMeta(payload: {
  source?: unknown;
  organization_id?: unknown;
  [key: string]: unknown;
}): Record<string, unknown> {
  return {
    source: payload.source ?? null,
    has_email: Boolean(payload.email),
    has_phone: Boolean(payload.phone),
    has_custom_fields: Boolean(
      payload.custom_fields && typeof payload.custom_fields === "object"
    ),
  };
}
