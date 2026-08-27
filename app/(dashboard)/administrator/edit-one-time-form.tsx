'use client'

import { useState } from 'react'
import TimePicker from './time-picker'
import DateField from '@/app/_components/date-field'
import BookingScopeSelector, { type BookingScopeValue } from '@/app/_components/booking-scope-selector'
import { DIVISIONS, type Division, type BookingScope } from '@/lib/booking-scope'

const STATUSES = [
  'Reserved',
  'Alternate Room',
  'Alternate Time',
  'Waitlisted',
  'Unavailable',
  'Pending Cancellation',
  'Cancelled',
  'Virtual',
  'Missed',
  'Repurposed',
  'Tentative',
]

interface Body {
  id: string
  name: string
  division: Division
}

interface OneTimeSession {
  room_name: string
  booking_date: string
  start_time: string
  end_time: string
  status: string
  reservation_code: string
}

const emptySession = (): OneTimeSession => ({
  room_name: '',
  booking_date: '',
  start_time: '',
  end_time: '',
  status: 'Reserved',
  reservation_code: '',
})

interface EditOneTimeFormProps {
  booking: {
    id: string
    body_id: string
    purpose: string
    scope: BookingScope
    division: Division | null
    booking_bodies: { body_id: string; bodies: { name: string } | null }[] | null
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
  const [form, setForm] = useState({
    purpose: booking.purpose,
  })

  const [scopeValue, setScopeValue] = useState<BookingScopeValue>({
    scope: booking.scope ?? 'single',
    body_id: booking.body_id,
    division: booking.division ?? null,
    body_ids: (booking.booking_bodies ?? []).map(b => b.body_id),
  })

  const [sessions, setSessions] = useState<OneTimeSession[]>(
    booking.one_time_room_bookings?.map(d => ({
      room_name: d.room_name ?? '',
      booking_date: d.booking_date ?? '',
      start_time: d.start_time.slice(0, 5) ?? '',
      end_time: d.end_time.slice(0, 5) ?? '',
      status: d.status ?? 'Reserved',
      reservation_code: d.reservation_code ?? '',
    })) ?? [emptySession()]
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const updateSession = (index: number, field: keyof OneTimeSession, value: string) => {
    setSessions(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }

  const handleSubmit = async () => {
    if (!scopeValue.body_id || !form.purpose) {
      setError('Please fill out all required fields.')
      return
    }
    if (scopeValue.scope === 'divisional' && !scopeValue.division) {
      setError('Please select a division.')
      return
    }
    if (scopeValue.scope === 'multi' && scopeValue.body_ids.filter(id => id !== scopeValue.body_id).length === 0) {
      setError('Select at least one other body for a multi-body booking.')
      return
    }
    for (const s of sessions) {
      if (!s.booking_date || !s.start_time || !s.end_time) {
        setError('Please fill out all session fields.')
        return
      }
    }

    setSaving(true)
    const res = await fetch('/api/administrator/bookings/one-time', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: booking.id,
        ...scopeValue,
        purpose: form.purpose,
        sessions,
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
      <BookingScopeSelector
        value={scopeValue}
        onChange={setScopeValue}
        ownerBodies={bodies}
        allBodies={bodies}
        allowedDivisions={[...DIVISIONS]}
      />

      <div>
        <label className={labelCls}>Purpose *</label>
        <input
          type="text"
          value={form.purpose}
          onChange={e => setForm({ ...form, purpose: e.target.value })}
          className={inputCls}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[#f0f6ff]">Sessions</span>
          <button
            onClick={() => setSessions(prev => [...prev, emptySession()])}
            className="text-xs text-[#c8102e] hover:text-[#a00d24] font-medium transition-colors"
          >
            + Add Session
          </button>
        </div>

        {sessions.map((s, i) => (
          <div key={i} className="border border-[#1e5080] rounded-xl p-4 space-y-3 bg-[#0f2a4a]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#6a96bb] uppercase tracking-wide">Session {i + 1}</span>
              {sessions.length > 1 && (
                <button
                  onClick={() => setSessions(prev => prev.filter((_, idx) => idx !== i))}
                  className="text-xs text-[#6a96bb] hover:text-[#c8102e] transition-colors"
                >
                  Remove
                </button>
              )}
            </div>

            <div>
              <label className={labelCls}>Room Name</label>
              <input
                type="text"
                value={s.room_name}
                onChange={e => updateSession(i, 'room_name', e.target.value)}
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>Date *</label>
              <DateField value={s.booking_date} onChange={v => updateSession(i, 'booking_date', v)} />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className={labelCls}>Start Time *</label>
                <TimePicker value={s.start_time} onChange={v => updateSession(i, 'start_time', v)} />
              </div>
              <div className="flex-1">
                <label className={labelCls}>End Time *</label>
                <TimePicker value={s.end_time} onChange={v => updateSession(i, 'end_time', v)} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Status</label>
              <select
                value={s.status}
                onChange={e => updateSession(i, 'status', e.target.value)}
                className={inputCls}
              >
                {STATUSES.map(st => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Reservation Code</label>
              <input
                type="text"
                placeholder="Optional"
                value={s.reservation_code}
                onChange={e => updateSession(i, 'reservation_code', e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
        ))}
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
