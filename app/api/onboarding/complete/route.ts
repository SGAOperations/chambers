import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/auth'

const adminSupabase = db

export async function PATCH() {
  const supabase = db

  const user = await getAuthedUser(supabase)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await adminSupabase
    .from('users')
    .update({ has_completed_onboarding: true })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
