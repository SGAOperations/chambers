/**
 * `nussoFetch()`: a drop-in for `fetch('/api/nusso/...')` on the Browse/Book
 * page that, when the Chambers for NUSSO extension is installed, answers from
 * EMS through the booker's own browser instead of Chambers' server.
 *
 * Why: Northeastern accepts connections to nuevents.neu.edu only from the
 * campus network or the VPN. Chambers' servers are outside it; the person
 * using Chambers on campus or the VPN is not. The NUSSO client
 * (lib/nusso/client.ts) runs here unchanged, with every ServerApi call sent by
 * the extension (lib/nusso/extension.ts) under the person's own NUSSO sign-in.
 *
 * It answers the same paths with the same JSON as the API routes, so the pages
 * do not care which one ran:
 *   GET  /api/nusso/rooms?date=     -> { date, rooms }
 *   GET  /api/nusso/bookings?date=  -> { date, bookings }
 *   POST /api/nusso/search          -> { count, rooms }
 *   POST /api/nusso/book            -> /book/prepare (server checks), the
 *                                      reservation (browser), /book/record
 * Anything else, or no extension, goes to the server as before.
 *
 * Browser-only.
 */
import {
  browseBookings,
  browseRooms,
  createBooking,
  listRoomsForWindow,
  searchAvailableRooms,
  setEmsTransport,
  type NussoBookingSettings,
} from './client'
import { reservationProfile } from './config'
import { detectNussoExtension, extensionEmsCall } from './extension'
import { NussoApiError, NussoAuthError, NussoUnreachableError, type NussoBookingRequest } from './types'
import { buildWindow, isValidWindow } from './window'

let detected: Promise<string | null> | null = null

/** The installed extension's version, or null. Asked once per page load. */
export function nussoExtensionVersion(): Promise<string | null> {
  if (!detected) {
    detected = detectNussoExtension().then(version => {
      // Every NUSSO call this page makes from now on goes through the extension.
      if (version) setEmsTransport(extensionEmsCall)
      return version
    })
  }
  return detected
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

/** The same status/message split as handleNussoError, for errors raised in the browser. */
function errorResponse(err: unknown): Response {
  if (err instanceof NussoUnreachableError) return json({ error: err.message }, 503)
  if (err instanceof NussoAuthError) return json({ error: err.message }, 401)
  if (err instanceof NussoApiError) return json({ error: err.message }, 502)
  console.error('Unexpected NUSSO error:', err)
  return json({ error: 'Something went wrong talking to NUSSO.' }, 500)
}

function dayWindow(date: string) {
  return { date: `${date} 00:00:00`, start: `${date} 00:00:00`, end: `${date} 23:59:59` }
}

async function postJson(path: string, body: unknown): Promise<{ res: Response; data: Record<string, unknown> }> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { res, data }
}

/**
 * Book through the extension: the server checks and hands over the request
 * (prepare), the browser makes the reservation, the server records it.
 */
async function book(form: Record<string, unknown>): Promise<Response> {
  const prepared = await postJson('/api/nusso/book/prepare', form)
  if (!prepared.res.ok) return json(prepared.data, prepared.res.status)
  const { request, reservationType, settings } = prepared.data as {
    request: NussoBookingRequest
    reservationType: string
    settings: NussoBookingSettings
  }

  let result
  try {
    result = await createBooking(request, reservationProfile(reservationType), settings)
  } catch (err) {
    // If the extension stopped answering mid-SaveReservation, the reservation
    // may exist. Never suggest simply trying again.
    if (err instanceof NussoUnreachableError && !err.code) {
      return json({ error: `${err.message} The reservation may or may not have been made: check My Reservations on nuevents.neu.edu before booking again.` }, 503)
    }
    return errorResponse(err)
  }

  const recorded = await postJson('/api/nusso/book/record', { ...form, reservationId: result.reservationId }).catch(() => null)
  // EMS's raw answer stays out of the page, as with the server route's JSON.
  const summary: Partial<typeof result> = { ...result }
  delete summary.raw
  if (!recorded?.res.ok || recorded.data.chambersBookingRecorded !== true) {
    return json({
      ...summary,
      chambersBookingRecorded: false,
      warning:
        (recorded?.data.warning as string | undefined) ??
        `Booked in NUSSO as reservation #${result.reservationId}, but it could not be recorded in Chambers/My Rooms. Add it manually as a booking with reservation code ${result.reservationId}.`,
    })
  }
  return json({ ...summary, ...recorded.data })
}

async function handleLocally(path: string, init?: RequestInit): Promise<Response | null> {
  const url = new URL(path, 'http://chambers.local')
  const method = (init?.method ?? 'GET').toUpperCase()
  const body = (): Record<string, unknown> => (typeof init?.body === 'string' ? JSON.parse(init.body) : {})

  try {
    if (method === 'GET' && (url.pathname === '/api/nusso/rooms' || url.pathname === '/api/nusso/bookings')) {
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'date must be YYYY-MM-DD' }, 400)
      return url.pathname.endsWith('/rooms')
        ? json({ date, rooms: await browseRooms(dayWindow(date)) })
        : json({ date, bookings: await browseBookings(dayWindow(date)) })
    }

    if (method === 'POST' && url.pathname === '/api/nusso/search') {
      const b = body() as { date?: string; start?: string; end?: string; capacity?: number; reservationType?: string; includeUnavailable?: boolean }
      if (!b.date || !b.start || !b.end || !isValidWindow(b.date, b.start, b.end)) {
        return json({ error: 'date, start and end (start before end) are required' }, 400)
      }
      const cap = typeof b.capacity === 'number' && b.capacity > 0 ? b.capacity : 0
      const rooms = await (b.includeUnavailable === true ? listRoomsForWindow : searchAvailableRooms)(
        buildWindow(b.date, b.start, b.end),
        reservationProfile(b.reservationType),
        cap
      )
      return json({ count: rooms.length, rooms })
    }

    if (method === 'POST' && url.pathname === '/api/nusso/book') return await book(body())
  } catch (err) {
    return errorResponse(err)
  }
  return null
}

/**
 * fetch() for /api/nusso/* that goes through the extension when it is
 * installed. Same arguments and Response as fetch().
 */
export async function nussoFetch(path: string, init?: RequestInit): Promise<Response> {
  if (await nussoExtensionVersion()) {
    const local = await handleLocally(path, init)
    if (local) return local
  }
  return fetch(path, init)
}
