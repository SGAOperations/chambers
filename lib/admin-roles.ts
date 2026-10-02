/**
 * The admin roles, and the subsets of them that count as "high access" and
 * "view only".
 *
 * Kept in a module of its own, with no imports, so a client component can pull
 * the list in without dragging the server-side Supabase helpers in
 * lib/authorization.ts along with it.
 */

export const ADMIN_ROLES = [
  'Executive Vice President',
  'Vice President of Operational Affairs',
  'Comptroller',
  'Digital Innovation Manager',
  'Information Manager',
  'Student Body President',
] as const

/**
 * The roles that may run the Management page -- users, bodies, the audit log,
 * the semester archive and the app-wide settings (issue #64).
 *
 * This is the same set that has always been allowed to grant and revoke roles,
 * which is the point: these four already decide who is an admin at all, so
 * everything else on that page is downstream of a power they hold anyway. The
 * Comptroller keeps full access to Bookings, which is the day-to-day work.
 */
export const MANAGEMENT_ROLES = [
  'Executive Vice President',
  'Vice President of Operational Affairs',
  'Digital Innovation Manager',
  'Information Manager',
]

/**
 * The roles that may *look* at the admin side and change nothing on it
 * (issue #217).
 *
 * Student Body President is the first of these, and the reason the tier exists.
 * The office needs to see what the organisation has booked without being
 * another pair of hands on the booking work -- so it gets the Bookings tab,
 * read only, and nothing else: no Requests, no Cancellations, no SGA Spaces, no
 * Management, no Events.
 *
 * This is a third tier rather than an absence of one. Until now `isAdmin` was
 * `!!admin_role` and every admin who was not a MANAGEMENT_ROLE had full write
 * access to Bookings, so "admin" and "may change bookings" were the same
 * sentence. They no longer are, and the endpoints are where that distinction
 * has to hold: see canWriteAdmin() below.
 */
export const VIEW_ONLY_ROLES = ['Student Body President']

/** True when `role` is one of MANAGEMENT_ROLES. Null-safe, so callers can pass a raw admin_role. */
export function isManagementRole(role: string | null | undefined): boolean {
  return !!role && MANAGEMENT_ROLES.includes(role)
}

/** True when `role` is one of VIEW_ONLY_ROLES. Null-safe, so callers can pass a raw admin_role. */
export function isViewOnlyRole(role: string | null | undefined): boolean {
  return !!role && VIEW_ONLY_ROLES.includes(role)
}

/**
 * True when `role` may do admin work rather than only read it.
 *
 * Phrased as the permission rather than its absence so a call site reads as
 * what it allows, and so a *new* view-only role is denied by being added to
 * VIEW_ONLY_ROLES in one place instead of by remembering every endpoint.
 *
 * Note this says nothing about being an admin at all -- a null role is not
 * view-only, so this returns true for it. Callers run it *after* the
 * `!user.app_metadata?.is_admin` check, in the same shape as isManagementRole().
 */
export function canWriteAdmin(role: string | null | undefined): boolean {
  return !isViewOnlyRole(role)
}
