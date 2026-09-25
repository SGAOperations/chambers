'use client'

import { useState, useEffect, useCallback } from 'react'

/** A room option from /api/nusso/rooms. */
interface RoomOption {
  RoomId: number
  RoomCode: string
  RoomDescription: string
  BuildingDescription: string
  Capacity: number
  DefaultSetupTypeId: number
}

interface AvailabilityRoom {
  RoomId: number
  Capacity: number
  DefaultSetupTypeId: number
  AvailableSetupTypes: string
  Alert: string | null
}

interface NussoBookModalProps {
  /** Day the calendar is showing, prefilled as the booking date. */
  initialDate: string
  onClose: () => void
  onSuccess: (reservationId: number) => void
}

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; room: AvailabilityRoom }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

const label = 'block text-sm font-medium text-[#93b8d8] mb-1'
const field =
  'w-full bg-[#0a1628] border border-[#1e5080] rounded-lg px-3 py-2 text-[#f0f6ff] text-sm focus:outline-none focus:border-[#c8102e] transition-colors'

export default function NussoBookModal({ initialDate, onClose, onSuccess }: NussoBookModalProps) {
  const [rooms, setRooms] = useState<RoomOption[]>([])
  const [roomsLoading, setRoomsLoading] = useState(true)
  const [roomsError, setRoomsError] = useState(false)

  const [roomId, setRoomId] = useState<number | null>(null)
  const [date, setDate] = useState(initialDate)
  const [start, setStart] = useState('18:00')
  const [end, setEnd] = useState('19:00')
  const [attendance, setAttendance] = useState('10')
  const [eventName, setEventName] = useState('')

  const [check, setCheck] = useState<CheckState>({ status: 'idle' })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const selectedRoom = rooms.find(r => r.RoomId === roomId)

  const loadRooms = useCallback(async (forDate: string) => {
    setRoomsLoading(true)
    setRoomsError(false)
    try {
      const res = await fetch(`/api/nusso/rooms?date=${forDate}`)
      if (!res.ok) throw new Error(`rooms ${res.status}`)
      const data = await res.json()
      const list: RoomOption[] = Array.isArray(data.rooms) ? data.rooms : []
      setRooms(list)
      setRoomId(prev => prev ?? (list[0]?.RoomId ?? null))
    } catch {
      setRooms([])
      setRoomsError(true)
    } finally {
      setRoomsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRooms(date)
  }, [date, loadRooms])

  // Any change to the window invalidates a prior availability check.
  useEffect(() => {
    setCheck({ status: 'idle' })
  }, [roomId, date, start, end])

  const windowValid = start < end

  const handleCheck = async () => {
    if (roomId == null || !windowValid) return
    setCheck({ status: 'checking' })
    try {
      const res = await fetch('/api/nusso/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, date, start, end }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCheck({ status: 'error', message: data.error ?? 'Could not check availability.' })
        return
      }
      setCheck(data.available && data.room ? { status: 'available', room: data.room } : { status: 'unavailable' })
    } catch {
      setCheck({ status: 'error', message: 'Could not reach NUSSO.' })
    }
  }

  const handleBook = async () => {
    if (roomId == null || !selectedRoom || !windowValid) return
    const attendanceNum = Number(attendance)
    if (!eventName.trim() || !Number.isFinite(attendanceNum) || attendanceNum < 1) {
      setSubmitError('Enter an event name and an attendance of at least 1.')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const setupTypeId =
        check.status === 'available' ? check.room.DefaultSetupTypeId : selectedRoom.DefaultSetupTypeId
      const res = await fetch('/api/nusso/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          setupTypeId,
          attendance: attendanceNum,
          eventName: eventName.trim(),
          date,
          start,
          end,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(data.error ?? 'The booking was rejected.')
        return
      }
      onSuccess(data.reservationId)
    } catch {
      setSubmitError('Could not reach NUSSO.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#0a1628] border border-[#1e5080] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e5080]">
          <h2 className="text-lg font-semibold text-[#f0f6ff]">Book a NUSSO space</h2>
          <button onClick={onClose} className="text-[#93b8d8] hover:text-[#f0f6ff] transition-colors" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className={label} htmlFor="nusso-event">Event name</label>
            <input id="nusso-event" className={field} value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g. SGA Senate Meeting" maxLength={100} />
          </div>

          <div>
            <label className={label} htmlFor="nusso-room">Room</label>
            {roomsError ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#c8102e]">Couldn&apos;t load rooms.</span>
                <button onClick={() => loadRooms(date)} className="text-sm text-[#93b8d8] underline hover:text-[#f0f6ff]">Retry</button>
              </div>
            ) : (
              <select
                id="nusso-room"
                className={field}
                disabled={roomsLoading}
                value={roomId ?? ''}
                onChange={e => setRoomId(Number(e.target.value))}
              >
                {roomsLoading && <option>Loading rooms…</option>}
                {!roomsLoading && rooms.length === 0 && <option>No rooms found for this date</option>}
                {rooms.map(r => (
                  <option key={r.RoomId} value={r.RoomId}>
                    {r.BuildingDescription ? `${r.BuildingDescription} — ` : ''}{r.RoomCode}{r.Capacity ? ` (cap. ${r.Capacity})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label} htmlFor="nusso-date">Date</label>
              <input id="nusso-date" type="date" className={field} value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="nusso-start">Start</label>
              <input id="nusso-start" type="time" className={field} value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="nusso-end">End</label>
              <input id="nusso-end" type="time" className={field} value={end} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>
          {!windowValid && <p className="text-xs text-[#c8102e]">End time must be after start time.</p>}

          <div>
            <label className={label} htmlFor="nusso-att">Expected attendance</label>
            <input id="nusso-att" type="number" min={1} className={field} value={attendance} onChange={e => setAttendance(e.target.value)} />
          </div>

          {/* Availability check */}
          <div className="rounded-lg border border-[#1e5080] bg-[#0f2a4a] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-[#93b8d8]">Availability</span>
              <button
                onClick={handleCheck}
                disabled={roomId == null || !windowValid || check.status === 'checking'}
                className="text-sm px-3 py-1.5 rounded-lg border border-[#1e5080] text-[#f0f6ff] hover:bg-white/10 disabled:opacity-40 transition-colors"
              >
                {check.status === 'checking' ? 'Checking…' : 'Check availability'}
              </button>
            </div>
            {check.status === 'available' && <p className="text-sm text-emerald-400 mt-2">This room is free for the selected time.</p>}
            {check.status === 'unavailable' && <p className="text-sm text-[#c8102e] mt-2">Not available for that time — the booking will likely be rejected.</p>}
            {check.status === 'error' && <p className="text-sm text-[#c8102e] mt-2">{check.message}</p>}
            {check.status === 'available' && check.room.Alert && (
              <p className="text-xs text-amber-300/90 mt-2 whitespace-pre-line">⚠ {check.room.Alert}</p>
            )}
          </div>

          {submitError && (
            <div className="rounded-lg border border-[#c8102e]/50 bg-[#c8102e]/10 px-4 py-3">
              <p className="text-sm text-[#f0f6ff]">{submitError}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#1e5080]">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg text-[#93b8d8] hover:text-[#f0f6ff] transition-colors">Cancel</button>
          <button
            onClick={handleBook}
            disabled={submitting || roomId == null || !windowValid || !eventName.trim()}
            className="text-sm px-4 py-2 rounded-lg bg-[#c8102e] hover:bg-[#a50d26] text-white font-medium disabled:opacity-40 transition-colors"
          >
            {submitting ? 'Booking…' : 'Book space'}
          </button>
        </div>
      </div>
    </div>
  )
}
