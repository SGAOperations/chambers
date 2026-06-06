'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AuthGuard from './authguard'
import SettingsModal, { type Settings as SettingsData } from './settings-modal'

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
  const [isIEMS, setIsIEMS] = useState(false)
  const [isLeadership, setIsLeadership] = useState(false)
  const [counts, setCounts] = useState({ requests: 0, cancellations: 0, total: 0 })
  const [userName, setUserName] = useState('')
  const [showIdleWarning, setShowIdleWarning] = useState(false)
  const [idleCountdown, setIdleCountdown] = useState(60)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsCache, setSettingsCache] = useState<SettingsData | null>(null)
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
      if (user?.app_metadata?.iems_role) {
        setIsIEMS(true)
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
    const res = await fetch('/api/administrator/counts')
    if (res.ok) {
      const data = await res.json()
      setCounts(data)
    }
  }

  const handleLogout = async () => {
    localStorage.removeItem('chambers_last_active')
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
        localStorage.removeItem('chambers_last_active')
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
    localStorage.setItem('chambers_last_active', Date.now().toString())
  }

  useEffect(() => {
    const IDLE_MS = 44 * 60 * 1000

    const storedLastActive = localStorage.getItem('chambers_last_active')
    if (storedLastActive) {
      const elapsed = Date.now() - parseInt(storedLastActive, 10)
      if (elapsed >= IDLE_MS) {
        supabase.auth.signOut().then(() => router.push('/'))
        return
      }
    }

    const resetTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
        setShowIdleWarning(false)
        setIdleCountdown(60)
      }
      idleTimerRef.current = setTimeout(startWarning, IDLE_MS)
      localStorage.setItem('chambers_last_active', Date.now().toString())
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const stored = localStorage.getItem('chambers_last_active')
        if (stored) {
          const elapsed = Date.now() - parseInt(stored, 10)
          if (elapsed >= IDLE_MS) {
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
            if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
            supabase.auth.signOut().then(() => router.push('/'))
          }
        }
      }
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart'] as const
    events.forEach(e => window.addEventListener(e, resetTimer))
    document.addEventListener('visibilitychange', handleVisibilityChange)
    resetTimer()

    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer))
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    }
  }, [])

  const navLink = (href: string, label: string, badge?: number) => {
  const isActive = pathname === href || pathname.startsWith(href + '/')
    return (
      <a
        href={href}
        onClick={() => setSidebarOpen(false)}
        className={`group relative flex items-center justify-between px-4 py-2.5 rounded-lg text-sm font-medium overflow-hidden transition-colors ${
          isActive
            ? 'bg-white/15 text-white'
            : 'text-slate-400 hover:text-[#c8102e]'
          }`}
      >
        {!isActive && (
          <span className="absolute inset-0 bg-white/10 rounded-lg -translate-x-full group-hover:translate-x-0 transition-transform duration-200 ease-out" />
        )}
        <span className="relative z-10">{label}</span>
        {badge ? (
          <span className="relative z-10 bg-[#c8102e] text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
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
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile hamburger button */}
      <button
        className="fixed top-4 right-4 z-50 md:hidden bg-[#0a1628] p-2 rounded-lg text-white border border-white/10"
        onClick={() => setSidebarOpen(o => !o)}
        aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
      >
        {sidebarOpen ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        )}
      </button>

      <div className="flex h-screen">
        <nav className={`fixed inset-y-0 left-0 z-40 w-56 bg-[#0a1628] flex flex-col flex-shrink-0 transition-transform duration-300 md:relative md:translate-x-0 md:inset-auto md:z-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          {/* Brand */}
          <div className="px-5 py-5 border-b border-white/10">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[#c8102e] font-bold text-xl tracking-tight">Chambers</span>
            </div>
            <p className="text-slate-500 text-xs mt-0.5">NU Student Gov. Association</p>
            <p className="text-slate-600 text-xs mt-1">v1.11.9</p>
            {userName && (
              <div className="flex items-start justify-between mt-2">
                <p className="text-slate-500 text-xs italic">{getGreeting()},<br />{userName}</p>
                <button
                  onClick={() => setShowSettings(true)}
                  className="p-1 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0"
                  aria-label="Settings"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-slate-500">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Nav links */}
          <div className="flex flex-col gap-1 px-3 py-4 flex-1">
            {navLink('/my-rooms', 'My Rooms')}
            {navLink('/sga-spaces', 'SGA Spaces')}
            {(isLeadership || isAdmin) && navLink('/request', 'Request a Booking')}
            {(isAdmin || isIEMS) && navLink('/events', 'Events')}
            {isAdmin && navLink('/administrator', 'Administrator')}
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
              className="w-full flex items-center px-4 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-white/10 hover:text-[#c8102e] transition-all text-left"
            >
              Sign Out
            </button>
          </div>
        </nav>

        <main className="flex-1 bg-gradient-to-br from-[#112244] via-[#0a1628] to-[#060e1a] p-8 overflow-y-auto">
          {children}
        </main>
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} cachedSettings={settingsCache} onSettingsLoaded={setSettingsCache} />}
    </AuthGuard>
  )
}