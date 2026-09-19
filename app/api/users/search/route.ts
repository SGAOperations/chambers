import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/auth'

const adminSupabase = db

export async function GET(request: Request) {
  const supabase = db
  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() ?? ''

  if (q.length < 2) return NextResponse.json([])

  const { data, error } = await adminSupabase
    .from('users')
    .select('id, full_name, email')
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .neq('id', user.id)
    .eq('is_active', true)
    .limit(10)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
