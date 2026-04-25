'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import TimePicker from '../administrator/time-picker'

interface User {
  id: string
  full_name: string
  email: string
}

interface SpaceBookingModalProps {
  spaceId: string
  spaceName: string
  initialStart: string // ISO
  initialEnd: string   // ISO
  onClose: () => void
  onSuccess: () => void
  // Edit mode — when provided, PATCH is used instead of POST
  editBookingId?: string
  initialTitle?: string
  initialAttendees?: User[]
}

function isoToDateAndTime(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const date = d.toISOString().slice(0, 10)
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  return { date, time }
}

function dateAndTimeToIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00Z`).toISOString()
}

export default function SpaceBookingModal({
  spaceId,
  spaceName,
  initialStart,
  initialEnd,
  onClose,
  onSuccess,
  editBookingId,
  initialTitle = '',
  initialAttendees = [],
}: SpaceBookingModalProps) {
  const isEditing = !!editBookingId

  const { date: initDate, time: initStartTime } = isoToDateAndTime(initialStart)
  const { time: initEndTime } = isoToDateAndTime(initialEnd)

  const [title, setTitle] = useState(initialTitle)
  const [date, setDate] = useState(initDate)
  const [startTime, setStartTime] = useState(initStartTime)
  const [endTime, setEndTime] = useState(initEndTime)
  const [attendees, setAttendees] = useState<User[]>(initialAttendees)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<User[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const searchUsers = useCallback(async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return }
    setSearchLoading(true)
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`)
      if (res.ok) {
        const data: User[] = await res.json()
        setSearchResults(data.filter(u => !attendees.some(a => a.id === u.id)))
      }
    } finally {
      setSearchLoading(false)
    }
  }, [attendees])

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => searchUsers(searchQuery), 300)
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current) }
  }, [searchQuery, searchUsers])

  const addAttendee = (user: User) => {
    setAttendees(prev => [...prev, user])
    setSearchQuery('')
    setSearchResults([])
  }

  const removeAttendee = (id: string) => {
    setAttendees(prev => prev.filter(a => a.id !== id))
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    if (!title.trim()) { setError('Title is required.'); return }
    if (!date) { setError('Date is required.'); return }

    setSubmitting(true)
    try {
      const start_time = dateAndTimeToIso(date, startTime)
      const end_time = dateAndTimeToIso(date, endTime)

      const res = isEditing
        ? await fetch(`/api/spaces/bookings/${editBookingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title.trim(), start_time, end_time, attendee_ids: attendees.map(a => a.id) }),
          })
        : await fetch('/api/spaces/bookings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              space_id: spaceId,
              title: title.trim(),
              start_time,
              end_time,
              attendee_ids: attendees.map(a => a.id),
            }),
          })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong.')
        return
      }

      onSuccess()
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls = "bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition w-full"
  const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#0a1628] border border-[#1e5080] rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-[#1e5080]">
          <div>
            <h2 className="text-lg font-semibold text-[#f0f6ff]">
              {isEditing ? 'Edit Booking' : `Book ${spaceName}`}
            </h2>
            {isEditing && (
              <p className="text-xs text-[#93b8d8] mt-0.5">{spaceName}</p>
            )}
          </div>
          <button onClick={onClose} className="text-[#93b8d8] hover:text-[#f0f6ff] transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Title */}
          <div>
            <label className={labelCls}>Booking Title <span className="text-[#c8102e]">*</span></label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. SGA Executive Meeting"
              className={inputCls}
              required
            />
          </div>

          {/* Date */}
          <div>
            <label className={labelCls}>Date <span className="text-[#c8102e]">*</span></label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className={inputCls}
              required
            />
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start Time</label>
              <TimePicker value={startTime} onChange={setStartTime} interval={15} />
            </div>
            <div>
              <label className={labelCls}>End Time</label>
              <TimePicker value={endTime} onChange={setEndTime} interval={15} />
            </div>
          </div>

          {/* Attendee search */}
          <div>
            <label className={labelCls}>Add Attendees</label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by name or email..."
                className={inputCls}
                autoComplete="off"
              />
              {(searchResults.length > 0 || searchLoading) && (
                <div className="absolute z-10 mt-1 w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg shadow-xl overflow-hidden">
                  {searchLoading && (
                    <div className="px-3 py-2 text-sm text-[#93b8d8]">Searching…</div>
                  )}
                  {searchResults.map(u => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => addAttendee(u)}
                      className="w-full text-left px-3 py-2 hover:bg-white/10 transition-colors"
                    >
                      <div className="text-sm text-[#f0f6ff] font-medium">{u.full_name}</div>
                      <div className="text-xs text-[#93b8d8]">{u.email}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Attendee chips */}
            {attendees.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {attendees.map(a => (
                  <div
                    key={a.id}
                    className="flex items-center gap-1.5 bg-[#0f2a4a] border border-[#1e5080] rounded-full pl-3 pr-2 py-1"
                  >
                    <span className="text-xs text-[#f0f6ff]">{a.full_name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttendee(a.id)}
                      className="text-[#93b8d8] hover:text-[#c8102e] transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-[#c8102e]/10 border border-[#c8102e]/30 rounded-lg px-3 py-2.5 text-sm text-[#f87171]">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 border border-[#1e5080] text-[#93b8d8] text-sm font-medium rounded-lg hover:text-[#f0f6ff] hover:border-[#93b8d8] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2.5 px-4 bg-[#c8102e] hover:bg-[#a50d26] disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {submitting ? (isEditing ? 'Saving…' : 'Booking…') : (isEditing ? 'Save Changes' : 'Confirm Booking')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
