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
  'Missed',
  'Repurposed',
]

interface Body {
  id: string
  name: string
}

interface Occurrence {
  id: string
  occurrence_date: string
  room_name: string | null
  start_time: string | null
  end_time: string | null
  status: string | null
  reservation_code: string | null
  senate_type: string | null
}

interface EditWeeklyFormProps {
  booking: {
    id: string
    body_id: string
    purpose: string
    weekly_room_bookings: {
      id: string
      room_name: string
      start_date: string
      end_date: string
      start_time: string
      end_time: string
      status: string
      reservation_code: string | null
      weekly_room_occurrences: Occurrence[]
    }[] | null
  }
  bodies: Body[]
  onClose: () => void
  onSuccess: () => void
}

const inputCls = "w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"

function formatDate(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  })
}

function formatTime(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${m} ${ampm}`
}

function getWeeklyDates(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const current = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0])
    current.setDate(current.getDate() + 7)
  }
  return dates
}

export default function EditWeeklyForm({ booking, bodies, onClose, onSuccess }: EditWeeklyFormProps) {
  const w = booking.weekly_room_bookings?.[0]

  const [form, setForm] = useState({
    body_id: booking.body_id,
    purpose: booking.purpose,
    room_name: w?.room_name ?? '',
    start_date: w?.start_date ?? '',
    end_date: w?.end_date ?? '',
    start_time: w?.start_time.slice(0, 5) ?? '',
    end_time: w?.end_time.slice(0, 5) ?? '',
    reservation_code: w?.reservation_code ?? '',
    status: w?.status ?? 'Reserved',
  })

  const [occurrences, setOccurrences] = useState<Occurrence[]>(
    w?.weekly_room_occurrences || []
  )

  const [expandedOcc, setExpandedOcc] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isSenate = bodies.find(b => b.id === form.body_id)?.name === 'Senate'

  if (!w) return null

  const updateOccurrence = (id: string, field: keyof Occurrence, value: string | null) => {
    setOccurrences(prev => prev.map(o => o.id === id ? { ...o, [field]: value } : o))
  }

  const clearOverride = (id: string) => {
    setOccurrences(prev => prev.map(o => o.id === id ? {
      ...o,
      room_name: null,
      start_time: null,
      end_time: null,
      status: null,
      reservation_code: null,
      senate_type: null,
    } : o))
  }

  const handleSubmit = async () => {
    if (!form.body_id || !form.purpose || !form.room_name || !form.start_date || !form.end_date || !form.start_time || !form.end_time) {
      setError('Please fill out all required fields.')
      return
    }

    setSaving(true)
    const res = await fetch('/api/management/bookings/weekly', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: booking.id,
        weekly_id: w.id,
        ...form,
        occurrences,
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
    <div className="space-y-4">
      {/* Base fields */}
      <div>
        <label className={labelCls}>Body *</label>
        <select value={form.body_id} onChange={e => setForm({ ...form, body_id: e.target.value })} className={inputCls}>
          <option value="">Select Body</option>
          {bodies.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div>
        <label className={labelCls}>Purpose *</label>
        <input type="text" value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} className={inputCls} />
      </div>

      <div>
        <label className={labelCls}>Room Name *</label>
        <input type="text" value={form.room_name} onChange={e => setForm({ ...form, room_name: e.target.value })} className={inputCls} />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelCls}>Start Date *</label>
          <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className={inputCls} />
        </div>
        <div className="flex-1">
          <label className={labelCls}>End Date *</label>
          <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className={inputCls} />
        </div>
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
        <input type="text" placeholder="Optional" value={form.reservation_code} onChange={e => setForm({ ...form, reservation_code: e.target.value })} className={inputCls} />
      </div>

      <div>
        <label className={labelCls}>Status</label>
        <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className={inputCls}>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Occurrences */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-[#f0f6ff]">Occurrences</p>
        {getWeeklyDates(form.start_date, form.end_date).map(date => {
          const occ = occurrences.find(o => o.occurrence_date === date)
          const hasOverride = occ && (occ.room_name || occ.start_time || occ.end_time || occ.status || occ.reservation_code)
          const isExpanded = expandedOcc === date

          return (
            <div key={date} className="border border-[#1e5080] rounded-xl overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[#1a4d8a]"
                onClick={() => setExpandedOcc(isExpanded ? null : date)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[#f0f6ff]">{formatDate(date)}</span>
                  {hasOverride && (
                    <span className="text-xs bg-[#c8102e]/10 text-[#c8102e] px-2 py-0.5 rounded-full font-medium">Overridden</span>
                  )}
                </div>
                <span className="text-slate-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
              </div>

              {isExpanded && occ && (
                <div className="px-4 pb-4 space-y-3 border-t border-[#1e5080] pt-3 bg-[#0f2a4a]">
                  <div>
                    <label className={labelCls}>Room Override</label>
                    <input
                      type="text"
                      placeholder={`Default: ${form.room_name}`}
                      value={occ.room_name ?? ''}
                      onChange={e => updateOccurrence(occ.id, 'room_name', e.target.value || null)}
                      className={inputCls}
                    />
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className={labelCls}>Start Time Override</label>
                      <TimePicker
                        value={occ.start_time?.slice(0, 5) ?? form.start_time}
                        onChange={v => updateOccurrence(occ.id, 'start_time', v)}
                      />
                    </div>
                    <div className="flex-1">
                      <label className={labelCls}>End Time Override</label>
                      <TimePicker
                        value={occ.end_time?.slice(0, 5) ?? form.end_time}
                        onChange={v => updateOccurrence(occ.id, 'end_time', v)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>Status Override</label>
                    <select
                      value={occ.status ?? ''}
                      onChange={e => updateOccurrence(occ.id, 'status', e.target.value || null)}
                      className={inputCls}
                    >
                      <option value="">Default: {form.status}</option>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className={labelCls}>Reservation Code Override</label>
                    <input
                      type="text"
                      placeholder={`Default: ${form.reservation_code || 'None'}`}
                      value={occ.reservation_code ?? ''}
                      onChange={e => updateOccurrence(occ.id, 'reservation_code', e.target.value || null)}
                      className={inputCls}
                    />
                  </div>

                  {isSenate && (
                    <div>
                      <label className={labelCls}>Session Type</label>
                      <select
                        value={occ.senate_type ?? ''}
                        onChange={e => updateOccurrence(occ.id, 'senate_type', e.target.value || null)}
                        className={inputCls}
                      >
                        <option value="">None</option>
                        <option value="Weekly">Weekly</option>
                        <option value="Full Body">Full Body</option>
                        <option value="Office Hours">Office Hours</option>
                      </select>
                    </div>
                  )}

                  {hasOverride && (
                    <button
                      onClick={() => clearOverride(occ.id)}
                      className="text-xs text-slate-400 hover:text-[#c8102e] transition-colors"
                    >
                      Clear all overrides for this date
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
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