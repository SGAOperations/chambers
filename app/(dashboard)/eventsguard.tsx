'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function EventsGuard({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const checkAccess = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || (!user.app_metadata?.is_admin && !user.app_metadata?.iems_role)) {
        router.push('/my-rooms')
      } else {
        setChecking(false)
      }
    }
    checkAccess()
  }, [])

  if (checking) return null

  return <>{children}</>
}
