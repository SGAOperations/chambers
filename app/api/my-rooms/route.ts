import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const isAdmin = !!user.app_metadata?.is_admin

  // Get user's body memberships, active semester, and Senate type preferences in parallel
  const [{ data: memberships }, { data: activeSemester }, { data: profile }] = await Promise.all([
    supabase
      .from('board_memberships')
      .select('body_id, role')
      .eq('user_id', user.id),
    supabase
      .from('semesters')
      .select('id')
      .eq('is_active', true)
      .single(),
    supabase
      .from('users')
      .select('senate_type_preferences')
      .eq('id', user.id)
      .single(),
  ])

  const senateTypePreferences = profile?.senate_type_preferences ?? {}

  if (!memberships || memberships.length === 0) {
    return NextResponse.json({ bookings: [], leadershipBodyIds: [], senateTypePreferences })
  }

  const bodyIds = memberships.map(m => m.body_id)
  const leadershipBodyIds = new Set(
    memberships.filter(m => m.role === 'Leadership').map(m => m.body_id)
  )

  if (!activeSemester) {
    return NextResponse.json({
      oneTimeBookings: [],
      weeklyBookings: [],
      tablingBookings: [],
      leadershipBodyIds: [...leadershipBodyIds],
      senateTypePreferences,
    })
  }

  // Fetch all booking types in parallel
  const [{ data: oneTimeBookings }, { data: weeklyBookings }, { data: tablingBookings }] = await Promise.all([
    // Fetch one-time room bookings
    supabase
      .from('bookings')
      .select(`
        id, purpose, body_id, hidden,
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
        id, purpose, body_id, hidden,
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
        id, purpose, body_id, hidden,
        bodies(name),
        tabling_bookings(id, reservation_code,
          tabling_sessions(id, location, session_date, start_time, end_time, status, reservation_code)
        )
      `)
      .eq('type', 'Tabling')
      .eq('semester_id', activeSemester.id)
      .in('body_id', bodyIds),
  ])

  // Admins see everything; others are filtered out of hidden bookings unless they hold Leadership in that body
  const visible = isAdmin
    ? <T extends { hidden: boolean; body_id: string }>(rows: T[]) => rows
    : <T extends { hidden: boolean; body_id: string }>(rows: T[]) =>
        rows.filter(b => !b.hidden || leadershipBodyIds.has(b.body_id))

  return NextResponse.json({
    oneTimeBookings: visible(oneTimeBookings || []),
    weeklyBookings: visible(weeklyBookings || []),
    tablingBookings: visible(tablingBookings || []),
    // Returned so the client doesn't have to re-query board_memberships itself.
    leadershipBodyIds: [...leadershipBodyIds],
    senateTypePreferences,
  })
}