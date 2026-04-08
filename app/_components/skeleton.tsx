export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`rounded-lg bg-[#1e3a5c] ${className ?? ''}`} />
  )
}
