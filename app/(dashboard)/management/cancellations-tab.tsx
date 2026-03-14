'use client'

import { useEffect, useState } from 'react'

interface CancellationRequest {
  id: string
  scope: 'occurrence' | 'series'
  status: 'Pending' | 'Done'
  created_at: string
  bookings: {
    id: string
    type: string
    purpose: string
    bodies: { name: string } | null
  } | null
  weekly_room_occurrences: {
    occurrence_date: string
  } | null
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

  const fetchCancellations = async () => {
    const res = await fetch('/api/management/cancellations')
    const data = await res.json()
    setCancellations(data.cancellations || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchCancellations()
  }, [])

  const markDone = async (id: string) => {
    setUpdating(id)
    await fetch('/api/management/cancellations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    await fetchCancellations()
    onCountChange()
    setUpdating(null)
  }

  if (loading) return <div className="text-slate-500 text-sm">Loading...</div>

  if (cancellations.length === 0) return (
    <p className="text-slate-400 text-sm">No cancellation requests found.</p>
  )

  return (
    <div className="space-y-4">
      {cancellations.map(c => (
        <div key={c.id} className="border border-[#e2e8f0] rounded-xl p-5 bg-white shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-[#0f172a]">{c.bookings?.bodies?.name}</p>
              <p className="text-sm text-slate-500">{c.bookings?.purpose} · {c.bookings?.type}</p>
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              c.status === 'Pending'
                ? 'bg-orange-100 text-orange-700'
                : 'bg-green-100 text-green-700'
            }`}>
              {c.status}
            </span>
          </div>

          <div className="mt-3 text-sm text-slate-600 space-y-0.5">
            <p><span className="font-medium text-slate-700">Requested by:</span> {c.users?.full_name}</p>
            <p><span className="font-medium text-slate-700">Scope:</span> {c.scope === 'occurrence' ? 'Single occurrence' : 'Entire series'}</p>
            {c.scope === 'occurrence' && c.weekly_room_occurrences?.occurrence_date && (
              <p><span className="font-medium text-slate-700">Date:</span> {formatDate(c.weekly_room_occurrences.occurrence_date)}</p>
            )}
            <p><span className="font-medium text-slate-700">Submitted:</span> {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
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