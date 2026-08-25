import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// Kept in its own module so the ~40 routes that only need `rateLimiter` don't
// construct a second Redis client and Ratelimit instance at module load.
export const signupRateLimiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, '10 m'),
  analytics: false,
  prefix: 'signup',
  ephemeralCache: new Map(),
})
