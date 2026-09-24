/**
 * When a weekly room request may start (issue #163).
 *
 * A weekly room request books the same slot every week for a whole semester, and
 * CSC schedules those slots against a grid of half hours. A request to start at
 * 6:07 cannot be granted as asked -- it is rounded by hand at the other end,
 * which is the "chaos" the issue is named for -- so the form does not offer it
 * and the route does not accept it.
 *
 * Only the start is constrained, and only on weekly requests. A one-time room or
 * a tabling session is placed on its own and keeps the finer granularity, and a
 * weekly request's end time is left alone: the issue asks for the start, and an
 * end time is often dictated by when the room next has to be free.
 *
 * Deliberately free of server imports so the form and the route can share it,
 * which is what stops one accepting a time the other rejects.
 */

/** Minutes past the hour a weekly room request may start at. */
export const WEEKLY_START_MINUTES = [0, 30] as const

/** True when `time` ('HH:MM') is missing, malformed, or not on the half hour. */
export function invalidWeeklyStartTime(time: unknown): boolean {
  if (typeof time !== 'string') return true
  const match = /^(\d{2}):(\d{2})/.exec(time)
  if (!match) return true
  return !(WEEKLY_START_MINUTES as readonly number[]).includes(Number(match[2]))
}

/** The message a rejected start time gets, so the form and the route agree. */
export const WEEKLY_START_TIME_ERROR =
  'A weekly room request must start on the hour or the half hour.'
