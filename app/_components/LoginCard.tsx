'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAuthedUser } from '@/lib/auth'

export default function LoginCard() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const checkAuth = async () => {
      const user = await getAuthedUser(supabase)
      if (user) {
        const { data: profile } = await supabase
          .from('users')
          .select('has_completed_onboarding')
          .eq('id', user.id)
          .single()
        router.push(profile?.has_completed_onboarding ? '/my-rooms' : '/onboarding')
      }
    }
    checkAuth()
  }, [])

  const handleLogin = async () => {
    setLoading(true)
    setError('')

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from('users')
      .select('is_active, has_completed_onboarding, otp_expires_at')
      .eq('id', data.user.id)
      .single()

    if (!profile?.is_active) {
      // Global scope kept deliberately here and below: these mean the account
      // may not be used at all, so every session it holds should end. An
      // ordinary sign-out (dashboard-shell) is scoped 'local' instead.
      await supabase.auth.signOut()
      setError('Your account has been deactivated. Please contact an administrator.')
      setLoading(false)
      return
    }

    if (!profile?.has_completed_onboarding) {
      if (profile?.otp_expires_at && new Date(profile.otp_expires_at) < new Date()) {
        await supabase.auth.signOut()
        setError('Your invitation has expired. Please contact an administrator for a new invite.')
        setLoading(false)
        return
      }
      await fetch('/api/onboarding/invalidate-otp', { method: 'POST' })
      localStorage.removeItem('chambers_last_active')
      router.push('/onboarding')
      return
    }

    localStorage.removeItem('chambers_last_active')
    router.push('/my-rooms')
  }

  const handleResetPassword = async () => {
    setResetLoading(true)
    await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: window.location.origin + '/reset-password',
    })
    setResetSent(true)
    setResetLoading(false)
  }

  const closeForgot = () => {
    setShowForgot(false)
    setResetSent(false)
    setResetEmail('')
  }

  return (
    <>
      <div className="relative bg-[#184073] rounded-2xl shadow-2xl w-full max-w-md p-10">
        {/* Brand */}
        <div className="mb-8 text-center">
          <div className="flex items-baseline justify-center gap-2 mb-1">
            <span className="text-[#c8102e] font-bold text-3xl tracking-tight">Chambers</span>
          </div>
          <p className="text-[#93b8d8] text-sm">Northeastern Student Government Association</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#93b8d8] mb-1.5">Email</label>
            <input
              type="email"
              placeholder="you@northeastern.edu"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              className="w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#93b8d8] mb-1.5">Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              className="w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="text-xs text-[#6a96bb] hover:text-[#93b8d8] transition cursor-pointer"
            >
              Forgot password?
            </button>
          </div>
          <div className="flex justify-end">
            <Link href="/signup" className="text-xs text-[#6a96bb] hover:text-[#93b8d8] transition">
              I&apos;m New to Chambers — Sign Up
            </Link>
          </div>
          {error && <p className="text-[#c8102e] text-sm">{error}</p>}
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-[#c8102e] hover:bg-[#a00d24] hover:scale-105 text-white py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50 mt-2"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </div>

        <div className="border-t border-[#1e5080] mt-6 pt-5 flex items-center justify-between">
          <div className="flex gap-3">
            <Link href="/legal#privacy" className="text-xs text-[#6a96bb] hover:text-[#93b8d8] transition">Privacy Policy</Link>
            <Link href="/legal#terms" className="text-xs text-[#6a96bb] hover:text-[#93b8d8] transition">Terms of Service</Link>
            <Link href="/faq" className="text-xs text-[#6a96bb] hover:text-[#93b8d8] transition">FAQ</Link>
          </div>
          <span className="text-xs text-[#6a96bb]">© 2026 NUSGA</span>
        </div>
      </div>

      {showForgot && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-[#184073] rounded-2xl shadow-2xl w-full max-w-sm p-8 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#f0f6ff]">Reset Password</h2>
              <button
                onClick={closeForgot}
                className="text-[#6a96bb] hover:text-[#f0f6ff] text-lg leading-none transition-colors"
              >
                ✕
              </button>
            </div>

            {resetSent ? (
              <p className="text-sm text-[#93b8d8]">
                If an account with your email exists, a password reset link has been sent.
              </p>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-[#93b8d8] mb-1.5">Email</label>
                  <input
                    type="email"
                    placeholder="you@northeastern.edu"
                    value={resetEmail}
                    onChange={e => setResetEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleResetPassword()}
                    className="w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
                  />
                </div>
                <button
                  onClick={handleResetPassword}
                  disabled={resetLoading}
                  className="w-full bg-[#c8102e] hover:bg-[#a00d24] hover:scale-105 text-white py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50"
                >
                  {resetLoading ? 'Sending…' : 'Send Reset Link'}
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
