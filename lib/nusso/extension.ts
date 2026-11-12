/**
 * The Chambers for NUSSO browser extension (extension/nusso), seen from a
 * Chambers page.
 *
 * Northeastern accepts connections to nuevents.neu.edu only from the campus
 * network or the VPN, and Chambers' servers are outside both. So when the
 * extension is installed, the Browse/Book page runs the NUSSO client
 * (lib/nusso/client.ts) in the browser and the extension sends each ServerApi
 * call from the person's own browser, with their own NUSSO sign-in. Chambers'
 * server never connects to EMS; it only checks who may book and records what
 * was booked.
 *
 * Browser-only: uses chrome.runtime, which pages see when an extension lists
 * them under externally_connectable.
 */
import type { EmsCall } from './client'
import { NussoApiError, NussoAuthError, NussoUnreachableError } from './types'

/**
 * The extension's id. Fixed for an unpacked install by the `key` in its
 * manifest; a Chrome Web Store listing gets its own id, set with
 * NEXT_PUBLIC_NUSSO_EXTENSION_ID.
 */
export const NUSSO_EXTENSION_ID = process.env.NEXT_PUBLIC_NUSSO_EXTENSION_ID || 'plhndefpbpcglbhgmimjejkchmmoopbi'

interface ExtensionReply {
  ok: boolean
  code?: string
  error?: string
  version?: string
  signedIn?: boolean
  data?: unknown
}

interface ChromeRuntime {
  sendMessage(id: string, msg: unknown, cb: (reply: ExtensionReply | undefined) => void): void
  lastError?: { message?: string }
}

function runtime(): ChromeRuntime | null {
  const chrome = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome
  return chrome?.runtime?.sendMessage ? chrome.runtime : null
}

function send(msg: unknown, timeoutMs: number): Promise<ExtensionReply | null> {
  const rt = runtime()
  if (!rt) return Promise.resolve(null)
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    try {
      rt.sendMessage(NUSSO_EXTENSION_ID, msg, reply => {
        clearTimeout(timer)
        // Reading lastError is what tells Chrome the "not installed" case was handled.
        resolve(rt.lastError ? null : reply ?? null)
      })
    } catch {
      clearTimeout(timer)
      resolve(null)
    }
  })
}

/** The installed extension's version, or null when it is not installed. */
export async function detectNussoExtension(): Promise<string | null> {
  const reply = await send({ type: 'hello' }, 1500)
  return reply?.ok && reply.version ? reply.version : null
}

/** Turn an extension error reply into the error the NUSSO client would throw. */
function toError(reply: ExtensionReply | null, method: string): Error {
  if (!reply) return new NussoUnreachableError('The Chambers for NUSSO extension did not answer. Reload the page, or reinstall the extension.')
  const message = reply.error || `NUSSO ${method} failed.`
  switch (reply.code) {
    case 'unreachable':
      return new NussoUnreachableError(message, 'EXTENSION_UNREACHABLE')
    case 'signed-out':
      return new NussoAuthError(message)
    default:
      return new NussoApiError(message)
  }
}

/** Sends one ServerApi call through the extension. */
export const extensionEmsCall: EmsCall = async (method, body, referer) => {
  // SaveReservation can take a while; never give up on it early.
  const reply = await send({ type: 'serverApi', method, body, referer }, 120_000)
  if (!reply?.ok) throw toError(reply, method)
  return reply.data
}
