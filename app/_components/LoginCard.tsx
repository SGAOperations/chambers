'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAuthedUser } from '@/lib/auth'
import { useOnlineStatus } from '@/lib/use-online-status'
import {
  OFFLINE_MESSAGE,
  isNetworkError,
  isOffline,
  networkErrorMessage,
  withNetworkRetry,
} from '@/lib/network-error'

export default function LoginCard() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [resetError, setResetError] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  // Distinguishes "still waiting on the server" from "the first attempt did not
  // get out and we are trying again", so the button can say which (issue #71).
  const [retrying, setRetrying] = useState(false)
  const router = useRouter()
  const supabase = createClient()
  const isOnline = useOnlineStatus()

  useEffect(() => {
    const checkAuth = async () => {
      const user = await getAuthedUser(supabase)
      if (!user) return

      const { data: profile, error } = await supabase
        .from('users')
        .select('has_completed_onboarding')
        .eq('id', user.id)
        .single()

      // A failed read is not an answer. `profile?.has_completed_onboarding`
      // being undefined used to route an already-onboarded user to /onboarding
      // whenever this query hiccuped -- the same flaky network behind issue #71
      // was enough to do it. Staying put is the harmless outcome: the user
      // signs in and is routed by handleLogin, which asks again.
      if (error || !profile) return

      router.push(profile.has_completed_onboarding ? '/my-rooms' : '/onboarding')
    }
    checkAuth()
  }, [])

  const handleLogin = async () => {
    // Nothing can leave the machine, and the service worker has already served
    // a login page convincing enough to hide that. Say so, rather than spending
    // a round trip to arrive at "Failed to fetch" (issue #71).
    if (isOffline()) {
      setError(OFFLINE_MESSAGE)
      return
    }

    setLoading(true)
    setRetrying(false)
    setError('')

    const { data, error } = await withNetworkRetry(
      () => supabase.auth.signInWithPassword({ email, password }),
      () => setRetrying(true)
    )
    setRetrying(false)

    if (error) {
      // error.message here is whatever the browser calls a dead socket --
      // "Failed to fetch" in Chrome. Never show that: it reads as a bug in
      // Chambers rather than as "your connection dropped". A real rejection
      // from the server (wrong password, rate limit) is still shown verbatim.
      setError(isNetworkError(error) ? networkErrorMessage() : error.message)
      setLoading(false)
      return
    }

    const { data: profile, error: profileError } = await withNetworkRetry(
      async () =>
        await supabase
          .from('users')
          .select('is_active, has_completed_onboarding, otp_expires_at')
          .eq('id', data.user.id)
          .single()
    )

    // Not being able to read the account is not the same as the account being
    // disabled, and this used to conflate them: a null `profile` fell into the
    // branch below, so one dropped request told the user their account had been
    // deactivated and globally revoked every session they held. The sign-in
    // itself succeeded, so the session is deliberately left alone -- retrying
    // re-runs this read rather than starting over.
    if (profileError || !profile) {
      setError(
        isNetworkError(profileError)
          ? networkErrorMessage()
          : 'We could not load your account. Please try again.'
      )
      setLoading(false)
      return
    }

    if (!profile.is_active) {
      // Global scope kept deliberately here and below: these mean the account
      // may not be used at all, so every session it holds should end. An
      // ordinary sign-out (dashboard-shell) is scoped 'local' instead.
      await supabase.auth.signOut()
      setError('Your account has been deactivated. Please contact an administrator.')
      setLoading(false)
      return
    }

    if (!profile.has_completed_onboarding) {
      if (profile.otp_expires_at && new Date(profile.otp_expires_at) < new Date()) {
        await supabase.auth.signOut()
        setError('Your invitation has expired. Please contact an administrator for a new invite.')
        setLoading(false)
        return
      }
      // Best effort. An unhandled rejection here rejected handleLogin and left
      // the button stuck, disabled, reading "Signing in...". The endpoint only
      // nulls otp_hash/otp_expires_at, so it is safe to reach again later, and
      // the user is authenticated either way.
      try {
        await fetch('/api/onboarding/invalidate-otp', { method: 'POST' })
      } catch {}
      localStorage.removeItem('chambers_last_active')
      router.push('/onboarding')
      return
    }

    localStorage.removeItem('chambers_last_active')
    router.push('/my-rooms')
  }

  const handleResetPassword = async () => {
    if (isOffline()) {
      setResetError(OFFLINE_MESSAGE)
      return
    }

    setResetLoading(true)
    setResetError('')

    const { error } = await withNetworkRetry(() =>
      supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: window.location.origin + '/reset-password',
      })
    )
    setResetLoading(false)

    // Only a network failure is surfaced. Everything else still reports the
    // same "if an account exists" line as before -- naming which addresses
    // failed would confirm which ones are real. Claiming an email was sent when
    // the request never left the browser is a different matter, and is what
    // this stops.
    if (isNetworkError(error)) {
      setResetError(networkErrorMessage())
      return
    }

    setResetSent(true)
  }

  const closeForgot = () => {
    setShowForgot(false)
    setResetSent(false)
    setResetError('')
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

        {/*
          Chambers is a PWA, so this page is served from the service worker's
          cache and looks completely live when it is not. Without this banner an
          offline visitor gets a normal-looking form and an unexplained failure
          on submit -- which is how issue #71 was experienced.
        */}
        {!isOnline && (
          <div
            role="status"
            className="mb-6 rounded-lg border border-[#c8102e]/40 bg-[#c8102e]/10 px-3 py-2.5"
          >
            <p className="text-xs text-[#f0f6ff] leading-relaxed">
              You&apos;re offline. This is a saved copy of the page — signing in won&apos;t
              work until your connection is back.
            </p>
          </div>
        )}

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
            disabled={loading || !isOnline}
            className="w-full bg-[#c8102e] hover:bg-[#a00d24] hover:scale-105 text-white py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50 mt-2"
          >
            {!isOnline ? 'Offline' : loading ? (retrying ? 'Reconnecting…' : 'Signing in...') : 'Sign In'}
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
                {resetError && <p className="text-[#c8102e] text-sm">{resetError}</p>}
                <button
                  onClick={handleResetPassword}
                  disabled={resetLoading || !isOnline}
                  className="w-full bg-[#c8102e] hover:bg-[#a00d24] hover:scale-105 text-white py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50"
                >
                  {!isOnline ? 'Offline' : resetLoading ? 'Sending…' : 'Send Reset Link'}
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
