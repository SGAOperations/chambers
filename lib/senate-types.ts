/**
 * Senate session types, and the one rule that decides whether a member wants to
 * hear about a session of a given type.
 *
 * The list was declared twice -- once in the Settings modal that writes the
 * preference, once in the My Rooms code that read it -- and the rule itself
 * existed only on the client, inside the My Rooms list filter. So deselecting
 * Office Hours hid those sessions from the page and did nothing else: update
 * emails and dashboard alerts still went to everyone on the Senate, including
 * the people who had said they did not want them (issues #92, #93).
 *
 * Both now live here, so the page, the emails and the alerts cannot drift apart.
 */

/**
 * Session types only exist on bookings owned by the body literally named
 * "Senate" -- that is what gates the Session Type field in the weekly editor,
 * and what the My Rooms filter has always keyed on.
 */
export const SENATE_BODY_NAME = 'Senate'

export const SENATE_TYPES = ['Full Body', 'Weekly', 'Office Hours'] as const

export type SenateType = (typeof SENATE_TYPES)[number]

/**
 * Whether this member wants to hear about one session.
 *
 * Defaults to yes at every step: a non-Senate booking, a Senate session with no
 * type set, or a type the member has never expressed an opinion about. A
 * preference has to be deselected explicitly to suppress anything, so a member
 * who has never opened Settings sees and hears about everything.
 */
export function wantsSenateSession(
  prefs: Record<string, boolean> | null | undefined,
  bodyName: string | null | undefined,
  senateType: string | null | undefined
): boolean {
  if (bodyName !== SENATE_BODY_NAME) return true
  if (!senateType) return true
  return prefs?.[senateType] ?? true
}

/**
 * The preferences of one address that several people route their emails to.
 *
 * A shared SGA inbox can be the destination for more than one leader (issue
 * #190), and those leaders need not follow the same session types. The inbox
 * gets the union of what they follow: suppressing a session somebody asked to
 * hear about is the worse failure, and it is the same bias wantsAnySenateSession
 * already takes. Merging also means the inbox lands in exactly one audience, so
 * it never receives two emails carrying the same event.
 *
 * Null on either side means "follows everything", which absorbs the other. A key
 * missing from one side is a yes there, by the same default wantsSenateSession
 * applies.
 */
export function mergeSenatePreferences(
  a: Record<string, boolean> | null | undefined,
  b: Record<string, boolean> | null | undefined
): Record<string, boolean> | null {
  if (!a || !b) return null
  const merged: Record<string, boolean> = {}
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    merged[key] = (a[key] ?? true) || (b[key] ?? true)
  }
  return merged
}

/**
 * Whether this member wants to hear about an edit that touched several sessions
 * at once.
 *
 * One wanted session is enough. Someone who reads Full Body but not Office Hours
 * still needs the email about a save that moved both, because the Full Body week
 * moved -- suppressing it would lose a session they asked to know about, which is
 * a worse failure than one line of Office Hours detail they did not.
 *
 * An empty list means the edit was not session-specific (the series moved), so
 * there is nothing to filter on and everyone hears about it.
 */
export function wantsAnySenateSession(
  prefs: Record<string, boolean> | null | undefined,
  bodyName: string | null | undefined,
  senateTypes: (string | null | undefined)[]
): boolean {
  if (bodyName !== SENATE_BODY_NAME) return true
  if (!senateTypes.length) return true
  return senateTypes.some(t => wantsSenateSession(prefs, bodyName, t))
}
