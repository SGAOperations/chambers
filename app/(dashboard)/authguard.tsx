'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getAuthedUser } from '@/lib/auth'
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

      const { data: profile } = await supabase
        .from('users')
        .select('is_active, has_completed_onboarding')
        .eq('id', user.id)
        .single()

      if (!profile?.is_active) {
        await supabase.auth.signOut()
        router.push('/')
        return
      }

      if (!profile?.has_completed_onboarding) {
        router.push('/onboarding')
        return
      }

      setChecking(false)
    }
    checkAuth()
  }, [])

  if (checking) return <PageSkeleton />

  return <>{children}</>
}