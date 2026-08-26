import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'
import { canManageScoped, loadScopeContext, type ScopedRow } from '@/lib/booking-scope'

interface BookingRow {
  id: string
  purpose: string
  body_id: string
  hidden: boolean
  scope: ScopedRow['scope']
  division: ScopedRow['division']
  bodies: { name: string } | null
  booking_bodies: { body_id: string; bodies: { name: string } | null }[] | null
}

const SELECT_BASE = 'id, purpose, body_id, hidden, scope, division, bodies(name), booking_bodies(body_id, bodies(name))'

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  // The scope context, the active semester and the Senate type preferences are all independent,
  // so fetch them at once.
  const [ctx, { data: activeSemester }, { data: profile }] = await Promise.all([
    loadScopeContext(supabase, user),
    supabase.from('semesters').select('id').eq('is_active', true).single(),
    supabase.from('users').select('senate_type_preferences').eq('id', user.id).single(),
  ])

  const senateTypePreferences = profile?.senate_type_preferences ?? {}

  if (ctx.bodyIds.length === 0 || !activeSemester) {
    return NextResponse.json({
      oneTimeBookings: [],
      weeklyBookings: [],
      tablingBookings: [],
      senateTypePreferences,
    })
  }

  // This page is deliberately "the bookings of the bodies I belong to", so it filters by
  // membership even for admins -- who would otherwise pass RLS for every booking in the system.
  //
  // A single `.in('body_id', ...)` can no longer express that: a booking also reaches this user if
  // it is divisional in one of their divisions, or multi and lists one of their bodies. PostgREST
  // has no subquery syntax, so those two paths are resolved to ids first and folded into one
  // `.or()`. Note `.in('division', ...)` is used rather than an inline `division.in.(...)` filter
  // string, because division values contain spaces and would need manual quoting.
  const [{ data: linked }, { data: divisional }] = await Promise.all([
    supabase.from('booking_bodies').select('booking_id').in('body_id', ctx.bodyIds),
    ctx.divisions.length
      ? supabase
          .from('bookings')
          .select('id')
          .eq('scope', 'divisional')
          .in('division', ctx.divisions)
          .eq('semester_id', activeSemester.id)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ])

  const extraIds = [
    ...new Set([
      ...(linked ?? []).map((r: { booking_id: string }) => r.booking_id),
      ...(divisional ?? []).map((r: { id: string }) => r.id),
    ]),
  ]

  // The `.or()` string embeds UUIDs into a GET URL. The semester filter keeps this bounded today;
  // if extraIds ever exceeds ~150, move this query to an RPC before it hits proxy URL limits.
  const orFilter = extraIds.length
    ? `body_id.in.(${ctx.bodyIds.join(',')}),id.in.(${extraIds.join(',')})`
    : null

  let oneTimeQ = supabase
    .from('bookings')
    .select(`
      ${SELECT_BASE},
      one_time_room_bookings(id, room_name, booking_date, start_time, end_time, status, reservation_code)
    `)
    .eq('type', 'One-Time Room')
    .eq('semester_id', activeSemester.id)
  oneTimeQ = orFilter ? oneTimeQ.or(orFilter) : oneTimeQ.in('body_id', ctx.bodyIds)

  let weeklyQ = supabase
    .from('bookings')
    .select(`
      ${SELECT_BASE},
      weekly_room_bookings(id, room_name, start_date, end_date, start_time, end_time, status, reservation_code,
        weekly_room_occurrences(id, occurrence_date, room_name, start_time, end_time, status, reservation_code, senate_type)
      )
    `)
    .eq('type', 'Weekly Room')
    .eq('semester_id', activeSemester.id)
  weeklyQ = orFilter ? weeklyQ.or(orFilter) : weeklyQ.in('body_id', ctx.bodyIds)

  let tablingQ = supabase
    .from('bookings')
    .select(`
      ${SELECT_BASE},
      tabling_bookings(id, reservation_code,
        tabling_sessions(id, location, session_date, start_time, end_time, status, reservation_code)
      )
    `)
    .eq('type', 'Tabling')
    .eq('semester_id', activeSemester.id)
  tablingQ = orFilter ? tablingQ.or(orFilter) : tablingQ.in('body_id', ctx.bodyIds)

  const [{ data: oneTimeBookings }, { data: weeklyBookings }, { data: tablingBookings }] =
    await Promise.all([oneTimeQ, weeklyQ, tablingQ])

  /**
   * Decorates each row with canManage, computed server-side across the full scope. The client used
   * to derive this from a flat leadershipBodyIds list, which only ever worked for single-body
   * bookings.
   *
   * Hidden bookings stay visible only to someone who can manage them.
   */
  const decorate = (rows: BookingRow[] | null) =>
    (rows ?? [])
      .map(b => ({
        ...b,
        canManage: canManageScoped(
          ctx,
          b,
          (b.booking_bodies ?? []).map(x => x.body_id)
        ),
      }))
      .filter(b => !b.hidden || b.canManage)

  return NextResponse.json({
    oneTimeBookings: decorate(oneTimeBookings as BookingRow[] | null),
    weeklyBookings: decorate(weeklyBookings as BookingRow[] | null),
    tablingBookings: decorate(tablingBookings as BookingRow[] | null),
    senateTypePreferences,
  })
}
