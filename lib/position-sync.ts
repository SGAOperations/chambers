import type { SgaPosition } from '@nusgaops/sgauth'
import { pool } from './db/pool'
import { isPositionKey } from './permissions'

/**
 * Keeps a user's Chambers rows in step with the positions on their SGAuth
 * session (issue #151). Server-only.
 *
 * Under SGAUTH_ENABLED, positions are the only source of body memberships:
 * Management maps positions to bodies on the Bodies tab (body_position_roles),
 * and a user's board_memberships rows are exactly what their positions add up
 * to through that map. Holding positions that make someone both Leadership and
 * a Member of one body makes them Leadership. There is no per-person override,
 * so a membership added any other way is removed on their next sync
 * (docs/sgauth/position-mapping.md §3).
 *
 * board_memberships stays the table every booking and email query reads, which
 * is why this writes rows rather than having those queries read positions.
 *
 * Also recorded on every sync:
 *   - users.sgauth_position_keys, for finding someone else by office, where
 *     there is no session to read (lib/permissions.ts positionKeysForOffice);
 *   - sgauth_positions, the catalog of keys and names the Bodies tab offers.
 *
 * Runs on a signed-in request, at most once a minute per user per instance --
 * the same bound as the SDK's own session cache -- and writes only what changed.
 */

const MEMO_TTL_MS = 60_000
const memo = new Map<string, { signature: string; at: number }>()

/** Forget every user's last sync on this instance, so the next request re-syncs. Call after the map changes. */
export function clearPositionSyncMemo(): void {
  memo.clear()
}

/** Recomputes board_memberships for `userIds` from their recorded position keys. One statement for any number of users. */
const MEMBERSHIPS_FROM_KEYS = `
  with targets as (
    select u.id as user_id, u.sgauth_position_keys as keys
      from public.users u
     where u.id = any($1::uuid[])
  ), desired as (
    select t.user_id, bpr.body_id,
           case when bool_or(bpr.role = 'Leadership') then 'Leadership' else 'Member' end as role
      from targets t
      join public.body_position_roles bpr on bpr.position_key = any(t.keys)
     group by t.user_id, bpr.body_id
  ), removed as (
    delete from public.board_memberships bm
     using targets t
     where bm.user_id = t.user_id
       and not exists (select 1 from desired d where d.user_id = bm.user_id and d.body_id = bm.body_id)
    returning 1
  ), upserted as (
    insert into public.board_memberships (user_id, body_id, role)
    select user_id, body_id, role from desired
    on conflict (user_id, body_id) do update set role = excluded.role
      where public.board_memberships.role is distinct from excluded.role
    returning 1
  )
  select (select count(*) from removed)::int as removed, (select count(*) from upserted)::int as upserted
`

/**
 * Brings one user's recorded positions and body memberships up to date with
 * their session. Failures are logged and swallowed: a sync that cannot run
 * leaves yesterday's memberships in place rather than signing anyone out, and
 * is retried on the next request.
 */
export async function syncPositions(userId: string, positions: readonly SgaPosition[]): Promise<void> {
  const valid = positions.filter(p => isPositionKey(p.key))
  const keys = [...new Set(valid.map(p => p.key))].sort()
  const signature = keys.join(',')

  const last = memo.get(userId)
  if (last && last.signature === signature && Date.now() - last.at < MEMO_TTL_MS) return

  const client = await pool.connect()
  try {
    await client.query('begin')
    if (valid.length) {
      await client.query(
        `insert into public.sgauth_positions (key, name, last_seen_at)
         select k, n, now() from unnest($1::text[], $2::text[]) as p (k, n)
         on conflict (key) do update set name = excluded.name, last_seen_at = excluded.last_seen_at`,
        [valid.map(p => p.key), valid.map(p => p.name || p.key)]
      )
    }
    // synced_at is refreshed at least daily even when nothing changed, so it
    // says when Chambers last saw this person's positions at all.
    await client.query(
      `update public.users
          set sgauth_position_keys = $2::text[], sgauth_positions_synced_at = now()
        where id = $1
          and (sgauth_position_keys is distinct from $2::text[]
               or sgauth_positions_synced_at is null
               or sgauth_positions_synced_at < now() - interval '1 day')`,
      [userId, keys]
    )
    await client.query(MEMBERSHIPS_FROM_KEYS, [[userId]])
    await client.query('commit')
    memo.set(userId, { signature, at: Date.now() })
  } catch (e) {
    await client.query('rollback').catch(() => {})
    console.error('position-sync: could not sync a user', {
      userId,
      error: e instanceof Error ? e.message : 'unknown',
    })
  } finally {
    client.release()
  }
}

/**
 * Re-derives every synced user's body memberships from their recorded
 * positions, after Management changes the map. Users who have never signed in
 * through SGAuth have no recorded positions and are left alone; they sync on
 * their first sign-in.
 */
export async function resyncAllMemberships(): Promise<{ removed: number; upserted: number }> {
  const { rows: users } = await pool.query<{ id: string }>(
    'select id from public.users where sgauth_positions_synced_at is not null'
  )
  clearPositionSyncMemo()
  if (!users.length) return { removed: 0, upserted: 0 }
  const { rows } = await pool.query<{ removed: number; upserted: number }>(MEMBERSHIPS_FROM_KEYS, [users.map(u => u.id)])
  return rows[0] ?? { removed: 0, upserted: 0 }
}
