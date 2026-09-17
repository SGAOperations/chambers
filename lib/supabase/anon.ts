import { createClient } from '@supabase/supabase-js'

/**
 * The client for data that is the same for everybody: the public homepage's
 * counts and the Comptroller's name.
 *
 * The distinction from lib/supabase/server.ts is not really about permissions --
 * it is about rendering. That client used to read cookies() to scope requests to
 * the signed-in user, and calling cookies() opts the surrounding route into
 * dynamic rendering. A page that only wants public data would then re-render,
 * and re-query, on every single request purely because of how it built its
 * client. This one reads no cookies, so the page stays statically renderable and
 * can be revalidated on a timer.
 *
 * Service role since issue #136: what made the anon key safe here were Supabase
 * row-level security policies, which do not survive the move to Neon. These
 * reads only ever run on the server, and each one names the exact columns it
 * shows, so nothing reaches the page that the page does not render.
 *
 * Module-level on purpose: it holds no per-request state, so one instance is
 * reused across requests in a warm function rather than being rebuilt each time.
 */
export const anonSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)
