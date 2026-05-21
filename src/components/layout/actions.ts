"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { ACTIVE_ORGANIZATION_COOKIE, getOrganizationContext } from "@/lib/organization-context";

export async function switchActiveOrganizationAction(organizationId: string) {
  const context = await getOrganizationContext();
  if (!context.isSyncAdmin) {
    return { ok: false, message: "Apenas a equipe Sync pode alternar entre clinicas." };
  }

  const canUseOrganization = context.organizations.some((organization) => organization.id === organizationId);
  if (!canUseOrganization) {
    return { ok: false, message: "Clinica nao encontrada." };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORGANIZATION_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });

  revalidatePath("/", "layout");
  return { ok: true, message: "Clinica ativa alterada." };
}
