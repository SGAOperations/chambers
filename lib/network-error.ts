/**
 * Telling "the server said no" apart from "the request never got there", and
 * saying so in words a user can act on.
 *
 * Written for issue #71. A user came back to a sleeping laptop, was signed out
 * by the idle timer, and their first sign-in attempts failed with "failed to
 * fetch" before eventually working. Supabase's edge logs show no 429s, no 5xx,
 * and no failed POSTs to /auth/v1/token across the whole period -- the requests
 * never reached Supabase at all. The device's network was still coming back
 * (waking Wi-Fi, or a campus captive portal reauthenticating), and the browser
 * gave up on the fetch.
 *
 * "Failed to fetch" is Chrome's internal wording for that, and it went straight
 * to the screen because the login form rendered `error.message` verbatim. The
 * service worker made it worse rather than better: the login page is served
 * from cache, so an offline visitor sees a page that looks entirely live and
 * has no way to tell that nothing they type can leave the machine.
 */

/**
 * How the browsers word a fetch that never completed. Each engine picks its
 * own, and none of them are meant for a user to read.
 */
const NETWORK_ERROR_PATTERNS = [
  'failed to fetch',                   // Chrome, Edge
  'networkerror',                      // Firefox: "NetworkError when attempting to fetch resource."
  'load failed',                       // Safari
  'network request failed',
  'connection appears to be offline',  // Safari, on a known-down interface
  'network error',
]

/**
 * Waits between sign-in retries. Two of them, ~2.8s of patience in total, which
 * covers most of the gap between a screen waking and the network answering
 * again without leaving anyone staring at a spinner.
 */
const RETRY_DELAYS_MS = [800, 2000]

export const OFFLINE_MESSAGE =
  "You're offline. Reconnect to the internet and try again."

export const NETWORK_ERROR_MESSAGE =
  "Couldn't reach Chambers. Check your connection and try again."

/**
 * True only when the browser is certain there is no connection.
 *
 * The certainty runs one way: `onLine === false` means no interface is up, so
 * there is genuinely nothing to try. `true` only means an interface exists --
 * it says nothing about whether anything is reachable through it, which is
 * exactly the state a just-woken laptop is in. So this is safe to branch on for
 * "definitely offline" and useless for "definitely online".
 */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * Whether a failure is the browser giving up on the request rather than the
 * server rejecting it.
 *
 * Both supabase-js layers are covered. Auth wraps a fetch TypeError as
 * AuthRetryableFetchError with status 0; PostgREST has no error class and
 * passes the TypeError's message through. Bad credentials arrive as an
 * AuthApiError with a real HTTP status and match none of this, which is the
 * point -- a wrong password must never be retried or relabelled as a network
 * problem.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const { name, status, message } = error as {
    name?: unknown
    status?: unknown
    message?: unknown
  }

  if (name === 'AuthRetryableFetchError') return true
  if (status === 0) return true

  const text = typeof message === 'string' ? message.toLowerCase() : ''
  return NETWORK_ERROR_PATTERNS.some(pattern => text.includes(pattern))
}

/**
 * The message to show for a network failure, distinguishing a connection that
 * is known to be down from one that merely did not answer.
 */
export function networkErrorMessage(): string {
  return isOffline() ? OFFLINE_MESSAGE : NETWORK_ERROR_MESSAGE
}

/**
 * Runs `attempt` again when it fails for network reasons, and only then.
 *
 * supabase-js reports failures in the resolved value rather than by throwing,
 * so this inspects `result.error` instead of catching. Anything the server
 * actually answered -- a wrong password, a 403, a rate limit -- is returned
 * untouched on the first try: retrying those would spend the caller's Supabase
 * auth rate limit to get the same answer again.
 *
 * `onRetry` fires before each wait so the caller can say what is happening
 * rather than leaving the button reading "Signing in..." for three seconds.
 */
export async function withNetworkRetry<T extends { error: unknown }>(
  attempt: () => Promise<T>,
  onRetry?: () => void
): Promise<T> {
  let result = await attempt()

  for (const delay of RETRY_DELAYS_MS) {
    if (!isNetworkError(result.error)) return result
    // Nothing to retry into. Return now so the caller can say "you're offline"
    // immediately instead of after the full backoff.
    if (isOffline()) return result

    onRetry?.()
    await new Promise(resolve => setTimeout(resolve, delay))
    result = await attempt()
  }

  return result
}
