import { Skeleton } from "@/components/ui/skeleton";

function MetricCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-white p-5 shadow-card">
      <div className="flex items-start justify-between">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-7 w-7 rounded-lg" />
      </div>
      <Skeleton className="h-9 w-24" />
    </div>
  );
}

function ChartCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-white shadow-card ${className ?? ""}`}>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="p-5">
        <Skeleton className="h-44 w-full" />
      </div>
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-52" />
          <Skeleton className="h-7 w-32" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-40 rounded-lg" />
          <Skeleton className="h-8 w-36 rounded-lg" />
        </div>
      </div>

      {/* 6 metric cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCardSkeleton className="lg:col-span-2" />
        <div className="rounded-xl border border-border bg-white shadow-card">
          <div className="border-b border-border px-5 py-4">
            <Skeleton className="h-3.5 w-32" />
          </div>
          <div className="p-5 space-y-3">
            <Skeleton className="mx-auto h-40 w-40 rounded-full" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Skeleton className="h-2 w-2 rounded-full" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Funnel card */}
      <ChartCardSkeleton />
    </div>
  );
}
