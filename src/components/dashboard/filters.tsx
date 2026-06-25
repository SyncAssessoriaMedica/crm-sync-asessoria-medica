"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef, useTransition } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Source = { id: string; name: string | null };
type Service = { id: string; name: string | null; active: boolean | null };

interface DashboardFiltersProps {
  sources: Source[];
  services: Service[];
  selectedSources: string[];
  selectedService: string;
  responseMode: "business_hours" | "real_time";
  period: string;
  start?: string;
  end?: string;
  subscriptionLabel: string;
}

export function DashboardFilters({
  sources,
  services,
  selectedSources: initialSources,
  selectedService: initialService,
  responseMode,
  period,
  start,
  end,
  subscriptionLabel,
}: DashboardFiltersProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [localSources, setLocalSources] = useState(initialSources);
  const [localService, setLocalService] = useState(initialService);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const sourcesKey = initialSources.join(",");
  useEffect(() => {
    if (!isPending) {
      setLocalSources(initialSources);
      setLocalService(initialService);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending, sourcesKey, initialService]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function buildUrl(srcs: string[], service: string, mode: string) {
    const params = new URLSearchParams();
    params.set("period", period);
    if (period === "custom") {
      if (start) params.set("start", start);
      if (end) params.set("end", end);
    }
    params.set("responseMode", mode);
    if (service !== "all") params.set("service", service);
    if (srcs.length > 0) params.set("source", srcs.join(","));
    return `/dashboard?${params.toString()}`;
  }

  function navigate(srcs: string[], service: string, mode: string = responseMode) {
    startTransition(() => {
      router.push(buildUrl(srcs, service, mode), { scroll: false });
    });
  }

  function handleSourceToggle(id: string) {
    const next = localSources.includes(id)
      ? localSources.filter((s) => s !== id)
      : [...localSources, id];
    setLocalSources(next);
    navigate(next, localService);
  }

  function handleClearSources(e: React.MouseEvent) {
    e.stopPropagation();
    setLocalSources([]);
    navigate([], localService);
  }

  function handleServiceChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    setLocalService(val);
    navigate(localSources, val);
  }

  const sourceLabel =
    localSources.length === 0
      ? "Todas as origens"
      : localSources.length === 1
        ? (sources.find((s) => s.id === localSources[0])?.name ?? "1 origem")
        : `${localSources.length} origens`;

  const businessHoursUrl = buildUrl(localSources, localService, "business_hours");
  const realTimeUrl = buildUrl(localSources, localService, "real_time");

  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", isPending && "opacity-60")}>
      {/* Multi-select de origens */}
      {sources.length > 0 && (
        <div ref={dropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg border bg-white px-3 text-xs font-semibold shadow-card outline-none transition",
              localSources.length > 0
                ? "border-brand-green text-brand-green-deep"
                : "border-border text-text-secondary hover:border-brand-green/50"
            )}
          >
            <span>{sourceLabel}</span>
            {localSources.length > 0 && (
              <span
                role="button"
                tabIndex={0}
                onClick={handleClearSources}
                onKeyDown={(e) => e.key === "Enter" && handleClearSources(e as unknown as React.MouseEvent)}
                className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-brand-green text-white hover:bg-brand-green-dark"
              >
                <X className="h-2 w-2" />
              </span>
            )}
            <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
          </button>

          {open && (
            <div className="absolute left-0 top-9 z-50 min-w-[190px] rounded-xl border border-border bg-white py-1 shadow-lg">
              <button
                type="button"
                onClick={() => { setLocalSources([]); navigate([], localService); }}
                className={cn(
                  "flex w-full items-center gap-2.5 border-b border-border px-3 py-1.5 text-left text-xs transition hover:bg-background-subtle",
                  localSources.length === 0 ? "font-semibold text-brand-green" : "text-text-muted"
                )}
              >
                Todas as origens
              </button>
              {sources.map((source) => {
                const checked = localSources.includes(source.id);
                return (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => handleSourceToggle(source.id)}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition hover:bg-background-subtle"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition",
                        checked ? "border-brand-green bg-brand-green" : "border-border bg-white"
                      )}
                    >
                      {checked && <Check className="h-2.5 w-2.5 text-white" />}
                    </span>
                    <span className={cn("font-medium", checked ? "text-text-primary" : "text-text-secondary")}>
                      {source.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Filtro de serviço */}
      {services.length > 0 && (
        <select
          value={localService}
          onChange={handleServiceChange}
          className="h-8 rounded-lg border border-border bg-white px-3 text-xs font-semibold text-text-secondary shadow-card outline-none transition focus:border-brand-green"
        >
          <option value="all">Todos os servicos</option>
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
        </select>
      )}

      {/* Toggle horario util / tempo real */}
      <div className="flex items-center gap-0.5 rounded-lg border border-border bg-white p-0.5 text-[11px] font-semibold shadow-card">
        <Link
          href={businessHoursUrl}
          className={cn(
            "rounded-md px-2.5 py-1 transition-colors",
            responseMode === "business_hours"
              ? "bg-brand-green text-white"
              : "text-text-muted hover:text-text-secondary"
          )}
        >
          Horario util
        </Link>
        <Link
          href={realTimeUrl}
          className={cn(
            "rounded-md px-2.5 py-1 transition-colors",
            responseMode === "real_time"
              ? "bg-brand-green text-white"
              : "text-text-muted hover:text-text-secondary"
          )}
        >
          Tempo real
        </Link>
      </div>

      {/* Badge de assinatura */}
      <div className="flex items-center gap-1.5 rounded-lg border border-brand-green/30 bg-brand-green-soft px-3 py-1.5">
        <div className="h-1.5 w-1.5 rounded-full bg-brand-green" />
        <span className="text-xs font-semibold text-brand-green-deep">{subscriptionLabel}</span>
      </div>
    </div>
  );
}
