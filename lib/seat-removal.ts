import { pool } from './db/pool'
import { appZoneParts } from './meeting-reminders'
import { calendarStateOf, occurrenceUid, sessionUid, type RoomSession } from './room-calendar'
import { wantsSenateSession } from './senate-types'
import { icsSequenceNow } from './emails/ics-core'
import { buildRoomSeriesCancelIcs, roomIcsAttachments } from './emails/room-ics'
import { sendSeatRemovedEmail, type CalendarAttachment } from './emails/seat-removed'
import type { RemovedSeat } from './position-sync'

/**
 * Takes a body's bookings off the calendar of someone who has left that body.
 *
 * Room bookings reach calendars as emailed invites, sent to whoever is on the
 * body at the time (lib/booking-scope.ts resolveBookingRecipients). Once SGA
 * positions decide who is on a body (lib/position-sync.ts), a person's seat can
 * go without anything happening to the booking -- they changed position -- and
 * they kept every invite they had, while later updates and cancellations went
 * only to the people still on it. Their calendar went quietly stale.
 *
 * The only way to take an emailed invite off a calendar is a cancellation for
 * its UID, so that is what this sends -- but to that one person, and worded as
 * what happened: they are no longer on the body. The booking is untouched and
 * nobody else hears anything.
 *
 * A booking comes off only if none of the person's remaining seats still
 * reaches it -- a multi-body booking shared with another of their bodies stays,
 * and so does a divisional one they still lead a body in. The reach rule is the
 * recipient rule, so nothing is cancelled that the person was never sent:
 * hidden bookings reach only Leadership, and a divisional booking reaches the
 * peer bodies only through their Leadership.
 *
 * Only upcoming sessions count. A booking whose sessions are all past is left
 * alone: there is nothing on the calendar it would be wrong about.
 */

/** A booking a removed seat took away, with what the person lost it through. */
interface LostBooking {
  user_id: string
  booking_id: string
  type: 'One-Time Room' | 'Weekly Room'
  purpose: string | null
  owner_name: string
  removed_bodies: string[]
}

/**
 * Every (user, booking) pair in the active semester that a removed seat
 * reached and no remaining seat does. `$1..$3` are the removed seats as
 * parallel arrays; the remaining ones are read from board_memberships, which
 * the sync has already rewritten.
 */
const LOST_BOOKINGS = `
  with removed as (
    select r.user_id, r.body_id, r.role, b.division, b.name
      from unnest($1::uuid[], $2::uuid[], $3::text[]) as r (user_id, body_id, role)
      join public.bodies b on b.id = r.body_id
  ), remaining as (
    select m.user_id, m.body_id, m.role, b.division
      from public.board_memberships m
      join public.bodies b on b.id = m.body_id
     where m.user_id in (select user_id from removed)
  ), candidates as (
    select bk.id, bk.body_id, bk.type, bk.purpose, bk.hidden, bk.scope, bk.division, ob.name as owner_name
      from public.bookings bk
      join public.bodies ob on ob.id = bk.body_id
     where bk.semester_id = (select id from public.semesters where is_active limit 1)
       and bk.type in ('One-Time Room', 'Weekly Room')
  )
  select r.user_id, c.id as booking_id, c.type, c.purpose, c.owner_name,
         array_agg(distinct r.name order by r.name) as removed_bodies
    from removed r
    join candidates c
      on (not c.hidden or r.role = 'Leadership')
     and (r.body_id = c.body_id
          or (c.scope = 'multi' and exists (
                select 1 from public.booking_bodies bb where bb.booking_id = c.id and bb.body_id = r.body_id))
          or (c.scope = 'divisional' and c.division = r.division and r.role = 'Leadership'))
   where not exists (
     select 1 from remaining s
      where s.user_id = r.user_id
        and (not c.hidden or s.role = 'Leadership')
        and (s.body_id = c.body_id
             or (c.scope = 'multi' and exists (
                   select 1 from public.booking_bodies bb where bb.booking_id = c.id and bb.body_id = s.body_id))
             or (c.scope = 'divisional' and c.division = s.division and s.role = 'Leadership')))
   group by r.user_id, c.id, c.type, c.purpose, c.owner_name
`

interface Person {
  id: string
  email: string
  is_active: boolean | null
  senate_type_preferences: Record<string, boolean> | null
  spaces_email_destination: string
}

/** A session still on someone's calendar: anything not already taken off. */
function onCalendar(status: string | null | undefined): boolean {
  return calendarStateOf(status) !== 'off'
}

/**
 * The cancellations for one booking, for one person: every upcoming one-time
 * session, or every weekly series with an upcoming week, that they follow.
 */
async function cancellationsFor(
  booking: LostBooking,
  person: Person,
  today: string,
  sequence: number
): Promise<{ attachments: CalendarAttachment[]; sessions: RoomSession[] } | null> {
  const follows = (senateType: string | null | undefined) =>
    wantsSenateSession(person.senate_type_preferences, booking.owner_name, senateType)

  if (booking.type === 'One-Time Room') {
    const { rows } = await pool.query<{
      id: string; booking_date: string; start_time: string; end_time: string; status: string | null; room_name: string
    }>(
      `select id, booking_date::text, start_time::text, end_time::text, status, room_name
         from public.one_time_room_bookings
        where booking_id = $1 and booking_date >= $2::date
        order by booking_date, start_time`,
      [booking.booking_id, today]
    )
    const sessions: RoomSession[] = rows
      .filter(r => onCalendar(r.status))
      .map(r => ({
        uid: sessionUid(r.id),
        date: r.booking_date,
        startTime: r.start_time,
        endTime: r.end_time,
        summary: summaryOf(booking),
        location: r.room_name,
        status: r.status ?? 'Reserved',
      }))
    if (!sessions.length) return null
    return { attachments: roomIcsAttachments({ request: [], cancel: sessions }, sequence), sessions }
  }

  // A week of a series is an occurrence of one recurring event (issue #184), so
  // the series is cancelled whole, by its UID, once any week of it is still
  // ahead. The person is off the body; no week of it belongs on their calendar.
  const { rows } = await pool.query<{
    series_id: string; occurrence_id: string; occurrence_date: string
    start_time: string; end_time: string; room_name: string; status: string | null; senate_type: string | null
  }>(
    `select w.id as series_id, o.id as occurrence_id, o.occurrence_date::text,
            coalesce(o.start_time, w.start_time)::text as start_time,
            coalesce(o.end_time, w.end_time)::text as end_time,
            coalesce(o.room_name, w.room_name) as room_name,
            coalesce(o.status, w.status) as status, o.senate_type
       from public.weekly_room_bookings w
       join public.weekly_room_occurrences o on o.weekly_booking_id = w.id
      where w.booking_id = $1 and o.occurrence_date >= $2::date
      order by o.occurrence_date`,
    [booking.booking_id, today]
  )
  const weeks = rows.filter(r => onCalendar(r.status) && follows(r.senate_type))
  if (!weeks.length) return null

  const series = [...new Set(weeks.map(w => w.series_id))]
  const sessions: RoomSession[] = weeks.map(w => ({
    uid: occurrenceUid(w.occurrence_id),
    date: w.occurrence_date,
    startTime: w.start_time,
    endTime: w.end_time,
    summary: summaryOf(booking),
    location: w.room_name,
    status: w.status ?? 'Reserved',
    senateType: w.senate_type,
  }))
  return {
    attachments: series.map(id => ({
      filename: series.length > 1 ? `cancel-${id}.ics` : 'cancel.ics',
      content: buildRoomSeriesCancelIcs(id, sequence),
      contentType: 'text/calendar; method=CANCEL',
    })),
    sessions,
  }
}

function summaryOf(booking: LostBooking): string {
  const purpose = booking.purpose?.trim()
  return purpose ? `${purpose} (${booking.owner_name})` : `${booking.owner_name} booking`
}

/**
 * The address their booking emails reached, so the cancellation lands where
 * the invite did. Someone who sent their invites only to a shared SGA inbox
 * gets nothing: that inbox belongs to the body, and its next leader still
 * wants the events in it.
 */
function personalAddress(person: Person): string | null {
  if (!person.email || person.is_active === false) return null
  if (person.spaces_email_destination === 'sga') return null
  return person.email
}

/** Which bookings `seats` take away from their holders, for a dry run. */
export async function findLostBookings(
  seats: RemovedSeat[]
): Promise<{ userId: string; bookingId: string; summary: string; removedBodies: string[] }[]> {
  if (!seats.length) return []
  const { rows } = await pool.query<LostBooking>(LOST_BOOKINGS, [
    seats.map(s => s.userId),
    seats.map(s => s.bodyId),
    seats.map(s => s.role),
  ])
  return rows.map(r => ({
    userId: r.user_id,
    bookingId: r.booking_id,
    summary: summaryOf(r),
    removedBodies: r.removed_bodies,
  }))
}

/**
 * Sends each person one email per booking they lost, each carrying that
 * booking's cancellations. One per booking rather than one in all, because
 * Outlook only acts on the first calendar attachment of an email.
 *
 * Failures are logged per booking and never thrown: this runs after a sign-in
 * or a map change has already succeeded, and a calendar left stale is better
 * than either of those failing.
 */
export async function notifyRemovedSeats(
  seats: RemovedSeat[],
  opts: { today?: string } = {}
): Promise<void> {
  if (!seats.length) return
  const today = opts.today ?? appZoneParts().date

  try {
    const { rows: lost } = await pool.query<LostBooking>(LOST_BOOKINGS, [
      seats.map(s => s.userId),
      seats.map(s => s.bodyId),
      seats.map(s => s.role),
    ])
    if (!lost.length) return

    const { rows: people } = await pool.query<Person>(
      `select id, email, is_active, senate_type_preferences, spaces_email_destination
         from public.users where id = any($1::uuid[])`,
      [[...new Set(lost.map(l => l.user_id))]]
    )
    const byId = new Map(people.map(p => [p.id, p]))

    for (const booking of lost) {
      const person = byId.get(booking.user_id)
      const to = person && personalAddress(person)
      if (!person || !to) continue
      try {
        const cancellation = await cancellationsFor(booking, person, today, icsSequenceNow())
        if (!cancellation) continue
        await sendSeatRemovedEmail({
          to,
          removedBodies: booking.removed_bodies,
          summary: summaryOf(booking),
          sessions: cancellation.sessions,
          attachments: cancellation.attachments,
        })
      } catch (e) {
        console.error('seat-removal: could not take a booking off a calendar', {
          userId: booking.user_id,
          bookingId: booking.booking_id,
          error: e instanceof Error ? e.message : 'unknown',
        })
      }
    }
  } catch (e) {
    console.error('seat-removal: could not work out what to take off calendars', {
      error: e instanceof Error ? e.message : 'unknown',
    })
  }
}
