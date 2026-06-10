import { NextResponse } from "next/server";
import { getOrganizationContext } from "@/lib/organization-context";
import { canAccessRoute } from "@/lib/permissions";

export async function GET() {
  try {
    const context = await getOrganizationContext();
    if (!canAccessRoute(context.role, "/inbox")) {
      return NextResponse.json({ ok: false, error: "Sem permissao." }, { status: 403 });
    }
    const { data, error } = await context.admin
      .from("quick_messages")
      .select("id, title, shortcut, message_type, content, media_url, media_mimetype, media_filename, media_duration, media_ptt, active, created_at, updated_at")
      .eq("organization_id", context.organizationId)
      .eq("active", true)
      .is("deleted_at", null)
      .order("title", { ascending: true });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, messages: data ?? [] });
  } catch {
    return NextResponse.json({ ok: false, error: "Nao foi possivel carregar mensagens rapidas." }, { status: 500 });
  }
}
