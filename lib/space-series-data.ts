import type { Db } from './db/data-api'
import { hasLiveAdmin, type AuthedUser } from './auth-types'
import { DEFAULT_WEEKLY_HOURS, weekBoundsOf, type PlanInput } from './space-series'

/**
 * The reads a recurring SGA Space booking is checked against (issue #112),
 * gathered for lib/space-series.ts's planSeries to decide on. Expects a
 * service-role client, like every SGA Spaces route.
 */

/** The active semester's last day, or null when none is set. */
export async function loadActiveSemesterEnd(adminSupabase: Db): Promise<string | null> {
  const { data } = await adminSupabase
    .from('semesters')
    .select('end_date')
    .eq('is_active', true)
    .maybeSingle()
  return (data?.end_date as string | null | undefined) ?? null
}

/**
 * Everything planSeries needs besides the weeks themselves, for one space and
 * creator between two instants.
 *
 * The creator's own bookings are read from the Sunday before `from` to the
 * Sunday after `to`, so the first and last weeks' hours totals are complete.
 */
export async function loadPlanContext(
  adminSupabase: Db,
  opts: { spaceId: string; creatorId: string; from: string; to: string }
): Promise<Omit<PlanInput, 'weeks' | 'now'>> {
  const { weekStart } = weekBoundsOf(opts.from)
  const { weekEnd } = weekBoundsOf(opts.to)

  const [
    { data: spaceBookings },
    { data: blackouts },
    { data: creatorBookings },
    { data: override },
    { data: settings },
  ] = await Promise.all([
    adminSupabase.from('space_bookings').select('id, start_time, end_time')
      .eq('space_id', opts.spaceId).lt('start_time', opts.to).gt('end_time', opts.from),
    adminSupabase.from('space_blackouts').select('start_time, end_time')
      .or(`space_id.eq.${opts.spaceId},space_id.is.null`).lt('start_time', opts.to).gt('end_time', opts.from),
    adminSupabase.from('space_bookings').select('id, start_time, end_time')
      .eq('creator_id', opts.creatorId).lt('start_time', weekEnd).gt('end_time', weekStart),
    adminSupabase.from('space_weekly_limit_overrides').select('weekly_hours_limit')
      .eq('user_id', opts.creatorId).maybeSingle(),
    adminSupabase.from('app_settings').select('min_hours_advance_spaces').eq('id', 1).single(),
  ])

  return {
    spaceBookings: spaceBookings ?? [],
    blackouts: blackouts ?? [],
    creatorBookings: creatorBookings ?? [],
    limitHours: Number(override?.weekly_hours_limit ?? DEFAULT_WEEKLY_HOURS),
    minHoursAdvance: settings?.min_hours_advance_spaces ?? 24,
  }
}

/**
 * Admins and Leadership may book SGA Spaces -- the same gate as a one-off
 * booking. The admin half requires a live-verified role, per hasLiveAdmin.
 */
export async function canBookSpaces(
  adminSupabase: Db,
  user: AuthedUser
): Promise<boolean> {
  if (hasLiveAdmin(user)) return true
  const { data } = await adminSupabase
    .from('board_memberships')
    .select('id')
    .eq('user_id', user.id)
    .eq('role', 'Leadership')
    .limit(1)
  return !!data && data.length > 0
}
