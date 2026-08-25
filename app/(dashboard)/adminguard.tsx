'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getAuthedUser } from '@/lib/auth'
import { PageSkeleton } from '@/app/_components/skeleton'

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true)
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const checkAdmin = async () => {
      const user = await getAuthedUser(supabase)
      if (!user || !user.app_metadata?.is_admin) {
        router.push('/my-rooms')
      } else {
        setChecking(false)
      }
    }
    checkAdmin()
  }, [])

  if (checking) return <PageSkeleton />

  return <>{children}</>
}