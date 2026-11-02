#!/usr/bin/env node
/**
 * Checks that every Chambers user resolves to the right SGAuth user (issue
 * #150), before and after the cutover (docs/sgauth/cutover.md).
 *
 *   TARGET_DATABASE_URL=<Chambers Neon URL> SGAUTH_DATABASE_URL=<SGAuth Neon URL> \
 *     node scripts/sgauth/verify-links.mjs
 *
 * Read-only on both databases: every query runs in a read-only transaction.
 * Use the SGAuth database of the same environment Chambers signs in against
 * (scripts/sgauth/link-users.mjs explains why).
 *
 * For each Chambers user it reports one of:
 *
 *   ok            linked, and the SGAuth account has the same email (case-insensitive)
 *   will link     not linked yet, and SGAuth has an account with this email --
 *                 the first sign-in links it (lib/sgauth.ts)
 *   no account    not linked, and SGAuth has no account with this email: this
 *                 person cannot sign in to Chambers until they get one
 *   email differs linked, but the SGAuth account's email is different now. Fine
 *                 if they changed it in SGAuth; worth a look otherwise
 *   inactive      linked to an SGAuth account that is deactivated or deleted
 *   dangling      linked to an SGAuth id that does not exist -- the wrong
 *                 environment's id-map was applied, or the account was purged
 *
 * Exits non-zero on any `dangling` row, which always needs a person. Also
 * checks that nothing in Chambers points at a user row that is gone, so the
 * history every booking and audit entry carries is intact: users.id is the key
 * throughout and SGAuth linking never changes it.
 *
 * Prints ids and counts only, never an email.
 */

import pg from 'pg'

const chambersUrl = process.env.TARGET_DATABASE_URL
const sgauthUrl = process.env.SGAUTH_DATABASE_URL
if (!chambersUrl || !sgauthUrl) {
  console.error('Usage: TARGET_DATABASE_URL=... SGAUTH_DATABASE_URL=... node scripts/sgauth/verify-links.mjs')
  process.exit(1)
}

/** Every column in Chambers that references users.id (db/neon/0001_baseline.sql). */
const USER_REFERENCES = [
  ['audit_logs', 'admin_id'],
  ['board_memberships', 'user_id'],
  ['bookings', 'created_by'],
  ['cancellation_requests', 'requested_by'],
  ['membership_requests', 'resolved_by'],
  ['membership_requests', 'user_id'],
  ['revision_requests', 'requested_by'],
  ['room_requests', 'requested_by'],
  ['slack_connections', 'chambers_user_id'],
  ['space_blackouts', 'created_by'],
  ['space_booking_series', 'creator_id'],
  ['space_bookings', 'creator_id'],
  ['space_weekly_limit_overrides', 'created_by'],
  ['space_weekly_limit_overrides', 'user_id'],
  ['user_alerts', 'user_id'],
]

async function readOnly(url, fn) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query('begin read only')
    return await fn(client)
  } finally {
    await client.query('rollback').catch(() => {})
    await client.end()
  }
}

const chambers = await readOnly(chambersUrl, async c => {
  const { rows: users } = await c.query(
    'select id, lower(email) as email, sgauth_user_id from public.users order by created_at'
  )
  const orphans = []
  for (const [table, column] of USER_REFERENCES) {
    const { rows } = await c.query(
      `select count(*)::int as n from public.${table} t
        where t.${column} is not null
          and not exists (select 1 from public.users u where u.id = t.${column})`
    )
    if (rows[0].n) orphans.push(`${table}.${column}: ${rows[0].n}`)
  }
  const { rows: bookings } = await c.query('select count(*)::int as n from public.bookings')
  return { users, orphans, bookings: bookings[0].n }
})

const sgauth = await readOnly(sgauthUrl, async c => {
  const { rows } = await c.query('select id, lower(email::text) as email, status from public."User"')
  return rows
})

const byId = new Map(sgauth.map(u => [u.id, u]))
const byEmail = new Map(sgauth.map(u => [u.email, u]))

const results = { ok: [], 'will link': [], 'no account': [], 'email differs': [], inactive: [], dangling: [] }
for (const u of chambers.users) {
  if (!u.sgauth_user_id) {
    results[byEmail.has(u.email) ? 'will link' : 'no account'].push(u.id)
    continue
  }
  const account = byId.get(u.sgauth_user_id)
  if (!account) results.dangling.push(u.id)
  else if (account.status !== 'ACTIVE') results.inactive.push(u.id)
  else if (account.email !== u.email) results['email differs'].push(u.id)
  else results.ok.push(u.id)
}

console.log(`Chambers: ${new URL(chambersUrl).host}`)
console.log(`SGAuth:   ${new URL(sgauthUrl).host}`)
console.log(`${chambers.users.length} Chambers users, ${sgauth.length} SGAuth accounts`)
for (const [label, ids] of Object.entries(results)) {
  console.log(`  ${label.padEnd(14)} ${ids.length}`)
  if (label !== 'ok' && label !== 'will link') for (const id of ids) console.log(`    ${id}`)
}
console.log(
  chambers.orphans.length
    ? `History: rows pointing at a missing user -- ${chambers.orphans.join(', ')}`
    : `History: intact. ${chambers.bookings} bookings, and nothing points at a missing user.`
)

if (results.dangling.length || chambers.orphans.length) process.exitCode = 1
