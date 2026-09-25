'use client'

import { useState, useEffect, useCallback } from 'react'
import { Skeleton } from '@/app/_components/skeleton'
import { useIdentity } from '../identity-context'
import NussoBookModal from './nusso-book-modal'

/** One existing booking from /api/nusso/bookings. */
interface NussoBooking {
  Id: number
  RoomId: number
  BuildingId: number
  GroupName: string
  EventName: string
  EventStart: string // "YYYY-MM-DDTHH:mm:ss" Boston wall-clock
  EventEnd: string
  DisplayDetails: boolean
}

/** "2026-09-24T20:00:00" -> "8:00 PM", reading the wall-clock digits directly. */
function clockTime(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso)
  if (!m) return ''
  let h = Number(m[1])
  const min = m[2]
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${min} ${ampm}`
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function AgendaSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[0, 1, 2, 3, 4].map(i => (
        <Skeleton key={i} className="h-14 w-full border border-[#1e5080]" />
      ))}
    </div>
  )
}

export default function NussoPage() {
  const { isAdmin, isLeadership } = useIdentity()
  const canBook = isAdmin || isLeadership

  const [date, setDate] = useState<string>(todayISO)
  const [bookings, setBookings] = useState<NussoBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async (forDate: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/nusso/bookings?date=${forDate}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
      const list: NussoBooking[] = Array.isArray(data.bookings) ? data.bookings : []
      list.sort((a, b) => a.EventStart.localeCompare(b.EventStart))
      setBookings(list)
    } catch (err) {
      setBookings([])
      setError(err instanceof Error ? err.message : 'Could not load NUSSO bookings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(date)
  }, [date, load])

  const dateLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })

  return (
    <div className="flex flex-col gap-5 h-full min-h-0">
      <div className="flex items-start justify-between flex-wrap gap-3 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-[#f0f6ff]">Browse/Book NUSSO</h1>
          <p className="text-sm text-[#93b8d8] mt-0.5">Northeastern event spaces · nuevents.neu.edu</p>
        </div>
        {canBook && (
          <button
            onClick={() => setShowModal(true)}
            className="py-2 px-4 bg-[#c8102e] hover:bg-[#a50d26] text-white text-sm font-medium rounded-lg transition-colors"
          >
            Book a space
          </button>
        )}
      </div>

      {toast && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0">
          <p className="text-sm text-[#f0f6ff]">{toast}</p>
          <button onClick={() => setToast(null)} className="text-[#93b8d8] hover:text-[#f0f6ff]" aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* Day navigation */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => setDate(d => shiftDate(d, -1))}
          className="p-1.5 rounded-lg text-[#93b8d8] hover:text-[#f0f6ff] hover:bg-white/10 transition-colors"
          aria-label="Previous day"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span className="text-sm font-medium text-[#f0f6ff] min-w-[16rem]">{dateLabel}</span>
        <button
          onClick={() => setDate(d => shiftDate(d, 1))}
          className="p-1.5 rounded-lg text-[#93b8d8] hover:text-[#f0f6ff] hover:bg-white/10 transition-colors"
          aria-label="Next day"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
        {date !== todayISO() && (
          <button onClick={() => setDate(todayISO())} className="text-xs text-[#93b8d8] hover:text-[#f0f6ff] underline">Today</button>
        )}
      </div>

      {/* Agenda */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <AgendaSkeleton />
        ) : error ? (
          <div className="border border-[#1e5080] rounded-xl bg-[#184073] p-6 max-w-md">
            <p className="text-[#f0f6ff] font-medium mb-1">Couldn&apos;t load NUSSO</p>
            <p className="text-sm text-[#93b8d8] mb-4">{error}</p>
            <button onClick={() => load(date)} className="py-2 px-4 bg-[#c8102e] hover:bg-[#a50d26] text-white text-sm font-medium rounded-lg transition-colors">Try again</button>
          </div>
        ) : bookings.length === 0 ? (
          <div className="border border-dashed border-[#1e5080] rounded-xl p-8 text-center">
            <p className="text-[#93b8d8] text-sm">No NUSSO bookings on this day.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {bookings.map(b => (
              <li key={b.Id} className="flex items-center gap-4 rounded-lg border border-[#1e5080] bg-[#0f2a4a] px-4 py-3">
                <div className="w-32 flex-shrink-0 text-sm text-[#f0f6ff] font-medium">
                  {clockTime(b.EventStart)} – {clockTime(b.EventEnd)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-[#f0f6ff] truncate">{b.DisplayDetails ? (b.EventName || 'Reserved') : 'Unavailable'}</p>
                  {b.DisplayDetails && b.GroupName && <p className="text-xs text-[#93b8d8] truncate">{b.GroupName}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showModal && (
        <NussoBookModal
          initialDate={date}
          onClose={() => setShowModal(false)}
          onSuccess={id => {
            setShowModal(false)
            setToast(`Reservation #${id} created. A confirmation email has been sent.`)
            load(date)
          }}
        />
      )}
    </div>
  )
}
