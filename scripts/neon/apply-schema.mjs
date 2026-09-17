#!/usr/bin/env node
/**
 * Applies db/neon/*.sql, in filename order, to an empty Neon database in one
 * transaction (issue #136). Either every file applies or none does.
 *
 *   TARGET_DATABASE_URL=<Neon unpooled URL> node scripts/neon/apply-schema.mjs
 *
 * Refuses to run against a database that already has tables in public.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const url = process.env.TARGET_DATABASE_URL
if (!url) {
  console.error('TARGET_DATABASE_URL is not set.')
  process.exit(1)
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'neon')
const files = readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort()

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  const { rows } = await client.query(`select count(*)::int as n from pg_tables where schemaname = 'public'`)
  if (rows[0].n > 0) throw new Error(`public already has ${rows[0].n} tables; apply to an empty database.`)

  await client.query('begin')
  for (const f of files) {
    await client.query(readFileSync(join(dir, f), 'utf8'))
    console.log(`applied ${f}`)
  }
  await client.query('commit')

  const { rows: after } = await client.query(`select count(*)::int as n from pg_tables where schemaname = 'public'`)
  console.log(`public now has ${after[0].n} tables.`)
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error(e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
