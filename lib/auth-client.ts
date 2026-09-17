import { createAuthClient } from 'better-auth/react'

/**
 * The browser's handle on Chambers' login (issue #136): sign in, sign out,
 * request and complete a password reset. Everything else about the signed-in
 * user -- roles, onboarding, memberships -- comes from Chambers' own API routes,
 * which read the users row rather than trusting anything the browser holds.
 *
 * No baseURL: the endpoints are same-origin, under /api/auth.
 */
export const authClient = createAuthClient()
