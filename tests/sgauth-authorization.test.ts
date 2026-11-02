import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SgaSession } from '@nusgaops/sgauth'
import { createTestDb, type TestDb } from './helpers/db'
import { sessionFor } from './helpers/sgauth'

/**
 * Who may do what, end to end under SGAUTH_ENABLED (issue #156): an SGAuth
 * session with some positions goes in, and getAuthedUserWithLiveRoles() -- the
 * check every admin route makes -- and the body memberships every booking
 * route reads come out. Only the SDK's network call is faked; the session
 * resolution, position sync and SQL are the real ones, on a real Postgres.
 */

const state = vi.hoisted(() => ({
  db: null as TestDb | null,
  session: null as SgaSession | null,
  betterAuthUserId: null as string | null,
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@nusgaops/sgauth', async original => ({
  ...(await original<typeof import('@nusgaops/sgauth')>()),
  createSgauthClient: () => ({ getSession: async () => state.session, clearCache: () => {} }),
}))
vi.mock('@/lib/better-auth', () => ({
  auth: {
    api: {
      getSession: async () =>
        state.betterAuthUserId
          ? { user: { id: state.betterAuthUserId, email: 'legacy@northeastern.edu' }, session: { createdAt: new Date() } }
          : null,
    },
  },
}))
vi.mock('@/lib/db/pool', () => ({
  pool: {
    query: (text: string, params?: unknown[]) => state.db!.pool.query(text, params),
    connect: () => state.db!.pool.connect(),
  },
}))

const { getAuthedUser } = await import('@/lib/auth')
const { getAuthedUserWithLiveRoles } = await import('@/lib/authorization')
const { clearPositionSyncMemo } = await import('@/lib/position-sync')
const { resolveShellIdentity } = await import('@/lib/shell-identity')
const { canWriteAdmin, isManagementRole } = await import('@/lib/admin-roles')
const { hasLiveAdmin } = await import('@/lib/auth-types')

const BODIES = [
  { name: 'Senate', division: 'Senate' },
  { name: 'Campus Services Committee', division: 'Campus Affairs' },
]

async function signIn(email: string, positions: string[]) {
  state.session = sessionFor(email, positions)
  return getAuthedUserWithLiveRoles()
}

describe('under SGAUTH_ENABLED', () => {
  beforeEach(async () => {
    process.env.SGAUTH_ENABLED = 'true'
    state.db = await createTestDb(BODIES)
    state.session = null
    state.betterAuthUserId = null
    clearPositionSyncMemo()
  })
  afterEach(() => {
    delete process.env.SGAUTH_ENABLED
  })

  it('a Management office runs Management', async () => {
    const user = await signIn('vpoa@northeastern.edu', ['vice-president-of-operational-affairs'])
    expect(user?.app_metadata).toMatchObject({ is_admin: true, admin_role: 'Vice President of Operational Affairs' })
    expect(hasLiveAdmin(user!)).toBe(true)
    expect(isManagementRole(user!.app_metadata.admin_role)).toBe(true)
  })

  it('the Comptroller books but does not run Management', async () => {
    const user = await signIn('comptroller@northeastern.edu', ['comptroller'])
    expect(user?.app_metadata.admin_role).toBe('Comptroller')
    expect(isManagementRole(user!.app_metadata.admin_role)).toBe(false)
    expect(canWriteAdmin(user!.app_metadata.admin_role)).toBe(true)
  })

  it('the Student Body President reads Bookings and changes nothing', async () => {
    const user = await signIn('sbp@northeastern.edu', ['student-body-president'])
    expect(user?.app_metadata.is_admin).toBe(true)
    expect(canWriteAdmin(user!.app_metadata.admin_role)).toBe(false)
  })

  it('the higher office wins when someone holds two', async () => {
    const user = await signIn('both@northeastern.edu', ['student-body-president', 'executive-vice-president'])
    expect(user?.app_metadata.admin_role).toBe('Executive Vice President')
  })

  it('an IEMS office gets IEMS and nothing admin', async () => {
    const user = await signIn('events@northeastern.edu', ['director-of-events'])
    expect(user?.app_metadata).toMatchObject({ is_admin: false, iems_role: 'Director of Events' })
    expect(user?.app_metadata.admin_role).toBeUndefined()
  })

  it('a body member is a member of that body and nothing more', async () => {
    const user = await signIn('senator@northeastern.edu', ['senator'])
    expect(user?.app_metadata.is_admin).toBe(false)
    expect(await state.db!.memberships(user!.id)).toEqual({ Senate: 'Member' })
  })

  it('body Leadership comes from a leadership position', async () => {
    const user = await signIn('vpca@northeastern.edu', ['vice-president-of-campus-affairs'])
    expect(user?.app_metadata.is_admin).toBe(false)
    expect(await state.db!.memberships(user!.id)).toEqual({ 'Campus Services Committee': 'Leadership' })
  })

  it('someone with no positions is signed in with no roles and no bodies', async () => {
    const user = await signIn('student@northeastern.edu', [])
    expect(user).not.toBeNull()
    expect(user?.app_metadata).toMatchObject({ is_admin: false })
    expect(user?.app_metadata.iems_role).toBeUndefined()
    expect(await state.db!.memberships(user!.id)).toEqual({})
  })

  it('a Chambers admin_role left on the row grants nothing: positions are the only source', async () => {
    await state.db!.addUser('stale@northeastern.edu', { admin_role: 'Comptroller' })
    const user = await signIn('stale@northeastern.edu', [])
    expect(user?.app_metadata.is_admin).toBe(false)
  })

  it('someone deactivated in SGAuth has no session, so is signed out everywhere', async () => {
    state.session = null
    expect(await getAuthedUser()).toBeNull()
    expect(await getAuthedUserWithLiveRoles()).toBeNull()
    expect(await resolveShellIdentity()).toEqual({ status: 'unauthenticated' })
  })

  it('Chambers keeps no deactivation of its own: is_active false does not lock out a valid session', async () => {
    await state.db!.addUser('old-flag@northeastern.edu', { is_active: false, has_completed_onboarding: true })
    const user = await signIn('old-flag@northeastern.edu', ['senator'])
    expect(user).not.toBeNull()
    const shell = await resolveShellIdentity()
    expect(shell.status).toBe('ok')
  })

  it('the dashboard shell shows the roles positions give', async () => {
    await state.db!.addUser('im@northeastern.edu', { has_completed_onboarding: true })
    state.session = sessionFor('im@northeastern.edu', ['information-manager', 'speaker-of-the-senate'])
    const shell = await resolveShellIdentity()
    expect(shell).toMatchObject({
      status: 'ok',
      identity: { isAdmin: true, adminRole: 'Information Manager', isLeadership: true, isIEMS: false },
    })
  })

  it('links an existing Chambers row by email on first sign-in, keeping its id', async () => {
    const id = await state.db!.addUser('existing@northeastern.edu')
    const user = await signIn('Existing@Northeastern.edu', ['senator'])
    expect(user?.id).toBe(id)
  })
})

describe('with SGAUTH_ENABLED off (the rollback)', () => {
  beforeEach(async () => {
    delete process.env.SGAUTH_ENABLED
    state.db = await createTestDb(BODIES)
    state.session = sessionFor('ignored@northeastern.edu', ['vice-president-of-operational-affairs'])
  })

  it('roles come from users.admin_role, as before, and the SGAuth session is ignored', async () => {
    state.betterAuthUserId = await state.db!.addUser('legacy@northeastern.edu', { admin_role: 'Comptroller' })
    const user = await getAuthedUserWithLiveRoles()
    expect(user?.app_metadata.admin_role).toBe('Comptroller')
  })

  it('is_active false still locks the account out, as before', async () => {
    state.betterAuthUserId = await state.db!.addUser('legacy@northeastern.edu', { admin_role: 'Comptroller', is_active: false })
    expect(await getAuthedUserWithLiveRoles()).toBeNull()
  })
})
