import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { postSlackMessage } from '@/lib/slack'
import { SLACK_REMINDER_BODY_TYPES } from '@/lib/body-types'
import {
  REMINDER_HOUR,
  appZoneParts,
  nextDay,
  resolveMeeting,
  formatReminder,
  type ReminderCandidate,
} from '@/lib/meeting-reminders'

/**
 * Posts tomorrow's committee meetings to each committee's Slack channel
 * (issue #95).
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

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * `!inner` on all three joins so a row is dropped unless its whole chain exists,
 * which is what lets the body-level filters below narrow the occurrence rows.
 */
const SELECT = `
  occurrence_date, room_name, start_time, end_time, status, purpose, hidden, weekly_booking_id,
  weekly_room_bookings!inner(
    room_name, start_time, end_time, status,
    bookings!inner(
      purpose, hidden,
      bodies!inner(name, body_type, slack_channel_id, slack_reminders_enabled)
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
  // midnight Eastern, and an overnight run would otherwise ping every committee
  // channel at 1am.
  if (hour < REMINDER_HOUR) {
    return NextResponse.json({ ok: true, skipped: 'before posting hour', hour })
  }

  const target = nextDay(today)

  const { data, error } = await adminSupabase
    .from('weekly_room_occurrences')
    .select(SELECT)
    .eq('occurrence_date', target)
    .in('weekly_room_bookings.bookings.bodies.body_type', [...SLACK_REMINDER_BODY_TYPES])
    .eq('weekly_room_bookings.bookings.bodies.slack_reminders_enabled', true)
    .not('weekly_room_bookings.bookings.bodies.slack_channel_id', 'is', null)

  if (error) {
    console.error('slack-reminders query failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const candidates: ReminderCandidate[] = []
  for (const row of data ?? []) {
    const series = one(row.weekly_room_bookings)
    const booking = one(series?.bookings)
    const body = one(booking?.bodies)
    if (!series || !booking || !body) continue

    candidates.push({
      occurrence_date: row.occurrence_date,
      room_name: row.room_name,
      start_time: row.start_time,
      end_time: row.end_time,
      status: row.status,
      purpose: row.purpose,
      hidden: row.hidden,
      weekly_booking_id: row.weekly_booking_id,
      series: {
        room_name: series.room_name,
        start_time: series.start_time,
        end_time: series.end_time,
        status: series.status,
      },
      booking: { purpose: booking.purpose, hidden: booking.hidden },
      body: { name: body.name, slack_channel_id: body.slack_channel_id },
    })
  }

  const meetings = candidates
    .map(resolveMeeting)
    .filter((m): m is NonNullable<typeof m> => m !== null)

  if (meetings.length === 0) {
    return NextResponse.json({ ok: true, date: target, posted: 0, considered: 0 })
  }

  // One read for the whole day rather than a lookup per meeting.
  const { data: alreadyPosted } = await adminSupabase
    .from('slack_meeting_reminders')
    .select('weekly_booking_id')
    .eq('occurrence_date', target)

  const done = new Set((alreadyPosted ?? []).map((r: { weekly_booking_id: string }) => r.weekly_booking_id))
  const pending = meetings.filter(m => !done.has(m.weeklyBookingId))

  let posted = 0
  const failures: { body: string; error?: string }[] = []

  // Sequential, not Promise.all. These are a handful of messages a day, and
  // Slack rate-limits chat.postMessage per channel; a burst buys nothing.
  for (const meeting of pending) {
    const result = await postSlackMessage(meeting.channelId, formatReminder(meeting))

    if (!result.ok) {
      // Deliberately no row written: a refused post should be retried by the
      // next run of the morning, not recorded as delivered.
      failures.push({ body: meeting.bodyName, error: result.error })
      continue
    }

    const { error: insertError } = await adminSupabase
      .from('slack_meeting_reminders')
      .insert({
        weekly_booking_id: meeting.weeklyBookingId,
        occurrence_date: meeting.date,
        channel_id: meeting.channelId,
      })

    // The message is already out. A failure to record that is worth shouting
    // about, because the next run will post it again.
    if (insertError) {
      console.error(
        `slack-reminders: posted for ${meeting.bodyName} but could not record it:`,
        insertError.message
      )
    }

    posted++
  }

  return NextResponse.json({
    ok: true,
    date: target,
    considered: meetings.length,
    posted,
    skipped: meetings.length - pending.length,
    failures,
  })
}
