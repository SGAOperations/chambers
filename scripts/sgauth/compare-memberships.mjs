#!/usr/bin/env node
/**
 * What turning SGAuth on will do to body memberships (issues #151, #154), body
 * by body, before anyone signs in.
 *
 *   TARGET_DATABASE_URL=<Chambers Neon URL> SGAUTH_DATABASE_URL=<SGAuth Neon URL> \
 *     node scripts/sgauth/compare-memberships.mjs
 *
 * Under SGAUTH_ENABLED a person's board_memberships are exactly what their SGA
 * positions add up to through the Bodies tab map (body_position_roles,
 * lib/position-sync.ts), rewritten on their next request. This computes that
 * for every Chambers user SGAuth knows -- linked by id, or by email for the rows
 * that link on first sign-in -- and sets it beside today's rows.
 *
 * Read-only on both databases. Needs 0022 applied to the Chambers database.
 * Prints body names, counts and Chambers user ids, never an email.
 *
 * docs/sgauth/position-mapping.md §4 asks for exactly this before cutover:
 * every body's Leaders today against the Leaders positions produce. A Leader
 * who would lose their seat needs the matching position in SGAuth first, or a
 * change to the map on the Bodies tab.
 */

import pg from 'pg'

const chambersUrl = process.env.TARGET_DATABASE_URL
const sgauthUrl = process.env.SGAUTH_DATABASE_URL
if (!chambersUrl || !sgauthUrl) {
  console.error('Usage: TARGET_DATABASE_URL=... SGAUTH_DATABASE_URL=... node scripts/sgauth/compare-memberships.mjs')
  process.exit(1)
}

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

const sgauth = await readOnly(sgauthUrl, async c => {
  const { rows: users } = await c.query(`select id, lower(email::text) as email from public."User" where status = 'ACTIVE'`)
  const { rows: held } = await c.query(
    `select up."userId" as user_id, p.key
       from public."UserPosition" up
       join public."Position" p on p.id = up."positionId"
      where p."deletedAt" is null`
  )
  return { users, held }
})

const chambers = await readOnly(chambersUrl, async c => {
  const { rows: users } = await c.query('select id, lower(email) as email, sgauth_user_id from public.users')
  const { rows: bodies } = await c.query('select id, name from public.bodies where is_active order by name')
  const { rows: seats } = await c.query('select body_id, position_key, role from public.body_position_roles')
  const { rows: memberships } = await c.query('select user_id, body_id, role from public.board_memberships')
  return { users, bodies, seats, memberships }
})

// Positions per SGAuth user, and which SGAuth user each Chambers row is.
const keysBySgauthUser = new Map()
for (const { user_id, key } of sgauth.held) {
  if (!keysBySgauthUser.has(user_id)) keysBySgauthUser.set(user_id, new Set())
  keysBySgauthUser.get(user_id).add(key)
}
const activeIds = new Set(sgauth.users.map(u => u.id))
const sgauthIdByEmail = new Map(sgauth.users.map(u => [u.email, u.id]))
const sgauthIdFor = u => (u.sgauth_user_id && activeIds.has(u.sgauth_user_id) ? u.sgauth_user_id : sgauthIdByEmail.get(u.email) ?? null)

// Seats per position key.
const seatsByKey = new Map()
for (const s of chambers.seats) {
  if (!seatsByKey.has(s.position_key)) seatsByKey.set(s.position_key, [])
  seatsByKey.get(s.position_key).push(s)
}

// What each Chambers user's memberships become: `${body}` -> role, Leadership winning.
const after = new Map() // user_id -> Map(body_id -> role)
const unknown = [] // Chambers users SGAuth has no active account for
for (const u of chambers.users) {
  const sgauthId = sgauthIdFor(u)
  if (!sgauthId) {
    unknown.push(u.id)
    continue
  }
  const roles = new Map()
  for (const key of keysBySgauthUser.get(sgauthId) ?? []) {
    for (const s of seatsByKey.get(key) ?? []) {
      if (roles.get(s.body_id) !== 'Leadership') roles.set(s.body_id, s.role)
    }
  }
  after.set(u.id, roles)
}

const before = new Map()
for (const m of chambers.memberships) {
  if (!before.has(m.user_id)) before.set(m.user_id, new Map())
  before.get(m.user_id).set(m.body_id, m.role)
}

const holders = (map, bodyId, role) =>
  new Set([...map].filter(([, roles]) => roles.get(bodyId) === role).map(([userId]) => userId))

console.log(`Chambers: ${new URL(chambersUrl).host}   SGAuth: ${new URL(sgauthUrl).host}`)
console.log(`${chambers.users.length} Chambers users; ${unknown.length} have no active SGAuth account and keep today's rows until they get one.\n`)

let leadershipLost = 0
for (const body of chambers.bodies) {
  const lines = []
  for (const role of ['Leadership', 'Member']) {
    // Only users SGAuth knows change; the rest keep what they have.
    const was = new Set([...holders(before, body.id, role)].filter(id => after.has(id)))
    const will = holders(after, body.id, role)
    const lost = [...was].filter(id => !will.has(id))
    const gained = [...will].filter(id => !was.has(id))
    if (role === 'Leadership') leadershipLost += lost.length
    lines.push(`  ${role.padEnd(10)} ${was.size} -> ${will.size}${lost.length || gained.length ? `   (-${lost.length} +${gained.length})` : ''}`)
    for (const id of lost) lines.push(`    - ${id}`)
    for (const id of gained) lines.push(`    + ${id}`)
  }
  const seatCount = chambers.seats.filter(s => s.body_id === body.id).length
  console.log(`${body.name}${seatCount ? '' : '   (no positions mapped: everyone loses it)'}`)
  console.log(lines.join('\n'))
}

console.log(`\n${leadershipLost} Leadership seat${leadershipLost === 1 ? '' : 's'} would be lost. Check each before cutover.`)
