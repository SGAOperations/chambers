'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}

const INVALID_LINK = 'This reset link is invalid or has expired. Request a new one from the login page.'

function ResetPasswordForm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  // Better Auth sends the reset link through /api/auth/reset-password/<token>,
  // which checks the token and redirects here with ?token=... or, when it is
  // invalid or expired, ?error=INVALID_TOKEN (issue #136).
  const token = useSearchParams().get('token')

  const handleSubmit = async () => {
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (!token) {
      setError(INVALID_LINK)
      return
    }
    setLoading(true)
    const { error } = await authClient.resetPassword({ newPassword: password, token })
    setLoading(false)
    if (error) {
      setError(error.message ?? INVALID_LINK)
      return
    }
    setSuccess(true)
    setTimeout(() => router.push('/'), 3000)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#112244] via-[#0a1628] to-[#060e1a] flex items-center justify-center px-4 relative">
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      <div className="bg-[#184073] rounded-2xl shadow-2xl w-full max-w-md p-10 space-y-6 relative z-10">
        <div className="text-center">
          <span className="text-[#c8102e] font-bold text-3xl tracking-tight">Chambers</span>
          <p className="text-[#93b8d8] text-sm mt-1">Set a new password</p>
        </div>

        {success ? (
          <p className="text-sm text-[#93b8d8] text-center">
            Password updated. Redirecting to login…
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#93b8d8] mb-1.5">New Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#93b8d8] mb-1.5">Confirm Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                className="w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
              />
            </div>
            {(error || !token) && <p className="text-[#c8102e] text-sm">{error || INVALID_LINK}</p>}
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full bg-[#c8102e] hover:bg-[#a00d24] hover:scale-105 text-white py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50 mt-2"
            >
              {loading ? 'Updating…' : 'Update Password'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
