import { Sidebar } from "@/components/layout/sidebar";
import { Topbar, type TopbarNotification } from "@/components/layout/topbar";
import { canAccessRoute } from "@/lib/permissions";
import { getOrganizationContext } from "@/lib/organization-context";

type TaskNotificationRow = {
  id: string;
  title: string;
  due_at: string | null;
  lead: { id: string; name: string; organization_id: string } | { id: string; name: string; organization_id: string }[] | null;
};

type ConversationNotificationRow = {
  id: string;
  unread_count: number;
  updated_at: string;
  lead: { id: string; name: string | null } | { id: string; name: string | null }[] | null;
};

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let topbarUser;
  let sidebarUser;
  let notifications: TopbarNotification[] = [];
  try {
    const context = await getOrganizationContext();
    const { admin, profile, user, organization, organizationId, role, organizations, isSyncAdmin } = context;
    topbarUser = {
      name: profile?.full_name ?? user.email ?? "Usuario",
      email: profile?.email ?? user.email ?? "",
    };
    sidebarUser = {
      ...topbarUser,
      role,
      organizationId,
      organizationName: organization.name ?? "Sync Marketing",
      organizations: organizations.map((org) => ({ id: org.id, name: org.name })),
      canSwitchOrganization: isSyncAdmin,
    };

      const canViewLeads = canAccessRoute(role, "/leads");
      const canViewInbox = canAccessRoute(role, "/inbox");

      const now = new Date().toISOString();
      const [tasksResult, conversationsResult] = await Promise.all([
        canViewLeads
          ? admin
              .from("lead_tasks")
              .select("id, title, due_at, lead:leads!inner(id, name, organization_id)")
              .eq("lead.organization_id", organizationId)
              .is("completed_at", null)
              .lt("due_at", now)
              .order("due_at", { ascending: true })
              .limit(4)
          : Promise.resolve({ data: null }),
        canViewInbox
          ? admin
              .from("conversations")
              .select("id, unread_count, updated_at, lead:leads(id, name)")
              .eq("organization_id", organizationId)
              .eq("status", "open")
              .gt("unread_count", 0)
              .order("updated_at", { ascending: false })
              .limit(4)
          : Promise.resolve({ data: null }),
      ]);

      const taskNotifications = canViewLeads
        ? ((tasksResult.data ?? []) as TaskNotificationRow[]).map((task) => {
            const lead = firstRelation(task.lead);
            return {
              id: `task-${task.id}`,
              title: "Tarefa atrasada",
              description: `${task.title}${lead?.name ? ` · ${lead.name}` : ""}`,
              href: lead?.id ? `/leads/${lead.id}` : "/leads",
              tone: "warning" as const,
            };
          })
        : [];

      const conversationNotifications = canViewInbox
        ? ((conversationsResult.data ?? []) as ConversationNotificationRow[]).map((conversation) => {
            const lead = firstRelation(conversation.lead);
            return {
              id: `conversation-${conversation.id}`,
              title: "Mensagem sem leitura",
              description: `${conversation.unread_count} mensagem(ns) pendente(s)${lead?.name ? ` · ${lead.name}` : ""}`,
              href: "/inbox",
              tone: "danger" as const,
            };
          })
        : [];

      notifications = [...conversationNotifications, ...taskNotifications].slice(0, 8);
  } catch {
    // As paginas internas tratam login/acesso; aqui mantemos o layout renderizavel.
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background-subtle">
      <Sidebar user={sidebarUser} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar user={topbarUser} notifications={notifications} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
