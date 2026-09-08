import type { SupabaseClient } from '@supabase/supabase-js'
import { isNetworkError, isOffline } from './network-error'

/**
 * Ends the session on this device, including when there is no network to tell
 * the server about it.
 *
 * The idle timer's sign-out was quietly a no-op whenever it fired offline, which
 * is exactly when it fires most: the laptop wakes, the 12-hour deadline has
 * passed, and the network has not come back yet (issue #71).
 *
 * supabase-js is the reason. signOut() POSTs to /auth/v1/logout first and only
 * clears local storage afterwards, and it forgives just three failures on the
 * way -- 404, 401 and 403, all of which mean the session is already dead. A
 * network failure is none of those, so it returns early and _removeSession()
 * never runs. The session survives, signOut() resolves rather than rejecting so
 * the caller's .then() still redirects, and the user lands on the login page
 * still holding valid credentials. When the network returns, LoginCard's
 * checkAuth finds that session and sends them straight back in. The forced
 * logout had not happened at all.
 *
 * So the local half is made to happen either way. Offline, the POST is skipped
 * outright -- it cannot succeed, and waiting for it to fail only delays the
 * redirect.
 *
 * Scope stays 'local': this ends the session in this browser, not every session
 * the user holds. The paths that mean "this account may not be used" keep the
 * global scope -- see force-sign-out.tsx and LoginCard.
 */
export async function signOutThisDevice(supabase: SupabaseClient): Promise<void> {
  if (isOffline()) {
    forgetLocalSession()
    return
  }

  const { error } = await supabase.auth.signOut({ scope: 'local' })

  // Anything the server actually answered has already been handled by
  // supabase-js, which cleared storage. Only a request that never arrived
  // leaves the session behind.
  if (isNetworkError(error)) forgetLocalSession()
}

/**
 * Drops the stored session without asking the server's permission.
 *
 * @supabase/ssr keeps the session in cookies rather than localStorage so the
 * server can read it too, under `sb-<project ref>-auth-token`, split across
 * `.0`, `.1`, ... when it outgrows one cookie. Everything with that prefix goes.
 *
 * Reaching for the storage key directly is not lovely, but the alternative is
 * leaving a session the user asked to end -- and auth-js exposes no supported
 * way to clear it without a round trip it cannot make. auth-js re-reads storage
 * on every getSession()/getClaims() rather than caching in memory, so clearing
 * these is enough to make the session gone.
 */
function forgetLocalSession(): void {
  const key = authStorageKey()
  if (!key) return

  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim()
    if (name && name.startsWith(key)) {
      document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`
    }
  }

  // Belt and braces: the PKCE code verifier lives beside the token, and a
  // `userStorage` split would put part of the session in localStorage.
  try {
    const stale = Object.keys(localStorage).filter(k => k.startsWith(key))
    stale.forEach(k => localStorage.removeItem(k))
  } catch {
    // Storage can throw outright when site data is blocked. Nothing to undo.
  }
}

/**
 * The storage key @supabase/ssr derives for this project, `sb-<ref>-auth-token`.
 *
 * The ref is the first hostname label of the project URL, which is the same
 * thing @supabase/ssr does with it. Returns '' rather than throwing if the URL
 * is missing or malformed, so a misconfigured environment cannot take out the
 * sign-out path.
 */
function authStorageKey(): string {
  try {
    const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0]
    return ref ? `sb-${ref}-auth-token` : ''
  } catch {
    return ''
  }
}
