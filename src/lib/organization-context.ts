import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const ACTIVE_ORGANIZATION_COOKIE = "sync_active_organization_id";

const SYNC_ROLES = new Set(["super_admin", "gestor_sync"]);

type OrganizationRow = {
  id: string;
  name: string;
  slug?: string | null;
  logo_url?: string | null;
  subscription_status?: string | null;
};

type MembershipRow = {
  organization_id: string;
  role: string;
  organizations: OrganizationRow | OrganizationRow[] | null;
};

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function getOrganizationContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: profile }, membershipsResult, organizationsResult] = await Promise.all([
    admin.from("profiles").select("full_name, email, role").eq("id", user.id).maybeSingle(),
    admin
      .from("organization_members")
      .select("organization_id, role, organizations(id, name, slug, logo_url, subscription_status)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    admin
      .from("organizations")
      .select("id, name, slug, logo_url, subscription_status")
      .order("name", { ascending: true }),
  ]);

  const memberships = (membershipsResult.data ?? []) as MembershipRow[];
  const primaryMembership = memberships[0] ?? null;
  if (!primaryMembership) {
    throw new Error("Usuario sem organizacao configurada.");
  }

  // isSyncAdmin is derived from profiles.role — a global, system-level attribute.
  // This is intentional: sync staff have cross-org access regardless of which
  // org is active.
  const profileRole = (profile?.role ?? primaryMembership.role ?? "leitura") as string;
  const isSyncAdmin = SYNC_ROLES.has(profileRole);

  const availableOrganizations = isSyncAdmin
    ? ((organizationsResult.data ?? []) as OrganizationRow[])
    : memberships.map((membership) => firstRelation(membership.organizations)).filter(Boolean) as OrganizationRow[];

  const cookieStore = await cookies();
  const requestedOrganizationId = cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value;
  const requestedOrganization = availableOrganizations.find((org) => org.id === requestedOrganizationId);
  const primaryOrganization = firstRelation(primaryMembership.organizations);
  const organization =
    requestedOrganization ??
    primaryOrganization ??
    availableOrganizations[0] ??
    null;

  if (!organization?.id) {
    throw new Error("Organizacao ativa nao encontrada.");
  }

  // Effective role for the ACTIVE organization:
  // - Sync staff keep their global profile role (cross-org access).
  // - Clinic users use their membership role in the currently active org,
  //   so switching from org A (admin_clinica) to org B (atendente) correctly
  //   reduces permissions without requiring a profile update.
  let effectiveRole: string;
  if (isSyncAdmin) {
    effectiveRole = profileRole;
  } else {
    const activeMembership =
      memberships.find((m) => m.organization_id === organization.id) ?? primaryMembership;
    effectiveRole = (activeMembership.role as string) ?? profileRole;
  }

  return {
    admin,
    user,
    profile,
    membership: primaryMembership,
    memberships,
    role: effectiveRole,
    membershipRole: primaryMembership.role,
    isSyncAdmin,
    organization,
    organizationId: organization.id,
    organizations: availableOrganizations,
  };
}

export function canManageActiveOrganization(context: Awaited<ReturnType<typeof getOrganizationContext>>) {
  return context.isSyncAdmin || context.membershipRole === "admin_clinica";
}
