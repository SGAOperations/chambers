'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        router.push('/my-rooms')
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
      .select('is_active')
      .eq('id', data.user.id)
      .single()

    if (!profile?.is_active) {
      await supabase.auth.signOut()
      setError('Your account has been deactivated. Please contact an administrator.')
      setLoading(false)
      return
    }

    router.push('/my-rooms')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a1628]">
      {/* Subtle grid texture */}
      <div className="absolute inset-0 opacity-[0.03]" style={{backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '32px 32px'}} />

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
          {error && <p className="text-[#c8102e] text-sm">{error}</p>}
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-[#c8102e] hover:bg-[#a00d24] text-white py-2.5 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 mt-2"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </div>
      </div>
    </div>
  )
}