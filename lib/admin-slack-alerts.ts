import { waitUntil } from '@vercel/functions'
import { postSlackMessage } from './slack'
import { REQUEST_ALERT_ROLES } from './admin-roles'
import { bostonWallClockNow } from './boston-time'
import { todayInAppZone } from './app-zone'
import type { Db } from './db/data-api'

/**
 * Telling Operational Affairs and the Comptroller, over Slack, that a request
 * has just been submitted (issue #219).
 *
 * Nothing used to. A request appears on the Bookings page and waits there, which
 * is fine for a booking three weeks out and useless for a cancellation filed
 * forty minutes before the meeting -- the admin finds out when they next happen
 * to look, which is routinely after the room has gone unused.
 *
 * So each of the three submission paths -- a new booking request
 * (/api/request and the Slack quick-request modal), a revision request and a
 * cancellation request -- queues one of these on its way out.
 *
 * Three rules shape the whole file:
 *
 *   Fail soft. The row is already written and the user has already been
 *   answered. queueAdminRequestAlert() hands the work to waitUntil and swallows
 *   everything, so no Slack outage, missing token or unlinked account can turn a
 *   filed request into an error -- the alert is a courtesy to the admin, not part
 *   of the submission. Failures are logged, loudly, because an alert that never
 *   arrives looks exactly like a working integration.
 *
 *   Never message a real admin from a preview. Recipients come out of the
 *   database, and a preview deployment or a local server pointed at real data
 *   would DM the actual VP of Operational Affairs while someone clicks around.
 *   Outside production every alert is redirected to PREVIEW_SLACK_RECIPIENT, or
 *   withheld and logged where that is unset -- the same guard, for the same
 *   reason, as lib/resend.ts.
 *
 *   Say how soon it is. An admin reading this on their phone needs to know
 *   whether to act now, so the first line carries the gap between now and the
 *   reservation, and anything inside a day is flagged.
 */

const CHAMBERS_URL = 'https://chambers.northeasternsga.com'

/** Which submission happened. Decides the headline and the tab the link names. */
export type RequestAlertKind = 'booking' | 'revision' | 'cancellation'

const HEADLINES: Record<RequestAlertKind, string> = {
  booking: 'New booking request',
  revision: 'Revision request',
  cancellation: 'Cancellation request',
}

/** Where in Chambers each one is actioned. Both live under /bookings, on different tabs. */
const TABS: Record<RequestAlertKind, string> = {
  booking: 'Requests tab',
  revision: 'Requests tab',
  cancellation: 'Cancellations tab',
}

/**
 * One submission, in the shape the message is written from.
 *
 * Everything optional is optional because a request genuinely may not have it:
 * a room request names no room when the body has no preference, a tabling
 * session has a location instead, and a request made before an occurrence
 * existed has no date to resolve.
 */
export interface AdminRequestAlert {
  kind: RequestAlertKind
  /** 'One-Time Room', 'Weekly Room' or 'Tabling'. */
  bookingType: string
  /** Who the request is attributed to, scope included -- see audienceLabel(). */
  audience: string
  /** users.id of whoever filed it; the name is resolved when the alert is sent. */
  requestedBy: string | null
  /** The room asked for, or the tabling location. */
  room?: string | null
  /** The date the request is about, 'YYYY-MM-DD'. The first one, where there are several. */
  date?: string | null
  startTime?: string | null
  endTime?: string | null
  /** Dates beyond `date` the request covers, for the "+2 more dates" line. */
  moreDates?: number
  /** One short line of specifics: the purpose, what the revision asks for, why. */
  detail?: string | null
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Slack mrkdwn escaping: only these three characters carry meaning in message text. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatTime(time: string | null | undefined): string | null {
  if (!time) return null
  const [h, m] = time.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  // UTC noon, so a DST boundary cannot print the day before.
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * How far off the reservation is, in words, or null where the request has no
 * date to measure.
 *
 * Both sides are Boston wall clock: the booking's date and time are a calendar
 * day and a time-of-day in Boston (lib/app-zone.ts), and bostonWallClockNow()
 * puts "now" in the same shape, so the subtraction is honest in both EDT and EST
 * without a table of offsets (lib/boston-time.ts).
 *
 * A reservation with no start time is measured from midnight, which is the only
 * instant the date alone names. That can read "in 7 hours" for a meeting nobody
 * has set a time for yet; it is still the right order of magnitude, which is all
 * this line claims to be.
 */
function minutesUntil(
  date: string | null | undefined,
  startTime: string | null | undefined,
  now: Date = bostonWallClockNow()
): number | null {
  if (!date) return null
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return null
  const [h, min] = (startTime ?? '00:00').split(':').map(Number)
  const at = Date.UTC(y, m - 1, d, Number.isNaN(h) ? 0 : h, Number.isNaN(min) ? 0 : min)
  return Math.round((at - now.getTime()) / 60_000)
}

export function relativeWhen(
  date: string | null | undefined,
  startTime: string | null | undefined,
  now: Date = bostonWallClockNow()
): string | null {
  const minutes = minutesUntil(date, startTime, now)
  if (minutes === null) return null

  if (minutes < -60) return 'already passed'
  if (minutes < 5) return 'starting now'
  if (minutes < 60) return `in ${minutes} minutes`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`

  const days = Math.round(hours / 24)
  return `in ${days} day${days === 1 ? '' : 's'}`
}

/**
 * True while the reservation is close enough that the alert leads with a siren:
 * inside the next 24 hours, or already under way.
 *
 * Something that passed over an hour ago is not urgent -- it is already too late
 * for an admin to do anything about the room -- so it gets the plain headline.
 */
function isUrgent(date: string | null | undefined, startTime: string | null | undefined): boolean {
  const minutes = minutesUntil(date, startTime)
  return minutes !== null && minutes >= -60 && minutes < 60 * 24
}

/**
 * The message, as Slack mrkdwn.
 *
 * Plain text rather than blocks, like formatReminder() in lib/meeting-reminders:
 * the whole thing has to be readable in a phone notification, and a block layout
 * collapses to the `text` fallback there anyway.
 *
 * Exported so the wording can be read -- and changed -- without a Slack
 * workspace or a database in front of you.
 */
export function formatAdminRequestAlert(alert: AdminRequestAlert, requesterName?: string | null): string {
  const when = relativeWhen(alert.date, alert.startTime)
  const lead = isUrgent(alert.date, alert.startTime) ? ':rotating_light: ' : ''

  // The headline carries the gap, because it is the one thing that decides
  // whether this is read now or later.
  const lines = [
    `${lead}*${HEADLINES[alert.kind]}*${when ? ` — ${when}` : ''}`,
    `*${esc(alert.audience)}* · ${esc(alert.bookingType)}${
      requesterName ? ` · requested by ${esc(requesterName)}` : ''
    }`,
  ]

  if (alert.date) {
    const start = formatTime(alert.startTime)
    const end = formatTime(alert.endTime)
    const window = start ? (end ? `${start}–${end}` : start) : 'time to be confirmed'
    const more = alert.moreDates ? ` (+${alert.moreDates} more date${alert.moreDates === 1 ? '' : 's'})` : ''
    lines.push(`When: ${formatDate(alert.date)}, ${window}${more}`)
  }

  // Said rather than left blank: "not yet confirmed" is information, an empty
  // line is a bug the reader has to guess at.
  lines.push(`Where: ${alert.room ? esc(alert.room) : 'not specified'}`)

  if (alert.detail) lines.push(esc(alert.detail))

  lines.push(`<${CHAMBERS_URL}/bookings|Open Chambers> — ${TABS[alert.kind]}`)

  return lines.join('\n')
}

/**
 * How the alert names the body a request is for, matching formatScopeLabel() in
 * lib/booking-scope so the name in Slack is the name on the Bookings page.
 *
 * A divisional request belongs to the division rather than to whichever body
 * filed it, and a multi-body one says how many it is shared with -- an admin
 * deciding what to release needs to know a cancellation is about five bodies and
 * not one.
 */
export function audienceLabel(
  bodyName: string | null | undefined,
  scope: string | null | undefined,
  division: string | null | undefined,
  linkedBodyCount = 0
): string {
  const owner = bodyName ?? 'Unknown body'
  if (scope === 'divisional' && division) return `${division} (Division)`
  // The owning body is one of the linked rows, so it is not an "other".
  const others = Math.max(0, linkedBodyCount - 1)
  if (scope === 'multi' && others > 0) {
    return `${owner} + ${others} other${others === 1 ? '' : 's'}`
  }
  return owner
}

// ---------------------------------------------------------------------------
// Loading what the message says
// ---------------------------------------------------------------------------

/** A booking resolved to the one date an alert talks about. */
export interface BookingAlertSummary {
  audience: string
  bookingType: string
  purpose: string
  room: string | null
  date: string | null
  startTime: string | null
  endTime: string | null
  moreDates: number
}

/** PostgREST types an embedded to-one relation as a possible array. */
function one<T>(v: T | T[] | null | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : v ?? undefined
}

/**
 * Picks the date an alert about an existing booking should talk about.
 *
 * `preferred` wins where the request named one -- an occurrence-scoped
 * cancellation is about that week and nothing else. Otherwise the next date
 * still to come, because that is the one an admin can still act on; falling back
 * to the last one so a booking entirely in the past still prints a date rather
 * than nothing.
 */
function pickDated<T extends { date: string }>(rows: T[], preferred: string | null): {
  row: T | undefined
  moreDates: number
} {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  if (preferred) {
    const match = sorted.find(r => r.date === preferred)
    if (match) return { row: match, moreDates: 0 }
  }
  const today = todayInAppZone()
  const upcoming = sorted.filter(r => r.date >= today)
  const row = upcoming[0] ?? sorted[sorted.length - 1]
  return { row, moreDates: Math.max(0, upcoming.length - 1) }
}

/**
 * Everything an alert about an existing booking needs, in one place.
 *
 * Used by the revision and cancellation paths, which -- unlike a new request --
 * are handed only a booking id and have to go and find out what the booking
 * actually is. Returns null when the booking has gone; the caller's alert is
 * then dropped rather than sent half-blank.
 *
 * All three booking types store their dates differently, which is why this is a
 * switch and not a join: weekly rooms keep per-occurrence overrides where null
 * means "the series'", the same precedence resolveOccurrence() applies in
 * lib/pending-cancellations.
 */
export async function loadBookingAlertSummary(
  adminSupabase: Db,
  bookingId: string,
  preferredDate: string | null = null
): Promise<BookingAlertSummary | null> {
  const { data: booking } = await adminSupabase
    .from('bookings')
    .select('id, type, purpose, scope, division, body_id, bodies(name)')
    .eq('id', bookingId)
    .maybeSingle()

  if (!booking) return null

  let linkedBodyCount = 0
  if (booking.scope === 'multi') {
    const { data: links } = await adminSupabase
      .from('booking_bodies')
      .select('body_id')
      .eq('booking_id', bookingId)
    linkedBodyCount = (links ?? []).length
  }

  const base = {
    audience: audienceLabel(
      one<{ name: string }>(booking.bodies)?.name,
      booking.scope,
      booking.division,
      linkedBodyCount
    ),
    bookingType: booking.type as string,
    purpose: booking.purpose as string,
  }

  if (booking.type === 'One-Time Room') {
    const { data } = await adminSupabase
      .from('one_time_room_bookings')
      .select('booking_date, start_time, end_time, room_name')
      .eq('booking_id', bookingId)
    const rows = (data ?? []).map((r: {
      booking_date: string
      start_time: string | null
      end_time: string | null
      room_name: string | null
    }) => ({ date: r.booking_date, ...r }))
    const { row, moreDates } = pickDated(rows, preferredDate)
    return {
      ...base,
      room: row?.room_name ?? null,
      date: row?.date ?? null,
      startTime: row?.start_time ?? null,
      endTime: row?.end_time ?? null,
      moreDates,
    }
  }

  if (booking.type === 'Weekly Room') {
    const { data: series } = await adminSupabase
      .from('weekly_room_bookings')
      .select('id, room_name, start_time, end_time')
      .eq('booking_id', bookingId)
      .maybeSingle()

    if (!series) return { ...base, room: null, date: null, startTime: null, endTime: null, moreDates: 0 }

    const { data } = await adminSupabase
      .from('weekly_room_occurrences')
      .select('occurrence_date, start_time, end_time, room_name')
      .eq('weekly_booking_id', series.id)
    const rows = (data ?? []).map((r: {
      occurrence_date: string
      start_time: string | null
      end_time: string | null
      room_name: string | null
    }) => ({ date: r.occurrence_date, ...r }))
    const { row, moreDates } = pickDated(rows, preferredDate)

    // Null on an occurrence means "take the series' value", so every field falls
    // back rather than printing a blank for the common week.
    return {
      ...base,
      room: row?.room_name ?? series.room_name ?? null,
      date: row?.date ?? null,
      startTime: row?.start_time ?? series.start_time ?? null,
      endTime: row?.end_time ?? series.end_time ?? null,
      moreDates,
    }
  }

  if (booking.type === 'Tabling') {
    const { data: tabling } = await adminSupabase
      .from('tabling_bookings')
      .select('id')
      .eq('booking_id', bookingId)
      .maybeSingle()

    if (!tabling) return { ...base, room: null, date: null, startTime: null, endTime: null, moreDates: 0 }

    const { data } = await adminSupabase
      .from('tabling_sessions')
      .select('session_date, start_time, end_time, location')
      .eq('tabling_booking_id', tabling.id)
    const rows = (data ?? []).map((r: {
      session_date: string
      start_time: string | null
      end_time: string | null
      location: string | null
    }) => ({ date: r.session_date, ...r }))
    const { row, moreDates } = pickDated(rows, preferredDate)
    return {
      ...base,
      room: row?.location ?? null,
      date: row?.date ?? null,
      startTime: row?.start_time ?? null,
      endTime: row?.end_time ?? null,
      moreDates,
    }
  }

  return { ...base, room: null, date: null, startTime: null, endTime: null, moreDates: 0 }
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production'
}

/**
 * Who the alert is sent to: one Slack DM per holder of a REQUEST_ALERT_ROLE who
 * has linked their account.
 *
 * `slack_connections` is already how Chambers knows which Slack account belongs
 * to which user -- the slash command writes it and the quick-request modal reads
 * it -- so this needs no new column and no Slack id in configuration. The cost
 * is that an admin who has never run a Chambers slash command is unreachable,
 * which is what SLACK_ADMIN_ALERT_CHANNEL covers and what the warning below is
 * for.
 *
 * **A role with nobody in it is normal, not an error.** Both seats turn over
 * every spring, one of them is routinely vacant for weeks, and a holder who has
 * never linked Slack is just as common. So the roles are resolved
 * independently and each one that comes up empty is dropped: whoever *does*
 * resolve is still messaged, and the result is a list of real Slack ids with no
 * holes in it rather than one entry per role with nulls where a seat is open.
 * Nothing here throws on a vacancy and nothing can hand an undefined channel to
 * postSlackMessage.
 *
 * `unlinked` is only ever the holders who exist and have no Slack link, which is
 * the one case worth a warning -- a vacant seat has nobody to warn about.
 */
async function alertRecipients(
  adminSupabase: Db
): Promise<{ slackUserIds: string[]; unlinked: string[] }> {
  const { data: admins, error } = await adminSupabase
    .from('users')
    .select('id, full_name, admin_role')
    .in('admin_role', REQUEST_ALERT_ROLES)
    .eq('is_active', true)

  // A failed read is a real failure, unlike an empty one, and the caller logs
  // it. No alert goes out either way, which is why this is the only throw in the
  // file -- every path below degrades instead.
  if (error) throw new Error(`could not read the alert roles: ${error.message}`)

  const rows = (admins ?? []) as { id: string; full_name: string; admin_role: string }[]

  // Every seat vacant or deactivated. Legitimate -- over a transition both can
  // be -- so it returns the empty answer and lets resolveDestinations() decide
  // what to do with it.
  if (!rows.length) return { slackUserIds: [], unlinked: [] }

  const { data: links } = await adminSupabase
    .from('slack_connections')
    .select('slack_user_id, chambers_user_id')
    .in('chambers_user_id', rows.map(r => r.id))

  const byUser = new Map(
    ((links ?? []) as { slack_user_id: string; chambers_user_id: string }[]).map(l => [
      l.chambers_user_id,
      l.slack_user_id,
    ])
  )

  return {
    // filter() before the Set, not after: a holder with no link contributes
    // nothing rather than an undefined destination, so one unmapped role cannot
    // affect delivery to the other.
    slackUserIds: [...new Set(rows.map(r => byUser.get(r.id)).filter((id): id is string => !!id))],
    unlinked: rows.filter(r => !byUser.has(r.id)).map(r => `${r.full_name} (${r.admin_role})`),
  }
}

/**
 * The channels or users this alert actually goes to, after the environment guard.
 *
 * In production: the linked admins, or SLACK_ADMIN_ALERT_CHANNEL when none of
 * them is linked, so the alert still lands somewhere rather than nowhere.
 *
 * Anywhere else: PREVIEW_SLACK_RECIPIENT alone, or nothing at all. The real
 * recipients are named in the log either way, so a test deployment still shows
 * who would have been messaged.
 */
function resolveDestinations(
  slackUserIds: string[],
  unlinked: string[]
): { destinations: string[]; note: string | null } {
  if (!isProduction()) {
    const to = process.env.PREVIEW_SLACK_RECIPIENT
    const intended = slackUserIds.join(', ') || '(nobody linked)'
    if (!to) {
      return {
        destinations: [],
        note: `withheld outside production — would have gone to ${intended}. Set PREVIEW_SLACK_RECIPIENT to receive it instead.`,
      }
    }
    return { destinations: [to], note: `redirected to ${to} outside production (intended: ${intended})` }
  }

  if (slackUserIds.length) {
    if (unlinked.length) {
      console.warn(
        `[admin-slack-alerts] No Slack link for ${unlinked.join(', ')} — they will not be alerted until they connect at ${CHAMBERS_URL}/slack/connect`
      )
    }
    return { destinations: slackUserIds, note: null }
  }

  const fallback = process.env.SLACK_ADMIN_ALERT_CHANNEL
  if (fallback) {
    return {
      destinations: [fallback],
      note: `no admin has linked Slack (${unlinked.join(', ') || 'no holders of the alert roles'}), posted to SLACK_ADMIN_ALERT_CHANNEL instead`,
    }
  }

  return {
    destinations: [],
    note: `nobody to alert — ${
      unlinked.length
        ? `${unlinked.join(', ')} have not linked Slack`
        : 'no active user holds an alert role'
    }, and SLACK_ADMIN_ALERT_CHANNEL is unset`,
  }
}

/**
 * Sends one alert. Resolves the recipients, the requester's name and the text,
 * then DMs each destination.
 *
 * Throws nothing a caller has to handle -- queueAdminRequestAlert() is the only
 * intended entry point and catches everything -- but it is exported so a script
 * or a future route can await it deliberately.
 */
export async function sendAdminRequestAlert(
  adminSupabase: Db,
  alert: AdminRequestAlert
): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) {
    console.warn('[admin-slack-alerts] SLACK_BOT_TOKEN is not set, nothing sent')
    return
  }

  const { slackUserIds, unlinked } = await alertRecipients(adminSupabase)
  const { destinations, note } = resolveDestinations(slackUserIds, unlinked)

  if (!destinations.length) {
    console.warn(`[admin-slack-alerts] ${HEADLINES[alert.kind]} not sent: ${note}`)
    return
  }
  if (note) console.warn(`[admin-slack-alerts] ${HEADLINES[alert.kind]}: ${note}`)

  // Best effort, and only for the name -- an alert without it is still worth
  // sending, so a failed read is not allowed to stop one.
  let requesterName: string | null = null
  if (alert.requestedBy) {
    const { data } = await adminSupabase
      .from('users')
      .select('full_name')
      .eq('id', alert.requestedBy)
      .maybeSingle()
    requesterName = data?.full_name ?? null
  }

  const text = formatAdminRequestAlert(alert, requesterName)

  // Sequential, like the reminder job: this is two messages, and Slack
  // rate-limits chat.postMessage per conversation, so a burst buys nothing.
  // postSlackMessage already logs its own refusals, including the ok:false ones a
  // bare fetch would read as success.
  for (const destination of destinations) {
    await postSlackMessage(destination, text)
  }
}

/**
 * Queues an alert and returns immediately.
 *
 * This is what the submission routes call, after the request row is written and
 * on the way to the response. waitUntil keeps the function alive for the posts
 * without the user waiting on Slack, and the catch is the whole point: a
 * submission must never fail, or roll back, because an alert could not be
 * delivered.
 */
export function queueAdminRequestAlert(adminSupabase: Db, alert: AdminRequestAlert): void {
  waitUntil(
    (async () => {
      try {
        await sendAdminRequestAlert(adminSupabase, alert)
      } catch (e) {
        console.error(`[admin-slack-alerts] ${HEADLINES[alert.kind]} alert failed:`, e)
      }
    })()
  )
}

/** A request filed against an existing booking: a revision, or a cancellation. */
export interface BookingAlertRequest {
  kind: RequestAlertKind
  bookingId: string
  requestedBy: string | null
  /** The date the request is about, where it names one rather than the whole run. */
  onDate?: string | null
  detail?: string | null
}

/**
 * The same thing for a revision or cancellation request, which arrives with a
 * booking id rather than the details.
 *
 * The lookup happens inside waitUntil, not before it: the four reads it takes to
 * resolve a booking are the alert's business, and the person who filed the
 * request should not wait on them.
 */
export function queueBookingRequestAlert(adminSupabase: Db, request: BookingAlertRequest): void {
  waitUntil(
    (async () => {
      try {
        const summary = await loadBookingAlertSummary(
          adminSupabase,
          request.bookingId,
          request.onDate ?? null
        )
        // The booking was read a moment ago by the route's own guard, so this is
        // all but unreachable -- and an alert that cannot say which booking or
        // when is worse than none.
        if (!summary) {
          console.warn(
            `[admin-slack-alerts] ${HEADLINES[request.kind]} alert skipped: booking ${request.bookingId} not found`
          )
          return
        }

        await sendAdminRequestAlert(adminSupabase, {
          kind: request.kind,
          bookingType: summary.bookingType,
          audience: summary.audience,
          requestedBy: request.requestedBy,
          room: summary.room,
          date: summary.date,
          startTime: summary.startTime,
          endTime: summary.endTime,
          moreDates: summary.moreDates,
          detail: request.detail ?? summary.purpose,
        })
      } catch (e) {
        console.error(`[admin-slack-alerts] ${HEADLINES[request.kind]} alert failed:`, e)
      }
    })()
  )
}
