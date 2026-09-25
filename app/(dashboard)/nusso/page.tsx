'use client'

import { useState, useCallback } from 'react'
import { Skeleton } from '@/app/_components/skeleton'
import { useIdentity } from '../identity-context'
import NussoBookModal from './nusso-book-modal'
import NussoTablingModal from './nusso-tabling-modal'
import type { AvailableRoom } from './types'

type ReservationType = 'room-request' | 'tabling'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Group rooms by building, buildings A→Z, rooms by code within. */
function groupByBuilding(rooms: AvailableRoom[]): [string, AvailableRoom[]][] {
  const map = new Map<string, AvailableRoom[]>()
  for (const r of rooms) {
    const key = r.BuildingDescription || 'Other locations'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(r)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([b, list]) => [b, list.sort((x, y) => x.RoomCode.localeCompare(y.RoomCode))] as [string, AvailableRoom[]])
}

function ResultsSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[0, 1, 2].map(g => (
        <div key={g} className="space-y-2">
          <Skeleton className="h-4 w-40" />
          {[0, 1].map(i => <Skeleton key={i} className="h-14 w-full border border-[#1e5080]" />)}
        </div>
      ))}
    </div>
  )
}

const field =
  'bg-[#0a1628] border border-[#1e5080] rounded-lg px-3 py-2 text-[#f0f6ff] text-sm focus:outline-none focus:border-[#c8102e] transition-colors'
const labelCls = 'block text-xs font-medium text-[#93b8d8] mb-1'

export default function NussoPage() {
  const { isAdmin, isLeadership } = useIdentity()
  const canBook = isAdmin || isLeadership

  const [reservationType, setReservationType] = useState<ReservationType>('room-request')
  const [date, setDate] = useState<string>(todayISO)
  const [start, setStart] = useState('12:00')
  const [end, setEnd] = useState('13:00')
  const [capacity, setCapacity] = useState('')

  const [rooms, setRooms] = useState<AvailableRoom[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The window that produced the current results, so booking uses exactly what
  // was searched even if the form is edited afterward.
  const [searched, setSearched] = useState<{ date: string; start: string; end: string; type: ReservationType } | null>(null)
  const [bookRoom, setBookRoom] = useState<AvailableRoom | null>(null)

  const windowValid = start < end

  const search = useCallback(async () => {
    if (!windowValid) return
    setLoading(true)
    setError(null)
    const cap = Number(capacity)
    try {
      const res = await fetch('/api/nusso/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date, start, end,
          capacity: Number.isFinite(cap) && cap > 0 ? cap : undefined,
          reservationType,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
      setRooms(Array.isArray(data.rooms) ? data.rooms : [])
      setSearched({ date, start, end, type: reservationType })
    } catch (err) {
      setRooms(null)
      setError(err instanceof Error ? err.message : 'Could not search NUSSO.')
    } finally {
      setLoading(false)
    }
  }, [date, start, end, capacity, reservationType, windowValid])

  const grouped = rooms ? groupByBuilding(rooms) : []

  return (
    <div className="flex flex-col gap-5 h-full min-h-0">
      <div className="flex-shrink-0">
        <h1 className="text-2xl font-bold text-[#f0f6ff]">Browse/Book NUSSO</h1>
        <p className="text-sm text-[#93b8d8] mt-0.5">Find an available Northeastern event space · nuevents.neu.edu</p>
      </div>

      {/* Search bar */}
      <div className="flex-shrink-0 rounded-xl border border-[#1e5080] bg-[#0f2a4a] p-4">
        {/* Reservation type toggle */}
        <div className="inline-flex rounded-lg border border-[#1e5080] p-0.5 mb-3">
          {(['room-request', 'tabling'] as ReservationType[]).map(t => (
            <button
              key={t}
              onClick={() => setReservationType(t)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                reservationType === t ? 'bg-[#c8102e] text-white' : 'text-[#93b8d8] hover:text-[#f0f6ff]'
              }`}
            >
              {t === 'room-request' ? 'Room request' : 'Tabling'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={labelCls} htmlFor="s-date">Date</label>
            <input id="s-date" type="date" className={field} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="s-start">Start</label>
            <input id="s-start" type="time" className={field} value={start} onChange={e => setStart(e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="s-end">End</label>
            <input id="s-end" type="time" className={field} value={end} onChange={e => setEnd(e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="s-cap">Min. capacity</label>
            <input id="s-cap" type="number" min={0} placeholder="any" className={`${field} w-24`} value={capacity} onChange={e => setCapacity(e.target.value)} />
          </div>
          <button
            onClick={search}
            disabled={loading || !windowValid}
            className="py-2 px-5 bg-[#c8102e] hover:bg-[#a50d26] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40"
          >
            {loading ? 'Searching…' : 'Find rooms'}
          </button>
        </div>
        {!windowValid && <p className="text-xs text-[#c8102e] mt-2">End time must be after start time.</p>}
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <ResultsSkeleton />
        ) : error ? (
          <div className="border border-[#1e5080] rounded-xl bg-[#184073] p-6 max-w-md">
            <p className="text-[#f0f6ff] font-medium mb-1">Couldn&apos;t search NUSSO</p>
            <p className="text-sm text-[#93b8d8] mb-4">{error}</p>
            <button onClick={search} className="py-2 px-4 bg-[#c8102e] hover:bg-[#a50d26] text-white text-sm font-medium rounded-lg transition-colors">Try again</button>
          </div>
        ) : rooms === null ? (
          <div className="border border-dashed border-[#1e5080] rounded-xl p-8 text-center">
            <p className="text-[#93b8d8] text-sm">Pick a date and time, then <span className="text-[#f0f6ff]">Find rooms</span> to see what&apos;s available.</p>
          </div>
        ) : rooms.length === 0 ? (
          <div className="border border-dashed border-[#1e5080] rounded-xl p-8 text-center">
            <p className="text-[#93b8d8] text-sm">No {searched?.type === 'tabling' ? 'tabling locations' : 'rooms'} available for that window. Try a different time or a smaller capacity.</p>
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-sm text-[#93b8d8]">{rooms.length} available {rooms.length === 1 ? 'space' : 'spaces'}</p>
            {grouped.map(([building, list]) => (
              <div key={building}>
                <h2 className="text-sm font-semibold text-[#93b8d8] mb-2 sticky top-0 bg-gradient-to-r from-[#0a1628] to-transparent py-1">{building}</h2>
                <ul className="space-y-2">
                  {list.map(room => (
                    <li key={room.RoomId} className="flex items-center gap-4 rounded-lg border border-[#1e5080] bg-[#0f2a4a] px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[#f0f6ff] font-medium truncate">{room.RoomCode}{room.RoomDescription && room.RoomDescription !== room.RoomCode ? ` — ${room.RoomDescription}` : ''}</p>
                        <p className="text-xs text-[#93b8d8]">
                          Seats up to {room.Capacity}
                          {room.MinCapacity > 0 ? ` · min ${room.MinCapacity}` : ''}
                        </p>
                        {room.Alert && <p className="text-xs text-amber-300/90 mt-1 whitespace-pre-line">⚠ {room.Alert}</p>}
                      </div>
                      {canBook && (
                        <button
                          onClick={() => setBookRoom(room)}
                          className="flex-shrink-0 py-1.5 px-3 bg-[#c8102e] hover:bg-[#a50d26] text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          Book
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirm-booking modal for the chosen room + searched window */}
      {bookRoom && searched && searched.type === 'room-request' && (
        <NussoBookModal
          room={bookRoom}
          date={searched.date}
          start={searched.start}
          end={searched.end}
          onClose={() => setBookRoom(null)}
          onSuccess={() => { setBookRoom(null); search() }}
        />
      )}
      {bookRoom && searched && searched.type === 'tabling' && (
        <NussoTablingModal
          room={bookRoom}
          date={searched.date}
          start={searched.start}
          end={searched.end}
          onClose={() => setBookRoom(null)}
          onSuccess={() => { setBookRoom(null); search() }}
        />
      )}
    </div>
  )
}
