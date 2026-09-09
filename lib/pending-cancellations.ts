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

export type BookingTypeFilter = 'all' | 'One-Time Room' | 'Weekly Room' | 'Tabling'

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
export async function collectPending(
  type: BookingTypeFilter,
  from: string | null,
  to: string | null
): Promise<CancellationLine[]> {
  const lines: CancellationLine[] = []
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to)

  if (type === 'all' || type === 'One-Time Room') {
    const { data } = await adminSupabase
      .from('one_time_room_bookings')
      .select('room_name, booking_date, start_time, end_time, reservation_code, bookings(id, type, purpose, bodies(name))')
      .eq('status', PENDING)

    for (const r of (data ?? []) as unknown as (Record<string, string> & { bookings: BookingRef | null })[]) {
      if (!inRange(r.booking_date)) continue
      lines.push({
        date: r.booking_date,
        startTime: r.start_time,
        endTime: r.end_time,
        reservationCode: r.reservation_code || null,
        roomOrTable: r.room_name || 'Not recorded',
        bodyName: bodyNameOf(r.bookings),
        bookingType: 'One-Time Room',
      })
    }
  }

  if (type === 'all' || type === 'Tabling') {
    const { data } = await adminSupabase
      .from('tabling_sessions')
      .select('location, session_date, start_time, end_time, reservation_code, tabling_bookings(reservation_code, bookings(id, type, purpose, bodies(name)))')
      .eq('status', PENDING)

    for (const r of (data ?? []) as unknown as (Record<string, string> & {
      tabling_bookings: { reservation_code: string | null; bookings: BookingRef | null } | null
    })[]) {
      if (!inRange(r.session_date)) continue
      const parent = Array.isArray(r.tabling_bookings) ? r.tabling_bookings[0] : r.tabling_bookings
      lines.push({
        date: r.session_date,
        startTime: r.start_time,
        endTime: r.end_time,
        // The session's own code wins; the booking's is the fallback, matching
        // how the tabling editor treats it.
        reservationCode: r.reservation_code || parent?.reservation_code || null,
        roomOrTable: r.location || 'Not recorded',
        bodyName: bodyNameOf(parent?.bookings ?? null),
        bookingType: 'Tabling',
      })
    }
  }

  if (type === 'all' || type === 'Weekly Room') {
    const { data } = await adminSupabase
      .from('weekly_room_occurrences')
      .select(`
        occurrence_date, room_name, start_time, end_time, status, reservation_code,
        weekly_room_bookings(room_name, start_time, end_time, status, reservation_code,
          bookings(id, type, purpose, bodies(name)))
      `)

    for (const r of (data ?? []) as unknown as {
      occurrence_date: string
      room_name: string | null
      start_time: string | null
      end_time: string | null
      status: string | null
      reservation_code: string | null
      weekly_room_bookings: {
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
      if (!inRange(r.occurrence_date)) continue

      lines.push({
        date: r.occurrence_date,
        startTime: eff.startTime,
        endTime: eff.endTime,
        reservationCode: eff.reservationCode,
        roomOrTable: eff.roomOrTable,
        bodyName: bodyNameOf(series?.bookings ?? null),
        bookingType: 'Weekly Room',
      })
    }
  }

  // Chronological: CSC works through a list of dates, not a list of bodies.
  return lines.sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)))
}

export function parseFilters(url: URL) {
  const rawType = url.searchParams.get('type') ?? 'all'
  const type: BookingTypeFilter =
    rawType === 'One-Time Room' || rawType === 'Weekly Room' || rawType === 'Tabling' ? rawType : 'all'
  const iso = /^\d{4}-\d{2}-\d{2}$/
  const fromRaw = url.searchParams.get('from')
  const toRaw = url.searchParams.get('to')
  return {
    type,
    from: fromRaw && iso.test(fromRaw) ? fromRaw : null,
    to: toRaw && iso.test(toRaw) ? toRaw : null,
  }
}

export function describeScope(type: BookingTypeFilter, from: string | null, to: string | null): string {
  const what = type === 'all' ? 'All booking types' : type
  if (from && to) return `${what}, for dates between ${from} and ${to}.`
  if (from) return `${what}, for dates from ${from} onward.`
  if (to) return `${what}, for dates up to ${to}.`
  return `${what}, with no date limit.`
}

