/**
 * Applies db/neon's numbered SQL files that a database has not had yet, and
 * records each one, so a deploy brings its own database up to date.
 *
 * Kept apart from the CLI (scripts/neon/migrate.mjs) so tests can run it
 * against an in-process Postgres. `db` is anything with:
 *
 *   exec(sql)            runs one or more statements, no parameters
 *   query(sql, params)   runs one parameterised statement, returns { rows }
 *
 * The record is public.schema_migrations: one row per file, by filename.
 * Files are applied in filename order, each in its own transaction together
 * with its row, so a file that fails leaves nothing half-done and nothing
 * recorded. A session advisory lock keeps two deploys building at once from
 * applying the same file twice.
 *
 * The first run on a database that predates the record works out what it
 * already has from the schema itself (BASELINE_PROBES), records those files as
 * 'baseline', and only then applies the rest. A gap -- an earlier file missing
 * under a later one -- stops the run rather than applying files out of order.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Numbered migration files: 0001_baseline.sql, 0018_event_slack_channels.sql. */
const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/

/** Any fixed key; only migrate takes it. */
const LOCK_KEY = 7_281_023

/**
 * For each file that existed before the record did, a query that is true when
 * the database already has it: the table, column, role or constraint the file
 * introduces. Only read on a database with no schema_migrations table yet;
 * files added after the record exists never need one.
 */
const col = (table, column) =>
  `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = '${table}' and column_name = '${column}')`
const table = name => `to_regclass('public.${name}') is not null`
const constraintDef = name =>
  `(select pg_get_constraintdef(oid) from pg_constraint where conname = '${name}' limit 1)`

export const BASELINE_PROBES = {
  '0001_baseline.sql': table('bookings'),
  '0002_better_auth.sql': col('users', 'email_verified'),
  // Not the role itself: roles belong to the whole server, so another database
  // on it may have made one. The grant on bookings is this database's own.
  '0003_data_api_server_role.sql': `exists (select 1 from information_schema.role_table_grants
     where grantee = 'chambers_server' and table_schema = 'public' and table_name = 'bookings')`,
  '0004_event_forms.sql': table('event_form_templates'),
  '0005_tabling_request_location.sql': col('tabling_request_sessions', 'location'),
  '0006_space_series_biweekly.sql': col('space_booking_series', 'frequency'),
  '0007_nusso_advance_minimums.sql': col('app_settings', 'nusso_min_days_advance_room'),
  '0008_audit_log_admin_role.sql': col('audit_logs', 'admin_role'),
  '0009_bookings_booked_via_nusso.sql': col('bookings', 'booked_via_nusso'),
  '0010_space_series_recurrence_id.sql': col('space_bookings', 'recurrence_id'),
  '0011_audit_log_source.sql': col('audit_logs', 'source'),
  '0012_event_form_waivers.sql': col('event_tracking', 'event_management_form_waived'),
  '0013_audit_log_requested_action.sql': `coalesce(${constraintDef('audit_logs_action_check')} like '%requested%', false)`,
  '0014_slack_reminders_per_channel.sql': `exists (select 1 from pg_constraint where conname = 'slack_meeting_reminders_booking_date_channel_key')`,
  '0015_sbp_admin_role.sql': `coalesce(${constraintDef('users_admin_role_check')} like '%Student Body President%', false)`,
  '0016_room_requests_csc_requested.sql': col('room_requests', 'csc_requested_at'),
  '0017_weekly_cancel_reminder.sql': col('app_settings', 'cancel_reminder_channel_id'),
  '0018_call_for_programs.sql': col('semesters', 'term'),
  '0018_event_slack_channels.sql': table('event_slack_channels'),
  '0019_room_request_picked_room.sql': col('room_request_details', 'room_source'),
  '0020_remove_dim_admin_role.sql': `coalesce(${constraintDef('users_admin_role_check')} not like '%Digital Innovation Manager%', false)`,
  '0021_users_sgauth_user_id.sql': col('users', 'sgauth_user_id'),
  '0022_sgauth_positions.sql': table('sgauth_positions'),
  '0023_status_split.sql': col('one_time_room_bookings', 'ops_status'),
}

/** The numbered files in `dir`, in the order they apply. */
export function readMigrations(dir) {
  return readdirSync(dir)
    .filter(name => MIGRATION_FILE.test(name))
    .sort()
    .map(name => {
      const sql = readFileSync(join(dir, name), 'utf8')
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') }
    })
}

/**
 * Brings `db` up to date with `files`.
 *
 * Returns what it found and did: `baselined` (recorded as already present on a
 * first run), `applied` (run now), `pending` (what a dry run would apply), and
 * `changed` (recorded files whose contents have since been edited -- a warning,
 * since an applied file is never re-run).
 */
export async function migrate(db, files, { dryRun = false, log = console.log } = {}) {
  await db.query('select pg_advisory_lock($1)', [LOCK_KEY])
  try {
    const { rows: [{ exists: hasRecord }] } = await db.query(
      `select to_regclass('public.schema_migrations') is not null as exists`
    )

    const recorded = new Map()
    const baselined = []
    if (hasRecord) {
      const { rows } = await db.query('select name, checksum from public.schema_migrations')
      for (const r of rows) recorded.set(r.name, r.checksum)
    } else {
      const present = []
      for (const f of files) {
        const probe = BASELINE_PROBES[f.name]
        if (!probe) break
        const { rows: [{ ok }] } = await db.query(`select (${probe}) as ok`)
        present.push(ok)
      }
      // Present files must be a prefix: 1..n applied, the rest not.
      const firstMissing = present.indexOf(false)
      const lastPresent = present.lastIndexOf(true)
      if (firstMissing !== -1 && lastPresent > firstMissing) {
        const missing = files.slice(0, lastPresent).filter((_, i) => !present[i]).map(f => f.name)
        throw new Error(
          `Can't tell where this database is: ${files[lastPresent].name} is present but ${missing.join(', ')} ` +
          `${missing.length === 1 ? 'is' : 'are'} not. Apply or record those by hand before migrating.`
        )
      }
      const count = firstMissing === -1 ? present.length : firstMissing
      baselined.push(...files.slice(0, count).map(f => f.name))
      if (!dryRun) {
        await db.exec('begin')
        try {
          await db.exec(`
            create table if not exists public.schema_migrations (
              name text primary key,
              checksum text not null,
              applied_at timestamp with time zone not null default now(),
              -- 'migrate' when this runner applied it, 'baseline' when it found
              -- the file already applied on its first run.
              recorded_by text not null check (recorded_by in ('migrate', 'baseline'))
            );
            alter table public.schema_migrations enable row level security;
          `)
          for (const name of baselined) {
            const f = files.find(x => x.name === name)
            await db.query(
              `insert into public.schema_migrations (name, checksum, recorded_by) values ($1, $2, 'baseline')`,
              [f.name, f.checksum]
            )
          }
          await db.exec('commit')
        } catch (e) {
          await db.exec('rollback').catch(() => {})
          throw e
        }
      }
      for (const name of baselined) recorded.set(name, files.find(x => x.name === name).checksum)
      if (baselined.length) log(`recorded ${baselined.length} file(s) already applied, through ${baselined.at(-1)}`)
    }

    const changed = files
      .filter(f => recorded.has(f.name) && recorded.get(f.name) !== f.checksum)
      .map(f => f.name)
    for (const name of changed) log(`warning: ${name} has changed since it was applied; it will not run again`)

    const pending = files.filter(f => !recorded.has(f.name))
    const applied = []
    if (dryRun) {
      log(pending.length ? `would apply: ${pending.map(f => f.name).join(', ')}` : 'up to date')
    } else {
      for (const f of pending) {
        await db.exec('begin')
        try {
          await db.exec(f.sql)
          await db.query(
            `insert into public.schema_migrations (name, checksum, recorded_by) values ($1, $2, 'migrate')`,
            [f.name, f.checksum]
          )
          await db.exec('commit')
        } catch (e) {
          await db.exec('rollback').catch(() => {})
          throw new Error(`${f.name} failed and was rolled back: ${e.message}`)
        }
        applied.push(f.name)
        log(`applied ${f.name}`)
      }
      if (!pending.length) log('up to date')
    }

    return { baselined, applied, pending: pending.map(f => f.name), changed }
  } finally {
    await db.query('select pg_advisory_unlock($1)', [LOCK_KEY])
  }
}

/**
 * Refreshes a Neon branch's Data API schema cache, which Neon does not do on a
 * schema change (db/neon/README.md). A PATCH with an empty body changes no
 * settings and always refreshes the cache:
 * https://neon.com/docs/data-api/manage
 */
export async function refreshDataApiSchema({ apiKey, projectId, branchId, database, fetchImpl = fetch }) {
  const url = `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}` +
    `/branches/${encodeURIComponent(branchId)}/data-api/${encodeURIComponent(database)}`
  const res = await fetchImpl(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}',
  })
  if (!res.ok) throw new Error(`Neon refused the schema cache refresh (HTTP ${res.status}): ${await res.text()}`)
}
