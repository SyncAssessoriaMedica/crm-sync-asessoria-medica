import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Mail, Shield, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getInitials } from "@/lib/utils";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: profile }, { data: membership }] = await Promise.all([
    admin.from("profiles").select("email, full_name, role, created_at").eq("id", user.id).maybeSingle(),
    admin
      .from("organization_members")
      .select("role, organizations(name, slug, subscription_status)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const organization = membership?.organizations as
    | { name?: string; slug?: string; subscription_status?: string }
    | null
    | undefined;
  const name = profile?.full_name ?? user.email ?? "Usuario";
  const email = profile?.email ?? user.email ?? "";
  const role = membership?.role ?? profile?.role ?? "sem perfil";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <p className="label-eyebrow text-text-muted">Conta</p>
        <h1 className="mt-1 text-2xl font-black text-text-primary">Perfil</h1>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-5 pt-6 md:flex-row md:items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-green-soft text-xl font-black text-brand-green-deep">
            {getInitials(name)}
          </div>
          <div className="flex-1">
            <p className="text-lg font-black text-text-primary">{name}</p>
            <p className="mt-1 text-sm text-text-muted">{email}</p>
          </div>
          <div className="rounded-lg border border-brand-green/30 bg-brand-green-soft px-3 py-2 text-xs font-semibold text-brand-green-deep">
            {role}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-brand-green" />
              Dados do usuario
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Info label="Nome" value={name} />
            <Info label="Email" value={email} icon={<Mail className="h-3.5 w-3.5" />} />
            <Info label="Perfil global" value={profile?.role ?? "-"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Shield className="h-4 w-4 text-brand-green" />
              Organizacao ativa
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Info label="Organizacao" value={organization?.name ?? "-"} />
            <Info label="Slug" value={organization?.slug ?? "-"} />
            <Info label="Status" value={organization?.subscription_status ?? "-"} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Info({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div>
      <p className="label-eyebrow text-text-muted">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 text-text-primary">
        {icon}
        {value}
      </p>
    </div>
  );
}
