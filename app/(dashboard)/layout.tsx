'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AuthGuard from './authguard'

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good Morning'
  if (hour < 18) return 'Good Afternoon'
  return 'Good Evening'
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [isAdmin, setIsAdmin] = useState(false)
  const [isLeadership, setIsLeadership] = useState(false)
  const [counts, setCounts] = useState({ requests: 0, cancellations: 0, total: 0 })
  const [userName, setUserName] = useState('')
  const [showIdleWarning, setShowIdleWarning] = useState(false)
  const [idleCountdown, setIdleCountdown] = useState(60)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.app_metadata?.is_admin) {
        setIsAdmin(true)
        fetchCounts()
      }

      const { data: profile } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', user?.id)
        .single()
      if (profile?.full_name) setUserName(profile.full_name)

      const { data: memberships } = await supabase
        .from('board_memberships')
        .select('role')
        .eq('user_id', user?.id)
        .eq('role', 'Leadership')
        .limit(1)

      if (memberships && memberships.length > 0) setIsLeadership(true)
    }
    checkUser()
  }, [])

  const fetchCounts = async () => {
    const res = await fetch('/api/management/counts')
    if (res.ok) {
      const data = await res.json()
      setCounts(data)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const startWarning = () => {
    setShowIdleWarning(true)
    let remaining = 60
    setIdleCountdown(remaining)
    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1
      setIdleCountdown(remaining)
      if (remaining <= 0) {
        clearInterval(countdownIntervalRef.current!)
        countdownIntervalRef.current = null
        supabase.auth.signOut().then(() => router.push('/'))
      }
    }, 1000)
  }

  const handleStayLoggedIn = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    setShowIdleWarning(false)
    setIdleCountdown(60)
    idleTimerRef.current = setTimeout(startWarning, 44 * 60 * 1000)
  }

  useEffect(() => {
    const IDLE_MS = 44 * 60 * 1000

    const resetTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
        setShowIdleWarning(false)
        setIdleCountdown(60)
      }
      idleTimerRef.current = setTimeout(startWarning, IDLE_MS)
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart'] as const
    events.forEach(e => window.addEventListener(e, resetTimer))
    resetTimer()

    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer))
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    }
  }, [])

  const navLink = (href: string, label: string, badge?: number) => {
  const isActive = pathname === href || pathname.startsWith(href + '/')
    return (
      <a
        href={href}
        className={`flex items-center justify-between px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
          isActive
            ? 'bg-white/15 text-white'
            : 'text-slate-400 hover:bg-white/10 hover:text-white'
          }`}
      >
        <span>{label}</span>
        {badge ? (
          <span className="bg-[#c8102e] text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
            {badge}
          </span>
        ) : null}
      </a>
    )
  }

  return (
    <AuthGuard>
      {showIdleWarning && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-[#0a1628] border border-white/10 rounded-xl p-8 max-w-sm w-full mx-4 text-center">
            <h2 className="text-white font-semibold text-lg mb-2">Session Expiring</h2>
            <p className="text-slate-400 text-sm mb-6">
              You&apos;ll be logged out in <span className="text-white font-medium">{idleCountdown}</span> second{idleCountdown !== 1 ? 's' : ''} due to inactivity.
            </p>
            <button
              onClick={handleStayLoggedIn}
              className="w-full py-2.5 px-4 bg-[#c8102e] hover:bg-[#a50d26] text-white text-sm font-medium rounded-lg transition-colors"
            >
              Stay Logged In
            </button>
          </div>
        </div>
      )}
      <div className="flex h-screen">
        <nav className="w-56 bg-[#0a1628] flex flex-col flex-shrink-0">
          {/* Brand */}
          <div className="px-5 py-5 border-b border-white/10">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[#c8102e] font-bold text-xl tracking-tight">Chambers</span>
            </div>
            <p className="text-slate-500 text-xs mt-0.5">NU Student Gov. Association</p>
            <p className="text-slate-600 text-xs mt-1">v1.7.1-alpha (SGA Unreleased)</p>
            {userName && (
              <p className="text-slate-500 text-xs mt-2 italic">{getGreeting()},<br />{userName}</p>
            )}
          </div>

          {/* Nav links */}
          <div className="flex flex-col gap-1 px-3 py-4 flex-1">
            {navLink('/my-rooms', 'My Rooms')}
            {(isLeadership || isAdmin) && navLink('/request', 'Request a Booking')}
            {isAdmin && navLink('/management', 'Management')}
          </div>

          {/* Total badge + Sign out */}
          <div className="px-3 py-4 border-t border-white/10 space-y-1">
            {isAdmin && counts.total > 0 && (
              <div className="flex items-center justify-between px-4 py-2">
                <span className="text-xs text-slate-500">Pending Actions</span>
                <span className="bg-[#c8102e] text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {counts.total}
                </span>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="w-full flex items-center px-4 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-white/10 hover:text-white transition-all text-left"
            >
              Sign Out
            </button>
          </div>
        </nav>

        <main className="flex-1 bg-[#0f2a4a] p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </AuthGuard>
  )
}