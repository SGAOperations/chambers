import { rateLimiter } from './rate-limit'
import { NextResponse } from 'next/server'

export async function checkRateLimit(identifier: string): Promise<NextResponse | null> {
  const { success } = await rateLimiter.limit(identifier)
  if (!success) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }
  return null
}
