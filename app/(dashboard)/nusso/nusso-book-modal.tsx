'use client'

import { useState } from 'react'
import type { AvailableRoom } from './types'
import BookingScopeSelector, { type BookingScopeValue } from '@/app/_components/booking-scope-selector'
import { useScopeContext, EMPTY_SCOPE, isScopeComplete } from './use-scope-context'

/**
 * Confirm-and-book modal for a NUSSO room request. Opened from a search result,
 * so the room and time window are already chosen -- this only collects the event
 * name and attendance and posts the reservation. Tabling has its own modal
 * (nusso-tabling-modal.tsx) because it needs extra fields.
 */
interface NussoBookModalProps {
  room: AvailableRoom
  date: string
  start: string
  end: string
  onClose: () => void
  onSuccess: (reservationId: number) => void
}

const label = 'block text-sm font-medium text-[#93b8d8] mb-1'
const field =
  'w-full bg-[#0a1628] border border-[#1e5080] rounded-lg px-3 py-2 text-[#f0f6ff] text-sm focus:outline-none focus:border-[#c8102e] transition-colors'

/** "18:00" -> "6:00 PM" */
function pretty(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

export default function NussoBookModal({ room, date, start, end, onClose, onSuccess }: NussoBookModalProps) {
  const scopeCtx = useScopeContext()
  const [scope, setScope] = useState<BookingScopeValue>(EMPTY_SCOPE)
  const [eventName, setEventName] = useState('')
  const [attendance, setAttendance] = useState(String(Math.max(1, room.MinCapacity || 1)))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ id: number } | null>(null)

  const roomName = `${room.BuildingDescription ? `${room.BuildingDescription} — ` : ''}${room.RoomCode}`

  const dateLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })

  const handleBook = async () => {
    const n = Number(attendance)
    if (!eventName.trim() || !Number.isFinite(n) || n < 1) {
      setError('Enter an event name and an attendance of at least 1.')
      return
    }
    if (!isScopeComplete(scope)) {
      setError('Choose which body this booking is for.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/nusso/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservationType: 'room-request',
          roomId: room.RoomId,
          setupTypeId: room.DefaultSetupTypeId,
          attendance: n,
          eventName: eventName.trim(),
          roomName,
          date, start, end,
          scope: scope.scope,
          body_id: scope.body_id,
          division: scope.division,
          body_ids: scope.body_ids,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'The booking was rejected.')
        return
      }
      setDone({ id: data.reservationId })
    } catch {
      setError('Could not reach NUSSO.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0a1628] border border-[#1e5080] rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e5080]">
          <h2 className="text-lg font-semibold text-[#f0f6ff]">{done ? 'Reservation created' : 'Book this room'}</h2>
          <button onClick={onClose} className="text-[#93b8d8] hover:text-[#f0f6ff] transition-colors" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {done ? (
          <div className="px-6 py-6 space-y-3">
            <p className="text-sm text-[#f0f6ff]">Reservation <span className="font-semibold">#{done.id}</span> was created on NUSSO.</p>
            <p className="text-sm text-[#93b8d8]">A confirmation email has been sent to the SGA operations address.</p>
            <button onClick={() => onSuccess(done.id)} className="w-full py-2.5 px-4 bg-[#c8102e] hover:bg-[#a50d26] text-white text-sm font-medium rounded-lg transition-colors">Done</button>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 space-y-4">
              <div className="rounded-lg border border-[#1e5080] bg-[#0f2a4a] px-4 py-3">
                <p className="text-sm text-[#f0f6ff] font-medium">{room.BuildingDescription ? `${room.BuildingDescription} — ` : ''}{room.RoomCode}</p>
                <p className="text-xs text-[#93b8d8] mt-0.5">{dateLabel} · {pretty(start)} – {pretty(end)} · seats up to {room.Capacity}</p>
              </div>

              <div>
                <label className={label} htmlFor="b-event">Event name</label>
                <div className="flex items-center">
                  <span className="text-sm text-[#93b8d8] bg-[#0a1628] border border-r-0 border-[#1e5080] rounded-l-lg px-3 py-2 whitespace-nowrap">SGA -</span>
                  <input id="b-event" className={`${field} rounded-l-none`} value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g. Senate Meeting" maxLength={90} autoFocus />
                </div>
              </div>
              <div>
                <label className={label} htmlFor="b-att">Expected attendance</label>
                <input id="b-att" type="number" min={1} className={field} value={attendance} onChange={e => setAttendance(e.target.value)} />
              </div>

              {/* Which body (and scope) the booking is recorded under in Chambers. */}
              {scopeCtx.error ? (
                <p className="text-sm text-[#c8102e]">Couldn&apos;t load your bodies. Reopen and try again.</p>
              ) : scopeCtx.loading ? (
                <p className="text-sm text-[#93b8d8]">Loading your bodies…</p>
              ) : (
                <BookingScopeSelector
                  value={scope}
                  onChange={setScope}
                  ownerBodies={scopeCtx.ownerBodies}
                  allBodies={scopeCtx.allBodies}
                  allowedDivisions={scopeCtx.allowedDivisions}
                />
              )}

              {error && (
                <div className="rounded-lg border border-[#c8102e]/50 bg-[#c8102e]/10 px-4 py-3">
                  <p className="text-sm text-[#f0f6ff]">{error}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#1e5080]">
              <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg text-[#93b8d8] hover:text-[#f0f6ff] transition-colors">Cancel</button>
              <button onClick={handleBook} disabled={submitting || !eventName.trim() || !isScopeComplete(scope)} className="text-sm px-4 py-2 rounded-lg bg-[#c8102e] hover:bg-[#a50d26] text-white font-medium disabled:opacity-40 transition-colors">
                {submitting ? 'Booking…' : 'Book room'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
