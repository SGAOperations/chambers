import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SgaSession } from '@nusgaops/sgauth'
import { createTestDb, type TestDb } from './helpers/db'
import { emptyDataApi, sessionFor } from './helpers/sgauth'

/**
 * The gates on the main admin and membership routes under SGAUTH_ENABLED
 * (issues #151, #152, #156): who gets 401, 403, 410 or through, given only an
 * SGAuth session. What a route does after its gate is not under test here, so
 * the Data API is an empty stand-in; the session, roles and position map run
 * for real on an in-process Postgres.
 */

const state = vi.hoisted(() => ({ db: null as TestDb | null, session: null as SgaSession | null }))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@nusgaops/sgauth', async original => ({
  ...(await original<typeof import('@nusgaops/sgauth')>()),
  createSgauthClient: () => ({ getSession: async () => state.session, clearCache: () => {} }),
}))
vi.mock('@/lib/better-auth', () => ({ auth: { api: { getSession: async () => null } } }))
vi.mock('@/lib/db/pool', () => ({
  pool: {
    query: (text: string, params?: unknown[]) => state.db!.pool.query(text, params),
    connect: () => state.db!.pool.connect(),
  },
}))
vi.mock('@/lib/db/data-api', () => ({ db: emptyDataApi() }))
vi.mock('@/lib/check-rate-limit', () => ({ checkRateLimit: async () => null }))

const { clearPositionSyncMemo } = await import('@/lib/position-sync')
const positionsRoute = await import('@/app/api/administrator/bodies/positions/route')
const bodiesRoute = await import('@/app/api/administrator/bodies/route')
const requestsRoute = await import('@/app/api/administrator/requests/route')
const usersRoute = await import('@/app/api/administrator/users/route')
const adminMembershipsRoute = await import('@/app/api/administrator/users/memberships/route')
const membershipRequestsRoute = await import('@/app/api/administrator/membership-requests/route')
const myMembershipsRoute = await import('@/app/api/me/memberships/route')
const onboardingMembershipsRoute = await import('@/app/api/onboarding/memberships/route')

const VPOA = ['vice-president-of-operational-affairs']
const COMPTROLLER = ['comptroller']
const SBP = ['student-body-president']

function as(email: string, positions: string[] | null) {
  state.session = positions ? sessionFor(email, positions) : null
}

function json(body: unknown, method = 'POST'): Request {
  return new Request('http://localhost/api', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(async () => {
  process.env.SGAUTH_ENABLED = 'true'
  state.db = await createTestDb([
    { name: 'Senate', division: 'Senate' },
    { name: 'Appeals Board', division: 'Office of the President' },
  ])
  clearPositionSyncMemo()
})
afterEach(() => {
  delete process.env.SGAUTH_ENABLED
})

describe('Bodies tab position map', () => {
  it('is closed to the signed out, to non-admins, and to admins outside Management', async () => {
    as('nobody@northeastern.edu', null)
    expect((await positionsRoute.GET()).status).toBe(401)
    as('senator@northeastern.edu', ['senator'])
    expect((await positionsRoute.GET()).status).toBe(401)
    as('comptroller@northeastern.edu', COMPTROLLER)
    expect((await positionsRoute.GET()).status).toBe(403)
  })

  it('shows Management the positions and the seats', async () => {
    as('vpoa@northeastern.edu', VPOA)
    const res = await positionsRoute.GET()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.live).toBe(true)
    expect(data.positions.length).toBeGreaterThan(80)
    expect(data.seats).toContainEqual(expect.objectContaining({ position_key: 'senator', role: 'Member' }))
  })

  it('a save changes memberships for people already signed in, at once', async () => {
    as('senator@northeastern.edu', ['senator'])
    const senator = (await (await import('@/lib/auth')).getAuthedUser())!
    expect(await state.db!.memberships(senator.id)).toEqual({ Senate: 'Member' })

    as('vpoa@northeastern.edu', VPOA)
    const res = await positionsRoute.PUT(
      json({ body_id: state.db!.bodyIds.get('Appeals Board'), leadership: ['senator'], member: [] }, 'PUT')
    )
    expect(res.status).toBe(200)
    expect(await state.db!.memberships(senator.id)).toEqual({ 'Appeals Board': 'Leadership', Senate: 'Member' })
  })

  it('refuses something that is not a position key', async () => {
    as('vpoa@northeastern.edu', VPOA)
    const res = await positionsRoute.PUT(
      json({ body_id: state.db!.bodyIds.get('Senate'), leadership: ['Speaker of the Senate'], member: [] }, 'PUT')
    )
    expect(res.status).toBe(400)
  })

  it('is closed to the Comptroller for writing too', async () => {
    as('comptroller@northeastern.edu', COMPTROLLER)
    const res = await positionsRoute.PUT(
      json({ body_id: state.db!.bodyIds.get('Senate'), leadership: [], member: [] }, 'PUT')
    )
    expect(res.status).toBe(403)
  })
})

describe('admin routes gate on positions', () => {
  it('editing bodies is Management only', async () => {
    as('comptroller@northeastern.edu', COMPTROLLER)
    expect((await bodiesRoute.POST(json({ name: 'X', division: 'Senate' }))).status).toBe(403)
    as('vpoa@northeastern.edu', VPOA)
    expect((await bodiesRoute.POST(json({ name: 'X', division: 'Senate' }))).status).toBe(200)
  })

  it('reading bodies is any admin, and no one else', async () => {
    as('senator@northeastern.edu', ['senator'])
    expect((await bodiesRoute.GET()).status).toBe(401)
    as('sbp@northeastern.edu', SBP)
    expect((await bodiesRoute.GET()).status).toBe(200)
  })

  it('room requests are closed to the view-only office and open to the Comptroller', async () => {
    as('sbp@northeastern.edu', SBP)
    expect((await requestsRoute.GET()).status).toBe(403)
    as('comptroller@northeastern.edu', COMPTROLLER)
    expect((await requestsRoute.GET()).status).toBe(200)
  })

  it('room requests are closed to body Leadership and to IEMS', async () => {
    as('speaker@northeastern.edu', ['speaker-of-the-senate'])
    expect((await requestsRoute.GET()).status).toBe(401)
    as('events@northeastern.edu', ['director-of-events'])
    expect((await requestsRoute.GET()).status).toBe(401)
  })
})

describe('user and membership management is SGAuth\'s', () => {
  it('the Users routes answer 410, even to Management', async () => {
    as('vpoa@northeastern.edu', VPOA)
    expect((await usersRoute.GET()).status).toBe(410)
    expect((await usersRoute.POST(json({ email: 'new@northeastern.edu', full_name: 'New' }))).status).toBe(410)
    expect((await usersRoute.PATCH(json({ id: 'x', is_active: false }, 'PATCH'))).status).toBe(410)
    expect((await adminMembershipsRoute.POST(json({}))).status).toBe(410)
    expect((await membershipRequestsRoute.GET()).status).toBe(410)
  })

  it('nobody joins, leaves or requests a body by hand', async () => {
    as('student@northeastern.edu', [])
    expect((await myMembershipsRoute.POST(json({ body_id: 'x' }))).status).toBe(410)
    expect((await myMembershipsRoute.DELETE(json({ id: 'x' }, 'DELETE'))).status).toBe(410)
    expect((await onboardingMembershipsRoute.POST(json({ body_ids: [] }))).status).toBe(410)
  })
})
