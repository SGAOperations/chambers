#!/usr/bin/env node
/**
 * Loads a Neon branch from Supabase in one go, for cutover (issue #136).
 *
 *   SOURCE_DATABASE_URL=<Supabase session pooler>  \
 *   TARGET_DATABASE_URL=<Neon *unpooled* URL of the branch>  \
 *   node scripts/neon/cutover.mjs --target-endpoint=ep-xxxx [--check] [--reset-target]
 *
 * Steps, stopping at the first failure:
 *   1. Guards: the target's endpoint must equal --target-endpoint (so a
 *      mistyped URL cannot load the wrong branch), and the Data API must already
 *      be enabled on it (its `authenticator` role exists).
 *   2. If the target already has tables: stop, unless --reset-target, which
 *      drops every table in its public schema first.
 *   3. Applies db/neon/0001-0003 in one transaction.
 *   4. Copies the data and logins (scripts/neon/copy-data.mjs), which checks
 *      every row count.
 *   5. Applies db/neon/after-data-api.sql.
 *
 * --check runs only the guards and reports what a real run would do.
 *
 * Afterwards, by hand: refresh the Data API schema cache in the Neon console,
 * then run scripts/neon/test-data-api.mjs against the branch.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const schemaDir = join(here, '..', '..', 'db', 'neon')
const args = process.argv.slice(2)
const flag = name => args.includes(`--${name}`)
const opt = name => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1]

const CHECK = flag('check')
const RESET = flag('reset-target')
const expectedEndpoint = opt('target-endpoint')
const source = process.env.SOURCE_DATABASE_URL
const target = process.env.TARGET_DATABASE_URL

function fail(msg) {
  console.error(`\nSTOPPED: ${msg}`)
  process.exit(1)
}

if (!source || !target) fail('SOURCE_DATABASE_URL and TARGET_DATABASE_URL must both be set.')
if (!expectedEndpoint) fail('Pass --target-endpoint=<ep-...> naming the branch you mean to load.')

const endpoint = new URL(target).hostname.split('.')[0]
if (endpoint.endsWith('-pooler')) fail('TARGET_DATABASE_URL is the pooled URL; use the unpooled one.')
if (endpoint !== expectedEndpoint) fail(`target endpoint is ${endpoint}, not ${expectedEndpoint}.`)

const db = new pg.Client({ connectionString: target })
await db.connect()
const q = async (sql, params) => (await db.query(sql, params)).rows

try {
  // 1. Guards.
  const [{ n: hasAuthenticator }] = await q(`select count(*)::int as n from pg_roles where rolname = 'authenticator'`)
  if (!hasAuthenticator) fail('the Data API is not enabled on this branch yet (no authenticator role). Enable it in the Neon console first.')

  const tables = (await q(`select tablename from pg_tables where schemaname = 'public' order by 1`)).map(r => r.tablename)
  console.log(`Target ${endpoint}: Data API enabled, ${tables.length} tables in public.`)

  if (tables.length && !RESET) fail(`${endpoint} already has ${tables.length} tables. Re-run with --reset-target to drop them first.`)

  const files = readdirSync(schemaDir).filter(f => /^\d+_.*\.sql$/.test(f)).sort()
  if (CHECK) {
    console.log('\n--check: a real run would')
    if (tables.length) console.log(`  drop ${tables.length} existing tables`)
    console.log(`  apply ${files.join(', ')}`)
    console.log('  copy the data and logins, checking every row count')
    console.log('  apply after-data-api.sql')
    process.exit(0)
  }

  // 2. Reset.
  if (tables.length) {
    await db.query('begin')
    for (const t of tables) await db.query(`drop table if exists public."${t}" cascade`)
    await db.query('commit')
    console.log(`Dropped ${tables.length} existing tables.`)
  }

  // 3. Schema.
  await db.query('begin')
  for (const f of files) {
    await db.query(readFileSync(join(schemaDir, f), 'utf8'))
    console.log(`Applied ${f}`)
  }
  await db.query('commit')
} catch (e) {
  await db.query('rollback').catch(() => {})
  await db.end()
  fail(e.message)
}
await db.end()

// 4. Data. A separate process so its single transaction and checks are
// exactly the ones already rehearsed.
console.log('\nCopying data...')
const copy = spawnSync(process.execPath, [join(here, 'copy-data.mjs')], {
  stdio: 'inherit',
  env: { ...process.env, SOURCE_DATABASE_URL: source, TARGET_DATABASE_URL: target },
})
if (copy.status !== 0) fail('the data copy failed; the target has the schema but no data. Re-run with --reset-target.')

// 5. Let the Data API switch into chambers_server.
const db2 = new pg.Client({ connectionString: target })
await db2.connect()
try {
  await db2.query(readFileSync(join(schemaDir, 'after-data-api.sql'), 'utf8'))
  console.log('Applied after-data-api.sql')
} catch (e) {
  fail(e.message)
} finally {
  await db2.end()
}

console.log(`
Done. Next, by hand:
  1. Neon console > this branch > Data API > Refresh schema cache.
  2. Run scripts/neon/test-data-api.mjs against this branch.`)
