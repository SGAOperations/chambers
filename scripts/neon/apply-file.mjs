#!/usr/bin/env node
/**
 * Applies one SQL file to a database in a transaction (issue #136). For adding
 * a later db/neon file to a database that already has the earlier ones, which
 * apply-schema.mjs refuses to touch.
 *
 *   TARGET_DATABASE_URL=<Neon unpooled URL> node scripts/neon/apply-file.mjs db/neon/0003_data_api_server_role.sql
 */

import { readFileSync } from 'node:fs'
import pg from 'pg'

const [file] = process.argv.slice(2)
const url = process.env.TARGET_DATABASE_URL
if (!file || !url) {
  console.error('Usage: TARGET_DATABASE_URL=... node scripts/neon/apply-file.mjs <file.sql>')
  process.exit(1)
}

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query('begin')
  await client.query(readFileSync(file, 'utf8'))
  await client.query('commit')
  console.log(`applied ${file}`)
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error(e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
