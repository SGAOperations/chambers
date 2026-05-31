'use client'

import { useState, useEffect, useCallback } from 'react'
import TimePicker from './time-picker'
import { Skeleton } from '@/app/_components/skeleton'

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <div className="rounded-xl border border-[#1e5080] overflow-hidden animate-pulse">
      <div className="border-b border-[#1e5080] px-4 py-3 flex gap-6">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className="h-3 w-20" />
        ))}
      </div>
      {[0, 1, 2].map(i => (
        <div key={i} className="border-b border-[#1e5080]/50 last:border-0 px-4 py-3 flex gap-6">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3.5 w-28" />
          {cols > 3 && <Skeleton className="h-3.5 w-28" />}
          {cols > 4 && <Skeleton className="h-3.5 w-8" />}
        </div>
      ))}
    </div>
  )
}

interface Space {
  id: string
  name: string
  capacity: number
}

interface SpaceBooking {
  id: string
  space_id: string
  creator_id: string
  title: string
  start_time: string
  end_time: string
  attendee_ids: string[]
  creator_name: string | null
  spaces?: { name: string } | null
}

interface Blackout {
  id: string
  space_id: string | null
  start_time: string
  end_time: string
  spaces?: { name: string } | null
}

interface LimitOverride {
  id: string
  user_id: string
  weekly_hours_limit: number
  users?: { id: string; full_name: string; email: string } | null
}

interface UserResult {
  id: string
  full_name: string
  email: string
}

type SubTab = 'Bookings' | 'Blackouts' | 'Limit Overrides'

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  })
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10)
}

const inputCls = "bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition w-full"
const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"

export default function SGASpacesTab() {
  const [subTab, setSubTab] = useState<SubTab>('Bookings')
  const [spaces, setSpaces] = useState<Space[]>([])

  useEffect(() => {
    fetch('/api/spaces').then(r => r.json()).then(setSpaces)
  }, [])

  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b border-[#1e5080]">
        {(['Bookings', 'Blackouts', 'Limit Overrides'] as SubTab[]).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              subTab === t
                ? 'border-[#c8102e] text-[#f0f6ff] font-semibold'
                : 'border-transparent text-[#93b8d8] hover:text-[#c8102e]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {subTab === 'Bookings' && <AdminBookingsPanel spaces={spaces} />}
      {subTab === 'Blackouts' && <AdminBlackoutsPanel spaces={spaces} />}
      {subTab === 'Limit Overrides' && <AdminLimitOverridesPanel />}
    </div>
  )
}

// ─── Bookings panel ──────────────────────────────────────────────────────────

function AdminBookingsPanel({ spaces }: { spaces: Space[] }) {
  const [bookings, setBookings] = useState<SpaceBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const fetchBookings = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch for all spaces, current + future week (use a wide window)
      const now = new Date()
      const weekStart = new Date(now)
      weekStart.setUTCDate(now.getUTCDate() - now.getUTCDay())
      weekStart.setUTCHours(0, 0, 0, 0)

      // Fetch per space and merge
      const results: SpaceBooking[] = []
      for (const space of spaces) {
        const res = await fetch(`/api/spaces/bookings?space_id=${space.id}&week_start=${weekStart.toISOString()}`)
        if (res.ok) {
          const data = await res.json()
          results.push(
            ...(data.bookings ?? []).map((b: SpaceBooking) => ({
              ...b,
              spaces: { name: space.name },
            }))
          )
        }
      }
      results.sort((a, b) => a.start_time.localeCompare(b.start_time))
      setBookings(results)
    } finally {
      setLoading(false)
    }
  }, [spaces])

  useEffect(() => {
    if (spaces.length > 0) fetchBookings()
  }, [fetchBookings, spaces])

  const cancelBooking = async (id: string) => {
    if (!confirm('Force-cancel this booking? Confirmation emails will be sent.')) return
    setCancellingId(id)
    try {
      const res = await fetch(`/api/spaces/bookings/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setBookings(prev => prev.filter(b => b.id !== id))
      } else {
        const data = await res.json()
        alert(data.error ?? 'Failed to cancel booking.')
      }
    } finally {
      setCancellingId(null)
    }
  }

  if (loading) return <TableSkeleton cols={6} />

  if (bookings.length === 0) {
    return <div className="text-[#93b8d8] text-sm">No upcoming space bookings.</div>
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-[#93b8d8]">Showing current week. Force-cancelling sends email to creator and all attendees.</p>
      <div className="overflow-x-auto rounded-xl border border-[#1e5080]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1e5080] text-[#93b8d8] text-xs">
              <th className="px-4 py-3 text-left font-medium">Space</th>
              <th className="px-4 py-3 text-left font-medium">Title</th>
              <th className="px-4 py-3 text-left font-medium">Creator</th>
              <th className="px-4 py-3 text-left font-medium">Start</th>
              <th className="px-4 py-3 text-left font-medium">End</th>
              <th className="px-4 py-3 text-left font-medium">Attendees</th>
              <th className="px-4 py-3 text-left font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {bookings.map(b => (
              <tr key={b.id} className="border-b border-[#1e5080]/50 last:border-0 hover:bg-white/5">
                <td className="px-4 py-3 text-[#f0f6ff]">{b.spaces?.name ?? '—'}</td>
                <td className="px-4 py-3 text-[#f0f6ff] font-medium">{b.title}</td>
                <td className="px-4 py-3 text-[#93b8d8]">{b.creator_name ?? '—'}</td>
                <td className="px-4 py-3 text-[#93b8d8] whitespace-nowrap">{formatDateTime(b.start_time)}</td>
                <td className="px-4 py-3 text-[#93b8d8] whitespace-nowrap">{formatDateTime(b.end_time)}</td>
                <td className="px-4 py-3 text-[#93b8d8]">{(b.attendee_ids ?? []).length + 1}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => cancelBooking(b.id)}
                    disabled={cancellingId === b.id}
                    className="text-xs text-[#c8102e] hover:text-[#f87171] disabled:opacity-50 font-medium transition-colors"
                  >
                    {cancellingId === b.id ? 'Cancelling…' : 'Force Cancel'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Blackouts panel ─────────────────────────────────────────────────────────

type EditBlackoutForm = {
  id: string
  space_id: string
  start_date: string
  start_time: string
  end_date: string
  end_time: string
}

function isoToFormDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: d.toISOString().slice(0, 10),
    time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
  }
}

function AdminBlackoutsPanel({ spaces }: { spaces: Space[] }) {
  const [blackouts, setBlackouts] = useState<Blackout[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    space_id: '',
    start_date: todayDateStr(),
    start_time: '07:00',
    end_date: todayDateStr(),
    end_time: '23:00',
  })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditBlackoutForm | null>(null)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const fetchBlackouts = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/spaces/blackouts')
    if (res.ok) setBlackouts(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { fetchBlackouts() }, [fetchBlackouts])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setSubmitting(true)
    try {
      const start_time = new Date(`${form.start_date}T${form.start_time}:00Z`).toISOString()
      const end_time = new Date(`${form.end_date}T${form.end_time}:00Z`).toISOString()
      const res = await fetch('/api/spaces/blackouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          space_id: form.space_id || null,
          start_time,
          end_time,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setFormError(data.error ?? 'Failed to create blackout.'); return }
      await fetchBlackouts()
      setForm(f => ({ ...f, start_time: '07:00', end_time: '23:00' }))
    } finally {
      setSubmitting(false)
    }
  }

  const deleteBlackout = async (id: string) => {
    setDeletingId(id)
    const res = await fetch(`/api/spaces/blackouts/${id}`, { method: 'DELETE' })
    if (res.ok) setBlackouts(prev => prev.filter(b => b.id !== id))
    setDeletingId(null)
  }

  const openEdit = (bl: Blackout) => {
    const { date: start_date, time: start_time } = isoToFormDateTime(bl.start_time)
    const { date: end_date, time: end_time } = isoToFormDateTime(bl.end_time)
    setEditForm({ id: bl.id, space_id: bl.space_id ?? '', start_date, start_time, end_date, end_time })
    setEditError(null)
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editForm) return
    setEditError(null)
    setEditSubmitting(true)
    try {
      const start_time = new Date(`${editForm.start_date}T${editForm.start_time}:00Z`).toISOString()
      const end_time = new Date(`${editForm.end_date}T${editForm.end_time}:00Z`).toISOString()
      const res = await fetch(`/api/spaces/blackouts/${editForm.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ space_id: editForm.space_id || null, start_time, end_time }),
      })
      const data = await res.json()
      if (!res.ok) { setEditError(data.error ?? 'Failed to update blackout.'); return }
      setEditForm(null)
      await fetchBlackouts()
    } finally {
      setEditSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Create form */}
      <form onSubmit={handleCreate} className="bg-[#0f2a4a] border border-[#1e5080] rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[#f0f6ff]">Create Blackout Window</h3>
        <div>
          <label className={labelCls}>Space (leave blank for all spaces)</label>
          <select
            value={form.space_id}
            onChange={e => setForm(f => ({ ...f, space_id: e.target.value }))}
            className={inputCls}
          >
            <option value="">All Spaces</option>
            {spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Start Date</label>
            <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className={inputCls} required />
          </div>
          <div>
            <label className={labelCls}>Start Time</label>
            <TimePicker value={form.start_time} onChange={v => setForm(f => ({ ...f, start_time: v }))} interval={15} />
          </div>
          <div>
            <label className={labelCls}>End Date</label>
            <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} className={inputCls} required />
          </div>
          <div>
            <label className={labelCls}>End Time</label>
            <TimePicker value={form.end_time} onChange={v => setForm(f => ({ ...f, end_time: v }))} interval={15} />
          </div>
        </div>

        {formError && (
          <div className="bg-[#c8102e]/10 border border-[#c8102e]/30 rounded-lg px-3 py-2 text-sm text-[#f87171]">{formError}</div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="py-2.5 px-5 bg-[#c8102e] hover:bg-[#a50d26] disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {submitting ? 'Creating…' : 'Create Blackout'}
        </button>
      </form>

      {/* Existing blackouts */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[#f0f6ff]">Active Blackouts</h3>
        {loading ? (
          <TableSkeleton cols={4} />
        ) : blackouts.length === 0 ? (
          <div className="text-sm text-[#93b8d8]">No blackouts configured.</div>
        ) : (
          <div className="rounded-xl border border-[#1e5080] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e5080] text-[#93b8d8] text-xs">
                  <th className="px-4 py-3 text-left font-medium">Space</th>
                  <th className="px-4 py-3 text-left font-medium">Start</th>
                  <th className="px-4 py-3 text-left font-medium">End</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {blackouts.map(bl => (
                  <tr key={bl.id} className="border-b border-[#1e5080]/50 last:border-0 hover:bg-white/5">
                    <td className="px-4 py-3 text-[#f0f6ff]">{bl.spaces?.name ?? 'All Spaces'}</td>
                    <td className="px-4 py-3 text-[#93b8d8] whitespace-nowrap">{formatDateTime(bl.start_time)}</td>
                    <td className="px-4 py-3 text-[#93b8d8] whitespace-nowrap">{formatDateTime(bl.end_time)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => openEdit(bl)}
                          className="text-xs text-[#93b8d8] hover:text-[#f0f6ff] font-medium transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteBlackout(bl.id)}
                          disabled={deletingId === bl.id}
                          className="text-xs text-[#c8102e] hover:text-[#f87171] disabled:opacity-50 font-medium transition-colors"
                        >
                          {deletingId === bl.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit blackout modal */}
      {editForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setEditForm(null)}>
          <div className="bg-[#0a1628] border border-[#1e5080] rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-[#1e5080]">
              <h3 className="text-base font-semibold text-[#f0f6ff]">Edit Blackout</h3>
              <button onClick={() => setEditForm(null)} className="text-[#93b8d8] hover:text-[#f0f6ff] transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-5 space-y-4">
              <div>
                <label className={labelCls}>Space</label>
                <select value={editForm.space_id} onChange={e => setEditForm(f => f && ({ ...f, space_id: e.target.value }))} className={inputCls}>
                  <option value="">All Spaces</option>
                  {spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Start Date</label>
                  <input type="date" value={editForm.start_date} onChange={e => setEditForm(f => f && ({ ...f, start_date: e.target.value }))} className={inputCls} required />
                </div>
                <div>
                  <label className={labelCls}>Start Time</label>
                  <TimePicker value={editForm.start_time} onChange={v => setEditForm(f => f && ({ ...f, start_time: v }))} interval={15} />
                </div>
                <div>
                  <label className={labelCls}>End Date</label>
                  <input type="date" value={editForm.end_date} onChange={e => setEditForm(f => f && ({ ...f, end_date: e.target.value }))} className={inputCls} required />
                </div>
                <div>
                  <label className={labelCls}>End Time</label>
                  <TimePicker value={editForm.end_time} onChange={v => setEditForm(f => f && ({ ...f, end_time: v }))} interval={15} />
                </div>
              </div>
              {editError && (
                <div className="bg-[#c8102e]/10 border border-[#c8102e]/30 rounded-lg px-3 py-2 text-sm text-[#f87171]">{editError}</div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditForm(null)} className="flex-1 py-2.5 border border-[#1e5080] text-[#93b8d8] text-sm font-medium rounded-lg hover:text-[#f0f6ff] hover:border-[#93b8d8] transition-colors">Cancel</button>
                <button type="submit" disabled={editSubmitting} className="flex-1 py-2.5 bg-[#c8102e] hover:bg-[#a50d26] disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
                  {editSubmitting ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Limit overrides panel ───────────────────────────────────────────────────

function AdminLimitOverridesPanel() {
  const [overrides, setOverrides] = useState<LimitOverride[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [userSearch, setUserSearch] = useState('')
  const [userResults, setUserResults] = useState<UserResult[]>([])
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null)
  const [limitValue, setLimitValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const searchTimerRef = useState<ReturnType<typeof setTimeout> | null>(null)

  const fetchOverrides = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/spaces/limit-overrides')
    if (res.ok) setOverrides(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { fetchOverrides() }, [fetchOverrides])

  useEffect(() => {
    if (searchTimerRef[0]) clearTimeout(searchTimerRef[0])
    if (userSearch.length < 2) { setUserResults([]); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(userSearch)}`)
      if (res.ok) setUserResults(await res.json())
    }, 300)
    searchTimerRef[0] = t
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSearch])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!selectedUser) { setFormError('Select a user.'); return }
    const hrs = parseFloat(limitValue)
    if (isNaN(hrs) || hrs < 0) { setFormError('Enter a valid non-negative number of hours.'); return }

    setSubmitting(true)
    try {
      const res = await fetch('/api/spaces/limit-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: selectedUser.id, weekly_hours_limit: hrs }),
      })
      const data = await res.json()
      if (!res.ok) { setFormError(data.error ?? 'Failed.'); return }
      await fetchOverrides()
      setSelectedUser(null)
      setUserSearch('')
      setLimitValue('')
    } finally {
      setSubmitting(false)
    }
  }

  const deleteOverride = async (id: string) => {
    setDeletingId(id)
    const res = await fetch(`/api/spaces/limit-overrides/${id}`, { method: 'DELETE' })
    if (res.ok) setOverrides(prev => prev.filter(o => o.id !== id))
    setDeletingId(null)
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="bg-[#0f2a4a] border border-[#1e5080] rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[#f0f6ff]">Set Weekly Hour Override</h3>
        <p className="text-xs text-[#93b8d8]">Default limit is 18 hrs/week Sun–Sat. Overrides replace that limit for the specified user.</p>

        <div>
          <label className={labelCls}>User</label>
          {selectedUser ? (
            <div className="flex items-center justify-between bg-[#0a1628] border border-[#1e5080] rounded-lg px-3 py-2.5">
              <div>
                <div className="text-sm text-[#f0f6ff] font-medium">{selectedUser.full_name}</div>
                <div className="text-xs text-[#93b8d8]">{selectedUser.email}</div>
              </div>
              <button type="button" onClick={() => { setSelectedUser(null); setUserSearch('') }} className="text-[#93b8d8] hover:text-[#c8102e] transition-colors text-xs">Change</button>
            </div>
          ) : (
            <div className="relative">
              <input
                type="text"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                placeholder="Search by name or email…"
                className={inputCls}
                autoComplete="off"
              />
              {userResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg shadow-xl overflow-hidden">
                  {userResults.map(u => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => { setSelectedUser(u); setUserSearch(''); setUserResults([]) }}
                      className="w-full text-left px-3 py-2 hover:bg-white/10 transition-colors"
                    >
                      <div className="text-sm text-[#f0f6ff] font-medium">{u.full_name}</div>
                      <div className="text-xs text-[#93b8d8]">{u.email}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <label className={labelCls}>Weekly Hours Limit</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={limitValue}
            onChange={e => setLimitValue(e.target.value)}
            placeholder="e.g. 24"
            className={inputCls}
            required
          />
        </div>

        {formError && (
          <div className="bg-[#c8102e]/10 border border-[#c8102e]/30 rounded-lg px-3 py-2 text-sm text-[#f87171]">{formError}</div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="py-2.5 px-5 bg-[#c8102e] hover:bg-[#a50d26] disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {submitting ? 'Saving…' : 'Save Override'}
        </button>
      </form>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[#f0f6ff]">Existing Overrides</h3>
        {loading ? (
          <TableSkeleton cols={4} />
        ) : overrides.length === 0 ? (
          <div className="text-sm text-[#93b8d8]">No overrides set. All users are subject to the 18 hr/week default.</div>
        ) : (
          <div className="rounded-xl border border-[#1e5080] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e5080] text-[#93b8d8] text-xs">
                  <th className="px-4 py-3 text-left font-medium">User</th>
                  <th className="px-4 py-3 text-left font-medium">Email</th>
                  <th className="px-4 py-3 text-left font-medium">Weekly Limit</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {overrides.map(o => (
                  <tr key={o.id} className="border-b border-[#1e5080]/50 last:border-0 hover:bg-white/5">
                    <td className="px-4 py-3 text-[#f0f6ff] font-medium">{o.users?.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-[#93b8d8]">{o.users?.email ?? '—'}</td>
                    <td className="px-4 py-3 text-[#f0f6ff]">{o.weekly_hours_limit} hrs</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => deleteOverride(o.id)}
                        disabled={deletingId === o.id}
                        className="text-xs text-[#c8102e] hover:text-[#f87171] disabled:opacity-50 font-medium transition-colors"
                      >
                        {deletingId === o.id ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
