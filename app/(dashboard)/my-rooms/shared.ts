import { formatScopeLabel, type BookingScope, type Division } from '@/lib/booking-scope'

export interface FlatBooking {
  id: string
  bookingId: string //parent booking id
  bodyId: string
  type: 'One-Time Room' | 'Weekly Room' | 'Tabling'
  bodyName: string
  purpose: string
  location: string
  date: string
  startTime: string
  endTime: string
  status: string
  reservationCode: string | null
  senateType: string | null
  /** Resolved server-side across the booking's full scope (issue #19). */
  canManage: boolean
  /** Groups the All Bookings list. Bookings that share manage rights share a key. */
  scopeKey: string
  /** Display name for a group heading -- body name, division, or "X + N others". */
  scopeLabel: string
  /** Every body in the audience, owner first. Length > 1 only for a multi booking with peers. */
  scopeFull: string[]
}

/** The scope-bearing shape /api/my-rooms returns for each booking. */
export interface ScopedBookingRow {
  id: string
  body_id: string
  scope: BookingScope
  division: Division | null
  bodies: { name: string } | null
  booking_bodies: { body_id: string; bodies: { name: string } | null }[] | null
  canManage: boolean
}

/**
 * The /api/my-rooms payload, and the identical object the server page gets back
 * from fetchMyRooms(). Loosely typed on the occurrence rows -- flattenMyRooms
 * reads them structurally and the authoritative shape lives in lib/my-rooms-data.ts.
 */
export interface MyRoomsResponse {
  oneTimeBookings: (ScopedBookingRow & {
    purpose: string
    one_time_room_bookings: Record<string, string>[] | null
  })[]
  weeklyBookings: (ScopedBookingRow & {
    purpose: string
    weekly_room_bookings: (Record<string, string> & {
      weekly_room_occurrences: Record<string, string>[] | null
    })[] | null
  })[]
  tablingBookings: (ScopedBookingRow & {
    purpose: string
    tabling_bookings: (Record<string, string> & {
      tabling_sessions: Record<string, string>[] | null
    })[] | null
  })[]
  senateTypePreferences: Record<string, boolean>
}

/**
 * A divisional booking groups by its division and a multi booking on its own, because in neither
 * case does the owning body determine who sees it.
 */
export function scopeKeyOf(b: ScopedBookingRow): string {
  if (b.scope === 'divisional' && b.division) return `div:${b.division}`
  if (b.scope === 'multi') return `multi:${b.id}`
  return b.body_id
}

export function scopeLabelOf(b: ScopedBookingRow): string {
  return formatScopeLabel(
    b,
    (b.booking_bodies ?? []).map(x => ({ id: x.body_id, name: x.bodies?.name ?? '' }))
  ).short
}

/** The full audience list (owner first) behind scopeLabelOf's collapsed "X + N others". */
export function scopeFullOf(b: ScopedBookingRow): string[] {
  return formatScopeLabel(
    b,
    (b.booking_bodies ?? []).map(x => ({ id: x.body_id, name: x.bodies?.name ?? '' }))
  ).full
}

export const SENATE_TYPES = ['Full Body', 'Weekly', 'Office Hours'] as const

export const statusColors: Record<string, string> = {
  'Reserved': 'bg-[#0f3d20] border-[#22c55e]',
  'Alternate Room': 'bg-[#0e2f4f] border-[#4285f4]',
  'Alternate Time': 'bg-[#0e2f4f] border-[#4285f4]',
  'Waitlisted': 'bg-[#3d0f0f] border-[#ef4444]',
  'Unavailable': 'bg-[#3d0f0f] border-[#ef4444]',
  'Pending Cancellation': 'bg-[#3d2200] border-[#f97316]',
  'Cancelled': 'bg-[#2a1042] border-[#a855f7]',
  'Virtual': 'bg-[#062f3b] border-[#06b6d4]',
  'Missed': 'bg-[#1a1a2e] border-[#a78bfa]',
  'Repurposed': 'bg-[#1a1a1a] border-white',
  'Tentative': 'bg-[#2d2800] border-[#fef08a]',
}

export const statusBarColors: Record<string, string> = {
  'Reserved': 'bg-[#22c55e]',
  'Alternate Room': 'bg-[#4285f4]',
  'Alternate Time': 'bg-[#4285f4]',
  'Waitlisted': 'bg-[#ef4444]',
  'Unavailable': 'bg-[#ef4444]',
  'Pending Cancellation': 'bg-[#f97316]',
  'Cancelled': 'bg-[#a855f7]',
  'Virtual': 'bg-[#06b6d4]',
  'Missed': 'bg-[#a78bfa]',
  'Repurposed': 'bg-white',
  'Tentative': 'bg-[#fef08a]',
}

export const statusTextColors: Record<string, string> = {
  'Reserved': 'text-[#4ade80]',
  'Alternate Room': 'text-[#4285f4]',
  'Alternate Time': 'text-[#4285f4]',
  'Waitlisted': 'text-[#f87171]',
  'Unavailable': 'text-[#f87171]',
  'Pending Cancellation': 'text-[#fb923c]',
  'Cancelled': 'text-[#c084fc]',
  'Virtual': 'text-[#22d3ee]',
  'Missed': 'text-[#a78bfa]',
  'Repurposed': 'text-white',
  'Tentative': 'text-[#fef08a]',
}

// Muted, tinted pills (matching statusColors' style) instead of a solid block,
// distinct per session type so they stay legible when grouped together.
export const senateTypeBadgeColors: Record<string, string> = {
  'Full Body': 'bg-[#2a1042] text-[#c084fc] border border-[#a855f7]/40',
  'Weekly': 'bg-[#0e2f4f] text-[#93c5fd] border border-[#4285f4]/40',
  'Office Hours': 'bg-[#062f3b] text-[#22d3ee] border border-[#06b6d4]/40',
}
export const DEFAULT_SENATE_BADGE = 'bg-[#1e3a5f] text-[#93b8d8] border border-[#2d5f8f]/40'

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
 * Pinning it also makes the value reproducible, which is what lets this page be
 * server-rendered at all -- see todayInAppZone().
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

/**
 * Whole days from one 'YYYY-MM-DD' to another; negative when `to` is earlier.
 *
 * Anchored at UTC noon rather than subtracting Date objects built from local
 * midnight: on a DST boundary two local midnights are 23 or 25 hours apart, and
 * dividing that by 86,400,000 lands on 0.958 or 1.04 rather than a whole day.
 */
export function dayDiff(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  return (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000
}

/** True when `dateStr` falls in the window [today, today + days). */
export function isWithinDays(dateStr: string, days: number, today: string): boolean {
  const diff = dayDiff(today, dateStr)
  return diff >= 0 && diff < days
}

export function formatTime(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${m} ${ampm}`
}

export function formatDate(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  })
}

/**
 * Flattens the /api/my-rooms payload into the row list the page renders: one
 * FlatBooking per occurrence/session, sorted by date then start time, with
 * anything before today dropped.
 *
 * Lives here rather than inside the page component because it now has two
 * callers -- the server page, which flattens the data it read directly while
 * rendering the document, and the client, which re-flattens after a refresh.
 * Both must produce byte-identical rows or React would hydrate onto a different
 * list than the server drew.
 */
export function flattenMyRooms(data: MyRoomsResponse, today: string): FlatBooking[] {
    const flat: FlatBooking[] = []

    for (const b of data.oneTimeBookings || []) {
      for (const d of b.one_time_room_bookings || []) {
        flat.push({
          id: d.id,
          bodyId: b.body_id,
          bookingId: b.id,
          type: 'One-Time Room',
          bodyName: b.bodies?.name || '',
          purpose: b.purpose,
          location: d.room_name,
          date: d.booking_date,
          startTime: d.start_time,
          endTime: d.end_time,
          status: d.status,
          reservationCode: d.reservation_code,
          senateType: null,
          canManage: !!b.canManage,
          scopeKey: scopeKeyOf(b),
          scopeLabel: scopeLabelOf(b),
          scopeFull: scopeFullOf(b),
        })
      }
    }

    for (const b of data.weeklyBookings || []) {
      const w = b.weekly_room_bookings?.[0]
      if (!w) continue
      for (const occ of w.weekly_room_occurrences || []) {
        flat.push({
        id: occ.id,
        bodyId: b.body_id,
        bookingId: b.id,
        type: 'Weekly Room',
        bodyName: b.bodies?.name || '',
        // `??` rather than the `||` used by the fields below: an occurrence may
        // deliberately override the series purpose, and only null means inherit.
        // Empty strings are normalised to null when written (see the weekly PATCH
        // handler), so they cannot reach here and read as an intentional blank.
        purpose: occ.purpose ?? b.purpose,
        location: occ.room_name || w.room_name,
        date: occ.occurrence_date,
        startTime: occ.start_time || w.start_time,
        endTime: occ.end_time || w.end_time,
        status: occ.status || w.status,
        reservationCode: occ.reservation_code || w.reservation_code,
        senateType: occ.senate_type ?? null,
        canManage: !!b.canManage,
        scopeKey: scopeKeyOf(b),
        scopeLabel: scopeLabelOf(b),
        scopeFull: scopeFullOf(b),
      })
    }
  }

  for (const b of data.tablingBookings || []) {
    const t = b.tabling_bookings?.[0]
    if (!t) continue
    for (const s of t.tabling_sessions || []) {
      flat.push({
        id: s.id,
        bodyId: b.body_id,
        bookingId: b.id,
        type: 'Tabling',
        bodyName: b.bodies?.name || '',
        purpose: b.purpose,
        location: s.location,
        date: s.session_date,
        startTime: s.start_time,
        endTime: s.end_time,
        status: s.status,
        reservationCode: s.reservation_code || t.reservation_code,
        senateType: null,
        canManage: !!b.canManage,
        scopeKey: scopeKeyOf(b),
        scopeLabel: scopeLabelOf(b),
        scopeFull: scopeFullOf(b),
      })
    }
  }

  flat.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))

  // `today` is supplied rather than read from the clock so the server and the
  // hydrating client filter against the same boundary. Both sides are
  // 'YYYY-MM-DD', so lexicographic comparison is chronological comparison.
  return flat.filter(b => b.date >= today)
}
