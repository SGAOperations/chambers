'use client'

import { useEffect, useState } from 'react'

const inputCls = "w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"

export default function BookingSettingsTab() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [minDaysRoom, setMinDaysRoom] = useState(0)
  const [minDaysTabling, setMinDaysTabling] = useState(0)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/management/settings')
      .then(r => r.json())
      .then(data => {
        setMinDaysRoom(data.min_days_advance_room ?? 0)
        setMinDaysTabling(data.min_days_advance_tabling ?? 0)
        setLoading(false)
      })
  }, [])

  const handleSave = async () => {
    setError('')
    setSuccess(false)
    setSaving(true)

    const res = await fetch('/api/management/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        min_days_advance_room: minDaysRoom,
        min_days_advance_tabling: minDaysTabling,
      }),
    })

    if (res.ok) {
      setSuccess(true)
    } else {
      const data = await res.json()
      setError(data.error || 'Something went wrong.')
    }
    setSaving(false)
  }

  if (loading) return <div className="text-[#93b8d8] text-sm">Loading...</div>

  return (
    <div className="max-w-sm space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-[#f0f6ff] mb-4">Advance Notice Requirements</h2>
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Minimum Days Advance Notice — Room</label>
            <input
              type="number"
              min={0}
              value={minDaysRoom}
              onChange={e => { setSuccess(false); setMinDaysRoom(Math.max(0, parseInt(e.target.value) || 0)) }}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Minimum Days Advance Notice — Tabling</label>
            <input
              type="number"
              min={0}
              value={minDaysTabling}
              onChange={e => { setSuccess(false); setMinDaysTabling(Math.max(0, parseInt(e.target.value) || 0)) }}
              className={inputCls}
            />
          </div>
        </div>
      </div>

      {error && <p className="text-[#c8102e] text-sm">{error}</p>}
      {success && <p className="text-green-400 text-sm">Settings saved.</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-5 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  )
}
