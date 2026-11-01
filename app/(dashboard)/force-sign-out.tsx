'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

/**
 * What a deactivated account sees in place of the dashboard.
 *
 * Under Better Auth: signs the caller out, then sends them to the login page.
 * Deactivation is detected on the server, and deactivating someone already ends
 * every session they hold there (lib/auth-admin.ts). This clears the cookie in
 * this browser too. A bare redirect to '/' would bounce straight back here,
 * because LoginCard forwards anyone holding a session to /my-rooms. So the
 * sign-out has to happen client-side, and this is the smallest component that
 * can do it.
 *
 * Under SGAuth (`sgauthSignOutHref` set): says so and stops. The SGAuth session
 * belongs to every SGA tool, so ending it here would sign the person out of
 * tools they may still use; only their Chambers access is off. The sign-out
 * link is there if they want it.
 */
export default function ForceSignOut({ sgauthSignOutHref }: { sgauthSignOutHref: string | null }) {
  const router = useRouter()

  useEffect(() => {
    if (sgauthSignOutHref) return
    const signOut = async () => {
      localStorage.removeItem('chambers_last_active')
      // Failure is fine: the session is already gone server-side, and the login
      // page will not route a user whose account is deactivated.
      await authClient.signOut().catch(() => {})
      router.replace('/')
    }
    signOut()
  }, [router, sgauthSignOutHref])

  if (!sgauthSignOutHref) return null

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#112244] via-[#0a1628] to-[#060e1a] flex items-center justify-center px-4">
      <div className="bg-[#184073] rounded-2xl shadow-2xl w-full max-w-md p-10 space-y-5 text-center">
        <span className="text-[#c8102e] font-bold text-3xl tracking-tight">Chambers</span>
        <p className="text-[#f0f6ff] text-sm leading-relaxed">
          Your Chambers access has been deactivated. If you think this is a mistake, contact the Vice President of
          Operational Affairs.
        </p>
        <a href={sgauthSignOutHref} className="inline-block text-xs text-[#6a96bb] hover:text-[#93b8d8] transition">
          Sign out of all SGA tools
        </a>
      </div>
    </div>
  )
}
