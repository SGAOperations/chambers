import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { todayInAppZone } from '@/lib/app-zone'
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
  bodies: BodyRow | BodyRow[] | null
}

interface WeeklyRow {
  id: string
  room_name: string | null
  start_time: string | null
  end_time: string | null
  meeting_time: string | null
  status: string | null
  hidden: boolean | null
  purpose: string | null
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
  room_name: string | null
  start_time: string
  end_time: string
  meeting_time: string | null
  status: string | null
  bookings: BookingRow | BookingRow[] | null
}

// !inner throughout, so the body_type filter narrows the occurrence rows rather
// than just nulling out the embed.
const WEEKLY_SELECT = `
  id, room_name, start_time, end_time, meeting_time, status, hidden, purpose,
  weekly_room_bookings!inner(
    room_name, start_time, end_time, meeting_time, status,
    bookings!inner(hidden, purpose, bodies!inner(name, body_type))
  )
`

const ONE_TIME_SELECT = `
  id, room_name, start_time, end_time, meeting_time, status,
  bookings!inner(hidden, purpose, bodies!inner(name, body_type))
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

  const [weeklyResult, oneTimeResult] = await Promise.all([
    adminSupabase
      .from('weekly_room_occurrences')
      .select(WEEKLY_SELECT)
      .eq('occurrence_date', date)
      .eq('weekly_room_bookings.bookings.bodies.body_type', 'Committee'),
    adminSupabase
      .from('one_time_room_bookings')
      .select(ONE_TIME_SELECT)
      .eq('booking_date', date)
      .eq('bookings.bodies.body_type', 'Committee'),
  ])

  if (weeklyResult.error || oneTimeResult.error) {
    console.error('committee display query failed:', weeklyResult.error ?? oneTimeResult.error)
    return NextResponse.json({ error: 'Could not load meetings' }, { status: 500 })
  }

  const meetings: CommitteeMeeting[] = []

  for (const row of (weeklyResult.data ?? []) as WeeklyRow[]) {
    const series = one(row.weekly_room_bookings)
    const booking = series && one(series.bookings)
    const body = booking && one(booking.bodies)
    if (!series || !booking || !body) continue

    const candidate: WeeklyCandidate = {
      id: row.id,
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
      booking: { hidden: booking.hidden, purpose: booking.purpose, bodyName: body.name },
    }
    const resolved = resolveWeekly(candidate)
    if (resolved) meetings.push(resolved)
  }

  for (const row of (oneTimeResult.data ?? []) as OneTimeRow[]) {
    const booking = one(row.bookings)
    const body = booking && one(booking.bodies)
    if (!booking || !body) continue

    const candidate: OneTimeCandidate = {
      id: row.id,
      room_name: row.room_name,
      start_time: row.start_time,
      end_time: row.end_time,
      meeting_time: row.meeting_time,
      status: row.status,
      booking: { hidden: booking.hidden, purpose: booking.purpose, bodyName: body.name },
    }
    const resolved = resolveOneTime(candidate)
    if (resolved) meetings.push(resolved)
  }

  return NextResponse.json({ date, meetings })
}
