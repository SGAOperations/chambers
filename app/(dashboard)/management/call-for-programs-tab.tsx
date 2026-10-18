'use client'

import { useEffect, useState } from 'react'
import { Skeleton } from '@/app/_components/skeleton'
import DateField from '@/app/_components/date-field'
import TimePicker from '../bookings/time-picker'
import {
  CHANGE_TYPE_LABELS,
  formatCallTime,
  isCallOpen,
  needsRoom,
  needsTime,
  type ChangeType,
  type PriorWeeklyBooking,
  type ProgramCall,
} from '@/lib/call-for-programs'

interface Submission {
  id: string
  created_at: string
  prior_snapshot: PriorWeeklyBooking | null
  change_type: ChangeType
  requested_room: string | null
  requested_capacity: number | null
  requested_day: string | null
  requested_start_time: string | null
  requested_end_time: string | null
  time_is_range: boolean
  comments: string | null
  bodies: { name: string } | null
  users: { full_name: string } | null
}

interface TabData {
  calls: ProgramCall[]
  open: boolean
  selectedId: string | null
  submissions: Submission[]
  missing: string[]
}

const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"
const buttonCls = "px-5 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"

function formatTime(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

/**
 * The picked date and time are the admin's wall clock with no zone. new Date()
 * reads them in the browser's zone, which for the people on this page is
 * Boston, and the server stores the instant. No date means no automatic close.
 */
function localToIso(date: string, time: string): string | null {
  return date ? new Date(`${date}T${time}`).toISOString() : null
}

function callLabel(c: ProgramCall): string {
  return `Opened ${formatCallTime(c.opened_at)}`
}

/**
 * The call for programs on the Management page: open or close it, set when it
 * closes on its own, and read the answers bodies sent. Read-only list -- the
 * bookings themselves are still made through the usual request flow.
 */
export default function CallForProgramsTab() {
  const [data, setData] = useState<TabData | null>(null)
  const [closeDate, setCloseDate] = useState('')
  const [closeTime, setCloseTime] = useState('17:00')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchData = (callId?: string): Promise<TabData | null> =>
    fetch(`/api/administrator/call-for-programs${callId ? `?call_id=${callId}` : ''}`)
      .then(res => (res.ok ? res.json() : null))

  const load = (callId?: string) => fetchData(callId).then(d => { if (d) setData(d) })

  useEffect(() => {
    fetchData().then(d => { if (d) setData(d) })
  }, [])

  const send = async (method: 'POST' | 'PATCH', payload: Record<string, unknown>, done: string) => {
    setMsg(null)
    setBusy(true)
    const res = await fetch('/api/administrator/call-for-programs', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setMsg({ ok: false, text: body.error || 'Something went wrong.' })
    if (body.slack && !body.slack.ok) {
      setMsg({ ok: false, text: `${done} The Slack message was not sent: ${body.slack.error}` })
    } else {
      setMsg({ ok: true, text: done })
    }
    setCloseDate('')
    load()
  }

  if (!data) {
    return (
      <div className="max-w-md space-y-4">
        <Skeleton className="h-4 w-48 animate-pulse" />
        <Skeleton className="h-24 w-full rounded-xl animate-pulse" />
      </div>
    )
  }

  const current = data.calls[0] ?? null
  const open = isCallOpen(current)
  const selected = data.calls.find(c => c.id === data.selectedId) ?? null

  return (
    <div className="space-y-8">
      <div className="max-w-md">
        <h2 className="text-sm font-semibold text-[#f0f6ff] mb-1">Call for Programs</h2>
        <p className="text-xs text-[#6a96bb] mb-4">
          While the call is open, body leadership can tell Operational Affairs whether to keep their weekly booking
          from last fall or spring, or change its room or time. Opening it posts once to the Slack channel set under
          Other Settings › Weekly Cancellation Reminder.
        </p>

        <div className="border border-[#1e5080] rounded-xl p-4 bg-[#0f2a4a] space-y-3">
          <div className="flex items-center gap-2.5">
            {open ? (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#0f3d20] text-[#4ade80]">Open</span>
            ) : (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#1e3a5f] text-[#6a96bb]">Closed</span>
            )}
            <span className="text-sm text-[#f0f6ff]">
              {open && current
                ? current.closes_at ? `Closes ${formatCallTime(current.closes_at)}` : 'No automatic close'
                : 'Bodies cannot submit'}
            </span>
          </div>

          <div>
            <label className={labelCls}>{open ? 'Change the automatic close' : 'Close automatically at (optional)'}</label>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 min-w-0">
                <DateField value={closeDate} onChange={v => { setMsg(null); setCloseDate(v) }} />
              </div>
              <div className="flex-1 min-w-0">
                <TimePicker interval={15} value={closeTime} onChange={v => { setMsg(null); setCloseTime(v) }} />
              </div>
            </div>
            {closeDate && (
              <button onClick={() => setCloseDate('')} className="mt-1 text-xs text-[#6a96bb] hover:text-[#f0f6ff] transition-colors">
                Clear
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {open ? (
              <>
                <button
                  disabled={busy}
                  onClick={() => send('PATCH', { closes_at: localToIso(closeDate, closeTime) }, closeDate ? 'Close time saved.' : 'Automatic close removed.')}
                  className={buttonCls}
                >
                  {closeDate ? 'Save close time' : 'Remove automatic close'}
                </button>
                <button
                  disabled={busy}
                  onClick={() => send('PATCH', { action: 'close' }, 'Call closed.')}
                  className="px-5 py-2 border border-[#1e5080] text-[#93b8d8] hover:text-[#f0f6ff] text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  Close now
                </button>
              </>
            ) : (
              <button
                disabled={busy}
                onClick={() => send('POST', { closes_at: localToIso(closeDate, closeTime) }, 'Call opened.')}
                className={buttonCls}
              >
                {busy ? 'Opening...' : 'Open call'}
              </button>
            )}
          </div>

          {msg && <p className={`text-sm ${msg.ok ? 'text-green-400' : 'text-[#c8102e]'}`}>{msg.text}</p>}
        </div>
      </div>

      {data.calls.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-[#f0f6ff]">Submissions</h2>
            {data.calls.length > 1 && (
              <select
                value={data.selectedId ?? ''}
                onChange={e => load(e.target.value)}
                className="bg-[#0f2a4a] border border-[#1e5080] rounded-md px-2 py-1 text-xs text-[#f0f6ff]"
              >
                {data.calls.map(c => <option key={c.id} value={c.id}>{callLabel(c)}</option>)}
              </select>
            )}
            <span className="text-xs text-[#6a96bb]">
              {data.submissions.length} submitted · {data.missing.length} active bodies have not
            </span>
          </div>
          {selected && data.calls.length === 1 && (
            <p className="text-xs text-[#6a96bb]">{callLabel(selected)}</p>
          )}

          {data.submissions.length === 0 ? (
            <p className="text-[#6a96bb] text-sm">No submissions yet.</p>
          ) : (
            <div className="divide-y divide-[#1e5080] border border-[#1e5080] rounded-xl overflow-hidden bg-[#184073]">
              {data.submissions.map(s => {
                const isOpen = expanded === s.id
                const p = s.prior_snapshot
                return (
                  <div key={s.id}>
                    <div
                      onClick={() => setExpanded(isOpen ? null : s.id)}
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#1a4d8a] transition-colors cursor-pointer"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[#f0f6ff] truncate">{s.bodies?.name ?? 'Unknown body'}</p>
                        <p className="text-sm text-[#6a96bb] truncate">
                          {p ? `${p.room_name} · ${p.day}s ${formatTime(p.start_time)}` : 'No prior weekly booking'}
                        </p>
                      </div>
                      <span className={`text-xs font-semibold flex-shrink-0 ${s.change_type === 'keep' ? 'text-[#4ade80]' : 'text-[#fbbf24]'}`}>
                        {CHANGE_TYPE_LABELS[s.change_type]}
                      </span>
                    </div>
                    {isOpen && (
                      <div className="bg-[#0f2a4a] px-5 py-4 space-y-2 border-t border-[#1e5080] text-sm text-[#f0f6ff]">
                        {p && (
                          <div>
                            <span className="text-xs font-medium text-[#93b8d8]">Booking in {p.semester_name}</span>
                            <p>{p.purpose} · {p.room_name} · {p.day}s {formatTime(p.start_time)} – {formatTime(p.end_time)}</p>
                          </div>
                        )}
                        {needsRoom(s.change_type) && (
                          <div>
                            <span className="text-xs font-medium text-[#93b8d8]">Room wanted</span>
                            <p>{s.requested_room} · capacity {s.requested_capacity}</p>
                          </div>
                        )}
                        {needsTime(s.change_type) && s.requested_start_time && s.requested_end_time && (
                          <div>
                            <span className="text-xs font-medium text-[#93b8d8]">Time wanted</span>
                            <p>
                              {s.requested_day}s · {s.time_is_range ? 'any time between ' : ''}
                              {formatTime(s.requested_start_time)} – {formatTime(s.requested_end_time)}
                            </p>
                          </div>
                        )}
                        {s.comments && (
                          <div>
                            <span className="text-xs font-medium text-[#93b8d8]">Comments</span>
                            <p className="whitespace-pre-wrap">{s.comments}</p>
                          </div>
                        )}
                        <p className="text-xs text-[#6a96bb]">
                          Submitted by {s.users?.full_name ?? 'unknown'} · {formatCallTime(s.created_at)}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {data.missing.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-[#93b8d8]">Active bodies that have not submitted ({data.missing.length})</summary>
              <p className="mt-2 text-xs text-[#6a96bb] leading-relaxed">{data.missing.join(', ')}</p>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
