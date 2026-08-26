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
