import { db } from './db/data-api'
import { appZoneParts } from './meeting-reminders'
import { resolveBookingRecipients, type Recipient, type ScopedRow } from './booking-scope'
import { calendarRecipientsFor, calendarStateOf, occurrenceUid, sessionUid, splitByAudience, type RoomSeries, type RoomSession } from './room-calendar'
import { sendBookingCancelledEmail } from './emails/booking-cancelled'

/**
 * Turning room bookings into the calendar sessions an invite is built from, and
 * the one cancellation path that three routes share (issue #69).
 *
 * The shapes here are the booking tables': a date and two clock times, with an
 * occurrence's null columns meaning "inherit from the series". Resolving that
 * inheritance is what makes a calendar event say the room a week is actually in
 * rather than the one its series started in.
 */

const adminSupabase = db

/** Today's date in the zone the booking tables count in. */
export function appToday(): string {
  return appZoneParts().date
}

/** A meeting that moved online keeps its place on the calendar, without a room. */
export function locationOf(status: string | null | undefined, roomOrTable: string | null | undefined): string {
  if (status === 'Virtual') return 'Virtual'
  return roomOrTable || 'Room to be confirmed'
}

/** What a calendar event is called: the purpose, falling back to whose booking it is. */
export function summaryOf(purpose: string | null | undefined, bodyName: string): string {
  const trimmed = purpose?.trim()
  return trimmed ? `${trimmed} (${bodyName})` : `${bodyName} booking`
}

/** The series' values, for resolving an occurrence's null columns. */
export interface WeeklyDefaults {
  room_name: string | null
  start_time: string
  end_time: string
  status: string
  purpose: string | null
}

export interface OccurrenceRow {
  id: string
  occurrence_date: string
  room_name: string | null
  start_time: string | null
  end_time: string | null
  status: string | null
  senate_type: string | null
  purpose: string | null
}

/**
 * One calendar session per week, with each override resolved against the series.
 * A null column means inherit, so these are the values the week actually has.
 */
export function weeklyRoomSessions(
  occurrences: OccurrenceRow[],
  series: WeeklyDefaults,
  bodyName: string
): RoomSession[] {
  return occurrences.map(o => {
    const status = o.status ?? series.status
    return {
      uid: occurrenceUid(o.id),
      date: o.occurrence_date,
      startTime: o.start_time ?? series.start_time,
      endTime: o.end_time ?? series.end_time,
      summary: summaryOf(o.purpose ?? series.purpose, bodyName),
      location: locationOf(status, o.room_name ?? series.room_name),
      status,
      senateType: o.senate_type,
    }
  })
}

/**
 * The weekly pattern a series' invite is sent as, so its weeks reach a calendar
 * as one recurring event rather than one event per week (issue #184).
 *
 * `sessions` is the series in full, past weeks included: meetingDates spans the
 * whole run, and a past week left out of it would be EXDATEd off calendars that
 * already hold it. A week only drops out for having stopped being a meeting
 * ('off'); Pending Cancellation stays, since that request has not been decided.
 */
export function weeklyRoomSeries(
  weeklyBookingId: string,
  series: WeeklyDefaults & { start_date: string; end_date: string },
  sessions: RoomSession[],
  bodyName: string
): RoomSeries {
  return {
    id: weeklyBookingId,
    startDate: series.start_date,
    endDate: series.end_date,
    startTime: series.start_time,
    endTime: series.end_time,
    summary: summaryOf(series.purpose, bodyName),
    location: locationOf(series.status, series.room_name),
    status: series.status,
    meetingDates: sessions
      .filter(s => calendarStateOf(s.status) !== 'off')
      .map(s => ({ date: s.date, senateType: s.senateType, session: s })),
  }
}

export interface OneTimeRow {
  id: string
  booking_date: string
  start_time: string
  end_time: string
  status: string
  room_name: string | null
}

/** One calendar session per dated session of a one-time booking. */
export function oneTimeRoomSessions(
  rows: OneTimeRow[],
  purpose: string | null,
  bodyName: string
): RoomSession[] {
  return rows.map(r => ({
    uid: sessionUid(r.id),
    date: r.booking_date,
    startTime: r.start_time,
    endTime: r.end_time,
    summary: summaryOf(purpose, bodyName),
    location: locationOf(r.status, r.room_name),
    status: r.status,
  }))
}

/**
 * Sends one email per audience, so a Senate member who follows only Full Body
 * gets only those sessions on their calendar. For every other body this is a
 * single email, since everyone wants every session.
 *
 * A recipient can have more than one address -- personal and a shared SGA inbox
 * (issue #190) -- so calendarRecipientsFor flattens and deduplicates them first.
 */
export async function sendPerAudience(
  recipients: Recipient[],
  plan: { request: RoomSession[]; cancel: RoomSession[] },
  ownerBodyName: string | null | undefined,
  send: (audience: { recipients: string[]; plan: { request: RoomSession[]; cancel: RoomSession[] } }) => Promise<void>
): Promise<void> {
  const audiences = splitByAudience(calendarRecipientsFor(recipients), plan, ownerBodyName)
  for (const audience of audiences) await send(audience)
}

/** One reservation that a cancellation acted on, as both callers already have it. */
export interface CancelledReservation {
  source: 'one_time' | 'occurrence' | 'tabling_session'
  id: string
  bookingId: string
  resultingStatus: 'Cancelled' | 'Virtual'
  date: string
  startTime: string
  endTime: string
  roomOrTable: string
}

interface BookingRow {
  id: string
  body_id: string
  scope: ScopedRow['scope']
  division: string | null
  purpose: string | null
  bodies: { name: string } | { name: string }[] | null
}

/**
 * Tells a body that reservations were cancelled, and takes them off calendars.
 *
 * Shared by Auto-Cancel, by marking a cancellation request Done, and by the
 * admin Cancel button -- the three paths that changed a status and told the body
 * nothing, so a cancelled meeting sat on every calendar it had reached.
 *
 * Tabling has no calendar invites, so its rows are ignored here rather than
 * sending a body an email about an event they were never sent.
 */
export async function notifyCancelledReservations(rows: CancelledReservation[]): Promise<void> {
  const roomRows = rows.filter(r => r.source !== 'tabling_session')
  if (!roomRows.length) return

  const today = appToday()

  // Session types decide who each cancelled week is sent to, and they live on
  // the occurrence rather than on the line the caller holds.
  //
  // The series comes back with them because a week of a series is an occurrence
  // of one recurring event rather than an event of its own (issue #184): taking
  // it off a calendar means naming the series and the slot, which is the
  // series' id and its pattern start time.
  const occurrenceIds = roomRows.filter(r => r.source === 'occurrence').map(r => r.id)
  const senateTypes = new Map<string, string | null>()
  const seriesRefs = new Map<string, RoomSession['seriesRef']>()
  if (occurrenceIds.length) {
    const { data } = await adminSupabase
      .from('weekly_room_occurrences')
      .select('id, senate_type, weekly_booking_id, weekly_room_bookings(start_time)')
      .in('id', occurrenceIds)
    type Row = {
      id: string
      senate_type: string | null
      weekly_booking_id: string | null
      weekly_room_bookings: { start_time: string } | { start_time: string }[] | null
    }
    for (const o of (data ?? []) as Row[]) {
      senateTypes.set(o.id, o.senate_type)
      const series = Array.isArray(o.weekly_room_bookings) ? o.weekly_room_bookings[0] : o.weekly_room_bookings
      if (o.weekly_booking_id && series) {
        seriesRefs.set(o.id, { id: o.weekly_booking_id, startTime: series.start_time })
      }
    }
  }

  const byBooking = new Map<string, CancelledReservation[]>()
  for (const r of roomRows) {
    byBooking.set(r.bookingId, [...(byBooking.get(r.bookingId) ?? []), r])
  }

  const { data: bookingRows } = await adminSupabase
    .from('bookings')
    .select('id, body_id, scope, division, purpose, bodies(name)')
    .in('id', [...byBooking.keys()])

  for (const booking of (bookingRows ?? []) as BookingRow[]) {
    const reservations = byBooking.get(booking.id) ?? []
    const body = Array.isArray(booking.bodies) ? booking.bodies[0] : booking.bodies
    const bodyName = body?.name ?? 'Unknown'

    const scopedRow: ScopedRow = {
      id: booking.id,
      body_id: booking.body_id,
      scope: booking.scope,
      division: booking.division as ScopedRow['division'],
    }
    const recipients = await resolveBookingRecipients(adminSupabase, scopedRow)
    if (!recipients.length) continue

    const sessions: RoomSession[] = reservations.map(r => ({
      uid: r.source === 'occurrence' ? occurrenceUid(r.id) : sessionUid(r.id),
      date: r.date,
      startTime: r.startTime,
      endTime: r.endTime,
      summary: summaryOf(booking.purpose, bodyName),
      location: locationOf(r.resultingStatus, r.roomOrTable),
      status: r.resultingStatus,
      senateType: r.source === 'occurrence' ? senateTypes.get(r.id) ?? null : null,
      seriesRef: r.source === 'occurrence' ? seriesRefs.get(r.id) : undefined,
    }))

    // Grouped over every session first, so each audience's email lists the
    // sessions that audience actually follows -- wording and invite alike.
    await sendPerAudience(recipients, { request: sessions, cancel: [] }, bodyName, async audience => {
      const theirs = audience.plan.request
      const cancelled = theirs.filter(s => s.status === 'Cancelled')
      const virtual = theirs.filter(s => s.status === 'Virtual')

      // A meeting going virtual is still a meeting: its event is re-sent with
      // Virtual as the location rather than removed. Past sessions are left on
      // calendars either way -- they are a record of what happened.
      const upcoming = (s: RoomSession) => s.date >= today

      await sendBookingCancelledEmail({
        bodyName,
        purpose: booking.purpose,
        cancelled: cancelled.map(s => ({ date: s.date, startTime: s.startTime, endTime: s.endTime, roomOrTable: s.location })),
        virtual: virtual.map(s => ({ date: s.date, startTime: s.startTime, endTime: s.endTime })),
        recipients: audience.recipients,
        invite: {
          request: virtual.filter(upcoming),
          cancel: cancelled.filter(upcoming),
        },
      })
    })
  }
}
