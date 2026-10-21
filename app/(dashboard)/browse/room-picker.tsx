'use client'

import { useMemo, useState } from 'react'
import { Skeleton } from '@/app/_components/skeleton'
import SpaceTimeline, { DAY_END, DAY_START, formatMinute } from './space-timeline'
import { groupRooms, isBusy, useDayRooms, type DayRoom, type RoomSource } from './day-rooms'

function toMinute(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function formatDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const field =
  'bg-[#0a1628] border border-[#1e5080] rounded-lg px-3 py-2 text-[#f0f6ff] text-sm focus:outline-none focus:border-[#c8102e] transition-colors'

/**
 * "Find a room" for one session of a one-time request: the Browse/Book Rooms
 * timeline for that day, with the session's window highlighted, where picking a
 * room fills the session's Preferred Room.
 *
 * It only suggests. The request still goes to Operational Affairs, who book or
 * ask the Registrar; a room that is free here can be gone by then.
 */
export default function RoomPicker({
  date,
  start,
  end,
  onPick,
  onClose,
}: {
  date: string
  start: string
  end: string
  onPick: (room: DayRoom) => void
  onClose: () => void
}) {
  // Always asks for the Registrar rooms; while they are switched off the hook
  // reads the API's 404 as "not available" and the picker is NUSSO only.
  const day = useDayRooms(date, true)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<'all' | RoomSource>('all')
  const [freeOnly, setFreeOnly] = useState(true)

  const startMinute = toMinute(start)
  const endMinute = toMinute(end)

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rooms = day.rooms.filter(r =>
      (source === 'all' || r.source === source) &&
      (!q || r.name.toLowerCase().includes(q) || r.building.toLowerCase().includes(q)) &&
      (!freeOnly || !isBusy(r, startMinute, endMinute))
    )
    return groupRooms(rooms, r => ({
      action: isBusy(r, startMinute, endMinute)
        ? <span className="text-[11px] text-[#6a96bb]">Booked</span>
        : (
          <button
            onClick={() => onPick(r)}
            className="py-1 px-3 bg-[#c8102e] hover:bg-[#a50d26] text-white text-xs font-medium rounded-lg transition-colors"
          >
            Pick
          </button>
        ),
    }))
  }, [day.rooms, query, source, freeOnly, startMinute, endMinute, onPick])

  const shown = groups.reduce((n, g) => n + g.rows.length, 0)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#0a1628] border border-[#1e5080] rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Find a room"
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[#1e5080]">
          <div>
            <h2 className="text-lg font-semibold text-[#f0f6ff]">Find a room</h2>
            <p className="text-xs text-[#93b8d8] mt-0.5">
              {formatDay(date)} · {formatMinute(startMinute)}–{formatMinute(endMinute)} · the green band is your session
            </p>
          </div>
          <button onClick={onClose} className="text-[#93b8d8] hover:text-[#f0f6ff] transition-colors" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="px-6 py-3 border-b border-[#1e5080] flex flex-wrap items-center gap-3">
          <input className={`${field} w-44`} placeholder="Room or building" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search rooms" />
          {day.registrarAvailable && (
            <div className="inline-flex rounded-lg border border-[#1e5080] p-0.5">
              {([['all', 'All'], ['nusso', 'NUSSO'], ['registrar', 'Registrar']] as ['all' | RoomSource, string][]).map(([s, label]) => (
                <button
                  key={s}
                  onClick={() => setSource(s)}
                  className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                    source === s ? 'bg-[#c8102e] text-white' : 'text-[#93b8d8] hover:text-[#f0f6ff]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-[#93b8d8] cursor-pointer select-none">
            <input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)} className="accent-[#c8102e]" />
            Free for my session only
          </label>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          {day.errors.length > 0 && (
            <div className="rounded-lg border border-[#1e5080] bg-[#184073] px-4 py-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0 space-y-0.5">
                {day.errors.map(e => (
                  <p key={e.source} className="text-sm text-[#f0f6ff]">{e.source === 'nusso' ? 'NUSSO' : 'Registrar (25Live)'}: {e.message}</p>
                ))}
              </div>
              <button onClick={day.reload} className="py-1.5 px-3 bg-[#c8102e] hover:bg-[#a50d26] text-white text-sm font-medium rounded-lg transition-colors">Try again</button>
            </div>
          )}
          {day.loading && day.rooms.length === 0 ? (
            <div className="space-y-2 animate-pulse">
              {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-9 w-full border border-[#1e5080]" />)}
            </div>
          ) : shown === 0 ? (
            <p className="text-sm text-[#93b8d8] text-center py-8">
              {freeOnly ? 'No room matching that is free for your whole session. Untick "Free for my session only" to see booked rooms too.' : 'No rooms match.'}
            </p>
          ) : (
            <SpaceTimeline
              groups={groups}
              nowMinute={null}
              window={{ startMinute: Math.max(startMinute, DAY_START), endMinute: Math.min(endMinute, DAY_END) }}
            />
          )}
        </div>

        <p className="px-6 py-3 border-t border-[#1e5080] text-xs text-[#6a96bb]">
          Picking a room fills in your preference. Operational Affairs still books it, or asks the Registrar for a Registrar room, and a room that is free now can be taken by then.
        </p>
      </div>
    </div>
  )
}
