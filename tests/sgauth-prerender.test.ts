import { afterAll, beforeAll, expect, it, vi } from 'vitest'

/**
 * A Vercel build with SGAUTH_ENABLED on and SGAUTH_URL unset -- a Preview
 * branch that inherits the flag but not the URL -- must still build.
 *
 * During `next build`, headers() throws to tell Next a page is per-request,
 * and Next stops prerendering it. If the SGAuth client is built before that
 * call, the real SDK throws SgauthConfigError first and the build fails on
 * every dashboard page. This uses the real SDK, with no client built yet.
 */

const bailout = new Error('Dynamic server usage: headers')
vi.mock('next/headers', () => ({
  headers: async () => {
    throw bailout
  },
}))

beforeAll(() => {
  process.env.SGAUTH_ENABLED = 'true'
  delete process.env.SGAUTH_URL
})
afterAll(() => {
  delete process.env.SGAUTH_ENABLED
})

it('reaches headers() before the SGAuth client can complain about its config', async () => {
  const { getSgauthSession } = await import('@/lib/sgauth')
  await expect(getSgauthSession()).rejects.toBe(bailout)
})
