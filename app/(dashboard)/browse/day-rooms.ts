'use client'

import { useCallback, useEffect, useState } from 'react'
import type { NussoRoomOption } from '@/lib/nusso/client'
import type { NussoExistingBooking } from '@/lib/nusso/types'
import type { RegistrarReservation, RegistrarSpace } from '@/lib/25live/client'
import type { TimelineBlock, TimelineGroup, TimelineRow } from './space-timeline'

/**
 * Every room Chambers can show for one Boston day, from both systems, with what
 * is booked in each. Shared by Browse/Book Rooms and the room picker on Request
 * a Booking, so the two can never disagree about what is free.
 */

export type RoomSource = 'nusso' | 'registrar'

export const SOURCE_LABEL: Record<RoomSource, string> = { nusso: 'NUSSO', registrar: 'Registrar' }

export interface DayRoom {
  key: string
  source: RoomSource
  /** The room's id in its own system: an EMS room id, or a 25Live space id. */
  ref: number
  name: string
  /** As each system names it, "Boston - " dropped from 25Live's. */
  building: string
  capacity: number | null
  /** The second line under the name: seats, or what the room is. */
  detail: string
  blocks: TimelineBlock[]
}

/**
 * An EMS time ("2026-10-21T08:00:00", Boston wall-clock with no offset) as
 * minutes into `date`, held to that day.
 */
function emsMinute(value: string, date: string, edge: 'start' | 'end'): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(value || '')
  if (!m) return null
  if (m[1] < date) return 0
  if (m[1] > date) return edge === 'end' ? 24 * 60 : null
  return Number(m[2]) * 60 + Number(m[3])
}

/** The day's NUSSO bookings as timeline blocks, keyed by EMS room id. */
export function nussoBlocks(bookings: NussoExistingBooking[], date: string): Map<number, TimelineBlock[]> {
  const byRoom = new Map<number, TimelineBlock[]>()
  for (const b of bookings) {
    // The booked span includes setup and teardown, which is what keeps the room
    // from being requested -- the same span searchAvailableRooms checks.
    const start = emsMinute(b.TimeBookingStart || b.EventStart, date, 'start')
    const end = emsMinute(b.TimeBookingEnd || b.EventEnd, date, 'end')
    if (start === null || end === null || end <= start) continue
    const title = b.DisplayDetails ? (b.EventName || b.GroupName || null) : null
    if (!byRoom.has(b.RoomId)) byRoom.set(b.RoomId, [])
    byRoom.get(b.RoomId)!.push({ key: `n${b.Id}`, startMinute: start, endMinute: end, title })
  }
  return byRoom
}

/** Whether anything booked in a room overlaps [start, end), in minutes. */
export function isBusy(room: DayRoom, startMinute: number, endMinute: number): boolean {
  return room.blocks.some(b => b.startMinute < endMinute && b.endMinute > startMinute)
}

const byCode = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/** Rooms into timeline groups: one per building and system, NUSSO's first, A to Z within. */
export function groupRooms(rooms: DayRoom[], row: (room: DayRoom) => Partial<TimelineRow> = () => ({})): TimelineGroup[] {
  const groups = new Map<string, { source: RoomSource; building: string; rooms: DayRoom[] }>()
  for (const r of rooms) {
    const key = `${r.source}:${r.building}`
    if (!groups.has(key)) groups.set(key, { source: r.source, building: r.building, rooms: [] })
    groups.get(key)!.rooms.push(r)
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => (a.source === b.source ? a.building.localeCompare(b.building) : a.source === 'nusso' ? -1 : 1))
    .map(([key, g]) => ({
      key,
      heading: g.building,
      source: SOURCE_LABEL[g.source],
      rows: g.rooms
        .sort((a, b) => byCode(a.name, b.name))
        .map(r => ({ key: r.key, name: r.name, detail: r.detail, blocks: r.blocks, ...row(r) })),
    }))
}

interface Loaded<T> {
  data: T | null
  error: string | null
  status: number | null
}

async function getJsonOrError<T>(url: string, what: string): Promise<Loaded<T>> {
  try {
    const res = await fetch(url)
    const body = await res.json().catch(() => null)
    if (!res.ok) return { data: null, error: body?.error ?? `${what} failed (${res.status})`, status: res.status }
    return { data: body as T, error: null, status: res.status }
  } catch {
    return { data: null, error: `Could not reach ${what}.`, status: null }
  }
}

export interface DayRooms {
  loading: boolean
  rooms: DayRoom[]
  /** NUSSO's blocks by EMS room id, for rooms that arrive from elsewhere (Book's search). */
  nussoBlocksByRoom: Map<number, TimelineBlock[]>
  /** One line per system that failed, naming it. */
  errors: { source: RoomSource; message: string }[]
  /** False when the Registrar rooms are switched off (REGISTRAR_SPACES_ENABLED). */
  registrarAvailable: boolean
  reload: () => void
}

/**
 * Load one day. `withRegistrar` asks for the Registrar rooms too; while their
 * flag is off the API 404s, which reads here as "not available", not an error,
 * so callers without the flag (the Request form) can simply always ask.
 */
export function useDayRooms(date: string, withRegistrar: boolean): DayRooms {
  const [state, setState] = useState<Omit<DayRooms, 'reload' | 'loading'> & { key: string | null }>({
    key: null,
    rooms: [],
    nussoBlocksByRoom: new Map(),
    errors: [],
    registrarAvailable: false,
  })
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce(n => n + 1), [])
  // Loading is "the data on screen is not for what was asked", which needs no
  // state of its own: the previous day stays visible, dimmed, until the next lands.
  const wanted = `${date}|${withRegistrar}|${nonce}`

  useEffect(() => {
    let active = true
    ;(async () => {
      const [roomsRes, bookingsRes, regRes] = await Promise.all([
        getJsonOrError<{ rooms: NussoRoomOption[] }>(`/api/nusso/rooms?date=${date}`, 'NUSSO'),
        getJsonOrError<{ bookings: NussoExistingBooking[] }>(`/api/nusso/bookings?date=${date}`, 'NUSSO'),
        withRegistrar
          ? getJsonOrError<{ spaces: RegistrarSpace[]; reservations: RegistrarReservation[] }>(`/api/registrar-spaces?date=${date}`, '25Live')
          : Promise.resolve<Loaded<never>>({ data: null, error: null, status: 404 }),
      ])
      if (!active) return

      const blocks = nussoBlocks(bookingsRes.data?.bookings ?? [], date)
      const rooms: DayRoom[] = (roomsRes.data?.rooms ?? []).map(r => ({
        key: `n${r.RoomId}`,
        source: 'nusso',
        ref: r.RoomId,
        name: r.RoomCode,
        building: r.BuildingDescription || 'Other locations',
        capacity: r.Capacity > 0 ? r.Capacity : null,
        detail: r.Capacity > 0 ? `${r.Capacity} seats` : (r.RoomDescription || 'capacity unknown'),
        blocks: blocks.get(r.RoomId) ?? [],
      }))

      if (regRes.data) {
        const regBlocks = new Map<number, TimelineBlock[]>()
        for (const r of regRes.data.reservations) {
          if (!regBlocks.has(r.spaceId)) regBlocks.set(r.spaceId, [])
          regBlocks.get(r.spaceId)!.push({ key: `r${r.id}-${r.startMinute}`, startMinute: r.startMinute, endMinute: r.endMinute, title: r.title })
        }
        for (const s of regRes.data.spaces) {
          rooms.push({
            key: `r${s.id}`,
            source: 'registrar',
            ref: s.id,
            name: s.name,
            building: s.building.replace(/^Boston - /, ''),
            capacity: s.capacity,
            detail: s.capacity ? `${s.capacity} seats` : 'capacity unknown',
            blocks: regBlocks.get(s.id) ?? [],
          })
        }
      }

      const errors: DayRooms['errors'] = []
      const nussoError = roomsRes.error || bookingsRes.error
      if (nussoError) errors.push({ source: 'nusso', message: nussoError })
      if (withRegistrar && regRes.error && regRes.status !== 404) errors.push({ source: 'registrar', message: regRes.error })

      setState({
        key: `${date}|${withRegistrar}|${nonce}`,
        rooms,
        nussoBlocksByRoom: blocks,
        errors,
        registrarAvailable: !!regRes.data,
      })
    })()
    return () => { active = false }
  }, [date, withRegistrar, nonce])

  const { key, ...rest } = state
  return { ...rest, loading: key !== wanted, reload }
}
