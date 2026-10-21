import { waitUntil } from '@vercel/functions'
import { db } from './db/data-api'
import { createPrivateSlackChannel, inviteToSlackChannel, postSlackMessage } from './slack'
import { formatDate, formatTime } from './emails/changes'

/**
 * A private Slack channel for every event.
 *
 * When an admin marks a booking as an event -- the Event switch on a one-time
 * booking, is_event on one week of a weekly series, or "this is an event" when
 * fulfilling a request -- SGAssist opens a private channel named
 * event-<purpose>, invites the people who run the event and posts who each of
 * them is there as:
 *
 *   VP of Operational Affairs and Comptroller   users.admin_role
 *   VP of External Affairs                      users.iems_role
 *   the body's Leadership                       board_memberships.role
 *
 * Anyone who has not linked Slack cannot be invited, so the intro message names
 * them and how to link, and whoever is in the channel adds them by hand.
 *
 * Unmarking the event or cancelling it does not touch the channel. SGAssist
 * posts a notice in it and leaves it be; marking it again reuses the same one.
 *
 * Three rules, the same as lib/admin-slack-alerts.ts:
 *
 *   Fail soft. The admin's change is already saved. Everything here runs under
 *   waitUntil after the response and swallows its errors, so a Slack outage or a
 *   missing scope never turns marking an event into a failed save. Failures are
 *   logged, because a channel that silently never appears looks like a feature
 *   nobody turned on.
 *
 *   One channel per event. event_slack_channels is claimed before Slack is
 *   asked (db/neon/0018_event_slack_channels.sql), so two marks racing each
 *   other make one channel, and a refused create releases the claim so the next
 *   mark tries again.
 *
 *   Never invite a real officer from a preview. A preview points at the preview
 *   database, but the Slack workspace is the real one. Outside production the
 *   channel is created with PREVIEW_SLACK_RECIPIENT as its only invitee, and the
 *   intro says who would have been invited; with that unset nothing is created.
 */

const CHAMBERS_URL = 'https://chambers.northeasternsga.com'

/** What was marked: a one-time (or tabling) booking, or one week of a series. */
export type EventTarget =
  | { kind: 'booking'; bookingId: string }
  | { kind: 'occurrence'; occurrenceId: string }

/** The officer seats invited to every event channel, and the column each lives in. */
const OFFICER_SEATS: { label: string; column: 'admin_role' | 'iems_role'; value: string }[] = [
  { label: 'VP of Operational Affairs', column: 'admin_role', value: 'Vice President of Operational Affairs' },
  { label: 'Comptroller', column: 'admin_role', value: 'Comptroller' },
  { label: 'VP of External Affairs', column: 'iems_role', value: 'Vice President of External Affairs' },
]

/** Postgres unique_violation: the event already has a channel, or one is being made. */
const UNIQUE_VIOLATION = '23505'

/** Slack's limit on a channel name. */
const MAX_NAME = 80

interface EventDetails {
  purpose: string
  /** The bodies whose Leadership is invited: the owner, then any co-hosts. */
  bodyIds: string[]
  bodyName: string
  date: string | null
  startTime: string | null
  endTime: string | null
  place: string | null
}

interface Invitee {
  userId: string
  name: string
  role: string
}

function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production'
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return (Array.isArray(v) ? v[0] : v) ?? null
}

function targetColumn(target: EventTarget): ['booking_id' | 'occurrence_id', string] {
  return target.kind === 'booking'
    ? ['booking_id', target.bookingId]
    : ['occurrence_id', target.occurrenceId]
}

/**
 * event-<purpose>, in the characters Slack allows: lowercase letters, digits,
 * hyphens and underscores, at most 80. Anything else becomes a hyphen, and runs
 * of them collapse, so "Fall Showcase: Night 2!" is event-fall-showcase-night-2.
 */
export function eventChannelName(purpose: string, suffix = ''): string {
  const slug = purpose
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const base = `event-${slug || 'untitled'}`
  return (base.slice(0, MAX_NAME - suffix.length).replace(/-+$/, '') + suffix)
}

// ---------------------------------------------------------------------------
// Reading the event
// ---------------------------------------------------------------------------

type BookingRow = {
  id: string
  type: string
  purpose: string
  body_id: string
  bodies: { name: string } | { name: string }[] | null
  booking_bodies: { body_id: string }[] | null
  one_time_room_bookings: { room_name: string | null; booking_date: string; start_time: string; end_time: string }[] | null
  tabling_bookings:
    | { tabling_sessions: { location: string | null; session_date: string; start_time: string; end_time: string }[] | null }[]
    | null
}

async function loadBooking(bookingId: string): Promise<EventDetails | null> {
  const { data, error } = await db
    .from('bookings')
    .select(`
      id, type, purpose, body_id,
      bodies(name),
      booking_bodies(body_id),
      one_time_room_bookings(room_name, booking_date, start_time, end_time),
      tabling_bookings(tabling_sessions(location, session_date, start_time, end_time))
    `)
    .eq('id', bookingId)
    .maybeSingle()
  if (error) throw new Error(`could not read booking ${bookingId}: ${error.message}`)
  const b = data as BookingRow | null
  if (!b) return null

  // A weekly series is marked week by week, never as a whole; a booking-level
  // flag on one has no single date to name a channel after.
  if (b.type === 'Weekly Room') {
    console.warn(`[event-channels] booking ${bookingId} is a weekly series; mark its weeks instead`)
    return null
  }

  const sessions = [
    ...(b.one_time_room_bookings ?? []).map(s => ({
      date: s.booking_date, start: s.start_time, end: s.end_time, place: s.room_name,
    })),
    ...(b.tabling_bookings ?? []).flatMap(t =>
      (t.tabling_sessions ?? []).map(s => ({
        date: s.session_date, start: s.start_time, end: s.end_time, place: s.location,
      }))
    ),
  ].sort((x, y) => x.date.localeCompare(y.date))
  const first = sessions[0]

  return {
    purpose: b.purpose,
    bodyIds: [b.body_id, ...(b.booking_bodies ?? []).map(r => r.body_id)],
    bodyName: one(b.bodies)?.name ?? 'Unknown body',
    date: first?.date ?? null,
    startTime: first?.start ?? null,
    endTime: first?.end ?? null,
    place: first?.place ?? null,
  }
}

type OccurrenceRow = {
  id: string
  occurrence_date: string
  room_name: string | null
  start_time: string | null
  end_time: string | null
  purpose: string | null
  weekly_room_bookings:
    | {
        room_name: string | null
        start_time: string
        end_time: string
        bookings: BookingRow | BookingRow[] | null
      }
    | { room_name: string | null; start_time: string; end_time: string; bookings: BookingRow | BookingRow[] | null }[]
    | null
}

async function loadOccurrence(occurrenceId: string): Promise<EventDetails | null> {
  const { data, error } = await db
    .from('weekly_room_occurrences')
    .select(`
      id, occurrence_date, room_name, start_time, end_time, purpose,
      weekly_room_bookings(room_name, start_time, end_time,
        bookings(id, purpose, body_id, bodies(name), booking_bodies(body_id))
      )
    `)
    .eq('id', occurrenceId)
    .maybeSingle()
  if (error) throw new Error(`could not read occurrence ${occurrenceId}: ${error.message}`)
  const o = data as OccurrenceRow | null
  if (!o) return null
  const series = one(o.weekly_room_bookings)
  const booking = one(series?.bookings)
  if (!series || !booking) return null

  // Every null on the week inherits from the series, and purpose from the booking.
  return {
    purpose: o.purpose?.trim() || booking.purpose,
    bodyIds: [booking.body_id, ...(booking.booking_bodies ?? []).map(r => r.body_id)],
    bodyName: one(booking.bodies)?.name ?? 'Unknown body',
    date: o.occurrence_date,
    startTime: o.start_time ?? series.start_time,
    endTime: o.end_time ?? series.end_time,
    place: o.room_name ?? series.room_name,
  }
}

// ---------------------------------------------------------------------------
// Who is invited
// ---------------------------------------------------------------------------

/**
 * The officers and the body's Leadership, each with the role they are there as.
 *
 * A vacant seat is normal -- they turn over every spring -- and simply adds
 * nobody. Someone holding two seats (Leadership of the body and an officer) is
 * listed once, under the first.
 */
async function resolveInvitees(bodyIds: string[], bodyName: string): Promise<Invitee[]> {
  const invitees: Invitee[] = []
  const seen = new Set<string>()
  const add = (userId: string, name: string, role: string) => {
    if (seen.has(userId)) return
    seen.add(userId)
    invitees.push({ userId, name, role })
  }

  for (const seat of OFFICER_SEATS) {
    const { data, error } = await db
      .from('users')
      .select('id, full_name')
      .eq(seat.column, seat.value)
      .eq('is_active', true)
    if (error) throw new Error(`could not read ${seat.label}: ${error.message}`)
    for (const u of (data ?? []) as { id: string; full_name: string }[]) add(u.id, u.full_name, seat.label)
  }

  const { data: leaders, error } = await db
    .from('board_memberships')
    .select('user_id, bodies(name), users(full_name, is_active)')
    .in('body_id', [...new Set(bodyIds)])
    .eq('role', 'Leadership')
  if (error) throw new Error(`could not read Leadership: ${error.message}`)
  type Row = {
    user_id: string
    bodies: { name: string } | { name: string }[] | null
    users: { full_name: string; is_active: boolean | null } | { full_name: string; is_active: boolean | null }[] | null
  }
  for (const m of (leaders ?? []) as Row[]) {
    const u = one(m.users)
    if (!u || u.is_active === false) continue
    add(m.user_id, u.full_name, `${one(m.bodies)?.name ?? bodyName} Leadership`)
  }

  return invitees
}

async function slackIdsFor(userIds: string[]): Promise<Map<string, string>> {
  if (!userIds.length) return new Map()
  const { data } = await db
    .from('slack_connections')
    .select('slack_user_id, chambers_user_id')
    .in('chambers_user_id', userIds)
  return new Map(
    ((data ?? []) as { slack_user_id: string; chambers_user_id: string }[]).map(l => [
      l.chambers_user_id,
      l.slack_user_id,
    ])
  )
}

// ---------------------------------------------------------------------------
// Creating the channel
// ---------------------------------------------------------------------------

function whenAndWhere(d: EventDetails): string {
  const parts: string[] = []
  if (d.date) parts.push(formatDate(d.date))
  if (d.startTime) parts.push(`${formatTime(d.startTime)}–${formatTime(d.endTime)}`)
  if (d.place) parts.push(d.place)
  return parts.join(' · ')
}

function introText(
  d: EventDetails,
  invitees: Invitee[],
  slackIds: Map<string, string>,
  previewNote: string | null
): string {
  const lines = [
    `:tada: *${d.purpose}* has been marked as an event.`,
    `*Body:* ${d.bodyName}`,
  ]
  const when = whenAndWhere(d)
  if (when) lines.push(`*When:* ${when}`)

  lines.push('', '*Who is here, and why*')
  const byRole = new Map<string, Invitee[]>()
  for (const i of invitees) byRole.set(i.role, [...(byRole.get(i.role) ?? []), i])
  for (const [role, people] of byRole) {
    const names = people.map(p => (slackIds.has(p.userId) ? `<@${slackIds.get(p.userId)}>` : p.name))
    lines.push(`• ${role}: ${names.join(', ')}`)
  }
  if (!invitees.length) lines.push('• Nobody holds these roles right now.')

  const unlinked = invitees.filter(i => !slackIds.has(i.userId))
  if (unlinked.length) {
    lines.push(
      '',
      `:warning: Not on Slack yet, so not invited: ${unlinked.map(u => `${u.name} (${u.role})`).join(', ')}. ` +
        `They can link their account at ${CHAMBERS_URL}/slack/connect; until then, add them here by hand.`
    )
  }
  if (previewNote) lines.push('', `_${previewNote}_`)
  return lines.join('\n')
}

/** Tries event-<purpose>, then -2 to -9 while the name is taken. */
async function createWithFreeName(purpose: string) {
  let last: { ok: false; error: string } = { ok: false, error: 'name_taken' }
  for (let n = 1; n <= 9; n++) {
    const res = await createPrivateSlackChannel(eventChannelName(purpose, n === 1 ? '' : `-${n}`))
    if (res.ok || res.error !== 'name_taken') return res
    last = res
  }
  return last
}

/**
 * Opens the event's channel, or, when it already has one, says in it that the
 * booking is an event again.
 *
 * Exported so a script can await it; routes use queueEventChannel().
 */
export async function ensureEventChannel(target: EventTarget): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) {
    console.warn('[event-channels] SLACK_BOT_TOKEN is not set, no channel created')
    return
  }
  const [column, id] = targetColumn(target)

  const details = target.kind === 'booking' ? await loadBooking(id) : await loadOccurrence(id)
  if (!details) return

  const invitees = await resolveInvitees(details.bodyIds, details.bodyName)
  const slackIds = await slackIdsFor(invitees.map(i => i.userId))

  let destinations = [...new Set(invitees.map(i => slackIds.get(i.userId)).filter((s): s is string => !!s))]
  let previewNote: string | null = null
  if (!isProduction()) {
    const to = process.env.PREVIEW_SLACK_RECIPIENT
    const intended = destinations.join(', ') || '(nobody linked)'
    if (!to) {
      console.warn(
        `[event-channels] withheld outside production — would have created ${eventChannelName(details.purpose)} for ${intended}. Set PREVIEW_SLACK_RECIPIENT to receive it instead.`
      )
      return
    }
    previewNote = `Preview deployment: only ${to} was invited. In production this would have invited ${intended}.`
    destinations = [to]
  }

  // The claim. A unique violation is the normal case for an event marked
  // before, and for a second request racing this one.
  const { error: claimError } = await db
    .from('event_slack_channels')
    .insert(target.kind === 'booking' ? { booking_id: id } : { occurrence_id: id })
  if (claimError) {
    if (claimError.code !== UNIQUE_VIOLATION) {
      throw new Error(`could not claim a channel for ${column} ${id}: ${claimError.message}`)
    }
    const { data: existing } = await db
      .from('event_slack_channels')
      .select('channel_id')
      .eq(column, id)
      .maybeSingle()
    // Null is a creation still in flight; it will post its own intro.
    if (existing?.channel_id) {
      await postSlackMessage(existing.channel_id, `:tada: *${details.purpose}* has been marked as an event again.`)
    }
    return
  }

  const created = await createWithFreeName(details.purpose)
  if (!created.ok) {
    // Released, so the next mark retries instead of finding a claim with no channel.
    await db.from('event_slack_channels').delete().eq(column, id)
    throw new Error(`conversations.create refused for ${column} ${id}: ${created.error}`)
  }

  const { error: saveError } = await db
    .from('event_slack_channels')
    .update({ channel_id: created.id, channel_name: created.name })
    .eq(column, id)
  if (saveError) console.error(`[event-channels] channel ${created.id} made but not recorded:`, saveError.message)

  await inviteToSlackChannel(created.id, destinations)
  await postSlackMessage(created.id, introText(details, invitees, slackIds, previewNote))
}

/**
 * Posts a notice in the event's channel, if it has one. For unmarking and for
 * cancellation; neither archives the channel or removes anyone.
 */
export async function noticeEventChannel(target: EventTarget, text: string): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) return
  const [column, id] = targetColumn(target)
  const { data } = await db
    .from('event_slack_channels')
    .select('channel_id')
    .eq(column, id)
    .maybeSingle()
  if (data?.channel_id) await postSlackMessage(data.channel_id, text)
}

export const UNMARKED_NOTICE =
  ':information_source: This booking is no longer marked as an event in Chambers.'

/**
 * Tells each affected event channel that its reservation was cancelled. Called
 * from notifyCancelledReservations (lib/room-invites.ts), which every admin
 * cancellation path already goes through.
 *
 * A one-time booking's channel belongs to the whole booking, so a booking with
 * several sessions gets one notice naming the dates that went. Moving a
 * reservation to Virtual is not a cancellation and says nothing.
 */
export async function noticeCancelledEventChannels(
  rows: { source: 'one_time' | 'occurrence' | 'tabling_session'; id: string; bookingId: string; resultingStatus: string; date: string }[]
): Promise<void> {
  const byTarget = new Map<string, { target: EventTarget; dates: string[] }>()
  for (const r of rows) {
    if (r.resultingStatus !== 'Cancelled') continue
    const target: EventTarget =
      r.source === 'occurrence' ? { kind: 'occurrence', occurrenceId: r.id } : { kind: 'booking', bookingId: r.bookingId }
    const key = r.source === 'occurrence' ? `o:${r.id}` : `b:${r.bookingId}`
    const entry = byTarget.get(key) ?? { target, dates: [] }
    entry.dates.push(r.date)
    byTarget.set(key, entry)
  }
  for (const { target, dates } of byTarget.values()) {
    const when = [...new Set(dates)].sort().map(formatDate).join(', ')
    await noticeEventChannel(target, `:x: Cancelled in Chambers: ${when}.`)
  }
}

// ---------------------------------------------------------------------------
// Queueing
// ---------------------------------------------------------------------------

function queue(label: string, work: () => Promise<void>): void {
  waitUntil(
    (async () => {
      try {
        await work()
      } catch (e) {
        console.error(`[event-channels] ${label} failed:`, e)
      }
    })()
  )
}

/** Queues ensureEventChannel() and returns at once. Never throws. */
export function queueEventChannel(target: EventTarget): void {
  queue('creating the channel', () => ensureEventChannel(target))
}

/** Queues noticeEventChannel() for each target and returns at once. Never throws. */
export function queueEventChannelNotice(targets: EventTarget[], text: string): void {
  if (!targets.length) return
  queue('posting a notice', async () => {
    for (const t of targets) await noticeEventChannel(t, text)
  })
}
