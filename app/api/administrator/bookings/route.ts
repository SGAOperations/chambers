import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'

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

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  // Only show bookings for the active semester
  const { data: activeSemester } = await supabase
    .from('semesters')
    .select('id, name')
    .eq('is_active', true)
    .single()

  if (!activeSemester) {
    return NextResponse.json({ oneTime: [], weekly: [], tabling: [], activeSemester: null })
  }

  const [{ data: oneTime }, { data: weekly }, { data: tabling }] = await Promise.all([
    supabase
      .from('bookings')
      .select(`
        id, purpose, body_id, is_event, hidden,
        bodies(name),
        creator_role,
        one_time_room_bookings(id, room_name, booking_date, start_time, end_time, status, reservation_code)
      `)
      .eq('type', 'One-Time Room')
      .eq('semester_id', activeSemester.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('bookings')
      .select(`
        id, purpose, body_id, is_event, hidden,
        bodies(name),
        creator_role,
        weekly_room_bookings(id, room_name, start_date, end_date, start_time, end_time, status, reservation_code,
          weekly_room_occurrences(id, occurrence_date, room_name, start_time, end_time, status, reservation_code, senate_type)
        )
      `)
      .eq('type', 'Weekly Room')
      .eq('semester_id', activeSemester.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('bookings')
      .select(`
        id, purpose, body_id, is_event, hidden,
        bodies(name),
        creator_role,
        tabling_bookings(id, reservation_code,
          tabling_sessions(id, location, session_date, start_time, end_time, status, reservation_code)
        )
      `)
      .eq('type', 'Tabling')
      .eq('semester_id', activeSemester.id)
      .order('created_at', { ascending: false }),
  ])

  return NextResponse.json({
    oneTime: oneTime || [],
    weekly: weekly || [],
    tabling: tabling || [],
    activeSemester,
  })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { id, is_event, hidden } = await request.json()

  const patch: Record<string, unknown> = {}
  if (is_event !== undefined) patch.is_event = is_event
  if (hidden !== undefined) patch.hidden = hidden

  const { error } = await adminSupabase
    .from('bookings')
    .update(patch)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}