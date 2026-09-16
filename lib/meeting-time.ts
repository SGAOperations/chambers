/**
 * Resolving a booking's Meeting Time (issue #126).
 *
 * A booking has always been described by the window its room is reserved for --
 * start_time to end_time. That window is a fact about the reservation, not about
 * the meeting: a body that books 6:00-9:00 to allow for setup still tells its
 * members to turn up at 6:30. Meeting Time is that second number, stored
 * alongside the window rather than replacing it, so the reservation keeps saying
 * what CSC was told while every member-facing surface can say when to arrive.
 *
 * Kept in its own module because the precedence below has five callers across
 * My Rooms, the admin editors, both booking emails and the Slack reminder, and
 * an inheritance rule that is applied inconsistently is worse than one that is
 * wrong everywhere.
 */

/**
 * The value that actually applies, given each level from most specific to least.
 *
 * NULL at any level means inherit, exactly as it does for the room, status and
 * time overrides that weekly_room_occurrences already carries, so the first
 * level that is genuinely set wins. Callers pass their own chain:
 *
 *   weekly     resolveMeetingTime(occ.meeting_time, series.meeting_time, startTime)
 *   one-time   resolveMeetingTime(session.meeting_time, session.start_time)
 *   tabling    resolveMeetingTime(session.meeting_time, session.start_time)
 *
 * Ending the chain with the resolved start_time is what makes this safe to roll
 * out against a table full of rows that predate the column: a booking with no
 * meeting time set reads as meeting when its reservation begins, which is the
 * assumption every one of these surfaces made before Meeting Time existed.
 *
 * Variadic rather than a fixed (override, base, fallback) signature because the
 * chains are genuinely different lengths -- a one-time session has no series
 * above it to inherit from -- and padding the short ones with nulls would read
 * as though a level had been forgotten.
 *
 * The first overload says that a chain ending in a plain string cannot resolve
 * to null, so the callers that end theirs with a NOT NULL start_time get
 * `string` back rather than having to assert away a null that cannot happen.
 */
export function resolveMeetingTime(
  ...levels: [...(string | null | undefined)[], string]
): string
export function resolveMeetingTime(
  ...levels: (string | null | undefined)[]
): string | null
export function resolveMeetingTime(
  ...levels: (string | null | undefined)[]
): string | null {
  for (const level of levels) {
    // Empty string is treated as unset, not as a value. The editors normalise a
    // cleared field to null before it is written, but a blank that slips through
    // should inherit rather than render as an empty time.
    if (level != null && level !== '') return level
  }
  return null
}

/**
 * True when the meeting starts exactly when the reservation does.
 *
 * Postgres hands back `time` as 'HH:MM:SS' while the editors submit 'HH:MM', so
 * the two are compared at minute precision rather than as raw strings -- without
 * this, '18:30:00' and '18:30' read as a meeting time that differs from the
 * start time, and every surface that flags an unusual one would flag all of them.
 */
export function meetingTimeMatchesStart(
  meetingTime: string | null | undefined,
  startTime: string | null | undefined
): boolean {
  if (!meetingTime || !startTime) return true
  return meetingTime.slice(0, 5) === startTime.slice(0, 5)
}

/**
 * What to store for a meeting time whose inheritance chain falls straight
 * through to `startTime` -- a weekly series, or a one-time or tabling session.
 *
 * The editors show this field pre-filled with the start time rather than blank,
 * because "meets at 6, room held from 6" is the truth for most bookings and an
 * empty box invites someone to retype it. That means an untouched field submits
 * a value identical to the start time, and storing it would pin the meeting time
 * to a number the start time no longer has to agree with: move the reservation
 * to 7:00 later and the booking would still claim to meet at 6:00.
 *
 * Collapsing the two back to NULL keeps them tied together until somebody
 * genuinely separates them, and loses nothing -- NULL resolves to the start time,
 * so both forms render identically.
 *
 * Deliberately NOT for a weekly occurrence's override, where NULL means "inherit
 * the series" rather than "meet at the start time". Collapsing there would turn
 * a week that really does meet at its start time into a week that follows a
 * series meeting at some other one.
 */
export function meetingTimeForStorage(
  meetingTime: string | null | undefined,
  startTime: string | null | undefined
): string | null {
  if (!meetingTime) return null
  return meetingTimeMatchesStart(meetingTime, startTime) ? null : meetingTime
}
