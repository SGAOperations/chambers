import type { SgaSession } from '@nusgaops/sgauth'

/**
 * An SGAuth session as the SDK would return it, holding `positionKeys`.
 * `id` defaults to a stable uuid derived from the email, so the same person
 * resolves to the same Chambers row across calls.
 */
export function sessionFor(email: string, positionKeys: string[] = [], id?: string): SgaSession {
  const now = new Date()
  return {
    user: {
      id: id ?? uuidFrom(email),
      email,
      name: email.split('@')[0],
      preferredName: null,
      isAdmin: false,
      isPrimaryAdmin: false,
    } as SgaSession['user'],
    positions: positionKeys.map(key => ({ key, name: key })),
    session: {
      id: `session-${email}`,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      absoluteExpiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    },
  }
}

function uuidFrom(s: string): string {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const hex = h.toString(16).padStart(8, '0')
  return `${hex}-0000-4000-8000-${hex}0000`.slice(0, 36)
}

/**
 * A stand-in for the Data API client (lib/db/data-api.ts) for routes whose
 * authorization is under test, not their queries: every builder method returns
 * the builder, and awaiting it gives an empty, successful result.
 */
export function emptyDataApi(): unknown {
  const result = { data: [], error: null, count: 0 }
  const builder: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
      return () => builder
    },
    apply() {
      return builder
    },
  })
  return builder
}
