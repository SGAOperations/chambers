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
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { body_id, purpose, reservation_code, sessions } = await request.json()

  // Create parent booking
  const { data: booking, error: bookingError } = await adminSupabase
    .from('bookings')
    .insert({ body_id, purpose, type: 'Tabling', created_by: user.id })
    .select()
    .single()

  if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })

  // Create tabling booking
  const { data: tabling, error: tablingError } = await adminSupabase
    .from('tabling_bookings')
    .insert({ booking_id: booking.id, reservation_code: reservation_code || null })
    .select()
    .single()

  if (tablingError) return NextResponse.json({ error: tablingError.message }, { status: 500 })

  // Create sessions
  const sessionRows = sessions.map((s: {
    location: string
    session_date: string
    start_time: string
    end_time: string
    reservation_code: string
    status: string
  }) => ({
    tabling_booking_id: tabling.id,
    location: s.location,
    session_date: s.session_date,
    start_time: s.start_time,
    end_time: s.end_time,
    reservation_code: s.reservation_code || null,
    status: s.status,
  }))

  const { error: sessionError } = await adminSupabase
    .from('tabling_sessions')
    .insert(sessionRows)

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

interface Session {
  location: string
  session_date: string
  start_time: string
  end_time: string
  status: string
  reservation_code: string | null
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { booking_id, tabling_id, body_id, purpose, reservation_code, sessions } = await request.json()

  // Update parent booking
  const { error: bookingError } = await adminSupabase
    .from('bookings')
    .update({ body_id, purpose })
    .eq('id', booking_id)

  if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })

  // Update tabling booking
  const { error: tablingError } = await adminSupabase
    .from('tabling_bookings')
    .update({ reservation_code: reservation_code || null })
    .eq('id', tabling_id)

  if (tablingError) return NextResponse.json({ error: tablingError.message }, { status: 500 })

  // Delete all existing sessions and reinsert
  await adminSupabase
    .from('tabling_sessions')
    .delete()
    .eq('tabling_booking_id', tabling_id)

  const sessionRows = sessions.map((s: Session) => ({
    tabling_booking_id: tabling_id,
    location: s.location,
    session_date: s.session_date,
    start_time: s.start_time,
    end_time: s.end_time,
    status: s.status,
    reservation_code: s.reservation_code || null,
  }))

  const { error: sessionError } = await adminSupabase
    .from('tabling_sessions')
    .insert(sessionRows)

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 })

  return NextResponse.json({ success: true })
}