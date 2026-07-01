'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const [step, setStep] = useState<1 | 2>(1)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const router = useRouter()
  const supabase = createClient()

  const inputClass =
    'w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition'
  const btnClass =
    'w-full bg-[#c8102e] hover:bg-[#a00d24] hover:scale-105 text-white py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50 mt-2'

  const handleRequestCode = async () => {
    setError('')
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Please enter your email address.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address.')
      return
    }
    if (!trimmed.toLowerCase().endsWith('@northeastern.edu')) {
      setError('Signup is restricted to @northeastern.edu email addresses.')
      return
    }
    setSubmitting(true)
    const res = await fetch('/api/signup/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: trimmed }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Something went wrong.')
      return
    }
    setStep(2)
  }

  const handleVerify = async () => {
    setError('')
    const trimmed = otp.trim()
    if (!trimmed) {
      setError('Please enter the code from your email.')
      return
    }
    setSubmitting(true)
    const res = await fetch('/api/signup/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), otp: trimmed }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Something went wrong.')
      return
    }
    const { email: userEmail, temp_password } = await res.json()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: userEmail, password: temp_password })
    if (signInError) {
      setError(signInError.message)
      return
    }
    router.push('/onboarding')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#112244] via-[#0a1628] to-[#060e1a] flex items-center justify-center px-4 relative">
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

      <div className="bg-[#184073] rounded-2xl shadow-2xl w-full max-w-md p-10 space-y-6 relative z-10">
        {/* Brand */}
        <div className="text-center">
          <span className="text-[#c8102e] font-bold text-3xl tracking-tight">Chambers</span>
          <p className="text-[#93b8d8] text-xs mt-1">Northeastern Student Government Association</p>
        </div>

        {/* Step 1 — Request code */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-[#f0f6ff] font-semibold text-lg mb-1">Create an account</h2>
              <p className="text-[#93b8d8] text-sm mb-4">
                Enter your email address and we&apos;ll send you a code to verify your identity.
              </p>
              <label className="block text-xs font-medium text-[#93b8d8] mb-1.5">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !submitting && handleRequestCode()}
                placeholder="you@northeastern.edu"
                className={inputClass}
                autoFocus
              />
            </div>
            {error && <p className="text-[#c8102e] text-sm">{error}</p>}
            <button onClick={handleRequestCode} disabled={submitting} className={btnClass}>
              {submitting ? 'Sending…' : 'Send Code'}
            </button>
          </div>
        )}

        {/* Step 2 — Enter code */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-[#f0f6ff] font-semibold text-lg mb-1">Check your email</h2>
              <p className="text-[#93b8d8] text-sm mb-4">
                We sent a code to <span className="text-[#f0f6ff] font-medium">{email.trim()}</span>. Enter it below to continue.
              </p>
              <label className="block text-xs font-medium text-[#93b8d8] mb-1.5">Verification Code</label>
              <input
                type="text"
                value={otp}
                onChange={e => setOtp(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !submitting && handleVerify()}
                placeholder="Enter your code"
                className={inputClass}
                autoFocus
                autoComplete="one-time-code"
              />
            </div>
            {error && <p className="text-[#c8102e] text-sm">{error}</p>}
            <button onClick={handleVerify} disabled={submitting} className={btnClass}>
              {submitting ? 'Verifying…' : 'Verify'}
            </button>
            <button
              onClick={() => { setStep(1); setOtp(''); setError('') }}
              className="w-full text-sm text-[#93b8d8] hover:text-[#f0f6ff] transition mt-1"
            >
              Use a different email
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="text-center space-y-1 pt-1">
          <p className="text-sm text-[#6a96bb]">
            Already have an account?{' '}
            <Link href="/" className="text-[#93b8d8] hover:text-[#f0f6ff] font-medium transition">
              Back to login
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
