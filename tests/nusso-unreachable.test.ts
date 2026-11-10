import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

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
    expect((await res.json()).error).toMatch(/Northeastern network/)
  })
})
