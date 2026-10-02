import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { postSlackMessage } from '@/lib/slack'
import {
  REMINDER_HOUR,
  appZoneParts,
  audienceBodies,
  nextDay,
  resolveMeeting,
  formatReminder,
  type ReminderBody,
  type ReminderCandidate,
} from '@/lib/meeting-reminders'
import { isBookingScope, isDivision, type BookingScope, type Division } from '@/lib/booking-scope'

/**
 * Posts tomorrow's meetings -- or that tomorrow's meeting is off -- to each
 * body's Slack channel (issues #95, #104).
 *
 * Every body is eligible, whatever its type. What decides is whether the body
 * has a channel linked and its reminders switched on -- asked of each body in
 * the booking's audience, not only of the one that owns it (issue #212).
 *
 * Driven by .github/workflows/slack-reminders.yml, following the same pattern as
 * /api/cron/warm: a scheduled GitHub Action rather than a Vercel cron, because
 * Hobby plans cap Vercel crons at one a day and this needs to retry.
 *
 * That retrying is why the action fires several times in the morning. GitHub
 * schedules lag and are occasionally skipped altogether, so one shot at 9am
 * would silently drop a day's reminders. Two things keep the repeats harmless:
 * the REMINDER_HOUR gate, so nothing posts overnight when the date first rolls
 * over, and the unique (weekly_booking_id, occurrence_date) row written after
 * each post, so the second run of the morning finds the work already done.
 *
 * Set CRON_SECRET to gate it. Unlike /api/cron/warm -- which only does trivial
 * reads and so is safe to leave open -- this one writes and posts to Slack, so
 * it refuses to run at all without the secret configured.
 */

const adminSupabase = db

/**
 * `!inner` so a row is dropped unless its whole chain exists.
 *
 * Deliberately unfiltered on the body, unlike before issue #212. Which channels
 * a booking reminds is now a question about its whole audience -- the division,
 * for a divisional booking -- and narrowing the occurrence rows by the *owner's*
 * channel and switch would answer a different question: it would drop a
 * divisional booking whose owner has no channel while four bodies in its
 * division do, and keep one whose owner does while the booking's real audience
 * is elsewhere. The bodies are read separately and the audience resolved in
 * memory; a day's occurrences are a few dozen rows.
 */
const SELECT = `
  occurrence_date, room_name, start_time, end_time, meeting_time, status, hidden, weekly_booking_id,
  weekly_room_bookings!inner(
    room_name, start_time, end_time, meeting_time, status,
    bookings!inner(
      id, hidden, body_id, scope, division,
      bodies!inner(name)
    )
  )
`

/** PostgREST types an embedded to-one relation as a possible array. */
function one<T>(v: T | T[] | null | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : v ?? undefined
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('slack-reminders: CRON_SECRET is not set, refusing to run')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { date: today, hour } = appZoneParts()

  // Before the posting hour there is nothing to do. The date rolls over at
  // midnight Eastern, and an overnight run would otherwise ping every linked
  // channel at 1am.
  if (hour < REMINDER_HOUR) {
    return NextResponse.json({ ok: true, skipped: 'before posting hour', hour })
  }

  const target = nextDay(today)

  // Tomorrow's occurrences, every active body, and -- only where a multi booking
  // turns up -- the bodies it is shared with. Three reads for the whole day
  // rather than an audience lookup per meeting.
  const [{ data, error }, { data: bodyRows, error: bodiesError }] = await Promise.all([
    adminSupabase.from('weekly_room_occurrences').select(SELECT).eq('occurrence_date', target),
    adminSupabase
      .from('bodies')
      .select('id, name, division, slack_channel_id, slack_reminders_enabled')
      .eq('is_active', true),
  ])

  if (error || bodiesError) {
    const failure = error ?? bodiesError
    console.error('slack-reminders query failed:', failure)
    return NextResponse.json({ error: failure!.message }, { status: 500 })
  }

  const bodies = (bodyRows ?? []) as ReminderBody[]

  // Flattened first, so an incomplete join chain is dropped in one place and the
  // booking ids are in hand before the booking_bodies read below.
  const flattened: {
    weekly_booking_id: string
    series: ReminderCandidate['series']
    occurrence: Omit<ReminderCandidate, 'weekly_booking_id' | 'series' | 'booking' | 'body' | 'audience'>
    bookingId: string
    bookingHidden: boolean | null
    bodyId: string
    bodyName: string
    scope: BookingScope
    division: Division | null
  }[] = []

  for (const row of data ?? []) {
    const series = one(row.weekly_room_bookings)
    const booking = one(series?.bookings)
    const body = one(booking?.bodies)
    if (!series || !booking || !body) continue

    flattened.push({
      weekly_booking_id: row.weekly_booking_id,
      series: {
        room_name: series.room_name,
        start_time: series.start_time,
        end_time: series.end_time,
        meeting_time: series.meeting_time,
        status: series.status,
      },
      bookingId: booking.id,
      bookingHidden: booking.hidden,
      bodyId: booking.body_id,
      bodyName: body.name,
      // Off the wire, so neither is trusted to be a value this code knows. An
      // unrecognised scope falls back to 'single', which reminds the owning
      // body alone -- the behaviour before issue #212, and the narrowest
      // audience rather than the widest.
      scope: isBookingScope(booking.scope) ? booking.scope : 'single',
      division: isDivision(booking.division) ? booking.division : null,
      occurrence: {
        occurrence_date: row.occurrence_date,
        room_name: row.room_name,
        start_time: row.start_time,
        end_time: row.end_time,
        meeting_time: row.meeting_time,
        status: row.status,
        hidden: row.hidden,
      },
    })
  }

  // Only a multi booking needs its join rows, and there are usually none in a
  // given day, so this read is skipped outright rather than run empty.
  const multiBookingIds = [...new Set(flattened.filter(f => f.scope === 'multi').map(f => f.bookingId))]
  const linkedByBooking = new Map<string, string[]>()
  if (multiBookingIds.length) {
    const { data: links } = await adminSupabase
      .from('booking_bodies')
      .select('booking_id, body_id')
      .in('booking_id', multiBookingIds)
    for (const l of (links ?? []) as { booking_id: string; body_id: string }[]) {
      linkedByBooking.set(l.booking_id, [...(linkedByBooking.get(l.booking_id) ?? []), l.body_id])
    }
  }

  const candidates: ReminderCandidate[] = flattened.map(f => {
    const booking = {
      body_id: f.bodyId,
      scope: f.scope,
      division: f.division,
      hidden: f.bookingHidden,
      linkedBodyIds: linkedByBooking.get(f.bookingId) ?? [],
    }
    return {
      ...f.occurrence,
      weekly_booking_id: f.weekly_booking_id,
      series: f.series,
      booking,
      body: { name: f.bodyName },
      audience: audienceBodies(booking, bodies),
    }
  })

  const meetings = candidates
    .map(resolveMeeting)
    .filter((m): m is NonNullable<typeof m> => m !== null)

  if (meetings.length === 0) {
    return NextResponse.json({ ok: true, date: target, posted: 0, considered: 0 })
  }

  // One read for the whole day rather than a lookup per meeting. Keyed per
  // channel, not per booking (issue #212): a divisional booking posts to several
  // and each has to be tracked on its own, or the first channel to go out would
  // record the booking as done and leave the rest of the division silent -- and
  // a channel that refused would be papered over by one that did not.
  const { data: alreadyPosted } = await adminSupabase
    .from('slack_meeting_reminders')
    .select('weekly_booking_id, channel_id')
    .eq('occurrence_date', target)

  const postKey = (weeklyBookingId: string, channelId: string) => `${weeklyBookingId}|${channelId}`
  const done = new Set(
    (alreadyPosted ?? []).map((r: { weekly_booking_id: string; channel_id: string }) =>
      postKey(r.weekly_booking_id, r.channel_id)
    )
  )

  // One message per channel in each meeting's audience, with the text built once
  // per meeting: every channel is told the same thing, because it is the same
  // meeting.
  const pending = meetings.flatMap(m =>
    m.channelIds
      .filter(channelId => !done.has(postKey(m.weeklyBookingId, channelId)))
      .map(channelId => ({ meeting: m, channelId, text: formatReminder(m) }))
  )
  const considered = meetings.reduce((n, m) => n + m.channelIds.length, 0)

  let posted = 0
  const failures: { body: string; channel: string; error?: string }[] = []

  // Sequential, not Promise.all. These are a handful of messages a day, and
  // Slack rate-limits chat.postMessage per channel; a burst buys nothing.
  for (const { meeting, channelId, text } of pending) {
    const result = await postSlackMessage(channelId, text)

    if (!result.ok) {
      // Deliberately no row written: a refused post should be retried by the
      // next run of the morning, not recorded as delivered. Only this channel is
      // affected -- the rest of the audience still goes out.
      failures.push({ body: meeting.bodyName, channel: channelId, error: result.error })
      continue
    }

    const { error: insertError } = await adminSupabase
      .from('slack_meeting_reminders')
      .insert({
        weekly_booking_id: meeting.weeklyBookingId,
        occurrence_date: meeting.date,
        channel_id: channelId,
      })

    // The message is already out. A failure to record that is worth shouting
    // about, because the next run will post it again.
    if (insertError) {
      console.error(
        `slack-reminders: posted for ${meeting.bodyName} in ${channelId} but could not record it:`,
        insertError.message
      )
    }

    posted++
  }

  return NextResponse.json({
    ok: true,
    date: target,
    meetings: meetings.length,
    considered,
    posted,
    skipped: considered - pending.length,
    failures,
  })
}
