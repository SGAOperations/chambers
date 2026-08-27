import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The per-user facts the dashboard shell needs on every load: the active/onboarding
 * gate (AuthGuard) and the sidebar's name + Leadership flag (DashboardLayout).
 *
 * Both used to fetch these independently -- AuthGuard read `users`, the layout read
 * `users` again plus `board_memberships` -- so a cold load ran the `users` query
 * two or three times over. This module runs it once and hands the same in-flight
 * promise to every caller for the session.
 */
export interface Identity {
  userId: string
  isActive: boolean
  hasCompletedOnboarding: boolean
  fullName: string | null
  isLeadership: boolean
}

let cache: { userId: string; promise: Promise<Identity | null> } | null = null

async function fetchIdentity(
  supabase: SupabaseClient,
  userId: string
): Promise<Identity | null> {
  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase
      .from('users')
      .select('is_active, has_completed_onboarding, full_name')
      .eq('id', userId)
      .single(),
    supabase.from('board_memberships').select('role').eq('user_id', userId),
  ])

  if (!profile) return null

  return {
    userId,
    isActive: !!profile.is_active,
    hasCompletedOnboarding: !!profile.has_completed_onboarding,
    fullName: profile.full_name ?? null,
    isLeadership: (memberships ?? []).some(m => m.role === 'Leadership'),
  }
}

/**
 * Resolves the caller's Identity, reusing an in-flight or completed fetch for the
 * same user. Call clearIdentity() on sign-out so the next session starts clean.
 */
export function loadIdentity(
  supabase: SupabaseClient,
  userId: string
): Promise<Identity | null> {
  if (cache?.userId === userId) return cache.promise
  const promise = fetchIdentity(supabase, userId)
  cache = { userId, promise }
  // A failed fetch shouldn't be cached forever -- drop it so a retry can happen.
  promise.catch(() => {
    if (cache?.promise === promise) cache = null
  })
  return promise
}

export function clearIdentity() {
  cache = null
}
