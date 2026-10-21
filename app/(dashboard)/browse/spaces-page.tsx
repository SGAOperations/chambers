'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Skeleton } from '@/app/_components/skeleton'
import DateField from '@/app/_components/date-field'
import TimePicker from '../bookings/time-picker'
import { useIdentity } from '../identity-context'
import NussoBookModal from './nusso-book-modal'
import NussoTablingModal from './nusso-tabling-modal'
import {
  ResponsibilitiesButton,
  ResponsibilityModal,
  useResponsibilityNotice,
} from './nusso-responsibility-notice'
import SpaceTimeline, { DAY_END, DAY_START, formatMinute, type TimelineGroup } from './space-timeline'
import type { AvailableRoom } from './types'
import { canWriteAdmin } from '@/lib/admin-roles'
import { todayInAppZone } from '@/lib/app-zone'
import { bostonWallClockNow } from '@/lib/boston-time'
import { groupRooms, useDayRooms } from './day-rooms'
import { requestRoomHref } from './request-link'

type ReservationType = 'room-request' | 'tabling'
type Mode = 'browse' | 'book'
type Source = 'all' | 'nusso' | 'registrar'

const field =
  'bg-[#0a1628] border border-[#1e5080] rounded-lg px-3 py-2 text-[#f0f6ff] text-sm focus:outline-none focus:border-[#c8102e] transition-colors'
const labelCls = 'block text-xs font-medium text-[#93b8d8] mb-1'
const stepBtn =
  'h-[42px] w-10 rounded-lg border border-[#1e5080] text-[#f0f6ff] hover:border-[#c8102e] transition-colors disabled:opacity-40 disabled:hover:border-[#1e5080]'

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function toMinute(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function groupBy<T>(items: T[], key: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(item)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

const byCode = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

function ResultsSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[0, 1, 2].map(g => (
        <div key={g} className="space-y-2">
          <Skeleton className="h-4 w-40" />
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-9 w-full border border-[#1e5080]" />)}
        </div>
      ))}
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-[#1e5080] rounded-xl p-8 text-center">
      <p className="text-[#93b8d8] text-sm">{children}</p>
    </div>
  )
}

/**
 * Browse/Book Rooms: NUSSO and the Registrar's 25Live rooms on one day-grid.
 *
 * Browse (the default, open to everyone) shows both systems' rooms with what is
 * booked in them. Book is NUSSO only, because NUSSO is the one Chambers can put
 * a reservation in; a Registrar room is requested from the Registrar, so it has
 * nothing to book here. Registrar rooms appear only while
 * REGISTRAR_SPACES_ENABLED is on (see lib/25live/client.ts).
 */
export default function SpacesPage({ registrarEnabled }: { registrarEnabled: boolean }) {
  const { isAdmin, isLeadership, adminRole } = useIdentity()
  // A view-only admin books nothing (#217) -- being an admin stops being the
  // thing that grants it, though Leadership still does.
  const canBook = (isAdmin && canWriteAdmin(adminRole)) || isLeadership
  // The same people the sidebar shows Request a Booking to.
  const canRequest = isLeadership || (isAdmin && canWriteAdmin(adminRole))

  // What booking through NUSSO makes you responsible for: up once per sign-in,
  // and reopenable from the header at any time.
  const notice = useResponsibilityNotice()

  const today = todayInAppZone()
  const [mode, setMode] = useState<Mode>('browse')
  const [reservationType, setReservationType] = useState<ReservationType>('room-request')
  const [date, setDate] = useState(today)
  const [start, setStart] = useState('12:00')
  const [end, setEnd] = useState('13:00')
  const [capacity, setCapacity] = useState('')
  const [query, setQuery] = useState('')
  const [building, setBuilding] = useState('')
  const [source, setSource] = useState<Source>('all')
  // Book only: hide rooms already taken for the chosen window.
  const [freeOnly, setFreeOnly] = useState(false)

  // NUSSO's own booking minimums (Management-configured), for Book-mode date limits.
  const [minDaysRoom, setMinDaysRoom] = useState(0)
  const [minDaysTabling, setMinDaysTabling] = useState(0)
  const minBookDate = mode === 'book'
    ? addDays(today, Math.max(0, reservationType === 'tabling' ? minDaysTabling : minDaysRoom))
    : undefined
  const clamp = useCallback((d: string) => (minBookDate && d < minBookDate ? minBookDate : d), [minBookDate])

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/nusso/settings')
        if (!res.ok) return
        const data = await res.json()
        if (!active) return
        setMinDaysRoom(data.minDaysRoom ?? 0)
        setMinDaysTabling(data.minDaysTabling ?? 0)
      } catch {
        /* leave minimums at 0 */
      }
    })()
    return () => { active = false }
  }, [])

  // Book mode never shows a day sooner than NUSSO allows.
  useEffect(() => { setDate(d => clamp(d)) }, [clamp])

  // --- The day: every room and what is booked in it -------------------------

  const showRegistrar = registrarEnabled && mode === 'browse'
  const day = useDayRooms(date, showRegistrar)
  const blocksByNussoRoom = day.nussoBlocksByRoom

  // --- Book: every NUSSO room this kind of reservation can use -------------
  //
  // Book draws the day like Browse does, and re-asks NUSSO whenever the window
  // changes, so the timeline always shows which rooms are free for it -- no
  // separate search step. Rooms NUSSO would not take this reservation type in
  // (a tabling table for a room request) are left out; taken ones stay, marked.

  type BookRoom = AvailableRoom & { Available: boolean }
  const [bookRooms, setBookRooms] = useState<BookRoom[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  // The window that produced the current rooms, so booking uses exactly what
  // the timeline showed even if the form is edited while a booking is open.
  const [searched, setSearched] = useState<{ date: string; start: string; end: string; type: ReservationType } | null>(null)
  const [bookRoom, setBookRoom] = useState<AvailableRoom | null>(null)
  const windowValid = start < end
  // Each search is numbered so a slow answer for an old window cannot land
  // after the answer for the current one.
  const searchSeq = useRef(0)

  const search = useCallback(async () => {
    if (!windowValid) return
    const seq = ++searchSeq.current
    setSearching(true)
    setSearchError(null)
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
          includeUnavailable: true,
        }),
      })
      const data = await res.json()
      if (seq !== searchSeq.current) return
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
      setBookRooms(Array.isArray(data.rooms) ? data.rooms : [])
      setSearched({ date, start, end, type: reservationType })
    } catch (err) {
      if (seq !== searchSeq.current) return
      setBookRooms(null)
      setSearchError(err instanceof Error ? err.message : 'Could not reach NUSSO.')
    } finally {
      if (seq === searchSeq.current) setSearching(false)
    }
  }, [date, start, end, capacity, reservationType, windowValid])

  // Re-ask shortly after the last change, so typing a capacity or stepping a
  // time picker does not send a request per keystroke.
  useEffect(() => {
    if (mode !== 'book' || !windowValid) return
    const timer = setTimeout(search, 350)
    return () => clearTimeout(timer)
  }, [mode, windowValid, search])

  const afterBooking = () => {
    setBookRoom(null)
    search()
    day.reload()
  }

  // --- What the grid draws ----------------------------------------------------

  const browseGroups = useMemo<TimelineGroup[]>(() => {
    const q = query.trim().toLowerCase()
    const cap = Number(capacity)
    const rooms = day.rooms.filter(r =>
      (source === 'all' || r.source === source) &&
      (!q || r.name.toLowerCase().includes(q) || r.building.toLowerCase().includes(q)) &&
      // An unknown capacity is kept: the system not knowing is not the room being small.
      (!(cap > 0) || r.capacity === null || r.capacity >= cap)
    )
    // Request this room: the form fills in the room and the day, and the
    // requester sets the time there. Only for people who can submit a request.
    return groupRooms(rooms, r => canRequest ? {
      action: (
        <Link
          href={requestRoomHref({ date, name: r.name, building: r.building, source: r.source, ref: r.ref })}
          prefetch={false}
          className="py-1 px-2.5 border border-[#1e5080] hover:border-[#c8102e] text-[#f0f6ff] text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
        >
          Request
        </Link>
      ),
    } : {})
  }, [day.rooms, query, capacity, source, canRequest, date])

  const buildingOptions = useMemo(
    () => browseGroups.map(g => ({ key: g.key, label: `${g.heading} (${g.source})` })).sort((a, b) => a.label.localeCompare(b.label)),
    [browseGroups]
  )
  const visibleBrowse = building ? browseGroups.filter(g => g.key === building) : browseGroups

  const bookGroups = useMemo<TimelineGroup[]>(() => {
    if (!bookRooms) return []
    const q = query.trim().toLowerCase()
    const rooms = bookRooms.filter(r =>
      (!q || r.RoomCode.toLowerCase().includes(q) || r.BuildingDescription.toLowerCase().includes(q)) &&
      (!freeOnly || r.Available)
    )
    return groupBy(rooms, r => r.BuildingDescription || 'Other locations').map(([bldg, list]) => ({
      key: `book:${bldg}`,
      heading: bldg,
      source: 'NUSSO',
      rows: list.sort((a, b) => byCode(a.RoomCode, b.RoomCode)).map(r => ({
        key: `b${r.RoomId}`,
        name: r.RoomCode,
        detail: searched?.type === 'room-request'
          ? `${r.Capacity} seats${r.MinCapacity > 0 ? ` · min ${r.MinCapacity}` : ''}`
          : (r.RoomDescription || 'tabling'),
        alert: r.Alert,
        blocks: blocksByNussoRoom.get(r.RoomId) ?? [],
        action: r.Available ? (
          <button
            onClick={() => setBookRoom(r)}
            className="py-1 px-3 bg-[#c8102e] hover:bg-[#a50d26] text-white text-sm font-medium rounded-lg transition-colors"
          >
            Book
          </button>
        ) : (
          <span className="text-[11px] text-[#6a96bb]">Booked</span>
        ),
      })),
    }))
  }, [bookRooms, searched, blocksByNussoRoom, query, freeOnly])
  const freeCount = bookRooms?.filter(r => r.Available).length ?? 0

  // Only drawn once data has arrived, which is always after hydration, so the
  // server's clock and the browser's never have to agree.
  const now = bostonWallClockNow()
  const nowMinute = date === today ? now.getUTCHours() * 60 + now.getUTCMinutes() : null

  const shownRooms = visibleBrowse.reduce((n, g) => n + g.rows.length, 0)
  const sourceErrors = day.errors
    .filter(e => source === 'all' || e.source === source || mode === 'book')
    .filter(e => mode === 'browse' || e.source === 'nusso')
    .map(e => `${e.source === 'nusso' ? 'NUSSO' : 'Registrar (25Live)'}: ${e.message}`)

  const stepDate = (delta: number) => setDate(d => clamp(addDays(d, delta)))

  return (
    <div className="flex flex-col gap-5 h-full min-h-0">
      <div className="flex-shrink-0 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[#f0f6ff]">Browse/Book Rooms</h1>
          <p className="text-sm text-[#93b8d8] mt-0.5">
            {registrarEnabled
              ? 'What is booked across NUSSO and the Registrar · book NUSSO rooms here, request Registrar rooms from the Registrar'
              : 'Find an available Northeastern event space · nuevents.neu.edu'}
          </p>
        </div>
        <ResponsibilitiesButton onClick={notice.reopen} />
      </div>

      <div className="flex-shrink-0 rounded-xl border border-[#1e5080] bg-[#0f2a4a] p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Browse / Book. Book is bookers only, and NUSSO only. */}
          <div className="inline-flex rounded-lg border border-[#1e5080] p-0.5">
            {(['browse', 'book'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
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
            {mode === 'browse'
              ? 'Viewing only — switch to Book to reserve a NUSSO room.'
              : 'Booking NUSSO rooms — Registrar rooms are requested from the Registrar. Dates before the NUSSO minimum are disabled.'}
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className={labelCls}>Date</span>
            <div className="flex items-center gap-2">
              <button onClick={() => stepDate(-1)} disabled={!!minBookDate && date <= minBookDate} aria-label="Previous day" className={stepBtn}>‹</button>
              <div className="w-40"><DateField value={date} min={minBookDate} onChange={v => v && setDate(clamp(v))} /></div>
              <button onClick={() => stepDate(1)} aria-label="Next day" className={stepBtn}>›</button>
              {mode === 'browse' && date !== today && (
                <button
                  onClick={() => setDate(today)}
                  className="h-[42px] px-3 rounded-lg border border-[#1e5080] text-sm text-[#f0f6ff] hover:border-[#c8102e] transition-colors"
                >
                  Today
                </button>
              )}
            </div>
          </div>

          {mode === 'browse' ? (
            <>
              {registrarEnabled && (
                <div>
                  <span className={labelCls}>Rooms from</span>
                  <div className="inline-flex rounded-lg border border-[#1e5080] p-0.5 h-[42px] items-center">
                    {([['all', 'All'], ['nusso', 'NUSSO'], ['registrar', 'Registrar']] as [Source, string][]).map(([s, label]) => (
                      <button
                        key={s}
                        onClick={() => { setSource(s); setBuilding('') }}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          source === s ? 'bg-[#c8102e] text-white' : 'text-[#93b8d8] hover:text-[#f0f6ff]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className={labelCls} htmlFor="s-building">Building</label>
                <select id="s-building" className={`${field} h-[42px] max-w-[16rem]`} value={building} onChange={e => setBuilding(e.target.value)}>
                  <option value="">All buildings</option>
                  {buildingOptions.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="s-query">Room</label>
                <input id="s-query" className={`${field} w-32 h-[42px]`} placeholder="e.g. RY 405" value={query} onChange={e => setQuery(e.target.value)} />
              </div>
              <div>
                <label className={labelCls} htmlFor="s-cap">Min. capacity</label>
                <input id="s-cap" type="number" min={0} placeholder="any" className={`${field} w-24 h-[42px]`} value={capacity} onChange={e => setCapacity(e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div>
                <span className={labelCls}>Type</span>
                <div className="inline-flex rounded-lg border border-[#1e5080] p-0.5 h-[42px] items-center">
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
                  <label className={labelCls} htmlFor="s-bcap">Min. capacity</label>
                  <input id="s-bcap" type="number" min={0} placeholder="any" className={`${field} w-24 h-[42px]`} value={capacity} onChange={e => setCapacity(e.target.value)} />
                </div>
              )}
              <div>
                <label className={labelCls} htmlFor="s-bquery">Room</label>
                <input id="s-bquery" className={`${field} w-32 h-[42px]`} placeholder="e.g. CSC 333" value={query} onChange={e => setQuery(e.target.value)} />
              </div>
              <label className="h-[42px] flex items-center gap-2 text-sm text-[#93b8d8] cursor-pointer select-none">
                <input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)} className="accent-[#c8102e]" />
                Free rooms only
              </label>
            </>
          )}
        </div>
        {mode === 'book' && !windowValid && <p className="text-xs text-[#c8102e]">End time must be after start time.</p>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        {sourceErrors.length > 0 && !(mode === 'book' && searchError) && (
          <div className="rounded-xl border border-[#1e5080] bg-[#184073] px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex-1 min-w-0 space-y-0.5">
              {sourceErrors.map(e => <p key={e} className="text-sm text-[#f0f6ff]">{e}</p>)}
            </div>
            <button
              onClick={day.reload}
              className="py-1.5 px-3 bg-[#c8102e] hover:bg-[#a50d26] text-white text-sm font-medium rounded-lg transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {mode === 'browse' ? (
          day.loading && day.rooms.length === 0 ? (
            <ResultsSkeleton />
          ) : shownRooms === 0 ? (
            sourceErrors.length > 0 ? null : <Notice>No rooms match those filters.</Notice>
          ) : (
            <div className={`space-y-4 transition-opacity ${day.loading ? 'opacity-50' : ''}`}>
              <p className="text-sm text-[#93b8d8]">
                {shownRooms} {shownRooms === 1 ? 'room' : 'rooms'} · shaded blocks are booked
              </p>
              <SpaceTimeline groups={visibleBrowse} nowMinute={nowMinute} />
              {showRegistrar && source !== 'nusso' && day.registrarAvailable && (
                <p className="text-xs text-[#6a96bb] pb-2">
                  Registrar rooms come from 25Live&apos;s public view, refreshed every few minutes. One that looks free can still be held for something 25Live does not show publicly, so confirm with the Registrar before you plan around it.
                </p>
              )}
            </div>
          )
        ) : searchError ? (
          <div className="border border-[#1e5080] rounded-xl bg-[#184073] p-6 max-w-md">
            <p className="text-[#f0f6ff] font-medium mb-1">Couldn&apos;t load NUSSO rooms</p>
            <p className="text-sm text-[#93b8d8] mb-4">{searchError}</p>
            <button onClick={search} className="py-2 px-4 bg-[#c8102e] hover:bg-[#a50d26] text-white text-sm font-medium rounded-lg transition-colors">Try again</button>
          </div>
        ) : !windowValid ? (
          <Notice>Set an end time after the start time to see which rooms are free.</Notice>
        ) : bookRooms === null ? (
          <ResultsSkeleton />
        ) : bookGroups.length === 0 ? (
          <Notice>
            {freeOnly && bookRooms.length > 0
              ? 'Nothing that matches is free for that time. Try another time, or untick "Free rooms only" to see what is booked.'
              : `No ${reservationType === 'tabling' ? 'tabling locations' : 'rooms'} match. Try a smaller capacity or another search.`}
          </Notice>
        ) : (
          <div className={`space-y-4 transition-opacity ${searching ? 'opacity-50' : ''}`}>
            <p className="text-sm text-[#93b8d8]">
              {freeCount} of {bookRooms.length} {reservationType === 'tabling' ? 'tabling locations' : 'rooms'} free for {formatMinute(toMinute(start))}–{formatMinute(toMinute(end))} · the green band is your time
            </p>
            <SpaceTimeline
              groups={bookGroups}
              nowMinute={nowMinute}
              window={{ startMinute: Math.max(toMinute(start), DAY_START), endMinute: Math.min(toMinute(end), DAY_END) }}
            />
          </div>
        )}
      </div>

      {bookRoom && searched && searched.type === 'room-request' && (
        <NussoBookModal
          room={bookRoom}
          date={searched.date}
          start={searched.start}
          end={searched.end}
          onClose={() => setBookRoom(null)}
          onSuccess={afterBooking}
        />
      )}
      {bookRoom && searched && searched.type === 'tabling' && (
        <NussoTablingModal
          room={bookRoom}
          date={searched.date}
          start={searched.start}
          end={searched.end}
          onClose={() => setBookRoom(null)}
          onSuccess={afterBooking}
        />
      )}

      {notice.open && <ResponsibilityModal onClose={notice.close} />}
    </div>
  )
}
