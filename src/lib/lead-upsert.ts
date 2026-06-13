import { createAdminClient } from "@/lib/supabase/server";
import { buildLocationPayloadForOrg } from "@/lib/lead-location";

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

type LeadNameMode = "replace" | "fill_if_blank_or_phone";

type LeadInput = {
  organizationId: string;
  phone: string;
  name?: string | null;
  email?: string | null;
  sourceId?: string | null;
  stageId?: string | null;
  serviceId?: string | null;
  procedure?: string | null;
  potentialValue?: number | null;
  status?: string;
  lastInteractionAt?: string;
};

type LeadResult = {
  id: string | null;
  created: boolean;
};

function isUniqueViolation(error: unknown) {
  return (error as { code?: string } | null)?.code === "23505";
}

function normalizeName(name: string | null | undefined) {
  const value = name?.trim();
  return value || null;
}

async function buildUpdatePayload(
  admin: SupabaseAdmin,
  input: LeadInput,
  existingName: string | null,
  locationManuallyEdited: boolean,
  nameMode: LeadNameMode
) {
  const payload: Record<string, unknown> = {
    last_interaction_at: input.lastInteractionAt ?? new Date().toISOString(),
  };

  const name = normalizeName(input.name);
  if (name) {
    const shouldReplace = nameMode === "replace";
    const shouldFill = !existingName || existingName === input.phone;
    if (shouldReplace || shouldFill) payload.name = name;
  }

  if (input.email !== undefined) payload.email = input.email;
  if (input.sourceId !== undefined) payload.source_id = input.sourceId;
  if (input.serviceId !== undefined) payload.service_id = input.serviceId;
  if (input.procedure !== undefined) payload.procedure = input.procedure;
  if (input.potentialValue !== undefined) payload.potential_value = input.potentialValue;

  Object.assign(
    payload,
    await buildLocationPayloadForOrg(admin, input.organizationId, input.phone, locationManuallyEdited)
  );

  return payload;
}

async function fetchLeadByPhone(admin: SupabaseAdmin, organizationId: string, phone: string) {
  const { data, error } = await admin
    .from("leads")
    .select("id, name, location_manually_edited")
    .eq("organization_id", organizationId)
    .eq("phone", phone)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as { id: string; name: string | null; location_manually_edited: boolean | null } | null;
}

export async function createOrUpdateLeadByPhone(
  admin: SupabaseAdmin,
  input: LeadInput,
  options: {
    createIfMissing?: boolean;
    nameMode?: LeadNameMode;
  } = {}
): Promise<LeadResult> {
  const createIfMissing = options.createIfMissing ?? true;
  const nameMode = options.nameMode ?? "replace";
  const existing = await fetchLeadByPhone(admin, input.organizationId, input.phone);

  if (existing?.id) {
    const updates = await buildUpdatePayload(
      admin,
      input,
      existing.name,
      existing.location_manually_edited === true,
      nameMode
    );
    await admin.from("leads").update(updates).eq("id", existing.id);
    return { id: existing.id, created: false };
  }

  if (!createIfMissing) return { id: null, created: false };

  const now = input.lastInteractionAt ?? new Date().toISOString();
  const locationPayload = await buildLocationPayloadForOrg(admin, input.organizationId, input.phone);
  const { data, error } = await admin
    .from("leads")
    .insert({
      organization_id: input.organizationId,
      name: normalizeName(input.name) ?? input.phone,
      phone: input.phone,
      email: input.email ?? null,
      source_id: input.sourceId ?? null,
      stage_id: input.stageId ?? null,
      service_id: input.serviceId ?? null,
      procedure: input.procedure ?? null,
      potential_value: input.potentialValue ?? null,
      status: input.status ?? "new",
      last_interaction_at: now,
      ...locationPayload,
    })
    .select("id")
    .single();

  if (!error && data?.id) return { id: data.id as string, created: true };

  if (!isUniqueViolation(error)) throw error;

  // Race-safe fallback: another request inserted the same org+phone first.
  const raced = await fetchLeadByPhone(admin, input.organizationId, input.phone);
  if (!raced?.id) throw error;

  const updates = await buildUpdatePayload(
    admin,
    input,
    raced.name,
    raced.location_manually_edited === true,
    nameMode
  );
  await admin.from("leads").update(updates).eq("id", raced.id);
  return { id: raced.id, created: false };
}
