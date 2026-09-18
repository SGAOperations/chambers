import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { requireBookingManager } from '@/lib/booking-scope'
import { OPEN_REQUEST_STATUSES, OPS_REVIEW } from '@/lib/request-status'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * The open revision request on a booking, if there is one, so the booking's
 * detail view can say where it stands (issue #128). Any leader who may request
 * a revision may see it -- only one can be open per booking, and the leader who
 * did not file it is the one most likely to try filing it again.
 */
export async function GET(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const bookingId = new URL(request.url).searchParams.get('booking_id')
  if (!bookingId) return NextResponse.json({ error: 'Missing booking_id' }, { status: 400 })

  const guard = await requireBookingManager(supabase, adminSupabase, user, bookingId)
  if (guard.error) return guard.error

  const { data, error } = await adminSupabase
    .from('revision_requests')
    .select('id, status, change_type, created_at')
    .eq('booking_id', bookingId)
    .in('status', OPEN_REQUEST_STATUSES)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ revision: data })
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { booking_id, change_type, new_start_time, new_end_time, new_room, more_info } = await request.json()

  // Leadership of any body the booking is scoped to may request a revision -- for a divisional or
  // multi booking that is wider than the owning body.
  const guard = await requireBookingManager(supabase, adminSupabase, user, booking_id)
  if (guard.error) return guard.error

  // Block if an open revision request already exists for this booking
  const { data: existing } = await adminSupabase
    .from('revision_requests')
    .select('id')
    .eq('booking_id', booking_id)
    .in('status', OPEN_REQUEST_STATUSES)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: 'A revision request for this booking is already open.' },
      { status: 409 }
    )
  }

  const { error } = await adminSupabase
    .from('revision_requests')
    .insert({
      booking_id,
      requested_by: user.id,
      change_type,
      new_start_time: new_start_time || null,
      new_end_time: new_end_time || null,
      new_room: new_room || null,
      more_info,
      status: OPS_REVIEW,
    })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
