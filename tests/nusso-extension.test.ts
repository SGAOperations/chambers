import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Booking NUSSO through the Chambers for NUSSO extension: the page runs the
 * NUSSO client and the extension sends each ServerApi call from the booker's
 * own browser. Chambers' server only checks (/book/prepare) and records
 * (/book/record); it never talks to EMS.
 *
 * Part 1 drives lib/nusso/local.ts with a stand-in for chrome.runtime.
 * Part 2 loads the real extension worker (extension/nusso/background.js)
 * against a stand-in for EMS.
 */

type Reply = Record<string, unknown> | undefined
type ExtHandler = (msg: { type: string; method?: string; body?: unknown; referer?: string }) => Reply

function stubExtension(handler: ExtHandler | null) {
  const sent: { type: string; method?: string; body?: unknown }[] = []
  const runtime = {
    lastError: undefined as { message: string } | undefined,
    sendMessage(_id: string, msg: { type: string }, cb: (r: Reply) => void) {
      sent.push(msg)
      if (!handler) {
        runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' }
        cb(undefined)
        runtime.lastError = undefined
        return
      }
      queueMicrotask(() => cb(handler(msg)))
    },
  }
  vi.stubGlobal('chrome', { runtime })
  return sent
}

const d = (v: unknown) => ({ ok: true, data: { d: JSON.stringify(v) } })

const room = (id: number, code: string, daysAvailable = 1) => ({
  RoomId: id, RoomCode: code, RoomDescription: '', BuildingId: 1, BuildingDescription: 'Curry Student Center',
  Capacity: 30, DefaultSetupTypeId: 7, AvailableSetupTypes: '', Alert: null, Location: '', DaysAvailable: daysAvailable,
})

const FORM = {
  reservationType: 'room-request', roomId: 42, setupTypeId: 7, attendance: 12, eventName: 'Finance Committee',
  roomName: 'Curry Student Center — 333', date: '2026-12-01', start: '18:00', end: '19:00', scope: 'body', body_id: 'b1',
}

describe('Browse/Book through the extension (lib/nusso/local.ts)', () => {
  let serverCalls: { path: string; body: Record<string, unknown> }[]

  beforeEach(() => {
    vi.resetModules()
    serverCalls = []
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      serverCalls.push({ path, body })
      if (path === '/api/nusso/book/prepare') {
        return Response.json({
          request: { roomId: 42, setupTypeId: 7, attendance: 12, eventName: 'SGA - Finance Committee', udfs: [],
            window: { date: '2026-12-01 00:00:00', start: '2026-12-01 18:00:00', end: '2026-12-01 19:00:00' } },
          reservationType: 'room-request',
          settings: {
            org: { groupId: 225399, timeZoneId: 61 },
            contact: { firstContactName: 'SGA', firstContactEmail: 'ops@example.edu', firstContactPhone: '617-555-0100' },
            requestor: { id: -1, name: '', email: '', phone: '' },
          },
        })
      }
      if (path === '/api/nusso/book/record') return Response.json({ chambersBookingId: 'cb-1', chambersBookingRecorded: true })
      return Response.json({ error: 'server path' }, { status: 503 })
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('searches rooms through the extension, never the server', async () => {
    stubExtension(msg => {
      if (msg.type === 'hello') return { ok: true, version: '1.0.0' }
      if (msg.method === 'GetAvailabilityList') return d({ Availability: [room(42, 'CSC 333'), room(43, 'CSC 335')] })
      if (msg.method === 'GetBrowseLocationsBookings') {
        return d({ Bookings: [{ Id: 1, RoomId: 43, EventStart: '2026-12-01T17:30:00', EventEnd: '2026-12-01T18:30:00',
          TimeBookingStart: '2026-12-01T17:30:00', TimeBookingEnd: '2026-12-01T18:30:00' }] })
      }
    })
    const { nussoFetch } = await import('@/lib/nusso/local')
    const res = await nussoFetch('/api/nusso/search', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-12-01', start: '18:00', end: '19:00', includeUnavailable: true }),
    })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.rooms.map((r: { RoomId: number; Available: boolean }) => [r.RoomId, r.Available])).toEqual([[42, true], [43, false]])
    expect(serverCalls).toEqual([])
  })

  it('books: server checks, browser reserves, server records', async () => {
    const sent = stubExtension(msg => {
      if (msg.type === 'hello') return { ok: true, version: '1.0.0' }
      if (msg.method === 'SaveReservation') {
        return d({ Success: true, SuccessMessage: JSON.stringify({ ReservationId: 777, EmailError: false }) })
      }
      return d({})
    })
    const { nussoFetch } = await import('@/lib/nusso/local')
    const res = await nussoFetch('/api/nusso/book', { method: 'POST', body: JSON.stringify(FORM) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toMatchObject({ reservationId: 777, chambersBookingRecorded: true, chambersBookingId: 'cb-1' })
    expect(data.raw).toBeUndefined()
    expect(sent.filter(m => m.type === 'serverApi').map(m => m.method)).toEqual(['AddToCartCheck', 'GetServicesForBooking', 'SaveReservation'])
    // The SGA-side values came from the server, not the browser's (empty) environment.
    const save = sent.find(m => m.method === 'SaveReservation')!.body as { reservationDetails: Record<string, unknown> }
    expect(save.reservationDetails).toMatchObject({ GroupId: 225399, FirstPhoneOne: '617-555-0100', EventName: 'SGA - Finance Committee' })
    expect(serverCalls.map(c => c.path)).toEqual(['/api/nusso/book/prepare', '/api/nusso/book/record'])
    expect(serverCalls[1].body).toMatchObject({ ...FORM, reservationId: 777 })
  })

  it('does not reserve when the server refuses the booking', async () => {
    const sent = stubExtension(msg => (msg.type === 'hello' ? { ok: true, version: '1.0.0' } : d({})))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Only Leadership and administrators may book NUSSO spaces.' }, { status: 403 })))
    const { nussoFetch } = await import('@/lib/nusso/local')
    const res = await nussoFetch('/api/nusso/book', { method: 'POST', body: JSON.stringify(FORM) })

    expect(res.status).toBe(403)
    expect(sent.some(m => m.type === 'serverApi')).toBe(false)
  })

  it('tells a signed-out booker to sign in to NUSSO', async () => {
    stubExtension(msg =>
      msg.type === 'hello'
        ? { ok: true, version: '1.0.0' }
        : { ok: false, code: 'signed-out', error: 'You are not signed in to NUSSO in this browser. Sign in at nuevents.neu.edu, then try again.' }
    )
    const { nussoFetch } = await import('@/lib/nusso/local')
    const res = await nussoFetch('/api/nusso/rooms?date=2026-12-01')
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/Sign in at nuevents\.neu\.edu/)
  })

  it('tells an off-campus booker to connect to the VPN', async () => {
    stubExtension(msg =>
      msg.type === 'hello'
        ? { ok: true, version: '1.0.0' }
        : { ok: false, code: 'unreachable', error: 'Could not reach nuevents.neu.edu. Connect to campus Wi-Fi or the Northeastern VPN.' }
    )
    const { nussoFetch } = await import('@/lib/nusso/local')
    const res = await nussoFetch('/api/nusso/bookings?date=2026-12-01')
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/VPN/)
  })

  it('falls back to the server when the extension is not installed', async () => {
    stubExtension(null)
    const { nussoFetch } = await import('@/lib/nusso/local')
    const res = await nussoFetch('/api/nusso/rooms?date=2026-12-01')
    expect(res.status).toBe(503)
    expect(serverCalls.map(c => c.path)).toEqual(['/api/nusso/rooms?date=2026-12-01'])
  })
})

describe('The extension worker (extension/nusso/background.js)', () => {
  type Listener = (msg: unknown, sender: unknown, send: (r: unknown) => void) => boolean
  let listener: Listener
  let sessionRules: { action: { requestHeaders: { header: string; value: string }[] } }[]
  let emsCalls: { url: string; init: RequestInit }[]

  async function load(ems: (url: string, init: RequestInit) => Response | Promise<Response>) {
    vi.resetModules()
    sessionRules = []
    emsCalls = []
    vi.stubGlobal('chrome', {
      runtime: {
        getManifest: () => ({ version: '1.0.0' }),
        onMessageExternal: { addListener: (l: Listener) => { listener = l } },
      },
      action: { onClicked: { addListener: () => {} } },
      tabs: { create: () => {} },
      declarativeNetRequest: {
        updateSessionRules: async ({ addRules }: { addRules: typeof sessionRules }) => { sessionRules = addRules },
      },
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      emsCalls.push({ url, init })
      return ems(url, init)
    }))
    // @ts-expect-error -- a plain extension script, imported for its listeners
    await import('../extension/nusso/background.js')
  }

  const ask = (msg: unknown) => new Promise<Record<string, unknown>>(resolve => listener(msg, {}, r => resolve(r as Record<string, unknown>)))
  const page = (html: string) => new Response(html, { headers: { 'Content-Type': 'text/html' } })
  // What fetch(redirect: 'manual') gives for a 302 to the login page.
  const redirect = () => ({ type: 'opaqueredirect', status: 0, ok: false, text: async () => '' }) as unknown as Response

  afterEach(() => vi.unstubAllGlobals())

  it('sends an allowed call with your session and the page CSRF token', async () => {
    await load((url, init) => {
      if (url.endsWith('/BrowseForSpace.aspx')) return page('<input type="hidden" id="deaCSRFToken" value="TOK">')
      return Response.json({ d: JSON.stringify({ Buildings: [] }), echo: init.body })
    })
    const reply = await ask({ type: 'serverApi', method: 'GetBrowseLocationsRooms', body: { a: 1 }, referer: 'https://nuevents.neu.edu/BrowseForSpace.aspx' })

    expect(reply.ok).toBe(true)
    const api = emsCalls.find(c => c.url.includes('ServerApi'))!
    expect(api.url).toBe('https://nuevents.neu.edu/ServerApi.aspx/GetBrowseLocationsRooms')
    expect(api.init.credentials).toBe('include')
    expect((api.init.headers as Record<string, string>)['dea-CSRFToken']).toBe('TOK')
    const headers = sessionRules.flatMap(r => r.action.requestHeaders.map(h => `${h.header}: ${h.value}`))
    expect(headers).toEqual(['Origin: https://nuevents.neu.edu', 'Referer: https://nuevents.neu.edu/BrowseForSpace.aspx'])
  })

  it('refuses calls Chambers does not make, without contacting EMS', async () => {
    await load(() => page(''))
    const reply = await ask({ type: 'serverApi', method: 'DeleteEverything', body: {} })
    expect(reply).toMatchObject({ ok: false, code: 'refused' })
    expect(emsCalls).toEqual([])
  })

  it('reports signed-out when EMS bounces to its login page', async () => {
    await load(() => redirect())
    expect(await ask({ type: 'status' })).toEqual({ ok: true, signedIn: false })
    expect(await ask({ type: 'serverApi', method: 'GetBrowseLocationsRooms', body: {} })).toMatchObject({ ok: false, code: 'signed-out' })
  })

  it('reports unreachable off campus', async () => {
    await load(() => { throw new TypeError('Failed to fetch') })
    expect(await ask({ type: 'serverApi', method: 'GetBrowseLocationsRooms', body: {} })).toMatchObject({ ok: false, code: 'unreachable' })
  })

  it('refreshes the token once when the session lapsed mid-way', async () => {
    let apiCalls = 0
    await load(url => {
      if (url.endsWith('/BrowseForSpace.aspx')) return page('<input name="deaCSRFToken" value="T">')
      apiCalls++
      return apiCalls === 1 ? page('<html>login</html>') : Response.json({ d: '{}' })
    })
    expect(await ask({ type: 'serverApi', method: 'GetAvailabilityList', body: {} })).toMatchObject({ ok: true })
    expect(apiCalls).toBe(2)
  })
})
