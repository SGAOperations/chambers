/**
 * Telling which weeks of a repeating booking an edit actually moved.
 *
 * The weekly PATCH deletes and reinserts every occurrence on every save, so
 * "what changed" cannot be read off the write -- it has to be a comparison
 * against the rows that were there before.
 *
 * This used to be approximated as "the first week carrying any override", which
 * is a different question and usually a different week: an override set on week
 * 1 months ago is still an override today, so every later edit to the series was
 * reported against week 1, with an empty change list, because week 1 had not in
 * fact moved (issue #91).
 */

/**
 * The occurrence columns a PATCH can move. Everything but is_event is an
 * override, so null is a real value here and means "inherit".
 *
 * senate_type, hidden and is_event are compared even though the update email has
 * no row for them: they still say *which* week an administrator touched, which
 * is the question this module exists to answer.
 */
export const OCCURRENCE_FIELDS = [
  'room_name', 'start_time', 'end_time', 'status',
  'reservation_code', 'purpose', 'senate_type', 'hidden', 'is_event',
] as const

export type OccurrenceField = (typeof OCCURRENCE_FIELDS)[number]

/** Any row carrying the override columns -- a stored one or a freshly built one. */
export type OccurrenceRow = Partial<Record<OccurrenceField, unknown>>

/**
 * Normalises one override for comparison, so a value that only changed shape is
 * not read as a change: Postgres returns a time as '18:30:00' where the editor
 * submits '18:30', and a cleared text field arrives as '' where the stored row
 * holds null.
 */
export function normalizeOccurrenceValue(field: OccurrenceField, value: unknown): string | null {
  // is_event is the one column here that is not an override: an absent value
  // means "not an event" rather than "inherit", so null and false are the same
  // state and must not compare as a change. Without this, a week the series had
  // not previously covered looked edited the moment it was generated.
  if (field === 'is_event') return value === true ? 'true' : 'false'

  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const s = String(value).trim()
  if (!s) return null
  return field === 'start_time' || field === 'end_time' ? s.slice(0, 5) : s
}

/**
 * Whether this week's overrides differ from what was stored for it.
 *
 * `prev` is undefined for a date the series did not previously cover, which
 * compares as all-null -- so extending a series does not, by itself, mark the
 * new weeks as edited. That edit shows up as a change to the series' end date
 * instead, which is where a recipient would look for it.
 */
export function occurrenceMoved(
  prev: OccurrenceRow | undefined,
  next: OccurrenceRow
): boolean {
  return OCCURRENCE_FIELDS.some(
    f => normalizeOccurrenceValue(f, prev?.[f]) !== normalizeOccurrenceValue(f, next[f])
  )
}
