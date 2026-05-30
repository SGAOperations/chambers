'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Body = { id: string; name: string; division: string; body_open: boolean }

export default function OnboardingPage() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [hasMemberships, setHasMemberships] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Step 2
  const [fullName, setFullName] = useState('')

  // Step 3
  const [bodies, setBodies] = useState<Body[]>([])
  const [selectedBodyIds, setSelectedBodyIds] = useState<Set<string>>(new Set())

  // Step 4
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const router = useRouter()
  const supabase = createClient()

  // Auth guard + onboarding check
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user ?? null
      if (!user) {
        router.push('/')
        return
      }

      const { data: profile } = await supabase
        .from('users')
        .select('full_name, is_active, has_completed_onboarding')
        .eq('id', user.id)
        .single()

      if (!profile?.is_active) {
        await supabase.auth.signOut()
        router.push('/')
        return
      }

      if (profile?.has_completed_onboarding) {
        router.push('/my-rooms')
        return
      }

      setFullName(profile?.full_name ?? '')

      const { data: memberships } = await supabase
        .from('board_memberships')
        .select('id')
        .eq('user_id', user.id)
        .limit(1)
      if (memberships && memberships.length > 0) setHasMemberships(true)

      setLoading(false)
    }
    init()
  }, [])

  // Fetch bodies when reaching step 3
  useEffect(() => {
    if (step !== 3) return
    const fetchBodies = async () => {
      const res = await fetch('/api/onboarding/bodies')
      if (res.ok) {
        const data = await res.json()
        setBodies(data.bodies ?? [])
      }
    }
    fetchBodies()
  }, [step])

  // Block accidental close/reload mid-wizard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const handleSaveName = async () => {
    setError('')
    if (!fullName.trim()) {
      setError('Please enter your name.')
      return
    }
    setSubmitting(true)
    const res = await fetch('/api/onboarding/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName.trim() }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Something went wrong.')
      return
    }
    setStep(hasMemberships ? 4 : 3)
  }

  const handleSaveMemberships = async () => {
    setError('')
    setSubmitting(true)
    const res = await fetch('/api/onboarding/memberships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body_ids: Array.from(selectedBodyIds) }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Something went wrong.')
      return
    }
    setStep(4)
  }

  const handleSetPassword = async () => {
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)

    const { error: authError } = await supabase.auth.updateUser({ password })
    if (authError) {
      setError(authError.message)
      setSubmitting(false)
      return
    }

    const res = await fetch('/api/onboarding/complete', { method: 'PATCH' })
    setSubmitting(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Something went wrong.')
      return
    }

    router.push('/my-rooms')
  }

  const toggleBody = (id: string) => {
    setSelectedBodyIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Group bodies by division for display
  const grouped = bodies.reduce<Record<string, Body[]>>((acc, b) => {
    const div = b.division || 'Other'
    if (!acc[div]) acc[div] = []
    acc[div].push(b)
    return acc
  }, {})

  const hasClosedBodies = bodies.some(b => !b.body_open)

  if (loading) return null

  const inputClass =
    'w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition'
  const btnClass =
    'w-full bg-[#c8102e] hover:bg-[#a00d24] hover:scale-105 text-white py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50 mt-2'

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#112244] via-[#0a1628] to-[#060e1a] flex items-center justify-center px-4 relative">
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

      <div className="bg-[#184073] rounded-2xl shadow-2xl w-full max-w-lg p-12 space-y-6 relative z-10">
        {/* Brand */}
        <div className="text-center">
          <span className="text-[#c8102e] font-bold text-3xl tracking-tight">Chambers</span>
          <p className="text-[#93b8d8] text-xs mt-1">Step {hasMemberships && step === 4 ? 3 : step} of {hasMemberships ? 3 : 4}</p>
        </div>

        {/* Step 1 — Welcome */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="text-center space-y-2">
              <h2 className="text-[#f0f6ff] font-semibold text-lg">Welcome to Chambers</h2>
              <p className="text-[#93b8d8] text-sm leading-relaxed">
                Chambers is the official room and event booking platform for the Northeastern Student Government Association.
                Before you get started, we&apos;ll take a moment to set up your account — it only takes a minute.
              </p>
            </div>
            <button onClick={() => setStep(2)} className={btnClass}>
              Get Started
            </button>
          </div>
        )}

        {/* Step 2 — Your Name */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-[#f0f6ff] font-semibold text-lg mb-1">Your Name</h2>
              <p className="text-[#93b8d8] text-sm mb-4">Confirm or update the name displayed on your account.</p>
              <label className="block text-xs font-medium text-[#93b8d8] mb-1.5">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !submitting && handleSaveName()}
                placeholder="Your full name"
                className={inputClass}
              />
            </div>
            {error && <p className="text-[#c8102e] text-sm">{error}</p>}
            <button onClick={handleSaveName} disabled={submitting} className={btnClass}>
              {submitting ? 'Saving…' : 'Next'}
            </button>
          </div>
        )}

        {/* Step 3 — Your Bodies */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-[#f0f6ff] font-semibold text-lg mb-1">Your Bodies</h2>
              <p className="text-[#93b8d8] text-sm mb-4">
                Select the SGA bodies you belong to. Open bodies add you as a Member immediately. Bodies marked with a lock require admin approval.
              </p>
            </div>

            {bodies.length === 0 ? (
              <p className="text-[#6a96bb] text-sm text-center py-4">Loading bodies…</p>
            ) : (
              <>
                <Link
                  href="/faq"
                  target="_blank"
                  className="block text-xs font-medium text-center text-[#93b8d8] bg-[#0f2a4a] border border-[#1e5080] rounded-md px-3 py-2 hover:bg-[#1a3a5c] hover:text-[#f0f6ff] transition"
                >
                  Why Do I Need Admin Approval?
                </Link>
                <div className="max-h-64 overflow-y-auto space-y-4 pr-1">
                  {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([division, divBodies]) => (
                    <div key={division}>
                      <p className="text-xs font-semibold text-[#6a96bb] uppercase tracking-wider mb-1.5">{division}</p>
                      <div className="space-y-1">
                        {divBodies.map(body => (
                          body.body_open ? (
                            <label
                              key={body.id}
                              className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition ${selectedBodyIds.has(body.id) ? 'bg-[#0f3d20] hover:bg-[#0f3d20]' : 'hover:bg-white/5'}`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedBodyIds.has(body.id)}
                                onChange={() => toggleBody(body.id)}
                                className="accent-[#c8102e] w-4 h-4 flex-shrink-0"
                              />
                              <span className={`text-sm ${selectedBodyIds.has(body.id) ? 'text-[#4ade80]' : 'text-[#f0f6ff]'}`}>{body.name}</span>
                            </label>
                          ) : (
                            <label
                              key={body.id}
                              className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition ${selectedBodyIds.has(body.id) ? 'bg-[#1e3a5f] hover:bg-[#1e3a5f]' : 'hover:bg-white/5'}`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedBodyIds.has(body.id)}
                                onChange={() => toggleBody(body.id)}
                                className="accent-[#c8102e] w-4 h-4 flex-shrink-0"
                              />
                              <span className="flex flex-col">
                                <span className={`flex items-center gap-1.5 text-sm ${selectedBodyIds.has(body.id) ? 'text-[#f59b0e]' : 'text-[#6a96bb]'}`}>
                                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                                  </svg>
                                  {body.name}
                                </span>
                                {selectedBodyIds.has(body.id) && (
                                  <span className="text-xs text-[#6a96bb] ml-5">Requires approval - will submit a request</span>
                                )}
                              </span>
                            </label>
                          )
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {hasClosedBodies && (
              <p className="text-xs text-[#6a96bb]">
                Some bodies require admin approval to join and will be submitted as requests.
              </p>
            )}
            {error && <p className="text-[#c8102e] text-sm">{error}</p>}
            <button onClick={handleSaveMemberships} disabled={submitting || bodies.length === 0} className={btnClass}>
              {submitting ? 'Saving…' : 'Next'}
            </button>
          </div>
        )}

        {/* Step 4 — Set Your Password */}
        {step === 4 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-[#f0f6ff] font-semibold text-lg mb-1">Set Your Password</h2>
              <p className="text-[#93b8d8] text-sm mb-4">Choose a secure password for your Chambers account.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#93b8d8] mb-1.5">New Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !submitting && handleSetPassword()}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#93b8d8] mb-1.5">Confirm Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSetPassword()}
                className={inputClass}
              />
            </div>
            {error && <p className="text-[#c8102e] text-sm">{error}</p>}
            <button onClick={handleSetPassword} disabled={submitting} className={btnClass}>
              {submitting ? 'Setting up…' : 'Finish Setup'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
