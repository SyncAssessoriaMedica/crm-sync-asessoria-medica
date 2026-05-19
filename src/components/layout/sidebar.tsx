"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Settings,
  Shield,
  TrendingUp,
  ChevronDown,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

const navItems = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Leads",
    href: "/leads",
    icon: Users,
  },
  {
    label: "Inbox WhatsApp",
    href: "/inbox",
    icon: MessageSquare,
  },
  {
    label: "Administrador",
    href: "/admin",
    icon: Shield,
  },
  {
    label: "Configurações",
    href: "/settings",
    icon: Settings,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 flex-shrink-0 flex-col bg-sidebar-dark">
      {/* Logo */}
      <div className="flex h-14 items-center gap-3 border-b border-white/10 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-green">
          <TrendingUp className="h-4 w-4 text-sidebar-dark" strokeWidth={2.5} />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-[11px] font-black uppercase tracking-[0.18em] text-white">
            Sync
          </span>
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/40">
            Marketing CRM
          </span>
        </div>
      </div>

      {/* Clinic selector */}
      <div className="mx-3 my-3">
        <button className="flex w-full items-center gap-2.5 rounded-lg bg-white/6 px-3 py-2.5 text-left transition-colors hover:bg-white/10">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-green/20">
            <Building2 className="h-3.5 w-3.5 text-brand-green" />
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-xs font-semibold text-white">
              Clínica Dr. Mendes
            </p>
            <p className="text-[10px] text-white/40">São Paulo · SP</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-white/40" />
        </button>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 sidebar-scroll">
        <nav className="flex flex-col gap-0.5 py-1">
          <p className="label-eyebrow px-2 py-2 text-white/30">Menu</p>
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-brand-green text-sidebar-dark"
                    : "text-white/60 hover:bg-white/8 hover:text-white"
                )}
              >
                <item.icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    isActive
                      ? "text-sidebar-dark"
                      : "text-white/40 group-hover:text-white/80"
                  )}
                />
                {item.label}
                {item.href === "/inbox" && (
                  <span className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-danger-red text-[9px] font-bold text-white">
                    3
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      {/* User area */}
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-green/20 text-[11px] font-bold text-brand-green">
            GS
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-xs font-semibold text-white">
              Gestor Sync
            </p>
            <p className="text-[10px] text-white/40">gestor@syncmarketing.com</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
