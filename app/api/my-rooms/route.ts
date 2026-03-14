import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get user's body memberships
  const { data: memberships } = await supabase
    .from('board_memberships')
    .select('body_id')
    .eq('user_id', user.id)

  if (!memberships || memberships.length === 0) {
    return NextResponse.json({ bookings: [] })
  }

  const bodyIds = memberships.map(m => m.body_id)

  // Fetch one-time room bookings
  const { data: oneTimeBookings } = await supabase
    .from('bookings')
    .select(`
      id, purpose, body_id,
      bodies(name),
      one_time_room_bookings(room_name, booking_date, start_time, end_time, status, reservation_code)
    `)
    .eq('type', 'One-Time Room')
    .in('body_id', bodyIds)

  // Fetch weekly room bookings with occurrences
  const { data: weeklyBookings } = await supabase
    .from('bookings')
    .select(`
      id, purpose, body_id,
      bodies(name),
      weekly_room_bookings(id, room_name, start_date, end_date, start_time, end_time, status, reservation_code,
        weekly_room_occurrences(id, occurrence_date, room_name, start_time, end_time, status, reservation_code)
      )
    `)
    .eq('type', 'Weekly Room')
    .in('body_id', bodyIds)

  // Fetch tabling bookings with sessions
  const { data: tablingBookings } = await supabase
    .from('bookings')
    .select(`
      id, purpose, body_id,
      bodies(name),
      tabling_bookings(id,
        tabling_sessions(id, location, session_date, start_time, end_time, status, reservation_code)
      )
    `)
    .eq('type', 'Tabling')
    .in('body_id', bodyIds)

  return NextResponse.json({
    oneTimeBookings: oneTimeBookings || [],
    weeklyBookings: weeklyBookings || [],
    tablingBookings: tablingBookings || [],
  })
}