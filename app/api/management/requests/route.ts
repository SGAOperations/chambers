import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: requests } = await supabase
    .from('room_requests')
    .select(`
      id, type, purpose, status, notes, created_at, body_id,
      bodies(name),
      users(full_name),
      room_request_details(room_name, start_date, start_time, end_time, end_date),
      tabling_request_sessions(session_date, start_time, end_time)
    `)
    .order('created_at', { ascending: false })

  return NextResponse.json({ requests: requests || [] })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, status, booking_id, notes } = await request.json()

  // Update request status and notes
  const { error: requestError } = await adminSupabase
    .from('room_requests')
    .update({ status, notes: notes || null })
    .eq('id', id)

  if (requestError) return NextResponse.json({ error: requestError.message }, { status: 500 })

  // Link booking if fulfilling
  if (status === 'Fulfilled' && booking_id) {
    const { error: bookingError } = await adminSupabase
      .from('bookings')
      .update({ request_id: id })
      .eq('id', booking_id)

    if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}