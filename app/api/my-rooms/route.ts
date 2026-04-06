import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  // Get user's body memberships and active semester in parallel
  const [{ data: memberships }, { data: activeSemester }] = await Promise.all([
    supabase
      .from('board_memberships')
      .select('body_id')
      .eq('user_id', user.id),
    supabase
      .from('semesters')
      .select('id')
      .eq('is_active', true)
      .single(),
  ])

  if (!memberships || memberships.length === 0) {
    return NextResponse.json({ bookings: [] })
  }

  const bodyIds = memberships.map(m => m.body_id)

  if (!activeSemester) {
    return NextResponse.json({ oneTimeBookings: [], weeklyBookings: [], tablingBookings: [] })
  }

  // Fetch all booking types in parallel
  const [{ data: oneTimeBookings }, { data: weeklyBookings }, { data: tablingBookings }] = await Promise.all([
    // Fetch one-time room bookings
    supabase
      .from('bookings')
      .select(`
        id, purpose, body_id,
        bodies(name),
        one_time_room_bookings(id, room_name, booking_date, start_time, end_time, status, reservation_code)
      `)
      .eq('type', 'One-Time Room')
      .eq('semester_id', activeSemester.id)
      .in('body_id', bodyIds),
    // Fetch weekly room bookings with occurrences
    supabase
      .from('bookings')
      .select(`
        id, purpose, body_id,
        bodies(name),
        weekly_room_bookings(id, room_name, start_date, end_date, start_time, end_time, status, reservation_code,
          weekly_room_occurrences(id, occurrence_date, room_name, start_time, end_time, status, reservation_code, senate_type)
        )
      `)
      .eq('type', 'Weekly Room')
      .eq('semester_id', activeSemester.id)
      .in('body_id', bodyIds),
    // Fetch tabling bookings with sessions
    supabase
      .from('bookings')
      .select(`
        id, purpose, body_id,
        bodies(name),
        tabling_bookings(id, reservation_code,
          tabling_sessions(id, location, session_date, start_time, end_time, status, reservation_code)
        )
      `)
      .eq('type', 'Tabling')
      .eq('semester_id', activeSemester.id)
      .in('body_id', bodyIds),
  ])

  return NextResponse.json({
    oneTimeBookings: oneTimeBookings || [],
    weeklyBookings: weeklyBookings || [],
    tablingBookings: tablingBookings || [],
  })
}