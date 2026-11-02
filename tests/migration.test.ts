import { describe, expect, it } from 'vitest'
import positionMap from '@/docs/sgauth/chambers-position-map.json'
import { createTestDb } from './helpers/db'

describe('0022_sgauth_positions', () => {
  it('seeds the approved map for every body whose name matches', async () => {
    const { pg } = await createTestDb([
      { name: 'Senate', division: 'Senate' },
      { name: 'Appeals Board', division: 'Office of the President' },
    ])

    const { rows } = await pg.query<{ name: string; position_key: string; role: string }>(
      `select b.name, bpr.position_key, bpr.role from public.body_position_roles bpr
         join public.bodies b on b.id = bpr.body_id order by b.name, bpr.role, bpr.position_key`
    )
    expect(rows).toEqual([
      { name: 'Appeals Board', position_key: 'parliamentarian', role: 'Leadership' },
      { name: 'Appeals Board', position_key: 'appeals-board-justice', role: 'Member' },
      { name: 'Senate', position_key: 'executive-vice-president', role: 'Leadership' },
      { name: 'Senate', position_key: 'speaker-of-the-senate', role: 'Leadership' },
      { name: 'Senate', position_key: 'senator', role: 'Member' },
    ])
  })

  it('knows every position the map uses, so the Bodies tab can name them', async () => {
    const { pg } = await createTestDb()
    const { rows } = await pg.query<{ key: string }>('select key from public.sgauth_positions')
    const known = new Set(rows.map(r => r.key))
    const used = [
      ...Object.values(positionMap.adminTiers).flat(),
      ...positionMap.iems,
      ...Object.values(positionMap.bodies).flatMap(b => [...b.leadership, ...b.member]),
    ]
    expect(used.filter(k => !known.has(k))).toEqual([])
  })

  it('leaves the legacy columns alone, so turning SGAuth off is still the rollback', async () => {
    const { pg, addUser } = await createTestDb()
    const id = await addUser('a@northeastern.edu', { admin_role: 'Comptroller', is_active: false })
    const { rows } = await pg.query<{ admin_role: string; is_active: boolean; sgauth_position_keys: string[] }>(
      'select admin_role, is_active, sgauth_position_keys from public.users where id = $1',
      [id]
    )
    expect(rows[0]).toEqual({ admin_role: 'Comptroller', is_active: false, sgauth_position_keys: [] })
  })
})
