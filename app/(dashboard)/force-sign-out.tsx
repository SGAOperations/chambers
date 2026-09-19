'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

/**
 * Signs the caller out, then sends them to the login page.
 *
 * Deactivation is detected on the server, and deactivating someone already ends
 * every session they hold there (lib/auth-admin.ts). This clears the cookie in
 * this browser too. A bare redirect to '/' would bounce
 * straight back here, because LoginCard forwards anyone holding a session to
 * /my-rooms. So the sign-out has to happen client-side, and this is the smallest
 * component that can do it.
 */
export default function ForceSignOut() {
  const router = useRouter()

  useEffect(() => {
    const signOut = async () => {
      localStorage.removeItem('chambers_last_active')
      // Failure is fine: the session is already gone server-side, and the login
      // page will not route a user whose account is deactivated.
      await authClient.signOut().catch(() => {})
      router.replace('/')
    }
    signOut()
  }, [router])

  return null
}
