import { Skeleton } from "@/components/ui/skeleton";

export default function AppLoading() {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-card">
        <div className="border-b border-border px-5 py-4">
          <Skeleton className="h-3.5 w-32" />
        </div>
        <div className="space-y-3 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-2.5 w-32" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
