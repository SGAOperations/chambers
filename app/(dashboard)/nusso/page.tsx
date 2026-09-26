'use client'

import { useState, useCallback, useEffect } from 'react'
import { Skeleton } from '@/app/_components/skeleton'
import TimePicker from '../bookings/time-picker'
import { useIdentity } from '../identity-context'
import NussoBookModal from './nusso-book-modal'
import NussoTablingModal from './nusso-tabling-modal'
import type { AvailableRoom } from './types'

type ReservationType = 'room-request' | 'tabling'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** "YYYY-MM-DD" that is `days` after today, for the Book-mode earliest date. */
function addDaysISO(days: number): string {
  const d = new Date(`${todayISO()}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + Math.max(0, days))
  return d.toISOString().slice(0, 10)
}

type Mode = 'browse' | 'book'

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

  // Browse = view-only (no booking). Book = booking allowed, with the date picker
  // held to NUSSO's advance-notice minimum. Only bookers get Book mode.
  const [mode, setMode] = useState<Mode>(canBook ? 'book' : 'browse')
  const [reservationType, setReservationType] = useState<ReservationType>('room-request')
  const [date, setDate] = useState<string>(todayISO)
  const [start, setStart] = useState('12:00')
  const [end, setEnd] = useState('13:00')
  const [capacity, setCapacity] = useState('')

  // NUSSO's own booking minimums (Management-configured), for Book-mode date limits.
  const [nussoMinDaysRoom, setNussoMinDaysRoom] = useState(0)
  const [nussoMinDaysTabling, setNussoMinDaysTabling] = useState(0)

  const minAdvance = reservationType === 'tabling' ? nussoMinDaysTabling : nussoMinDaysRoom
  // In Book mode you cannot pick a date sooner than the minimum (nor the past);
  // in Browse mode any date is viewable.
  const minBookDate = mode === 'book' ? addDaysISO(minAdvance) : undefined

  const clampToBookable = useCallback(
    (d: string, m: Mode, rt: ReservationType, mdr: number, mdt: number): string => {
      if (m !== 'book') return d
      const min = addDaysISO(rt === 'tabling' ? mdt : mdr)
      return d < min ? min : d
    },
    []
  )

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/nusso/settings')
        if (!res.ok) return
        const data = await res.json()
        if (!active) return
        const mdr = data.minDaysRoom ?? 0
        const mdt = data.minDaysTabling ?? 0
        setNussoMinDaysRoom(mdr)
        setNussoMinDaysTabling(mdt)
        // Now that the minimums are known, pull the date forward if it is too soon.
        setDate(prev => clampToBookable(prev, mode, reservationType, mdr, mdt))
      } catch {
        /* leave minimums at 0 */
      }
    })()
    return () => { active = false }
    // Intentionally run once on mount; later clamping happens in the handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [rooms, setRooms] = useState<AvailableRoom[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The window that produced the current results, so booking uses exactly what
  // was searched even if the form is edited afterward.
  const [searched, setSearched] = useState<{ date: string; start: string; end: string; type: ReservationType } | null>(null)
  const [bookRoom, setBookRoom] = useState<AvailableRoom | null>(null)

  const switchMode = (m: Mode) => {
    setMode(m)
    setDate(prev => clampToBookable(prev, m, reservationType, nussoMinDaysRoom, nussoMinDaysTabling))
  }
  const switchType = (t: ReservationType) => {
    setReservationType(t)
    setDate(prev => clampToBookable(prev, mode, t, nussoMinDaysRoom, nussoMinDaysTabling))
  }

  const windowValid = start < end

  const search = useCallback(async () => {
    if (!windowValid) return
    if (mode === 'book' && minBookDate && date < minBookDate) {
      setError('That date is too soon to book through NUSSO. Pick a later date, or switch to Browse.')
      setRooms(null)
      return
    }
    setLoading(true)
    setError(null)
    const cap = Number(capacity)
    try {
      const res = await fetch('/api/nusso/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date, start, end,
          // Capacity filtering only applies to room requests; tabling spaces are all cap 1.
          capacity: reservationType === 'room-request' && Number.isFinite(cap) && cap > 0 ? cap : undefined,
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
  }, [date, start, end, capacity, reservationType, windowValid, mode, minBookDate])

  const grouped = rooms ? groupByBuilding(rooms) : []

  return (
    <div className="flex flex-col gap-5 h-full min-h-0">
      <div className="flex-shrink-0">
        <h1 className="text-2xl font-bold text-[#f0f6ff]">Browse/Book NUSSO</h1>
        <p className="text-sm text-[#93b8d8] mt-0.5">Find an available Northeastern event space · nuevents.neu.edu</p>
      </div>

      {/* Search bar */}
      <div className="flex-shrink-0 rounded-xl border border-[#1e5080] bg-[#0f2a4a] p-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          {/* Browse / Book mode toggle. Book (with its date limits) is bookers only. */}
          <div className="inline-flex rounded-lg border border-[#1e5080] p-0.5">
            {(['browse', 'book'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                disabled={m === 'book' && !canBook}
                title={m === 'book' && !canBook ? 'Only Leadership and administrators can book' : undefined}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  mode === m ? 'bg-[#c8102e] text-white' : 'text-[#93b8d8] hover:text-[#f0f6ff]'
                }`}
              >
                {m === 'browse' ? 'Browse' : 'Book'}
              </button>
            ))}
          </div>

          <span className="text-xs text-[#6a96bb]">
            {mode === 'browse' ? 'Viewing only — booking is off in Browse.' : 'Booking on — dates before the NUSSO minimum are disabled.'}
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className={labelCls}>Type</span>
            <div className="inline-flex rounded-lg border border-[#1e5080] p-0.5 h-[38px] items-center">
              {(['room-request', 'tabling'] as ReservationType[]).map(t => (
                <button
                  key={t}
                  onClick={() => switchType(t)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    reservationType === t ? 'bg-[#c8102e] text-white' : 'text-[#93b8d8] hover:text-[#f0f6ff]'
                  }`}
                >
                  {t === 'room-request' ? 'Room request' : 'Tabling'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="s-date">Date</label>
            <input
              id="s-date"
              type="date"
              className={field}
              value={date}
              min={minBookDate}
              onChange={e => setDate(clampToBookable(e.target.value, mode, reservationType, nussoMinDaysRoom, nussoMinDaysTabling))}
            />
          </div>
          <div className="w-32">
            <span className={labelCls}>Start</span>
            <TimePicker value={start} onChange={setStart} interval={15} />
          </div>
          <div className="w-32">
            <span className={labelCls}>End</span>
            <TimePicker value={end} onChange={setEnd} interval={15} />
          </div>
          {/* Tabling spaces are all capacity 1, so a capacity filter is meaningless there. */}
          {reservationType === 'room-request' && (
            <div>
              <label className={labelCls} htmlFor="s-cap">Min. capacity</label>
              <input id="s-cap" type="number" min={0} placeholder="any" className={`${field} w-24`} value={capacity} onChange={e => setCapacity(e.target.value)} />
            </div>
          )}
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
                        {searched?.type === 'room-request' && (
                          <p className="text-xs text-[#93b8d8]">
                            Seats up to {room.Capacity}
                            {room.MinCapacity > 0 ? ` · min ${room.MinCapacity}` : ''}
                          </p>
                        )}
                        {room.Alert && <p className="text-xs text-amber-300/90 mt-1 whitespace-pre-line">⚠ {room.Alert}</p>}
                      </div>
                      {canBook && mode === 'book' && (
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
