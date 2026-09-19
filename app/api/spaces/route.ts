import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/auth'

const adminSupabase = db

export async function GET() {
  const supabase = db
  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await adminSupabase
    .from('spaces')
    .select('*')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
