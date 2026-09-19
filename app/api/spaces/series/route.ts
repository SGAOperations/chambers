import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import {
  EXTERNAL_ATTENDEES_ERROR,
  attendeeKeys,
  dedupeEmails,
  parseExternalAttendees,
  resolveSpacesAddresses,
} from '@/lib/spaces-email'
import { sendSpaceSeriesConfirmedEmail } from '@/lib/emails/space-series'
import {
  addDays,
  intervalFor,
  planSeries,
  touchesDeadZone,
  weeklyDates,
} from '@/lib/space-series'
import { canBookSpaces, loadActiveSemesterEnd, loadPlanContext } from '@/lib/space-series-data'

/**
 * Creates a recurring weekly SGA Space booking (issue #112).
 *
 * Every week is checked the way a one-off booking is -- overlap, blackouts, the
 * weekly hours limit, advance notice -- and the ones that fail are reported
 * back rather than sinking the whole series. The first attempt returns 409 with
 * the conflicting weeks when there are any; the modal shows them, and a second
 * request with skip_conflicts books the rest.
 */

const adminSupabase = db

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/

export async function POST(request: Request) {
  const supabase = db
  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  if (!(await canBookSpaces(adminSupabase, user))) {
    return NextResponse.json({ error: 'Only Leadership members and administrators may create space bookings.' }, { status: 403 })
  }

  const { space_id, title, date, start_time, end_time, until, attendee_ids, external_attendees, skip_conflicts } = await request.json()

  if (!space_id || typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'space_id and title are required.' }, { status: 400 })
  }
  if (!DATE.test(date ?? '') || !DATE.test(until ?? '') || !TIME.test(start_time ?? '') || !TIME.test(end_time ?? '')) {
    return NextResponse.json({ error: 'date, until, start_time and end_time are required.' }, { status: 400 })
  }
  const attendees: string[] = Array.isArray(attendee_ids) ? attendee_ids.filter((a: unknown) => typeof a === 'string') : []
  const externals = parseExternalAttendees(external_attendees)
  if (!externals) return NextResponse.json({ error: EXTERNAL_ATTENDEES_ERROR }, { status: 400 })

  const first = intervalFor(date, start_time, end_time)
  if (new Date(first.start).getUTCMinutes() % 15 !== 0 || new Date(first.end).getUTCMinutes() % 15 !== 0) {
    return NextResponse.json({ error: 'Bookings must start and end on 15-minute intervals.' }, { status: 400 })
  }
  if (Date.parse(first.start) >= Date.parse(first.end)) {
    return NextResponse.json({ error: 'Start time must be before end time.' }, { status: 400 })
  }
  if (touchesDeadZone(first.start, first.end)) {
    return NextResponse.json({ error: 'Bookings may not start or end between 12:00 AM and 7:00 AM.' }, { status: 400 })
  }

  const semesterEnd = await loadActiveSemesterEnd(adminSupabase)
  if (!semesterEnd) {
    return NextResponse.json({
      error: 'Weekly bookings are unavailable until an administrator sets the end date of the current semester.',
    }, { status: 400 })
  }
  if (until < addDays(date, 7)) {
    return NextResponse.json({ error: 'A weekly booking needs to run for at least two weeks.' }, { status: 400 })
  }
  if (until > semesterEnd) {
    return NextResponse.json({ error: 'A weekly booking cannot run past the end of the semester.' }, { status: 400 })
  }

  const weeks = weeklyDates(date, until).map(d => ({ date: d, interval: intervalFor(d, start_time, end_time) }))

  const ctx = await loadPlanContext(adminSupabase, {
    spaceId: space_id,
    creatorId: user.id,
    from: weeks[0].interval.start,
    to: weeks[weeks.length - 1].interval.end,
  })
  const { ok, conflicts } = planSeries({ ...ctx, weeks })

  if (ok.length === 0) {
    return NextResponse.json({ error: 'None of these weeks can be booked.', conflicts }, { status: 400 })
  }
  if (conflicts.length > 0 && !skip_conflicts) {
    return NextResponse.json({
      error: 'Some of these weeks cannot be booked.',
      conflicts,
      bookable: ok.length,
    }, { status: 409 })
  }

  const { data: series, error: seriesError } = await adminSupabase
    .from('space_booking_series')
    .insert({
      space_id,
      creator_id: user.id,
      title: title.trim(),
      attendee_ids: attendees,
      external_attendees: externals,
      start_time,
      end_time,
      starts_on: date,
      ends_on: until,
    })
    .select('id')
    .single()

  if (seriesError || !series) {
    return NextResponse.json({ error: seriesError?.message ?? 'Could not create the series.' }, { status: 500 })
  }

  const { data: rows, error: rowsError } = await adminSupabase
    .from('space_bookings')
    .insert(ok.map(w => ({
      space_id,
      creator_id: user.id,
      title: title.trim(),
      start_time: w.interval.start,
      end_time: w.interval.end,
      attendee_ids: attendees,
      external_attendees: externals,
      series_id: series.id,
    })))
    .select('id, start_time, end_time')

  if (rowsError || !rows) {
    // Nothing references a series with no weeks, so removing it leaves no trace.
    await adminSupabase.from('space_booking_series').delete().eq('id', series.id)
    return NextResponse.json({ error: rowsError?.message ?? 'Could not create the bookings.' }, { status: 500 })
  }

  // One email for the whole series, after the response (see lib/emails/space-series.ts).
  waitUntil(
    (async () => {
      try {
        const userIds = [user.id, ...attendeeKeys({ attendee_ids: attendees, external_attendees: externals })]
        const [{ data: space }, addresses] = await Promise.all([
          adminSupabase.from('spaces').select('name').eq('id', space_id).single(),
          resolveSpacesAddresses(adminSupabase, userIds),
        ])
        await sendSpaceSeriesConfirmedEmail({
          title: title.trim(),
          spaceName: space?.name ?? 'SGA Space',
          weeks: rows
            .map((r: { id: string; start_time: string; end_time: string }) => ({ bookingId: r.id, startTime: r.start_time, endTime: r.end_time }))
            .sort((a, b) => a.startTime.localeCompare(b.startTime)),
          skipped: conflicts,
          recipients: dedupeEmails(userIds.flatMap(id => addresses.get(id) ?? [])),
        })
      } catch (e) {
        console.error('Space series confirmation email failed:', e)
      }
    })()
  )

  return NextResponse.json({ success: true, series_id: series.id, created: rows.length, skipped: conflicts })
}
