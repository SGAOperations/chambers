'use client'

import { useState } from 'react'

interface CancelModalProps {
  booking: {
    id: string
    type: 'One-Time Room' | 'Weekly Room' | 'Tabling'
    bodyName: string
    purpose: string
    location: string
    date: string
    occurrenceId?: string
  }
  onClose: () => void
  onSuccess: () => void
}

export default function CancelModal({ booking, onClose, onSuccess }: CancelModalProps) {
  const [scope, setScope] = useState<'occurrence' | 'series'>(
    booking.type === 'Weekly Room' ? 'occurrence' : 'series'
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const isWeekly = booking.type === 'Weekly Room'

  const handleSubmit = async () => {
    setSubmitting(true)
    const res = await fetch('/api/cancellation-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: booking.id,
        occurrence_id: scope === 'occurrence' ? booking.occurrenceId : null,
        scope,
      }),
    })

    if (res.ok) {
      onSuccess()
      onClose()
    } else {
      const data = await res.json()
      setError(data.error || 'Something went wrong.')
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-[#0f172a]">Request Cancellation</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg leading-none transition-colors">✕</button>
        </div>

        {/* Booking summary */}
        <div className="bg-[#f4f6f9] rounded-lg px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-[#0f172a]">{booking.bodyName} — {booking.location}</p>
          <p className="text-xs text-slate-500">{booking.purpose} · {booking.type}</p>
        </div>

        {/* Weekly scope selector */}
        {isWeekly && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500">Cancellation Scope</p>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  value="occurrence"
                  checked={scope === 'occurrence'}
                  onChange={() => setScope('occurrence')}
                  className="accent-[#c8102e]"
                />
                <span className="text-sm text-[#0f172a]">This occurrence only</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  value="series"
                  checked={scope === 'series'}
                  onChange={() => setScope('series')}
                  className="accent-[#c8102e]"
                />
                <span className="text-sm text-[#0f172a]">Entire series</span>
              </label>
            </div>
          </div>
        )}

        {/* Series warning */}
        {scope === 'series' && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3">
            <p className="text-sm font-semibold text-orange-700">Warning</p>
            <p className="text-sm text-orange-600 mt-0.5">
              {isWeekly
                ? 'This will request cancellation of all occurrences in this series.'
                : 'This will request cancellation of this booking.'}
              {' '}An admin may reach out to confirm the cancellation.
            </p>
          </div>
        )}

        {error && <p className="text-[#c8102e] text-sm">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[#e2e8f0] text-slate-700 text-sm rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}