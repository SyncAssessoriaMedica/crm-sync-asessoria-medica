import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="max-w-5xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-8 w-44" />
          <Skeleton className="mt-2 h-3 w-80" />
        </div>
        <Skeleton className="h-14 w-48 rounded-xl" />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
        {/* Side nav */}
        <div className="overflow-hidden rounded-xl border border-border bg-white p-2 shadow-card md:col-span-1">
          <div className="space-y-0.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 rounded-lg px-3 py-2">
                <Skeleton className="h-3.5 w-3.5 shrink-0" />
                <Skeleton className="h-3 flex-1" />
              </div>
            ))}
          </div>
        </div>

        {/* Form card */}
        <div className="overflow-hidden rounded-xl border border-border bg-white shadow-card md:col-span-3">
          <div className="border-b border-border px-5 py-4">
            <Skeleton className="h-3.5 w-32" />
          </div>
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-9 w-full rounded-lg" />
                </div>
              ))}
              <div className="space-y-1.5 md:col-span-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-9 w-full rounded-lg" />
              </div>
            </div>
            <div className="h-px bg-border" />
            <div className="flex justify-end">
              <Skeleton className="h-9 w-28 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
