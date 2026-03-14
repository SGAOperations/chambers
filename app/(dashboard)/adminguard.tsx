'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const checkAdmin = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !user.app_metadata?.is_admin) {
        router.push('/my-rooms')
      } else {
        setChecking(false)
      }
    }
    checkAdmin()
  }, [])

  if (checking) return null

  return <>{children}</>
}