#!/usr/bin/env node
/**
 * Dry run of db/neon/0023_status_split.sql (issue #281): what the backfill would
 * write, counted per mapping, without keeping any of it.
 *
 * Applies the real migration inside a transaction, reads back every
 * (status -> meeting_status, is_virtual, ops_status) combination with its row
 * count, and rolls back. The counts come from the same SQL that will run, not
 * from a copy of the mapping.
 *
 *   TARGET_DATABASE_URL=<Neon unpooled URL> node scripts/neon/status-split-preview.mjs
 *
 * Review the table before applying: every Pending Cancellation row's split
 * depends on the request behind it, and an unexpected `null` ops status or a
 * Virtual-request row landing on Cancelled is what to look for. Running this on
 * a database that already has 0023 is harmless; it re-derives the same values
 * and rolls back.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const url = process.env.TARGET_DATABASE_URL
if (!url) {
  console.error('Usage: TARGET_DATABASE_URL=... node scripts/neon/status-split-preview.mjs')
  process.exit(1)
}

const migration = readFileSync(
  fileURLToPath(new URL('../../db/neon/0023_status_split.sql', import.meta.url)),
  'utf8'
)

const TABLES = ['one_time_room_bookings', 'weekly_room_bookings', 'weekly_room_occurrences', 'tabling_sessions']

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query('begin')
  await client.query(migration)
  for (const table of TABLES) {
    const { rows } = await client.query(
      `select coalesce(status, '(null)') as status,
              coalesce(meeting_status, '(null)') as meeting_status,
              coalesce(is_virtual::text, '(null)') as is_virtual,
              coalesce(ops_status, '(null)') as ops_status,
              count(*)::int as rows
         from public.${table}
        group by 1, 2, 3, 4
        order by 1, 2, 3, 4`
    )
    const total = rows.reduce((n, r) => n + r.rows, 0)
    console.log(`\n${table} (${total} rows)`)
    if (rows.length) console.table(rows)
  }
} catch (e) {
  console.error(e.message)
  process.exitCode = 1
} finally {
  await client.query('rollback').catch(() => {})
  await client.end()
  console.log('\nRolled back. Nothing was written.')
}
