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

export interface InvitePlan {
  /** Sessions to put on, or move on, a calendar. */
  request: RoomSession[]
  /** Sessions to take off it. */
  cancel: RoomSession[]
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
  today: string
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

  return { request, cancel }
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
    const wanted = (s: RoomSession) => wantsSenateSession(person.senatePreferences, ownerBodyName, s.senateType)
    const request = plan.request.filter(wanted)
    const cancel = plan.cancel.filter(wanted)
    if (!request.length && !cancel.length) continue

    const key = [...request.map(s => `r${s.uid}`), ...cancel.map(s => `c${s.uid}`)].join('|')
    const group = groups.get(key) ?? { recipients: [], plan: { request, cancel } }
    group.recipients.push(person.email)
    groups.set(key, group)
  }

  return [...groups.values()]
}
