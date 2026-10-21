import { NextResponse } from 'next/server'
import { rateLimiter } from '@/lib/rate-limit'

/**
 * Hit by a GitHub Action (.github/workflows/keep-warm.yml) every few minutes to
 * keep a warm function instance -- and its Upstash connection -- alive, so real
 * dashboard loads skip the cold-start and connection-warmup cost.
 *
 * It deliberately does not touch the database. Neon suspends the compute after
 * 5 idle minutes, and a 5-minute ping that queried it kept production awake ~80%
 * of the time, which on its own spent nearly the whole monthly CU-hour allowance
 * at the 0.25 CU floor. The first load after an idle stretch now pays for Neon
 * waking up instead.
 *
 * Set the CRON_SECRET env var to gate this. Without it the endpoint is open, but
 * all it does is one rate-limiter call.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const warmed = await Promise.allSettled([
    rateLimiter.limit('cron:warm'), // warms the Upstash connection
  ])

  return NextResponse.json({ ok: true, warmed: warmed.map(r => r.status) })
}
