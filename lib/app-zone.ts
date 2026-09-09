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
 */
export const APP_TIME_ZONE = 'America/New_York'
