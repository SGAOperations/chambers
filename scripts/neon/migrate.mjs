#!/usr/bin/env node
/**
 * Brings a database up to date with db/neon, then refreshes its Data API schema
 * cache. Runs as the first step of every Vercel build (package.json "build"),
 * so a deploy migrates the database it deploys against: Preview builds the
 * shared preview branch, Production builds production.
 *
 *   node scripts/neon/migrate.mjs            on Vercel: migrate. Elsewhere: skip.
 *   node scripts/neon/migrate.mjs --status   say what would apply; change nothing.
 *   node scripts/neon/migrate.mjs --apply    migrate from anywhere (e.g. a laptop).
 *
 * Outside Vercel a plain run does nothing, so CI's `npm run build` and a local
 * build never touch a database.
 *
 * Environment (Vercel: set per environment, Production and Preview):
 *
 *   DATABASE_URL_UNPOOLED   the branch's direct string. Not the pooled one: the
 *                           advisory lock needs a session of its own. Or set
 *                           MIGRATE_DATABASE_URL to override it.
 *   NEON_API_KEY            a Neon API key, for the schema cache refresh.
 *   NEON_PROJECT_ID         the Neon project.
 *   NEON_BRANCH_ID          the branch DATABASE_URL_UNPOOLED points at (br-...).
 *   NEON_DATA_API_DATABASE  the database name; defaults to neondb.
 *
 * Without the NEON_* values the migration still runs, but a build that applied
 * something fails at the refresh rather than shipping code the Data API cannot
 * see the columns for. The refresh runs on every migrating build, not only ones
 * that applied a file, so a build that failed after migrating is put right by
 * the next one.
 */

import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { migrate, readMigrations, refreshDataApiSchema } from './migrate-core.mjs'

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--status')
const onVercel = process.env.VERCEL === '1'

if (!dryRun && !args.has('--apply') && !onVercel) {
  console.log('migrate: not on Vercel, skipping (use --apply or --status to run here)')
  process.exit(0)
}

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED
if (!url) {
  console.error(
    'migrate: no database. Set DATABASE_URL_UNPOOLED (the direct string) or MIGRATE_DATABASE_URL ' +
    `for this environment${onVercel ? ` (${process.env.VERCEL_ENV})` : ''}.`
  )
  process.exit(1)
}

const files = readMigrations(fileURLToPath(new URL('../../db/neon/', import.meta.url)))

const client = new pg.Client({ connectionString: url })
await client.connect()
let result
try {
  result = await migrate(
    {
      exec: sql => client.query(sql),
      query: (sql, params) => client.query(sql, params),
    },
    files,
    { dryRun, log: m => console.log(`migrate: ${m}`) }
  )
} catch (e) {
  console.error(`migrate: ${e.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
if (!result) process.exit(1)
if (dryRun) process.exit(0)

const neon = {
  apiKey: process.env.NEON_API_KEY,
  projectId: process.env.NEON_PROJECT_ID,
  branchId: process.env.NEON_BRANCH_ID,
  database: process.env.NEON_DATA_API_DATABASE || 'neondb',
}
const missing = ['NEON_API_KEY', 'NEON_PROJECT_ID', 'NEON_BRANCH_ID'].filter(k => !process.env[k])

if (missing.length) {
  const message = `migrate: can't refresh the Data API schema cache without ${missing.join(', ')}.`
  if (result.applied.length) {
    console.error(`${message} The migration is applied; refresh the cache in the Neon console, or set them and redeploy.`)
    process.exit(1)
  }
  console.warn(
    `${message} This build applied nothing, but if an earlier one applied a file and failed here, ` +
    'the cache is still stale: refresh it in the Neon console.'
  )
} else {
  try {
    await refreshDataApiSchema(neon)
    console.log('migrate: refreshed the Data API schema cache')
  } catch (e) {
    console.error(`migrate: ${e.message}`)
    process.exit(1)
  }
}
