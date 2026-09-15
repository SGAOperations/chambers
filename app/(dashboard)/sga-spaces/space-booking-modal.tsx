'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import TimePicker from '../bookings/time-picker'
import DateField from '@/app/_components/date-field'
import { advanceNoticeError } from '@/lib/spaces-advance-notice'
import { SERIES_CONFLICT_LABELS, addDays, weekdayOf, type SeriesConflict } from '@/lib/space-series'

interface User {
  id: string
  full_name: string
  email: string
}

interface Space {
  id: string
  name: string
  capacity: number
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
  onCancelBooking?: () => Promise<void>
  spaces?: Space[]
  /**
   * Spaces already taken at the time picked, when it was picked in the All
   * spaces view. They are listed after the free ones and marked, not hidden:
   * changing the time in this form can free them, and the server has the final
   * word either way.
   */
  busySpaceIds?: string[]
  /** Hours of notice required before newly claimed time. 0 disables the rule. */
  minHoursAdvance?: number
  /** The series this booking is one week of, when it is (issue #112). */
  seriesId?: string | null
  /** Cancels every upcoming week of seriesId. Offered only alongside onCancelBooking. */
  onCancelSeries?: () => Promise<void>
  /**
   * The active semester's last day: the furthest a weekly booking may run. Null
   * means Management has not set it, and weekly booking is unavailable.
   */
  semesterEndDate?: string | null
}

/** What the series endpoint returns about one series. */
interface SeriesInfo {
  title: string
  attendee_ids: string[]
  start_time: string
  end_time: string
  ends_on: string
  weekday: string
  upcoming_count: number
  next_date: string | null
  semester_end_date: string | null
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

// End time of 00:00 means "end of day" — store as next-day midnight, not same-day midnight
function endTimeToIso(date: string, time: string): string {
  const d = new Date(`${date}T${time}:00Z`)
  if (time === '00:00') d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

function formatShortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
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
  onCancelBooking,
  spaces,
  busySpaceIds,
  minHoursAdvance = 0,
  seriesId = null,
  onCancelSeries,
  semesterEndDate = null,
}: SpaceBookingModalProps) {
  const isEditing = !!editBookingId

  const { date: initDate, time: initStartTime } = isoToDateAndTime(initialStart)
  const { time: initEndTime } = isoToDateAndTime(initialEnd)

  const [selectedSpaceId, setSelectedSpaceId] = useState(spaceId)
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
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Weekly bookings (issue #112).
  //   repeat/until   -- creating one.
  //   scope          -- editing a week of one: this week alone, or the series.
  const [repeat, setRepeat] = useState(false)
  const [until, setUntil] = useState('')
  const [scope, setScope] = useState<'week' | 'series'>('week')
  const [series, setSeries] = useState<SeriesInfo | null>(null)
  const [seriesLoading, setSeriesLoading] = useState(false)

  const editingSeries = isEditing && scope === 'series'

  /**
   * The weeks the server said conflict, tagged with the form values they were
   * computed for. They are shown only while the form still matches -- change a
   * time or the end date and the list no longer describes what would be
   * submitted, so it quietly stops applying rather than needing an effect to
   * clear it.
   */
  const [conflicts, setConflicts] = useState<{ key: string; list: SeriesConflict[]; applicable: number } | null>(null)
  const formKey = JSON.stringify([
    scope, selectedSpaceId, title.trim(), date, startTime, endTime, repeat, until, attendees.map(a => a.id),
  ])
  const activeConflicts = conflicts?.key === formKey ? conflicts : null

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
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

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

  /**
   * Switches between editing this week and editing the series, loading each
   * one's own values into the form. The series' values can differ from this
   * week's -- the week may have been edited on its own -- and the form should
   * show what a save would actually write.
   */
  const switchScope = async (next: 'week' | 'series') => {
    if (next === scope) return
    setError(null)
    setCancelConfirm(false)
    setCancelError(null)

    if (next === 'week') {
      setScope('week')
      setTitle(initialTitle)
      setStartTime(initStartTime)
      setEndTime(initEndTime)
      setAttendees(initialAttendees)
      return
    }

    if (!seriesId) return
    setSeriesLoading(true)
    try {
      const res = await fetch(`/api/spaces/series/${seriesId}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not load this weekly booking.')
        return
      }
      const info: SeriesInfo = {
        ...data.series,
        upcoming_count: data.upcoming_count,
        next_date: data.next_date,
        semester_end_date: data.semester_end_date,
      }

      let seriesAttendees: User[] = []
      if (info.attendee_ids.length > 0) {
        const r = await fetch(`/api/users/by-ids?ids=${info.attendee_ids.join(',')}`)
        if (r.ok) seriesAttendees = await r.json()
      }

      setSeries(info)
      setTitle(info.title)
      setStartTime(info.start_time)
      setEndTime(info.end_time)
      setUntil(info.ends_on)
      setAttendees(seriesAttendees)
      setScope('series')
    } finally {
      setSeriesLoading(false)
    }
  }

  const handleCancel = async () => {
    const cancel = editingSeries ? onCancelSeries : onCancelBooking
    if (!cancel) return
    setCancelling(true)
    setCancelError(null)
    try {
      await cancel()
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'Failed to cancel booking.')
      setCancelling(false)
      setCancelConfirm(false)
    }
  }

  // The same rule the server applies, run as the form changes so an edit that
  // would be refused says so before it is submitted (issue #94). Only for edits:
  // a new booking cannot be drawn inside the notice window in the first place,
  // and warning about the slot you have not finished picking would be noise.
  // A series edit is checked week by week on the server instead, where a week
  // that cannot take the change is reported rather than refusing the rest.
  const noticeWarning = isEditing && !editingSeries && date
    ? advanceNoticeError(
        { start: dateAndTimeToIso(date, startTime), end: endTimeToIso(date, endTime) },
        { start: initialStart, end: initialEnd },
        minHoursAdvance
      )
    : null

  const creatingSeries = !isEditing && repeat
  const repeatAvailable = !!semesterEndDate

  const submit = async (skipConflicts: boolean) => {
    setError(null)

    if (!title.trim()) { setError('Title is required.'); return }
    if (!date) { setError('Date is required.'); return }
    if ((creatingSeries || editingSeries) && !until) { setError('Choose the date the weekly booking ends.'); return }

    setSubmitting(true)
    try {
      const attendee_ids = attendees.map(a => a.id)
      let res: Response

      if (editingSeries && seriesId) {
        res = await fetch(`/api/spaces/series/${seriesId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(), start_time: startTime, end_time: endTime, until, attendee_ids,
            skip_conflicts: skipConflicts,
          }),
        })
      } else if (creatingSeries) {
        res = await fetch('/api/spaces/series', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            space_id: selectedSpaceId, title: title.trim(), date, start_time: startTime, end_time: endTime, until,
            attendee_ids, skip_conflicts: skipConflicts,
          }),
        })
      } else {
        const start_time = dateAndTimeToIso(date, startTime)
        const end_time = endTimeToIso(date, endTime)
        res = isEditing
          ? await fetch(`/api/spaces/bookings/${editBookingId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: title.trim(), start_time, end_time, attendee_ids }),
            })
          : await fetch('/api/spaces/bookings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ space_id: selectedSpaceId, title: title.trim(), start_time, end_time, attendee_ids }),
            })
      }

      const data = await res.json()
      if (!res.ok) {
        if (Array.isArray(data.conflicts)) {
          setConflicts({ key: formKey, list: data.conflicts, applicable: data.bookable ?? data.applicable ?? 0 })
        }
        // A 409 is a question, not a failure: the conflict panel asks it.
        if (res.status !== 409) setError(data.error ?? 'Something went wrong.')
        return
      }

      onSuccess()
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    submit(false)
  }

  const inputCls = "bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition w-full"
  const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"

  const seriesMaxDate = editingSeries ? series?.semester_end_date ?? undefined : semesterEndDate ?? undefined
  const cancelLabel = editingSeries ? 'Cancel all upcoming weeks' : seriesId ? 'Cancel this week' : 'Cancel this booking'
  const canCancel = editingSeries ? !!onCancelSeries : !!onCancelBooking

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#0a1628] border border-[#1e5080] rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-[#1e5080]">
          <div>
            <h2 className="text-lg font-semibold text-[#f0f6ff]">
              {isEditing
                ? (editingSeries ? 'Edit Weekly Booking' : 'Edit Booking')
                : `Book ${spaces?.find(s => s.id === selectedSpaceId)?.name ?? spaceName}`}
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
          {/* This week or the whole series (issue #112) */}
          {isEditing && seriesId && (
            <div className="grid grid-cols-2 gap-1 p-1 bg-[#0f2a4a] border border-[#1e5080] rounded-lg" role="tablist">
              {(['week', 'series'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={scope === s}
                  onClick={() => switchScope(s)}
                  disabled={seriesLoading}
                  className={`py-1.5 text-sm font-medium rounded-md transition-colors disabled:opacity-60 ${
                    scope === s ? 'bg-[#c8102e] text-white' : 'text-[#93b8d8] hover:text-[#f0f6ff]'
                  }`}
                >
                  {s === 'week' ? 'This week' : seriesLoading ? 'Loading…' : 'Whole series'}
                </button>
              ))}
            </div>
          )}

          {/* Location selector (creation mode only) */}
          {!isEditing && spaces && spaces.length > 1 && (
            <div>
              <label className={labelCls}>Location</label>
              <select
                value={selectedSpaceId}
                onChange={e => setSelectedSpaceId(e.target.value)}
                className={inputCls}
              >
                {[...spaces]
                  .sort((a, b) => Number(!!busySpaceIds?.includes(a.id)) - Number(!!busySpaceIds?.includes(b.id)))
                  .map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} (cap. {s.capacity}){busySpaceIds?.includes(s.id) ? ' — booked at the time you picked' : ''}
                    </option>
                  ))}
              </select>
            </div>
          )}

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

          {/* Date -- or, for a series, the weekday it repeats on */}
          {editingSeries && series ? (
            <div className="text-sm text-[#93b8d8] bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5">
              Every <span className="text-[#f0f6ff] font-medium">{series.weekday}</span>
              {' · '}{series.upcoming_count} upcoming week{series.upcoming_count === 1 ? '' : 's'}
            </div>
          ) : (
            <div>
              <label className={labelCls}>{creatingSeries ? 'First Date' : 'Date'} <span className="text-[#c8102e]">*</span></label>
              <DateField value={date} onChange={setDate} required />
            </div>
          )}

          {/* Times */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start Time</label>
              <TimePicker value={startTime} onChange={setStartTime} interval={15} />
            </div>
            <div>
              <label className={labelCls}>End Time</label>
              <TimePicker value={endTime} onChange={setEndTime} interval={15} />
            </div>
          </div>

          {/* Repeat weekly (creation) */}
          {!isEditing && (
            <div className="space-y-2">
              <label className={`flex items-center gap-2 ${repeatAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                <input
                  type="checkbox"
                  checked={repeat}
                  disabled={!repeatAvailable}
                  onChange={e => {
                    setRepeat(e.target.checked)
                    if (e.target.checked && !until && date) {
                      const suggested = addDays(date, 7 * 3)
                      setUntil(semesterEndDate && suggested > semesterEndDate ? semesterEndDate : suggested)
                    }
                  }}
                  className="accent-[#c8102e]"
                />
                <span className="text-sm text-[#f0f6ff]">
                  Repeat weekly{date ? ` on ${weekdayOf(date)}s` : ''}
                </span>
              </label>
              {!repeatAvailable && (
                <p className="text-xs text-[#6a96bb]">
                  Weekly bookings are unavailable until an administrator sets the end date of the current semester.
                </p>
              )}
            </div>
          )}

          {/* Repeat until (creating or editing a series) */}
          {(creatingSeries || editingSeries) && (
            <div>
              <label className={labelCls}>Repeat Until <span className="text-[#c8102e]">*</span></label>
              <DateField
                value={until}
                onChange={setUntil}
                min={editingSeries ? series?.next_date ?? undefined : date ? addDays(date, 7) : undefined}
                max={seriesMaxDate}
                required
              />
              {seriesMaxDate && (
                <p className="text-xs text-[#6a96bb] mt-1">Up to the end of the semester, {formatShortDate(seriesMaxDate)}.</p>
              )}
              {editingSeries && (
                <p className="text-xs text-[#6a96bb] mt-1">
                  Changes apply to every upcoming week, including weeks edited on their own. Past weeks are left as they were.
                </p>
              )}
            </div>
          )}

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

          {/* Advance notice — a warning, not an error: the booking as it stands is
              fine, it is the pending change that would be refused. */}
          {noticeWarning && !error && (
            <div className="bg-[#f97316]/10 border border-[#f97316]/30 rounded-lg px-3 py-2.5 text-sm text-[#fdba74]">
              {noticeWarning}
            </div>
          )}

          {/* Weeks that conflict (issue #112). Shown as a choice, not an error:
              one clash should not cost someone the rest of their semester. */}
          {activeConflicts && activeConflicts.list.length > 0 && (
            <div className="bg-[#f97316]/10 border border-[#f97316]/30 rounded-lg px-3 py-2.5 space-y-2">
              <p className="text-sm text-[#fdba74] font-medium">
                {editingSeries
                  ? `${activeConflicts.list.length} week${activeConflicts.list.length === 1 ? '' : 's'} can't take this change:`
                  : `${activeConflicts.list.length} week${activeConflicts.list.length === 1 ? '' : 's'} can't be booked:`}
              </p>
              <ul className="text-xs text-[#fdba74] space-y-0.5">
                {activeConflicts.list.map(c => (
                  <li key={c.date}>{formatShortDate(c.date)} — {SERIES_CONFLICT_LABELS[c.reason]}</li>
                ))}
              </ul>
              {editingSeries && (
                <p className="text-xs text-[#fdba74]/80">
                  Upcoming weeks that can&apos;t move keep their current time. New weeks that can&apos;t be added are skipped.
                </p>
              )}
              {activeConflicts.applicable > 0 && (
                <button
                  type="button"
                  onClick={() => submit(true)}
                  disabled={submitting}
                  className="w-full py-2 px-3 bg-[#f97316] hover:bg-[#ea580c] disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {editingSeries
                    ? 'Save the rest'
                    : `Book the other ${activeConflicts.applicable} week${activeConflicts.applicable === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
          )}

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
              Close
            </button>
            <button
              type="submit"
              disabled={submitting || seriesLoading || !!noticeWarning || !!activeConflicts}
              className="flex-1 py-2.5 px-4 bg-[#c8102e] hover:bg-[#a50d26] disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {submitting ? (isEditing ? 'Saving…' : 'Booking…') : (isEditing ? 'Save Changes' : 'Confirm Booking')}
            </button>
          </div>

          {/* Cancel booking (edit mode, own bookings only) */}
          {isEditing && canCancel && (
            <div className="pt-3 border-t border-[#1e5080]">
              {!cancelConfirm ? (
                <button
                  type="button"
                  onClick={() => setCancelConfirm(true)}
                  className="text-sm text-[#6a96bb] hover:text-[#f87171] transition-colors"
                >
                  {cancelLabel}
                </button>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-[#93b8d8]">
                    {editingSeries
                      ? (series ? `Cancel all ${series.upcoming_count} upcoming weeks?` : 'Cancel all upcoming weeks?')
                      : seriesId ? 'Cancel just this week?' : 'Cancel this booking?'}
                  </span>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="text-sm font-medium text-[#f87171] hover:text-red-400 disabled:opacity-60 transition-colors"
                  >
                    {cancelling ? 'Cancelling…' : 'Yes, cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCancelConfirm(false)}
                    disabled={cancelling}
                    className="text-sm text-[#6a96bb] hover:text-[#f0f6ff] transition-colors"
                  >
                    No, keep it
                  </button>
                </div>
              )}
              {cancelError && (
                <p className="text-xs text-[#f87171] mt-1">{cancelError}</p>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
