import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { postSlackMessage } from '@/lib/slack'
import { appZoneParts } from '@/lib/meeting-reminders'
import { getActiveSemesterId } from '@/lib/active-semester'
import { isBookingScope, isDivision } from '@/lib/booking-scope'
import {
  CANCEL_REMINDER_HOUR,
  formatCancelReminder,
  isSunday,
  summarize,
  upcomingWeek,
  type CancelCandidate,
} from '@/lib/weekly-cancel-reminder'

/**
 * Posts the Sunday reminder to cancel weekly rooms nobody will use, to the
 * channel set on the Management page (app_settings.cancel_reminder_channel_id).
 *
 * Posts nothing unless the coming Monday-to-Sunday has a weekly room in the
 * active semester that is Reserved or at an alternate room or time -- see
 * lib/weekly-cancel-reminder.ts for why those and only those.
 *
 * Driven by .github/workflows/weekly-cancel-reminder.yml, which fires several
 * times on Sunday afternoon for the reasons slack-reminders.yml gives: GitHub
 * schedules lag and are sometimes skipped. The repeats are harmless because
 * nothing posts before noon Eastern or on any day but Sunday, and because the
 * (week_start, channel_id) row written after a post makes the next run a no-op.
 *
 * Outside production the post is redirected to PREVIEW_SLACK_RECIPIENT, or
 * withheld where that is unset, so a preview pointed at real settings cannot
 * post into the real leadership channel -- the same guard as
 * lib/admin-slack-alerts.ts.
 *
 * Refuses to run without CRON_SECRET, like /api/cron/slack-reminders, because it
 * writes and posts.
 */

const adminSupabase = db

const SELECT = `
  occurrence_date, status, hidden,
  weekly_room_bookings!inner(
    status,
    bookings!inner(
      hidden, scope, division, semester_id,
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
    console.error('weekly-cancel-reminder: CRON_SECRET is not set, refusing to run')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { date: today, hour } = appZoneParts()

  // Checked on Boston's calendar, not the schedule's: the workflow fires in UTC,
  // and only this decides which day it is where the rooms are.
  if (!isSunday(today)) {
    return NextResponse.json({ ok: true, skipped: 'not Sunday', date: today })
  }
  if (hour < CANCEL_REMINDER_HOUR) {
    return NextResponse.json({ ok: true, skipped: 'before posting hour', hour })
  }

  const { data: settings, error: settingsError } = await adminSupabase
    .from('app_settings')
    .select('cancel_reminder_channel_id')
    .eq('id', 1)
    .single()

  if (settingsError) {
    console.error('weekly-cancel-reminder: could not read app_settings:', settingsError.message)
    return NextResponse.json({ error: settingsError.message }, { status: 500 })
  }

  const channelId = (settings?.cancel_reminder_channel_id as string | null)?.trim()
  if (!channelId) {
    return NextResponse.json({ ok: true, skipped: 'no channel set' })
  }

  const semesterId = await getActiveSemesterId(adminSupabase)
  if (!semesterId) {
    return NextResponse.json({ ok: true, skipped: 'no active semester' })
  }

  const week = upcomingWeek(today)

  const { data, error } = await adminSupabase
    .from('weekly_room_occurrences')
    .select(SELECT)
    .gte('occurrence_date', week.start)
    .lte('occurrence_date', week.end)
    .eq('weekly_room_bookings.bookings.semester_id', semesterId)

  if (error) {
    console.error('weekly-cancel-reminder query failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const candidates: CancelCandidate[] = []
  for (const row of data ?? []) {
    const series = one(row.weekly_room_bookings)
    const booking = one(series?.bookings)
    const body = one(booking?.bodies)
    if (!series || !booking || !body) continue

    candidates.push({
      status: row.status,
      hidden: row.hidden,
      seriesStatus: series.status,
      bookingHidden: booking.hidden,
      bodyName: body.name,
      scope: isBookingScope(booking.scope) ? booking.scope : 'single',
      division: isDivision(booking.division) ? booking.division : null,
    })
  }

  const summary = summarize(candidates)
  if (!summary) {
    return NextResponse.json({ ok: true, week, posted: false, reason: 'no held weekly rooms' })
  }

  // The environment guard. The row below is keyed on wherever the message
  // actually went, so a preview's redirected post never marks production's done.
  let destination = channelId
  if (process.env.VERCEL_ENV !== 'production') {
    const redirect = process.env.PREVIEW_SLACK_RECIPIENT
    if (!redirect) {
      return NextResponse.json({
        ok: true,
        week,
        posted: false,
        reason: `withheld outside production (would have gone to ${channelId}); set PREVIEW_SLACK_RECIPIENT to receive it`,
      })
    }
    destination = redirect
  }

  const { data: already } = await adminSupabase
    .from('slack_weekly_cancel_reminders')
    .select('week_start')
    .eq('week_start', week.start)
    .eq('channel_id', destination)
    .maybeSingle()

  if (already) {
    return NextResponse.json({ ok: true, week, posted: false, reason: 'already posted' })
  }

  const result = await postSlackMessage(destination, formatCancelReminder(week, summary))
  if (!result.ok) {
    // No row written, so the next run of the afternoon tries again.
    return NextResponse.json({ ok: false, week, error: result.error }, { status: 502 })
  }

  const { error: insertError } = await adminSupabase
    .from('slack_weekly_cancel_reminders')
    .insert({ week_start: week.start, channel_id: destination })

  // The message is out. Failing to record it means the next run posts it again.
  if (insertError) {
    console.error(
      `weekly-cancel-reminder: posted to ${destination} but could not record it:`,
      insertError.message
    )
  }

  return NextResponse.json({ ok: true, week, posted: true, channel: destination, total: summary.total })
}
