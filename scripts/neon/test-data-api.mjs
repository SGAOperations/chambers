#!/usr/bin/env node
/**
 * Proves the Neon Data API can serve Chambers' server queries (issue #136).
 *
 *   NEON_DATA_API_URL=...  DATA_API_PRIVATE_JWK='{...}'  node scripts/neon/test-data-api.mjs
 *
 * Signs a short-lived token as chambers_server -- the way lib/db/data-api.ts
 * will -- and runs the query shapes Chambers actually uses through the same
 * postgrest-js builder supabase-js wraps: nested selects, a nested-table
 * filter, .or(), head counts, and a write that is undone. Then checks the
 * refusals: no token, and a token for the ordinary `authenticated` role.
 *
 * Read-and-restore only; it leaves the data as it found it.
 */

import { SignJWT, importJWK } from 'jose'
import { PostgrestClient } from '@supabase/postgrest-js'

const url = process.env.NEON_DATA_API_URL
const jwk = process.env.DATA_API_PRIVATE_JWK
if (!url || !jwk) {
  console.error('NEON_DATA_API_URL and DATA_API_PRIVATE_JWK must be set.')
  process.exit(1)
}

const privateJwk = JSON.parse(jwk)
const key = await importJWK(privateJwk, 'ES256')

async function token(role) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'ES256', kid: privateJwk.kid, typ: 'JWT' })
    .setSubject('chambers-server')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key)
}

const base = url.replace(/\/+$/, '')
const client = headers => new PostgrestClient(base, { headers })
const server = client({ Authorization: `Bearer ${await token('chambers_server')}` })

let failures = 0
async function check(label, run, expect) {
  try {
    const result = await run()
    const verdict = expect(result)
    if (verdict === true) console.log(`  ok    ${label}`)
    else {
      failures++
      console.log(`  FAIL  ${label}: ${verdict}`)
    }
  } catch (e) {
    failures++
    console.log(`  FAIL  ${label}: threw ${e.message}`)
  }
}
const rows = n => r => (r.error ? `error ${r.error.code}: ${r.error.message}` : (r.data?.length ?? 0) >= n || `only ${r.data?.length ?? 0} rows`)

console.log('As chambers_server:')
await check('plain select', () => server.from('bodies').select('id, name').limit(5), rows(1))
await check(
  'nested select (bookings -> bodies, children)',
  () => server.from('bookings').select('id, purpose, bodies(name), one_time_room_bookings(id, booking_date), booking_bodies(body_id, bodies(name))').limit(5),
  r => (r.error ? `error ${r.error.code}: ${r.error.message}` : Array.isArray(r.data) && r.data.length > 0 && 'bodies' in r.data[0] || 'no nested data')
)
await check(
  'filter on a nested table (my-rooms shape)',
  () => server.from('bookings')
    .select('id, weekly_room_bookings(id, weekly_room_occurrences(id, occurrence_date))')
    .eq('type', 'Weekly Room')
    .gte('weekly_room_bookings.weekly_room_occurrences.occurrence_date', '2026-01-01')
    .limit(3),
  rows(1)
)
await check(
  'aliased FK embed (user_alerts -> bookings!booking_id)',
  () => server.from('user_alerts').select('id, bookings!booking_id(bodies(name)), room_requests!request_id(bodies(name))').limit(3),
  rows(1)
)
await check('.or() filter', () => server.from('space_blackouts').select('id').or('space_id.is.null,space_id.not.is.null'), rows(1))
await check('head count', () => server.from('users').select('id', { count: 'exact', head: true }),
  r => (r.error ? `error ${r.error.code}: ${r.error.message}` : r.count > 0 || `count ${r.count}`))
await check('single()', () => server.from('app_settings').select('*').eq('id', 1).single(),
  r => (r.error ? `error ${r.error.code}: ${r.error.message}` : r.data?.id === 1 || 'no row'))

await check('write, then restore', async () => {
  const before = await server.from('app_settings').select('min_days_advance_room').eq('id', 1).single()
  if (before.error) return before
  const v = before.data.min_days_advance_room
  const up = await server.from('app_settings').update({ min_days_advance_room: v + 1 }).eq('id', 1).select('min_days_advance_room').single()
  const back = await server.from('app_settings').update({ min_days_advance_room: v }).eq('id', 1).select('min_days_advance_room').single()
  return { error: up.error ?? back.error, data: { wrote: up.data?.min_days_advance_room === v + 1, restored: back.data?.min_days_advance_room === v } }
}, r => (r.error ? `error ${r.error.code}: ${r.error.message}` : (r.data.wrote && r.data.restored) || JSON.stringify(r.data)))

await check('login tables stay closed', () => server.from('auth_accounts').select('id').limit(1),
  r => (r.error ? true : `returned ${r.data?.length} rows`))

console.log('Refusals:')
await check('no token', () => client({}).from('users').select('id').limit(1),
  r => (r.error || (r.data ?? []).length === 0 ? true : `anonymous read ${r.data.length} rows`))
await check('ordinary authenticated token', async () =>
  client({ Authorization: `Bearer ${await token('authenticated')}` }).from('users').select('id').limit(1),
  r => (r.error || (r.data ?? []).length === 0 ? true : `authenticated read ${r.data.length} rows`))

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.')
process.exitCode = failures ? 1 : 0
