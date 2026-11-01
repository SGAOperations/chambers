#!/usr/bin/env node
/**
 * Links Chambers users to their SGAuth accounts from the id-map the SGAuth
 * import wrote (issues #150; SGAOperations/auth#99).
 *
 *   TARGET_DATABASE_URL=<Neon unpooled URL> node scripts/sgauth/link-users.mjs <id-map.json>          # dry run
 *   TARGET_DATABASE_URL=<Neon unpooled URL> node scripts/sgauth/link-users.mjs <id-map.json> --apply
 *
 * The id-map is `{ mappings: [{ chambersId, sgauthId, ... }] }`. For each entry
 * this sets users.sgauth_user_id where the row exists and is not linked yet. A
 * row already linked to the same SGAuth id is left alone, so a second run
 * changes nothing. A row linked to a *different* id is reported and skipped:
 * that needs a person to look at it.
 *
 * **Use the id-map from the same SGAuth environment the Chambers database
 * signs in against.** SGAuth dev and production are separate databases with
 * different user ids: production Chambers takes the map from the production
 * import, and dev Chambers the one from the dev import. Linking dev to
 * production ids makes every linked person a stranger to SGAuth dev, and they
 * loop between Chambers and sign-in. The import's report.json, written beside
 * the map, names the SGAuth database it ran against; this prints it.
 *
 * The id-map holds email addresses. Nothing here prints them -- only ids and
 * counts -- and the file itself stays out of git.
 *
 * Dry run unless --apply. Everything happens in one transaction either way, and
 * a dry run rolls it back.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import pg from 'pg'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const file = args.find(a => !a.startsWith('--'))
const url = process.env.TARGET_DATABASE_URL
if (!file || !url) {
  console.error('Usage: TARGET_DATABASE_URL=... node scripts/sgauth/link-users.mjs <id-map.json> [--apply]')
  process.exit(1)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const { mappings } = JSON.parse(readFileSync(file, 'utf8'))
if (!Array.isArray(mappings)) {
  console.error('The file has no `mappings` array. Is it the import id-map?')
  process.exit(1)
}
const pairs = mappings.filter(m => UUID.test(m?.chambersId ?? '') && UUID.test(m?.sgauthId ?? ''))
if (pairs.length !== mappings.length) {
  console.error(`${mappings.length - pairs.length} entries lack a valid chambersId/sgauthId and are ignored.`)
}

// The SGAuth side of the pairing. report.json is the import's own record of
// where it ran; without it, say so rather than guess.
const reportPath = join(dirname(file), 'report.json')
const sgauthTarget = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')).target : null

const client = new pg.Client({ connectionString: url })
await client.connect()
const host = new URL(url).host
console.log(`Target: ${host}  (${apply ? 'APPLY' : 'dry run'})`)
console.log(`Id-map: from the SGAuth import against ${sgauthTarget ?? 'an unknown database (no report.json beside it)'}`)
console.log('        Check that it is the SGAuth environment this Chambers database signs in against.')

const counts = { linked: 0, alreadyLinked: 0, missing: 0, conflict: 0 }
try {
  await client.query('begin')
  for (const { chambersId, sgauthId } of pairs) {
    const { rows } = await client.query(
      'select sgauth_user_id from public.users where id = $1',
      [chambersId]
    )
    if (!rows[0]) {
      counts.missing++
      console.log(`? no Chambers row ${chambersId}`)
      continue
    }
    const current = rows[0].sgauth_user_id
    if (current === sgauthId) {
      counts.alreadyLinked++
      continue
    }
    if (current !== null) {
      counts.conflict++
      console.log(`! ${chambersId} is already linked to a different SGAuth id; skipped`)
      continue
    }
    // Another row may hold this SGAuth id already (linked by email at sign-in).
    const { rows: taken } = await client.query(
      'select id from public.users where sgauth_user_id = $1',
      [sgauthId]
    )
    if (taken[0]) {
      counts.conflict++
      console.log(`! SGAuth id for ${chambersId} is already on row ${taken[0].id}; skipped`)
      continue
    }
    await client.query('update public.users set sgauth_user_id = $2 where id = $1', [chambersId, sgauthId])
    counts.linked++
  }

  const { rows: unlinked } = await client.query(
    'select count(*)::int as n from public.users where sgauth_user_id is null'
  )
  await client.query(apply ? 'commit' : 'rollback')
  console.log(
    `${pairs.length} mappings: ${counts.linked} linked, ${counts.alreadyLinked} already linked, ` +
      `${counts.missing} with no row, ${counts.conflict} conflicts`
  )
  console.log(`${unlinked[0].n} Chambers users ${apply ? 'remain' : 'would remain'} unlinked (they link by email on first SGAuth sign-in)`)
  if (!apply) console.log('Dry run: nothing was written. Re-run with --apply.')
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error(e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
