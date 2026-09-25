/**
 * A minimal client for Northeastern's EMS Web App at nuevents.neu.edu ("NUSSO").
 *
 * The app is ASP.NET WebForms with a JSON API at POST /ServerApi.aspx/<Method>.
 * There is no documented API and no OAuth: the browser authenticates with a
 * plain form post and every API call rides the resulting session cookies plus a
 * CSRF token. We reproduce exactly that. The full reverse-engineering notes are
 * in docs/nusso-api.md; the shape of the flow is:
 *
 *   login()                                   (docs: "Auth")
 *     GET  /               -> seed cookies (ASP.NET_SessionId, __AntiXsrfToken,
 *                             EmsBadBrowserCookie) + hidden WebForms fields
 *     POST /               -> 302 + Set-Cookie: EMSCookie   (the auth cookie)
 *     GET  /BrowseForSpace.aspx -> scrape the authenticated #deaCSRFToken value
 *
 *   serverApi(method, body)                   (docs: "ServerApi")
 *     POST /ServerApi.aspx/<method>  with the 4 cookies + `dea-CSRFToken` header
 *     -> { "d": "<stringified JSON>" }
 *
 * The password is sent in plaintext in both `password_input` and `pwdhid`
 * (EMS mirrors it; both were 14 chars in the capture, so there is no client
 * hash to reproduce). No MFA is involved.
 *
 * IMPORTANT: this talks to a third-party system SGA has an account on. It logs
 * in as that one account and should not be hammered -- callers are expected to
 * be user-driven (a person clicking "book"), not a crawler.
 */
import {
  NUSSO_BASE_URL,
  NUSSO_ORG,
  NUSSO_CONTACT,
  DEFAULT_RESERVATION_PROFILE,
  getNussoCredentials,
  type NussoReservationProfile,
} from './config'
import {
  NussoApiError,
  NussoAuthError,
  type NussoAvailability,
  type NussoBookingRequest,
  type NussoExistingBooking,
  type NussoReservationResult,
  type NussoTimeWindow,
  type NussoUdfAnswer,
} from './types'

/** A parsed session: the cookie jar and the CSRF token for ServerApi calls. */
interface NussoSession {
  cookies: Map<string, string>
  csrfToken: string
  createdAt: number
}

/**
 * Sessions are cached at module scope so a warm serverless instance reuses one
 * login across requests instead of re-authenticating every call. EMS's own
 * EMSCookie lasts a year, but the server-side session behind it is shorter and
 * opaque, so we cap our reuse well under that and additionally re-login on any
 * response that looks like a bounce back to the login page.
 */
let cachedSession: NussoSession | null = null
const SESSION_TTL_MS = 20 * 60 * 1000

/** Common headers for the ServerApi XHR calls, matching the browser's. */
function apiHeaders(session: NussoSession, referer: string): Record<string, string> {
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: NUSSO_BASE_URL,
    Referer: referer,
    'dea-CSRFToken': session.csrfToken,
    Cookie: cookieHeader(session.cookies),
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

/** Merge Set-Cookie headers from a response into the jar (name=value only). */
function absorbCookies(jar: Map<string, string>, res: Response): void {
  // Node/undici exposes getSetCookie(); fall back to the single combined header.
  const raw: string[] =
    typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : [])
  for (const line of raw) {
    const first = line.split(';', 1)[0]
    const eq = first.indexOf('=')
    if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim())
  }
}

/** Pull a WebForms/hidden input value out of page HTML by field id/name. */
function hiddenField(html: string, name: string): string {
  // Matches <input ... name="X" ... value="Y" ...> regardless of attribute order.
  const byName = new RegExp(
    `<input[^>]*\\b(?:name|id)=["']${name}["'][^>]*\\bvalue=["']([^"']*)["']`,
    'i'
  ).exec(html)
  if (byName) return byName[1]
  const valueFirst = new RegExp(
    `<input[^>]*\\bvalue=["']([^"']*)["'][^>]*\\b(?:name|id)=["']${name}["']`,
    'i'
  ).exec(html)
  return valueFirst ? valueFirst[1] : ''
}

/**
 * Authenticate and return a fresh session. Reproduces the browser's login form
 * post exactly (see the module header and docs/nusso-api.md).
 */
async function login(): Promise<NussoSession> {
  const { username, password } = getNussoCredentials()
  const jar = new Map<string, string>()

  // 1. GET the login page: seed cookies + the WebForms hidden fields.
  const loginPageRes = await fetch(`${NUSSO_BASE_URL}/`, {
    headers: { Accept: 'text/html', 'User-Agent': 'Chambers/NUSSO' },
    redirect: 'manual',
  })
  absorbCookies(jar, loginPageRes)
  const loginHtml = await loginPageRes.text()

  const form = new URLSearchParams()
  form.set('__EVENTTARGET', '')
  form.set('__EVENTARGUMENT', '')
  form.set('deaCSRFToken', hiddenField(loginHtml, 'deaCSRFToken'))
  form.set('__VIEWSTATE', hiddenField(loginHtml, '__VIEWSTATE'))
  form.set('__VIEWSTATEGENERATOR', hiddenField(loginHtml, '__VIEWSTATEGENERATOR'))
  form.set('__VIEWSTATEENCRYPTED', hiddenField(loginHtml, '__VIEWSTATEENCRYPTED'))
  form.set('__EVENTVALIDATION', hiddenField(loginHtml, '__EVENTVALIDATION'))
  form.set('userID_input', username)
  form.set('password_input', password)
  // EMS mirrors the password into a hidden field; both carry the plaintext.
  form.set('pwdhid', password)
  form.set('cancel-notes', '')
  form.set('ctl00$pc$btnLogin', 'Sign In')

  if (!form.get('__VIEWSTATE')) {
    throw new NussoAuthError('Login page did not contain a __VIEWSTATE field; the login form may have changed.')
  }

  // 2. POST the credentials. Do not follow the redirect -- the 302 carries the
  //    EMSCookie we need, and following it would drop it on some runtimes.
  const postRes = await fetch(`${NUSSO_BASE_URL}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html',
      Origin: NUSSO_BASE_URL,
      Referer: `${NUSSO_BASE_URL}/`,
      Cookie: cookieHeader(jar),
      'User-Agent': 'Chambers/NUSSO',
    },
    body: form.toString(),
    redirect: 'manual',
  })
  absorbCookies(jar, postRes)

  // Success is a 302 to /Default.aspx that set EMSCookie. A 200 means the login
  // page re-rendered with an error -- almost always bad credentials.
  if (!jar.has('EMSCookie')) {
    throw new NussoAuthError(
      postRes.status === 200
        ? 'NUSSO login was rejected (no EMSCookie issued) -- check NUSSO_USERNAME / NUSSO_PASSWORD.'
        : `NUSSO login did not issue a session cookie (HTTP ${postRes.status}).`
    )
  }

  // 3. Load an authenticated page to read the CSRF token the ServerApi calls
  //    need. The login page's token is a different, pre-auth value.
  const appRes = await fetch(`${NUSSO_BASE_URL}/BrowseForSpace.aspx`, {
    headers: { Accept: 'text/html', Cookie: cookieHeader(jar), 'User-Agent': 'Chambers/NUSSO' },
    redirect: 'manual',
  })
  absorbCookies(jar, appRes)
  const appHtml = await appRes.text()
  const csrfToken = hiddenField(appHtml, 'deaCSRFToken')
  if (!csrfToken) {
    throw new NussoAuthError('Authenticated, but could not find the deaCSRFToken on an app page.')
  }

  return { cookies: jar, csrfToken, createdAt: Date.now() }
}

/** Return a valid session, logging in (or refreshing) as needed. */
async function getSession(forceRefresh = false): Promise<NussoSession> {
  if (!forceRefresh && cachedSession && Date.now() - cachedSession.createdAt < SESSION_TTL_MS) {
    return cachedSession
  }
  cachedSession = await login()
  return cachedSession
}

/** Unwrap EMS's `{ "d": "<json string>" }` envelope. */
function unwrapD(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'd' in payload) {
    const d = (payload as { d: unknown }).d
    if (typeof d === 'string') {
      try {
        return JSON.parse(d)
      } catch {
        return d
      }
    }
    return d
  }
  return payload
}

/**
 * Call one ServerApi method. Re-logs in once and retries if the session has
 * lapsed (EMS answers a dead session by serving the login HTML, not an error).
 */
async function serverApi<T = unknown>(
  method: string,
  body: unknown,
  referer = `${NUSSO_BASE_URL}/BrowseForSpace.aspx`,
  _retried = false
): Promise<T> {
  const session = await getSession()
  const res = await fetch(`${NUSSO_BASE_URL}/ServerApi.aspx/${method}`, {
    method: 'POST',
    headers: apiHeaders(session, referer),
    body: JSON.stringify(body),
    redirect: 'manual',
  })

  const looksLikeSessionLoss =
    res.status === 302 || res.status === 401 || res.status === 403
  const text = await res.text()

  if ((looksLikeSessionLoss || !text.trimStart().startsWith('{')) && !_retried) {
    // Session likely expired: refresh once and retry.
    await getSession(true)
    return serverApi<T>(method, body, referer, true)
  }

  if (!res.ok) {
    throw new NussoApiError(`ServerApi.${method} failed (HTTP ${res.status})`, res.status)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new NussoApiError(`ServerApi.${method} returned a non-JSON response (session may have expired).`)
  }
  return unwrapD(parsed) as T
}

// --- High-level operations -------------------------------------------------

/** Filter block EMS's browse endpoints expect. */
function browseFilters(window: NussoTimeWindow) {
  return {
    filters: [
      { filterName: 'StartDate', value: window.start, displayValue: null, filterType: 3 },
      { filterName: 'EndDate', value: window.end, displayValue: '', filterType: 3 },
      { filterName: 'Locations', value: '-1', displayValue: '(all)', filterType: 8 },
      { filterName: 'TimeZone', value: String(NUSSO_ORG.timeZoneId), displayValue: 'Eastern Time', filterType: 2 },
    ],
  }
}

/** Existing bookings across all rooms in a window (for the calendar). */
export async function browseBookings(window: NussoTimeWindow): Promise<NussoExistingBooking[]> {
  const data = await serverApi<{ Bookings?: NussoExistingBooking[] }>(
    'GetBrowseLocationsBookings',
    { filterData: browseFilters(window) }
  )
  return data?.Bookings ?? []
}

/** A room as the picker needs it. */
export interface NussoRoomOption {
  RoomId: number
  RoomCode: string
  RoomDescription: string
  BuildingDescription: string
  Capacity: number
  DefaultSetupTypeId: number
}

/**
 * Deep-collect any room-shaped objects from an arbitrary response. The
 * GetBrowseLocationsRooms envelope nests rooms under buildings and its exact
 * shape is only partly known, so rather than hard-code a path we walk the tree
 * and pick out every object that carries a numeric RoomId. De-duplicated by id.
 */
function collectRooms(node: unknown, out: Map<number, NussoRoomOption>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRooms(item, out)
    return
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if (typeof obj.RoomId === 'number' && !out.has(obj.RoomId)) {
      out.set(obj.RoomId, {
        RoomId: obj.RoomId,
        RoomCode: String(obj.RoomCode ?? obj.RoomDescription ?? obj.RoomId),
        RoomDescription: String(obj.RoomDescription ?? obj.RoomCode ?? ''),
        BuildingDescription: String(obj.BuildingDescription ?? obj.BuildingCode ?? ''),
        Capacity: typeof obj.Capacity === 'number' ? obj.Capacity : 0,
        DefaultSetupTypeId: typeof obj.DefaultSetupTypeId === 'number' ? obj.DefaultSetupTypeId : 0,
      })
    }
    for (const value of Object.values(obj)) collectRooms(value, out)
  }
}

/** The list of rooms (across buildings) for a window, for the room picker. */
export async function browseRooms(window: NussoTimeWindow): Promise<NussoRoomOption[]> {
  const data = await serverApi<unknown>('GetBrowseLocationsRooms', { filterData: browseFilters(window) })
  const out = new Map<number, NussoRoomOption>()
  collectRooms(data, out)
  return [...out.values()].sort((a, b) =>
    a.BuildingDescription.localeCompare(b.BuildingDescription) || a.RoomCode.localeCompare(b.RoomCode)
  )
}

/** Availability for a specific room and window (GetAvailabilityList). */
export async function getAvailability(
  roomId: number,
  window: NussoTimeWindow,
  profile: NussoReservationProfile = DEFAULT_RESERVATION_PROFILE
): Promise<NussoAvailability[]> {
  const data = await serverApi<{ Availability?: NussoAvailability[] }>('GetAvailabilityList', {
    searchData: {
      TemplateId: profile.templateId,
      Start: window.start,
      End: window.end,
      Dates: [window.date],
      DatesGmt: null,
      TimeZoneId: NUSSO_ORG.timeZoneId,
      FilterType: 2,
      IsPam: false,
      BookingId: -1,
      IsVCEdit: false,
      RoomName: null,
      FavoritesOnly: false,
      PageMode: null,
      Cart: [],
    },
    filterData: {
      filters: [
        { filterName: 'Locations', value: '-1', displayValue: '(all)', filterType: 8 },
        { filterName: 'SetupTypes', value: '-1', displayValue: '(no preference)', filterType: 7 },
        { filterName: 'RoomTypes', value: '-1', displayValue: '(all)', filterType: 7 },
        { filterName: 'Features', value: '', displayValue: '(none)', filterType: 7 },
        { filterName: 'Capacity', value: 0, filterType: 2 },
        { filterName: 'RoomId', value: roomId, displayValue: null, filterType: 2 },
      ],
    },
    includeFloorMaps: false,
  })
  return data?.Availability ?? []
}

/**
 * Merge caller-supplied UDF answers over a profile's required set, matched by
 * Id, so a booking always carries every required field even when the UI only
 * sends the ones a person can change.
 */
function mergeUdfs(required: NussoUdfAnswer[], overrides?: NussoUdfAnswer[]): NussoUdfAnswer[] {
  const byId = new Map<number, NussoUdfAnswer>()
  for (const u of required) byId.set(u.Id, { ...u })
  for (const u of overrides ?? []) byId.set(u.Id, { ...byId.get(u.Id), ...u })
  return [...byId.values()]
}

/** GMT equivalents of a Boston wall-clock window, as EMS's cart entries expect. */
function toGmt(local: string): string {
  // EMS's cart carries both local and GMT strings. The capture's offset was -4
  // (EDT). We derive it per-instant so EST bookings are correct too.
  const [datePart, timePart] = local.split(' ')
  const asUtc = new Date(`${datePart}T${timePart}Z`)
  const offsetMin = bostonOffsetMinutes(asUtc)
  const gmt = new Date(asUtc.getTime() - offsetMin * 60 * 1000)
  return gmt.toISOString().slice(0, 19).replace('T', ' ')
}

/** Minutes to add to Boston wall-clock to reach GMT (240 in EDT, 300 in EST). */
function bostonOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
  }).formatToParts(at)
  const tz = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT-5'
  const m = /GMT([+-]\d{1,2})/.exec(tz)
  const hours = m ? Number(m[1]) : -5
  return -hours * 60
}

/**
 * Create a reservation. Runs the same three-call sequence the browser does:
 * validate the slot (AddToCartCheck), fetch the services/UDF context
 * (GetServicesForBooking), then SaveReservation. Returns the new reservation id.
 */
export async function createBooking(
  req: NussoBookingRequest,
  profile: NussoReservationProfile = DEFAULT_RESERVATION_PROFILE
): Promise<NussoReservationResult> {
  const referer = `${NUSSO_BASE_URL}${profile.refererPath}`
  const gmtStart = toGmt(req.window.start)
  const gmtEnd = toGmt(req.window.end)

  const cartBooking = {
    RoomId: req.roomId,
    Date: req.window.date,
    Start: req.window.start,
    End: req.window.end,
    TimeZoneId: String(NUSSO_ORG.timeZoneId),
    SetupCount: String(req.attendance),
    SetupTypeId: req.setupTypeId,
    RoomType: 1,
    RecordType: 1,
    TempRoomDescription: '',
    IsHost: false,
    GmtStart: gmtStart,
    GmtEnd: gmtEnd,
  }

  // 1. Validate the selection is still bookable.
  await serverApi('AddToCartCheck', {
    roomId: req.roomId,
    attendance: String(req.attendance),
    setupTypeId: req.setupTypeId,
    searchData: {
      TemplateId: profile.templateId,
      Start: req.window.start,
      End: req.window.end,
      Dates: [req.window.date],
      DatesGmt: [req.window.date],
      TimeZoneId: NUSSO_ORG.timeZoneId,
      FilterType: 2,
      IsPam: false,
      BookingId: -1,
      IsVCEdit: false,
      RoomName: null,
      FavoritesOnly: false,
      PageMode: 'InitialRequest',
      Cart: [],
    },
  }, referer)

  // 2. Fetch the services/UDF context for the booking (also primes server state).
  await serverApi('GetServicesForBooking', {
    reservationId: -1,
    templateId: profile.templateId,
    cartBookings: [cartBooking],
    eventTypeId: profile.eventTypeId,
  }, referer)

  // 3. Save the reservation.
  const raw = await serverApi<{ Success?: boolean; SuccessMessage?: string; ErrorMessage?: string }>(
    'SaveReservation',
    {
      reservationId: -1,
      bookingId: -1,
      templateId: profile.templateId,
      pageMode: 'InitialRequest',
      cartBookings: [cartBooking],
      reservationDetails: {
        EventName: req.eventName,
        EventTypeId: profile.eventTypeId,
        GroupId: NUSSO_ORG.groupId,
        FirstContactId: -1,
        FirstContactName: NUSSO_CONTACT.firstContactName,
        FirstPhoneOne: NUSSO_CONTACT.firstContactPhone,
        FirstPhoneTwo: '',
        FirstEmail: NUSSO_CONTACT.firstContactEmail,
        SecondContactId: -1,
        SecondContactName: '',
        SecondContactPhoneOne: '',
        SecondContactPhoneTwo: '',
        SecondContactEmail: '',
        BillingReference: '',
        PoNumber: '',
        SendInvitation: false,
        AddConferencing: false,
        TimezoneId: NUSSO_ORG.timeZoneId,
        PamMessage: '',
        PamPrivate: false,
        PamReminderMinutes: -1,
        PamShowTimeAs: 'BUSY',
        PamSubject: req.eventName,
        Attendees: [],
      },
      files: [],
      // Default to the profile's known-good required-UDF answers; let the caller
      // override any of them by Id (e.g. the projector question).
      udfs: mergeUdfs(profile.requiredUdfs, req.udfs),
    },
    referer
  )

  if (!raw?.Success) {
    throw new NussoApiError(raw?.ErrorMessage || 'NUSSO rejected the reservation.')
  }

  // SuccessMessage is itself a stringified JSON blob with the new id.
  let inner: {
    ReservationId?: number
    ReservationSummaryLink?: string
    EmailError?: boolean
    HasBookingConflict?: boolean
  } = {}
  try {
    inner = raw.SuccessMessage ? JSON.parse(raw.SuccessMessage) : {}
  } catch {
    /* leave inner empty; the reservation still succeeded */
  }

  if (!inner.ReservationId) {
    throw new NussoApiError('NUSSO reported success but returned no reservation id.')
  }

  return {
    reservationId: inner.ReservationId,
    reservationSummaryLink: inner.ReservationSummaryLink ?? null,
    confirmationEmailSent: inner.EmailError === false,
    hasBookingConflict: inner.HasBookingConflict === true,
    raw,
  }
}

/** Exposed for a health-check route: proves login works without booking. */
export async function verifyNussoLogin(): Promise<boolean> {
  const session = await getSession(true)
  return !!session.csrfToken
}
