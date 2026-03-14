'use client'

import { useState } from 'react'

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

interface WeeklyFormProps {
  bodies: Body[]
  onClose: () => void
  onSuccess: () => void
}

const inputCls = "w-full border border-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/20 focus:border-[#c8102e] transition"
const labelCls = "block text-xs font-medium text-slate-500 mb-1"

export default function WeeklyForm({ bodies, onClose, onSuccess }: WeeklyFormProps) {
  const [form, setForm] = useState({
    body_id: '',
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

  const handleSubmit = async () => {
    if (!form.body_id || !form.purpose || !form.room_name || !form.start_date || !form.end_date || !form.start_time || !form.end_time) {
      setError('Please fill out all required fields.')
      return
    }

    if (form.end_date < form.start_date) {
      setError('End date must be after start date.')
      return
    }

    setSaving(true)
    const res = await fetch('/api/management/bookings/weekly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
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
          <input
            type="time"
            value={form.start_time}
            onChange={e => setForm({ ...form, start_time: e.target.value })}
            className={inputCls}
          />
        </div>
        <div className="flex-1">
          <label className={labelCls}>End Time *</label>
          <input
            type="time"
            value={form.end_time}
            onChange={e => setForm({ ...form, end_time: e.target.value })}
            className={inputCls}
          />
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
          className="px-4 py-2 border border-[#e2e8f0] text-slate-700 text-sm rounded-lg hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}