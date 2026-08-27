import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Legacy advance-notice knobs.
const ADVANCE_KEYS = [
  'min_days_advance_room',
  'min_days_advance_tabling',
  'min_hours_advance_spaces',
] as const

// Pending-action thresholds (issue #38). Every value is a non-negative integer
// number of days (pa_event_trigger_weeks is weeks).
const PA_KEYS = [
  'pa_warning_lead_days',
  'pa_event_trigger_months',
  'pa_request_room_danger_start',
  'pa_request_room_danger_end',
  'pa_request_tabling_danger_start',
  'pa_request_tabling_danger_end',
  'pa_revision_danger_start',
  'pa_revision_danger_end',
  'pa_cancellation_regular_danger_days',
  'pa_cancellation_event_danger_start',
  'pa_cancellation_event_danger_end',
  'pa_event_mgmt_danger_start',
  'pa_event_mgmt_danger_end',
  'pa_event_engage_danger_start',
  'pa_event_engage_danger_end',
] as const

// Pairs where the "start" (far edge) must not be less than the "end" (near edge).
const RANGE_PAIRS: [string, string][] = [
  ['pa_request_room_danger_start', 'pa_request_room_danger_end'],
  ['pa_request_tabling_danger_start', 'pa_request_tabling_danger_end'],
  ['pa_revision_danger_start', 'pa_revision_danger_end'],
  ['pa_cancellation_event_danger_start', 'pa_cancellation_event_danger_end'],
  ['pa_event_mgmt_danger_start', 'pa_event_mgmt_danger_end'],
  ['pa_event_engage_danger_start', 'pa_event_engage_danger_end'],
]

const ALL_KEYS = [...ADVANCE_KEYS, ...PA_KEYS]

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  // select('*') so a database that hasn't run the pending_action_thresholds
  // migration yet still responds; the client fills missing pa_* with defaults.
  const { data, error } = await adminSupabase
    .from('app_settings')
    .select('*')
    .eq('id', 1)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const body = (await request.json()) as Record<string, unknown>

  const patch: Record<string, number> = {}
  for (const key of ALL_KEYS) {
    if (body[key] === undefined) continue
    const v = body[key]
    if (!Number.isInteger(v) || (v as number) < 0) {
      return NextResponse.json(
        { error: `${key} must be a non-negative integer.` },
        { status: 400 }
      )
    }
    patch[key] = v as number
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid settings provided.' }, { status: 400 })
  }

  for (const [startKey, endKey] of RANGE_PAIRS) {
    const start = patch[startKey]
    const end = patch[endKey]
    if (start !== undefined && end !== undefined && start < end) {
      return NextResponse.json(
        { error: `${startKey} (far edge) cannot be less than ${endKey} (near edge).` },
        { status: 400 }
      )
    }
  }

  const { error } = await adminSupabase.from('app_settings').update(patch).eq('id', 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
