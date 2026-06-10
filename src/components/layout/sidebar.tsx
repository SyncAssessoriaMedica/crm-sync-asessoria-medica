"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  Building2,
  ChevronDown,
  Clock,
  Columns3,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { switchActiveOrganizationAction } from "./actions";

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
    label: "Kanban",
    href: "/kanban",
    icon: Columns3,
    roles: ["super_admin", "gestor_sync", "admin_clinica", "atendente"],
  },
  {
    label: "Inbox WhatsApp",
    href: "/inbox",
    icon: MessageSquare,
    roles: ["super_admin", "gestor_sync", "admin_clinica", "atendente"],
  },
  {
    label: "Follow-up Auto",
    href: "/follow-up",
    icon: Clock,
    roles: ["super_admin", "gestor_sync", "admin_clinica"],
  },
  {
    label: "Mensagens rapidas",
    href: "/admin/mensagens-rapidas",
    icon: MessagesSquare,
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
    organizationId?: string;
    organizations?: { id: string; name: string }[];
    canSwitchOrganization?: boolean;
  };
};

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const role = user?.role ?? "leitura";
  const visibleItems = navItems.filter((item) => item.roles.includes(role));
  const canSwitch = Boolean(
    user?.canSwitchOrganization && user.organizations && user.organizations.length > 1
  );

  useEffect(() => {
    if (!isOpen) return;
    function handleMouseDown(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);


  function handleSelect(orgId: string) {
    setIsOpen(false);
    startTransition(async () => {
      const result = await switchActiveOrganizationAction(orgId);
      if (result.ok) router.refresh();
    });
  }

  function handleNavClick(href: string) {
    if (pathname === href || pathname.startsWith(`${href}/`)) return;
    setPendingHref(href);
  }

  return (
    <aside className="flex h-screen w-60 flex-shrink-0 flex-col bg-sidebar-dark">
      {/* ── Brand ───────────────────────────────────────────── */}
      <div className="flex h-14 items-center border-b border-white/10 px-4">
        <Image
          src="/logo_sync-marketing-cropped.png"
          alt="Sync Marketing"
          width={112}
          height={42}
          className="h-7 w-auto object-contain"
          priority
        />
        <div className="ml-2.5 flex h-6 items-center border-l border-white/15 pl-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/55">
            CRM
          </span>
        </div>
      </div>

      {/* ── Clinic selector ─────────────────────────────────── */}
      <div ref={dropdownRef} className="relative mx-3 my-3">
        <button
          type="button"
          aria-expanded={canSwitch ? isOpen : undefined}
          aria-haspopup={canSwitch ? "listbox" : undefined}
          onClick={canSwitch && !isPending ? () => setIsOpen((v) => !v) : undefined}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg bg-white/6 px-3 py-2.5 text-left transition-colors",
            canSwitch && !isPending && "cursor-pointer hover:bg-white/10",
            isPending && "cursor-wait opacity-60",
            !canSwitch && "cursor-default"
          )}
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-green/20">
            <Building2 className="h-3.5 w-3.5 text-brand-green" />
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-xs font-semibold text-white">
              {user?.organizationName ?? "Sync Marketing"}
            </p>
            <p className="text-[10px] text-white/40">{roleLabel(role)}</p>
          </div>
          {canSwitch && (
            isPending ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-white/40" />
            ) : (
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-white/40 transition-transform duration-200",
                  isOpen && "rotate-180"
                )}
              />
            )
          )}
        </button>

        {canSwitch && isOpen && (
          <div
            role="listbox"
            aria-label="Selecionar clinica ativa"
            className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-lg border border-white/10 bg-[#0d1f14] shadow-lg"
          >
            {user?.organizations?.map((org) => {
              const isActive = org.id === user.organizationId;
              return (
                <button
                  key={org.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={isPending}
                  onClick={() => handleSelect(org.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs transition-colors disabled:cursor-wait",
                    isActive
                      ? "bg-brand-green/15 text-brand-green"
                      : "text-white/70 hover:bg-white/8 hover:text-white"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      isActive ? "bg-brand-green" : "bg-white/20"
                    )}
                  />
                  {org.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Navigation ──────────────────────────────────────── */}
      <ScrollArea className="flex-1 px-3 sidebar-scroll">
        <nav className="flex flex-col gap-0.5 py-1">
          <p className="label-eyebrow px-2 py-2 text-white/30">Menu</p>
          {visibleItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
            const isItemPending =
              pendingHref === item.href &&
              !(pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`)));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => handleNavClick(item.href)}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-brand-green text-sidebar-dark"
                    : "text-white/60 hover:bg-white/8 hover:text-white",
                  isItemPending && !isActive && "opacity-70"
                )}
              >
                {isItemPending && !isActive ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/60" />
                ) : (
                  <item.icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      isActive ? "text-sidebar-dark" : "text-white/40 group-hover:text-white/80"
                    )}
                  />
                )}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      {/* ── User footer ─────────────────────────────────────── */}
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
