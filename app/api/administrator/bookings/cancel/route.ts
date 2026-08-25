import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { booking_id, scope, occurrence_id } = await request.json()

  const { data: bookingRow } = await adminSupabase
    .from('bookings')
    .select('type')
    .eq('id', booking_id)
    .single()
  const bookingType = bookingRow?.type

  if (scope === 'occurrence' && occurrence_id) {
    if (bookingType === 'One-Time Room') {
      const { error } = await adminSupabase
        .from('one_time_room_bookings')
        .update({ status: 'Cancelled' })
        .eq('id', occurrence_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else if (bookingType === 'Tabling') {
      const { error } = await adminSupabase
        .from('tabling_sessions')
        .update({ status: 'Cancelled' })
        .eq('id', occurrence_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } else {
    // series scope — cancel all sessions
    if (bookingType === 'One-Time Room') {
      const { error } = await adminSupabase
        .from('one_time_room_bookings')
        .update({ status: 'Cancelled' })
        .eq('booking_id', booking_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else if (bookingType === 'Tabling') {
      const { data: tablingBooking } = await adminSupabase
        .from('tabling_bookings')
        .select('id')
        .eq('booking_id', booking_id)
        .single()

      if (tablingBooking) {
        const { error } = await adminSupabase
          .from('tabling_sessions')
          .update({ status: 'Cancelled' })
          .eq('tabling_booking_id', tablingBooking.id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ success: true })
}
