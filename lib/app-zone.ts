/**
 * The timezone every booking date is expressed in.
 *
 * `booking_date`, `occurrence_date` and `session_date` are all DATE columns --
 * no time, no offset. They mean a calendar day in Boston, because that is where
 * the rooms are. "Today" therefore has to mean Boston's today, not the server's
 * and not the viewer's: a student on co-op in California at 10pm PT is still
 * looking at Northeastern's schedule, and should see the same day their peers on
 * campus see.
 *
 * Pinning it also makes the value reproducible, which is what lets the My Rooms
 * page be server-rendered at all -- see todayInAppZone().
 *
 * Lives in lib/ rather than beside todayInAppZone() because the Slack reminder
 * job needs it too (issue #95), and a route reaching into app/(dashboard)/ for a
 * constant is the wrong direction of travel.
 *
 * Not to be confused with lib/boston-time.ts, which names the same zone for a
 * different job. This one is about DATE columns -- which calendar day a booking
 * falls on. That one is about SGA Spaces timestamps, which store Boston
 * wall-clock digits with a Z on the end and therefore need a "now" in the same
 * shape to compare against (issue #87). A booking date has no time of day to get
 * wrong; a space booking is nothing but one.
 */
export const APP_TIME_ZONE = 'America/New_York'

/**
 * Today's date in APP_TIME_ZONE, as 'YYYY-MM-DD'.
 *
 * Deliberately not `new Date()` + getFullYear()/getMonth()/getDate(), which read
 * the *runtime's* timezone: UTC inside a Vercel function, the viewer's zone in
 * the browser. Those disagree for the last few hours of every Eastern day -- at
 * 9pm EDT the server's clock has already rolled to tomorrow -- so a list filtered
 * on the server would not match the one React computed while hydrating, and the
 * server HTML would be thrown away and redrawn.
 *
 * Reading the UTC fields of `new Date()` has the same defect for the same
 * reason, and is how issue #177 got a whole day's worth of severity four hours
 * early every evening.
 *
 * 'en-CA' is the shortest route to ISO-ordered output from Intl.
 */
export function todayInAppZone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
