'use client'

import { createContext, useContext } from 'react'
import type { ShellIdentity } from '@/lib/shell-identity'

/**
 * The identity the server resolved for this request, made available to client
 * components below the shell.
 *
 * AdminGuard and EventsGuard used to answer "may I see this page?" by calling
 * getAuthedUser() themselves, which in the browser means a JWKS fetch against the
 * Supabase origin before the page could paint. The answer is already in the
 * document now, so they read it from here instead and render synchronously.
 */
export const IdentityContext = createContext<ShellIdentity | null>(null)

/**
 * Throws outside the dashboard shell rather than returning a null-ish default:
 * a guard that silently reads "not an admin" because its provider is missing
 * would fail closed but invisibly, and that is worse than a loud error.
 */
export function useIdentity(): ShellIdentity {
  const identity = useContext(IdentityContext)
  if (!identity) {
    throw new Error('useIdentity must be used within the dashboard shell')
  }
  return identity
}
