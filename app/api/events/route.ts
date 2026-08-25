import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user || (!user.app_metadata?.is_admin && !user.app_metadata?.iems_role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { data: activeSemester } = await supabase
    .from('semesters')
    .select('id')
    .eq('is_active', true)
    .single()

  if (!activeSemester) return NextResponse.json({ bookings: [] })

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(`
      id, purpose, type, created_at,
      bodies(name),
      users!bookings_created_by_fkey(full_name),
      one_time_room_bookings(room_name, booking_date, start_time, end_time),
      weekly_room_bookings(room_name, start_date, end_date, start_time, end_time),
      tabling_bookings(
        tabling_sessions(location, session_date, start_time, end_time)
      ),
      event_tracking(event_management_form, engage_form)
    `)
    .eq('is_event', true)
    .eq('semester_id', activeSemester.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ bookings: bookings || [] })
}
