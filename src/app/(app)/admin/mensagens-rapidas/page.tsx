import { AccessDenied } from "@/components/layout/access-denied";
import { getOrganizationContext } from "@/lib/organization-context";
import { canAccessRoute } from "@/lib/permissions";
import type { QuickMessage } from "@/lib/quick-messages";
import { listQuickMessages } from "@/lib/quick-message-store";
import { QuickMessagesClient } from "./quick-messages-client";

export const dynamic = "force-dynamic";

export default async function QuickMessagesPage() {
  const context = await getOrganizationContext();
  if (!canAccessRoute(context.role, "/admin/mensagens-rapidas")) return <AccessDenied />;

  const { data, error } = await listQuickMessages(context.admin, context.organizationId);

  return (
    <QuickMessagesClient
      initialMessages={(data ?? []) as QuickMessage[]}
      loadError={error?.message ?? null}
    />
  );
}
