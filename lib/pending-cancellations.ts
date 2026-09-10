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

/**
 * Everything a line carries except a code CSC could act on.
 *
 * It used to carry only the four display fields, because the only thing anyone
 * did with a skipped row was print it in the Auto-Cancel preview. Marking a
 * cancellation request Done has to *act* on these rows (issue #96): the admin
 * saying they have handled it is not conditional on CSC having had a code to
 * work from, so the row still needs its status applied and therefore still needs
 * its id, its table and its outcome.
 */
export interface SkippedReservation extends Omit<CancellationLine, 'reservationCode'> {
  /** Always null. Its absence is what makes the row skipped. */
  reservationCode: null
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

/**
 * The status a pending reservation should take once CSC has been asked.
 *
 * A cancellation request carries a cancellation_type: 'Cancellation' when the
 * meeting is off, 'Virtual' when it is moving online. Those are different
 * afterwards -- a virtual meeting still happens, it just does not need the room
 * -- so Auto-Cancel has to apply the one the requester actually asked for rather
 * than marking everything Cancelled.
 *
 * Falls back to 'Cancelled' when nothing says otherwise, which is the common
 * case: a booking can be set to Pending Cancellation directly by an admin, with
 * no request behind it at all. 'Cancelled' is the plain reading of that, and
 * going virtual is a specific thing a requester asks for -- defaulting the other
 * way would quietly leave rooms marked as still-meeting.
 */
export interface CancellationOutcome {
  status: 'Cancelled' | 'Virtual'
  fromRequest: boolean
}

/** A cancellation request, as indexed for lookup. */
interface RequestRef {
  id: string
  type: string
}

const DEFAULT_OUTCOME: CancellationOutcome = { status: 'Cancelled', fromRequest: false }

export function outcomeOf(cancellationType: string | null | undefined): CancellationOutcome {
  if (cancellationType === 'Virtual') return { status: 'Virtual', fromRequest: true }
  if (cancellationType === 'Cancellation') return { status: 'Cancelled', fromRequest: true }
  return DEFAULT_OUTCOME
}

/**
 * The cancellation requests a send has finished off.
 *
 * A request is only done when every pending reservation it covers went out.
 * Occurrence-scoped requests cover exactly one row, so selecting one closes it;
 * a series-scoped request covers the whole run, and sending three weeks of a
 * five-week cancellation does not finish it. Closing it anyway would drop the
 * remaining two off the Cancellations tab with nothing done about them.
 *
 * Pure, and exported, because there are no series-scoped requests in the data
 * today -- this is the branch that would otherwise ship unexercised.
 */
export function requestsFullyCovered(
  allPending: { cancellationRequestId: string | null; source: CancellationLine['source']; id: string }[],
  selectedKeys: Set<string>
): string[] {
  const coverage = new Map<string, { total: number; sent: number }>()
  for (const l of allPending) {
    if (!l.cancellationRequestId) continue
    const c = coverage.get(l.cancellationRequestId) ?? { total: 0, sent: 0 }
    c.total += 1
    if (selectedKeys.has(lineKey(l))) c.sent += 1
    coverage.set(l.cancellationRequestId, c)
  }
  return [...coverage.entries()]
    .filter(([, c]) => c.sent > 0 && c.sent === c.total)
    .map(([id]) => id)
}

export interface PendingCancellations {
  lines: CancellationLine[]
  skipped: SkippedReservation[]
}

export async function collectPending(): Promise<PendingCancellations> {
  const lines: CancellationLine[] = []
  const skipped: SkippedReservation[] = []

  // Read once and index, rather than a lookup per reservation. Ordered so the
  // preferred row is the one that survives into each map: a still-Pending
  // request beats a resolved one, and the most recent beats an older one.
  const { data: requests } = await adminSupabase
    .from('cancellation_requests')
    .select('id, booking_id, occurrence_id, occurrence_date, scope, status, cancellation_type, created_at')
    .order('created_at', { ascending: false })

  // The id travels with the type: sending closes the request it acted on, so
  // knowing *which* row said 'Virtual' matters as much as the value.
  const byOccurrence = new Map<string, RequestRef>()
  // Keyed on (booking, date), which is what survives an edit. occurrence_id does
  // not: the weekly PATCH handler regenerates every occurrence row on each save,
  // so a request made before an edit points at nothing afterwards -- and every
  // request in production was in exactly that state (issue #96). Falling through
  // to bySeriesBooking would have been wrong, and falling through to nothing lost
  // the cancellation_type, so a request that asked to go Virtual came out
  // Cancelled.
  const byBookingDate = new Map<string, RequestRef>()
  const bySeriesBooking = new Map<string, RequestRef>()
  const byBooking = new Map<string, RequestRef>()

  const dateKey = (bookingId: string, date: string) => `${bookingId}|${date}`

  for (const pass of ['Pending', 'other'] as const) {
    for (const r of (requests ?? []) as {
      id: string
      booking_id: string | null
      occurrence_id: string | null
      occurrence_date: string | null
      scope: string
      status: string | null
      cancellation_type: string
    }[]) {
      const ref: RequestRef = { id: r.id, type: r.cancellation_type }
      const isPending = r.status === 'Pending'
      if (pass === 'Pending' ? !isPending : isPending) continue
      // setDefault semantics: the first pass wins, so a Pending request is never
      // overwritten by a resolved one.
      if (r.occurrence_id && !byOccurrence.has(r.occurrence_id)) {
        byOccurrence.set(r.occurrence_id, ref)
      }
      if (r.booking_id && r.occurrence_date) {
        const k = dateKey(r.booking_id, r.occurrence_date)
        if (!byBookingDate.has(k)) byBookingDate.set(k, ref)
      }
      if (r.booking_id) {
        if (r.scope === 'series' && !bySeriesBooking.has(r.booking_id)) {
          bySeriesBooking.set(r.booking_id, ref)
        }
        if (!byBooking.has(r.booking_id)) byBooking.set(r.booking_id, ref)
      }
    }
  }

  /** Routes a row to `lines` or `skipped` on whether CSC could act on it. */
  const add = (
    code: string | null,
    line: Omit<CancellationLine, 'reservationCode' | 'resultingStatus' | 'outcomeFromRequest' | 'cancellationRequestId'>,
    request: RequestRef | undefined,
  ) => {
    const outcome = outcomeOf(request?.type)
    const resolved = {
      ...line,
      resultingStatus: outcome.status,
      outcomeFromRequest: outcome.fromRequest,
      cancellationRequestId: request?.id ?? null,
    }
    // Built once and routed, rather than assembled differently on each branch.
    // The two used to diverge, and a skipped row lost the id and table that
    // marking a request Done now needs (issue #96).
    if (hasUsableCode(code)) lines.push({ ...resolved, reservationCode: code!.trim() })
    else skipped.push({ ...resolved, reservationCode: null })
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
      }, byBookingDate.get(dateKey(r.booking_id, r.booking_date)) ?? byBooking.get(r.booking_id))
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
      }, parent?.booking_id
        ? byBookingDate.get(dateKey(parent.booking_id, r.session_date)) ?? byBooking.get(parent.booking_id)
        : undefined)
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
      },
        // A request naming this exact week wins over one covering the series.
        // The id is tried first because it is exact when it resolves; the
        // (booking, date) key is what still works once the row has been
        // regenerated, which is the usual case rather than the exception.
        byOccurrence.get(r.id)
          ?? (series?.booking_id
            ? byBookingDate.get(dateKey(series.booking_id, r.occurrence_date))
              ?? bySeriesBooking.get(series.booking_id)
            : undefined)
      )
    }
  }

  // Chronological: CSC works through a list of dates, not a list of bodies.
  const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date)
  return {
    lines: lines.sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : byDate(a, b))),
    skipped: skipped.sort(byDate),
  }
}


/** Which table each source's `id` belongs to. */
const TABLE_OF: Record<CancellationLine['source'], string> = {
  one_time: 'one_time_room_bookings',
  occurrence: 'weekly_room_occurrences',
  tabling_session: 'tabling_sessions',
}

/** The rows a cancellation outcome can be written to. */
export type OutcomeTarget = Pick<CancellationLine, 'source' | 'id' | 'resultingStatus' | 'bookingId'>

/**
 * Writes each reservation the status it is due, and returns the batches that
 * failed.
 *
 * Grouped by table *and* by status, so a batch containing both kinds writes each
 * its own value. Marking everything 'Cancelled' would be wrong for a booking
 * whose request said it was going virtual: that meeting still happens, it just
 * does not need the room.
 *
 * An occurrence whose status was inherited gets its value written onto the
 * occurrence itself, which is correct -- only the dates actually acted on stop
 * being pending, and the rest of the series is untouched.
 *
 * Shared by Auto-Cancel and by marking a request Done by hand, which have to
 * agree about this: the same request resolved either way should leave the
 * database in the same state.
 */
export async function applyCancellationOutcomes(rows: OutcomeTarget[]): Promise<string[]> {
  const batches = new Map<string, { table: string; status: string; ids: string[] }>()
  for (const l of rows) {
    const table = TABLE_OF[l.source]
    const bucket = `${table}:${l.resultingStatus}`
    if (!batches.has(bucket)) batches.set(bucket, { table, status: l.resultingStatus, ids: [] })
    batches.get(bucket)!.ids.push(l.id)
  }

  const failures: string[] = []
  for (const { table, status, ids } of batches.values()) {
    const { error } = await adminSupabase.from(table).update({ status }).in('id', ids)
    if (error) {
      console.error(`Could not mark ${table} as ${status}:`, error)
      failures.push(`${table} (${status})`)
    }
  }
  return failures
}

/**
 * Audit rows for a set of reservations, one per booking and status.
 *
 * Keyed on booking *and* status: one booking can contribute both a cancelled
 * week and a virtual one in the same action, and a single row saying 'Cancelled'
 * would misreport the other.
 */
export function cancellationAuditRows(rows: OutcomeTarget[], adminId: string) {
  return [...new Map(
    rows
      .filter(l => l.bookingId)
      .map(l => [
        `${l.bookingId}:${l.resultingStatus}`,
        { booking_id: l.bookingId, admin_id: adminId, new_status: l.resultingStatus },
      ])
  ).values()]
}
