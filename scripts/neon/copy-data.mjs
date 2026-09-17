#!/usr/bin/env node
/**
 * Copies Chambers' data from Supabase to Neon (issue #136).
 *
 *   SOURCE_DATABASE_URL=postgres://...supabase...  \
 *   TARGET_DATABASE_URL=postgres://...neon...      \
 *   node scripts/neon/copy-data.mjs [--dry-run]
 *
 * Expects the target to hold db/neon/0001_baseline.sql and 0002_better_auth.sql
 * and nothing else. It refuses to write into a table that already has rows, so
 * a half-finished run is re-done by recreating the target branch rather than
 * by trusting this to merge.
 *
 * What it does:
 *   1. Copies every public table, parents before children (ordered from the
 *      target's own foreign keys), in one transaction.
 *   2. Imports each Supabase login as a Better Auth credential account, keeping
 *      the user's id and bcrypt hash, so nobody resets a password.
 *   3. Compares row counts table by table and fails loudly on any difference.
 *
 * Sessions are not copied: everyone signs in again after cutover.
 *
 * Use the Supabase *direct* or *session pooler* connection string for the
 * source, not the transaction pooler, and the Neon *unpooled* string for the
 * target -- one long transaction is exactly what a transaction pooler breaks.
 */

import pg from 'pg'

const DRY_RUN = process.argv.includes('--dry-run')
const BATCH = 500

// Tables the copy must not touch: Better Auth's own, filled in step 2 or left
// empty on purpose.
const SKIP = new Set(['auth_sessions', 'auth_accounts', 'auth_verifications'])

function required(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`${name} is not set.`)
    process.exit(1)
  }
  return value
}

const source = new pg.Client({ connectionString: required('SOURCE_DATABASE_URL'), ssl: { rejectUnauthorized: false } })
const target = new pg.Client({ connectionString: required('TARGET_DATABASE_URL') })

/** Public tables in an order where every table comes after the ones it references. */
async function tablesInDependencyOrder(client) {
  const { rows: tables } = await client.query(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`
  )
  const { rows: edges } = await client.query(`
    select c.relname as child, p.relname as parent
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_class p on p.oid = con.confrelid
      join pg_namespace n on n.oid = c.relnamespace
     where con.contype = 'f' and n.nspname = 'public' and c.relname <> p.relname
  `)

  const names = tables.map(t => t.tablename).filter(t => !SKIP.has(t))
  const parents = new Map(names.map(n => [n, new Set()]))
  for (const { child, parent } of edges) {
    if (parents.has(child) && parents.has(parent)) parents.get(child).add(parent)
  }

  const ordered = []
  const done = new Set()
  while (ordered.length < names.length) {
    const ready = names.filter(n => !done.has(n) && [...parents.get(n)].every(p => done.has(p)))
    if (ready.length === 0) throw new Error('Foreign keys form a cycle; cannot order the copy.')
    for (const n of ready) {
      ordered.push(n)
      done.add(n)
    }
  }
  return ordered
}

/**
 * Column names the table has on both sides, in the target's order, plus which of
 * them are json/jsonb. Those are sent as JSON text: pg would otherwise turn a
 * JavaScript array into a Postgres array literal, which is not JSON.
 */
async function sharedColumns(table) {
  const q = `select column_name, data_type from information_schema.columns
              where table_schema = 'public' and table_name = $1 order by ordinal_position`
  const [{ rows: src }, { rows: dst }] = await Promise.all([source.query(q, [table]), target.query(q, [table])])
  const inSource = new Set(src.map(r => r.column_name))
  const cols = dst.map(r => r.column_name).filter(c => inSource.has(c))
  const missing = src.map(r => r.column_name).filter(c => !cols.includes(c))
  if (missing.length) throw new Error(`${table}: source columns missing on target: ${missing.join(', ')}`)
  const json = new Set(dst.filter(r => r.data_type === 'json' || r.data_type === 'jsonb').map(r => r.column_name))
  return { cols, json }
}

async function copyTable(table) {
  const { cols, json } = await sharedColumns(table)
  const quoted = cols.map(c => `"${c}"`).join(', ')

  const { rows: existing } = await target.query(`select count(*)::int as n from public."${table}"`)
  if (existing[0].n > 0) throw new Error(`${table} already has ${existing[0].n} rows on the target.`)

  const { rows } = await source.query(`select ${quoted} from public."${table}"`)
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const values = []
    const tuples = chunk.map((row, r) =>
      `(${cols.map((c, k) => { values.push(json.has(c) && row[c] !== null ? JSON.stringify(row[c]) : row[c]); return `$${r * cols.length + k + 1}` }).join(', ')})`
    )
    await target.query(`insert into public."${table}" (${quoted}) values ${tuples.join(', ')}`, values)
  }
  return rows.length
}

async function importLogins() {
  const { rows } = await source.query(`
    select id, encrypted_password, created_at, updated_at
      from auth.users
     where deleted_at is null and encrypted_password is not null and encrypted_password <> ''
  `)
  for (const u of rows) {
    await target.query(
      `insert into public.auth_accounts (user_id, account_id, provider_id, password, created_at, updated_at)
       values ($1, $1::text, 'credential', $2, coalesce($3, now()), coalesce($4, now()))`,
      [u.id, u.encrypted_password, u.created_at, u.updated_at]
    )
  }
  return rows.length
}

async function main() {
  await Promise.all([source.connect(), target.connect()])
  const tables = await tablesInDependencyOrder(target)
  console.log(`Copying ${tables.length} tables${DRY_RUN ? ' (dry run: rolled back at the end)' : ''}.`)

  await target.query('begin')
  try {
    for (const table of tables) {
      const n = await copyTable(table)
      console.log(`  ${table.padEnd(32)} ${n}`)
    }

    const logins = await importLogins()
    console.log(`  ${'auth_accounts (from auth.users)'.padEnd(32)} ${logins}`)

    const mismatches = []
    for (const table of tables) {
      const [{ rows: a }, { rows: b }] = await Promise.all([
        source.query(`select count(*)::int as n from public."${table}"`),
        target.query(`select count(*)::int as n from public."${table}"`),
      ])
      if (a[0].n !== b[0].n) mismatches.push(`${table}: source ${a[0].n}, target ${b[0].n}`)
    }
    const { rows: users } = await target.query(`select count(*)::int as n from public.users`)
    if (logins !== users[0].n) mismatches.push(`logins ${logins} vs users ${users[0].n}`)
    if (mismatches.length) throw new Error(`Row counts differ:\n  ${mismatches.join('\n  ')}`)

    await target.query(DRY_RUN ? 'rollback' : 'commit')
    console.log(DRY_RUN ? 'Dry run finished; nothing was kept.' : 'Copied. Row counts match.')
  } catch (e) {
    await target.query('rollback')
    throw e
  } finally {
    await Promise.all([source.end(), target.end()])
  }
}

main().catch(e => {
  console.error(e.message ?? e)
  process.exit(1)
})
