'use client'

import { useState } from 'react'
import type { AvailableRoom } from './types'

/**
 * Confirm-and-book modal for a NUSSO **tabling** reservation. Opened from a
 * search result (room + window already chosen). Kept separate from the
 * room-request modal because tabling is a different EMS reservation type with a
 * required free-text description (UDF 77); it posts with
 * reservationType: 'tabling' so the server applies the tabling profile.
 */
interface NussoTablingModalProps {
  room: AvailableRoom
  date: string
  start: string
  end: string
  onClose: () => void
  onSuccess: (reservationId: number) => void
}

/** The tabling free-text description UDF (see the tabling profile). */
const UDF_DESCRIPTION = 77

const label = 'block text-sm font-medium text-[#93b8d8] mb-1'
const field =
  'w-full bg-[#0a1628] border border-[#1e5080] rounded-lg px-3 py-2 text-[#f0f6ff] text-sm focus:outline-none focus:border-[#c8102e] transition-colors'

function pretty(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

export default function NussoTablingModal({ room, date, start, end, onClose, onSuccess }: NussoTablingModalProps) {
  const [eventName, setEventName] = useState('')
  const [description, setDescription] = useState('')
  const [attendance, setAttendance] = useState('1')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ id: number } | null>(null)

  const dateLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })

  const handleBook = async () => {
    const n = Number(attendance)
    if (!eventName.trim() || !description.trim() || !Number.isFinite(n) || n < 1) {
      setError('Enter an event name, a description, and an attendance of at least 1.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/nusso/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservationType: 'tabling',
          roomId: room.RoomId,
          setupTypeId: room.DefaultSetupTypeId,
          attendance: n,
          eventName: eventName.trim(),
          date, start, end,
          udfs: [{ Id: UDF_DESCRIPTION, FieldType: 1, Answer: description.trim(), Required: true }],
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'The tabling booking was rejected.')
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
          <h2 className="text-lg font-semibold text-[#f0f6ff]">{done ? 'Tabling reserved' : 'Book tabling'}</h2>
          <button onClick={onClose} className="text-[#93b8d8] hover:text-[#f0f6ff] transition-colors" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {done ? (
          <div className="px-6 py-6 space-y-3">
            <p className="text-sm text-[#f0f6ff]">Tabling reservation <span className="font-semibold">#{done.id}</span> was created on NUSSO.</p>
            <p className="text-sm text-[#93b8d8]">A confirmation email has been sent to the SGA operations address.</p>
            <button onClick={() => onSuccess(done.id)} className="w-full py-2.5 px-4 bg-[#c8102e] hover:bg-[#a50d26] text-white text-sm font-medium rounded-lg transition-colors">Done</button>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 space-y-4">
              <div className="rounded-lg border border-[#1e5080] bg-[#0f2a4a] px-4 py-3">
                <p className="text-sm text-[#f0f6ff] font-medium">{room.BuildingDescription ? `${room.BuildingDescription} — ` : ''}{room.RoomCode}</p>
                <p className="text-xs text-[#93b8d8] mt-0.5">{dateLabel} · {pretty(start)} – {pretty(end)}</p>
              </div>

              <div>
                <label className={label} htmlFor="t-event">Event name</label>
                <input id="t-event" className={field} value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g. SGA Membership Drive" maxLength={100} autoFocus />
              </div>
              <div>
                <label className={label} htmlFor="t-desc">Describe the nature of this tabling event</label>
                <textarea id="t-desc" className={`${field} min-h-[72px] resize-y`} value={description} onChange={e => setDescription(e.target.value)} placeholder="What the table is for, what you'll be handing out, etc." maxLength={500} />
                <p className="text-xs text-[#93b8d8] mt-1">Required by NUSSO for tabling requests.</p>
              </div>
              <div>
                <label className={label} htmlFor="t-att">Expected attendance</label>
                <input id="t-att" type="number" min={1} className={field} value={attendance} onChange={e => setAttendance(e.target.value)} />
              </div>

              {error && (
                <div className="rounded-lg border border-[#c8102e]/50 bg-[#c8102e]/10 px-4 py-3">
                  <p className="text-sm text-[#f0f6ff]">{error}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#1e5080]">
              <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg text-[#93b8d8] hover:text-[#f0f6ff] transition-colors">Cancel</button>
              <button onClick={handleBook} disabled={submitting || !eventName.trim() || !description.trim()} className="text-sm px-4 py-2 rounded-lg bg-[#c8102e] hover:bg-[#a50d26] text-white font-medium disabled:opacity-40 transition-colors">
                {submitting ? 'Booking…' : 'Book tabling'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
