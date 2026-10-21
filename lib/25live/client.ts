import { APP_TIME_ZONE } from '@/lib/app-zone'

/**
 * Read-only access to Northeastern's 25Live, for the Registrar rooms in Browse
 * mode on Browse/Book Rooms (app/(dashboard)/browse/spaces-page.tsx).
 *
 * 25Live is where the Registrar schedules rooms. Northeastern has configured a
 * "Viewer Seat" -- what someone who is not signed in may see -- so its data
 * endpoints answer without credentials. That is the path used here, and it is
 * undocumented: the university can narrow or close it without notice, which is
 * why the Registrar rooms sit behind REGISTRAR_SPACES_ENABLED and why sanctioned access
 * through CollegeNET's web services is being asked for. Only GETs, never a
 * write -- Chambers shows when a room is taken, it does not book one.
 *
 * What the seat exposes was measured in October 2026: a fixed 178 spaces
 * (filters on spaces.json are ignored), almost all "BOSTON NON CLASSROOMS"
 * plus ~25 on the Oakland campus, and every reservation in them with the event
 * name replaced by "(Private)" unless the event is public.
 */

/** The anonymous data endpoint for Northeastern's instance. Overridable for testing. */
export const TWENTYFIVE_LIVE_BASE_URL = (
  process.env.TWENTYFIVE_LIVE_BASE_URL || 'https://25live.collegenet.com/25live/data/northeastern/run'
).replace(/\/+$/, '')

/** The page is a prototype until sanctioned access exists; off unless set to "true". */
export function isRegistrarSpacesEnabled(): boolean {
  return process.env.REGISTRAR_SPACES_ENABLED === 'true'
}

/** 25Live did not answer, or answered with something that is not its JSON. */
export class TwentyFiveLiveError extends Error {}

export interface RegistrarSpace {
  id: number
  /** The short code people use, e.g. "RY 405". */
  name: string
  /** e.g. "Boston - Ryder Hall". */
  building: string
  /** Null where 25Live holds a placeholder (0 or 999) rather than a real number. */
  capacity: number | null
}

export interface RegistrarReservation {
  id: number
  spaceId: number
  /** Minutes after Boston midnight on the requested day, clipped to that day. */
  startMinute: number
  endMinute: number
  /** The event's name when 25Live publishes it, otherwise null ("(Private)"). */
  title: string | null
}

/** The space list changes a few times a term; reservations change all day. */
const SPACES_REVALIDATE_SECONDS = 60 * 60 * 24
const RESERVATIONS_REVALIDATE_SECONDS = 60 * 5

async function get25Live(path: string, revalidate: number): Promise<unknown> {
  let res: Response
  try {
    // The Next data cache is what keeps this polite: every signed-in viewer of a
    // day shares one upstream request per five minutes.
    res = await fetch(`${TWENTYFIVE_LIVE_BASE_URL}/${path}`, {
      headers: { accept: 'application/json' },
      next: { revalidate },
    })
  } catch {
    throw new TwentyFiveLiveError('Could not reach 25Live.')
  }
  if (!res.ok) throw new TwentyFiveLiveError(`25Live answered ${res.status}.`)
  try {
    return await res.json()
  } catch {
    throw new TwentyFiveLiveError('25Live sent something that is not JSON.')
  }
}

/**
 * 25Live serialises its XML as JSON, so a list of one arrives as a bare object
 * and a list of none as a missing key.
 */
function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

interface RawSpace {
  space_id: number
  space_name: string
  formal_name?: string
  building_name?: string
  max_capacity?: number
}

/** "BOS-Churchill-200" -> "bos-churchill", the part of a formal name that names the building. */
function formalPrefix(formalName: string | undefined): string | null {
  const match = /^(BOS-[^-]+?)\s*-/i.exec(formalName ?? '')
  return match ? match[1].toLowerCase() : null
}

/**
 * Boston spaces only, without the records 25Live keeps around that are not
 * rooms anyone can request: copies ("BK 725 (Copy)") and retired rows, which
 * are prefixed xx- or zz-.
 *
 * Boston-ness comes from either field because 77 spaces have no building_name
 * at all; their formal name ("BOS-Holmes-014") still says where they are.
 */
function isListedBostonSpace(space: RawSpace): boolean {
  if (/\(copy\)/i.test(space.space_name) || /^(xx|zz)/i.test(space.space_name)) return false
  return (space.building_name ?? '').startsWith('Boston') || /^BOS-/i.test(space.formal_name ?? '')
}

export async function fetchRegistrarSpaces(): Promise<RegistrarSpace[]> {
  const data = (await get25Live('spaces.json', SPACES_REVALIDATE_SECONDS)) as {
    spaces?: { space?: RawSpace | RawSpace[] }
  }
  const raw = asArray(data?.spaces?.space).filter(isListedBostonSpace)

  // A space with no building borrows it from a sibling with the same formal
  // prefix, so HO 014 lands under "Boston - Holmes Hall" beside HO 070 rather
  // than in a group of its own.
  const buildingByPrefix = new Map<string, string>()
  for (const s of raw) {
    const prefix = formalPrefix(s.formal_name)
    if (prefix && s.building_name) buildingByPrefix.set(prefix, s.building_name)
  }

  return raw
    .map(s => {
      const prefix = formalPrefix(s.formal_name)
      const building =
        s.building_name ||
        (prefix && buildingByPrefix.get(prefix)) ||
        (prefix ? `Boston - ${titleCase(prefix.slice(4))}` : 'Boston - Other')
      const cap = Number(s.max_capacity)
      return {
        id: s.space_id,
        name: s.space_name.trim(),
        building,
        capacity: Number.isFinite(cap) && cap > 0 && cap < 999 ? cap : null,
      }
    })
    .sort((a, b) => a.building.localeCompare(b.building) || a.name.localeCompare(b.name, undefined, { numeric: true }))
}

function titleCase(s: string): string {
  return s.trim().replace(/\b\w/g, c => c.toUpperCase())
}

interface RawReservation {
  reservation_id: number
  reservation_start_dt: string
  reservation_end_dt: string
  spaces?: { space_id: number } | { space_id: number }[]
  event?: { event_name?: string }
}

/** 'YYYY-MM-DD' and minutes after midnight, both in Boston, for an instant. */
function bostonDayAndMinute(iso: string): { day: string; minute: number } | null {
  const at = new Date(iso)
  if (isNaN(at.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '00'
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    // hour12:false gives 24 for midnight in some ICU versions.
    minute: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  }
}

/**
 * Every reservation in the listed spaces on one Boston day.
 *
 * One request covers the whole campus: rm_reservations without a space_id
 * returns all the seat can see, about 200 a weekday and ~200 KB.
 */
export async function fetchRegistrarReservations(
  date: string,
  spaceIds: ReadonlySet<number>
): Promise<RegistrarReservation[]> {
  const compact = date.replaceAll('-', '')
  const data = (await get25Live(
    `rm_reservations.json?start_dt=${compact}&end_dt=${compact}`,
    RESERVATIONS_REVALIDATE_SECONDS
  )) as { space_reservations?: { space_reservation?: RawReservation | RawReservation[] } }

  const out: RegistrarReservation[] = []
  for (const r of asArray(data?.space_reservations?.space_reservation)) {
    const start = bostonDayAndMinute(r.reservation_start_dt)
    const end = bostonDayAndMinute(r.reservation_end_dt)
    if (!start || !end) continue
    // A reservation that runs past midnight is drawn up to the edge of this day.
    const startMinute = start.day < date ? 0 : start.minute
    const endMinute = end.day > date ? 24 * 60 : end.minute
    if (start.day > date || end.day < date || endMinute <= startMinute) continue

    const name = r.event?.event_name?.trim()
    const title = name && name !== '(Private)' ? name : null
    // One reservation can hold several rooms (a suite booked together).
    for (const space of asArray(r.spaces)) {
      if (!spaceIds.has(space.space_id)) continue
      out.push({ id: r.reservation_id, spaceId: space.space_id, startMinute, endMinute, title })
    }
  }
  return out.sort((a, b) => a.spaceId - b.spaceId || a.startMinute - b.startMinute)
}
