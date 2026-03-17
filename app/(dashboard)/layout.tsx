'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AuthGuard from './authguard'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [isAdmin, setIsAdmin] = useState(false)
  const [isLeadership, setIsLeadership] = useState(false)
  const [counts, setCounts] = useState({ requests: 0, cancellations: 0, total: 0 })
  const [userName, setUserName] = useState('')
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

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
      <div className="flex h-screen">
        <nav className="w-56 bg-[#0a1628] flex flex-col flex-shrink-0">
          {/* Brand */}
          <div className="px-5 py-5 border-b border-white/10">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[#c8102e] font-bold text-xl tracking-tight">Chambers</span>
            </div>
            <p className="text-slate-500 text-xs mt-0.5">NU Student Gov. Association</p>
            <p className="text-slate-600 text-xs mt-1">v1.3.1 (SGA Unreleased)</p>
            {userName && (
              <p className="text-slate-500 text-xs mt-2 italic">Welcome,<br />{userName}</p>
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