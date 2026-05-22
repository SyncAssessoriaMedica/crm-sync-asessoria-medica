import { Skeleton } from "@/components/ui/skeleton";

function LeadRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
      <Skeleton className="h-4 w-4 shrink-0 rounded" />
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-2.5 w-24" />
      </div>
      <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
      <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
      <Skeleton className="h-3 w-20 shrink-0" />
      <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
    </div>
  );
}

export default function LeadsLoading() {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-7 w-20" />
        </div>
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-64 rounded-lg" />
        <Skeleton className="h-8 w-32 rounded-lg" />
        <Skeleton className="h-8 w-32 rounded-lg" />
        <Skeleton className="ml-auto h-8 w-24 rounded-lg" />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-card">
        {/* Table header */}
        <div className="flex items-center gap-3 border-b border-border bg-background-subtle px-4 py-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="ml-auto h-3 w-16" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-8" />
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <LeadRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
