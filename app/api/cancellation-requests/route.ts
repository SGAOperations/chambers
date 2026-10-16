import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { requireBookingManager } from '@/lib/booking-scope'
import { fileCancellationRequest } from '@/lib/cancellation-request'

const adminSupabase = db

export async function POST(request: Request) {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { booking_id, occurrence_id, scope, cancellation_type = 'Cancellation' } = await request.json()

  // Leadership of any body the booking is scoped to may request a cancellation -- for a divisional
  // or multi booking that is wider than the owning body.
  const guard = await requireBookingManager(supabase, adminSupabase, user, booking_id)
  if (guard.error) return guard.error

  // The writes themselves live in lib/cancellation-request.ts, shared with
  // /chambers-cancel in Slack so both file exactly the same request.
  const { error } = await fileCancellationRequest(adminSupabase, {
    bookingId: booking_id,
    bookingType: guard.row.type,
    occurrenceId: occurrence_id || null,
    scope,
    cancellationType: cancellation_type,
    requestedBy: user.id,
  })

  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json({ success: true })
}
