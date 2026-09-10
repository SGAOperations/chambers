import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { requireBookingManager } from '@/lib/booking-scope'

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
  // It will not always. The weekly PATCH handler deletes and reinserts every
  // occurrence on each save, so an edit to the booking leaves occurrence_id
  // pointing at nothing while the values live on under new ids, carried across
  // on the date. Storing the date is what lets the request still be matched to
  // its reservation afterwards -- without it, marking the request Done finds
  // nothing to do, and Auto-Cancel cannot tell which request asked for what.
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
    })

  if (requestError) return NextResponse.json({ error: requestError.message }, { status: 500 })

  // Update booking/occurrence status to Pending Cancellation
  if (scope === 'occurrence' && occurrence_id) {
    if (bookingType === 'One-Time Room') {
      const { error } = await adminSupabase
        .from('one_time_room_bookings')
        .update({ status: 'Pending Cancellation' })
        .eq('id', occurrence_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else if (bookingType === 'Tabling') {
      const { error } = await adminSupabase
        .from('tabling_sessions')
        .update({ status: 'Pending Cancellation' })
        .eq('id', occurrence_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      // Weekly Room — update the specific occurrence
      const { error } = await adminSupabase
        .from('weekly_room_occurrences')
        .update({ status: 'Pending Cancellation' })
        .eq('id', occurrence_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } else {
    // Series scope — update all sessions for the booking
    if (bookingType === 'One-Time Room') {
      await adminSupabase
        .from('one_time_room_bookings')
        .update({ status: 'Pending Cancellation' })
        .eq('booking_id', booking_id)
    } else if (bookingType === 'Weekly Room') {
      await adminSupabase
        .from('weekly_room_bookings')
        .update({ status: 'Pending Cancellation' })
        .eq('booking_id', booking_id)
    } else if (bookingType === 'Tabling') {
      const { data: tablingBooking } = await adminSupabase
        .from('tabling_bookings')
        .select('id')
        .eq('booking_id', booking_id)
        .single()

      if (tablingBooking) {
        await adminSupabase
          .from('tabling_sessions')
          .update({ status: 'Pending Cancellation' })
          .eq('tabling_booking_id', tablingBooking.id)
      }
    }
  }

  return NextResponse.json({ success: true })
}
