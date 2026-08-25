'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getAuthedUser } from '@/lib/auth'
import { PageSkeleton } from '@/app/_components/skeleton'

export default function EventsGuard({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true)
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const checkAccess = async () => {
      const user = await getAuthedUser(supabase)
      if (!user || (!user.app_metadata?.is_admin && !user.app_metadata?.iems_role)) {
        router.push('/my-rooms')
      } else {
        setChecking(false)
      }
    }
    checkAccess()
  }, [])

  if (checking) return <PageSkeleton />

  return <>{children}</>
}
