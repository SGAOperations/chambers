import type { RoomSource } from './day-rooms'

/**
 * The hand-off from Browse/Book Rooms to Request a Booking: a room and a day,
 * carried in the URL so the link can be opened in a new tab or bookmarked.
 * Times are left to the form, because Browse never asked for any.
 */
export interface RequestRoomPrefill {
  date: string
  name: string
  building: string
  source: RoomSource
  ref: number
}

export function requestRoomHref(p: RequestRoomPrefill): string {
  const q = new URLSearchParams({
    date: p.date,
    room: p.name,
    building: p.building,
    source: p.source,
    ref: String(p.ref),
  })
  return `/request?${q.toString()}`
}

/** The prefill in a /request URL, or null when there is none or it does not hold together. */
export function readRequestRoomPrefill(search: string): RequestRoomPrefill | null {
  const q = new URLSearchParams(search)
  const date = q.get('date') ?? ''
  const name = (q.get('room') ?? '').trim()
  const source = q.get('source')
  const ref = Number(q.get('ref'))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) return null
  if (source !== 'nusso' && source !== 'registrar') return null
  if (!Number.isInteger(ref) || ref <= 0) return null
  return { date, name, building: (q.get('building') ?? '').trim(), source, ref }
}
