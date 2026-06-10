import { AccessDenied } from "@/components/layout/access-denied";
import { getOrganizationContext } from "@/lib/organization-context";
import { canAccessRoute } from "@/lib/permissions";
import type { QuickMessage } from "@/lib/quick-messages";
import { QuickMessagesClient } from "./quick-messages-client";

export const dynamic = "force-dynamic";

export default async function QuickMessagesPage() {
  const context = await getOrganizationContext();
  if (!canAccessRoute(context.role, "/admin/mensagens-rapidas")) return <AccessDenied />;

  const { data, error } = await context.admin
    .from("quick_messages")
    .select("id, title, shortcut, message_type, content, media_url, media_mimetype, media_filename, media_duration, media_ptt, active, created_at, updated_at")
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .order("active", { ascending: false })
    .order("title", { ascending: true });

  return (
    <QuickMessagesClient
      initialMessages={(data ?? []) as QuickMessage[]}
      loadError={error?.message ?? null}
    />
  );
}
