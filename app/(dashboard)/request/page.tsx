'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import TimePicker from '../management/time-picker'

type RequestType = 'One-Time Room' | 'Weekly Room' | 'Tabling'

interface Body {
  id: string
  name: string
}

interface TablingSession {
  session_date: string
  start_time: string
  end_time: string
}

const inputCls = "w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"

const emptySession = (): TablingSession => ({
  session_date: '',
  start_time: '09:00',
  end_time: '10:00',
})

export default function RequestPage() {
  const router = useRouter()
  const [type, setType] = useState<RequestType>('One-Time Room')
  const [bodies, setBodies] = useState<Body[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    body_id: '',
    purpose: '',
    notes: '',
    room_name: '',
    start_date: '',
    end_date: '',
    start_time: '09:00',
    end_time: '10:00',
  })

  const [sessions, setSessions] = useState<TablingSession[]>([emptySession()])

  useEffect(() => {
    const fetchBodies = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      const isAdmin = user?.app_metadata?.is_admin ?? false

      const res = await fetch('/api/request')
      const data = await res.json()
      const resolved = data.bodies || []
      if (resolved.length === 0 && !isAdmin) {
        router.replace('/dashboard')
        return
      }
      setBodies(resolved)
      setLoading(false)
    }
    fetchBodies()
  }, [])

  const updateSession = (index: number, field: keyof TablingSession, value: string) => {
    setSessions(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }

  const handleSubmit = async () => {
    setError('')

    if (!form.body_id || !form.purpose) {
      setError('Please fill out all required fields.')
      return
    }

    if (type === 'One-Time Room' && !form.start_date) {
      setError('Please select a date.')
      return
    }

    if (type === 'Weekly Room' && (!form.start_date || !form.end_date)) {
      setError('Please select start and end dates.')
      return
    }

    if (type === 'Tabling') {
      for (const s of sessions) {
        if (!s.session_date || !s.start_time || !s.end_time) {
          setError('Please fill out all session fields.')
          return
        }
      }
    }

    setSubmitting(true)

    const payload: Record<string, unknown> = {
      type,
      body_id: form.body_id,
      purpose: form.purpose,
      notes: form.notes,
    }

    if (type === 'One-Time Room' || type === 'Weekly Room') {
      payload.details = {
        room_name: form.room_name || null,
        start_date: form.start_date,
        start_time: form.start_time,
        end_time: form.end_time,
        end_date: type === 'Weekly Room' ? form.end_date : null,
      }
    }

    if (type === 'Tabling') {
      payload.sessions = sessions
    }

    const res = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (res.ok) {
      setSubmitted(true)
    } else {
      const data = await res.json()
      setError(data.error || 'Something went wrong.')
    }
    setSubmitting(false)
  }

  const resetForm = () => {
    setForm({ body_id: '', purpose: '', notes: '', room_name: '', start_date: '', end_date: '', start_time: '09:00', end_time: '10:00' })
    setSessions([emptySession()])
    setSubmitted(false)
    setError('')
  }

  if (loading) return <div className="text-[#93b8d8] text-sm">Loading...</div>

  if (submitted) return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-[#f0f6ff] mb-2">Request Submitted</h1>
      <p className="text-[#93b8d8] text-sm mb-6">Your request has been submitted. Please allow up to 48 hours for an update from the Operational Affairs team.</p>
      <button
        onClick={resetForm}
        className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors"
      >
        Submit Another Request
      </button>
    </div>
  )

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold text-[#f0f6ff]">Request a Booking</h1>

      {/* Type selector */}
      <div className="flex gap-1 border-b border-[#1e5080]">
        {(['One-Time Room', 'Weekly Room', 'Tabling'] as RequestType[]).map(t => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              type === t
                ? 'border-[#c8102e] text-[#f0f6ff] font-semibold'
                : 'border-transparent text-[#93b8d8] hover:text-[#f0f6ff]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Common fields */}
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Body *</label>
          <select value={form.body_id} onChange={e => setForm({ ...form, body_id: e.target.value })} className={inputCls}>
            <option value="">Select Body</option>
            {bodies.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        <div>
          <label className={labelCls}>Purpose *</label>
          <input type="text" placeholder="e.g. Weekly Meeting" value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} className={inputCls} />
        </div>

        {/* One-Time Room fields */}
        {type === 'One-Time Room' && (
          <>
            <div>
              <label className={labelCls}>Preferred Room</label>
              <input type="text" placeholder="Optional" value={form.room_name} onChange={e => setForm({ ...form, room_name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Date *</label>
              <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className={inputCls} />
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
          </>
        )}

        {/* Weekly Room fields */}
        {type === 'Weekly Room' && (
          <>
            <div>
              <label className={labelCls}>Preferred Room</label>
              <input type="text" placeholder="Optional" value={form.room_name} onChange={e => setForm({ ...form, room_name: e.target.value })} className={inputCls} />
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
          </>
        )}

        {/* Tabling fields */}
        {type === 'Tabling' && (
          <div className="space-y-4">
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
                  <label className={labelCls}>Date *</label>
                  <input type="date" value={s.session_date} onChange={e => updateSession(i, 'session_date', e.target.value)} className={inputCls} />
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
              </div>
            ))}
          </div>
        )}

        <div>
          <label className={labelCls}>Additional Notes</label>
          <textarea
            placeholder="Optional"
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            rows={3}
            className={inputCls}
          />
        </div>
      </div>

      {error && <p className="text-[#c8102e] text-sm">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="px-6 py-2.5 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
      >
        {submitting ? 'Submitting...' : 'Submit Request'}
      </button>
    </div>
  )
}