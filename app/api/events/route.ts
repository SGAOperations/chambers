import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'
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

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
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

  const [{ data: bookings, error }, { data: settingsRow }] = await Promise.all([
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
        event_tracking(event_management_form, engage_form)
      `)
      .eq('is_event', true)
      .eq('semester_id', activeSemester.id),
    supabase.from('app_settings').select('*').eq('id', 1).maybeSingle(),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Each form's due date is the near edge of its Danger Range (issue #45) --
  // the same settings the "danger" flash (dangerStart) already reads, just the
  // other end of the pair.
  const s = settingsFromRow(settingsRow as SettingsRow | null)
  const withDueDates = (bookings || []).map(b => {
    const eventDate = minDate(sessionDatesOf(b))
    return {
      ...b,
      event_date: eventDate,
      event_management_form_due: eventDate ? subtractDays(eventDate, s.eventMgmt[1]) : null,
      engage_form_due: eventDate ? subtractDays(eventDate, s.eventEngage[1]) : null,
    }
  })

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
