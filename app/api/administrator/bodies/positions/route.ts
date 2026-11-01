import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { isManagementRole } from '@/lib/admin-roles'
import { pool } from '@/lib/db/pool'
import { ADMIN_POSITION_KEYS, IEMS_POSITION_KEYS, isPositionKey } from '@/lib/permissions'
import { resyncAllMemberships } from '@/lib/position-sync'
import { sgauthEnabled } from '@/lib/sgauth'

/**
 * Which SGAuth positions make someone Leadership or a Member of each body
 * (issue #151). Management edits this on the Bodies tab; it is the only way
 * body memberships are set once Chambers signs in through SGAuth.
 *
 *   GET  every known position (for the picker), every seat, and whether the
 *        map is live yet (SGAUTH_ENABLED).
 *   PUT  { body_id, leadership: [...keys], member: [...keys] } replaces one
 *        body's seats. A key listed under both is Leadership.
 *
 * Editable with the flag off too, so the map can be checked before cutover
 * (docs/sgauth/cutover.md). Only with it on does a save re-derive everyone's
 * memberships straight away: with it off, board_memberships still belongs to
 * the legacy Users tab and must not be touched.
 */

type Seat = { body_id: string; position_key: string; role: 'Leadership' | 'Member' }

async function requireManagement() {
  const user = await getAuthedUserWithLiveRoles()
  if (!user || !user.app_metadata?.is_admin) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!isManagementRole(user.app_metadata?.admin_role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return { error: rateLimitRes }
  return { user }
}

export async function GET() {
  const auth = await requireManagement()
  if (auth.error) return auth.error

  const [{ rows: positions }, { rows: seats }] = await Promise.all([
    pool.query<{ key: string; name: string; category: string | null }>(
      'select key, name, category from public.sgauth_positions order by category nulls last, name'
    ),
    pool.query<Seat>('select body_id, position_key, role from public.body_position_roles order by position_key'),
  ])

  return NextResponse.json({
    positions,
    seats,
    // Positions that already mean something outside the body map, so the
    // "not on any body" list does not nag about them.
    office_keys: [...new Set([...ADMIN_POSITION_KEYS, ...IEMS_POSITION_KEYS])],
    live: sgauthEnabled(),
  })
}

export async function PUT(request: Request) {
  const auth = await requireManagement()
  if (auth.error) return auth.error

  const body = await request.json().catch(() => null)
  const bodyId = body?.body_id
  if (typeof bodyId !== 'string' || !/^[0-9a-f-]{36}$/i.test(bodyId)) {
    return NextResponse.json({ error: 'body_id is required.' }, { status: 400 })
  }
  const lists = { leadership: body?.leadership, member: body?.member }
  for (const [name, list] of Object.entries(lists)) {
    if (!Array.isArray(list) || list.length > 100) {
      return NextResponse.json({ error: `${name} must be a list of position keys.` }, { status: 400 })
    }
    const invalid = list.find((k: unknown) => !isPositionKey(k))
    if (invalid !== undefined) {
      return NextResponse.json({ error: `"${String(invalid)}" is not a position key.` }, { status: 400 })
    }
  }
  const leadership = [...new Set(lists.leadership as string[])]
  const member = [...new Set(lists.member as string[])].filter(k => !leadership.includes(k))

  const client = await pool.connect()
  try {
    await client.query('begin')
    const { rows: found } = await client.query('select 1 from public.bodies where id = $1', [bodyId])
    if (!found[0]) {
      await client.query('rollback')
      return NextResponse.json({ error: 'Body not found.' }, { status: 404 })
    }
    // A key typed in before anyone holding it has signed in is added to the
    // catalog under its own key as its name; the first session that carries it
    // replaces the name with SGAuth's (lib/position-sync.ts).
    const keys = [...leadership, ...member]
    if (keys.length) {
      await client.query(
        `insert into public.sgauth_positions (key, name)
         select k, k from unnest($1::text[]) as k
         on conflict (key) do nothing`,
        [keys]
      )
    }
    await client.query('delete from public.body_position_roles where body_id = $1', [bodyId])
    if (keys.length) {
      await client.query(
        `insert into public.body_position_roles (body_id, position_key, role)
         select $1, k, r from unnest($2::text[], $3::text[]) as s (k, r)`,
        [bodyId, keys, [...leadership.map(() => 'Leadership'), ...member.map(() => 'Member')]]
      )
    }
    await client.query('commit')
  } catch (e) {
    await client.query('rollback').catch(() => {})
    console.error('bodies/positions: save failed', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Could not save the positions for that body.' }, { status: 500 })
  } finally {
    client.release()
  }

  // Everyone whose recorded positions touch this body gets their memberships
  // now, not on their next visit. Their own next request re-checks anyway.
  let resynced: { removed: number; upserted: number } | null = null
  if (sgauthEnabled()) {
    try {
      resynced = await resyncAllMemberships()
    } catch (e) {
      console.error('bodies/positions: resync failed', e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json({ success: true, resynced })
}
