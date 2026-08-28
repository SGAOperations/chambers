'use client'

import { useEffect, useRef, useState } from 'react'
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

interface Occurrence {
  id: string
  occurrence_date: string
  room_name: string | null
  start_time: string | null
  end_time: string | null
  status: string | null
  reservation_code: string | null
  senate_type: string | null
  /** Overrides bookings.purpose for this date; null inherits (issue #55). */
  purpose: string | null
  /** Overrides bookings.hidden; null inherits, false forces visible (issue #55). */
  hidden: boolean | null
  /** Marks this single occurrence as an event. Authoritative, not an override (issue #55). */
  is_event: boolean
}

interface EditWeeklyFormProps {
  booking: {
    id: string
    body_id: string
    purpose: string
    /** Only read to label what "Default" means on each occurrence's overrides. */
    hidden: boolean
    scope: BookingScope
    division: Division | null
    booking_bodies: { body_id: string; bodies: { name: string } | null }[] | null
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
  /** Occurrence date (YYYY-MM-DD) to expand on open, e.g. when arriving from a grid cell click. */
  initialExpandedOcc?: string | null
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

export default function EditWeeklyForm({ booking, bodies, initialExpandedOcc, onClose, onSuccess }: EditWeeklyFormProps) {
  const w = booking.weekly_room_bookings?.[0]

  const [scopeValue, setScopeValue] = useState<BookingScopeValue>({
    scope: booking.scope ?? 'single',
    body_id: booking.body_id,
    division: booking.division ?? null,
    body_ids: (booking.booking_bodies ?? []).map(b => b.body_id),
  })

  const [form, setForm] = useState({
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

  const [expandedOcc, setExpandedOcc] = useState<string | null>(initialExpandedOcc ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // When opened from a grid cell, scroll that occurrence into view.
  const initialOccRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!initialExpandedOcc) return
    const raf = requestAnimationFrame(() => {
      initialOccRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
  }, [initialExpandedOcc])

  // Still keyed on the owning body, which stays populated for every scope.
  const isSenate = bodies.find(b => b.id === scopeValue.body_id)?.name === 'Senate'
  // What an occurrence inherits when its visibility override is left on Default.
  const bookingHidden = booking.hidden

  if (!w) return null

  // `boolean` in the value union for the visibility override, which is the only
  // non-string field here.
  const updateOccurrence = (id: string, field: keyof Occurrence, value: string | boolean | null) => {
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
      purpose: null,
      hidden: null,
      // is_event is deliberately not reset: it is not an override, it is a
      // statement that this date is an event, and clearing the room and time
      // overrides does not stop it being one.
    } : o))
  }

  const handleSubmit = async () => {
    if (!scopeValue.body_id || !form.purpose || !form.room_name || !form.start_date || !form.end_date || !form.start_time || !form.end_time) {
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

    setSaving(true)
    const res = await fetch('/api/administrator/bookings/weekly', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: booking.id,
        weekly_id: w.id,
        ...form,
        ...scopeValue,
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
      <BookingScopeSelector
        value={scopeValue}
        onChange={setScopeValue}
        ownerBodies={bodies}
        allBodies={bodies}
        allowedDivisions={[...DIVISIONS]}
      />
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
          <DateField value={form.start_date} onChange={v => setForm({ ...form, start_date: v })} />
        </div>
        <div className="flex-1">
          <label className={labelCls}>End Date *</label>
          <DateField value={form.end_date} onChange={v => setForm({ ...form, end_date: v })} />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-0">
          <label className={labelCls}>Start Time *</label>
          <TimePicker value={form.start_time} onChange={v => setForm({ ...form, start_time: v })} />
        </div>
        <div className="flex-1 min-w-0">
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
          // `hidden != null` because false is an override, not an absence.
          const hasOverride = occ && (occ.room_name || occ.start_time || occ.end_time || occ.status
            || occ.reservation_code || occ.purpose || occ.hidden != null)
          const isExpanded = expandedOcc === date

          return (
            <div
              key={date}
              ref={date === initialExpandedOcc ? initialOccRef : undefined}
              className="border border-[#1e5080] rounded-xl overflow-hidden"
            >
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

                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 min-w-0">
                      <label className={labelCls}>Start Time Override</label>
                      <TimePicker
                        value={occ.start_time?.slice(0, 5) ?? form.start_time}
                        onChange={v => updateOccurrence(occ.id, 'start_time', v)}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
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

                  <div>
                    <label className={labelCls}>Purpose Override</label>
                    <input
                      type="text"
                      placeholder={`Default: ${form.purpose || 'None'}`}
                      value={occ.purpose ?? ''}
                      onChange={e => updateOccurrence(occ.id, 'purpose', e.target.value || null)}
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>Visibility Override</label>
                    {/* A select rather than a checkbox because there are three
                        states, not two: inherit, forced visible, forced hidden.
                        Forced-visible is what lets a single week of a hidden
                        series be published, and a checkbox cannot express the
                        difference between that and inheriting a visible parent. */}
                    <select
                      value={occ.hidden == null ? '' : occ.hidden ? 'hidden' : 'visible'}
                      onChange={e =>
                        updateOccurrence(
                          occ.id,
                          'hidden',
                          e.target.value === '' ? null : e.target.value === 'hidden'
                        )
                      }
                      className={inputCls}
                    >
                      <option value="">Default: {bookingHidden ? 'Hidden' : 'Visible'}</option>
                      <option value="visible">Visible</option>
                      <option value="hidden">Hidden</option>
                    </select>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    {/* A checkbox here, not a select like the two above, because
                        this one genuinely is two-state: a weekly event is marked
                        on the week it happens, so there is no parent value to
                        inherit and no third option to express. */}
                    <input
                      type="checkbox"
                      checked={occ.is_event}
                      onChange={e => updateOccurrence(occ.id, 'is_event', e.target.checked)}
                      className="accent-[#c8102e]"
                    />
                    <span className="text-sm text-[#f0f6ff]">Mark this date as an Event</span>
                  </label>

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