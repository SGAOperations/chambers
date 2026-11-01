import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

/**
 * A real Postgres, in process, with Chambers' own schema applied -- so the
 * migrations and the SQL in lib/position-sync.ts are tested as they run in
 * production, not against a hand-written fake.
 *
 * `bodies` are inserted before 0022, which seeds the position map by body name.
 */

const MIGRATIONS = ['0001_baseline.sql', '0003_data_api_server_role.sql', '0021_users_sgauth_user_id.sql']
const POSITIONS_MIGRATION = '0022_sgauth_positions.sql'

function migration(name: string): string {
  return readFileSync(join(process.cwd(), 'db', 'neon', name), 'utf8')
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>

export async function createTestDb(bodies: { name: string; division: string }[] = []) {
  // The baseline creates pgcrypto, as Neon has it.
  const pg = await PGlite.create({ extensions: { pgcrypto } })
  for (const name of MIGRATIONS) await pg.exec(migration(name))
  const bodyIds = new Map<string, string>()
  for (const b of bodies) {
    const { rows } = await pg.query<{ id: string }>(
      'insert into public.bodies (name, division) values ($1, $2) returning id',
      [b.name, b.division]
    )
    bodyIds.set(b.name, rows[0].id)
  }
  await pg.exec(migration(POSITIONS_MIGRATION))

  /**
   * The parts of pg's Pool that Chambers uses: query(), and connect() for a
   * transaction. PGlite is one connection, which is all a test needs.
   */
  const pool = {
    query: (text: string, params?: unknown[]) => pg.query(text, params),
    connect: async () => ({
      query: (text: string, params?: unknown[]) => pg.query(text, params),
      release: () => {},
    }),
  }

  async function addUser(email: string, fields: Record<string, unknown> = {}): Promise<string> {
    const columns = ['email', 'full_name', ...Object.keys(fields)]
    const values = [email, email.split('@')[0], ...Object.values(fields)]
    const { rows } = await pg.query<{ id: string }>(
      `insert into public.users (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      values
    )
    return rows[0].id
  }

  async function memberships(userId: string): Promise<Record<string, string>> {
    const { rows } = await pg.query<{ name: string; role: string }>(
      `select b.name, bm.role from public.board_memberships bm join public.bodies b on b.id = bm.body_id
        where bm.user_id = $1 order by b.name`,
      [userId]
    )
    return Object.fromEntries(rows.map(r => [r.name, r.role]))
  }

  return { pg, pool, bodyIds, addUser, memberships }
}
