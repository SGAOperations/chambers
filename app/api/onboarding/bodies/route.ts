import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: bodies } = await supabase
    .from('bodies')
    .select('id, name, division, body_open')
    .eq('is_active', true)
    .neq('division', 'Non-Divisional')
    .order('name', { ascending: true })

  return NextResponse.json({ bodies: bodies || [] })
}
