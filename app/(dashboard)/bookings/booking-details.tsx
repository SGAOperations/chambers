'use client'

import { useEffect, useRef } from 'react'
import ScopeLabel from '@/app/_components/scope-label'
import { resolveMeetingTime } from '@/lib/meeting-time'
import type { BookingScope, Division } from '@/lib/booking-scope'

/**
 * A booking, read only, for an admin who may look and not touch (issue #225).
 *
 * The view-only tier from #217 took the edit and cancel controls off the
 * Bookings tab, and with them the only way into a booking: every click there
 * opened an editor. The list cards say enough to find a booking but not enough
 * to answer a question about one -- which week of a series moved rooms, when a
 * session actually starts, which week is the Full Body -- so the Student Body
 * President could see that a booking existed and nothing about it.
 *
 * This is not the editors with their inputs disabled. A disabled form still
 * reads as a form, with a Save button that does nothing and per-week overrides
 * hidden behind "Default: ..." placeholders, which is how an editor needs to
 * see them and not how a reader does. Here every value is shown as what it
 * resolves to, and a week that departs from its series says so.
 *
 * Everything shown comes from the rows the Bookings tab already holds, fetched
 * from GET /api/administrator/bookings, which every admin may read. There is
 * nothing here that writes, so there is nothing for the endpoints to refuse.
 */

/** The columns every booking row carries, regardless of type. Mirrors bookings-tab.tsx. */
interface BookingBase {
  id: string
  body_id: string
  purpose: string
  is_event: boolean
  hidden: boolean
  bodies: { name: string } | null
  creator_role: string | null
  scope: BookingScope
  division: Division | null
  booking_bodies: { body_id: string; bodies: { name: string } | null }[] | null
  booked_via_nusso?: boolean
}

export type BookingDetailsTarget =
  | {
      type: 'One-Time Room'
      booking: BookingBase & {
        one_time_room_bookings: {
          id: string
          room_name: string
          booking_date: string
          start_time: string
          end_time: string
          meeting_time: string | null
          status: string
          reservation_code: string | null
        }[] | null
      }
    }
  | {
      type: 'Weekly Room'
      booking: BookingBase & {
        weekly_room_bookings: {
          id: string
          room_name: string
          start_date: string
          end_date: string
          start_time: string
          end_time: string
          meeting_time: string | null
          status: string
          reservation_code: string | null
          weekly_room_occurrences: {
            id: string
            occurrence_date: string
            room_name: string | null
            start_time: string | null
            end_time: string | null
            meeting_time: string | null
            status: string | null
            reservation_code: string | null
            senate_type: string | null
            purpose: string | null
            hidden: boolean | null
            is_event: boolean
          }[]
        }[] | null
      }
      /** The week a grid cell was clicked for, to scroll to and pick out. */
      occurrenceDate?: string | null
    }
  | {
      type: 'Tabling'
      booking: BookingBase & {
        tabling_bookings: {
          id: string
          reservation_code: string | null
          tabling_sessions: {
            id: string
            location: string
            session_date: string
            start_time: string
            end_time: string
            meeting_time: string | null
            status: string
            reservation_code: string | null
          }[]
        }[] | null
      }
    }

export const statusColors: Record<string, string> = {
  'Reserved': 'bg-[#0f3d20] text-[#4ade80]',
  'Alternate Room': 'bg-[#0e2f4f] text-[#4285f4]',
  'Alternate Time': 'bg-[#0e2f4f] text-[#4285f4]',
  'Alternate Room and Time': 'bg-[#0e2f4f] text-[#4285f4]',
  'Waitlisted': 'bg-[#3d0f0f] text-[#f87171]',
  'Unavailable': 'bg-[#3d0f0f] text-[#f87171]',
  'Pending Cancellation': 'bg-[#3d2200] text-[#fb923c]',
  'Cancelled': 'bg-[#2a1042] text-[#c084fc]',
  'Virtual': 'bg-[#062f3b] text-[#22d3ee]',
  'Missed': 'bg-[#1a1a2e] text-[#a78bfa]',
  'Repurposed': 'bg-[#1a1a1a] text-white',
  'Tentative': 'bg-[#2d2800] text-[#fef08a]',
}

function formatTime(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${m} ${ampm}`
}

function formatDate(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  })
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColors[status] || 'bg-[#184073] text-[#93b8d8]'}`}>
      {status}
    </span>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-[#6a96bb] w-28 flex-shrink-0">{label}</span>
      <span className="text-[#f0f6ff] min-w-0 break-words">{children}</span>
    </div>
  )
}

/**
 * Both times, always, as the My Rooms details do: this is the one place
 * someone comes to find out exactly what was booked, so the meeting start and
 * the reserved window each get a line even when they agree (issue #126).
 */
function TimeRows({ meetingTime, startTime, endTime }: { meetingTime: string; startTime: string; endTime: string }) {
  return (
    <>
      <Row label="Start Time">{formatTime(meetingTime)}</Row>
      <Row label="Reserved">{formatTime(startTime)} – {formatTime(endTime)}</Row>
    </>
  )
}

export default function BookingDetails({ target }: { target: BookingDetailsTarget }) {
  const b = target.booking
  const linkedBodies = (b.booking_bodies ?? []).map(x => ({ id: x.body_id, name: x.bodies?.name ?? '' }))

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <ScopeLabel row={b} linkedBodies={linkedBodies} className="text-lg font-bold text-[#f0f6ff]" />
          {b.is_event && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#062f3b] text-[#22d3ee]">Event</span>
          )}
          {b.hidden && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#2a1a00] text-[#f59e0b]">Hidden</span>
          )}
        </div>
        <Row label="Purpose">{b.purpose}</Row>
        {b.creator_role && <Row label="Booked by">{b.creator_role}</Row>}
      </div>

      {target.type === 'One-Time Room' && <OneTimeDetails booking={target.booking} />}
      {target.type === 'Weekly Room' && <WeeklyDetails booking={target.booking} occurrenceDate={target.occurrenceDate ?? null} />}
      {target.type === 'Tabling' && <TablingDetails booking={target.booking} />}
    </div>
  )
}

const sessionCls = 'border border-[#1e5080] rounded-xl px-4 py-3 space-y-1.5 bg-[#0f2a4a]'

function OneTimeDetails({ booking }: { booking: Extract<BookingDetailsTarget, { type: 'One-Time Room' }>['booking'] }) {
  const sessions = booking.one_time_room_bookings ?? []
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-[#f0f6ff]">{sessions.length === 1 ? 'Session' : 'Sessions'}</p>
      {sessions.map(s => (
        <div key={s.id} className={sessionCls}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-[#f0f6ff]">{formatDate(s.booking_date)}</span>
            <StatusPill status={s.status} />
          </div>
          {s.room_name && <Row label="Room">{s.room_name}</Row>}
          <TimeRows
            meetingTime={resolveMeetingTime(s.meeting_time, s.start_time)}
            startTime={s.start_time}
            endTime={s.end_time}
          />
          {s.reservation_code && <Row label="Res. Code"><span className="font-mono">{s.reservation_code}</span></Row>}
        </div>
      ))}
    </div>
  )
}

function TablingDetails({ booking }: { booking: Extract<BookingDetailsTarget, { type: 'Tabling' }>['booking'] }) {
  const t = booking.tabling_bookings?.[0]
  if (!t) return null
  return (
    <div className="space-y-2">
      {t.reservation_code && <Row label="Res. Code"><span className="font-mono">{t.reservation_code}</span></Row>}
      <p className="text-sm font-semibold text-[#f0f6ff]">{t.tabling_sessions.length === 1 ? 'Session' : 'Sessions'}</p>
      {t.tabling_sessions.map(s => (
        <div key={s.id} className={sessionCls}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-[#f0f6ff]">{formatDate(s.session_date)}</span>
            <StatusPill status={s.status} />
          </div>
          <Row label="Location">{s.location}</Row>
          <TimeRows
            meetingTime={resolveMeetingTime(s.meeting_time, s.start_time)}
            startTime={s.start_time}
            endTime={s.end_time}
          />
          {/* A session's own code, where it differs from the booking's. */}
          {s.reservation_code && s.reservation_code !== t.reservation_code && (
            <Row label="Res. Code"><span className="font-mono">{s.reservation_code}</span></Row>
          )}
        </div>
      ))}
    </div>
  )
}

function WeeklyDetails({ booking, occurrenceDate }: {
  booking: Extract<BookingDetailsTarget, { type: 'Weekly Room' }>['booking']
  occurrenceDate: string | null
}) {
  const w = booking.weekly_room_bookings?.[0]

  // Arriving from a grid cell means a question about that week, so it is
  // scrolled to rather than left somewhere down a semester-long list.
  const clickedRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!occurrenceDate) return
    const raf = requestAnimationFrame(() => {
      clickedRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
  }, [occurrenceDate])

  if (!w) return null

  const seriesMeeting = resolveMeetingTime(w.meeting_time, w.start_time)
  const occurrences = [...(w.weekly_room_occurrences ?? [])].sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date))
  const isSenate = booking.bodies?.name === 'Senate'

  return (
    <div className="space-y-4">
      <div className={sessionCls}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-[#f0f6ff]">Every week</span>
          <StatusPill status={w.status} />
        </div>
        <Row label="Room">{w.room_name}</Row>
        <Row label="Dates">{formatDate(w.start_date)} – {formatDate(w.end_date)}</Row>
        <TimeRows meetingTime={seriesMeeting} startTime={w.start_time} endTime={w.end_time} />
        {w.reservation_code && <Row label="Res. Code"><span className="font-mono">{w.reservation_code}</span></Row>}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-[#f0f6ff]">Occurrences</p>
        {occurrences.map(o => {
          // Each value as it resolves for this week -- its own override, else
          // the series' -- with the same precedence the editor and My Rooms use.
          const startTime = o.start_time ?? w.start_time
          const endTime = o.end_time ?? w.end_time
          const meetingTime = resolveMeetingTime(o.meeting_time, w.meeting_time, o.start_time, w.start_time)
          const status = o.status ?? w.status
          const room = o.room_name ?? w.room_name
          const code = o.reservation_code ?? w.reservation_code
          const purpose = o.purpose ?? booking.purpose
          const hidden = o.hidden ?? booking.hidden
          // `hidden != null` because false is an override, not an absence.
          const overridden = !!(o.room_name || o.start_time || o.end_time || o.meeting_time || o.status
            || o.reservation_code || o.purpose || o.hidden != null)
          const clicked = o.occurrence_date === occurrenceDate

          return (
            <div
              key={o.id}
              ref={clicked ? clickedRef : undefined}
              className={`${sessionCls} ${clicked ? 'ring-2 ring-[#c8102e]/60' : ''}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-[#f0f6ff]">{formatDate(o.occurrence_date)}</span>
                  {overridden && (
                    <span className="text-xs bg-[#c8102e]/10 text-[#c8102e] px-2 py-0.5 rounded-full font-medium">Differs from series</span>
                  )}
                  {o.is_event && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#062f3b] text-[#22d3ee]">Event</span>
                  )}
                  {hidden && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#2a1a00] text-[#f59e0b]">Hidden</span>
                  )}
                  {isSenate && o.senate_type && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#1a4d8a] text-[#f0f6ff]">{o.senate_type}</span>
                  )}
                </div>
                <StatusPill status={status} />
              </div>
              {/*
                Only what this week changes is spelled out below the date. The
                series block above already says what every other week is, and
                repeating it on all fifteen of them would bury the one that moved.
              */}
              {o.room_name && <Row label="Room">{room}</Row>}
              {(o.start_time || o.end_time || o.meeting_time) && (
                <TimeRows meetingTime={meetingTime} startTime={startTime} endTime={endTime} />
              )}
              {o.reservation_code && <Row label="Res. Code"><span className="font-mono">{code}</span></Row>}
              {o.purpose && <Row label="Purpose">{purpose}</Row>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
