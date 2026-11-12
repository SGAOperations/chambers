import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Northeastern now only accepts connections to nuevents.neu.edu from the
 * campus network / VPN, so from Vercel every fetch to EMS fails before any
 * HTTP response. That must come back as a clear 503, not the catch-all 500.
 */

beforeAll(() => {
  process.env.NUSSO_USERNAME = 'test-user'
  process.env.NUSSO_PASSWORD = 'test-pass'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('EMS unreachable', () => {
  it('becomes a NussoUnreachableError carrying the transport code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })
      })
    )
    const { browseRooms } = await import('@/lib/nusso/client')
    const { buildWindow } = await import('@/lib/nusso/window')
    const { NussoUnreachableError } = await import('@/lib/nusso/types')

    const err = await browseRooms(buildWindow('2026-11-10', '14:00', '15:00')).catch(e => e)
    expect(err).toBeInstanceOf(NussoUnreachableError)
    expect(err.code).toBe('UND_ERR_CONNECT_TIMEOUT')
  })

  it('is answered with a 503 by the route error handler', async () => {
    const { handleNussoError } = await import('@/lib/nusso/http')
    const { NussoUnreachableError } = await import('@/lib/nusso/types')
    const res = handleNussoError(new NussoUnreachableError('Could not reach nuevents.neu.edu', 'ECONNRESET'))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/Northeastern network.*extension/)
  })
})

describe('NUSSO relays', () => {
  const R1 = 'https://chambers-relay-1.tail0000.ts.net'
  const R2 = 'https://chambers-relay-2.tail0000.ts.net'
  const SECRET = 's'.repeat(40)

  beforeAll(() => {
    process.env.NUSSO_RELAY_URLS = `${R1}, ${R2}/`
    process.env.NUSSO_RELAY_SECRET = SECRET
  })
  afterAll(() => {
    delete process.env.NUSSO_RELAY_URLS
    delete process.env.NUSSO_RELAY_SECRET
  })
  beforeEach(() => {
    vi.resetModules()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  const relayRes = (body: string, init: ResponseInit = {}) =>
    new Response(body, { ...init, headers: { 'X-Nusso-Relay': '1', ...(init.headers as object) } })
  const fetchFailed = (code: string) => new TypeError('fetch failed', { cause: { code } })

  /** fetch for a whole successful login + one ServerApi call, via whichever relay answers. */
  function emsThrough(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return handler(url, init)
      })
    )
    return calls
  }
  const emsAnswer = (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    if (path === '/' && (init.method ?? 'GET') === 'GET') {
      return relayRes('<input name="__VIEWSTATE" value="vs"><input name="deaCSRFToken" value="pre">')
    }
    if (path === '/') {
      return relayRes('', { status: 302, headers: { 'Set-Cookie': 'EMSCookie=auth; path=/', Location: '/Default.aspx' } })
    }
    if (path === '/BrowseForSpace.aspx') return relayRes('<input id="deaCSRFToken" value="tok">')
    return relayRes(JSON.stringify({ d: JSON.stringify({ Buildings: [] }) }), { headers: { 'Content-Type': 'application/json' } })
  }

  it('sends EMS requests to the relay with the secret, keeping the EMS path', async () => {
    const calls = emsThrough(emsAnswer)
    const { browseRooms } = await import('@/lib/nusso/client')
    const { buildWindow } = await import('@/lib/nusso/window')
    await browseRooms(buildWindow('2026-11-10', '14:00', '15:00'))

    expect(calls.every(c => c.url.startsWith(R1))).toBe(true)
    expect(calls.map(c => new URL(c.url).pathname)).toContain('/ServerApi.aspx/GetBrowseLocationsRooms')
    expect(new Headers(calls[0].init.headers).get('X-Relay-Secret')).toBe(SECRET)
    // EMS-facing headers still name EMS, not the relay.
    const api = calls.find(c => c.url.includes('ServerApi'))!
    expect(new Headers(api.init.headers).get('Origin')).toBe('https://nuevents.neu.edu')
  })

  it('moves to the second Pi when the first cannot be reached, and stays there', async () => {
    const calls = emsThrough((url, init) => {
      if (url.startsWith(R1)) throw fetchFailed('ENOTFOUND')
      return emsAnswer(url, init)
    })
    const { browseRooms } = await import('@/lib/nusso/client')
    const { buildWindow } = await import('@/lib/nusso/window')
    await browseRooms(buildWindow('2026-11-10', '14:00', '15:00'))

    expect(calls.filter(c => c.url.startsWith(R1))).toHaveLength(1)
    expect(calls.at(-1)!.url.startsWith(R2)).toBe(true)
  })

  it('treats a response not marked by the relay (Funnel, Pi offline) as unreached', async () => {
    const calls = emsThrough((url, init) => {
      if (url.startsWith(R1)) return new Response('Bad Gateway', { status: 502 })
      return emsAnswer(url, init)
    })
    const { browseRooms } = await import('@/lib/nusso/client')
    const { buildWindow } = await import('@/lib/nusso/window')
    await expect(browseRooms(buildWindow('2026-11-10', '14:00', '15:00'))).resolves.toBeDefined()
    expect(calls.at(-1)!.url.startsWith(R2)).toBe(true)
  })

  it('never resends a POST that was lost mid-request', async () => {
    const calls = emsThrough((url, init) => {
      if (new URL(url).pathname === '/' && init.method === 'POST') throw fetchFailed('ECONNRESET')
      return emsAnswer(url, init)
    })
    const { browseRooms } = await import('@/lib/nusso/client')
    const { buildWindow } = await import('@/lib/nusso/window')
    const { NussoUnreachableError } = await import('@/lib/nusso/types')
    const err = await browseRooms(buildWindow('2026-11-10', '14:00', '15:00')).catch(e => e)

    expect(err).toBeInstanceOf(NussoUnreachableError)
    expect(calls.filter(c => c.init.method === 'POST')).toHaveLength(1)
  })

  it('is unreachable when every Pi is down', async () => {
    emsThrough(url => {
      if (url.startsWith(R1)) throw fetchFailed('UND_ERR_CONNECT_TIMEOUT')
      return relayRes('{"error":"relay could not connect to EMS"}', { status: 502, headers: { 'X-Relay-Error': 'connect' } })
    })
    const { browseRooms } = await import('@/lib/nusso/client')
    const { buildWindow } = await import('@/lib/nusso/window')
    const { NussoUnreachableError } = await import('@/lib/nusso/types')
    const err = await browseRooms(buildWindow('2026-11-10', '14:00', '15:00')).catch(e => e)
    expect(err).toBeInstanceOf(NussoUnreachableError)
    expect(err.message).toMatch(/chambers-relay-1.*chambers-relay-2/)
  })

  it('reports a wrong secret as configuration, not an outage', async () => {
    emsThrough(() => relayRes('{"error":"unauthorized"}', { status: 401, headers: { 'X-Relay-Error': 'auth' } }))
    const { browseRooms } = await import('@/lib/nusso/client')
    const { buildWindow } = await import('@/lib/nusso/window')
    const { NussoConfigError } = await import('@/lib/nusso/types')
    const err = await browseRooms(buildWindow('2026-11-10', '14:00', '15:00')).catch(e => e)
    expect(err).toBeInstanceOf(NussoConfigError)
  })
})
