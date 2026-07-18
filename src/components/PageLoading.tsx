// A calm, consistent loading skeleton. Understated on purpose — the platform
// should feel composed while it thinks, not busy.
export function PageLoading({ label = "Preparing…", rows = 6 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="h-3 w-24 animate-pulse rounded bg-white/[0.05]" />
        <div className="h-6 w-64 animate-pulse rounded-lg bg-white/[0.05]" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/[0.035]" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-2xl bg-white/[0.035]" />
      <p className="flex items-center justify-center gap-2 text-xs text-chalk-600">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-400" /> {label}
      </p>
    </div>
  );
}
