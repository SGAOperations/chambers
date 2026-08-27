import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The active semester id, cached in the serverless instance's memory.
 *
 * `semesters.select('id').eq('is_active', true)` runs on nearly every dashboard
 * request (my-rooms, the login facts, counts-adjacent paths). It changes once a
 * term, so a warm instance can answer from memory instead of paying the round
 * trip every time. A cold instance still hits the DB once.
 */
const TTL_MS = 5 * 60_000

let cache: { id: string; at: number } | null = null

export async function getActiveSemesterId(
  supabase: SupabaseClient
): Promise<string | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.id

  const { data } = await supabase
    .from('semesters')
    .select('id')
    .eq('is_active', true)
    .single()

  if (data?.id) {
    cache = { id: data.id, at: Date.now() }
    return data.id
  }
  return null
}
