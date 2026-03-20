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
  const [cancellationType, setCancellationType] = useState<'Cancellation' | 'Virtual'>('Cancellation')
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
        cancellation_type: cancellationType,
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
      <div className="bg-[#184073] rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-[#f0f6ff]">Request Cancellation</h2>
          <button onClick={onClose} className="text-[#6a96bb] hover:text-[#f0f6ff] text-lg leading-none transition-colors">✕</button>
        </div>

        {/* Booking summary */}
        <div className="bg-[#0f2a4a] rounded-lg px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-[#f0f6ff]">{booking.bodyName} — {booking.location}</p>
          <p className="text-xs text-[#93b8d8]">{booking.purpose} · {booking.type === 'One-Time Room' ? 'One-Time/Multiple Room' : booking.type}</p>
        </div>

        {/* Cancellation type selector */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-[#93b8d8]">Cancellation Type</p>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="cancellationType"
                value="Cancellation"
                checked={cancellationType === 'Cancellation'}
                onChange={() => setCancellationType('Cancellation')}
                className="accent-[#c8102e]"
              />
              <span className="text-sm text-[#f0f6ff]">Full Cancellation</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="cancellationType"
                value="Virtual"
                checked={cancellationType === 'Virtual'}
                onChange={() => setCancellationType('Virtual')}
                className="accent-[#c8102e]"
              />
              <span className="text-sm text-[#f0f6ff]">Going Virtual</span>
            </label>
          </div>
        </div>

        {/* Weekly scope selector */}
        {isWeekly && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#93b8d8]">Cancellation Scope</p>
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
                <span className="text-sm text-[#f0f6ff]">This occurrence only</span>
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
                <span className="text-sm text-[#f0f6ff]">Entire series</span>
              </label>
            </div>
          </div>
        )}

        {/* Series warning */}
        {scope === 'series' && (
          <div className="bg-[#3d2200] border border-[#f97316] rounded-lg px-4 py-3">
            <p className="text-sm font-semibold text-[#fb923c]">Warning</p>
            <p className="text-sm text-[#fdba74] mt-0.5">
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
            className="px-4 py-2 border border-[#1e5080] text-[#f0f6ff] text-sm rounded-lg hover:bg-[#1a4d8a] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}