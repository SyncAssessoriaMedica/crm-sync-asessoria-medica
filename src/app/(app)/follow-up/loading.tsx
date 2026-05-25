export default function FollowUpLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="h-7 w-48 animate-pulse rounded-lg bg-background-subtle" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-background-subtle" />
      ))}
    </div>
  );
}
