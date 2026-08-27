'use client'

import { useEffect, useRef, useState } from 'react'
import { useCounts } from '../counts-context'
import type { AlertRow as Alert } from '@/lib/dashboard-data'

function formatTime(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${m} ${ampm}`
}

function formatDate(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  // Seeded from the shell's single /api/dashboard fetch; kept as local state so
  // the optimistic removes below still work. Re-syncs if the shell refetches.
  const { alerts: shellAlerts } = useCounts()
  const [alerts, setAlerts] = useState<Alert[]>(shellAlerts)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setAlerts(shellAlerts)
  }, [shellAlerts])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const dismiss = async (id: string) => {
    await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setAlerts(prev => prev.filter(a => a.id !== id))
  }

  const clearAll = async () => {
    await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
    setAlerts([])
    setOpen(false)
  }

  return (
    <div className="relative" ref={overlayRef}>
      <button
        onClick={() => setOpen(prev => !prev)}
        className="relative p-1.5 rounded-lg hover:bg-[#1a4d8a] transition-colors"
        aria-label="Notifications"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5 text-[#6a96bb]"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {alerts.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full bg-[#c8102e] text-white text-[10px] font-bold leading-none">
            {alerts.length > 99 ? '99+' : alerts.length}
          </span>
        )}
      </button>

      {/* Width clamped to the viewport (issue #24) -- a fixed w-80 overflowed off the right
          edge on mobile since the bell sits near the left of its header row. */}
      {open && (
        <div className="absolute left-0 top-full mt-2 w-[min(20rem,calc(100vw-2rem))] bg-[#184073] border border-[#1e5080] rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e5080]">
            <span className="text-sm font-semibold text-[#f0f6ff]">Notifications</span>
            {alerts.length > 0 && (
              <button
                onClick={clearAll}
                className="text-xs text-[#6a96bb] hover:text-[#93b8d8] transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {alerts.length === 0 ? (
            <p className="px-4 py-5 text-sm text-[#6a96bb] text-center">No new notifications.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-[#1e5080]">
              {alerts.map(alert => (
                <li key={alert.id} className="flex items-start gap-3 px-4 py-3 hover:bg-[#1a4d8a] transition-colors">
                  <p className="flex-1 text-sm text-[#f0f6ff] leading-snug">
                    {alert.booking_type === 'Denied' ? (
                      <>
                        Your{alert.room_requests?.bodies?.name ? ` ${alert.room_requests.bodies.name}` : ''} room request was denied.
                        {alert.denial_reason && (
                          <> <span className="text-[#93b8d8]">Reason: {alert.denial_reason}</span></>
                        )}
                      </>
                    ) : (
                      <>
                        {alert.bookings?.bodies?.name && (
                          <span className="font-medium">{alert.bookings.bodies.name} </span>
                        )}
                        <span className="font-medium">{alert.booking_type}</span> booking
                        {alert.booking_date ? ` on ${formatDate(alert.booking_date)}` : ''}
                        {alert.start_time ? ` starting at ${formatTime(alert.start_time)}` : ''} was updated.
                      </>
                    )}
                  </p>
                  <button
                    onClick={() => dismiss(alert.id)}
                    className="flex-shrink-0 text-[#6a96bb] hover:text-[#f0f6ff] transition-colors text-base leading-none mt-0.5"
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
