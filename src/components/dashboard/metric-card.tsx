import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string;
  variation?: number;
  icon?: LucideIcon;
  iconColor?: string;
  suffix?: string;
  alert?: boolean;
  className?: string;
}

export function MetricCard({
  label,
  value,
  variation,
  icon: Icon,
  iconColor = "text-brand-green",
  suffix,
  alert,
  className,
}: MetricCardProps) {
  const isPositive = variation !== undefined && variation > 0;
  const isNegative = variation !== undefined && variation < 0;
  const isNeutral = variation === 0;

  return (
    <div
      className={cn(
        "rounded-xl bg-white border border-border shadow-card p-5 flex flex-col gap-3 transition-shadow hover:shadow-card-hover",
        alert && "border-l-2 border-l-warning-amber",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <p className="label-eyebrow">{label}</p>
        {Icon && (
          <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg bg-brand-green-soft", alert && "bg-amber-50")}>
            <Icon className={cn("h-3.5 w-3.5", iconColor, alert && "text-warning-amber")} />
          </div>
        )}
      </div>

      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="metric-number">
            {value}
            {suffix && (
              <span className="ml-0.5 text-base font-semibold text-text-muted">
                {suffix}
              </span>
            )}
          </p>
        </div>

        {variation !== undefined && (
          <div
            className={cn(
              "flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold",
              isPositive && "bg-brand-green-soft text-brand-green-deep",
              isNegative && "bg-danger-soft text-danger-red",
              isNeutral && "bg-background-subtle text-text-muted"
            )}
          >
            {isPositive && <TrendingUp className="h-3 w-3" />}
            {isNegative && <TrendingDown className="h-3 w-3" />}
            {isNeutral && <Minus className="h-3 w-3" />}
            {Math.abs(variation).toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  );
}
