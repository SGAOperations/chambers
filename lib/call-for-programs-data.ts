import type { Db } from './db/data-api'
import { dayOfWeek, type PriorWeeklyBooking, type ProgramCall } from './call-for-programs'

/**
 * The database side of the call for programs (lib/call-for-programs.ts has the
 * rules).
 */

const CALL_COLUMNS = 'id, opened_at, closes_at, closed_at'

/** The newest call, open or not. Callers use isCallOpen() on it. */
export async function getLatestCall(db: Db): Promise<ProgramCall | null> {
  const { data } = await db
    .from('program_calls')
    .select(CALL_COLUMNS)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as ProgramCall | null) ?? null
}

/**
 * The fall or spring semester whose weekly bookings a body is renewing.
 *
 * The active semester when it is a fall or spring. Otherwise -- a summer, or
 * none set -- the newest fall or spring created before it, so a semester made
 * ahead of time and still empty is not the one shown.
 */
async function renewalSemester(db: Db): Promise<{ id: string; name: string } | null> {
  const { data } = await db
    .from('semesters')
    .select('id, name, term, is_active, created_at')
    .order('created_at', { ascending: false })
  const rows = (data ?? []) as { id: string; name: string; term: string | null; is_active: boolean; created_at: string }[]

  const active = rows.find(s => s.is_active)
  const isRegular = (s: { term: string | null }) => s.term === 'Fall' || s.term === 'Spring'
  if (active && isRegular(active)) return active

  const candidates = active ? rows.filter(s => s.created_at < active.created_at) : rows
  return candidates.find(isRegular) ?? null
}

/** Statuses that mean the series is not a booking the body still has. */
const GONE_STATUSES = new Set(['Cancelled', 'Unavailable'])

/**
 * Each body's weekly bookings in the renewal semester, keyed by body id.
 *
 * Only bookings the body owns: a divisional or multi-body booking is renewed by
 * the body that filed it.
 */
export async function loadPriorWeeklyBookings(
  db: Db,
  bodyIds: string[]
): Promise<Record<string, PriorWeeklyBooking[]>> {
  const result: Record<string, PriorWeeklyBooking[]> = {}
  for (const id of bodyIds) result[id] = []
  if (bodyIds.length === 0) return result

  const semester = await renewalSemester(db)
  if (!semester) return result

  const { data } = await db
    .from('bookings')
    .select('body_id, purpose, weekly_room_bookings(id, room_name, start_date, end_date, start_time, end_time, status)')
    .eq('semester_id', semester.id)
    .eq('type', 'Weekly Room')
    .eq('hidden', false)
    .in('body_id', bodyIds)

  for (const b of (data ?? []) as {
    body_id: string
    purpose: string
    weekly_room_bookings: {
      id: string
      room_name: string
      start_date: string
      end_date: string
      start_time: string
      end_time: string
      status: string | null
    }[] | null
  }[]) {
    for (const w of b.weekly_room_bookings ?? []) {
      if (w.status && GONE_STATUSES.has(w.status)) continue
      result[b.body_id]?.push({
        weekly_booking_id: w.id,
        semester_name: semester.name,
        purpose: b.purpose,
        room_name: w.room_name,
        day: dayOfWeek(w.start_date),
        start_time: w.start_time.slice(0, 5),
        end_time: w.end_time.slice(0, 5),
        start_date: w.start_date,
        end_date: w.end_date,
      })
    }
  }
  return result
}
