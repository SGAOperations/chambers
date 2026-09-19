import { authClient } from './auth-client'
import { isNetworkError, isOffline } from './network-error'

/**
 * Ends the session on this device, including when there is no network to tell
 * the server about it.
 *
 * The idle timer's sign-out fires most often exactly when there is no network:
 * the laptop wakes, the 12-hour deadline has passed, and the connection has not
 * come back yet (issue #71).
 *
 * Under Supabase the session lived in cookies script could clear. Better Auth's
 * session cookie is httpOnly (issue #136), so script cannot clear it, and a
 * sign-out that never reached the server leaves the session alive. Instead the
 * sign-out is remembered, and finishSignOutIfPending() completes it the next
 * time the login page loads with a connection -- before it would otherwise have
 * sent the user straight back in.
 *
 * Scope is this device. The paths that mean "this account may not be used" end
 * every session on the server instead (lib/auth-admin.ts revokeUserSessions).
 */
const PENDING_KEY = 'chambers_pending_sign_out'

export async function signOutThisDevice(): Promise<void> {
  if (isOffline()) {
    rememberPendingSignOut()
    return
  }

  try {
    const { error } = await authClient.signOut()
    if (isNetworkError(error)) rememberPendingSignOut()
  } catch (e) {
    if (isNetworkError(e)) rememberPendingSignOut()
    else throw e
  }
}

/**
 * Finishes a sign-out that could not reach the server. Returns true when there
 * was one, so the caller knows not to route a session it just ended.
 */
export async function finishSignOutIfPending(): Promise<boolean> {
  let pending = false
  try {
    pending = localStorage.getItem(PENDING_KEY) === '1'
  } catch {
    return false
  }
  if (!pending || isOffline()) return pending

  const { error } = await authClient.signOut()
  if (!isNetworkError(error)) {
    try {
      localStorage.removeItem(PENDING_KEY)
    } catch {}
  }
  return true
}

function rememberPendingSignOut(): void {
  try {
    localStorage.setItem(PENDING_KEY, '1')
  } catch {
    // Storage blocked: nothing more can be done offline.
  }
}
