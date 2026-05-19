import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { createClient } from "@/lib/supabase/server";

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
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("name, email")
      .eq("id", user.id)
      .maybeSingle();

    topbarUser = {
      name: profile?.name ?? user.email ?? "Usuário",
      email: profile?.email ?? user.email ?? "",
    };
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background-subtle">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar user={topbarUser} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
