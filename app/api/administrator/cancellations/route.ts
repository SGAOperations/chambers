import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { data: cancellations } = await supabase
    .from('cancellation_requests')
    .select(`
      id, scope, status, created_at, cancellation_type, occurrence_id, booking_id,
      bookings(id, type, purpose, bodies(name)),
      users(full_name)
    `)
    .order('created_at', { ascending: false })

  // Enrich with occurrence date (weekly) and reservation code
  // Direct joins are unavailable since occurrence_id no longer has a FK constraint
  const enriched = await Promise.all(
    (cancellations || []).map(async (c) => {
      const bookingType = (c.bookings as unknown as { type: string } | null)?.type
      let occurrence_date: string | null = null
      let reservation_code: string | null = null

      if (c.scope === 'occurrence' && c.occurrence_id) {
        if (bookingType === 'Weekly Room') {
          const { data: occ } = await adminSupabase
            .from('weekly_room_occurrences')
            .select('occurrence_date, reservation_code')
            .eq('id', c.occurrence_id)
            .single()
          occurrence_date = occ?.occurrence_date ?? null
          reservation_code = occ?.reservation_code ?? null
        } else if (bookingType === 'One-Time Room') {
          const { data: session } = await adminSupabase
            .from('one_time_room_bookings')
            .select('reservation_code')
            .eq('id', c.occurrence_id)
            .single()
          reservation_code = session?.reservation_code ?? null
        } else if (bookingType === 'Tabling') {
          const { data: session } = await adminSupabase
            .from('tabling_sessions')
            .select('reservation_code')
            .eq('id', c.occurrence_id)
            .single()
          reservation_code = session?.reservation_code ?? null
        }
      } else {
        // series scope — grab first session's reservation code
        if (bookingType === 'One-Time Room') {
          const { data: session } = await adminSupabase
            .from('one_time_room_bookings')
            .select('reservation_code')
            .eq('booking_id', c.booking_id)
            .limit(1)
            .single()
          reservation_code = session?.reservation_code ?? null
        } else if (bookingType === 'Weekly Room') {
          const { data: wb } = await adminSupabase
            .from('weekly_room_bookings')
            .select('reservation_code')
            .eq('booking_id', c.booking_id)
            .single()
          reservation_code = wb?.reservation_code ?? null
        } else if (bookingType === 'Tabling') {
          const { data: tb } = await adminSupabase
            .from('tabling_bookings')
            .select('reservation_code')
            .eq('booking_id', c.booking_id)
            .single()
          reservation_code = tb?.reservation_code ?? null
        }
      }

      return { ...c, occurrence_date, reservation_code }
    })
  )

  return NextResponse.json({ cancellations: enriched })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { id } = await request.json()

  const { error } = await adminSupabase
    .from('cancellation_requests')
    .update({ status: 'Done' })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}