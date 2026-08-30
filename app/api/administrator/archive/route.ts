import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { isManagementRole } from '@/lib/admin-roles'

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

  // Management-page endpoint: being an admin is not enough (#64).
  if (!isManagementRole(user.app_metadata?.admin_role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  // Fetch all semesters
  const { data: semesters } = await adminSupabase
    .from('semesters')
    .select('id, name, is_active, created_at')
    .order('created_at', { ascending: false })

  const semesterList = semesters || []

  // Build groups: one per semester + one for unassigned
  const groups = await Promise.all(
    semesterList.map(async (sem: { id: string; name: string; is_active: boolean; created_at: string }) => {
      const [{ data: oneTime }, { data: weekly }, { data: tabling }] = await Promise.all([
        adminSupabase
          .from('bookings')
          .select(`
            id, purpose, body_id,
            bodies(name),
            creator_role,
            one_time_room_bookings(id, room_name, booking_date, start_time, end_time, status, reservation_code)
          `)
          .eq('type', 'One-Time Room')
          .eq('semester_id', sem.id)
          .order('created_at', { ascending: false }),

        adminSupabase
          .from('bookings')
          .select(`
            id, purpose, body_id,
            bodies(name),
            creator_role,
            weekly_room_bookings(id, room_name, start_date, end_date, start_time, end_time, status, reservation_code,
              weekly_room_occurrences(id, occurrence_date, room_name, start_time, end_time, status, reservation_code, senate_type)
            )
          `)
          .eq('type', 'Weekly Room')
          .eq('semester_id', sem.id)
          .order('created_at', { ascending: false }),

        adminSupabase
          .from('bookings')
          .select(`
            id, purpose, body_id,
            bodies(name),
            creator_role,
            tabling_bookings(id, reservation_code,
              tabling_sessions(location, session_date, start_time, end_time, status, reservation_code)
            )
          `)
          .eq('type', 'Tabling')
          .eq('semester_id', sem.id)
          .order('created_at', { ascending: false }),
      ])

      return {
        semester: sem,
        oneTime: oneTime || [],
        weekly: weekly || [],
        tabling: tabling || [],
      }
    })
  )

  // Fetch unassigned bookings (no semester_id)
  const [{ data: unassignedOneTime }, { data: unassignedWeekly }, { data: unassignedTabling }] = await Promise.all([
    adminSupabase
      .from('bookings')
      .select(`
        id, purpose, body_id,
        bodies(name),
        creator_role,
        one_time_room_bookings(id, room_name, booking_date, start_time, end_time, status, reservation_code)
      `)
      .eq('type', 'One-Time Room')
      .is('semester_id', null)
      .order('created_at', { ascending: false }),

    adminSupabase
      .from('bookings')
      .select(`
        id, purpose, body_id,
        bodies(name),
        creator_role,
        weekly_room_bookings(id, room_name, start_date, end_date, start_time, end_time, status, reservation_code,
          weekly_room_occurrences(id, occurrence_date, room_name, start_time, end_time, status, reservation_code, senate_type)
        )
      `)
      .eq('type', 'Weekly Room')
      .is('semester_id', null)
      .order('created_at', { ascending: false }),

    adminSupabase
      .from('bookings')
      .select(`
        id, purpose, body_id,
        bodies(name),
        creator_role,
        tabling_bookings(id, reservation_code,
          tabling_sessions(location, session_date, start_time, end_time, status, reservation_code)
        )
      `)
      .eq('type', 'Tabling')
      .is('semester_id', null)
      .order('created_at', { ascending: false }),
  ])

  const hasUnassigned =
    (unassignedOneTime?.length || 0) > 0 ||
    (unassignedWeekly?.length || 0) > 0 ||
    (unassignedTabling?.length || 0) > 0

  if (hasUnassigned) {
    groups.push({
      semester: { id: '__unassigned__', name: 'Unassigned', is_active: false, created_at: '' },
      oneTime: unassignedOneTime || [],
      weekly: unassignedWeekly || [],
      tabling: unassignedTabling || [],
    })
  }

  return NextResponse.json({ groups })
}
