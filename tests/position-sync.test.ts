import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/db'

// lib/position-sync.ts talks to Postgres through lib/db/pool.ts; point that at
// the in-process database for each test.
const holder: { db: TestDb | null } = { db: null }
vi.mock('@/lib/db/pool', () => ({
  pool: {
    query: (text: string, params?: unknown[]) => holder.db!.pool.query(text, params),
    connect: () => holder.db!.pool.connect(),
  },
}))

const { clearPositionSyncMemo, resyncAllMemberships, syncPositions } = await import('@/lib/position-sync')

const BODIES = [
  { name: 'Senate', division: 'Senate' },
  { name: 'Appeals Board', division: 'Office of the President' },
  { name: 'Campus Services Committee', division: 'Campus Affairs' },
]

const pos = (...keys: string[]) => keys.map(key => ({ key, name: key.replace(/-/g, ' ') }))

describe('syncPositions', () => {
  let db: TestDb

  beforeEach(async () => {
    db = await createTestDb(BODIES)
    holder.db = db
    clearPositionSyncMemo()
  })

  it('makes a member of a body from a member position', async () => {
    const id = await db.addUser('senator@northeastern.edu')
    await syncPositions(id, pos('senator'))
    expect(await db.memberships(id)).toEqual({ Senate: 'Member' })
  })

  it('makes Leadership win when positions give both roles in one body', async () => {
    const id = await db.addUser('speaker@northeastern.edu')
    await syncPositions(id, pos('senator', 'speaker-of-the-senate'))
    expect(await db.memberships(id)).toEqual({ Senate: 'Leadership' })
  })

  it('gives a division VP Leadership of their bodies, from one position', async () => {
    const id = await db.addUser('vpca@northeastern.edu')
    await syncPositions(id, pos('vice-president-of-campus-affairs'))
    expect(await db.memberships(id)).toEqual({ 'Campus Services Committee': 'Leadership' })
  })

  it('removes memberships no position accounts for, including ones set by hand before SGAuth', async () => {
    const id = await db.addUser('former@northeastern.edu')
    await db.pg.query(
      `insert into public.board_memberships (user_id, body_id, role) values ($1, $2, 'Leadership')`,
      [id, db.bodyIds.get('Appeals Board')]
    )
    await syncPositions(id, pos('senator'))
    expect(await db.memberships(id)).toEqual({ Senate: 'Member' })
  })

  it('follows a position being taken away', async () => {
    const id = await db.addUser('ex-speaker@northeastern.edu')
    await syncPositions(id, pos('speaker-of-the-senate'))
    clearPositionSyncMemo()
    await syncPositions(id, pos())
    expect(await db.memberships(id)).toEqual({})
  })

  it('records the keys for finding people by office, and the names for the Bodies tab', async () => {
    const id = await db.addUser('comptroller@northeastern.edu')
    await syncPositions(id, [{ key: 'comptroller', name: 'Comptroller (renamed)' }])
    const { rows: user } = await db.pg.query<{ sgauth_position_keys: string[]; sgauth_positions_synced_at: Date | null }>(
      'select sgauth_position_keys, sgauth_positions_synced_at from public.users where id = $1',
      [id]
    )
    expect(user[0].sgauth_position_keys).toEqual(['comptroller'])
    expect(user[0].sgauth_positions_synced_at).not.toBeNull()
    const { rows: catalog } = await db.pg.query<{ name: string }>(
      `select name from public.sgauth_positions where key = 'comptroller'`
    )
    expect(catalog[0].name).toBe('Comptroller (renamed)')
  })

  it('ignores anything that is not a position key', async () => {
    const id = await db.addUser('odd@northeastern.edu')
    await syncPositions(id, [{ key: 'Not A Key; drop table users', name: 'x' }, ...pos('senator')])
    expect(await db.memberships(id)).toEqual({ Senate: 'Member' })
  })

  it('does not write again within a minute when nothing changed', async () => {
    const id = await db.addUser('quiet@northeastern.edu')
    await syncPositions(id, pos('senator'))
    // Changed behind its back; the memo means the second sync does not look.
    await db.pg.query('delete from public.board_memberships where user_id = $1', [id])
    await syncPositions(id, pos('senator'))
    expect(await db.memberships(id)).toEqual({})
    // A different set of positions is never memoised away.
    await syncPositions(id, pos('senator', 'appeals-board-justice'))
    expect(await db.memberships(id)).toEqual({ 'Appeals Board': 'Member', Senate: 'Member' })
  })
})

describe('resyncAllMemberships', () => {
  let db: TestDb

  beforeEach(async () => {
    db = await createTestDb(BODIES)
    holder.db = db
    clearPositionSyncMemo()
  })

  it('applies a changed map to everyone already synced, without waiting for their next visit', async () => {
    const id = await db.addUser('justice@northeastern.edu')
    await syncPositions(id, pos('appeals-board-justice'))
    expect(await db.memberships(id)).toEqual({ 'Appeals Board': 'Member' })

    await db.pg.query(
      `update public.body_position_roles set role = 'Leadership' where position_key = 'appeals-board-justice'`
    )
    await resyncAllMemberships()
    expect(await db.memberships(id)).toEqual({ 'Appeals Board': 'Leadership' })
  })

  it('leaves alone anyone who has never signed in through SGAuth', async () => {
    const id = await db.addUser('legacy@northeastern.edu')
    await db.pg.query(
      `insert into public.board_memberships (user_id, body_id, role) values ($1, $2, 'Member')`,
      [id, db.bodyIds.get('Senate')]
    )
    await resyncAllMemberships()
    expect(await db.memberships(id)).toEqual({ Senate: 'Member' })
  })
})
