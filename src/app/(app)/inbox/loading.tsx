import { Skeleton } from "@/components/ui/skeleton";

function ConversationItemSkeleton() {
  return (
    <div className="flex items-start gap-3 border-b border-border px-4 py-3">
      <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-2.5 w-12" />
        </div>
        <Skeleton className="h-2.5 w-36" />
      </div>
    </div>
  );
}

function MessageBubbleSkeleton({ sent }: { sent?: boolean }) {
  return (
    <div className={`flex ${sent ? "justify-end" : "justify-start"}`}>
      <Skeleton className={`h-10 rounded-2xl ${sent ? "w-44" : "w-52"}`} />
    </div>
  );
}

export default function InboxLoading() {
  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden rounded-xl border border-border bg-white shadow-card">
      {/* Left panel — conversation list */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        {/* Search + filter bar */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Skeleton className="h-8 flex-1 rounded-lg" />
          <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
        </div>
        {/* Filter chips */}
        <div className="flex gap-1.5 border-b border-border px-3 py-2">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-14 rounded-full" />
        </div>
        {/* Conversation rows */}
        <div className="flex-1 overflow-hidden">
          {Array.from({ length: 9 }).map((_, i) => (
            <ConversationItemSkeleton key={i} />
          ))}
        </div>
      </div>

      {/* Middle panel — chat */}
      <div className="flex flex-1 flex-col">
        {/* Chat header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2.5 w-20" />
          </div>
          <Skeleton className="h-7 w-24 rounded-lg" />
        </div>
        {/* Messages */}
        <div className="flex-1 space-y-3 overflow-hidden p-4">
          <MessageBubbleSkeleton />
          <MessageBubbleSkeleton sent />
          <MessageBubbleSkeleton />
          <MessageBubbleSkeleton />
          <MessageBubbleSkeleton sent />
          <MessageBubbleSkeleton sent />
          <MessageBubbleSkeleton />
        </div>
        {/* Message input */}
        <div className="border-t border-border p-3">
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      </div>

      {/* Right panel — lead info */}
      <div className="hidden w-64 shrink-0 flex-col border-l border-border xl:flex">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="space-y-4 p-4">
          {/* Lead card */}
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-2.5 w-32" />
            <Skeleton className="h-2.5 w-28" />
          </div>
          <div className="h-px bg-border" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <div className="h-px bg-border" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5 w-3/4" />
          </div>
        </div>
      </div>
    </div>
  );
}
