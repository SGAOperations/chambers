'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Signs the caller out, then sends them to the login page.
 *
 * Deactivation is detected on the server, but the server cannot clear a GoTrue
 * session that lives in the browser's storage. A bare redirect to '/' would bounce
 * straight back here, because LoginCard forwards anyone holding a session to
 * /my-rooms. So the sign-out has to happen client-side, and this is the smallest
 * component that can do it.
 */
export default function ForceSignOut() {
  const router = useRouter()

  useEffect(() => {
    const signOut = async () => {
      localStorage.removeItem('chambers_last_active')
      // Global scope on purpose, unlike the sign-outs in dashboard-shell. This
      // one runs because the account was deactivated, so every session it holds
      // anywhere should end -- not just the one in this browser.
      await createClient().auth.signOut()
      router.replace('/')
    }
    signOut()
  }, [router])

  return null
}
