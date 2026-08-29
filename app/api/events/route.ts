import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { sessionDatesOf, minDate, subtractDays, settingsFromRow, type SettingsRow } from '@/lib/pending-actions'

// The Events tab is "every event this semester", for the two roles allowed to see
// it. RLS cannot express that: bookings_select_admin_or_member grants a row to
// admins and to members of the owning body, and IEMS is neither -- it is an
// app-level role the policy has no concept of. An IEMS user was therefore served
// only the events belonging to bodies they happen to sit on (1 of 4, on current
// data) and read that as "there are no events".
//
// So the listing runs as service role, gated by the explicit admin-or-IEMS check
// below rather than by RLS. Same shape as /api/dashboard's alerts read.
const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** One event_tracking row as embedded above. */
interface TrackingRow {
  event_management_form: boolean
  engage_form: boolean
  occurrence_date: string | null
}

/** A flagged weekly occurrence with the series and booking it belongs to. */
interface EventOccurrenceRow {
  occurrence_date: string
  room_name: string | null
  start_time: string | null
  end_time: string | null
  purpose: string | null
  weekly_room_bookings: {
    room_name: string
    start_time: string
    end_time: string
    bookings: {
      id: string
      purpose: string
      type: string
      created_at: string
      semester_id: string | null
      bodies: { name: string } | null
      users: { full_name: string } | null
      event_tracking: TrackingRow[] | null
    } | null
  } | null
}

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || (!user.app_metadata?.is_admin && !user.app_metadata?.iems_role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { data: activeSemester } = await supabase
    .from('semesters')
    .select('id')
    .eq('is_active', true)
    .single()

  if (!activeSemester) return NextResponse.json({ bookings: [] })

  const [{ data: bookings, error }, { data: eventOccurrences, error: occError }, { data: settingsRow }] =
    await Promise.all([
      adminSupabase
        .from('bookings')
        .select(`
          id, purpose, type, created_at,
          bodies(name),
          users!bookings_created_by_fkey(full_name),
          one_time_room_bookings(room_name, booking_date, start_time, end_time),
          weekly_room_bookings(room_name, start_date, end_date, start_time, end_time, weekly_room_occurrences(occurrence_date)),
          tabling_bookings(
            tabling_sessions(location, session_date, start_time, end_time)
          ),
          event_tracking(event_management_form, engage_form, occurrence_date)
        `)
        .eq('is_event', true)
        .eq('semester_id', activeSemester.id),

      // Weekly events are marked on the occurrence and never on the booking, so
      // they are unreachable from the query above: filtering an embedded resource
      // narrows the child array, it does not select the parent. Fetched
      // separately and folded in below. `!inner` drops occurrences whose ancestry
      // is missing rather than emitting a row with no booking behind it.
      adminSupabase
        .from('weekly_room_occurrences')
        .select(`
          occurrence_date, room_name, start_time, end_time, purpose,
          weekly_room_bookings!inner(
            room_name, start_time, end_time,
            bookings!inner(
              id, purpose, type, created_at, semester_id,
              bodies(name),
              users!bookings_created_by_fkey(full_name),
              event_tracking(event_management_form, engage_form, occurrence_date)
            )
          )
        `)
        .eq('is_event', true),

      supabase.from('app_settings').select('*').eq('id', 1).maybeSingle(),
    ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (occError) return NextResponse.json({ error: occError.message }, { status: 500 })

  // Each form's due date is the near edge of its Danger Range (issue #45) --
  // the same settings the "danger" flash (dangerStart) already reads, just the
  // other end of the pair.
  const s = settingsFromRow(settingsRow as SettingsRow | null)

  /**
   * event_tracking is now one-to-many -- a booking can have a checklist of its
   * own plus one per event occurrence -- so the embed returns an array where it
   * used to return a single row. Pick the entry for this target: the one whose
   * occurrence_date matches, or the booking-level row (null) for a booking event.
   */
  const trackingFor = (rows: TrackingRow[] | null | undefined, date: string | null) =>
    (rows ?? []).find(t => (t.occurrence_date ?? null) === date) ?? null

  /** Adds the two derived due dates, which depend only on when the event is. */
  const withDates = <T,>(row: T, eventDate: string | null) => ({
    ...row,
    event_date: eventDate,
    event_management_form_due: eventDate ? subtractDays(eventDate, s.eventMgmt[1]) : null,
    engage_form_due: eventDate ? subtractDays(eventDate, s.eventEngage[1]) : null,
  })

  const bookingEvents = (bookings || []).map(b =>
    withDates(
      { ...b, occurrence_date: null, event_tracking: trackingFor(b.event_tracking as TrackingRow[], null) },
      minDate(sessionDatesOf(b))
    )
  )

  /**
   * One row per flagged occurrence: the occurrence is the event, so it is listed
   * in its own right rather than nested under its series.
   *
   * The id is `<bookingId>:<date>` because the checklist and the pending-actions
   * highlighting are both keyed by row id, and every flagged week of the same
   * series would otherwise collide on the booking's id. Its shape mirrors a
   * booking closely enough for the page to render it unchanged, with
   * occurrence_date set so the detail block knows to show one date rather than a
   * range.
   */
  const occurrenceEvents = (eventOccurrences || [])
    .map(o => o as unknown as EventOccurrenceRow)
    .map(o => {
      const weekly = o.weekly_room_bookings
      const booking = weekly?.bookings
      if (!booking || booking.semester_id !== activeSemester.id) return null
      return withDates(
        {
          id: `${booking.id}:${o.occurrence_date}`,
          booking_id: booking.id,
          occurrence_date: o.occurrence_date,
          // The occurrence's purpose override wins, per issue #55.
          purpose: o.purpose ?? booking.purpose,
          type: booking.type,
          created_at: booking.created_at,
          bodies: booking.bodies,
          users: booking.users,
          one_time_room_bookings: null,
          tabling_bookings: null,
          weekly_room_bookings: [{
            room_name: o.room_name ?? weekly.room_name,
            start_date: o.occurrence_date,
            end_date: o.occurrence_date,
            start_time: o.start_time ?? weekly.start_time,
            end_time: o.end_time ?? weekly.end_time,
          }],
          event_tracking: trackingFor(booking.event_tracking, o.occurrence_date),
        },
        o.occurrence_date
      )
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  const withDueDates = [...bookingEvents, ...occurrenceEvents]

  // Issue #48: ordered by the event's own date -- the earliest session date
  // across any of its child bookings -- not by when the tracking row was
  // created. A booking with no session date at all (shouldn't happen for a
  // real booking) sorts last rather than dropping off silently.
  withDueDates.sort((a, b) => {
    if (!a.event_date && !b.event_date) return 0
    if (!a.event_date) return 1
    if (!b.event_date) return -1
    return a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : 0
  })

  return NextResponse.json({ bookings: withDueDates })
}
