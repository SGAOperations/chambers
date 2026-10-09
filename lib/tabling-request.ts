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

/**
 * Required on every new tabling request (issue #226, follow-up).
 *
 * It started as a preference, optional the way Preferred Room is on a room
 * request. Auto-Request changed what it is for: the location now goes straight
 * into the email CSC reserves from, and "Not specified" in that email is a
 * question CSC has to send back before it can do anything. So it is asked up
 * front, in the form, in /api/request and in Slack alike.
 *
 * Not a NOT NULL on the column. Requests made before this have no honest value
 * to give it, and they are handled by missingTablingFields() instead: Auto-Request
 * sets them aside as incomplete rather than the database refusing to hold them.
 */
export const LOCATION_REQUIRED_ERROR = 'Please give a preferred location for each tabling session.'

/** What a tabling request carries, in the shape Auto-Request reads it. */
export interface TablingRequestFields {
  purpose: string | null
  requestedBy: string | null
  sessions: {
    session_date: string | null
    start_time: string | null
    end_time: string | null
    location: string | null
    tables: number | null
  }[]
}

function blank(v: string | null | undefined): boolean {
  return typeof v !== 'string' || v.trim().length === 0
}

/**
 * The fields a tabling request is missing, by the names the request form uses,
 * or an empty list when it is complete.
 *
 * "Every field" is every one the request form makes the requester fill in for
 * tabling: the purpose, and on each session the date, start and end time,
 * preferred location and number of tables -- plus a requester, since the person
 * who asked is who CSC's answer goes back to. The body is not checked because
 * the column is NOT NULL and cannot be missing. Additional Notes is optional in
 * the form and is not a gap when empty.
 *
 * A session missing a field makes the whole request incomplete, not just that
 * session: Auto-Request sends a request whole (see lib/pending-tabling-requests.ts).
 *
 * Pure and client-safe, like the rest of this file, so the rule can be read and
 * checked without a database.
 */
export function missingTablingFields(r: TablingRequestFields): string[] {
  const missing = new Set<string>()
  if (blank(r.purpose)) missing.add('Purpose')
  if (!r.requestedBy) missing.add('Requester')
  if (!r.sessions.length) missing.add('Sessions')
  for (const s of r.sessions) {
    if (blank(s.session_date)) missing.add('Date')
    if (blank(s.start_time)) missing.add('Start Time')
    if (blank(s.end_time)) missing.add('End Time')
    if (blank(s.location)) missing.add('Preferred Location')
    if (s.tables == null || invalidTableCount(s.tables)) missing.add('Number of Tables')
  }
  return [...missing]
}
