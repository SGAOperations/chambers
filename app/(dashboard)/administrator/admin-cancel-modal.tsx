'use client'

import { useState } from 'react'
import BookingModal from './booking-modal'

interface Session {
  id: string
  label: string
}

interface AdminCancelModalProps {
  booking: {
    id: string
    type: 'One-Time Room' | 'Tabling'
    bodyName: string
    purpose: string
  }
  sessions: Session[]
  onClose: () => void
  onCancelled: () => void
}

function formatTime(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${m} ${ampm}`
}

export default function AdminCancelModal({ booking, sessions, onClose, onCancelled }: AdminCancelModalProps) {
  const isMultiSession = sessions.length > 1

  const [scope, setScope] = useState<'occurrence' | 'series'>(
    isMultiSession ? 'occurrence' : 'series'
  )
  const [selectedSessionId, setSelectedSessionId] = useState<string>(sessions[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setSaving(true)
    const res = await fetch('/api/administrator/bookings/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: booking.id,
        scope,
        occurrence_id: scope === 'occurrence' ? selectedSessionId : undefined,
      }),
    })

    if (res.ok) {
      onCancelled()
      onClose()
    } else {
      const data = await res.json()
      setError(data.error || 'Something went wrong.')
    }
    setSaving(false)
  }

  return (
    <BookingModal title="Cancel Booking" onClose={onClose}>
      <div className="space-y-4">
        {/* Booking summary */}
        <div className="bg-[#0f2a4a] rounded-lg px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-[#f0f6ff]">{booking.bodyName}</p>
          <p className="text-xs text-[#93b8d8]">{booking.purpose} · {booking.type === 'One-Time Room' ? 'One-Time/Multiple Room' : booking.type}</p>
        </div>

        {/* Scope selector — only shown for multi-session bookings */}
        {isMultiSession && (
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
                <span className="text-sm text-[#f0f6ff]">This session only</span>
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
                <span className="text-sm text-[#f0f6ff]">All sessions</span>
              </label>
            </div>
          </div>
        )}

        {/* Session picker — shown when "This session only" is selected */}
        {isMultiSession && scope === 'occurrence' && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#93b8d8]">Select Session</p>
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              {sessions.map(s => (
                <label key={s.id} className="flex items-center gap-3 cursor-pointer bg-[#0f2a4a] rounded-lg px-3 py-2">
                  <input
                    type="radio"
                    name="session"
                    value={s.id}
                    checked={selectedSessionId === s.id}
                    onChange={() => setSelectedSessionId(s.id)}
                    className="accent-[#c8102e]"
                  />
                  <span className="text-sm text-[#f0f6ff]">{s.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Warning */}
        <div className="bg-[#3d2200] border border-[#f97316] rounded-lg px-4 py-3">
          <p className="text-sm font-semibold text-[#fb923c]">Warning</p>
          <p className="text-sm text-[#fdba74] mt-0.5">
            {scope === 'series'
              ? 'This will immediately cancel all sessions in this booking.'
              : 'This will immediately cancel the selected session.'}
          </p>
        </div>

        {error && <p className="text-[#c8102e] text-sm">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Cancelling...' : 'Cancel Booking'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[#1e5080] text-[#f0f6ff] text-sm rounded-lg hover:bg-[#1a4d8a] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </BookingModal>
  )
}
