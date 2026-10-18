'use client'

import { useState } from 'react'
import TimePicker from '../bookings/time-picker'
import {
  CHANGE_TYPE_LABELS,
  DAYS,
  MAX_COMMENTS,
  MAX_ROOM,
  formatCallTime,
  needsRoom,
  needsTime,
  validateSubmission,
  type ChangeType,
  type PriorWeeklyBooking,
  type ProgramCall,
} from '@/lib/call-for-programs'

export interface CallBody {
  id: string
  name: string
  submitted: boolean
  prior: PriorWeeklyBooking[]
}

export interface CallState {
  call: ProgramCall | null
  bodies: CallBody[]
}

const inputCls = "w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"

function formatTime(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

function formatDate(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const CHANGE_OPTIONS: ChangeType[] = ['keep', 'room', 'time', 'both']

/**
 * The call for programs, as a body lead answers it: pick the body, see its
 * weekly booking from the last fall or spring, and say whether to keep it or
 * move its room, its time, or both. One answer per body, final once sent.
 */
export default function CallForProgramsForm({
  state,
  onSubmitted,
}: {
  state: CallState
  onSubmitted: () => void
}) {
  const [bodyId, setBodyId] = useState('')
  const [priorId, setPriorId] = useState('')
  const [change, setChange] = useState<ChangeType | ''>('')
  const [room, setRoom] = useState('')
  const [capacity, setCapacity] = useState('')
  const [day, setDay] = useState('')
  const [startTime, setStartTime] = useState('17:00')
  const [endTime, setEndTime] = useState('18:00')
  const [isRange, setIsRange] = useState(false)
  const [comments, setComments] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sentFor, setSentFor] = useState<string | null>(null)

  const body = state.bodies.find(b => b.id === bodyId) ?? null
  const prior = body?.prior.find(p => p.weekly_booking_id === priorId) ?? null
  const hasPrior = (body?.prior.length ?? 0) > 0

  // A new body resets the answer: a booking chosen for one body is not the
  // other's, and nor is "keep it".
  const selectBody = (id: string) => {
    const next = state.bodies.find(b => b.id === id) ?? null
    setBodyId(id)
    setPriorId(next?.prior[0]?.weekly_booking_id ?? '')
    setChange(next && next.prior.length === 0 ? 'new' : '')
    setError('')
  }

  const handleSubmit = async () => {
    setError('')
    if (!body) return setError('Choose the body you are submitting for.')
    if (!change) return setError('Choose whether to keep the booking or change it.')

    const payload = {
      body_id: body.id,
      prior_weekly_booking_id: prior?.weekly_booking_id ?? null,
      change_type: change,
      requested_room: room,
      requested_capacity: capacity === '' ? null : Number(capacity),
      requested_day: day || null,
      requested_start_time: startTime,
      requested_end_time: endTime,
      time_is_range: isRange,
      comments,
    }
    const checked = validateSubmission(payload)
    if (!checked.ok) return setError(checked.error)

    setSubmitting(true)
    const res = await fetch('/api/call-for-programs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSubmitting(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return setError(data.error || 'Something went wrong.')
    }
    setSentFor(body.name)
    selectBody('')
    setRoom(''); setCapacity(''); setDay(''); setComments(''); setIsRange(false)
    onSubmitted()
  }

  if (!state.call) return null

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#93b8d8]">
        Tell Operational Affairs whether to keep your body&apos;s weekly booking for next semester or change it.
        {state.call.closes_at && <> Submissions close <span className="text-[#f0f6ff]">{formatCallTime(state.call.closes_at)}</span>.</>}
        {' '}Each body submits once, and a submission can&apos;t be edited afterwards.
      </p>

      {sentFor && (
        <p className="text-sm text-green-400">Submitted for {sentFor}.</p>
      )}

      <div>
        <label className={labelCls}>Body *</label>
        <select value={bodyId} onChange={e => { setSentFor(null); selectBody(e.target.value) }} className={inputCls}>
          <option value="">Select a body</option>
          {state.bodies.map(b => (
            <option key={b.id} value={b.id} disabled={b.submitted}>
              {b.name}{b.submitted ? ' (submitted)' : ''}
            </option>
          ))}
        </select>
      </div>

      {body && (
        <>
          {hasPrior ? (
            <>
              {body.prior.length > 1 && (
                <div>
                  <label className={labelCls}>Which weekly booking is this about? *</label>
                  <select value={priorId} onChange={e => setPriorId(e.target.value)} className={inputCls}>
                    {body.prior.map(p => (
                      <option key={p.weekly_booking_id} value={p.weekly_booking_id}>
                        {p.purpose} · {p.day}s {formatTime(p.start_time)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {prior && (
                <div className="border border-[#1e5080] rounded-xl p-4 bg-[#0f2a4a] space-y-1">
                  <p className="text-xs font-semibold text-[#6a96bb] uppercase tracking-wide">
                    Your weekly booking in {prior.semester_name}
                  </p>
                  <p className="text-sm font-semibold text-[#f0f6ff]">{prior.purpose}</p>
                  <p className="text-sm text-[#f0f6ff]">{prior.room_name}</p>
                  <p className="text-sm text-[#f0f6ff]">
                    {prior.day}s · {formatTime(prior.start_time)} – {formatTime(prior.end_time)}
                  </p>
                  <p className="text-xs text-[#6a96bb]">{formatDate(prior.start_date)} – {formatDate(prior.end_date)}</p>
                </div>
              )}
              <div>
                <span className={labelCls}>Do you want to keep this booking the same? *</span>
                <div className="space-y-2 mt-1">
                  {CHANGE_OPTIONS.map(c => (
                    <label key={c} className="flex items-center gap-2.5 cursor-pointer text-sm text-[#f0f6ff]">
                      <input
                        type="radio"
                        name="change"
                        checked={change === c}
                        onChange={() => setChange(c)}
                        className="accent-[#c8102e]"
                      />
                      {CHANGE_TYPE_LABELS[c]}
                    </label>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="border border-[#1e5080] rounded-xl p-4 bg-[#0f2a4a]">
              <p className="text-sm text-[#93b8d8]">
                {body.name} had no weekly booking last fall or spring. Tell us the room and time you&apos;d like.
              </p>
            </div>
          )}

          {change && needsRoom(change) && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className={labelCls}>Room or room type *</label>
                <input
                  type="text"
                  placeholder="e.g. Curry 344, or a classroom with a projector"
                  maxLength={MAX_ROOM}
                  value={room}
                  onChange={e => setRoom(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Capacity *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 25"
                  value={capacity}
                  onChange={e => setCapacity(e.target.value.replace(/[^0-9]/g, ''))}
                  className={inputCls}
                />
              </div>
            </div>
          )}

          {change && needsTime(change) && (
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Day of the week *</label>
                <select value={day} onChange={e => setDay(e.target.value)} className={inputCls}>
                  <option value="">Select a day</option>
                  {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 min-w-0">
                  <label className={labelCls}>{isRange ? 'Earliest start *' : 'Start Time *'}</label>
                  {/* Weekly slots start on the hour or the half hour (issue #163). */}
                  <TimePicker interval={30} value={startTime} onChange={setStartTime} />
                </div>
                <div className="flex-1 min-w-0">
                  <label className={labelCls}>{isRange ? 'Latest end *' : 'End Time *'}</label>
                  <TimePicker interval={15} value={endTime} onChange={setEndTime} />
                </div>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer text-sm text-[#93b8d8]">
                <input type="checkbox" checked={isRange} onChange={e => setIsRange(e.target.checked)} className="accent-[#c8102e]" />
                This is a time range we could meet within, not an exact time
              </label>
            </div>
          )}

          <div>
            <label className={labelCls}>Additional Comments</label>
            <textarea
              placeholder="Optional"
              maxLength={MAX_COMMENTS}
              value={comments}
              onChange={e => setComments(e.target.value)}
              rows={3}
              className={inputCls}
            />
          </div>

          {error && <p className="text-[#c8102e] text-sm">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2.5 bg-[#c8102e] hover:bg-[#a00d24] hover:scale-105 text-white text-sm rounded-lg font-medium transition-all disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </>
      )}
    </div>
  )
}
