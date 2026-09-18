import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { requireBookingManager } from '@/lib/booking-scope'
import type { PreviousStatus, StatusTable } from '@/lib/pending-cancellations'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { booking_id, occurrence_id, scope, cancellation_type = 'Cancellation' } = await request.json()

  // Leadership of any body the booking is scoped to may request a cancellation -- for a divisional
  // or multi booking that is wider than the owning body.
  const guard = await requireBookingManager(supabase, adminSupabase, user, booking_id)
  if (guard.error) return guard.error

  const bookingType = guard.row.type

  // The date this request is about, resolved now while occurrence_id still
  // names a live row (issue #96).
  //
  // It will not always. The weekly PATCH handler used to delete and reinsert
  // every occurrence on each save, orphaning occurrence_id, and requests made
  // before issue #113 still point at those lost rows. Even now an occurrence's
  // id changes when its series moves to another day of the week. Storing the
  // date is what lets the request still be matched to its reservation -- without
  // it, marking the request Done finds nothing to do, and Auto-Cancel cannot
  // tell which request asked for what.
  let occurrenceDate: string | null = null
  if (scope === 'occurrence' && occurrence_id) {
    if (bookingType === 'One-Time Room') {
      const { data } = await adminSupabase
        .from('one_time_room_bookings').select('booking_date').eq('id', occurrence_id).maybeSingle()
      occurrenceDate = data?.booking_date ?? null
    } else if (bookingType === 'Tabling') {
      const { data } = await adminSupabase
        .from('tabling_sessions').select('session_date').eq('id', occurrence_id).maybeSingle()
      occurrenceDate = data?.session_date ?? null
    } else {
      const { data } = await adminSupabase
        .from('weekly_room_occurrences').select('occurrence_date').eq('id', occurrence_id).maybeSingle()
      occurrenceDate = data?.occurrence_date ?? null
    }
  }

  // Which rows this request sets to Pending Cancellation (issue #139).
  //
  // Worked out before anything is written, so their current statuses can be
  // recorded on the request. Dismissing a request puts those back; without
  // them, dismissal could only leave the booking pending, and Auto-Cancel would
  // cancel it anyway.
  //
  // A series-level request on a weekly booking writes to the series row, not to
  // its weeks, which inherit from it -- so the series row is what is recorded.
  let target: { table: StatusTable; column: string; value: string } | null = null
  if (scope === 'occurrence' && occurrence_id) {
    const table: StatusTable =
      bookingType === 'One-Time Room' ? 'one_time_room_bookings'
      : bookingType === 'Tabling' ? 'tabling_sessions'
      : 'weekly_room_occurrences'
    target = { table, column: 'id', value: occurrence_id }
  } else if (bookingType === 'One-Time Room') {
    target = { table: 'one_time_room_bookings', column: 'booking_id', value: booking_id }
  } else if (bookingType === 'Weekly Room') {
    target = { table: 'weekly_room_bookings', column: 'booking_id', value: booking_id }
  } else if (bookingType === 'Tabling') {
    const { data: tablingBooking } = await adminSupabase
      .from('tabling_bookings')
      .select('id')
      .eq('booking_id', booking_id)
      .single()
    if (tablingBooking) target = { table: 'tabling_sessions', column: 'tabling_booking_id', value: tablingBooking.id }
  }

  let previousStatuses: PreviousStatus[] = []
  if (target) {
    const { data: rows, error } = await adminSupabase
      .from(target.table)
      .select('id, status')
      .eq(target.column, target.value)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    previousStatuses = ((rows ?? []) as { id: string; status: string | null }[])
      .map(r => ({ table: target!.table, id: r.id, status: r.status }))
  }

  // Create cancellation request
  const { error: requestError } = await adminSupabase
    .from('cancellation_requests')
    .insert({
      booking_id,
      occurrence_id: occurrence_id || null,
      occurrence_date: occurrenceDate,
      requested_by: user.id,
      scope,
      status: 'Pending',
      cancellation_type,
      previous_statuses: previousStatuses,
    })

  if (requestError) return NextResponse.json({ error: requestError.message }, { status: 500 })

  // Update booking/occurrence status to Pending Cancellation. Only the rows
  // recorded above, by id, so what was recorded and what was changed cannot
  // drift apart if a session is added in between.
  if (previousStatuses.length) {
    const { error } = await adminSupabase
      .from(target!.table)
      .update({ status: 'Pending Cancellation' })
      .in('id', previousStatuses.map(p => p.id))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
