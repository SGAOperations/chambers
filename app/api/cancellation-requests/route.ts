import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { booking_id, occurrence_id, scope } = await request.json()

  // Create cancellation request
  const { error: requestError } = await adminSupabase
    .from('cancellation_requests')
    .insert({
      booking_id,
      occurrence_id: occurrence_id || null,
      requested_by: user.id,
      scope,
      status: 'Pending',
    })

  if (requestError) return NextResponse.json({ error: requestError.message }, { status: 500 })

  // Update booking/occurrence status to Pending Cancellation
  if (scope === 'occurrence' && occurrence_id) {
    const { error } = await adminSupabase
      .from('weekly_room_occurrences')
      .update({ status: 'Pending Cancellation' })
      .eq('id', occurrence_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // For series or one-time/tabling — update parent booking detail status
    const { data: booking } = await adminSupabase
      .from('bookings')
      .select('type')
      .eq('id', booking_id)
      .single()

    if (booking?.type === 'One-Time Room') {
      await adminSupabase
        .from('one_time_room_bookings')
        .update({ status: 'Pending Cancellation' })
        .eq('booking_id', booking_id)
    } else if (booking?.type === 'Weekly Room') {
      await adminSupabase
        .from('weekly_room_bookings')
        .update({ status: 'Pending Cancellation' })
        .eq('booking_id', booking_id)
    } else if (booking?.type === 'Tabling') {
      // Update all sessions
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