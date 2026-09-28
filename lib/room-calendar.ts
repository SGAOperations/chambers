import { wantsSenateSession } from './senate-types'

/**
 * Which room sessions belong on a calendar, and what an edit has to send to keep
 * one honest (issue #69).
 *
 * Room bookings reach Outlook the way SGA Spaces bookings do: the email carries
 * an invite. The hard part is not building the file, it is deciding what the
 * file should say after an edit -- a session that stopped being a meeting has to
 * be taken off the calendar, or someone turns up to a room that was released.
 * A stale calendar entry is worse than none, because people act on it.
 *
 * Everything here is pure, so the rules can be read and exercised without a
 * database. The routes gather the rows; this decides what they mean.
 */

/** What a status says about whether a session is on a calendar. */
export type CalendarState =
  /** On the calendar, as a meeting that is happening. */
  | 'confirmed'
  /** On the calendar, marked tentative -- Outlook hatches it. */
  | 'tentative'
  /** Not on the calendar; taken off if it was. */
  | 'off'
  /** Left exactly as it is, neither added nor removed. */
  | 'leave'

/**
 * The statuses that put a session on a calendar, matching the allow-list Slack
 * reminders use (lib/meeting-reminders.ts): a status is only on the calendar
 * when it says plainly that the body is meeting.
 *
 * Virtual is included. The meeting still happens, so it stays on the calendar --
 * its location says so rather than a room.
 */
const CONFIRMED_STATUSES = new Set([
  'Reserved',
  'Alternate Room',
  'Alternate Time',
  'Alternate Room and Time',
  'Virtual',
])

/**
 * What each status does to a calendar.
 *
 *   Tentative             goes on hatched: it is a real plan, not yet settled.
 *   Waitlisted            stays off until an administrator settles it, since
 *                         there is no room to go to yet.
 *   Pending Cancellation  leaves the calendar alone. The request has not been
 *                         decided, and removing the event now would mean putting
 *                         it back if the request is denied.
 *   Cancelled, Unavailable, Missed, Repurposed, and anything added later
 *                         come off: none of them is a meeting in that room.
 */
export function calendarStateOf(status: string | null | undefined): CalendarState {
  if (!status) return 'off'
  if (CONFIRMED_STATUSES.has(status)) return 'confirmed'
  if (status === 'Tentative') return 'tentative'
  if (status === 'Pending Cancellation') return 'leave'
  return 'off'
}

/** One dated session of a room booking, as a calendar sees it. */
export interface RoomSession {
  /** Stable across edits: the id of the occurrence or session row. */
  uid: string
  /** 'YYYY-MM-DD', in Boston local time, as the booking tables store it. */
  date: string
  /** 'HH:MM' or 'HH:MM:SS', Boston local time. */
  startTime: string
  endTime: string
  summary: string
  /** The room, or 'Virtual' for a meeting that moved online. */
  location: string
  status: string
  /** Only ever set on Senate bookings; decides who the session is sent to. */
  senateType?: string | null
  /**
   * Set when this session is one week of a weekly series, for the paths that
   * send a single week on its own -- a cancellation, or a week going Virtual.
   *
   * A series' weeks live on a calendar as occurrences of one recurring event
   * (issue #184), so addressing one by its own UID would describe an event the
   * calendar does not have. With this, the week is addressed the way Outlook
   * addresses one occurrence of its own recurring meetings: the series' UID,
   * plus a RECURRENCE-ID naming which occurrence it is.
   */
  seriesRef?: {
    /** weekly_room_bookings.id */
    id: string
    /** The series' pattern time of day, which RECURRENCE-ID is measured at. */
    startTime: string
  }
}

export const ROOM_UID_DOMAIN = 'chambers.northeasternsga.com'

/**
 * UIDs are built from the row id, which is stable across edits: weekly
 * occurrences are written in place (issue #113) and one-time sessions likewise
 * (issue #69). A UID that changed on every save would leave a calendar holding
 * one event per edit rather than replacing the one it had.
 *
 * The prefix names the table, so the two id spaces can never be confused if a
 * calendar receives both.
 */
export function occurrenceUid(id: string): string {
  return `weekly-${id}@${ROOM_UID_DOMAIN}`
}

export function sessionUid(id: string): string {
  return `one-time-${id}@${ROOM_UID_DOMAIN}`
}

/** One UID for a whole weekly series -- the master VEVENT and every RECURRENCE-ID override share it. */
export function weeklySeriesUid(weeklyBookingId: string): string {
  return `weekly-series-${weeklyBookingId}@${ROOM_UID_DOMAIN}`
}

/** A pattern date that is a meeting, with the type that decides who follows it. */
export interface SeriesMeetingDate {
  date: string
  senateType?: string | null
}

/**
 * The weekly pattern a series' sessions share, so its invite can be one
 * recurring event rather than one event per week (issue #184).
 *
 * Only the series-level values belong here. A week that differs from them is an
 * override, and it is the sessions -- not this -- that say so.
 *
 * There is no drifted-date case to record, unlike SGA Space series: an
 * occurrence's date is the one column a weekly edit cannot override (see
 * OCCURRENCE_FIELDS in lib/weekly-occurrences.ts), so a week's own date is
 * always the pattern slot it fills. That is what lets RECURRENCE-ID be derived
 * rather than stored.
 */
export interface RoomSeries {
  /** weekly_room_bookings.id -- the UID every week of the series shares. */
  id: string
  /** The series' first pattern date, 'YYYY-MM-DD'. Fixed for the life of the series. */
  startDate: string
  /** The last pattern date the series currently runs through, 'YYYY-MM-DD'. */
  endDate: string
  /** The pattern's time of day, which RECURRENCE-ID is measured against. */
  startTime: string
  endTime: string
  summary: string
  location: string
  /** The series' own status, so a wholly Tentative series hatches from the master rather than week by week. */
  status: string
  /**
   * Every pattern date that is a meeting, across the series' whole run rather
   * than just its future. Any pattern date missing from this list is EXDATEd
   * out of the recurrence, so a past week left off here would be removed from
   * calendars that already hold it -- history, not a stale booking.
   */
  meetingDates: SeriesMeetingDate[]
}

export interface InvitePlan {
  /** Sessions to put on, or move on, a calendar. */
  request: RoomSession[]
  /** Sessions to take off it. */
  cancel: RoomSession[]
  /**
   * Set only for a weekly series, whose weeks go out as one recurring event.
   * A one-time booking's sessions are unrelated dates with no pattern between
   * them, so they stay one event each.
   */
  series?: RoomSeries
}

/**
 * What to send so that calendars match `next`.
 *
 * `previous` is the booking as it stood before this save, and null for one being
 * created. A session only gets a cancellation when it was actually on a calendar
 * before: sending one for an event nobody was ever sent is noise, and some
 * clients show it as a phantom cancelled meeting.
 *
 * Past sessions are left alone in both directions. Nobody needs a meeting added
 * to last Tuesday, and removing one rewrites a record of what happened.
 * `today` is the Boston date, since that is the day the booking tables count in.
 */
export function planInvites(
  previous: RoomSession[] | null,
  next: RoomSession[],
  today: string,
  series?: RoomSeries
): InvitePlan {
  const wasOn = new Map<string, RoomSession>()
  for (const s of previous ?? []) {
    const state = calendarStateOf(s.status)
    if (state === 'confirmed' || state === 'tentative') wasOn.set(s.uid, s)
  }

  const request: RoomSession[] = []
  const cancel: RoomSession[] = []
  const seen = new Set<string>()

  for (const session of next) {
    seen.add(session.uid)
    if (session.date < today) continue

    const state = calendarStateOf(session.status)
    if (state === 'leave') continue
    if (state === 'off') {
      if (wasOn.has(session.uid)) cancel.push(session)
      continue
    }
    request.push(session)
  }

  // A session that is gone from the booking altogether -- a week an edit trimmed
  // off the end of a series, or a one-time session an editor removed -- has no
  // row left to carry a status, so the previous values are what its cancellation
  // describes.
  for (const [uid, session] of wasOn) {
    if (seen.has(uid) || session.date < today) continue
    cancel.push(session)
  }

  return series ? { request, cancel, series } : { request, cancel }
}

/** Someone the booking notifies, with what they have said they want to hear about. */
export interface CalendarRecipient {
  email: string
  senatePreferences?: Record<string, boolean> | null
}

/** One email to send: the people who share an invite, and the invite they get. */
export interface InviteAudience {
  recipients: string[]
  plan: InvitePlan
}

/**
 * Splits an invite by what each person follows.
 *
 * A Senate member who has deselected Office Hours should not get those sessions
 * on their calendar -- the same rule that decides whether they are emailed at
 * all (issues #92, #93), applied session by session rather than to the email as
 * a whole. Everyone who ends up with the same set of sessions shares one email,
 * so a booking whose sessions are all one type still sends exactly one.
 *
 * Bodies other than the Senate, and sessions with no type, are wanted by
 * everyone, so this collapses to a single group for almost every booking.
 */
export function splitByAudience(
  recipients: CalendarRecipient[],
  plan: InvitePlan,
  ownerBodyName: string | null | undefined
): InviteAudience[] {
  const groups = new Map<string, InviteAudience>()

  for (const person of recipients) {
    const follows = (senateType: string | null | undefined) =>
      wantsSenateSession(person.senatePreferences, ownerBodyName, senateType)
    const wanted = (s: RoomSession) => follows(s.senateType)
    const request = plan.request.filter(wanted)
    const cancel = plan.cancel.filter(wanted)
    if (!request.length && !cancel.length) continue

    // The recurrence has to be narrowed the same way the sessions are, or a
    // Senate member who follows only Full Body would have every Office Hours
    // week put on their calendar by the pattern regardless of the filtering
    // above. A week they do not follow is simply not a meeting date for them.
    const series = plan.series && {
      ...plan.series,
      meetingDates: plan.series.meetingDates.filter(d => follows(d.senateType)),
    }

    const key = [
      ...request.map(s => `r${s.uid}`),
      ...cancel.map(s => `c${s.uid}`),
      ...(series?.meetingDates ?? []).map(d => `m${d.date}`),
    ].join('|')
    const group = groups.get(key) ?? { recipients: [], plan: series ? { request, cancel, series } : { request, cancel } }
    group.recipients.push(person.email)
    groups.set(key, group)
  }

  return [...groups.values()]
}
