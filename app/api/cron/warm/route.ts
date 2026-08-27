import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/auth'
import { getActiveSemesterId } from '@/lib/active-semester'
import { rateLimiter } from '@/lib/rate-limit'

/**
 * Hit by a Vercel cron (see vercel.json) every few minutes to keep a warm
 * function instance -- and the pooled Supabase + Upstash connections it holds --
 * alive. On a cold path the first dashboard load pays a ~870ms first-connection
 * tax (measured on prod: /api/my-rooms cold ~870ms, warm ~250ms, on fresh
 * instances either way -- so the cost is connection warmup, not isolate boot).
 * Fluid Compute keeps the isolate around; this keeps what it talks to warm too.
 *
 * Set the CRON_SECRET env var to gate this; Vercel sends it as a bearer token
 * automatically. Without it the endpoint is open but only does trivial reads.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()

  const warmed = await Promise.allSettled([
    getAuthedUser(supabase), // warms the JWKS fetch
    getActiveSemesterId(supabase), // warms the Supabase pooler + primes the semester cache
    rateLimiter.limit('cron:warm'), // warms the Upstash connection
  ])

  return NextResponse.json({ ok: true, warmed: warmed.map(r => r.status) })
}
