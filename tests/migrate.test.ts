import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { describe, expect, it, vi } from 'vitest'
import { BASELINE_PROBES, migrate, readMigrations, refreshDataApiSchema } from '@/scripts/neon/migrate-core.mjs'

/**
 * scripts/neon/migrate-core.mjs: the runner each Vercel build uses to bring its
 * database up to date with db/neon.
 */

const FILES = readMigrations(join(process.cwd(), 'db', 'neon'))

async function freshDb() {
  const pg = await PGlite.create({ extensions: { pgcrypto } })
  const db = {
    exec: (sql: string) => pg.exec(sql),
    query: (sql: string, params?: unknown[]) => pg.query(sql, params),
  }
  return { pg, db }
}

/** Applies the first `n` files by hand, as production had them before the runner. */
async function applyByHand(pg: PGlite, n: number) {
  for (const f of FILES.slice(0, n)) await pg.exec(f.sql)
}

const quiet = { log: () => {} }

async function recorded(pg: PGlite) {
  const { rows } = await pg.query<{ name: string; recorded_by: string }>(
    'select name, recorded_by from public.schema_migrations order by name'
  )
  return rows
}

describe('readMigrations', () => {
  it('reads every numbered file, in order, and nothing else', () => {
    const names = FILES.map(f => f.name)
    expect(names[0]).toBe('0001_baseline.sql')
    expect(names).toEqual([...names].sort())
    expect(names).not.toContain('after-data-api.sql')
    expect(names).toContain('0023_status_split.sql')
  })

  it('has a baseline probe for every file that predates the record', () => {
    // Files added after this runner shipped (0024 on) never need one; the ones before it all do.
    const unprobed = FILES.map(f => f.name)
      .filter(n => n < '0024' && !BASELINE_PROBES[n as keyof typeof BASELINE_PROBES])
    expect(unprobed).toEqual([])
  })
})

describe('migrate', () => {
  it('builds an empty database from nothing, then has nothing left to do', async () => {
    const { pg, db } = await freshDb()
    const first = await migrate(db, FILES, quiet)
    expect(first.baselined).toEqual([])
    expect(first.applied).toEqual(FILES.map(f => f.name))
    expect((await recorded(pg)).every(r => r.recorded_by === 'migrate')).toBe(true)

    const again = await migrate(db, FILES, quiet)
    expect(again).toEqual({ baselined: [], applied: [], pending: [], changed: [] })
  })

  it('on a database migrated by hand, records what it has and applies only the rest', async () => {
    const { pg, db } = await freshDb()
    const through0020 = FILES.findIndex(f => f.name === '0020_remove_dim_admin_role.sql') + 1
    await applyByHand(pg, through0020)

    const result = await migrate(db, FILES, quiet)
    expect(result.baselined).toEqual(FILES.slice(0, through0020).map(f => f.name))
    expect(result.applied).toEqual(FILES.slice(through0020).map(f => f.name))
    const rows = await recorded(pg)
    expect(rows.find(r => r.name === '0020_remove_dim_admin_role.sql')?.recorded_by).toBe('baseline')
    expect(rows.find(r => r.name === '0021_users_sgauth_user_id.sql')?.recorded_by).toBe('migrate')
  })

  it('recognises each hand-applied stopping point', async () => {
    // Every probe must be false before its file and true after it.
    const { pg } = await freshDb()
    for (const [i, f] of FILES.entries()) {
      const probe = BASELINE_PROBES[f.name as keyof typeof BASELINE_PROBES]
      const before = await pg.query<{ ok: boolean }>(`select (${probe}) as ok`)
      expect(before.rows[0].ok, `${f.name} before`).toBe(false)
      await pg.exec(FILES[i].sql)
      const after = await pg.query<{ ok: boolean }>(`select (${probe}) as ok`)
      expect(after.rows[0].ok, `${f.name} after`).toBe(true)
    }
  })

  it("is not fooled by a chambers_server role another database on the server made", async () => {
    // Roles are server-wide; 0003 is only applied once this database grants to it.
    const { pg, db } = await freshDb()
    await pg.exec('create role chambers_server nologin')
    const result = await migrate(db, FILES, { ...quiet, dryRun: true })
    expect(result.baselined).toEqual([])
  })

  it('stops on a gap rather than applying files out of order', async () => {
    const { pg, db } = await freshDb()
    await applyByHand(pg, 3)
    // 0022 without 0004..0021.
    await pg.exec(FILES.find(f => f.name === '0022_sgauth_positions.sql')!.sql)
    await expect(migrate(db, FILES, quiet)).rejects.toThrow(/0004_event_forms\.sql/)
    const { rows } = await pg.query(`select to_regclass('public.schema_migrations') as t`)
    expect(rows[0]).toEqual({ t: null })
  })

  it('a dry run reports what would apply and writes nothing', async () => {
    const { pg, db } = await freshDb()
    await applyByHand(pg, 5)
    const result = await migrate(db, FILES, { ...quiet, dryRun: true })
    expect(result.baselined).toHaveLength(5)
    expect(result.pending).toEqual(FILES.slice(5).map(f => f.name))
    expect(result.applied).toEqual([])
    const { rows } = await pg.query(`select to_regclass('public.schema_migrations') as t`)
    expect(rows[0]).toEqual({ t: null })
  })

  it('rolls a failing file back, records nothing for it, and stops', async () => {
    const { pg, db } = await freshDb()
    const broken = [
      ...FILES.slice(0, 1),
      { name: '0002_broken.sql', sql: 'create table public.half_done (id int); select * from no_such_table;', checksum: 'x' },
      ...FILES.slice(1, 2),
    ]
    await expect(migrate(db, broken, quiet)).rejects.toThrow(/0002_broken\.sql failed and was rolled back/)
    expect((await recorded(pg)).map(r => r.name)).toEqual(['0001_baseline.sql'])
    const { rows } = await pg.query(`select to_regclass('public.half_done') as t`)
    expect(rows[0]).toEqual({ t: null })
  })

  it('warns when an applied file has been edited, and does not re-run it', async () => {
    const { db } = await freshDb()
    await migrate(db, FILES.slice(0, 2), quiet)
    const log = vi.fn()
    const edited = [{ ...FILES[0], checksum: 'edited' }, FILES[1]]
    const result = await migrate(db, edited, { log })
    expect(result.changed).toEqual(['0001_baseline.sql'])
    expect(result.applied).toEqual([])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('0001_baseline.sql has changed'))
  })
})

describe('refreshDataApiSchema', () => {
  it('sends an empty PATCH to the branch Data API path', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 201 }))
    await refreshDataApiSchema({ apiKey: 'k', projectId: 'p-1', branchId: 'br-2', database: 'neondb', fetchImpl })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://console.neon.tech/api/v2/projects/p-1/branches/br-2/data-api/neondb',
      expect.objectContaining({ method: 'PATCH', body: '{}', headers: expect.objectContaining({ Authorization: 'Bearer k' }) })
    )
  })

  it('fails loudly when Neon refuses', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 403 }))
    await expect(refreshDataApiSchema({ apiKey: 'k', projectId: 'p', branchId: 'b', database: 'd', fetchImpl }))
      .rejects.toThrow(/HTTP 403/)
  })
})
