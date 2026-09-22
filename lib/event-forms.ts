/**
 * Shared rules for the extra event tracking forms (issue #161).
 *
 * The same bounds apply in three places -- the Events tab's editor, the routes
 * behind it, and the saved-form catalog in Administrator > Advanced -- and they
 * mirror the check constraints on event_tracking_items and event_form_templates.
 * Keeping them here is what stops the form accepting something the table will
 * reject, or the API rejecting something the form allows.
 *
 * Deliberately free of server imports so the client can use it too.
 */

/** Longest form name. Long enough for "Pre-Contracting Approval Form". */
export const MAX_FORM_LABEL = 100

/**
 * Longest lead time, in days before the event -- about a year. A deadline
 * further out than the booking system itself plans is a typo, not a deadline.
 */
export const MAX_DUE_DAYS = 400

export function invalidFormLabel(label: unknown): boolean {
  return typeof label !== 'string' || !label.trim() || label.trim().length > MAX_FORM_LABEL
}

export function invalidDueDays(days: unknown): boolean {
  return !Number.isInteger(days) || (days as number) < 0 || (days as number) > MAX_DUE_DAYS
}

/** The message a rejected deadline gets, so both routes say the same thing. */
export const DUE_DAYS_ERROR = `A deadline must be a whole number of days from 0 to ${MAX_DUE_DAYS}.`

/** Postgres unique_violation, raised when two saved forms share a name. */
export const UNIQUE_VIOLATION = '23505'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
