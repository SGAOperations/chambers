import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The Supabase client server routes query with, until the query layer moves to
 * Neon (issue #136).
 *
 * This used to carry the signed-in user's Supabase session in its cookies, so
 * Postgres row-level security could see who was asking. Login is Better Auth
 * now and Supabase has no idea who that user is, so the same client would
 * arrive as `anon` and RLS would quietly return nothing.
 *
 * So it is the service-role client, like the 55 routes that already used one --
 * and row-level security stops being part of Chambers' access control, by
 * decision on #136. That is safe only because every route already decides access
 * in application code before it queries: getAuthedUserWithLiveRoles() for
 * anything role-gated, requireBookingManager()/canManageScoped() for a specific
 * booking, and an explicit filter to the caller's own rows or bodies for the
 * member-facing reads. RLS was a second layer behind those, never the only one.
 *
 * The rule that replaces it: a route that queries with this client must first
 * establish who the caller is and what they may see. There is no longer anything
 * underneath to catch a route that forgets.
 *
 * Async and named createClient so the existing call sites did not have to change.
 */
let client: SupabaseClient | null = null

export async function createClient(): Promise<SupabaseClient> {
  client ??= createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  return client
}
