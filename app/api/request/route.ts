import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { DIVISIONS, loadScopeContext, validateScopeSelection } from '@/lib/booking-scope'
import { OPS_REVIEW } from '@/lib/request-status'
import {
  LOCATION_ERROR,
  TABLES_ERROR,
  cleanLocation,
  invalidTableCount,
} from '@/lib/tabling-request'

const adminSupabase = db

export async function GET() {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const isAdmin = !!user.app_metadata?.is_admin

  // The settings row is independent of the bodies lookup, so fetch both at once
  // rather than gating the bodies query behind it.
  //
  // `allBodies` is the pool for a multi-body request -- any leadership may request a multi-body
  // booking with any combination, so everyone gets the full active list. That leaks nothing:
  // bodies_select_authenticated is already USING (true) for any authenticated user.
  const [{ data: settings }, bodiesResult, { data: allBodies }] = await Promise.all([
    supabase
      .from('app_settings')
      .select('min_days_advance_room, min_days_advance_tabling')
      .eq('id', 1)
      .maybeSingle(),
    isAdmin
      ? // Admins get every active body
        supabase
          .from('bodies')
          .select('id, name, division')
          .eq('is_active', true)
          .order('name', { ascending: true })
      : // Everyone else gets the bodies where they hold Leadership
        supabase
          .from('board_memberships')
          .select('body_id, bodies(id, name, division)')
          .eq('user_id', user.id)
          .eq('role', 'Leadership'),
    supabase
      .from('bodies')
      .select('id, name, division')
      .eq('is_active', true)
      .order('name', { ascending: true }),
  ])

  const minDaysRoom = settings?.min_days_advance_room ?? 0
  const minDaysTabling = settings?.min_days_advance_tabling ?? 0

  const bodies = isAdmin
    ? bodiesResult.data ?? []
    : ((bodiesResult.data ?? []) as { bodies: unknown }[])
        .map(m => m.bodies)
        .filter(Boolean)

  // Leadership may only request a divisional booking for a division they actually lead.
  const ctx = await loadScopeContext(supabase, user)
  const leadershipDivisions = isAdmin ? [...DIVISIONS] : ctx.leadershipDivisions

  return NextResponse.json({
    bodies,
    allBodies: allBodies ?? [],
    leadershipDivisions,
    minDaysRoom,
    minDaysTabling,
  })
}

export async function POST(request: Request) {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const body = await request.json()
  const { type, body_id, purpose, notes, details, sessions, scope, division, body_ids, capacity } = body

  // Verifies Leadership on the originating body, and -- for a divisional request -- that the user
  // actually leads that division. Any leadership may request a multi-body booking with any
  // combination of bodies, so there is no restriction on the non-owning bodies.
  const ctx = await loadScopeContext(supabase, user)
  const { data: activeBodies } = await adminSupabase
    .from('bodies')
    .select('id')
    .eq('is_active', true)
  const validBodyIds = (activeBodies ?? []).map((b: { id: string }) => b.id)

  const selection = validateScopeSelection(
    ctx, { scope, body_id, division, body_ids }, validBodyIds
  )
  if (!selection.ok) return NextResponse.json({ error: selection.error }, { status: 403 })

  // Expected attendance. Validated here and not only in the browser: the form is
  // the only caller today, but this is what actually writes the column, and a
  // room request without a headcount cannot be actioned (issue #76).
  //
  // Required for rooms, refused for tabling -- a table has no capacity to fit,
  // and accepting one would put a number in the column that means nothing.
  const needsCapacity = type === 'One-Time Room' || type === 'Weekly Room'
  let capacityValue: number | null = null

  if (needsCapacity) {
    const n = typeof capacity === 'number' ? capacity : Number(capacity)
    if (!Number.isInteger(n) || n < 1 || n > 10000) {
      return NextResponse.json(
        { error: 'Expected attendance is required, as a whole number of people.' },
        { status: 400 }
      )
    }
    capacityValue = n
  }

  /**
   * Where the body wants to table and how many tables it needs (issue #164).
   *
   * Resolved before anything is written, so a bad number cannot leave a request
   * row behind with no sessions under it. The table count is required here --
   * Operational Affairs has to reserve a specific number and was previously
   * guessing -- while the location stays optional, being a preference in the
   * same sense as a room request's preferred room.
   *
   * The Slack quick-request flow writes its own row and asks for neither, which
   * is why the columns are nullable rather than NOT NULL.
   */
  const tablingSessions: {
    session_date: string
    start_time: string
    end_time: string
    location: string | null
    tables: number
  }[] = []

  if (type === 'Tabling') {
    for (const s of (sessions ?? []) as { session_date: string; start_time: string; end_time: string; location?: unknown; tables?: unknown }[]) {
      if (invalidTableCount(s.tables)) {
        return NextResponse.json({ error: TABLES_ERROR }, { status: 400 })
      }
      const location = cleanLocation(s.location)
      if (location === undefined) {
        return NextResponse.json({ error: LOCATION_ERROR }, { status: 400 })
      }
      tablingSessions.push({
        session_date: s.session_date,
        start_time: s.start_time,
        end_time: s.end_time,
        location,
        tables: Number(s.tables),
      })
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
      body_id: selection.value.body_id,
      scope: selection.value.scope,
      division: selection.value.division,
      purpose,
      capacity: capacityValue,
      notes: notes || null,
      requested_by: user.id,
      status: OPS_REVIEW,
    })
    .select()
    .single()

  if (requestError) return NextResponse.json({ error: requestError.message }, { status: 500 })

  if (selection.value.scope === 'multi') {
    const { error: bodiesError } = await adminSupabase
      .from('room_request_bodies')
      .insert(selection.value.body_ids.map(bid => ({ request_id: roomRequest.id, body_id: bid })))

    if (bodiesError) return NextResponse.json({ error: bodiesError.message }, { status: 500 })
  }

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
    const sessionRows = tablingSessions.map(s => ({
      request_id: roomRequest.id,
      session_date: s.session_date,
      start_time: s.start_time,
      end_time: s.end_time,
      location: s.location,
      tables: s.tables,
    }))

    const { error: sessionError } = await adminSupabase
      .from('tabling_request_sessions')
      .insert(sessionRows)

    if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}