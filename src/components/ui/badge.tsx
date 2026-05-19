import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-700 font-bold uppercase tracking-wider transition-colors",
  {
    variants: {
      variant: {
        default: "bg-brand-green-soft text-brand-green-deep border border-brand-green/20",
        secondary: "bg-background-subtle text-text-secondary border border-border",
        destructive: "bg-danger-soft text-danger-red border border-danger-red/20",
        warning: "bg-amber-50 text-amber-700 border border-amber-200",
        outline: "border border-border text-text-secondary",
        green: "bg-brand-green text-white",
        dark: "bg-sidebar-dark text-white",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
