import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { sendMissedReservationEmail } from '@/lib/emails/missed-reservation'
import { sendBookingUpdatedEmail } from '@/lib/emails/booking-updated'
import { sendBookingCreatedEmail } from '@/lib/emails/booking-created'
import { changed, collectChanges, formatDate, formatTime } from '@/lib/emails/changes'
import { occurrenceMoved } from '@/lib/weekly-occurrences'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { planInvites } from '@/lib/room-calendar'
import { appToday, sendPerAudience, weeklyRoomSessions, type OccurrenceRow } from '@/lib/room-invites'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { waitUntil } from '@vercel/functions'

import {
  loadScopeContext,
  validateScopeSelection,
  resolveBookingRecipients,
  syncBookingBodies,
  type ScopedRow,
} from '@/lib/booking-scope'
import { OPEN_REQUEST_STATUSES } from '@/lib/request-status'

/**
 * One occurrence as the editor submits it (issue #55).
 *
 * Everything but the date and is_event is an override -- of the parent series,
 * or of the booking above it for purpose and hidden -- where null means inherit.
 * is_event is not an override: a weekly event is marked on the week it happens,
 * so the occurrence is authoritative and has nothing to inherit from.
 */
interface OccurrenceInput {
  occurrence_date: string
  room_name: string | null
  start_time: string | null
  end_time: string | null
  status: string | null
  reservation_code: string | null
  senate_type: string | null
  purpose: string | null
  hidden: boolean | null
  is_event: boolean
}

const adminSupabase = db

/** One stored occurrence as read back before the write below. */
interface PrevOccurrenceRow {
  /** Read for the calendar invite: the event id a recipient already holds (issue #69). */
  id: string
  occurrence_date: string
  room_name: string | null
  start_time: string | null
  end_time: string | null
  status: string | null
  reservation_code: string | null
  purpose: string | null
  senate_type: string | null
  hidden: boolean | null
  is_event: boolean | null
}

function getWeeklyDates(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const current = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')

  while (current <= end) {
    dates.push(current.toISOString().split('T')[0])
    current.setDate(current.getDate() + 7)
  }

  return dates
}

export async function POST(request: Request) {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { body_id, purpose, room_name, start_date, end_date, start_time, end_time, reservation_code, status, semester_id, scope, division, body_ids } = await request.json()

  const { data: semester } = await adminSupabase
    .from('semesters')
    .select('id')
    .eq('id', semester_id)
    .single()

  if (!semester) {
    return NextResponse.json({ error: 'Invalid semester.' }, { status: 400 })
  }

  const ctx = await loadScopeContext(supabase, user)
  const selection = validateScopeSelection(ctx, { scope, body_id, division, body_ids })
  if (!selection.ok) return NextResponse.json({ error: selection.error }, { status: 400 })

  // admin_role is already a claim on the verified JWT, so this no longer needs
  // a round trip to the users table.
  const creatorRole = user.app_metadata?.admin_role ?? null

  // Create parent booking
  const { data: booking, error: bookingError } = await adminSupabase
    .from('bookings')
    .insert({
      body_id: selection.value.body_id,
      scope: selection.value.scope,
      division: selection.value.division,
      purpose,
      type: 'Weekly Room',
      created_by: user.id,
      creator_role: creatorRole,
      semester_id,
    })
    .select()
    .single()

  if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })

  const { error: bodiesError } = await syncBookingBodies(
    adminSupabase, booking.id, selection.value.scope, selection.value.body_ids
  )
  if (bodiesError) return NextResponse.json({ error: bodiesError }, { status: 500 })

  // Create weekly room booking
  const { data: weekly, error: weeklyError } = await adminSupabase
    .from('weekly_room_bookings')
    .insert({ booking_id: booking.id, room_name, start_date, end_date, start_time, end_time, reservation_code: reservation_code || null, status })
    .select()
    .single()

  if (weeklyError) return NextResponse.json({ error: weeklyError.message }, { status: 500 })

  // Generate occurrences
  const dates = getWeeklyDates(start_date, end_date)
  const occurrences = dates.map(date => ({
    weekly_booking_id: weekly.id,
    occurrence_date: date,
  }))

  // Selected back for their ids, which the calendar invite uses as its event
  // ids (issue #69). They are stable across later edits, so an edit moves the
  // event a recipient already has rather than adding a second one.
  const { data: createdOccurrences, error: occurrenceError } = await adminSupabase
    .from('weekly_room_occurrences')
    .insert(occurrences)
    .select('id, occurrence_date, room_name, start_time, end_time, status, senate_type, purpose')

  if (occurrenceError) return NextResponse.json({ error: occurrenceError.message }, { status: 500 })

  // Chambers emailed on update and on a missed reservation but never on
  // creation, so the first email a body got about a booking was one saying it
  // had changed -- referring to details they had never been sent (issue #79).
  //
  // waitUntil, like the update email: the booking is already written, and the
  // admin should not wait on a Resend round trip to find that out.
  waitUntil(
    (async () => {
      try {
        const scopedRow: ScopedRow = {
          id: booking.id,
          body_id: selection.value.body_id,
          scope: selection.value.scope,
          division: selection.value.division,
        }
        const recipients = await resolveBookingRecipients(adminSupabase, scopedRow)
        if (!recipients.length) return

        const { data: bodyData } = await adminSupabase
          .from('bodies').select('name').eq('id', selection.value.body_id).single()

        const bodyName = bodyData?.name ?? 'Unknown'

        // Everything upcoming goes on calendars; nothing comes off, since this
        // booking has never been sent to anybody.
        const plan = planInvites(
          null,
          weeklyRoomSessions(
            (createdOccurrences ?? []) as OccurrenceRow[],
            { room_name, start_time, end_time, status, purpose },
            bodyName
          ),
          appToday()
        )

        await sendPerAudience(recipients, plan, bodyName, async audience => {
          await sendBookingCreatedEmail({
            bodyName,
            bookingType: 'Weekly Room',
            purpose,
            roomOrTable: room_name || 'N/A',
            status,
            dateRange: { start: start_date, end: end_date },
            // Freshly generated, so every occurrence carries the series' room and
            // time -- there are no per-week overrides to report yet.
            sessions: dates.map(d => ({ date: d, startTime: start_time, endTime: end_time })),
            recipients: audience.recipients,
            invite: audience.plan,
          })
        })
      } catch (e) {
        console.error('Booking created email failed:', e)
      }
    })()
  )

  return NextResponse.json({ success: true })
}

export async function PATCH(request: Request) {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { booking_id, weekly_id, body_id, purpose, room_name, start_date, end_date, start_time, end_time, reservation_code, status, occurrences, scope, division, body_ids } = await request.json()

  const ctx = await loadScopeContext(supabase, user)
  const selection = validateScopeSelection(ctx, { scope, body_id, division, body_ids })
  if (!selection.ok) return NextResponse.json({ error: selection.error }, { status: 400 })

  // Read before writing, so the email can say what moved rather than only where
  // the booking now stands (issue #79). Both reads are needed up front: the
  // occurrence rows are overwritten further down, so after that point the
  // previous per-week values are gone.
  const [{ data: prevBooking }, { data: prevWeekly }, { data: prevOccurrences }] = await Promise.all([
    adminSupabase.from('bookings').select('purpose').eq('id', booking_id).single(),
    adminSupabase
      .from('weekly_room_bookings')
      .select('room_name, start_date, end_date, start_time, end_time, status, reservation_code')
      .eq('id', weekly_id)
      .single(),
    adminSupabase
      .from('weekly_room_occurrences')
      .select(
        'id, occurrence_date, room_name, start_time, end_time, status, reservation_code, purpose, senate_type, hidden, is_event'
      )
      .eq('weekly_booking_id', weekly_id),
  ])

  // Update parent booking
  const { error: bookingError } = await adminSupabase
    .from('bookings')
    .update({
      body_id: selection.value.body_id,
      scope: selection.value.scope,
      division: selection.value.division,
      purpose,
    })
    .eq('id', booking_id)

  if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })

  // Clears the join rows when the scope moved away from 'multi'.
  const { error: bodiesError } = await syncBookingBodies(
    adminSupabase, booking_id, selection.value.scope, selection.value.body_ids
  )
  if (bodiesError) return NextResponse.json({ error: bodiesError }, { status: 500 })

  // Update weekly booking base fields
  const { error: weeklyError } = await adminSupabase
    .from('weekly_room_bookings')
    .update({ room_name, start_date, end_date, start_time, end_time, reservation_code: reservation_code || null, status })
    .eq('id', weekly_id)

  if (weeklyError) return NextResponse.json({ error: weeklyError.message }, { status: 500 })

  const dates = getWeeklyDates(start_date, end_date)
  const newOccurrences = dates.map(date => {
    const existing = occurrences.find((o: OccurrenceInput) => o.occurrence_date === date)
    return {
      weekly_booking_id: weekly_id,
      occurrence_date: date,
      room_name: existing?.room_name || null,
      start_time: existing?.start_time || null,
      end_time: existing?.end_time || null,
      status: existing?.status || null,
      reservation_code: existing?.reservation_code || null,
      senate_type: existing?.senate_type ?? null,
      // Issue #55. Both inherit from the booking when null.
      //
      // purpose is trimmed, and an empty string collapses to null -- clearing the
      // field in the editor means "inherit", not "this week has a blank purpose".
      purpose: existing?.purpose?.trim() || null,
      // `?? null`, not `|| null`: false is meaningful here. It forces an
      // occurrence visible even when its series is hidden, and `||` would
      // silently turn that back into inherit.
      hidden: existing?.hidden ?? null,
      // Not an override: the occurrence is where a weekly event is marked, so an
      // absent value is simply "not an event" rather than "inherit".
      is_event: existing?.is_event ?? false,
    }
  })

  // Written in place, keyed on the date (issue #113). This used to delete every
  // occurrence and reinsert the lot, so each week got a new id on every save and
  // nothing could point at one -- a calendar UID, a cancellation request, an
  // event checklist. Now a week the series still covers keeps its row and id;
  // only weeks it newly covers are inserted, and only weeks it no longer covers
  // are removed.
  //
  // Upsert before the delete, not after: if the second step fails, the series
  // is left with a week too many rather than with no weeks at all, which is what
  // a failed reinsert used to leave behind.
  const { error: occError } = await adminSupabase
    .from('weekly_room_occurrences')
    .upsert(newOccurrences, { onConflict: 'weekly_booking_id,occurrence_date' })

  if (occError) return NextResponse.json({ error: occError.message }, { status: 500 })

  // Asked of the table rather than of prevOccurrences, so a failed read above
  // cannot leave weeks behind that the series no longer covers.
  let staleQuery = adminSupabase
    .from('weekly_room_occurrences')
    .delete()
    .eq('weekly_booking_id', weekly_id)
  if (dates.length) staleQuery = staleQuery.not('occurrence_date', 'in', `(${dates.join(',')})`)

  const { error: staleError } = await staleQuery
  if (staleError) return NextResponse.json({ error: staleError.message }, { status: 500 })

  // Read back after the write, for the ids the calendar invite needs (issue
  // #69). A week the series still covers kept the id it was created with, so a
  // recipient's event is moved rather than duplicated.
  const { data: storedOccurrences } = await adminSupabase
    .from('weekly_room_occurrences')
    .select('id, occurrence_date, room_name, start_time, end_time, status, senate_type, purpose')
    .eq('weekly_booking_id', weekly_id)

  const { data: auditLog } = await adminSupabase
    .from('audit_logs')
    .insert({ booking_id, admin_id: user.id, new_status: status })
    .select('id')
    .single()

  const { data: bodyData } = await adminSupabase
    .from('bodies')
    .select('name')
    .eq('id', selection.value.body_id)
    .single()
  const bodyName = bodyData?.name ?? 'Unknown'

  const scopedRow: ScopedRow = {
    id: booking_id,
    body_id: selection.value.body_id,
    scope: selection.value.scope,
    division: selection.value.division,
  }
  // Which weeks this edit actually moved, in date order.
  //
  // This used to be "the first week carrying any override", which is a different
  // question and usually a different week: an override set on week 1 months ago
  // is still an override today, so every later edit to the series was reported
  // against week 1 -- with an empty change list, because week 1 had not in fact
  // moved (issue #91). Comparing each week against what was stored for it is the
  // only way to name the week the administrator touched.
  const prevByDate = new Map(
    ((prevOccurrences ?? []) as PrevOccurrenceRow[]).map(o => [o.occurrence_date, o])
  )
  const movedOccurrences = newOccurrences.filter(o =>
    occurrenceMoved(prevByDate.get(o.occurrence_date), o)
  )

  // Series-level fields. Compared against what was on the row before this
  // request rather than against the payload, so an edit that resubmits a field
  // unchanged does not report it as a change.
  //
  // Computed here rather than in the email block below because the audience
  // depends on it: whether this edit is about particular sessions or about the
  // whole series decides which Senate session types it is about.
  const seriesChanges = collectChanges(
    changed('Purpose', prevBooking?.purpose, purpose),
    changed('Room', prevWeekly?.room_name, room_name),
    changed('Start date', prevWeekly?.start_date, start_date, formatDate),
    changed('End date', prevWeekly?.end_date, end_date, formatDate),
    changed('Start time', prevWeekly?.start_time, start_time, formatTime),
    changed('End time', prevWeekly?.end_time, end_time, formatTime),
    changed('Status', prevWeekly?.status, status),
    changed('Reservation code', prevWeekly?.reservation_code, reservation_code || null),
  )

  // The sessions this notification is about: the weeks that moved, or -- when
  // the series itself moved -- all of them. Senate members who have deselected
  // every one of these session types drop out of the audience (issues #92, #93).
  const notifiedSenateTypes = (seriesChanges.length === 0 ? movedOccurrences : newOccurrences)
    .map(o => o.senate_type)

  // The audience is the whole scope, not just the owning body -- see resolveBookingRecipients for
  // the divisional/multi fan-out policy.
  const recipients = await resolveBookingRecipients(adminSupabase, scopedRow, {
    senateTypes: notifiedSenateTypes,
  })

  // The alert points at the earliest week that moved, falling back to the start
  // of the series when the edit was series-wide.
  const alertOcc = movedOccurrences[0] ?? newOccurrences[0]

  if (recipients.length && auditLog) {
    await adminSupabase.from('user_alerts').insert(
      recipients.map(r => ({
        user_id: r.userId,
        audit_log_id: auditLog.id,
        booking_id,
        booking_type: 'Weekly Room',
        booking_date: alertOcc?.occurrence_date ?? start_date,
        start_time: alertOcc?.start_time ?? start_time,
      }))
    )
  }

  // Notification only -- the booking is already written, so don't hold the
  // admin's response open for a Resend round trip.
  waitUntil(
    (async () => {
      try {
        // When the series itself did not move, the edit was to the weeks that
        // moved -- so the email describes those weeks. If the series moved too,
        // the series is the story and a per-week heading would understate it.
        const targetOccs = seriesChanges.length === 0 ? movedOccurrences : []

        const sessions = targetOccs.map(occ => {
          const prev = prevByDate.get(occ.occurrence_date)
          // An occurrence field that is null inherits from the series, so the
          // comparison is between effective values -- otherwise clearing an
          // override would read as a change to nothing.
          const changes = collectChanges(
            changed('Room', prev?.room_name ?? prevWeekly?.room_name, occ.room_name ?? room_name),
            changed('Start time', prev?.start_time ?? prevWeekly?.start_time, occ.start_time ?? start_time, formatTime),
            changed('End time', prev?.end_time ?? prevWeekly?.end_time, occ.end_time ?? end_time, formatTime),
            changed('Status', prev?.status ?? prevWeekly?.status, occ.status ?? status),
            changed('Purpose', prev?.purpose ?? prevBooking?.purpose, occ.purpose ?? purpose),
            changed('Reservation code', prev?.reservation_code ?? prevWeekly?.reservation_code, occ.reservation_code ?? (reservation_code || null)),
          )

          const index = newOccurrences.findIndex(o => o.occurrence_date === occ.occurrence_date)

          return {
            date: occ.occurrence_date,
            startTime: occ.start_time || start_time,
            endTime: occ.end_time || end_time,
            roomOrTable: occ.room_name || room_name || 'N/A',
            status: occ.status || status,
            purpose: occ.purpose ?? purpose,
            position: index >= 0 ? `week ${index + 1} of ${newOccurrences.length}` : null,
            changes,
          }
        })

        // What this edit does to calendars: every upcoming week that is still a
        // meeting is (re)sent, and one that stopped being a meeting -- cancelled,
        // waitlisted, or trimmed off the end of the series -- is taken off.
        const plan = planInvites(
          weeklyRoomSessions(
            ((prevOccurrences ?? []) as PrevOccurrenceRow[]).map(o => ({
              id: o.id,
              occurrence_date: o.occurrence_date,
              room_name: o.room_name,
              start_time: o.start_time,
              end_time: o.end_time,
              status: o.status,
              senate_type: o.senate_type,
              purpose: o.purpose,
            })),
            {
              room_name: prevWeekly?.room_name ?? null,
              start_time: prevWeekly?.start_time ?? start_time,
              end_time: prevWeekly?.end_time ?? end_time,
              status: prevWeekly?.status ?? status,
              purpose: prevBooking?.purpose ?? null,
            },
            bodyName
          ),
          weeklyRoomSessions(
            (storedOccurrences ?? []) as OccurrenceRow[],
            { room_name, start_time, end_time, status, purpose },
            bodyName
          ),
          appToday()
        )

        await sendPerAudience(recipients, plan, bodyName, async audience => {
          await sendBookingUpdatedEmail({
            bodyName,
            purpose,
            roomOrTable: room_name || 'N/A',
            date: start_date,
            startTime: start_time,
            endTime: end_time,
            status,
            changes: seriesChanges,
            sessions,
            recipients: audience.recipients,
            invite: audience.plan,
          })
        })
      } catch (e) {
        console.error('Booking updated email failed:', e)
      }
    })()
  )

  // Resolve any pending revision request for this booking
  await adminSupabase
    .from('revision_requests')
    .update({ status: 'Done' })
    .eq('booking_id', booking_id)
    .in('status', OPEN_REQUEST_STATUSES)

  // Which weeks this save actually marked Missed.
  //
  // Two things were wrong with asking "is anything Missed" (issue #99). It
  // described the alert using the series' start date and time no matter which
  // week had been missed -- the same defect as #91, in the one caller that
  // rewrite did not reach. And because a missed week stays Missed, the condition
  // stayed true forever: every later edit to the series sent Operational Affairs
  // another alert about a week they had been told about weeks earlier.
  //
  // movedOccurrences is what this save changed, so a week only alerts on the
  // edit that missed it.
  const newlyMissedWeeks = movedOccurrences.filter(o => o.status === 'Missed')

  // A series-level Missed applies to every week at once, so there is no single
  // week to name and the series is the story. Compared against the stored value
  // so resubmitting an already-missed series does not re-alert either.
  const seriesNewlyMissed = status === 'Missed' && prevWeekly?.status !== 'Missed'

  if (seriesNewlyMissed || newlyMissedWeeks.length) {
    waitUntil(
      (async () => {
        try {
          const leaders = await resolveBookingRecipients(adminSupabase, scopedRow, {
            leadershipOnly: true,
          })
          const contacts = leaders.map(l => l.fullName).filter(Boolean)

          // One alert per missed reservation rather than one per save. Each
          // missed room is its own incident for Operational Affairs to chase,
          // and a single email naming one of several would hide the rest.
          const missed = seriesNewlyMissed
            ? [{ date: start_date, startTime: start_time, endTime: end_time, roomOrTable: room_name }]
            : newlyMissedWeeks.map(o => ({
                date: o.occurrence_date,
                // Null on an occurrence means inherit, so these are the values
                // that actually applied to the week that was missed.
                startTime: o.start_time ?? start_time,
                endTime: o.end_time ?? end_time,
                roomOrTable: o.room_name ?? room_name,
              }))

          for (const m of missed) {
            await sendMissedReservationEmail({
              bodyName,
              date: m.date,
              roomOrTable: m.roomOrTable,
              startTime: m.startTime,
              endTime: m.endTime,
              contacts,
            })
          }
        } catch (e) {
          console.error('Resend email failed:', e)
        }
      })()
    )
  }

  return NextResponse.json({ success: true })
}