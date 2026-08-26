import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { data: requests } = await supabase
    .from('room_requests')
    .select(`
      id, type, purpose, status, notes, created_at, body_id, scope, division,
      bodies(name),
      users(full_name),
      room_request_details(room_name, start_date, start_time, end_time, end_date),
      tabling_request_sessions(session_date, start_time, end_time),
      room_request_bodies(body_id, bodies(name))
    `)
    .order('created_at', { ascending: false })

  return NextResponse.json({ requests: requests || [] })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { id, status, booking_id, notes, denial_reason, is_event } = await request.json()

  // Update request status and notes
  const { error: requestError } = await adminSupabase
    .from('room_requests')
    .update({ status, notes: notes || null })
    .eq('id', id)

  if (requestError) return NextResponse.json({ error: requestError.message }, { status: 500 })

  // Link booking if fulfilling
  if (status === 'Fulfilled' && booking_id) {
    const bookingUpdate: Record<string, unknown> = { request_id: id }
    if (is_event) bookingUpdate.is_event = true

    const { error: bookingError } = await adminSupabase
      .from('bookings')
      .update(bookingUpdate)
      .eq('id', booking_id)

    if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })
  }

  // Create denial notification for the requester
  if (status === 'Denied') {
    const { data: roomRequest } = await adminSupabase
      .from('room_requests')
      .select('requested_by')
      .eq('id', id)
      .single()

    if (roomRequest?.requested_by) {
      const { error: alertError } = await adminSupabase.from('user_alerts').insert({
        user_id: roomRequest.requested_by,
        request_id: id,
        booking_type: 'Denied',
        denial_reason: denial_reason ?? null,
      })
      if (alertError) return NextResponse.json({ error: alertError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}