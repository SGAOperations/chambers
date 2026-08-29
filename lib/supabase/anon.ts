import { createClient } from '@supabase/supabase-js'

/**
 * A Supabase client with the anon key and no cookies attached.
 *
 * The distinction from lib/supabase/server.ts is not really about permissions --
 * it is about rendering. That client reads cookies() to scope requests to the
 * signed-in user, and calling cookies() opts the surrounding route into dynamic
 * rendering. A page that only wants public data therefore ends up re-rendering,
 * and re-querying, on every single request purely because of how it built its
 * client.
 *
 * Use this for data that is the same for everybody and readable by `anon` under
 * RLS. Because no cookies are read, the page stays statically renderable and can
 * be revalidated on a timer instead.
 *
 * Module-level on purpose: it holds no per-request state, so one instance is
 * reused across requests in a warm function rather than being rebuilt each time.
 */
export const anonSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
