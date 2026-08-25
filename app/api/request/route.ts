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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const isAdmin = !!user.app_metadata?.is_admin

  // The settings row is independent of the bodies lookup, so fetch both at once
  // rather than gating the bodies query behind it.
  const [{ data: settings }, bodiesResult] = await Promise.all([
    supabase
      .from('app_settings')
      .select('min_days_advance_room, min_days_advance_tabling')
      .eq('id', 1)
      .maybeSingle(),
    isAdmin
      ? // Admins get every active body
        supabase
          .from('bodies')
          .select('id, name')
          .eq('is_active', true)
          .order('name', { ascending: true })
      : // Everyone else gets the bodies where they hold Leadership
        supabase
          .from('board_memberships')
          .select('body_id, bodies(id, name)')
          .eq('user_id', user.id)
          .eq('role', 'Leadership'),
  ])

  const minDaysRoom = settings?.min_days_advance_room ?? 0
  const minDaysTabling = settings?.min_days_advance_tabling ?? 0

  const bodies = isAdmin
    ? bodiesResult.data ?? []
    : ((bodiesResult.data ?? []) as { bodies: unknown }[])
        .map(m => m.bodies)
        .filter(Boolean)

  return NextResponse.json({ bodies, minDaysRoom, minDaysTabling })
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const body = await request.json()
  const { type, body_id, purpose, notes, details, sessions } = body

  // Verify user has Leadership role in the submitted body_id (skip for admins)
  if (!user.app_metadata?.is_admin) {
    const { data: membership } = await supabase
      .from('board_memberships')
      .select('id')
      .eq('user_id', user.id)
      .eq('body_id', body_id)
      .eq('role', 'Leadership')
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
  }

  // Fetch advance notice settings and validate dates
  const { data: settings } = await adminSupabase
    .from('app_settings')
    .select('min_days_advance_room, min_days_advance_tabling')
    .eq('id', 1)
    .maybeSingle()

  const minDaysRoom = settings?.min_days_advance_room ?? 0
  const minDaysTabling = settings?.min_days_advance_tabling ?? 0

  function getMinDateStr(days: number): string {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().split('T')[0]
  }

  if (type === 'One-Time Room' && minDaysRoom > 0) {
    const minDate = getMinDateStr(minDaysRoom)
    for (const s of sessions as { session_date: string }[]) {
      if (s.session_date < minDate) {
        return NextResponse.json(
          { error: `Room bookings require at least ${minDaysRoom} day${minDaysRoom === 1 ? '' : 's'} advance notice. Please select a date of ${minDate} or later.` },
          { status: 400 }
        )
      }
    }
  }

  if (type === 'Weekly Room' && minDaysRoom > 0) {
    const minDate = getMinDateStr(minDaysRoom)
    if (details.start_date < minDate) {
      return NextResponse.json(
        { error: `Room bookings require at least ${minDaysRoom} day${minDaysRoom === 1 ? '' : 's'} advance notice. Please select a start date of ${minDate} or later.` },
        { status: 400 }
      )
    }
  }

  if (type === 'Tabling' && minDaysTabling > 0) {
    const minDate = getMinDateStr(minDaysTabling)
    for (const s of sessions as { session_date: string }[]) {
      if (s.session_date < minDate) {
        return NextResponse.json(
          { error: `Tabling bookings require at least ${minDaysTabling} day${minDaysTabling === 1 ? '' : 's'} advance notice. Please select a date of ${minDate} or later.` },
          { status: 400 }
        )
      }
    }
  }

  // Create the request
  const { data: roomRequest, error: requestError } = await adminSupabase
    .from('room_requests')
    .insert({
      type,
      body_id,
      purpose,
      notes: notes || null,
      requested_by: user.id,
      status: 'Pending',
    })
    .select()
    .single()

  if (requestError) return NextResponse.json({ error: requestError.message }, { status: 500 })

  // Insert type-specific details
  if (type === 'One-Time Room') {
    const sessionRows = sessions.map((s: {
      session_date: string
      start_time: string
      end_time: string
      room_name: string
    }) => ({
      request_id: roomRequest.id,
      room_name: s.room_name || null,
      start_date: s.session_date,
      start_time: s.start_time,
      end_time: s.end_time,
      end_date: null,
    }))

    const { error: detailError } = await adminSupabase
      .from('room_request_details')
      .insert(sessionRows)

    if (detailError) return NextResponse.json({ error: detailError.message }, { status: 500 })
  }

  if (type === 'Weekly Room') {
    const { error: detailError } = await adminSupabase
      .from('room_request_details')
      .insert({
        request_id: roomRequest.id,
        room_name: details.room_name || null,
        start_date: details.start_date,
        start_time: details.start_time,
        end_time: details.end_time,
        end_date: details.end_date || null,
      })

    if (detailError) return NextResponse.json({ error: detailError.message }, { status: 500 })
  }

  if (type === 'Tabling') {
    const sessionRows = sessions.map((s: {
      session_date: string
      start_time: string
      end_time: string
    }) => ({
      request_id: roomRequest.id,
      session_date: s.session_date,
      start_time: s.start_time,
      end_time: s.end_time,
    }))

    const { error: sessionError } = await adminSupabase
      .from('tabling_request_sessions')
      .insert(sessionRows)

    if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}