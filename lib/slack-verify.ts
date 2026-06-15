import { createHmac, timingSafeEqual } from 'crypto'

export async function verifySlackRequest(
  rawBody: string,
  timestamp: string | null,
  signature: string | null
): Promise<boolean> {
  if (!timestamp || !signature) return false
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false
  const sigBase = `v0:${timestamp}:${rawBody}`
  const expected =
    'v0=' +
    createHmac('sha256', process.env.SLACK_SIGNING_SECRET!)
      .update(sigBase)
      .digest('hex')
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}
