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
const router = useRouter()
const pathname = usePathname()
const supabase = createClient()

useEffect(() => {
  const checkUser = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user?.app_metadata?.is_admin) setIsAdmin(true)

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

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const navLink = (href: string, label: string) => {
    const isActive = pathname === href || pathname.startsWith(href + '/')
    return (
      <a
        href={href}
        className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
          isActive
            ? 'bg-white/15 text-white'
            : 'text-slate-400 hover:bg-white/10 hover:text-white'
        }`}
      >
        {label}
      </a>
    )
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <nav className="w-56 bg-[#0a1628] flex flex-col flex-shrink-0">
          {/* Brand */}
          <div className="px-5 py-5 border-b border-white/10">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[#c8102e] font-bold text-xl tracking-tight">SGA</span>
              <span className="text-white/70 text-sm font-medium">Space Manager</span>
            </div>
            <p className="text-slate-500 text-xs mt-0.5">Northeastern University</p>
            <p className="text-slate-600 text-xs mt-1">v1.3.0-alpha</p>
          </div>

          {/* Nav links */}
          <div className="flex flex-col gap-1 px-3 py-4 flex-1">
            {navLink('/my-rooms', 'My Rooms')}
            {(isLeadership || isAdmin) && navLink('/request', 'Request a Booking')}
            {isAdmin && navLink('/management', 'Management')}
          </div>

          {/* Sign out */}
          <div className="px-3 py-4 border-t border-white/10">
            <button
              onClick={handleLogout}
              className="w-full flex items-center px-4 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-white/10 hover:text-white transition-all text-left"
            >
              Sign Out
            </button>
          </div>
        </nav>

        <main className="flex-1 bg-[#f4f6f9] p-8 min-h-screen">
          {children}
        </main>
      </div>
    </AuthGuard>
  )
}
