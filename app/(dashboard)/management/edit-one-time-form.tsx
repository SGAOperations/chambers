'use client'

import { useState } from 'react'
import TimePicker from './time-picker'

const STATUSES = [
  'Reserved',
  'Alternate Room',
  'Alternate Time',
  'Waitlisted',
  'Unavailable',
  'Pending Cancellation',
  'Cancelled',
  'Virtual',
]

interface Body {
  id: string
  name: string
}

interface EditOneTimeFormProps {
  booking: {
    id: string
    body_id: string
    purpose: string
    one_time_room_bookings: {
      id: string
      room_name: string
      booking_date: string
      start_time: string
      end_time: string
      status: string
      reservation_code: string | null
    }[] | null
  }
  bodies: Body[]
  onClose: () => void
  onSuccess: () => void
}

const inputCls = "w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"

export default function EditOneTimeForm({ booking, bodies, onClose, onSuccess }: EditOneTimeFormProps) {
  const d = booking.one_time_room_bookings?.[0]

  const [form, setForm] = useState({
    body_id: booking.body_id,
    purpose: booking.purpose,
    room_name: d?.room_name ?? '',
    booking_date: d?.booking_date ?? '',
    start_time: d?.start_time.slice(0, 5) ?? '',
    end_time: d?.end_time.slice(0, 5) ?? '',
    reservation_code: d?.reservation_code ?? '',
    status: d?.status ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!d) return null

  const handleSubmit = async () => {
    if (!form.body_id || !form.purpose || !form.room_name || !form.booking_date || !form.start_time || !form.end_time) {
      setError('Please fill out all required fields.')
      return
    }

    setSaving(true)
    const res = await fetch('/api/management/bookings/one-time', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: booking.id,
        detail_id: d.id,
        ...form,
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
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Body *</label>
        <select
          value={form.body_id}
          onChange={e => setForm({ ...form, body_id: e.target.value })}
          className={inputCls}
        >
          <option value="">Select Body</option>
          {bodies.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls}>Purpose *</label>
        <input
          type="text"
          value={form.purpose}
          onChange={e => setForm({ ...form, purpose: e.target.value })}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Room Name *</label>
        <input
          type="text"
          value={form.room_name}
          onChange={e => setForm({ ...form, room_name: e.target.value })}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Date *</label>
        <input
          type="date"
          value={form.booking_date}
          onChange={e => setForm({ ...form, booking_date: e.target.value })}
          className={inputCls}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelCls}>Start Time *</label>
          <TimePicker value={form.start_time} onChange={v => setForm({ ...form, start_time: v })} />
        </div>
        <div className="flex-1">
          <label className={labelCls}>End Time *</label>
          <TimePicker value={form.end_time} onChange={v => setForm({ ...form, end_time: v })} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Reservation Code</label>
        <input
          type="text"
          placeholder="Optional"
          value={form.reservation_code}
          onChange={e => setForm({ ...form, reservation_code: e.target.value })}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Status</label>
        <select
          value={form.status}
          onChange={e => setForm({ ...form, status: e.target.value })}
          className={inputCls}
        >
          {STATUSES.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-[#c8102e] text-sm">{error}</p>}

      <div className="flex gap-2 pt-2">
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 border border-[#1e5080] text-[#f0f6ff] text-sm rounded-lg hover:bg-[#1a4d8a] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}