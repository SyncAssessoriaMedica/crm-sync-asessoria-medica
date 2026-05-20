import { Sidebar } from "@/components/layout/sidebar";
import { Topbar, type TopbarNotification } from "@/components/layout/topbar";
import { createAdminClient, createClient } from "@/lib/supabase/server";

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

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let topbarUser;
  let sidebarUser;
  let notifications: TopbarNotification[] = [];
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email, role")
      .eq("id", user.id)
      .maybeSingle();

    topbarUser = {
      name: profile?.full_name ?? user.email ?? "Usuario",
      email: profile?.email ?? user.email ?? "",
    };
    sidebarUser = {
      ...topbarUser,
      role: profile?.role ?? "leitura",
      organizationName: "Sync Marketing",
    };

    const admin = createAdminClient();
    const { data: membership } = await admin
      .from("organization_members")
      .select("organization_id, role, organizations(name)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (membership?.organization_id) {
      const organizationId = membership.organization_id as string;
      const organization = Array.isArray(membership.organizations)
        ? membership.organizations[0] ?? null
        : membership.organizations;
      sidebarUser = {
        ...(sidebarUser ?? topbarUser),
        role: profile?.role ?? membership.role ?? "leitura",
        organizationName: organization?.name ?? "Sync Marketing",
      };
      const now = new Date().toISOString();
      const [tasksResult, conversationsResult] = await Promise.all([
        admin
          .from("lead_tasks")
          .select("id, title, due_at, lead:leads!inner(id, name, organization_id)")
          .eq("lead.organization_id", organizationId)
          .is("completed_at", null)
          .lt("due_at", now)
          .order("due_at", { ascending: true })
          .limit(4),
        admin
          .from("conversations")
          .select("id, unread_count, updated_at, lead:leads(id, name)")
          .eq("organization_id", organizationId)
          .eq("status", "open")
          .gt("unread_count", 0)
          .order("updated_at", { ascending: false })
          .limit(4),
      ]);

      const taskNotifications = ((tasksResult.data ?? []) as TaskNotificationRow[]).map((task) => {
        const lead = firstRelation(task.lead);
        return {
          id: `task-${task.id}`,
          title: "Tarefa atrasada",
          description: `${task.title}${lead?.name ? ` · ${lead.name}` : ""}`,
          href: lead?.id ? `/leads/${lead.id}` : "/leads",
          tone: "warning" as const,
        };
      });

      const conversationNotifications = ((conversationsResult.data ?? []) as ConversationNotificationRow[]).map(
        (conversation) => {
          const lead = firstRelation(conversation.lead);
          return {
            id: `conversation-${conversation.id}`,
            title: "Mensagem sem leitura",
            description: `${conversation.unread_count} mensagem(ns) pendente(s)${
              lead?.name ? ` · ${lead.name}` : ""
            }`,
            href: "/inbox",
            tone: "danger" as const,
          };
        }
      );

      notifications = [...conversationNotifications, ...taskNotifications].slice(0, 8);
    }
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
