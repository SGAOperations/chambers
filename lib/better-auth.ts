import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import bcrypt from 'bcryptjs'
import { pool } from './db/pool'
import { sendPasswordResetEmail } from './emails/password-reset'

/**
 * Chambers' login, on Better Auth (issue #136). Replaces Supabase Auth.
 *
 * Server-only. The browser talks to it through /api/auth/* (see
 * app/api/auth/[...all]/route.ts) and lib/auth-client.ts; server code reads the
 * session through lib/auth.ts and changes accounts through lib/auth-admin.ts.
 *
 * Choices worth knowing before changing anything here:
 *
 * - The user model IS public.users. A Chambers user and a login are one row with
 *   one id, as they were under Supabase. The field mapping below and
 *   db/neon/0002_better_auth.sql must agree.
 * - Passwords are bcrypt, not Better Auth's default scrypt. Every existing
 *   password was imported from Supabase as a bcrypt hash; hashing new ones the
 *   same way keeps one format and means nobody had to reset.
 * - Nobody signs up through Better Auth. Accounts are created by Chambers' own
 *   invite and signup-code flows (lib/auth-admin.ts), which is also why the
 *   sign-up endpoint is off rather than merely unused.
 * - Sessions live in auth_sessions and are checked against the database on every
 *   request -- no cookie cache. That is what makes revoking someone's sessions,
 *   or deactivating them, take effect on their very next request, which the old
 *   sessions_revoked_at check existed to approximate.
 */
export const auth = betterAuth({
  appName: 'Chambers',
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: pool,

  advanced: {
    database: { generateId: 'uuid' },
    cookiePrefix: 'chambers',
  },

  user: {
    modelName: 'users',
    fields: {
      name: 'full_name',
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  session: {
    modelName: 'auth_sessions',
    fields: {
      userId: 'user_id',
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    // Matches the 12-hour idle sign-out the dashboard already enforces in the
    // browser; a session that is used is extended at most once an hour.
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 60,
  },
  account: {
    modelName: 'auth_accounts',
    fields: {
      userId: 'user_id',
      accountId: 'account_id',
      providerId: 'provider_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  verification: {
    modelName: 'auth_verifications',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },

  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
    password: {
      hash: password => bcrypt.hash(password, 10),
      verify: ({ hash, password }) => bcrypt.compare(password, hash),
    },
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({ to: user.email, url })
    },
    resetPasswordTokenExpiresIn: 60 * 60,
    // Someone resetting a password may be doing it because another device has
    // the account; every other session ends.
    revokeSessionsOnPasswordReset: true,
  },

  databaseHooks: {
    session: {
      create: {
        // A deactivated account cannot start a session at all. Before this, the
        // login page signed a deactivated user in and then straight back out.
        before: async session => {
          const { rows } = await pool.query<{ is_active: boolean | null }>(
            'select is_active from public.users where id = $1',
            [session.userId]
          )
          if (!rows[0] || rows[0].is_active === false) return false
        },
      },
    },
  },

  // Must stay last: it sets cookies from server actions and route handlers.
  plugins: [nextCookies()],
})

export type Session = typeof auth.$Infer.Session
