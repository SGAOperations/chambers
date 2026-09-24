/**
 * What a tabling request may ask for (issue #164).
 *
 * The bounds are checked in the request form and again in /api/request, and they
 * mirror the check constraint on tabling_request_sessions. Keeping them here is
 * what stops the form accepting a number the table will reject, or the route
 * rejecting one the form offered.
 *
 * Deliberately free of server imports so the client can use it too, following
 * lib/event-forms.ts.
 */

/**
 * Most tables one session may ask for. Well past the largest setup anyone runs,
 * while still catching a mistyped year or phone number in the field.
 */
export const MAX_TABLES = 20

/** Longest preferred location. Room for "Curry Crossroads, near the stairs". */
export const MAX_LOCATION = 200

export function invalidTableCount(tables: unknown): boolean {
  const n = typeof tables === 'number' ? tables : Number(tables)
  return !Number.isInteger(n) || n < 1 || n > MAX_TABLES
}

/** The message a rejected table count gets, so the form and the route agree. */
export const TABLES_ERROR =
  `Please say how many tables each session needs, as a whole number from 1 to ${MAX_TABLES}.`

/** Trimmed, or null when nothing was asked for. Over-long input is refused, not cut. */
export function cleanLocation(location: unknown): string | null | undefined {
  if (location == null || location === '') return null
  if (typeof location !== 'string') return undefined
  const trimmed = location.trim()
  if (!trimmed) return null
  return trimmed.length > MAX_LOCATION ? undefined : trimmed
}

export const LOCATION_ERROR = `A preferred location must be ${MAX_LOCATION} characters or fewer.`
