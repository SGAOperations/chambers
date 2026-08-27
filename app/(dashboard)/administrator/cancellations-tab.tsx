'use client'

import { useEffect, useState } from 'react'
import { Skeleton } from '@/app/_components/skeleton'
import { usePendingActionsWatch } from '../pending-actions-watch'

function CancellationsTabSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map(i => (
        <div key={i} className="border border-[#1e5080] rounded-xl p-5 bg-[#184073] animate-pulse">
          <div className="flex items-center justify-between">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3.5 w-56" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <div className="mt-3 space-y-1.5">
            <Skeleton className="h-3.5 w-44" />
            <Skeleton className="h-3.5 w-52" />
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3.5 w-40" />
          </div>
          <div className="mt-4">
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  )
}

interface CancellationRequest {
  id: string
  scope: 'occurrence' | 'series'
  status: 'Pending' | 'Done'
  created_at: string
  cancellation_type: string
  bookings: {
    id: string
    type: string
    purpose: string
    bodies: { name: string } | null
  } | null
  occurrence_date: string | null
  reservation_code: string | null
  users: {
    full_name: string
  } | null
}

function formatDate(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  })
}

interface CancellationsTabProps {
    onCountChange: () => void
}

export default function CancellationsTab({ onCountChange }: CancellationsTabProps) {
  const [cancellations, setCancellations] = useState<CancellationRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  const { isDanger, registerOrigin } = usePendingActionsWatch()

  const fetchCancellations = async () => {
    const res = await fetch('/api/administrator/cancellations')
    const data = await res.json()
    setCancellations(data.cancellations || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchCancellations()
  }, [])

  const markDone = async (id: string) => {
    setUpdating(id)
    await fetch('/api/administrator/cancellations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    await fetchCancellations()
    onCountChange()
    setUpdating(null)
  }

  if (loading) return <CancellationsTabSkeleton />

  if (cancellations.length === 0) return (
    <p className="text-[#6a96bb] text-sm">No cancellation requests found.</p>
  )

  return (
    <div className="space-y-4">
      {cancellations.map(c => (
        <div
          key={c.id}
          ref={registerOrigin(c.id)}
          className={`border border-[#1e5080] rounded-xl p-5 bg-[#184073] shadow-sm ${isDanger(c.id) ? 'pa-row-danger' : ''}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-[#f0f6ff] pa-row-title">{c.bookings?.bodies?.name}</p>
              <p className="text-sm text-[#93b8d8]">{c.bookings?.purpose} · {c.bookings?.type}</p>
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              c.status === 'Pending'
                ? 'bg-[#3d2200] text-[#fb923c]'
                : 'bg-[#0f3d20] text-[#4ade80]'
            }`}>
              {c.status}
            </span>
          </div>

          <div className="mt-3 text-sm text-[#93b8d8] space-y-0.5">
            <p><span className="font-medium text-[#f0f6ff]">Requested by:</span> {c.users?.full_name}</p>
            <p><span className="font-medium text-[#f0f6ff]">Scope:</span> {c.scope === 'occurrence' ? 'Single occurrence' : 'Entire series'}</p>
            <p><span className="font-medium text-[#f0f6ff]">Cancellation Type:</span> {c.cancellation_type === 'Virtual' ? 'Going Virtual' : 'Full Cancellation'}</p>
            {c.scope === 'occurrence' && c.occurrence_date && (
              <p><span className="font-medium text-[#f0f6ff]">Date:</span> {formatDate(c.occurrence_date)}</p>
            )}
            {c.reservation_code && (
              <p><span className="font-medium text-[#f0f6ff]">Res. Code:</span> <span className="font-mono">{c.reservation_code}</span></p>
            )}
            <p><span className="font-medium text-[#f0f6ff]">Submitted:</span> {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
          </div>

          {c.status === 'Pending' && (
            <div className="mt-4">
              <button
                onClick={() => markDone(c.id)}
                disabled={updating === c.id}
                className="px-3 py-1.5 text-sm bg-[#0a1628] hover:bg-[#0f2040] text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {updating === c.id ? 'Updating...' : 'Mark as Done'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}