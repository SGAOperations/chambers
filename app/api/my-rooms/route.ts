import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'
import { getActiveSemesterId } from '@/lib/active-semester'
import { canManageScoped, loadScopeContext, type ScopedRow } from '@/lib/booking-scope'

// Edge: on the my-rooms first-paint path, measured cold-starting at ~1.05s on
// Node. All I/O here is fetch-based (Supabase REST, Upstash, JWKS). The response
// shaping is O(bookings x sessions) but bounded by the semester + future-date
// filters above; watch the preview deploy's function metrics and fall back to
// the Node runtime (delete this line) if CPU time trips.
export const runtime = 'edge'

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
  const [ctx, activeSemesterId, { data: profile }] = await Promise.all([
    loadScopeContext(supabase, user),
    getActiveSemesterId(supabase),
    supabase.from('users').select('senate_type_preferences').eq('id', user.id).single(),
  ])

  const senateTypePreferences = profile?.senate_type_preferences ?? {}

  if (ctx.bodyIds.length === 0 || !activeSemesterId) {
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
          .eq('semester_id', activeSemesterId)
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

  // The client only ever renders today-or-later sessions, but the query used to
  // return every occurrence for the whole semester -- a full semester of weekly
  // rows per booking, most of them already in the past -- and the client threw
  // them away after parsing. Filter the child tables to the future server-side
  // instead. The one-day lookback absorbs the UTC-vs-local date boundary (the
  // function runs in UTC); the client's own future-only pass still trims the
  // exact edge. Filtering an embedded resource keeps its parent row with a
  // narrowed child array -- a booking whose next session is far off still comes
  // back, just with no stale history attached.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  let oneTimeQ = supabase
    .from('bookings')
    .select(`
      ${SELECT_BASE},
      one_time_room_bookings(id, room_name, booking_date, start_time, end_time, status, reservation_code)
    `)
    .eq('type', 'One-Time Room')
    .eq('semester_id', activeSemesterId)
    .gte('one_time_room_bookings.booking_date', since)
  oneTimeQ = orFilter ? oneTimeQ.or(orFilter) : oneTimeQ.in('body_id', ctx.bodyIds)

  let weeklyQ = supabase
    .from('bookings')
    .select(`
      ${SELECT_BASE},
      weekly_room_bookings(id, room_name, start_time, end_time, status, reservation_code,
        weekly_room_occurrences(id, occurrence_date, room_name, start_time, end_time, status, reservation_code, senate_type)
      )
    `)
    .eq('type', 'Weekly Room')
    .eq('semester_id', activeSemesterId)
    .gte('weekly_room_bookings.weekly_room_occurrences.occurrence_date', since)
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
    .eq('semester_id', activeSemesterId)
    .gte('tabling_bookings.tabling_sessions.session_date', since)
  tablingQ = orFilter ? tablingQ.or(orFilter) : tablingQ.in('body_id', ctx.bodyIds)

  const [oneTimeRes, weeklyRes, tablingRes] = await Promise.all([oneTimeQ, weeklyQ, tablingQ])

  // Surface query failures instead of coercing them to an empty list. A malformed embed
  // (e.g. PGRST201, an ambiguous relationship) otherwise renders as a calm "no bookings
  // found", which is indistinguishable from genuinely having none.
  const failed = [oneTimeRes, weeklyRes, tablingRes].find(r => r.error)
  if (failed?.error) {
    console.error('my-rooms query failed:', failed.error)
    return NextResponse.json({ error: failed.error.message }, { status: 500 })
  }

  const { data: oneTimeBookings } = oneTimeRes
  const { data: weeklyBookings } = weeklyRes
  const { data: tablingBookings } = tablingRes

  /**
   * Decorates each row with canManage, computed server-side across the full scope. The client used
   * to derive this from a flat leadershipBodyIds list, which only ever worked for single-body
   * bookings.
   *
   * Hidden bookings stay visible only to someone who can manage them.
   *
   * canManage is evaluated as if the caller were not an admin. my-rooms is the member-facing list
   * -- it is already scoped to the bodies you belong to even for admins (see the .or() above), and
   * manage rights follow the same rule: an admin who merely sits on a booking's body is a plain
   * member here and acts from /administrator instead. Without this, a hidden multi-body booking
   * surfaced on the personal page of every admin on a linked body, tagged "Leadership" (issue #29).
   */
  const memberCtx = { ...ctx, isAdmin: false }

  const decorate = (rows: BookingRow[] | null) =>
    (rows ?? [])
      .map(b => ({
        ...b,
        canManage: canManageScoped(
          memberCtx,
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
