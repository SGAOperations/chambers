import type { SupabaseClient } from '@supabase/supabase-js'

export type AuthedUser = {
  id: string
  email?: string
  app_metadata: {
    is_admin?: boolean
    iems_role?: string
    admin_role?: string
    [key: string]: unknown
  }
}

/**
 * Verifies the caller's JWT and returns a user-shaped object, or null when
 * there is no valid session.
 *
 * Uses getClaims() rather than getUser(). This project signs tokens with ES256
 * (asymmetric), so getClaims() verifies the signature locally against a cached
 * JWKS instead of making a network round trip to the Auth server on every call.
 * The signature is still cryptographically verified -- this is not the same as
 * trusting getSession(), which does no verification at all.
 *
 * The return shape intentionally mirrors the parts of getUser()'s `user` that
 * this app actually reads (`id` and `app_metadata`), so call sites stay
 * unchanged apart from the call itself.
 */
export async function getAuthedUser(
  supabase: SupabaseClient
): Promise<AuthedUser | null> {
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims) return null

  const claims = data.claims
  if (typeof claims.sub !== 'string' || !claims.sub) return null

  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    app_metadata: (claims.app_metadata ?? {}) as AuthedUser['app_metadata'],
  }
}
