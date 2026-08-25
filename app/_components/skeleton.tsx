export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`rounded-lg bg-[#1e3a5c] ${className ?? ''}`} />
  )
}

/**
 * Neutral placeholder rendered while a route guard verifies access. Guards
 * previously returned null here, which left the content area blank for the
 * whole auth round trip.
 */
export function PageSkeleton() {
  return (
    <div className="space-y-5 animate-pulse" aria-hidden="true">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2].map(i => (
          <Skeleton key={i} className="h-32 border border-[#1e5080]" />
        ))}
      </div>
      <Skeleton className="h-64 border border-[#1e5080]" />
    </div>
  )
}
