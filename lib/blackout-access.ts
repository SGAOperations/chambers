import { hasLiveAdmin, type AuthedUser } from './auth-types'
import type { Db } from './db/data-api'
import { canWriteAdmin } from './admin-roles'
import { IEMS_BLACKOUT_SPACE_NAME } from './iems-blackouts'

/**
 * What the caller may do with SGA Spaces blackouts (issue #227).
 *
 * 'admin' is every blackout, in any one space or all of them at once -- what a
 * writing admin has always had. 'iems' is the Conference Room and nothing else,
 * with `spaceId` resolved from the spaces table so the routes compare ids rather
 * than names.
 */
export type BlackoutAccess =
  | { kind: 'admin' }
  | { kind: 'iems'; spaceId: string }

export type BlackoutAccessResult =
  | { access: BlackoutAccess }
  | { denied: 401 | 403; error: string }

/**
 * Decides which of the two the caller gets, or why they get neither.
 *
 * The admin tier is checked first so an admin who also holds an IEMS role keeps
 * every power they had rather than being narrowed to one room.
 *
 * IEMS is its own grant, separate from the admin tier, and is read the way the
 * Events gate reads it (app/(dashboard)/eventsguard.tsx): a view-only admin who
 * also holds an IEMS role gets the IEMS powers, because those were never the
 * admin tier's to withhold. A view-only admin without one is refused exactly as
 * before (#217).
 *
 * `user` must come from getAuthedUserWithLiveRoles(); one whose roles were not
 * read live is refused, the same fail-closed rule as hasLiveAdmin().
 */
export async function resolveBlackoutAccess(db: Db, user: AuthedUser): Promise<BlackoutAccessResult> {
  if (hasLiveAdmin(user) && canWriteAdmin(user.app_metadata?.admin_role)) {
    return { access: { kind: 'admin' } }
  }

  if (user.rolesVerifiedLive === true && user.app_metadata?.iems_role) {
    // Two rows asked for so a duplicate name fails closed instead of quietly
    // picking one: IEMS writing to the wrong room would cancel the wrong
    // people's bookings.
    const { data, error } = await db
      .from('spaces')
      .select('id')
      .eq('name', IEMS_BLACKOUT_SPACE_NAME)
      .limit(2)
    const rows = (data as { id: string }[] | null) ?? []
    if (error || rows.length !== 1) {
      console.error(
        `Could not resolve the ${IEMS_BLACKOUT_SPACE_NAME} for an IEMS blackout:`,
        error ?? `${rows.length} matching spaces`
      )
      return { denied: 403, error: `The ${IEMS_BLACKOUT_SPACE_NAME} could not be found.` }
    }
    return { access: { kind: 'iems', spaceId: rows[0].id } }
  }

  // Unchanged from before #227: not an admin at all is 401, a view-only admin 403.
  if (user.app_metadata?.is_admin) return { denied: 403, error: 'Forbidden' }
  return { denied: 401, error: 'Unauthorized' }
}

/**
 * Whether `access` may edit or delete this existing blackout.
 *
 * IEMS may change only the Conference Room blackouts they put there themselves.
 * Being able to create one does not make every Conference Room blackout theirs:
 * an admin's may be there for a reason IEMS does not know about, and removing it
 * would quietly reopen the room to the bookings it was keeping out. An
 * all-spaces blackout is never IEMS's, since it covers rooms they have no say in.
 */
export function canManageBlackout(
  access: BlackoutAccess,
  userId: string,
  blackout: { space_id: string | null; created_by: string | null },
): boolean {
  if (access.kind === 'admin') return true
  return blackout.space_id === access.spaceId && blackout.created_by === userId
}
