"use client";

import { Bell, Search, ChevronDown, Calendar, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, getInitials } from "@/lib/utils";
import { logoutAction } from "@/lib/actions/auth";

const periods = [
  { label: "Hoje", value: "today" },
  { label: "7 dias", value: "7d" },
  { label: "30 dias", value: "30d" },
  { label: "Este mês", value: "month" },
  { label: "Personalizado", value: "custom" },
];

export interface TopbarUser {
  name: string;
  email: string;
}

interface TopbarProps {
  title?: string;
  subtitle?: string;
  user?: TopbarUser;
}

export function Topbar({ title, subtitle, user }: TopbarProps) {
  const displayName = user?.name ?? "Usuário";
  const displayEmail = user?.email ?? "";
  const initials = getInitials(displayName);

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-white px-6">
      {/* Page title */}
      {title && (
        <div className="mr-2 hidden md:block">
          <p className="text-sm font-semibold text-text-primary leading-none">
            {title}
          </p>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-text-muted">{subtitle}</p>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          placeholder="Buscar lead, conversa..."
          className={cn(
            "h-8 w-full rounded-lg border border-border bg-background-subtle pl-8 pr-3 text-xs text-text-primary placeholder:text-text-muted",
            "focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-brand-green"
          )}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Period selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" className="gap-1.5 h-8 text-xs">
              <Calendar className="h-3.5 w-3.5" />
              30 dias
              <ChevronDown className="h-3 w-3 text-text-muted" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuLabel>Período</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {periods.map((p) => (
              <DropdownMenuItem
                key={p.value}
                className={cn(
                  p.value === "30d" && "text-brand-green-dark font-medium"
                )}
              >
                {p.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Notifications */}
        <Button variant="ghost" size="icon-sm" className="relative h-8 w-8">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-danger-red" />
        </Button>

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-background-subtle transition-colors">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
              </Avatar>
              <span className="hidden text-xs font-medium text-text-primary md:block">
                {displayName}
              </span>
              <ChevronDown className="h-3 w-3 text-text-muted" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                <p className="text-xs font-semibold text-text-primary">
                  {displayName}
                </p>
                <p className="text-[10px] text-text-muted">{displayEmail}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Perfil</DropdownMenuItem>
            <DropdownMenuItem>Configurações</DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Logout — usa Server Action diretamente via form */}
            <DropdownMenuItem asChild>
              <form action={logoutAction} className="w-full">
                <button
                  type="submit"
                  className="flex w-full items-center gap-2 text-danger-red"
                >
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
