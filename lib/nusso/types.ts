/**
 * Types for the NUSSO / EMS Web App integration.
 *
 * "NUSSO" is how SGA refers to nuevents.neu.edu, Northeastern's deployment of
 * Accruent's EMS Web App (formerly Virtual EMS). It is an ASP.NET WebForms app
 * whose browser front end talks to a JSON API mounted at
 * `POST /ServerApi.aspx/<Method>`. These types describe the request and
 * response shapes we reverse-engineered from that API -- see lib/nusso/client.ts
 * for the flow, and docs/nusso-api.md for the full map.
 *
 * The API is not documented by the vendor and can change without notice. Every
 * shape here is "what we observed", not "what is guaranteed", which is why the
 * client validates rather than trusts.
 */

/** A building returned by the browse endpoints. */
export interface NussoBuilding {
  BuildingId: number
  BuildingCode: string
  BuildingDescription: string
  TimeZone: string
  /** Whether this building has rooms a web user may reserve directly. */
  HasReservableRooms: boolean
  /** Whether it only has rooms that must be *requested* (the SGA path). */
  HasRequestableRooms: boolean
}

/** A room in the availability list. */
export interface NussoRoom {
  RoomId: number
  RoomCode: string
  RoomDescription: string
  BuildingId: number
  BuildingCode: string
  BuildingDescription: string
  Capacity: number
  MinCapacity: number
  RoomType: number
  RoomTypeDescription: string
  Floor: string | null
  DefaultSetupTypeId: number
  /** Comma-separated setup type ids, e.g. "64,". */
  AvailableSetupTypes: string
  TimeZone: string
  /** A room-specific warning shown before booking, e.g. "permanent setup". */
  Alert: string | null
  Location: string
}

/** One existing booking occupying a room, from GetBrowseLocationsBookings. */
export interface NussoExistingBooking {
  Id: number
  RoomId: number
  BuildingId: number
  GroupName: string
  EventName: string
  /** Boston wall-clock ISO (no offset), as EMS returns it. */
  EventStart: string
  EventEnd: string
  TimeBookingStart: string
  TimeBookingEnd: string
  /** EMS hides details on bookings the caller may not see. */
  DisplayDetails: boolean
}

/** A single availability row from GetAvailabilityList. */
export interface NussoAvailability {
  RoomId: number
  RoomCode: string
  RoomDescription: string
  BuildingId: number
  BuildingDescription: string
  Capacity: number
  DefaultSetupTypeId: number
  AvailableSetupTypes: string
  Alert: string | null
  Location: string
  /** 1 when the room is available for the whole requested window. */
  DaysAvailable: number
}

/** A time window for a booking, in Boston wall-clock (see lib/boston-time.ts). */
export interface NussoTimeWindow {
  /** "YYYY-MM-DD HH:mm:ss" */
  start: string
  /** "YYYY-MM-DD HH:mm:ss" */
  end: string
  /** "YYYY-MM-DD 00:00:00" */
  date: string
}

/** The answer to one required/optional user-defined field on the request form. */
export interface NussoUdfAnswer {
  Id: number
  FieldType: number
  Answer: string | number
  Required: boolean
  Prompt?: string
}

/**
 * Everything the UI collects to create a reservation. The client fills in the
 * org-constant fields (group, template, event type, contacts) from config;
 * this is only the per-booking part a person chooses.
 */
export interface NussoBookingRequest {
  roomId: number
  setupTypeId: number
  /** Expected attendance / setup count. */
  attendance: number
  eventName: string
  window: NussoTimeWindow
  /** Answers to required user-defined fields (e.g. the projector question). */
  udfs?: NussoUdfAnswer[]
}

/** The parsed result of a successful SaveReservation. */
export interface NussoReservationResult {
  reservationId: number
  reservationSummaryLink: string | null
  confirmationEmailSent: boolean
  hasBookingConflict: boolean
  raw: unknown
}

/** Raised when NUSSO_USERNAME / NUSSO_PASSWORD (or base URL) are missing. */
export class NussoConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NussoConfigError'
  }
}

/** Raised when the login replay fails to produce an authenticated session. */
export class NussoAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NussoAuthError'
  }
}

/** Raised when a ServerApi call fails or returns an error envelope. */
export class NussoApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'NussoApiError'
    this.status = status
  }
}
