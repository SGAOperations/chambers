import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Everything that reaches Chambers without a person behind it -- the kiosk
 * screens, Slack, GitHub Actions' cron calls, mail clients loading the logo,
 * Neon fetching the JWKS -- must get through the SGAuth proxy with no session
 * (issue #155). People without one are sent to sign in.
 *
 * The request carries no SGAuth cookie in every case here.
 */

let proxy: (req: NextRequest) => Response

beforeAll(async () => {
  process.env.SGAUTH_ENABLED = 'true'
  process.env.SGAUTH_URL = 'https://auth.example.test'
  ;({ proxy } = await import('@/proxy'))
})
afterAll(() => {
  delete process.env.SGAUTH_ENABLED
  delete process.env.SGAUTH_URL
})

function request(path: string, method = 'GET') {
  return proxy(new NextRequest(`https://chambers.northeasternsga.com${path}`, { method }))
}

const passesThrough = (res: Response) => res.headers.get('x-middleware-next') === '1'

describe('with no session', () => {
  it.each([
    ['the kiosk screens', '/display/display_chambers_2026'],
    ['the kiosk data', '/api/display/some-space'],
    ['GitHub Actions cron', '/api/cron/warm'],
    ['the Slack reminders cron', '/api/cron/slack-reminders'],
    ['the weekly cancel reminder cron', '/api/cron/weekly-cancel-reminder'],
    ['Slack slash commands', '/api/slack/command'],
    ['Slack interactions', '/api/slack/interaction'],
    ['the email logo', '/opsemaillogo.png'],
    ['the Data API JWKS', '/data-api-jwks.json'],
    ['the production JWKS', '/data-api-jwks-production.json'],
    ['the service worker', '/sw.js'],
    ['workbox', '/workbox-8b396bde.js'],
    ['the PWA manifest', '/manifest.json'],
    ['the PWA icons', '/icons/icon-192x192.png'],
    ['the landing page', '/'],
    ['the FAQ', '/faq'],
    ['the legal page', '/legal'],
  ])('lets through %s', async (_what, path) => {
    expect(passesThrough(await request(path))).toBe(true)
  })

  it('lets Slack POST without a session', async () => {
    expect(passesThrough(await request('/api/slack/command', 'POST'))).toBe(true)
  })

  it('lets every other API route answer for itself, with JSON rather than a redirect', async () => {
    expect(passesThrough(await request('/api/administrator/requests'))).toBe(true)
  })

  it.each(['/my-rooms', '/bookings', '/management', '/request', '/slack/connect'])(
    'sends a person opening %s to SGAuth sign-in, and back afterwards',
    async path => {
      const res = await request(path)
      expect(res.status).toBe(307)
      const location = new URL(res.headers.get('location')!)
      expect(location.origin).toBe('https://auth.example.test')
      expect(decodeURIComponent(location.search)).toContain(`https://chambers.northeasternsga.com${path}`)
    }
  )

  it('does not mistake a path that merely starts like a public one', async () => {
    expect((await request('/displayx')).status).toBe(307)
  })
})
