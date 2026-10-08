import { formatScopeLabel, type BookingScope, type Division } from '@/lib/booking-scope'
import { resolveMeetingTime } from '@/lib/meeting-time'
import { AWAITING_CSC, OPS_REVIEW, type OpenRequestStatus } from '@/lib/request-status'

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
  /**
   * When the meeting itself starts, already resolved through its inheritance
   * chain, so a row always has one (issue #126). Falls back to startTime, which
   * is what every surface here reported before the field existed.
   */
  meetingTime: string
  status: string
  reservationCode: string | null
  /**
   * True only when Chambers made this booking's reservation through Browse/Book
   * NUSSO. A reservationCode alone does not mean that -- most are typed in for
   * reservations made outside Chambers -- and only this may gate an actual EMS
   * cancellation.
   */
  bookedViaNusso: boolean
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
  booked_via_nusso?: boolean
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

/**
 * The headline for a booking row: what it is, not who runs it.
 *
 * Rows used to lead with the owning body (calendar day list) or the room (list
 * view), which is the least distinguishing thing about them -- a body's rows all
 * read the same, and so do a room's. The purpose is the title someone typed for
 * this specific booking, so it leads and the rest drops to supporting text
 * (issue #65). Falls back to the scope label for a booking saved without one, so
 * a row is never headed by an empty string.
 */
export function bookingTitle(b: FlatBooking): string {
  return b.purpose?.trim() || b.scopeLabel
}

/**
 * Every status a room booking, weekly occurrence or tabling session can hold --
 * the same list, in the same order, as the status check constraints in
 * db/neon/0001_baseline.sql.
 *
 * The colour maps below and STATUS_DEFINITIONS are each checked against it with
 * `satisfies`, so adding a status here fails the build until it has a colour and
 * a plain-language definition (issue #228). The maps stay typed by string
 * because every caller indexes them with a row's raw status.
 */
export const BOOKING_STATUSES = [
  'Reserved',
  'Alternate Room',
  'Alternate Time',
  'Alternate Room and Time',
  'Waitlisted',
  'Unavailable',
  'Pending Cancellation',
  'Cancelled',
  'Virtual',
  'Missed',
  'Repurposed',
  'Tentative',
] as const
export type BookingStatus = typeof BOOKING_STATUSES[number]

export const statusColors: Record<string, string> = {
  'Reserved': 'bg-[#0f3d20] border-[#22c55e]',
  'Alternate Room': 'bg-[#0e2f4f] border-[#4285f4]',
  'Alternate Time': 'bg-[#0e2f4f] border-[#4285f4]',
  'Alternate Room and Time': 'bg-[#0e2f4f] border-[#4285f4]',
  'Waitlisted': 'bg-[#3d0f0f] border-[#ef4444]',
  'Unavailable': 'bg-[#3d0f0f] border-[#ef4444]',
  'Pending Cancellation': 'bg-[#3d2200] border-[#f97316]',
  'Cancelled': 'bg-[#2a1042] border-[#a855f7]',
  'Virtual': 'bg-[#062f3b] border-[#06b6d4]',
  'Missed': 'bg-[#1a1a2e] border-[#a78bfa]',
  'Repurposed': 'bg-[#1a1a1a] border-white',
  'Tentative': 'bg-[#2d2800] border-[#fef08a]',
} satisfies Record<BookingStatus, string>

export const statusBarColors: Record<string, string> = {
  'Reserved': 'bg-[#22c55e]',
  'Alternate Room': 'bg-[#4285f4]',
  'Alternate Time': 'bg-[#4285f4]',
  'Alternate Room and Time': 'bg-[#4285f4]',
  'Waitlisted': 'bg-[#ef4444]',
  'Unavailable': 'bg-[#ef4444]',
  'Pending Cancellation': 'bg-[#f97316]',
  'Cancelled': 'bg-[#a855f7]',
  'Virtual': 'bg-[#06b6d4]',
  'Missed': 'bg-[#a78bfa]',
  'Repurposed': 'bg-white',
  'Tentative': 'bg-[#fef08a]',
} satisfies Record<BookingStatus, string>

export const statusTextColors: Record<string, string> = {
  'Reserved': 'text-[#4ade80]',
  'Alternate Room': 'text-[#4285f4]',
  'Alternate Time': 'text-[#4285f4]',
  'Alternate Room and Time': 'text-[#4285f4]',
  'Waitlisted': 'text-[#f87171]',
  'Unavailable': 'text-[#f87171]',
  'Pending Cancellation': 'text-[#fb923c]',
  'Cancelled': 'text-[#c084fc]',
  'Virtual': 'text-[#22d3ee]',
  'Missed': 'text-[#a78bfa]',
  'Repurposed': 'text-white',
  'Tentative': 'text-[#fef08a]',
} satisfies Record<BookingStatus, string>

/**
 * What each status means to someone reading My Rooms, and what they should do
 * about it -- the copy behind the status glossary (issue #228).
 *
 * Written from what Chambers does with each status rather than from the label:
 * which ones still get a Slack meeting reminder and a spot on the room calendar
 * (lib/meeting-reminders.ts, lib/room-calendar.ts), which are set by a
 * cancellation request (app/api/cancellation-requests) or a NUSSO release
 * (lib/nusso/cancel-booking.ts), and which alert Operational Affairs (Missed).
 * When one of those behaviours changes, the sentence here describing it should
 * change with it.
 */
export const STATUS_DEFINITIONS = {
  'Reserved': {
    meaning: 'The room is booked for your body at the date and time shown.',
    action: 'Nothing. Go to the room listed.',
  },
  'Alternate Room': {
    meaning: 'The meeting is on, at the usual time, but in a different room from usual.',
    action: 'Check the location before you go.',
  },
  'Alternate Time': {
    meaning: 'The meeting is on, in the usual room, but at a different time from usual.',
    action: 'Check the start time before you go.',
  },
  'Alternate Room and Time': {
    meaning: 'The meeting is on, but both the room and the time have changed.',
    action: 'Check the location and the start time before you go.',
  },
  'Waitlisted': {
    meaning: 'The room has been asked for but not confirmed. CSC has put the booking on its waitlist, so there is no room to go to yet.',
    action: "Don't count on the room until the status changes. No meeting reminder is posted in the meantime.",
  },
  'Unavailable': {
    meaning: 'The room could not be booked for this date. There is no room for this meeting.',
    action: "Ask your body's leadership whether you are meeting somewhere else.",
  },
  'Pending Cancellation': {
    meaning: "Your body's leadership has asked to cancel this booking or move it online, and Operational Affairs hasn't settled the request yet.",
    action: 'Nothing. It changes to Cancelled or Virtual once the request is settled.',
  },
  'Cancelled': {
    meaning: 'The meeting is not happening, and the room has been given up.',
    action: "Don't go.",
  },
  'Virtual': {
    meaning: 'The meeting is still happening, but online rather than in a room.',
    action: "Ask your body's leadership for the link.",
  },
  'Missed': {
    meaning: 'An administrator recorded that this reservation went unused. Operational Affairs is alerted automatically when this happens.',
    action: 'If you think it is a mistake, reach out to the Comptroller.',
  },
  'Repurposed': {
    meaning: "The reservation has been put to another use, so it is no longer your body's meeting in this room.",
    action: "Ask your body's leadership if you aren't sure where you are meeting.",
  },
  'Tentative': {
    meaning: 'The plan is real, but not confirmed yet, and it may still change.',
    action: 'Expect it to happen, but check back before you go.',
  },
} satisfies Record<BookingStatus, { meaning: string; action: string }>

/**
 * The callout colours for an open revision request on a booking's details. Here
 * rather than inline in the detail modal so the status glossary shows the same
 * colours the modal does.
 */
export const openRequestStatusStyles: Record<OpenRequestStatus, string> = {
  [OPS_REVIEW]: 'border-[#fbbf24]/30 bg-[#fbbf24]/10 text-[#fcd34d]',
  [AWAITING_CSC]: 'border-[#a78bfa]/30 bg-[#a78bfa]/10 text-[#c4b5fd]',
}

// Muted, tinted pills (matching statusColors' style) instead of a solid block,
// distinct per session type so they stay legible when grouped together.
export const senateTypeBadgeColors: Record<string, string> = {
  'Full Body': 'bg-[#2a1042] text-[#c084fc] border border-[#a855f7]/40',
  'Weekly': 'bg-[#0e2f4f] text-[#93c5fd] border border-[#4285f4]/40',
  'Office Hours': 'bg-[#062f3b] text-[#22d3ee] border border-[#06b6d4]/40',
}
export const DEFAULT_SENATE_BADGE = 'bg-[#1e3a5f] text-[#93b8d8] border border-[#2d5f8f]/40'

// Re-exported so this module stays the one import for My Rooms' date helpers.
// todayInAppZone lives beside APP_TIME_ZONE now that lib/ needs it too
// (issue #177), and is re-exported here so My Rooms keeps one import for its
// date helpers.
export { APP_TIME_ZONE, todayInAppZone } from '@/lib/app-zone'

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
          // A one-time session has no series above it, so the chain is two
          // levels: its own meeting time, or its own start time (issue #126).
          meetingTime: resolveMeetingTime(d.meeting_time, d.start_time),
          status: d.status,
          reservationCode: d.reservation_code,
          bookedViaNusso: !!b.booked_via_nusso,
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
        // Three levels, most specific first: this week's override, the series
        // value, then the start time this week actually resolved to -- so a
        // week that moved its start time and set no meeting time reports the
        // moved time rather than the series' (issue #126).
        meetingTime: resolveMeetingTime(
          occ.meeting_time,
          w.meeting_time,
          occ.start_time || w.start_time
        ),
        status: occ.status || w.status,
        reservationCode: occ.reservation_code || w.reservation_code,
        bookedViaNusso: !!b.booked_via_nusso,
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
        // As for one-time: each tabling session carries its own date and times,
        // so there is no parent value to inherit (issue #126).
        meetingTime: resolveMeetingTime(s.meeting_time, s.start_time),
        status: s.status,
        reservationCode: s.reservation_code || t.reservation_code,
        bookedViaNusso: !!b.booked_via_nusso,
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
