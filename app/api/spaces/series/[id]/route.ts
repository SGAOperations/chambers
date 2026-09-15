import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { hasLiveAdmin, type AuthedUser } from '@/lib/auth'
import { bostonWallClockNow } from '@/lib/boston-time'
import { cancellationAddressing, dedupeEmails, resolveSpacesAddresses } from '@/lib/spaces-email'
import {
  sendSpaceSeriesCancelledEmail,
  sendSpaceSeriesUpdatedEmail,
  type SeriesWeek,
} from '@/lib/emails/space-series'
import {
  intervalFor,
  planSeries,
  touchesDeadZone,
  weekdayOf,
  weeklyDates,
  type PlannedWeek,
  type SeriesConflict,
} from '@/lib/space-series'
import { loadActiveSemesterEnd, loadPlanContext } from '@/lib/space-series-data'

/**
 * One recurring SGA Space booking (issue #112): read it, edit every upcoming
 * week at once, or cancel every upcoming week.
 *
 * "Upcoming" is a week whose start has not yet passed, in the Boston wall-clock
 * domain space times are stored in. Past weeks are never touched -- they are the
 * record of what happened -- and neither is a week already under way.
 *
 * A series edit overwrites each upcoming week with the series' values, including
 * weeks that had been edited on their own. That is the rule chosen for #112: the
 * series is what you see.
 */

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/

interface SeriesRow {
  id: string
  space_id: string
  creator_id: string
  title: string
  attendee_ids: string[]
  start_time: string
  end_time: string
  starts_on: string
  ends_on: string
  cancelled_at: string | null
}

interface WeekRow {
  id: string
  start_time: string
  end_time: string
  attendee_ids: string[] | null
  /** Usually the series' space; a week can be moved to another on its own. */
  space_id: string
}

async function loadSeries(id: string): Promise<SeriesRow | null> {
  const { data } = await adminSupabase
    .from('space_booking_series')
    .select('id, space_id, creator_id, title, attendee_ids, start_time, end_time, starts_on, ends_on, cancelled_at')
    .eq('id', id)
    .maybeSingle()
  return (data as SeriesRow | null) ?? null
}

/** The weeks of a series that have not started yet, in date order. */
async function loadUpcoming(seriesId: string): Promise<WeekRow[]> {
  const { data } = await adminSupabase
    .from('space_bookings')
    .select('id, start_time, end_time, attendee_ids, space_id')
    .eq('series_id', seriesId)
    .gte('start_time', bostonWallClockNow().toISOString())
    .order('start_time')
  return (data as WeekRow[] | null) ?? []
}

/** Only the creator or an administrator may change a series, as with a single booking. */
function mayManage(user: AuthedUser, series: SeriesRow): boolean {
  return series.creator_id === user.id || hasLiveAdmin(user)
}

function toWeek(r: { id: string; start_time: string; end_time: string }): SeriesWeek {
  return { bookingId: r.id, startTime: r.start_time, endTime: r.end_time }
}

/**
 * Names each week's space when it is not the series' own -- a week moved on its
 * own and not moved back -- so its invite and its line in the email say where it
 * really is.
 */
async function nameOtherSpaces(
  weeks: (SeriesWeek & { spaceId: string })[],
  seriesSpaceId: string
): Promise<SeriesWeek[]> {
  const others = [...new Set(weeks.map(w => w.spaceId).filter(s => s !== seriesSpaceId))]
  const { data } = others.length
    ? await adminSupabase.from('spaces').select('id, name').in('id', others)
    : { data: [] as { id: string; name: string }[] }
  return weeks.map(({ spaceId, ...w }) => (
    spaceId === seriesSpaceId ? w : { ...w, spaceName: data?.find(s => s.id === spaceId)?.name ?? 'SGA Space' }
  ))
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const series = await loadSeries(id)
  if (!series) return NextResponse.json({ error: 'Series not found' }, { status: 404 })

  const [upcoming, semesterEnd] = await Promise.all([loadUpcoming(id), loadActiveSemesterEnd(adminSupabase)])

  return NextResponse.json({
    series: {
      ...series,
      start_time: series.start_time.slice(0, 5),
      end_time: series.end_time.slice(0, 5),
      weekday: weekdayOf(series.starts_on),
    },
    upcoming_count: upcoming.length,
    next_date: upcoming[0]?.start_time.slice(0, 10) ?? null,
    semester_end_date: semesterEnd,
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { id } = await params
  const series = await loadSeries(id)
  if (!series) return NextResponse.json({ error: 'Series not found' }, { status: 404 })
  if (!mayManage(user, series)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (series.cancelled_at) {
    return NextResponse.json({ error: 'This weekly booking has been cancelled.' }, { status: 400 })
  }

  const { title, start_time, end_time, until, attendee_ids, skip_conflicts } = await request.json()

  if (typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'Title is required.' }, { status: 400 })
  }
  if (!DATE.test(until ?? '') || !TIME.test(start_time ?? '') || !TIME.test(end_time ?? '')) {
    return NextResponse.json({ error: 'until, start_time and end_time are required.' }, { status: 400 })
  }
  const attendees: string[] = Array.isArray(attendee_ids) ? attendee_ids.filter((a: unknown) => typeof a === 'string') : []

  // The time pattern is validated once on the first date; every week shares it.
  const sample = intervalFor(series.starts_on, start_time, end_time)
  if (new Date(sample.start).getUTCMinutes() % 15 !== 0 || new Date(sample.end).getUTCMinutes() % 15 !== 0) {
    return NextResponse.json({ error: 'Bookings must start and end on 15-minute intervals.' }, { status: 400 })
  }
  if (Date.parse(sample.start) >= Date.parse(sample.end)) {
    return NextResponse.json({ error: 'Start time must be before end time.' }, { status: 400 })
  }
  if (touchesDeadZone(sample.start, sample.end)) {
    return NextResponse.json({ error: 'Bookings may not start or end between 12:00 AM and 7:00 AM.' }, { status: 400 })
  }

  const upcoming = await loadUpcoming(id)
  if (upcoming.length === 0) {
    return NextResponse.json({ error: 'This weekly booking has no upcoming weeks left to change.' }, { status: 400 })
  }

  const nextDate = upcoming[0].start_time.slice(0, 10)
  if (until < nextDate) {
    return NextResponse.json({
      error: 'The end date cannot be before the next week. To stop every upcoming week, cancel the series instead.',
    }, { status: 400 })
  }

  // Extending is bounded by the semester; shortening, or leaving the end where
  // it is, never needs a semester end date to have been set.
  if (until > series.ends_on) {
    const semesterEnd = await loadActiveSemesterEnd(adminSupabase)
    if (!semesterEnd) {
      return NextResponse.json({
        error: 'A weekly booking cannot be extended until an administrator sets the end date of the current semester.',
      }, { status: 400 })
    }
    if (until > semesterEnd) {
      return NextResponse.json({ error: 'A weekly booking cannot run past the end of the semester.' }, { status: 400 })
    }
  }

  const kept = upcoming.filter(r => r.start_time.slice(0, 10) <= until)
  const removed = upcoming.filter(r => r.start_time.slice(0, 10) > until)

  const nowIso = bostonWallClockNow().toISOString()
  const moving: PlannedWeek[] = kept.map(r => {
    const date = r.start_time.slice(0, 10)
    return { date, interval: intervalFor(date, start_time, end_time), existing: r }
  })
  const adding: PlannedWeek[] = weeklyDates(series.starts_on, until)
    .filter(d => d > series.ends_on)
    .map(d => ({ date: d, interval: intervalFor(d, start_time, end_time) }))
    .filter(w => w.interval.start >= nowIso)

  const weeks = [...moving, ...adding]
  const ctx = await loadPlanContext(adminSupabase, {
    spaceId: series.space_id,
    creatorId: series.creator_id,
    from: weeks[0].interval.start,
    to: weeks.reduce((max, w) => (w.interval.end > max ? w.interval.end : max), weeks[0].interval.end),
  })
  const { ok, conflicts } = planSeries({ ...ctx, spaceId: series.space_id, weeks })

  const movingDates = new Set(moving.map(w => w.date))
  const unchanged: SeriesConflict[] = conflicts.filter(c => movingDates.has(c.date))
  const skipped: SeriesConflict[] = conflicts.filter(c => !movingDates.has(c.date))

  if (conflicts.length > 0 && !skip_conflicts) {
    return NextResponse.json({
      error: 'Some weeks cannot take this change.',
      conflicts,
      applicable: ok.length,
    }, { status: 409 })
  }

  const cleanTitle = title.trim()
  const okByDate = new Map(ok.map(w => [w.date, w]))

  // Every kept week takes the title and attendees. Only the weeks the plan
  // accepted take the new time -- and the series' space, since a week moved to
  // another space on its own was checked here as moving back. The rest keep
  // their time and space, as the email says.
  const updates = await Promise.all(kept.map(r => {
    const planned = okByDate.get(r.start_time.slice(0, 10))
    return adminSupabase
      .from('space_bookings')
      .update({
        title: cleanTitle,
        attendee_ids: attendees,
        ...(planned ? { start_time: planned.interval.start, end_time: planned.interval.end, space_id: series.space_id } : {}),
      })
      .eq('id', r.id)
      .select('id, start_time, end_time, space_id')
      .single()
  }))
  const updateError = updates.find(u => u.error)?.error
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  const toInsert = adding.filter(w => okByDate.has(w.date))
  let inserted: WeekRow[] = []
  if (toInsert.length > 0) {
    const { data, error } = await adminSupabase
      .from('space_bookings')
      .insert(toInsert.map(w => ({
        space_id: series.space_id,
        creator_id: series.creator_id,
        title: cleanTitle,
        start_time: w.interval.start,
        end_time: w.interval.end,
        attendee_ids: attendees,
        series_id: id,
      })))
      .select('id, start_time, end_time, attendee_ids, space_id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    inserted = (data as WeekRow[] | null) ?? []
  }

  if (removed.length > 0) {
    const { error } = await adminSupabase.from('space_bookings').delete().in('id', removed.map(r => r.id))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { error: seriesError } = await adminSupabase
    .from('space_booking_series')
    .update({ title: cleanTitle, attendee_ids: attendees, start_time, end_time, ends_on: until })
    .eq('id', id)
  if (seriesError) return NextResponse.json({ error: seriesError.message }, { status: 500 })

  const finalRows = [
    ...updates.map(u => u.data as { id: string; start_time: string; end_time: string; space_id: string }),
    ...inserted,
  ].sort((a, b) => a.start_time.localeCompare(b.start_time))

  waitUntil(
    (async () => {
      try {
        const withSpace = (r: { id: string; start_time: string; end_time: string; space_id: string }) =>
          ({ ...toWeek(r), spaceId: r.space_id })
        const [finalWeeks, removedWeeks] = await Promise.all([
          nameOtherSpaces(finalRows.map(withSpace), series.space_id),
          nameOtherSpaces(removed.map(withSpace), series.space_id),
        ])

        const previousAttendees = new Set([
          ...series.attendee_ids,
          ...upcoming.flatMap(r => r.attendee_ids ?? []),
        ])
        const droppedAttendees = [...previousAttendees].filter(a => !attendees.includes(a) && a !== series.creator_id)

        const currentIds = [series.creator_id, ...attendees]
        const [{ data: space }, addresses] = await Promise.all([
          adminSupabase.from('spaces').select('name').eq('id', series.space_id).single(),
          resolveSpacesAddresses(adminSupabase, [...currentIds, ...droppedAttendees]),
        ])
        const spaceName = space?.name ?? 'SGA Space'
        const recipients = dedupeEmails(currentIds.flatMap(u => addresses.get(u) ?? []))

        await sendSpaceSeriesUpdatedEmail({
          title: cleanTitle,
          spaceName,
          weeks: finalWeeks,
          removed: removedWeeks,
          unchanged,
          skipped,
          recipients,
        })

        // Someone taken off the series had every upcoming week on their
        // calendar. An inbox a current recipient also uses -- a shared SGA inbox
        // -- is left alone, since the update above already covers it.
        const inCurrent = new Set(recipients.map(e => e.toLowerCase()))
        const dropped = dedupeEmails(droppedAttendees.flatMap(u => addresses.get(u) ?? []))
          .filter(e => !inCurrent.has(e.toLowerCase()))
        if (dropped.length > 0) {
          await sendSpaceSeriesCancelledEmail({
            title: cleanTitle,
            spaceName,
            weeks: [...finalWeeks, ...removedWeeks],
            to: [process.env.RESEND_FROM_EMAIL!],
            bcc: dropped,
            intro: 'You have been removed from this weekly SGA Space booking.',
          })
        }
      } catch (e) {
        console.error('Space series update email failed:', e)
      }
    })()
  )

  return NextResponse.json({
    success: true,
    updated: ok.length,
    unchanged,
    skipped,
    removed: removed.length,
  })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { id } = await params
  const series = await loadSeries(id)
  if (!series) return NextResponse.json({ error: 'Series not found' }, { status: 404 })
  if (!mayManage(user, series)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const upcoming = await loadUpcoming(id)

  if (upcoming.length > 0) {
    const { error } = await adminSupabase.from('space_bookings').delete().in('id', upcoming.map(r => r.id))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Kept rather than deleted: past weeks still point at it.
  if (!series.cancelled_at) {
    await adminSupabase
      .from('space_booking_series')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('id', id)
  }

  if (upcoming.length > 0) {
    waitUntil(
      (async () => {
        try {
          // Anyone on any upcoming week, including one added to a single week.
          const attendees = [...new Set([
            ...series.attendee_ids,
            ...upcoming.flatMap(r => r.attendee_ids ?? []),
          ])].filter(a => a !== series.creator_id)

          const [{ data: space }, addresses] = await Promise.all([
            adminSupabase.from('spaces').select('name').eq('id', series.space_id).single(),
            resolveSpacesAddresses(adminSupabase, [series.creator_id, ...attendees]),
          ])
          const { to, bcc } = cancellationAddressing(addresses, series.creator_id, attendees)

          await sendSpaceSeriesCancelledEmail({
            title: series.title,
            spaceName: space?.name ?? 'SGA Space',
            weeks: upcoming.map(toWeek),
            to,
            bcc,
          })
        } catch (e) {
          console.error('Space series cancellation email failed:', e)
        }
      })()
    )
  }

  return NextResponse.json({ success: true, cancelled: upcoming.length })
}
