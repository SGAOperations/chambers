import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendSpaceBookingCancelledEmail } from '@/lib/emails/space-booking-cancelled'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: booking, error: fetchError } = await adminSupabase
    .from('space_bookings')
    .select('*, spaces(name)')
    .eq('id', id)
    .single()

  if (fetchError || !booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  // Only creator or admin can cancel
  const isAdmin = !!user.app_metadata?.is_admin
  if (booking.creator_id !== user.id && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error: deleteError } = await adminSupabase.from('space_bookings').delete().eq('id', id)
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

  // Send cancellation email to creator + attendees
  try {
    const allUserIds: string[] = [booking.creator_id, ...(booking.attendee_ids ?? [])]
    const { data: emailUsers } = await adminSupabase
      .from('users')
      .select('email')
      .in('id', allUserIds)
    const emails = (emailUsers ?? []).map((u: { email: string }) => u.email).filter(Boolean)
    const spaceName = (booking.spaces as { name: string } | null)?.name ?? 'SGA Space'
    await sendSpaceBookingCancelledEmail({
      title: booking.title,
      spaceName,
      startTime: booking.start_time,
      endTime: booking.end_time,
      recipients: emails,
    })
  } catch (e) {
    console.error('Space booking cancellation email failed:', e)
  }

  return NextResponse.json({ success: true })
}
