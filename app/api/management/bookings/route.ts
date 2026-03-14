import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: oneTime } = await supabase
    .from('bookings')
    .select(`
      id, purpose,
      bodies(name),
      one_time_room_bookings(room_name, booking_date, start_time, end_time, status, reservation_code)
    `)
    .eq('type', 'One-Time Room')
    .order('created_at', { ascending: false })

  const { data: weekly } = await supabase
    .from('bookings')
    .select(`
      id, purpose,
      bodies(name),
      weekly_room_bookings(room_name, start_date, end_date, start_time, end_time, status, reservation_code)
    `)
    .eq('type', 'Weekly Room')
    .order('created_at', { ascending: false })

  const { data: tabling } = await supabase
    .from('bookings')
    .select(`
      id, purpose,
      bodies(name),
      tabling_bookings(
        tabling_sessions(location, session_date, start_time, end_time, status, reservation_code)
      )
    `)
    .eq('type', 'Tabling')
    .order('created_at', { ascending: false })

  return NextResponse.json({
    oneTime: oneTime || [],
    weekly: weekly || [],
    tabling: tabling || [],
  })
}