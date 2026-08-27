'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getAuthedUser } from '@/lib/auth'
import { loadIdentity, clearIdentity } from '@/lib/identity'
import { PageSkeleton } from '@/app/_components/skeleton'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true)
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const checkAuth = async () => {
      const user = await getAuthedUser(supabase)
      if (!user) {
        router.push('/')
        return
      }

      const identity = await loadIdentity(supabase, user.id)

      if (!identity?.isActive) {
        clearIdentity()
        await supabase.auth.signOut()
        router.push('/')
        return
      }

      if (!identity.hasCompletedOnboarding) {
        router.push('/onboarding')
        return
      }

      setChecking(false)
    }
    checkAuth()
  }, [])

  // The page underneath is mounted (but visually hidden) during the check so its
  // own data fetch -- e.g. /api/my-rooms, which authenticates itself server-side --
  // runs in parallel with this guard instead of waiting for it. The guard still
  // controls what the user *sees*: the skeleton until the check passes, and a
  // redirect (never revealing `children`) if it fails. Kept in a stable wrapper so
  // toggling visibility doesn't remount the subtree and refire its effects.
  // display:contents so the wrapper adds no box of its own once revealed -- the
  // page renders exactly as if it were a direct child of <main>.
  return (
    <>
      {checking && <PageSkeleton />}
      <div style={{ display: checking ? 'none' : 'contents' }}>{children}</div>
    </>
  )
}
