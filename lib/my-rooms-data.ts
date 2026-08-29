import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthedUser } from '@/lib/auth'
import { getActiveSemesterId } from '@/lib/active-semester'
import { canManageScoped, loadScopeContext, type ScopedRow } from '@/lib/booking-scope'

/**
 * The My Rooms read, factored out of app/api/my-rooms/route.ts so it has two
 * callers:
 *
 *   - the /my-rooms server page, which calls it in-process while rendering the
 *     document, so the first paint needs no fetch at all;
 *   - the route itself, which the client still uses to refresh after a mutation.
 *
 * The route used to be the only way in, which meant first paint cost a full
 * browser -> Vercel -> Postgres round trip that could not even begin until the
 * page bundle had downloaded and hydrated.
 */

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

/**
 * The weekly shape, narrowed enough to reason about per-occurrence visibility.
 *
 * Only the fields the hidden filter touches are declared; the rest of the row is
 * passed through untouched, which is why this widens BookingRow rather than
 * replacing it.
 */
interface WeeklyBookingRow extends BookingRow {
  weekly_room_bookings?: {
    weekly_room_occurrences?: { hidden: boolean | null }[] | null
  }[] | null
}

export interface MyRoomsPayload {
  oneTimeBookings: unknown[]
  weeklyBookings: unknown[]
  tablingBookings: unknown[]
  senateTypePreferences: Record<string, boolean>
}

/** Thrown when one of the three booking queries fails, so callers can map it to their own error shape. */
export class MyRoomsQueryError extends Error {}

const SELECT_BASE = 'id, purpose, body_id, hidden, scope, division, bodies(name), booking_bodies(body_id, bodies(name))'

export async function fetchMyRooms(
  supabase: SupabaseClient,
  user: AuthedUser
): Promise<MyRoomsPayload> {
  // The scope context, the active semester and the Senate type preferences are all independent,
  // so fetch them at once.
  const [ctx, activeSemesterId, { data: profile }] = await Promise.all([
    loadScopeContext(supabase, user),
    getActiveSemesterId(supabase),
    supabase.from('users').select('senate_type_preferences').eq('id', user.id).single(),
  ])

  const senateTypePreferences = profile?.senate_type_preferences ?? {}

  if (ctx.bodyIds.length === 0 || !activeSemesterId) {
    return {
      oneTimeBookings: [],
      weeklyBookings: [],
      tablingBookings: [],
      senateTypePreferences,
    }
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
        weekly_room_occurrences(id, occurrence_date, room_name, start_time, end_time, status, reservation_code, senate_type, purpose, hidden, is_event)
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
    throw new MyRoomsQueryError(failed.error.message)
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

  /**
   * Drops occurrences the caller should not see (issue #55).
   *
   * A weekly occurrence can now override its booking's `hidden`, so visibility is
   * no longer a property of the booking alone: a visible series can hide one
   * week, and a hidden series can expose one. `occ.hidden ?? booking.hidden` is
   * the precedence -- NULL inherits.
   *
   * This runs here, server-side, and not in the client's flatten step. Filtering
   * on the client would mean sending a hidden occurrence to a browser that is not
   * allowed to see it and trusting the UI not to draw it, which is the shape of
   * the leak that issue #29 already had to be fixed once.
   */
  const stripHiddenOccurrences = (b: BookingRow & { canManage: boolean }) => {
    if (b.canManage) return b
    const weekly = (b as WeeklyBookingRow).weekly_room_bookings
    if (!weekly) return b
    return {
      ...b,
      weekly_room_bookings: weekly.map(w => ({
        ...w,
        weekly_room_occurrences: (w.weekly_room_occurrences ?? []).filter(
          occ => !(occ.hidden ?? b.hidden)
        ),
      })),
    }
  }

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
      .map(stripHiddenOccurrences)
      // Visibility is no longer decided by the booking alone. A manageable
      // booking always stays. Otherwise a weekly series survives if any of its
      // occurrences is visible -- which is what lets a single week of a hidden
      // series be published by setting `hidden = false` on it -- and it is
      // dropped once stripHiddenOccurrences has emptied it. One-time and tabling
      // bookings have no per-occurrence override, so they keep the original
      // booking-level rule.
      .filter(b => {
        if (b.canManage) return true
        const weekly = (b as WeeklyBookingRow).weekly_room_bookings
        if (!weekly) return !b.hidden
        return weekly.some(w => (w.weekly_room_occurrences ?? []).length > 0)
      })

  return {
    oneTimeBookings: decorate(oneTimeBookings as BookingRow[] | null),
    weeklyBookings: decorate(weeklyBookings as BookingRow[] | null),
    tablingBookings: decorate(tablingBookings as BookingRow[] | null),
    senateTypePreferences,
  }
}
