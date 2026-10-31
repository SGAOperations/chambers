'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { loginUrl } from '@nusgaops/sgauth/urls'
import { useOnlineStatus } from '@/lib/use-online-status'

type LoginState = { is_active: boolean; has_completed_onboarding: boolean }

/**
 * The landing page's sign-in under SGAuth (issue #149), in place of LoginCard.
 *
 * There is no form: the password lives in SGAuth now, and so does "forgot
 * password". Someone who already has an SGAuth session is routed on as before,
 * by the same /api/me/login-state read LoginCard uses. Everyone else gets one
 * link to SGAuth's sign-in, which sends them back here afterwards.
 *
 * The offline banner stays, for the reason it exists (issue #71): Chambers is a
 * PWA, so this page can be a saved copy that looks live when it is not, and a
 * sign-in link that cannot load reads as Chambers being broken.
 */
export default function SgaSignInCard({ sgauthUrl }: { sgauthUrl: string }) {
  const router = useRouter()
  const isOnline = useOnlineStatus()
  const [checking, setChecking] = useState(true)
  const [deactivated, setDeactivated] = useState(false)

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/me/login-state', { cache: 'no-store' })
        if (res.ok) {
          const state = (await res.json()) as LoginState
          if (!state.is_active) {
            setDeactivated(true)
          } else {
            router.push(state.has_completed_onboarding ? '/my-rooms' : '/onboarding')
            return
          }
        }
      } catch {
        // No answer is not "signed out" -- but offering the sign-in link is the
        // harmless outcome either way: SGAuth sends a signed-in visitor
        // straight back.
      }
      setChecking(false)
    }
    check()
  }, [router])

  // Built on click, not on the server: this page is static, and the origin is
  // whichever host the visitor is on. A location change, not router.push --
  // SGAuth is another origin.
  const signIn = () => {
    window.location.href = loginUrl(window.location.origin + '/', { baseUrl: sgauthUrl })
  }

  return (
    <div className="relative bg-[#184073] rounded-2xl shadow-2xl w-full max-w-md p-10">
      <div className="mb-8 text-center">
        <div className="flex items-baseline justify-center gap-2 mb-1">
          <span className="text-[#c8102e] font-bold text-3xl tracking-tight">Chambers</span>
        </div>
        <p className="text-[#93b8d8] text-sm">Northeastern Student Government Association</p>
      </div>

      {!isOnline && (
        <div role="status" className="mb-6 rounded-lg border border-[#c8102e]/40 bg-[#c8102e]/10 px-3 py-2.5">
          <p className="text-xs text-[#f0f6ff] leading-relaxed">
            You&apos;re offline. This is a saved copy of the page — signing in won&apos;t work until your
            connection is back.
          </p>
        </div>
      )}

      {deactivated ? (
        <p className="text-sm text-[#f0f6ff] leading-relaxed text-center">
          Your Chambers access has been deactivated. If you think this is a mistake, contact the Vice President of
          Operational Affairs.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-[#93b8d8] leading-relaxed text-center">
            Chambers now uses your SGA account. If you had a Chambers account, sign in with the same email and
            password.
          </p>
          <button
            onClick={signIn}
            disabled={!isOnline || checking}
            className="w-full bg-[#c8102e] hover:bg-[#a00d24] hover:scale-105 text-white py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50"
          >
            {!isOnline ? 'Offline' : checking ? 'Checking…' : 'Sign in with your SGA account'}
          </button>
        </div>
      )}

      <div className="border-t border-[#1e5080] mt-6 pt-5 flex items-center justify-between">
        <div className="flex gap-3">
          <Link href="/legal#privacy" className="text-xs text-[#6a96bb] hover:text-[#93b8d8] transition">Privacy Policy</Link>
          <Link href="/legal#terms" className="text-xs text-[#6a96bb] hover:text-[#93b8d8] transition">Terms of Service</Link>
          <Link href="/faq" className="text-xs text-[#6a96bb] hover:text-[#93b8d8] transition">FAQ</Link>
        </div>
        <span className="text-xs text-[#6a96bb]">© 2026 NUSGA</span>
      </div>
    </div>
  )
}
