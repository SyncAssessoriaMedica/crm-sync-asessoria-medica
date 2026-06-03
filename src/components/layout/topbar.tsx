"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, Calendar, ChevronDown, Loader2, LogOut } from "lucide-react";
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
import { formatDateParam, getDateRangeFromParams, PERIOD_OPTIONS, type DatePeriod } from "@/lib/date-range";
import { cn, getInitials } from "@/lib/utils";

// Rotas onde o seletor de periodo faz sentido (consomem ?period= de verdade)
const PERIOD_ROUTES = new Set(["/dashboard", "/leads", "/inbox"]);

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedPeriod = (searchParams.get("period") ?? "30d") as DatePeriod;
  const selectedStart = searchParams.get("start");
  const selectedEnd = searchParams.get("end");
  const [isPeriodPending, startPeriodTransition] = useTransition();
  const activeRange = getDateRangeFromParams({
    period: selectedPeriod,
    start: selectedStart,
    end: selectedEnd,
  });
  const selectedPeriodLabel =
    activeRange.period === "custom"
      ? activeRange.label
      : PERIOD_OPTIONS.find((p) => p.value === activeRange.period)?.label ?? "30 dias";
  const [showCustomRange, setShowCustomRange] = useState(activeRange.period === "custom");
  const [customStart, setCustomStart] = useState(formatDateParam(activeRange.start));
  const [customEnd, setCustomEnd] = useState(formatDateParam(new Date(activeRange.end.getTime() - 1)));
  const displayName = user?.name ?? "Usuario";
  const displayEmail = user?.email ?? "";
  const initials = getInitials(displayName);
  const notificationCount = notifications.length;

  const showPeriod = PERIOD_ROUTES.has(pathname);

  function periodHref(value: DatePeriod) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", value);
    if (value !== "custom") {
      params.delete("start");
      params.delete("end");
    }
    return `${pathname}?${params.toString()}`;
  }

  function applyCustomRange() {
    if (!customStart || !customEnd) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", "custom");
    params.set("start", customStart);
    params.set("end", customEnd);
    startPeriodTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-white px-6">
      {title && (
        <div className="mr-2 hidden md:block">
          <p className="text-sm font-semibold leading-none text-text-primary">{title}</p>
          {subtitle && <p className="mt-0.5 text-[11px] text-text-muted">{subtitle}</p>}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {showPeriod && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="h-8 gap-1.5 text-xs" disabled={isPeriodPending}>
                {isPeriodPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Calendar className="h-3.5 w-3.5" />
                )}
                {selectedPeriodLabel}
                <ChevronDown className="h-3 w-3 text-text-muted" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Periodo</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {PERIOD_OPTIONS.map((period) => (
                <DropdownMenuItem
                  key={period.value}
                  className={cn(period.value === activeRange.period && "font-medium text-brand-green-dark")}
                  onSelect={(event) => {
                    if (period.value === "custom") {
                      event.preventDefault();
                      setCustomStart(formatDateParam(activeRange.start));
                      setCustomEnd(formatDateParam(new Date(activeRange.end.getTime() - 1)));
                      setShowCustomRange(true);
                      return;
                    }
                    setShowCustomRange(false);
                    startPeriodTransition(() => {
                      router.push(periodHref(period.value));
                    });
                  }}
                >
                  {period.label}
                </DropdownMenuItem>
              ))}
              {showCustomRange && (
                <>
                  <DropdownMenuSeparator />
                  <div className="space-y-2 px-2 py-2" onClick={(event) => event.stopPropagation()}>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                          Inicio
                        </span>
                        <input
                          type="date"
                          value={customStart}
                          onChange={(event) => setCustomStart(event.target.value)}
                          className="h-8 w-full rounded-md border border-border bg-white px-2 text-xs outline-none focus:border-brand-green"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                          Fim
                        </span>
                        <input
                          type="date"
                          value={customEnd}
                          onChange={(event) => setCustomEnd(event.target.value)}
                          className="h-8 w-full rounded-md border border-border bg-white px-2 text-xs outline-none focus:border-brand-green"
                        />
                      </label>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 w-full text-xs"
                      disabled={isPeriodPending || !customStart || !customEnd}
                      onClick={applyCustomRange}
                    >
                      Aplicar periodo
                    </Button>
                  </div>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

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
            <DropdownMenuItem asChild>
              <Link href="/profile">Perfil</Link>
            </DropdownMenuItem>
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
