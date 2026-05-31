import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')

  if (!key || key !== process.env.DISPLAY_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { spaceId } = await params

  // Use the client-supplied local date (YYYY-MM-DD) so "today" matches the
  // display's clock rather than the server's UTC clock.
  const dateParam = searchParams.get('date')
  const [year, month, day] = dateParam
    ? dateParam.split('-').map(Number)
    : (() => { const n = new Date(); return [n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate()] })()
  const todayStart = new Date(Date.UTC(year, month - 1, day))
  const todayEnd = new Date(Date.UTC(year, month - 1, day + 1))

  const [spaceResult, bookingsResult, blackoutsResult] = await Promise.all([
    adminSupabase
      .from('spaces')
      .select('id, name, capacity')
      .eq('id', spaceId)
      .single(),
    adminSupabase
      .from('space_bookings')
      .select('id, title, start_time, end_time, creator_id, attendee_ids')
      .eq('space_id', spaceId)
      .gte('start_time', todayStart.toISOString())
      .lt('start_time', todayEnd.toISOString())
      .order('start_time', { ascending: true }),
    adminSupabase
      .from('space_blackouts')
      .select('id, start_time, end_time')
      .or(`space_id.eq.${spaceId},space_id.is.null`)
      .lt('start_time', todayEnd.toISOString())
      .gt('end_time', todayStart.toISOString())
      .order('start_time', { ascending: true }),
  ])

  if (spaceResult.error || !spaceResult.data) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  const rawBookings = bookingsResult.data ?? []

  const allUserIds = [
    ...new Set([
      ...rawBookings.map((b) => b.creator_id).filter(Boolean),
      ...rawBookings.flatMap((b) => b.attendee_ids ?? []),
    ]),
  ]

  let userMap: Record<string, string> = {}
  if (allUserIds.length > 0) {
    const { data: users } = await adminSupabase
      .from('users')
      .select('id, full_name')
      .in('id', allUserIds)
    userMap = Object.fromEntries((users ?? []).map((u) => [u.id, u.full_name]))
  }

  return NextResponse.json({
    space: spaceResult.data,
    blackouts: (blackoutsResult.data ?? []).map((b) => ({
      id: b.id,
      start_time: b.start_time,
      end_time: b.end_time,
    })),
    bookings: rawBookings.map((b) => ({
      id: b.id,
      title: b.title,
      start_time: b.start_time,
      end_time: b.end_time,
      creator_name: userMap[b.creator_id] ?? null,
      attendee_names: (b.attendee_ids ?? []).map((id: string) => userMap[id]).filter(Boolean),
    })),
  })
}
