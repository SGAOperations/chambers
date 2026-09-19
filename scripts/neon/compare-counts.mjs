#!/usr/bin/env node
/**
 * Compares every table's row count between Supabase and a Neon branch (issue
 * #136). Run right after the cutover deploy: a table with more rows on Supabase
 * was written to between the copy and the deploy, and those rows need copying
 * over by hand. More rows on Neon is expected once people use the new site.
 *
 *   SOURCE_DATABASE_URL=<Supabase>  TARGET_DATABASE_URL=<Neon>  node scripts/neon/compare-counts.mjs
 *
 * Read-only on both sides.
 */

import pg from 'pg'

const source = new pg.Client({ connectionString: process.env.SOURCE_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const target = new pg.Client({ connectionString: process.env.TARGET_DATABASE_URL })
await Promise.all([source.connect(), target.connect()])

const { rows } = await target.query(
  `select tablename from pg_tables where schemaname = 'public' and tablename not like 'auth\\_%' order by 1`
)
let behind = 0
for (const { tablename: t } of rows) {
  const [{ rows: a }, { rows: b }] = await Promise.all([
    source.query(`select count(*)::int as n from public."${t}"`),
    target.query(`select count(*)::int as n from public."${t}"`),
  ])
  const s = a[0].n, n = b[0].n
  const mark = s > n ? 'MISSING ON NEON' : n > s ? 'newer on Neon' : ''
  if (s > n) behind++
  if (mark) console.log(`${t.padEnd(32)} supabase ${String(s).padStart(5)}  neon ${String(n).padStart(5)}  ${mark}`)
}
console.log(behind ? `\n${behind} table(s) have rows Neon is missing.` : '\nNothing written to Supabase is missing from Neon.')
await Promise.all([source.end(), target.end()])
