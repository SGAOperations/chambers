import { PostgrestClient } from '@supabase/postgrest-js'
import { SignJWT, importJWK, type JWK } from 'jose'

/**
 * Chambers' database client (issue #136): the Neon Data API, queried as the
 * `chambers_server` role.
 *
 * It speaks PostgREST, the same protocol Supabase's client did, so every
 * `.from(...).select(...).eq(...)` in the app works unchanged -- this replaced
 * the Supabase clients without rewriting the queries.
 *
 * Server-only. Each request carries a short-lived token this server signs with
 * DATA_API_PRIVATE_JWK; Neon verifies it against the public half published at
 * /data-api-jwks.json and switches to the role the token names. That key is as
 * sensitive as the database password: whoever holds it can read and write
 * every app table. Browsers never get a token -- they talk to Chambers' API
 * routes, which decide what the caller may do before they query (row-level
 * security is not part of access control; see db/neon/0003).
 *
 * Better Auth and the live role checks do not use this: they talk to Postgres
 * directly through lib/db/pool.ts.
 */

// Any schema: the app's queries were written against Supabase's untyped client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PostgrestClient<any, any, any>

const TOKEN_LIFETIME_S = 10 * 60
/** Re-sign this long before expiry, so a token never lapses mid-request. */
const REFRESH_MARGIN_S = 60

let signingKey: { key: CryptoKey | Uint8Array; kid: string } | null = null
let cached: { token: string; expiresAt: number } | null = null

async function key() {
  if (!signingKey) {
    const raw = process.env.DATA_API_PRIVATE_JWK
    if (!raw) throw new Error('DATA_API_PRIVATE_JWK is not set.')
    const jwk = JSON.parse(raw) as JWK & { kid: string }
    signingKey = { key: await importJWK(jwk, 'ES256'), kid: jwk.kid }
  }
  return signingKey
}

async function serverToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cached && cached.expiresAt - REFRESH_MARGIN_S > now) return cached.token

  const { key: k, kid } = await key()
  const expiresAt = now + TOKEN_LIFETIME_S
  const token = await new SignJWT({ role: 'chambers_server' })
    .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' })
    .setSubject('chambers-server')
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(k)
  cached = { token, expiresAt }
  return token
}

/**
 * Adds the server token to every request, and opts out of Next's fetch cache:
 * these are live reads and writes, never something to serve stale.
 */
const authedFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${await serverToken()}`)
  return fetch(input, { ...init, headers, cache: 'no-store' })
}

function create(): Db {
  const url = process.env.NEON_DATA_API_URL
  if (!url) throw new Error('NEON_DATA_API_URL is not set.')
  return new PostgrestClient(url.replace(/\/+$/, ''), { fetch: authedFetch })
}

const globalForDb = globalThis as unknown as { chambersDb?: Db }

/**
 * The client. Created on first use rather than at import, so a build that never
 * queries -- and a missing variable in an environment that does not need it --
 * does not fail at module load.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = (globalForDb.chambersDb ??= create())
    const value = Reflect.get(real, prop, real)
    // Bound so `this` is the real client, not this proxy.
    return typeof value === 'function' ? value.bind(real) : value
  },
})
