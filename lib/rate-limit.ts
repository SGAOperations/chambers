import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// `ephemeralCache` lets a warm instance answer from memory for an identifier it
// has already seen, instead of paying an Upstash REST round trip on every
// request. Upstash is still the source of truth across instances.
export const rateLimiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(60, '1 m'),
  analytics: false,
  ephemeralCache: new Map(),
})
