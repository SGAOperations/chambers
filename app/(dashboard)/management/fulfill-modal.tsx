'use client'

import { useEffect, useState } from 'react'
import BookingModal from './booking-modal'

interface Booking {
  id: string
  purpose: string
  bodies: { name: string } | null
}

interface FulfillModalProps {
  request: {
    id: string
    type: string
    purpose: string
    body_id: string
  }
  onClose: () => void
  onSuccess: () => void
}

const inputCls = "w-full border border-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/20 focus:border-[#c8102e] transition"
const labelCls = "block text-xs font-medium text-slate-500 mb-1"

export default function FulfillModal({ request, onClose, onSuccess }: FulfillModalProps) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [booking_id, setBookingId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchBookings = async () => {
      const res = await fetch(`/api/management/requests/bookings?type=${encodeURIComponent(request.type)}&body_id=${request.body_id}`)
      const data = await res.json()
      setBookings(data.bookings || [])
      setLoading(false)
    }
    fetchBookings()
  }, [request.type])

  const handleSubmit = async () => {
    if (!booking_id) {
      setError('Please select a booking to link.')
      return
    }

    setSaving(true)
    const res = await fetch('/api/management/requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: request.id,
        status: 'Fulfilled',
        booking_id,
        notes,
      }),
    })

    if (res.ok) {
      onSuccess()
      onClose()
    } else {
      const data = await res.json()
      setError(data.error || 'Something went wrong.')
    }
    setSaving(false)
  }

  return (
    <BookingModal title="Fulfill Request" onClose={onClose}>
      <div className="space-y-4">
        {/* Request summary */}
        <div className="bg-[#f4f6f9] rounded-lg px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Request</p>
          <p className="text-sm font-semibold text-[#0f172a]">{request.purpose}</p>
          <p className="text-xs text-slate-500">{request.type}</p>
        </div>

        {/* Booking dropdown */}
        <div>
          <label className={labelCls}>Link to Booking *</label>
          {loading ? (
            <p className="text-sm text-slate-400">Loading bookings...</p>
          ) : bookings.length === 0 ? (
            <p className="text-sm text-slate-400">No unlinked {request.type} bookings found. Create one in the Bookings tab first.</p>
          ) : (
            <select
              value={booking_id}
              onChange={e => setBookingId(e.target.value)}
              className={inputCls}
            >
              <option value="">Select Booking</option>
              {bookings.map(b => (
                <option key={b.id} value={b.id}>
                  {b.bodies?.name} — {b.purpose}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className={labelCls}>Notes</label>
          <textarea
            placeholder="Optional"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className={inputCls}
          />
        </div>

        {error && <p className="text-[#c8102e] text-sm">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSubmit}
            disabled={saving || bookings.length === 0}
            className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Fulfilling...' : 'Fulfill Request'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[#e2e8f0] text-slate-700 text-sm rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </BookingModal>
  )
}