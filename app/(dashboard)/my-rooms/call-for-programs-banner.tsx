'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { formatCallTime } from '@/lib/call-for-programs'

/**
 * Tells a body lead the call for programs is open, while any body they lead
 * still has to answer. Fetched after the page renders rather than with the
 * server read, so My Rooms does not wait on it.
 */
export default function CallForProgramsBanner() {
  const [state, setState] = useState<{ closesAt: string | null; pending: string[] } | null>(null)

  useEffect(() => {
    fetch('/api/call-for-programs')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data?.call) return
        const pending = (data.bodies as { name: string; submitted: boolean }[])
          .filter(b => !b.submitted)
          .map(b => b.name)
        if (pending.length > 0) setState({ closesAt: data.call.closes_at, pending })
      })
      .catch(() => {})
  }, [])

  if (!state) return null

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-[#c8102e]/50 bg-[#2d0810] px-5 py-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#f0f6ff]">The Call for Programs is open</p>
        <p className="text-xs text-[#fca5a5]">
          Still to submit: {state.pending.join(', ')}
          {state.closesAt && <> · closes {formatCallTime(state.closesAt)}</>}
        </p>
      </div>
      <Link
        href="/request?type=programs"
        className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors text-center flex-shrink-0"
      >
        Submit
      </Link>
    </div>
  )
}
