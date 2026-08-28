import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { searchParams } = new URL(request.url)
  const all = searchParams.get('all') === 'true'

  const { data: activeSemester } = await supabase
    .from('semesters')
    .select('id, name')
    .eq('is_active', true)
    .single()

  if (!all && !activeSemester) {
    return NextResponse.json({ oneTime: [], weekly: [], tabling: [], activeSemester: null })
  }

  const semesterId = (!all && activeSemester) ? activeSemester.id : null

  let oneTimeQ = supabase
    .from('bookings')
    .select(`
      id, purpose, body_id, is_event, hidden, scope, division,
      bodies(name),
      booking_bodies(body_id, bodies(name)),
      creator_role,
      one_time_room_bookings(id, room_name, booking_date, start_time, end_time, status, reservation_code)
    `)
    .eq('type', 'One-Time Room')
    .order('created_at', { ascending: false })
  if (semesterId) oneTimeQ = oneTimeQ.eq('semester_id', semesterId)

  let weeklyQ = supabase
    .from('bookings')
    .select(`
      id, purpose, body_id, is_event, hidden, scope, division,
      bodies(name),
      booking_bodies(body_id, bodies(name)),
      creator_role,
      weekly_room_bookings(id, room_name, start_date, end_date, start_time, end_time, status, reservation_code,
        weekly_room_occurrences(id, occurrence_date, room_name, start_time, end_time, status, reservation_code, senate_type)
      )
    `)
    .eq('type', 'Weekly Room')
    .order('created_at', { ascending: false })
  if (semesterId) weeklyQ = weeklyQ.eq('semester_id', semesterId)

  let tablingQ = supabase
    .from('bookings')
    .select(`
      id, purpose, body_id, is_event, hidden, scope, division,
      bodies(name),
      booking_bodies(body_id, bodies(name)),
      creator_role,
      tabling_bookings(id, reservation_code,
        tabling_sessions(id, location, session_date, start_time, end_time, status, reservation_code)
      )
    `)
    .eq('type', 'Tabling')
    .order('created_at', { ascending: false })
  if (semesterId) tablingQ = tablingQ.eq('semester_id', semesterId)

  const [oneTimeRes, weeklyRes, tablingRes] = await Promise.all([
    oneTimeQ, weeklyQ, tablingQ,
  ])

  // Surface query failures instead of coercing them to an empty list. A malformed embed
  // (e.g. PGRST201, an ambiguous relationship) otherwise renders as a calm "no bookings
  // found", which is indistinguishable from genuinely having none.
  const failed = [oneTimeRes, weeklyRes, tablingRes].find(r => r.error)
  if (failed?.error) {
    console.error('administrator/bookings query failed:', failed.error)
    return NextResponse.json({ error: failed.error.message }, { status: 500 })
  }

  const { data: oneTime } = oneTimeRes
  const { data: weekly } = weeklyRes
  const { data: tabling } = tablingRes

  return NextResponse.json({
    oneTime: oneTime || [],
    weekly: weekly || [],
    tabling: tabling || [],
    activeSemester: activeSemester ?? null,
  })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
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