/**
 * The admin roles, and the subset of them that counts as "high access".
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
  'Digital Innovation Project Member',
  'Information Manager',
] as const

/**
 * The roles that may run the Management page -- users, bodies, the audit log,
 * the semester archive and the app-wide settings (issue #64).
 *
 * This is the same set that has always been allowed to grant and revoke roles,
 * which is the point: these four already decide who is an admin at all, so
 * everything else on that page is downstream of a power they hold anyway. The
 * remaining admin roles (Comptroller, Digital Innovation Project Member) keep
 * full access to Bookings, which is the day-to-day work.
 */
export const MANAGEMENT_ROLES = [
  'Executive Vice President',
  'Vice President of Operational Affairs',
  'Digital Innovation Manager',
  'Information Manager',
]

/** True when `role` is one of MANAGEMENT_ROLES. Null-safe, so callers can pass a raw admin_role. */
export function isManagementRole(role: string | null | undefined): boolean {
  return !!role && MANAGEMENT_ROLES.includes(role)
}
