import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { CancellationLine } from './emails/csc-cancellation-request'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * An occurrence's effective values, after inheritance.
 *
 * Every one of these columns is an override on weekly_room_occurrences where
 * NULL means "take the series' value" -- 340 of 385 occurrence rows carry a NULL
 * status alone. Pulled out as a pure function because it is the part of
 * Auto-Cancel most likely to be wrong and the hardest to observe: a series-level
 * cancellation produces occurrences that are pending without any occurrence row
 * saying so, and reading only the occurrence would skip the whole series.
 */
export function resolveOccurrence(
  occ: {
    status: string | null
    start_time: string | null
    end_time: string | null
    room_name: string | null
    reservation_code: string | null
  },
  series: {
    status: string | null
    start_time: string | null
    end_time: string | null
    room_name: string | null
    reservation_code: string | null
  } | null
) {
  return {
    status: occ.status ?? series?.status ?? null,
    startTime: occ.start_time ?? series?.start_time ?? '',
    endTime: occ.end_time ?? series?.end_time ?? '',
    roomOrTable: occ.room_name ?? series?.room_name ?? 'Not recorded',
    reservationCode: occ.reservation_code ?? series?.reservation_code ?? null,
  }
}

const PENDING = 'Pending Cancellation'

interface BodyRef { name: string }
interface BookingRef { id: string; type: string; purpose: string; bodies: BodyRef | BodyRef[] | null }

/** Supabase types an embedded to-one as an array in some shapes; normalise it. */
function bodyNameOf(booking: BookingRef | BookingRef[] | null): string {
  const b = Array.isArray(booking) ? booking[0] : booking
  if (!b) return 'Unknown body'
  const body = Array.isArray(b.bodies) ? b.bodies[0] : b.bodies
  return body?.name ?? 'Unknown body'
}

/**
 * Every dated reservation currently marked for cancellation, across all three
 * booking types.
 *
 * The weekly half is the part worth reading twice. weekly_room_occurrences.status
 * is an override where NULL means "inherit from the series", so a series marked
 * Pending Cancellation has occurrences that are pending without saying so
 * themselves -- 340 of the 385 occurrence rows carry a NULL status. Matching only
 * on the occurrence's own column would silently skip every series-level
 * cancellation, which is the case that matters most: it is the one with the most
 * dates behind it.
 *
 * room_name, times and reservation_code inherit the same way, so each is resolved
 * against the series before it goes anywhere near the email.
 */
/**
 * A reservation that is pending cancellation but has no reservation code.
 *
 * Kept apart from `lines` rather than dropped silently. CSC identifies a booking
 * by its code, so there is nothing to ask them to release -- and because
 * Auto-Cancel marks what it sends as Cancelled, listing one of these would mean
 * cancelling a booking in Chambers on the strength of a request CSC could not
 * act on. They are surfaced in the preview so an admin knows to chase them by
 * hand.
 */
/**
 * Whether CSC could act on this reservation.
 *
 * The code is the only handle CSC has on a booking, so one without it can be
 * neither requested nor -- since Auto-Cancel marks what it sends -- cancelled in
 * Chambers. Whitespace counts as absent: a code column holding " " is a blank
 * someone tabbed through, not an identifier.
 *
 * Exported so the rule is testable on its own. Live data has a code on every
 * pending row today, which makes this the branch that would otherwise ship
 * unexercised.
 */
export function hasUsableCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && code.trim().length > 0
}

export interface SkippedReservation {
  date: string
  roomOrTable: string
  bodyName: string
  bookingType: 'One-Time Room' | 'Weekly Room' | 'Tabling'
}

/**
 * How the browser names a reservation when it selects one.
 *
 * Scoped by table because the id alone says nothing about which of the three it
 * belongs to, and a selection that resolved against the wrong table would cancel
 * the wrong booking. Everything the POST accepts is matched back against a
 * freshly collected set, so an unknown key is refused rather than acted on.
 */
export function lineKey(l: { source: CancellationLine['source']; id: string }): string {
  return `${l.source}:${l.id}`
}

export interface PendingCancellations {
  lines: CancellationLine[]
  skipped: SkippedReservation[]
}

export async function collectPending(): Promise<PendingCancellations> {
  const lines: CancellationLine[] = []
  const skipped: SkippedReservation[] = []

  /** Routes a row to `lines` or `skipped` on whether CSC could act on it. */
  const add = (
    code: string | null,
    line: Omit<CancellationLine, 'reservationCode'>,
  ) => {
    if (hasUsableCode(code)) lines.push({ ...line, reservationCode: code!.trim() })
    else skipped.push({
      date: line.date,
      roomOrTable: line.roomOrTable,
      bodyName: line.bodyName,
      bookingType: line.bookingType,
    })
  }

  {
    const { data } = await adminSupabase
      .from('one_time_room_bookings')
      .select('id, booking_id, room_name, booking_date, start_time, end_time, reservation_code, bookings(id, type, purpose, bodies(name))')
      .eq('status', PENDING)

    for (const r of (data ?? []) as unknown as (Record<string, string> & { bookings: BookingRef | null })[]) {
      add(r.reservation_code, {
        id: r.id,
        source: 'one_time',
        bookingId: r.booking_id,
        date: r.booking_date,
        startTime: r.start_time,
        endTime: r.end_time,
        roomOrTable: r.room_name || 'Not recorded',
        bodyName: bodyNameOf(r.bookings),
        bookingType: 'One-Time Room',
      })
    }
  }

  {
    const { data } = await adminSupabase
      .from('tabling_sessions')
      .select('id, location, session_date, start_time, end_time, reservation_code, tabling_bookings(id, booking_id, reservation_code, bookings(id, type, purpose, bodies(name)))')
      .eq('status', PENDING)

    for (const r of (data ?? []) as unknown as (Record<string, string> & {
      tabling_bookings: { id: string; booking_id: string; reservation_code: string | null; bookings: BookingRef | null } | null
    })[]) {
      const parent = Array.isArray(r.tabling_bookings) ? r.tabling_bookings[0] : r.tabling_bookings
      // The session's own code wins; the booking's is the fallback, matching
      // how the tabling editor treats it.
      add(r.reservation_code || parent?.reservation_code || null, {
        id: r.id,
        source: 'tabling_session',
        bookingId: parent?.booking_id ?? '',
        date: r.session_date,
        startTime: r.start_time,
        endTime: r.end_time,
        roomOrTable: r.location || 'Not recorded',
        bodyName: bodyNameOf(parent?.bookings ?? null),
        bookingType: 'Tabling',
      })
    }
  }

  {
    const { data } = await adminSupabase
      .from('weekly_room_occurrences')
      .select(`
        id, occurrence_date, room_name, start_time, end_time, status, reservation_code,
        weekly_room_bookings(id, booking_id, room_name, start_time, end_time, status, reservation_code,
          bookings(id, type, purpose, bodies(name)))
      `)

    for (const r of (data ?? []) as unknown as {
      id: string
      occurrence_date: string
      room_name: string | null
      start_time: string | null
      end_time: string | null
      status: string | null
      reservation_code: string | null
      weekly_room_bookings: {
        id: string
        booking_id: string
        room_name: string | null
        start_time: string | null
        end_time: string | null
        status: string | null
        reservation_code: string | null
        bookings: BookingRef | null
      } | null
    }[]) {
      const series = Array.isArray(r.weekly_room_bookings) ? r.weekly_room_bookings[0] : r.weekly_room_bookings
      const eff = resolveOccurrence(r, series)
      if (eff.status !== PENDING) continue

      add(eff.reservationCode, {
        id: r.id,
        source: 'occurrence',
        bookingId: series?.booking_id ?? '',
        date: r.occurrence_date,
        startTime: eff.startTime,
        endTime: eff.endTime,
        roomOrTable: eff.roomOrTable,
        bodyName: bodyNameOf(series?.bookings ?? null),
        bookingType: 'Weekly Room',
      })
    }
  }

  // Chronological: CSC works through a list of dates, not a list of bodies.
  const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date)
  return {
    lines: lines.sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : byDate(a, b))),
    skipped: skipped.sort(byDate),
  }
}

