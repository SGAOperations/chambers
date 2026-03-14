'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AuthGuard from './authguard'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const supabase = createClient()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <nav className="w-48 bg-gray-900 text-white flex flex-col p-4 gap-2">
          <span className="text-lg font-bold mb-4">SGA Space Manager</span>
          <a href="/my-rooms" className="px-3 py-2 rounded hover:bg-gray-700">My Rooms</a>
          <div className="mt-auto">
            <button
              onClick={handleLogout}
              className="px-3 py-2 rounded hover:bg-gray-700 w-full text-left"
            >
              Logout
            </button>
          </div>
        </nav>
        <main className="flex-1 p-8">
          {children}
        </main>
      </div>
    </AuthGuard>
  )
}