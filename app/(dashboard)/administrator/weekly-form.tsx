'use client'

import { useState, useEffect } from 'react'
import TimePicker from './time-picker'
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

interface WeeklyFormProps {
  bodies: Body[]
  semesters: Semester[]
  onClose: () => void
  onSuccess: () => void
}

const inputCls = "w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"

export default function WeeklyForm({ bodies, semesters, onClose, onSuccess }: WeeklyFormProps) {
  const defaultSemesterId = semesters.find(s => s.is_active)?.id ?? ''
  const [semesterId, setSemesterId] = useState(defaultSemesterId)
  // Admins may scope a booking to any division, so the full list is always allowed here.
  const [scopeValue, setScopeValue] = useState<BookingScopeValue>({
    scope: 'single',
    body_id: '',
    division: null,
    body_ids: [],
  })
  const [form, setForm] = useState({
    purpose: '',
    room_name: '',
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
    reservation_code: '',
    status: 'Reserved',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([])
  const [requestTypeFilter, setRequestTypeFilter] = useState<'all' | BookingScope>('all')

  useEffect(() => {
    fetch('/api/administrator/requests')
      .then(r => r.json())
      .then(({ requests }) => {
        setPendingRequests(
          (requests ?? []).filter((r: PendingRequest) => r.status === 'Pending' && r.type === 'Weekly Room')
        )
      })
      .catch(() => {})
  }, [])

  const visibleRequests = pendingRequests
    .filter(r => !scopeValue.body_id || r.body_id === scopeValue.body_id)
    .filter(r => requestTypeFilter === 'all' || r.scope === requestTypeFilter)

  const handleSubmit = async () => {
    if (!semesterId) {
      setError('Please select a semester.')
      return
    }
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

    if (form.end_date < form.start_date) {
      setError('End date must be after start date.')
      return
    }

    setSaving(true)
    const res = await fetch('/api/administrator/bookings/weekly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, ...scopeValue, semester_id: semesterId }),
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
          placeholder="e.g. Weekly Meeting"
          value={form.purpose}
          onChange={e => setForm({ ...form, purpose: e.target.value })}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Room Name *</label>
        <input
          type="text"
          placeholder="e.g. Curry 318"
          value={form.room_name}
          onChange={e => setForm({ ...form, room_name: e.target.value })}
          className={inputCls}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelCls}>Start Date *</label>
          <input
            type="date"
            value={form.start_date}
            onChange={e => setForm({ ...form, start_date: e.target.value })}
            className={inputCls}
          />
        </div>
        <div className="flex-1">
          <label className={labelCls}>End Date *</label>
          <input
            type="date"
            value={form.end_date}
            onChange={e => setForm({ ...form, end_date: e.target.value })}
            className={inputCls}
          />
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
                    <div key={i} className="text-xs text-[#6a96bb] space-y-0.5">
                      <div>{d.start_date ?? '—'} – {d.end_date ?? '—'}</div>
                      <div>{d.start_time?.slice(0, 5) ?? '—'} – {d.end_time?.slice(0, 5) ?? '—'}</div>
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