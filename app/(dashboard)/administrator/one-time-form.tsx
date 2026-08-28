'use client'

import { useState, useEffect } from 'react'
import { getJson } from '@/lib/fetch-json'
import TimePicker from './time-picker'
import DateField from '@/app/_components/date-field'
import BookingScopeSelector, { type BookingScopeValue } from '@/app/_components/booking-scope-selector'
import ScopeLabel from '@/app/_components/scope-label'
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

interface Semester {
  id: string
  name: string
  is_active: boolean
}

interface PendingRequest {
  id: string
  type: string
  purpose: string
  status: string
  created_at: string
  body_id: string
  scope: BookingScope
  division: Division | null
  bodies: { name: string } | null
  room_request_bodies: { body_id: string; bodies: { name: string } | null }[] | null
  room_request_details: Array<{
    start_date: string | null
    end_date: string | null
    start_time: string | null
    end_time: string | null
  }> | null
  tabling_request_sessions: Array<{
    session_date: string | null
    start_time: string | null
    end_time: string | null
  }> | null
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

interface OneTimeFormProps {
  bodies: Body[]
  semesters: Semester[]
  onClose: () => void
  onSuccess: () => void
}

export default function OneTimeForm({ bodies, semesters, onClose, onSuccess }: OneTimeFormProps) {
  const defaultSemesterId = semesters.find(s => s.is_active)?.id ?? ''
  const [form, setForm] = useState({ purpose: '' })
  // Admins may scope a booking to any division, so the full list is always allowed here.
  const [scopeValue, setScopeValue] = useState<BookingScopeValue>({
    scope: 'single',
    body_id: '',
    division: null,
    body_ids: [],
  })
  const [semesterId, setSemesterId] = useState(defaultSemesterId)
  const [sessions, setSessions] = useState<OneTimeSession[]>([emptySession()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([])
  const [requestTypeFilter, setRequestTypeFilter] = useState<'all' | BookingScope>('all')

  useEffect(() => {
    getJson<{ requests?: PendingRequest[] }>('/api/administrator/requests', {})
      .then(({ requests }) => {
        setPendingRequests(
          (requests ?? []).filter((r: PendingRequest) => r.status === 'Pending' && r.type === 'One-Time Room')
        )
      })
  }, [])

  const visibleRequests = pendingRequests
    .filter(r => !scopeValue.body_id || r.body_id === scopeValue.body_id)
    .filter(r => requestTypeFilter === 'all' || r.scope === requestTypeFilter)

  const updateSession = (index: number, field: keyof OneTimeSession, value: string) => {
    setSessions(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }

  const handleSubmit = async () => {
    if (!semesterId) {
      setError('Please select a semester.')
      return
    }
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...scopeValue,
        purpose: form.purpose,
        sessions,
        semester_id: semesterId,
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

  const inputCls = "w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
  const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"

  return (
    <div className="flex gap-8 items-start">
      <div className="flex-1 space-y-3">
      <div>
        <label className={labelCls}>Semester *</label>
        {semesters.length === 0 ? (
          <p className="text-sm text-[#f87171]">No semesters available. Create one in Advanced Settings.</p>
        ) : (
          <select
            value={semesterId}
            onChange={e => setSemesterId(e.target.value)}
            className={inputCls}
          >
            <option value="">Select Semester</option>
            {semesters.map(sem => (
              <option key={sem.id} value={sem.id}>{sem.name}{sem.is_active ? ' (Active)' : ''}</option>
            ))}
          </select>
        )}
      </div>

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
          placeholder="e.g. Club Meeting"
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
                placeholder="e.g. Curry 318"
                value={s.room_name}
                onChange={e => updateSession(i, 'room_name', e.target.value)}
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>Date *</label>
              <DateField value={s.booking_date} onChange={v => updateSession(i, 'booking_date', v)} />
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 min-w-0">
                <label className={labelCls}>Start Time *</label>
                <TimePicker value={s.start_time} onChange={v => updateSession(i, 'start_time', v)} />
              </div>
              <div className="flex-1 min-w-0">
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
          {saving ? 'Saving...' : 'Create Booking'}
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 border border-[#1e5080] text-[#f0f6ff] text-sm rounded-lg hover:bg-[#1a4d8a] transition-colors"
        >
          Cancel
        </button>
      </div>
      </div>

      <div className="w-96 shrink-0">
        <div className="rounded-xl border border-[#1e5080] bg-[#0f2a4a] p-4 h-full">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-xs font-semibold text-[#93b8d8] uppercase tracking-wide">Open Requests</p>
            <select
              value={requestTypeFilter}
              onChange={e => setRequestTypeFilter(e.target.value as 'all' | BookingScope)}
              className="text-xs bg-[#0a1f38] border border-[#1e5080] rounded-lg px-2 py-1 text-[#93b8d8] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e]"
            >
              <option value="all">All Types</option>
              <option value="single">Single Body</option>
              <option value="divisional">Divisional</option>
              <option value="multi">Multi-Body</option>
            </select>
          </div>
          {visibleRequests.length === 0 ? (
            <p className="text-xs text-[#6a96bb]">No open requests</p>
          ) : (
            <div className="space-y-2">
              {visibleRequests.map(r => (
                <div key={r.id} className="rounded-lg bg-[#0a1f38] border border-[#1e5080]/60 px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <ScopeLabel
                      row={r}
                      linkedBodies={(r.room_request_bodies ?? []).map(x => ({ id: x.body_id, name: x.bodies?.name ?? '' }))}
                      className="text-sm font-semibold text-[#f0f6ff]"
                    />
                    <span className="text-xs text-[#6a96bb] shrink-0">{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-xs text-[#93b8d8] mb-1.5">{r.purpose}</p>
                  {(r.room_request_details ?? []).map((d, i) => (
                    <div key={i} className="flex gap-3 text-xs text-[#6a96bb]">
                      <span>{d.start_date ?? '—'}</span>
                      <span>{d.start_time?.slice(0, 5) ?? '—'} – {d.end_time?.slice(0, 5) ?? '—'}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
