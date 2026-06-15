'use client'

import { useState, useEffect } from 'react'
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

interface Semester {
  id: string
  name: string
  is_active: boolean
}

interface Session {
  location: string
  session_date: string
  start_time: string
  end_time: string
  status: string
}

interface PendingRequest {
  id: string
  type: string
  purpose: string
  status: string
  created_at: string
  body_id: string
  bodies: { name: string } | null
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

interface TablingFormProps {
  bodies: Body[]
  semesters: Semester[]
  onClose: () => void
  onSuccess: () => void
}

const inputCls = "w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"

const emptySession = (): Session => ({
  location: '',
  session_date: '',
  start_time: '09:00',
  end_time: '10:00',
  status: 'Reserved',
})

export default function TablingForm({ bodies, semesters, onClose, onSuccess }: TablingFormProps) {
  const defaultSemesterId = semesters.find(s => s.is_active)?.id ?? ''
  const [semesterId, setSemesterId] = useState(defaultSemesterId)
  const [form, setForm] = useState({
    body_id: '',
    purpose: '',
    reservation_code: '',
  })
  const [sessions, setSessions] = useState<Session[]>([emptySession()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([])

  useEffect(() => {
    fetch('/api/administrator/requests')
      .then(r => r.json())
      .then(({ requests }) => {
        setPendingRequests(
          (requests ?? []).filter((r: PendingRequest) => r.status === 'Pending' && r.type === 'Tabling')
        )
      })
      .catch(() => {})
  }, [])

  const visibleRequests = form.body_id
    ? pendingRequests.filter(r => r.body_id === form.body_id)
    : pendingRequests

  const updateSession = (index: number, field: keyof Session, value: string) => {
    setSessions(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }

  const addSession = () => setSessions(prev => [...prev, emptySession()])

  const removeSession = (index: number) => {
    if (sessions.length === 1) return
    setSessions(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async () => {
    if (!semesterId) {
      setError('Please select a semester.')
      return
    }
    if (!form.body_id || !form.purpose) {
      setError('Please fill out all required fields.')
      return
    }

    for (const s of sessions) {
      if (!s.location || !s.session_date || !s.start_time || !s.end_time) {
        setError('Please fill out all required session fields.')
        return
      }
    }

    setSaving(true)
    const res = await fetch('/api/administrator/bookings/tabling', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, sessions, semester_id: semesterId }),
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
      <div className="flex-1 space-y-4">
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
          placeholder="e.g. Committee Tabling"
          value={form.purpose}
          onChange={e => setForm({ ...form, purpose: e.target.value })}
          className={inputCls}
        />
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

      {/* Sessions */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[#f0f6ff]">Sessions</span>
          <button
            onClick={addSession}
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
                  onClick={() => removeSession(i)}
                  className="text-xs text-slate-400 hover:text-[#c8102e] transition-colors"
                >
                  Remove
                </button>
              )}
            </div>

            <div>
              <label className={labelCls}>Location *</label>
              <input
                type="text"
                placeholder="e.g. Curry Crossroads"
                value={s.location}
                onChange={e => updateSession(i, 'location', e.target.value)}
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>Date *</label>
              <input
                type="date"
                value={s.session_date}
                onChange={e => updateSession(i, 'session_date', e.target.value)}
                className={inputCls}
              />
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
          <p className="text-xs font-semibold text-[#93b8d8] uppercase tracking-wide mb-3">Open Requests</p>
          {visibleRequests.length === 0 ? (
            <p className="text-xs text-[#6a96bb]">No open requests</p>
          ) : (
            <div className="space-y-2">
              {visibleRequests.map(r => (
                <div key={r.id} className="rounded-lg bg-[#0a1f38] border border-[#1e5080]/60 px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-[#f0f6ff]">{r.bodies?.name ?? '—'}</span>
                    <span className="text-xs text-[#6a96bb] shrink-0">{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-xs text-[#93b8d8] mb-1.5">{r.purpose}</p>
                  {(r.tabling_request_sessions ?? []).map((s, i) => (
                    <div key={i} className="flex gap-3 text-xs text-[#6a96bb]">
                      <span>{s.session_date ?? '—'}</span>
                      <span>{s.start_time?.slice(0, 5) ?? '—'} – {s.end_time?.slice(0, 5) ?? '—'}</span>
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