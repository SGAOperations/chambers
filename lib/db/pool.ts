import { Pool } from 'pg'

/**
 * The one Postgres pool for this server instance (issue #136).
 *
 * DATABASE_URL is the Neon *pooled* connection string (the host with -pooler),
 * which puts PgBouncer between these connections and the database. That matters
 * on Vercel, where every warm function instance holds its own pool: without the
 * pooler, a burst of instances would exhaust Postgres' own connection limit.
 *
 * Kept on globalThis so Next's dev server, which re-evaluates modules on every
 * edit, reuses one pool instead of leaking a new one per reload.
 */

const globalForPool = globalThis as unknown as { chambersPool?: Pool }

export const pool =
  globalForPool.chambersPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Small on purpose: this is per instance, and the pooler multiplexes behind it.
    max: 5,
    idleTimeoutMillis: 30_000,
  })

if (process.env.NODE_ENV !== 'production') globalForPool.chambersPool = pool
