import { NextResponse, type NextRequest } from 'next/server'
import { createSgaProxy } from '@nusgaops/sgauth/proxy'

/**
 * Sends signed-out visitors to SGAuth sign-in (issue #149), when SGAUTH_ENABLED
 * is on. With it off this passes every request through untouched, and Better
 * Auth's login page is the way in, as before.
 *
 * It only checks that SGAuth's cookie is present -- it never calls SGAuth -- so
 * it is a redirect for people, not a lock. Every page and route still checks
 * the session itself (lib/auth.ts), and that is what refuses a bad cookie.
 *
 * Public paths, and why each one has to reach Chambers without a session:
 *
 *   /                      the landing page; it offers sign-in itself
 *   /faq, /legal           public pages
 *   /display, /api/display the kiosk screens, gated on DISPLAY_KEY instead
 *   /api/cron              GitHub Actions and Vercel cron, gated on CRON_SECRET
 *   /api/slack/command,
 *   /api/slack/interaction Slack's servers, verified by signing secret
 *   /api                   every other API route answers 401 JSON itself; a
 *                          307 to an HTML sign-in page would only confuse the
 *                          fetch() that asked
 *   /data-api-jwks*.json   fetched by Neon's Data API to verify Chambers' own
 *                          server tokens -- redirect these and every query fails
 *   /sw.js, /workbox-*,
 *   /manifest.json, /icons the PWA's own files
 *   /opsemaillogo.png      loaded by mail clients from sent email
 *   /signup,
 *   /reset-password        redirect to SGAuth themselves under the flag
 */
const sgaProxy = createSgaProxy({
  publicPaths: [
    '/',
    '/faq',
    '/legal',
    '/display',
    '/api',
    '/signup',
    '/reset-password',
    '/manifest.json',
    '/icons',
    '/sw.js',
    '/opsemaillogo.png',
    /^\/workbox-[^/]+\.js$/,
    /^\/data-api-jwks[^/]*\.json$/,
  ],
})

export function proxy(request: NextRequest) {
  if (process.env.SGAUTH_ENABLED !== 'true') return NextResponse.next()
  return sgaProxy(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
