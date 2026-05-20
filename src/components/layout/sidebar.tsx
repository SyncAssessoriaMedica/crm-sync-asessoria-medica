"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  ChevronDown,
  LayoutDashboard,
  MessageSquare,
  Settings,
  Shield,
  TrendingUp,
  Users,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const navItems = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    roles: ["super_admin", "gestor_sync", "admin_clinica", "atendente", "leitura"],
  },
  {
    label: "Leads",
    href: "/leads",
    icon: Users,
    roles: ["super_admin", "gestor_sync", "admin_clinica", "atendente"],
  },
  {
    label: "Inbox WhatsApp",
    href: "/inbox",
    icon: MessageSquare,
    roles: ["super_admin", "gestor_sync", "admin_clinica", "atendente"],
  },
  {
    label: "Administrador",
    href: "/admin",
    icon: Shield,
    roles: ["super_admin", "gestor_sync", "admin_clinica"],
  },
  {
    label: "Configuracoes",
    href: "/settings",
    icon: Settings,
    roles: ["super_admin", "gestor_sync", "admin_clinica"],
  },
];

type SidebarProps = {
  user?: {
    name: string;
    email: string;
    role: string;
    organizationName: string;
  };
};

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const role = user?.role ?? "leitura";
  const visibleItems = navItems.filter((item) => item.roles.includes(role));

  return (
    <aside className="flex h-screen w-60 flex-shrink-0 flex-col bg-sidebar-dark">
      <div className="flex h-14 items-center gap-3 border-b border-white/10 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-green">
          <TrendingUp className="h-4 w-4 text-sidebar-dark" strokeWidth={2.5} />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-[11px] font-black uppercase tracking-[0.18em] text-white">Sync</span>
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/40">Marketing CRM</span>
        </div>
      </div>

      <div className="mx-3 my-3">
        <button className="flex w-full items-center gap-2.5 rounded-lg bg-white/6 px-3 py-2.5 text-left transition-colors hover:bg-white/10">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-green/20">
            <Building2 className="h-3.5 w-3.5 text-brand-green" />
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-xs font-semibold text-white">{user?.organizationName ?? "Sync Marketing"}</p>
            <p className="text-[10px] text-white/40">{roleLabel(role)}</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-white/40" />
        </button>
      </div>

      <ScrollArea className="flex-1 px-3 sidebar-scroll">
        <nav className="flex flex-col gap-0.5 py-1">
          <p className="label-eyebrow px-2 py-2 text-white/30">Menu</p>
          {visibleItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  isActive ? "bg-brand-green text-sidebar-dark" : "text-white/60 hover:bg-white/8 hover:text-white"
                )}
              >
                <item.icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    isActive ? "text-sidebar-dark" : "text-white/40 group-hover:text-white/80"
                  )}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-green/20 text-[11px] font-bold text-brand-green">
            {getInitials(user?.name ?? "Sync")}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-xs font-semibold text-white">{user?.name ?? "Usuario"}</p>
            <p className="truncate text-[10px] text-white/40">{user?.email ?? ""}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function getInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    super_admin: "Super Admin Sync",
    gestor_sync: "Gestor Sync",
    admin_clinica: "Admin Clinica",
    atendente: "Atendente",
    leitura: "Leitura",
  };
  return labels[role] ?? role;
}
