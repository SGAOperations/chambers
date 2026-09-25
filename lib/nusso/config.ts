/**
 * Configuration for the NUSSO / EMS integration.
 *
 * Two kinds of value live here:
 *
 *   1. Credentials and the base URL, from the environment. These are secrets
 *      (a real EMS web-user login) and are never committed -- see .env.example.
 *
 *   2. The org-specific EMS identifiers SGA books under, discovered while
 *      reverse-engineering nuevents.neu.edu. These are not secret, but they are
 *      environment-specific: they are the numeric ids EMS assigned to SGA's
 *      group, the room-request process template, the "meeting" event type and
 *      the Eastern time zone. They are overridable by env so a different body,
 *      or a rebuilt EMS instance that renumbers them, does not need a code
 *      change.
 */
import { NussoConfigError, type NussoUdfAnswer } from './types'

/** nuevents.neu.edu, trailing slash stripped. Overridable for testing. */
export const NUSSO_BASE_URL = (process.env.NUSSO_BASE_URL || 'https://nuevents.neu.edu').replace(/\/+$/, '')

/**
 * The EMS web-user credentials Chambers logs in as. This is the SGA operations
 * account, entered into EMS's built-in login form (no external SSO, no MFA --
 * see docs/nusso-api.md). Read lazily so importing this module never throws;
 * only an actual NUSSO request requires them.
 */
export function getNussoCredentials(): { username: string; password: string } {
  const username = process.env.NUSSO_USERNAME
  const password = process.env.NUSSO_PASSWORD
  if (!username || !password) {
    throw new NussoConfigError(
      'NUSSO integration is not configured: set NUSSO_USERNAME and NUSSO_PASSWORD.'
    )
  }
  return { username, password }
}

/** True when the credentials are present, so routes can 503 cleanly instead of throwing. */
export function isNussoConfigured(): boolean {
  return !!process.env.NUSSO_USERNAME && !!process.env.NUSSO_PASSWORD
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Org-level EMS identifiers that are the same whatever kind of reservation is
 * being made. Defaults observed on nuevents.neu.edu; overridable by env.
 */
export const NUSSO_ORG = {
  /** SGA's group/organization id in EMS. */
  groupId: intEnv('NUSSO_GROUP_ID', 225399),
  /** EMS time-zone id for Eastern Time. */
  timeZoneId: intEnv('NUSSO_TIME_ZONE_ID', 61),
} as const

/**
 * The first-contact details stamped on reservations. These are the group's
 * booking contact, not a person's private data, and default to SGA operations.
 */
export const NUSSO_CONTACT = {
  firstContactName: process.env.NUSSO_CONTACT_NAME || 'Student Government Association(STU)',
  firstContactEmail: process.env.NUSSO_CONTACT_EMAIL || 'sgaOperations@northeastern.edu',
  firstContactPhone: process.env.NUSSO_CONTACT_PHONE || '',
} as const

/**
 * An EMS reservation "type". Different kinds of reservation (a room request, a
 * tabling request, ...) run under different EMS process templates, carry a
 * different event type, and enforce a different set of required user-defined
 * fields -- and are submitted from a different page. A profile bundles exactly
 * those differences so the client and the UI can be told "book this as a room
 * request" without any of those ids leaking into the call sites.
 *
 * Only `room-request` is defined today. Tabling (and anything else) is added by
 * writing another profile here plus its own form; the client, the booking route
 * and SaveReservation itself do not change.
 */
export interface NussoReservationProfile {
  /** Stable key used by the API and UI to select this profile. */
  key: string
  /** Human label for the picker/UI. */
  label: string
  /** EMS process/booking template id. */
  templateId: number
  /** Event type id sent on the reservation. */
  eventTypeId: number
  /** The page EMS submits this reservation type from (used as the Referer). */
  refererPath: string
  /**
   * Required user-defined fields, with the exact single-select answer ids that
   * were accepted. SaveReservation rejects a request that omits a required UDF,
   * so these are sent by default (the UI may override individual answers). The
   * `Answer` values are EMS option ids, not booleans; changing them blindly
   * risks a rejected booking. See docs/nusso-api.md.
   */
  requiredUdfs: NussoUdfAnswer[]
}

export const RESERVATION_PROFILES: Record<string, NussoReservationProfile> = {
  'room-request': {
    key: 'room-request',
    label: 'Room Request',
    templateId: intEnv('NUSSO_TEMPLATE_ID', 25),
    eventTypeId: intEnv('NUSSO_EVENT_TYPE_ID', 657),
    refererPath: '/RoomRequest.aspx',
    requiredUdfs: [
      { Id: 23, FieldType: 4, Answer: 18, Required: true, Prompt: 'Will you need access to the built-in projector or plasma television in your room(s)?' },
      { Id: 34, FieldType: 4, Answer: 31, Required: true, Prompt: 'Does anyone external to the university have any control over the nature and/or execution of this event?' },
      { Id: 32, FieldType: 4, Answer: 27, Required: true, Prompt: 'I have read the Safety & Security section of the Terms & Conditions.' },
    ],
  },
  // TODO(tabling): add a 'tabling' profile once its template id, event type and
  // required UDFs are captured -- tabling uses a different EMS form and fields.
}

export const DEFAULT_RESERVATION_PROFILE = RESERVATION_PROFILES['room-request']

/** Look up a profile by key, falling back to the default room request. */
export function reservationProfile(key?: string | null): NussoReservationProfile {
  return (key && RESERVATION_PROFILES[key]) || DEFAULT_RESERVATION_PROFILE
}
