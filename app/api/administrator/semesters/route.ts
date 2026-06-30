import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: semesters, error } = await adminSupabase
    .from('semesters')
    .select('id, name, is_active, created_at')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ semesters: semesters || [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { name } = await request.json()

  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Semester name is required.' }, { status: 400 })
  }

  const { error } = await adminSupabase
    .from('semesters')
    .insert({ name: name.trim() })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { id } = await request.json()

  // Deactivate all semesters
  const { error: deactivateError } = await adminSupabase
    .from('semesters')
    .update({ is_active: false })
    .neq('id', id)

  if (deactivateError) return NextResponse.json({ error: deactivateError.message }, { status: 500 })

  // Activate the selected semester
  const { error: activateError } = await adminSupabase
    .from('semesters')
    .update({ is_active: true })
    .eq('id', id)

  if (activateError) return NextResponse.json({ error: activateError.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const semesterManagers = [
    'Vice President of Operational Affairs',
    'Executive Vice President',
    'Information Manager',
  ]
  if (!semesterManagers.includes(user.app_metadata?.admin_role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { id } = await request.json()

  // Get all booking IDs for this semester
  const { data: bookings } = await adminSupabase
    .from('bookings')
    .select('id, type')
    .eq('semester_id', id)

  if (bookings?.length) {
    const bookingIds = bookings.map((b: { id: string }) => b.id)

    // Delete child records for each booking type before deleting parent bookings
    // One-time room bookings
    await adminSupabase
      .from('one_time_room_bookings')
      .delete()
      .in('booking_id', bookingIds)

    // Weekly room occurrences (grandchild — must go before weekly_room_bookings)
    const { data: weeklyBookings } = await adminSupabase
      .from('weekly_room_bookings')
      .select('id')
      .in('booking_id', bookingIds)

    if (weeklyBookings?.length) {
      const weeklyIds = weeklyBookings.map((w: { id: string }) => w.id)
      await adminSupabase
        .from('weekly_room_occurrences')
        .delete()
        .in('weekly_booking_id', weeklyIds)
    }

    await adminSupabase
      .from('weekly_room_bookings')
      .delete()
      .in('booking_id', bookingIds)

    // Tabling sessions (grandchild — must go before tabling_bookings)
    const { data: tablingBookings } = await adminSupabase
      .from('tabling_bookings')
      .select('id')
      .in('booking_id', bookingIds)

    if (tablingBookings?.length) {
      const tablingIds = tablingBookings.map((t: { id: string }) => t.id)
      await adminSupabase
        .from('tabling_sessions')
        .delete()
        .in('tabling_booking_id', tablingIds)
    }

    await adminSupabase
      .from('tabling_bookings')
      .delete()
      .in('booking_id', bookingIds)

    // Audit logs and alerts referencing these bookings
    await adminSupabase
      .from('user_alerts')
      .delete()
      .in('booking_id', bookingIds)

    await adminSupabase
      .from('audit_logs')
      .delete()
      .in('booking_id', bookingIds)

    // Delete parent bookings
    await adminSupabase
      .from('bookings')
      .delete()
      .in('id', bookingIds)
  }

  // Delete the semester
  const { error } = await adminSupabase
    .from('semesters')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
