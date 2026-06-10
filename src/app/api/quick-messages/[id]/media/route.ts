import { NextRequest, NextResponse } from "next/server";
import { getOrganizationContext } from "@/lib/organization-context";
import { canAccessRoute } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new NextResponse("Nao autorizado.", { status: 401 });
    const context = await getOrganizationContext();
    if (!canAccessRoute(context.role, "/inbox")) return new NextResponse("Sem permissao.", { status: 403 });
    const { id } = await params;
    const { data } = await context.admin
      .from("quick_messages")
      .select("media_url")
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data?.media_url?.startsWith("supabase://media/")) return new NextResponse("Midia nao encontrada.", { status: 404 });
    const path = data.media_url.slice("supabase://media/".length);
    const { data: signed } = await context.admin.storage.from("media").createSignedUrl(path, 300);
    if (!signed?.signedUrl) return new NextResponse("Midia indisponivel.", { status: 404 });
    return NextResponse.redirect(signed.signedUrl);
  } catch {
    return new NextResponse("Erro ao carregar midia.", { status: 500 });
  }
}
