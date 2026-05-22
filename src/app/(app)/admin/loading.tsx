import { Skeleton } from "@/components/ui/skeleton";

function SectionCardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-7 w-24 rounded-lg" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-3.5">
            <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-2.5 w-28" />
            </div>
            <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
            <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminLoading() {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-7 w-36" />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-border bg-background-subtle p-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className={`h-7 rounded-lg ${i === 0 ? "w-28" : "w-24"}`} />
        ))}
      </div>

      {/* Section cards */}
      <SectionCardSkeleton rows={3} />
      <SectionCardSkeleton rows={4} />
    </div>
  );
}
