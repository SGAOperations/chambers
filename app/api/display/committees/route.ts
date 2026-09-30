import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
// todayInAppZone is imported from My Rooms' shared module rather than
// @/lib/app-zone because that is the one path that resolves both before and
// after PR #189, which moves the function to lib/ but keeps a re-export here.
import { todayInAppZone } from '@/app/(dashboard)/my-rooms/shared'
import {
  resolveOneTime,
  resolveWeekly,
  type CommitteeMeeting,
  type OneTimeCandidate,
  type WeeklyCandidate,
} from '@/lib/committee-display'

const adminSupabase = db

/**
 * The day's committee meetings, for the corridor display (issue #187).
 *
 * Gated on DISPLAY_KEY like the SGA Spaces kiosk, since this is served to a
 * screen with no session behind it.
 *
 * Committee meetings are room bookings, not SGA Space bookings, and they live in
 * two places: a weekly series' occurrence for the usual standing meeting, and a
 * one-time booking for anything called specially. Both are fetched -- the Slack
 * reminder job only reads the weekly side, which is why it cannot be reused
 * wholesale here.
 */

/**
 * How many days past today the lookahead reaches.
 *
 * Long enough to carry the screen over a holiday or the gap between terms;
 * short enough that a quiet fortnight does not mean shipping a term of rows to
 * a display that draws one at a time. Past this the board admits it has nothing.
 */
const LOOKAHEAD_DAYS = 14

/** 'YYYY-MM-DD' plus n days, as a date rather than an instant. */
function addDays(date: string, n: number): string {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)))
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** PostgREST types an embedded to-one relation as a possible array. */
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v
}

interface BodyRow {
  name: string
}

interface BookingRow {
  hidden: boolean | null
  purpose: string | null
  is_event: boolean | null
  bodies: BodyRow | BodyRow[] | null
}

interface WeeklyRow {
  id: string
  occurrence_date: string
  room_name: string | null
  start_time: string | null
  end_time: string | null
  meeting_time: string | null
  status: string | null
  hidden: boolean | null
  purpose: string | null
  is_event: boolean | null
  weekly_room_bookings: {
    room_name: string | null
    start_time: string
    end_time: string
    meeting_time: string | null
    status: string | null
    bookings: BookingRow | BookingRow[] | null
  } | {
    room_name: string | null
    start_time: string
    end_time: string
    meeting_time: string | null
    status: string | null
    bookings: BookingRow | BookingRow[] | null
  }[] | null
}

interface OneTimeRow {
  id: string
  booking_date: string
  room_name: string | null
  start_time: string
  end_time: string
  meeting_time: string | null
  status: string | null
  bookings: BookingRow | BookingRow[] | null
}

// !inner throughout, so a filter on an embedded column narrows the occurrence
// rows rather than just nulling out the embed.
const WEEKLY_SELECT = `
  id, occurrence_date, room_name, start_time, end_time, meeting_time, status, hidden, purpose, is_event,
  weekly_room_bookings!inner(
    room_name, start_time, end_time, meeting_time, status,
    bookings!inner(hidden, purpose, is_event, bodies!inner(name, body_type))
  )
`

const ONE_TIME_SELECT = `
  id, booking_date, room_name, start_time, end_time, meeting_time, status,
  bookings!inner(hidden, purpose, is_event, bodies!inner(name, body_type))
`

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')

  if (!key || key !== process.env.DISPLAY_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The display sends its own date so "today" matches the clock on the screen.
  // The fallback is Boston's date, not the server's: this runs in UTC on Vercel,
  // where today is already tomorrow after 8 PM Eastern (issues #87, #177).
  const date = searchParams.get('date') || todayInAppZone()

  // Not just today. Once today is spent the screen rolls forward to the next day
  // that has anything, so the window has to be wide enough to carry it across a
  // quiet stretch -- a reading week, the end of a term -- without going blank.
  // Bounded because a term's worth of rows is not worth shipping to a screen
  // that will draw one of them.
  const through = addDays(date, LOOKAHEAD_DAYS)

  // Four queries, not two. The screen draws committee meetings *and* IEMS
  // events, and those are different predicates on the same tables: a body's
  // type, versus an is_event flag. PostgREST's `or=` cannot span an embedded
  // column, so they cannot be one request each.
  //
  // is_event lives in a different place for each kind. A one-off carries it on
  // the booking; a weekly series carries it per occurrence, where it is
  // authoritative and inherits nothing -- so a series' own booking flag would be
  // the wrong thing to filter on.
  const [weeklyResult, weeklyEventResult, oneTimeResult, oneTimeEventResult] = await Promise.all([
    adminSupabase
      .from('weekly_room_occurrences')
      .select(WEEKLY_SELECT)
      .gte('occurrence_date', date)
      .lte('occurrence_date', through)
      .eq('weekly_room_bookings.bookings.bodies.body_type', 'Committee'),
    adminSupabase
      .from('weekly_room_occurrences')
      .select(WEEKLY_SELECT)
      .gte('occurrence_date', date)
      .lte('occurrence_date', through)
      .eq('is_event', true),
    adminSupabase
      .from('one_time_room_bookings')
      .select(ONE_TIME_SELECT)
      .gte('booking_date', date)
      .lte('booking_date', through)
      .eq('bookings.bodies.body_type', 'Committee'),
    adminSupabase
      .from('one_time_room_bookings')
      .select(ONE_TIME_SELECT)
      .gte('booking_date', date)
      .lte('booking_date', through)
      .eq('bookings.is_event', true),
  ])

  const results = [weeklyResult, weeklyEventResult, oneTimeResult, oneTimeEventResult]
  const failed = results.find(r => r.error)
  if (failed) {
    console.error('committee display query failed:', failed.error)
    return NextResponse.json({ error: 'Could not load meetings' }, { status: 500 })
  }

  const meetings: CommitteeMeeting[] = []

  // A committee's own booking is very often flagged as an event too, so the two
  // queries of each pair overlap heavily and the same row arrives twice. Keyed
  // by the session row's id, which is what a duplicate shares.
  const seen = new Set<string>()
  const fresh = <T extends { id: string }>(rows: T[]) => rows.filter(r => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })

  const weeklyRows = fresh([
    ...((weeklyResult.data ?? []) as WeeklyRow[]),
    ...((weeklyEventResult.data ?? []) as WeeklyRow[]),
  ])

  for (const row of weeklyRows) {
    const series = one(row.weekly_room_bookings)
    const booking = series && one(series.bookings)
    const body = booking && one(booking.bodies)
    if (!series || !booking || !body) continue

    const candidate: WeeklyCandidate = {
      id: row.id,
      date: row.occurrence_date,
      room_name: row.room_name,
      start_time: row.start_time,
      end_time: row.end_time,
      meeting_time: row.meeting_time,
      status: row.status,
      hidden: row.hidden,
      purpose: row.purpose,
      series: {
        room_name: series.room_name,
        start_time: series.start_time,
        end_time: series.end_time,
        meeting_time: series.meeting_time,
        status: series.status,
      },
      is_event: row.is_event,
      booking: { hidden: booking.hidden, purpose: booking.purpose, bodyName: body.name },
    }
    const resolved = resolveWeekly(candidate)
    if (resolved) meetings.push(resolved)
  }

  const oneTimeRows = fresh([
    ...((oneTimeResult.data ?? []) as OneTimeRow[]),
    ...((oneTimeEventResult.data ?? []) as OneTimeRow[]),
  ])

  for (const row of oneTimeRows) {
    const booking = one(row.bookings)
    const body = booking && one(booking.bodies)
    if (!booking || !body) continue

    const candidate: OneTimeCandidate = {
      id: row.id,
      date: row.booking_date,
      room_name: row.room_name,
      start_time: row.start_time,
      end_time: row.end_time,
      meeting_time: row.meeting_time,
      status: row.status,
      booking: {
        hidden: booking.hidden,
        purpose: booking.purpose,
        bodyName: body.name,
        isEvent: booking.is_event ?? false,
      },
    }
    const resolved = resolveOneTime(candidate)
    if (resolved) meetings.push(resolved)
  }

  return NextResponse.json({ date, through, meetings })
}
