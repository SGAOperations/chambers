import { bostonWallClockNow } from './boston-time'

/**
 * The advance-notice rule for SGA Spaces, in one place (issue #94).
 *
 * The rule exists so that time is *claimed* a set number of hours before it is
 * used. It follows that the thing to check is the time an edit newly claims, not
 * whether the start moved: shortening a booking, pushing its start later,
 * renaming it or cancelling it outright all release time or leave it alone, and
 * none of them needs notice.
 *
 * The PATCH route used to reject any change to start_time that landed inside the
 * window, which meant a booking that had entered the window could not be
 * shortened, moved later, or given a different name -- and the calendar would
 * not even open it, so in practice it could not be touched at all.
 */

export interface BookingInterval {
  /** ISO instant. */
  start: string
  /** ISO instant. */
  end: string
}

/**
 * The earliest instant `next` claims that `prev` did not, or null when it claims
 * nothing new.
 *
 * `prev` is null for a booking being created, where everything is new.
 *
 * The three shapes that claim time:
 *
 *   start moved earlier      the new block runs from the new start
 *   end moved later          the new block runs from the *old* end -- which is
 *                            why extending a booking whose end is still outside
 *                            the window is fine
 *   moved clear of the old   the whole interval is new, so it runs from the new
 *   interval                 start; relocating to next week is not an extension
 */
export function earliestNewlyClaimed(
  next: BookingInterval,
  prev: BookingInterval | null
): string | null {
  if (!prev) return next.start

  const nextStart = Date.parse(next.start)
  const nextEnd = Date.parse(next.end)
  const prevStart = Date.parse(prev.start)
  const prevEnd = Date.parse(prev.end)

  if (nextStart < prevStart) return next.start
  if (nextEnd > prevEnd) return nextStart > prevEnd ? next.start : prev.end
  return null
}

/**
 * The error to reject this booking with, or null when it is allowed.
 *
 * Returning the message rather than a boolean keeps the wording next to the rule
 * it explains -- an edit and a creation fail for the same reason but need to be
 * told different things about what to do next.
 *
 * `now` defaults to Boston wall-clock now and NOT to Date.now(), which would be
 * wrong here in a way that is easy to miss: a space booking's start_time holds
 * Boston wall-clock digits with a Z on the end, so measuring it against a real
 * instant makes every booking look an offset earlier than it is. That is issue
 * #87, fixed in 1e3d894, and putting the default here rather than at each call
 * site is what keeps it fixed -- the browser is a caller too, and its clock is
 * in whatever zone the viewer is sitting in.
 */
export function advanceNoticeError(
  next: BookingInterval,
  prev: BookingInterval | null,
  minHours: number,
  now: number = bostonWallClockNow().getTime()
): string | null {
  if (minHours <= 0) return null

  const earliest = earliestNewlyClaimed(next, prev)
  if (earliest === null) return null

  if (Date.parse(earliest) >= now + minHours * 60 * 60 * 1000) return null

  const hours = `${minHours} hour${minHours === 1 ? '' : 's'}`

  return prev
    ? `Adding time to a booking needs at least ${hours} of notice. You can still shorten this booking, start it later, rename it, or cancel it.`
    : `Bookings must be made at least ${hours} in advance.`
}
