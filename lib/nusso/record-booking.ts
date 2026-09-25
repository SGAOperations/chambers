import type { Db } from '@/lib/db/data-api'
import type { AuthedUser } from '@/lib/auth-types'
import { syncBookingBodies, type BookingScope, type Division } from '@/lib/booking-scope'
import { insertAuditRows } from '@/lib/audit'

/**
 * Records a successful NUSSO reservation as a Chambers booking so it shows up in
 * My Rooms with its EMS reservation code attached.
 *
 * A NUSSO reservation maps onto Chambers' existing room-booking model:
 *   - a `bookings` parent (type One-Time Room or Tabling), scoped to a body and
 *     the active semester, exactly like an admin-created booking;
 *   - the child session row (one_time_room_bookings, or tabling_bookings +
 *     tabling_sessions) carrying the room/time and `reservation_code` = the EMS
 *     reservation id, status 'Reserved'.
 * My Rooms reads those tables directly, so nothing else is needed to surface it.
 *
 * Called AFTER the EMS reservation succeeds. If it throws, the caller keeps the
 * EMS reservation and reports that it could not be recorded, rather than losing
 * the booking.
 */
export interface ChambersScopeSelection {
  scope: BookingScope
  body_id: string
  division: Division | null
  body_ids: string[]
}

export interface RecordBookingInput {
  type: 'One-Time Room' | 'Tabling'
  purpose: string
  semesterId: string
  selection: ChambersScopeSelection
  creatorRole: string | null
  session: {
    roomName: string
    date: string // YYYY-MM-DD
    startTime: string // HH:mm
    endTime: string // HH:mm
    reservationCode: string
  }
}

export async function recordChambersBooking(
  supabase: Db,
  user: AuthedUser,
  input: RecordBookingInput
): Promise<string> {
  const { selection, session, type } = input

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .insert({
      body_id: selection.body_id,
      scope: selection.scope,
      division: selection.division,
      purpose: input.purpose,
      type,
      created_by: user.id,
      creator_role: input.creatorRole,
      semester_id: input.semesterId,
    })
    .select()
    .single()

  if (bookingError || !booking) {
    throw new Error(bookingError?.message ?? 'Failed to create the Chambers booking.')
  }

  const { error: bodiesError } = await syncBookingBodies(
    supabase, booking.id, selection.scope, selection.body_ids
  )
  if (bodiesError) throw new Error(bodiesError)

  if (type === 'One-Time Room') {
    const { error } = await supabase.from('one_time_room_bookings').insert({
      booking_id: booking.id,
      room_name: session.roomName || null,
      booking_date: session.date,
      start_time: session.startTime,
      end_time: session.endTime,
      meeting_time: null,
      reservation_code: session.reservationCode || null,
      status: 'Reserved',
    })
    if (error) throw new Error(error.message)
  } else {
    const { data: tabling, error: tablingError } = await supabase
      .from('tabling_bookings')
      .insert({ booking_id: booking.id, reservation_code: session.reservationCode || null })
      .select()
      .single()
    if (tablingError || !tabling) {
      throw new Error(tablingError?.message ?? 'Failed to create the tabling booking.')
    }
    const { error: sessionError } = await supabase.from('tabling_sessions').insert({
      tabling_booking_id: tabling.id,
      location: session.roomName || 'NUSSO',
      session_date: session.date,
      start_time: session.startTime,
      end_time: session.endTime,
      meeting_time: null,
      reservation_code: session.reservationCode || null,
      status: 'Reserved',
    })
    if (sessionError) throw new Error(sessionError.message)
  }

  // Best-effort audit trail, matching the admin create flow.
  await insertAuditRows(supabase, [{
    booking_id: booking.id,
    admin_id: user.id,
    new_status: 'Reserved',
    target: 'booking',
    target_date: null,
    action: 'created',
    changes: null,
  }])

  return booking.id
}
