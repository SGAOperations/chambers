import positionMap from '@/docs/sgauth/chambers-position-map.json'

/**
 * What an SGAuth position lets someone do in Chambers (issue #151).
 *
 * Under SGAUTH_ENABLED a person's admin office and IEMS access come from the
 * positions on their SGAuth session, read on every request, instead of from
 * users.admin_role / iems_role. They are translated back into the same office
 * names those columns hold, so the thirty-odd routes that check
 * `isManagementRole(user.app_metadata.admin_role)` and friends keep their
 * control flow unchanged -- the same reasoning as getAuthedUserWithLiveRoles().
 *
 * Which positions grant what is the approved mapping in
 * docs/sgauth/chambers-position-map.json (#153). Body seats are not here: they
 * live in body_position_roles, which Management edits on the Bodies tab
 * (lib/position-sync.ts).
 *
 * No server imports, so client code may use it too.
 */

/**
 * The Chambers office each admin position stands for, in precedence order: a
 * person holding more than one gets the first. Management offices come first,
 * then the booking tier, then view-only, so holding a second, lesser office
 * never narrows what someone may do.
 */
const ADMIN_OFFICES: readonly (readonly [key: string, office: string])[] = [
  ['vice-president-of-operational-affairs', 'Vice President of Operational Affairs'],
  ['executive-vice-president', 'Executive Vice President'],
  ['information-manager', 'Information Manager'],
  ['comptroller', 'Comptroller'],
  ['student-body-president', 'Student Body President'],
]

/**
 * The IEMS role each IEMS position stands for. `chambers-iems` is the product
 * role for IEMS access without either office; it has no office of its own, so
 * it gets IEMS access but not the IEMS email preferences, which belong to the
 * two offices (lib/email-preferences.ts).
 */
const IEMS_ROLES: readonly (readonly [key: string, role: string])[] = [
  ['vice-president-of-external-affairs', 'Vice President of External Affairs'],
  ['director-of-events', 'Director of Events'],
  ['chambers-iems', 'IEMS Access'],
]

/** Every admin position key the approved map grants a tier to. */
export const ADMIN_POSITION_KEYS: readonly string[] = [
  ...positionMap.adminTiers.management,
  ...positionMap.adminTiers.booking,
  ...positionMap.adminTiers.viewOnly,
]

/** Every position key the approved map grants IEMS access to. */
export const IEMS_POSITION_KEYS: readonly string[] = positionMap.iems

/**
 * The admin office a set of positions amounts to, as the users.admin_role
 * string, or null when they grant none.
 */
export function adminRoleFromPositions(keys: readonly string[]): string | null {
  const held = new Set(keys)
  for (const [key, office] of ADMIN_OFFICES) {
    if (ADMIN_POSITION_KEYS.includes(key) && held.has(key)) return office
  }
  return null
}

/** The IEMS role a set of positions amounts to, as the users.iems_role string, or null. */
export function iemsRoleFromPositions(keys: readonly string[]): string | null {
  const held = new Set(keys)
  for (const [key, role] of IEMS_ROLES) {
    if (IEMS_POSITION_KEYS.includes(key) && held.has(key)) return role
  }
  return null
}

/**
 * The position keys that make someone hold `office` (an admin_role or
 * iems_role string). For finding *other* people by office, through
 * users.sgauth_position_keys -- request alerts, event channels, the landing
 * page's Comptroller.
 */
export function positionKeysForOffice(office: string): string[] {
  return [...ADMIN_OFFICES, ...IEMS_ROLES].filter(([, name]) => name === office).map(([key]) => key)
}

/** True when `key` has the shape of an SGAuth position key, e.g. `vp-finance`. */
export function isPositionKey(key: unknown): key is string {
  return typeof key === 'string' && key.length <= 100 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(key)
}
