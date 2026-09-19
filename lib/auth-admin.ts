import { auth } from './better-auth'
import { pool } from './db/pool'

/**
 * Account changes made by trusted server code rather than by the user signing in
 * (issue #136): creating accounts for invites and signup codes, setting a
 * one-time password, ending someone's sessions.
 *
 * These replace supabase.auth.admin.*. They go through Better Auth's internal
 * adapter, so hashing and the table mapping stay in one place (lib/better-auth.ts),
 * and they do not need the caller to hold a Better Auth admin role: every caller
 * has already checked Chambers' own roles before getting here.
 */

async function context() {
  return auth.$context
}

/**
 * Creates a user who signs in with `password`, and returns their id.
 *
 * The users row is created here too, since it is Better Auth's user -- the
 * on_auth_user_created trigger that used to do that under Supabase is gone.
 * Anything else about the user (roles, OTP hash) is written by the caller.
 */
export async function createPasswordUser({
  email,
  fullName,
  password,
}: {
  email: string
  fullName: string
  password: string
}): Promise<string> {
  const ctx = await context()
  const normalized = email.trim().toLowerCase()

  const user = await ctx.internalAdapter.createUser({
    email: normalized,
    name: fullName,
    emailVerified: true,
  }, { method: 'admin' })
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    accountId: user.id,
    providerId: 'credential',
    password: await ctx.password.hash(password),
  })
  return user.id
}

/**
 * Replaces a user's password, creating their credential account if they somehow
 * have none.
 */
export async function setUserPassword(userId: string, password: string): Promise<void> {
  const ctx = await context()
  const hashed = await ctx.password.hash(password)
  const accounts = await ctx.internalAdapter.findAccountByUserId(userId)
  if (accounts.some(a => a.providerId === 'credential')) {
    await ctx.internalAdapter.updatePassword(userId, hashed)
  } else {
    await ctx.internalAdapter.linkAccount({ userId, accountId: userId, providerId: 'credential', password: hashed })
  }
}

/**
 * Ends every session the user holds, on every device, effective on their next
 * request -- sessions are checked against the database each time.
 *
 * sessions_revoked_at is still stamped so the record of when it happened
 * survives, and so the check in lib/authorization.ts keeps meaning the same
 * thing.
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  const ctx = await context()
  await ctx.internalAdapter.deleteUserSessions(userId)
  await pool.query('update public.users set sessions_revoked_at = now() where id = $1', [userId])
}
