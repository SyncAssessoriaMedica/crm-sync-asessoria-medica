"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell, Calendar, ChevronDown, LogOut, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/lib/actions/auth";
import { cn, getInitials } from "@/lib/utils";

const periods = [
  { label: "Hoje", value: "today" },
  { label: "7 dias", value: "7d" },
  { label: "30 dias", value: "30d" },
  { label: "Este mes", value: "month" },
];

export interface TopbarUser {
  name: string;
  email: string;
}

export interface TopbarNotification {
  id: string;
  title: string;
  description: string;
  href: string;
  tone: "danger" | "warning" | "info";
}

interface TopbarProps {
  title?: string;
  subtitle?: string;
  user?: TopbarUser;
  notifications?: TopbarNotification[];
}

export function Topbar({ title, subtitle, user, notifications = [] }: TopbarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedPeriod = searchParams.get("period") ?? "30d";
  const selectedPeriodLabel = periods.find((period) => period.value === selectedPeriod)?.label ?? "30 dias";
  const displayName = user?.name ?? "Usuario";
  const displayEmail = user?.email ?? "";
  const initials = getInitials(displayName);
  const notificationCount = notifications.length;

  function periodHref(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", value);
    return `/dashboard?${params.toString()}`;
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-white px-6">
      {title && (
        <div className="mr-2 hidden md:block">
          <p className="text-sm font-semibold leading-none text-text-primary">{title}</p>
          {subtitle && <p className="mt-0.5 text-[11px] text-text-muted">{subtitle}</p>}
        </div>
      )}

      <div className="relative max-w-xs flex-1">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          placeholder="Buscar lead, conversa..."
          className={cn(
            "h-8 w-full rounded-lg border border-border bg-background-subtle pl-8 pr-3 text-xs text-text-primary placeholder:text-text-muted",
            "focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green"
          )}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" className="h-8 gap-1.5 text-xs">
              <Calendar className="h-3.5 w-3.5" />
              {selectedPeriodLabel}
              <ChevronDown className="h-3 w-3 text-text-muted" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuLabel>Periodo</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {periods.map((period) => (
              <DropdownMenuItem key={period.value} asChild>
                <Link
                  href={periodHref(period.value)}
                  className={cn(
                    pathname === "/dashboard" &&
                      period.value === selectedPeriod &&
                      "font-medium text-brand-green-dark"
                  )}
                >
                  {period.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="relative h-8 w-8">
              <Bell className="h-4 w-4" />
              {notificationCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-red px-1 text-[9px] font-bold text-white">
                  {notificationCount > 9 ? "9+" : notificationCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Notificacoes</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notificationCount === 0 && (
              <div className="px-3 py-5 text-center text-xs text-text-muted">
                Nenhuma notificacao pendente.
              </div>
            )}
            {notifications.map((notification) => (
              <DropdownMenuItem key={notification.id} asChild>
                <Link href={notification.href} className="flex items-start gap-2 py-2">
                  <span
                    className={cn(
                      "mt-1 h-2 w-2 shrink-0 rounded-full",
                      notification.tone === "danger" && "bg-danger-red",
                      notification.tone === "warning" && "bg-warning-amber",
                      notification.tone === "info" && "bg-brand-green"
                    )}
                  />
                  <span>
                    <span className="block text-xs font-semibold text-text-primary">{notification.title}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">
                      {notification.description}
                    </span>
                  </span>
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-background-subtle">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
              </Avatar>
              <span className="hidden text-xs font-medium text-text-primary md:block">{displayName}</span>
              <ChevronDown className="h-3 w-3 text-text-muted" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                <p className="text-xs font-semibold text-text-primary">{displayName}</p>
                <p className="text-[10px] text-text-muted">{displayEmail}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Perfil</DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings">Configuracoes</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <form action={logoutAction} className="w-full">
                <button type="submit" className="flex w-full items-center gap-2 text-danger-red">
                  <LogOut className="h-3.5 w-3.5" />
                  Sair
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
