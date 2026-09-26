import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/auth'

/**
 * The NUSSO booking minimums the Browse/Book tab needs to restrict the date
 * picker in Book mode. Readable by any signed-in user (leadership book too, and
 * they are not Management), unlike /api/administrator/settings which manages them.
 *
 * select('*') so this still responds before the 0007 migration adds the columns;
 * missing values fall back to 0 (only past dates blocked).
 */
export async function GET() {
  const supabase = db

  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase.from('app_settings').select('*').eq('id', 1).single()

  return NextResponse.json({
    minDaysRoom: (data as Record<string, number> | null)?.nusso_min_days_advance_room ?? 0,
    minDaysTabling: (data as Record<string, number> | null)?.nusso_min_days_advance_tabling ?? 0,
  })
}
