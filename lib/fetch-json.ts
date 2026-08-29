/**
 * GET a JSON endpoint, falling back to a known-good value when the request does
 * not succeed.
 *
 * Written for a bug that took down the SGA Spaces page (issue #53). The call
 * sites all looked like this:
 *
 *   fetch('/api/spaces')
 *     .then(r => r.json())
 *     .then((data: Space[]) => setSpaces(data))
 *
 * The annotation is a promise the code cannot keep. An error response is still
 * valid JSON, so `r.json()` resolves happily with `{ error: 'Unauthorized' }`,
 * that object lands in state typed as an array, and the page dies on the next
 * `spaces.find(...)`. TypeScript cannot catch it: the cast is asserted at a
 * boundary where the real shape is only known at runtime.
 *
 * Passing the fallback in makes the failure case impossible to leave out, and
 * keeps the type honest -- the return is whatever the caller was already
 * prepared to render.
 *
 * Silent on failure by design: these are background reads whose call sites have
 * no error UI. Where "the request failed" is different from "there is nothing
 * here" -- as it is on the Spaces page, where an empty list reads as "no rooms
 * exist" -- handle the response explicitly instead of reaching for this.
 */
export async function getJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url)
    if (!res.ok) return fallback
    const data = await res.json()
    return (data ?? fallback) as T
  } catch {
    // Network failure, or a body that is not JSON at all (an HTML error page
    // from a proxy, say). Both are "no data", same as a non-2xx.
    return fallback
  }
}

/**
 * As getJson, but guarantees an array. Use for list endpoints whose result is
 * indexed, mapped or searched -- an object arriving where an array is expected
 * is precisely what crashed issue #53.
 */
export async function getJsonArray<T>(url: string): Promise<T[]> {
  const data = await getJson<unknown>(url, [])
  return Array.isArray(data) ? (data as T[]) : []
}
