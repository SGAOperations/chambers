/*
 * Chambers for NUSSO -- background service worker.
 *
 * Northeastern accepts connections to nuevents.neu.edu (EMS, "NUSSO") only
 * from the campus network or the VPN, so Chambers' servers cannot reach it.
 * This extension lets the Chambers page reach it the way you already can:
 * from your own browser, with your own NUSSO sign-in. Chambers decides what to
 * ask; this script sends that one ServerApi call to EMS with your session and
 * hands back EMS's answer. It stores nothing and knows no password.
 *
 * Messages (chrome.runtime.sendMessage from a Chambers page only -- see
 * externally_connectable in manifest.json):
 *   { type: 'hello' }   -> { ok: true, version }
 *   { type: 'status' }  -> { ok: true, signedIn } | { ok: false, code, error }
 *   { type: 'serverApi', method, body, referer }
 *                        -> { ok: true, data } | { ok: false, code, error }
 * Error codes: 'unreachable' (not on campus / VPN), 'signed-out' (no NUSSO
 * session in this browser), 'refused' (not an allowed call), 'http' (EMS error).
 */
const EMS = 'https://nuevents.neu.edu'

/** The ServerApi methods Chambers uses (lib/nusso/client.ts). Nothing else is sent. */
const ALLOWED_METHODS = new Set([
  'GetBrowseLocationsRooms',
  'GetBrowseLocationsBookings',
  'GetAvailabilityList',
  'AddToCartCheck',
  'GetServicesForBooking',
  'SaveReservation',
  'CancelBooking',
])

const TOKEN_TTL_MS = 10 * 60 * 1000
let csrf = null // { token, at }

class EmsError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// --- Request headers ---------------------------------------------------------
//
// A fetch from this worker carries Origin: chrome-extension://<id> and no
// Referer. EMS's own pages send Origin/Referer of nuevents.neu.edu, so set them
// with session rules, which (unlike static rules) can match only requests that
// come from the extension itself (tabId -1) -- never your normal browsing.

const ORIGIN_RULE = 1
const REFERER_RULE = 2

function rule(id, header, value) {
  return {
    id,
    priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header, operation: 'set', value }] },
    condition: { requestDomains: ['nuevents.neu.edu'], tabIds: [-1] },
  }
}

async function setReferer(referer) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ORIGIN_RULE, REFERER_RULE],
    addRules: [rule(ORIGIN_RULE, 'Origin', EMS), rule(REFERER_RULE, 'Referer', referer)],
  })
}

// One EMS call at a time: the Referer rule is shared, and EMS should not be
// hammered anyway.
let queue = Promise.resolve()
function serialized(fn) {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

async function emsFetch(path, init) {
  try {
    return await fetch(`${EMS}${path}`, { credentials: 'include', redirect: 'manual', cache: 'no-store', ...init })
  } catch {
    throw new EmsError('unreachable', 'Could not reach nuevents.neu.edu. Connect to campus Wi-Fi or the Northeastern VPN.')
  }
}

// --- Session -----------------------------------------------------------------

function csrfFrom(html) {
  const m =
    /<input[^>]*\b(?:name|id)=["']deaCSRFToken["'][^>]*\bvalue=["']([^"']+)["']/i.exec(html) ||
    /<input[^>]*\bvalue=["']([^"']+)["'][^>]*\b(?:name|id)=["']deaCSRFToken["']/i.exec(html)
  return m ? m[1] : null
}

/**
 * The CSRF token of your signed-in NUSSO session. An app page only renders it
 * when you are signed in; signed out, EMS redirects to its login page.
 */
async function csrfToken(force = false) {
  if (!force && csrf && Date.now() - csrf.at < TOKEN_TTL_MS) return csrf.token
  await setReferer(`${EMS}/`)
  const res = await emsFetch('/BrowseForSpace.aspx', { headers: { Accept: 'text/html' } })
  const html = res.type === 'opaqueredirect' || res.status >= 300 ? '' : await res.text()
  const token = csrfFrom(html)
  if (!token) {
    csrf = null
    throw new EmsError('signed-out', 'You are not signed in to NUSSO in this browser. Sign in at nuevents.neu.edu, then try again.')
  }
  csrf = { token, at: Date.now() }
  return token
}

async function serverApi(method, body, referer, retried = false) {
  const token = await csrfToken(retried)
  await setReferer(referer && referer.startsWith(`${EMS}/`) ? referer : `${EMS}/BrowseForSpace.aspx`)
  const res = await emsFetch(`/ServerApi.aspx/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'dea-CSRFToken': token,
    },
    body: JSON.stringify(body ?? {}),
  })
  const text = res.type === 'opaqueredirect' ? '' : await res.text()
  const json = text.trimStart().startsWith('{')

  // A lapsed session answers with a redirect or the login page, not an error.
  if (!json && !retried && (res.type === 'opaqueredirect' || res.status < 500)) {
    return serverApi(method, body, referer, true)
  }
  if (!json && (res.type === 'opaqueredirect' || res.status < 500)) {
    throw new EmsError('signed-out', 'Your NUSSO sign-in has expired. Sign in again at nuevents.neu.edu.')
  }
  if (!res.ok) throw new EmsError('http', `NUSSO answered HTTP ${res.status} to ${method}.`)
  return JSON.parse(text)
}

// --- Messages from Chambers ----------------------------------------------------

async function handle(msg) {
  switch (msg && msg.type) {
    case 'hello':
      return { ok: true, version: chrome.runtime.getManifest().version }
    case 'status':
      return serialized(async () => {
        try {
          await csrfToken(true)
          return { ok: true, signedIn: true }
        } catch (e) {
          if (e.code === 'signed-out') return { ok: true, signedIn: false }
          throw e
        }
      })
    case 'serverApi': {
      if (typeof msg.method !== 'string' || !ALLOWED_METHODS.has(msg.method)) {
        throw new EmsError('refused', `Chambers for NUSSO does not send ${String(msg.method)}.`)
      }
      const data = await serialized(() => serverApi(msg.method, msg.body, msg.referer))
      return { ok: true, data }
    }
    default:
      throw new EmsError('refused', 'Unknown request.')
  }
}

chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch(e => sendResponse({ ok: false, code: e.code || 'error', error: e.message || String(e) }))
  return true // answer asynchronously
})

// Opening the toolbar button takes you to NUSSO, e.g. to sign in.
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: `${EMS}/` }))
