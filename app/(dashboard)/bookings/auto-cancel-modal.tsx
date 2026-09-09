'use client'

import { useCallback, useEffect, useState } from 'react'
import BookingModal from './booking-modal'

interface CancellationLine {
  /** `${source}:${id}` — how the server identifies this row when it comes back. */
  key: string
  date: string
  startTime: string
  endTime: string
  reservationCode: string
  roomOrTable: string
  bodyName: string
  bookingType: 'One-Time Room' | 'Weekly Room' | 'Tabling'
}

/** Pending, but with no reservation code, so it can neither be sent nor cancelled. */
interface SkippedReservation {
  date: string
  roomOrTable: string
  bodyName: string
  bookingType: 'One-Time Room' | 'Weekly Room' | 'Tabling'
}

function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
function formatTime(t: string) {
  if (!t) return '—'
  const [h, m] = t.split(':').map(Number)
  if (Number.isNaN(h)) return '—'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

/**
 * Lists every reservation marked for cancellation and lets an admin choose which
 * ones to ask CSC to release.
 *
 * Nothing is selected when this opens. Including a reservation is an act, not a
 * default -- the send is an email to a university office that will act on it and
 * a status change in Chambers, neither of which can be taken back.
 */
export default function AutoCancelModal({ onClose }: { onClose: () => void }) {
  const [lines, setLines] = useState<CancellationLine[]>([])
  const [skipped, setSkipped] = useState<SkippedReservation[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [recipient, setRecipient] = useState('')
  const [cc, setCc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sentCount, setSentCount] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/administrator/cancellations/auto-cancel')
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load the list.')
      const data = await res.json()
      setLines(data.lines ?? [])
      setSkipped(data.skipped ?? [])
      setRecipient(data.recipient ?? '')
      setCc(data.cc ?? null)
      // Any previous ticks are dropped on a reload. The list may have moved, and
      // carrying a selection across it would mean approving rows never seen.
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the list.')
      setLines([])
      setSkipped([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const allSelected = lines.length > 0 && selected.size === lines.length

  const send = async () => {
    setSending(true)
    setError('')
    const res = await fetch('/api/administrator/cancellations/auto-cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: [...selected] }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setSentCount(data.sent ?? selected.size)
    } else {
      setError(data.error || 'The request could not be sent.')
      // Whatever went wrong, the list on screen may no longer be the truth.
      load()
    }
    setSending(false)
  }

  if (sentCount !== null) {
    return (
      <BookingModal title="Cancellation Request Sent" onClose={onClose}>
        <div className="space-y-4">
          <p className="text-sm text-[#f0f6ff]">
            Sent {sentCount} reservation{sentCount === 1 ? '' : 's'} to <span className="font-medium">{recipient}</span>
            {cc && <>, copying <span className="font-medium">{cc}</span></>}.
          </p>
          <p className="text-sm text-[#93b8d8]">
            Those {sentCount === 1 ? 'booking is' : 'bookings are'} now marked <span className="text-[#f0f6ff]">Cancelled</span> in Chambers.
            Anything you left unticked is untouched and still pending.
          </p>
          <button onClick={onClose} className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors">
            Close
          </button>
        </div>
      </BookingModal>
    )
  }

  return (
    <BookingModal title="Auto-Cancel — Request CSC Cancellation" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-[#93b8d8]">
          Every booking marked <span className="text-[#fb923c] font-medium">Pending Cancellation</span> is listed below.
          Tick the ones to include; CSC gets a single request with the date, time and reservation code of each,
          and those bookings are then marked <span className="text-[#f0f6ff]">Cancelled</span>.
        </p>

        <div className="border-t border-[#1e5080] pt-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#6a96bb]">
              {loading
                ? 'Loading…'
                : lines.length === 0
                ? 'Nothing pending cancellation'
                : `${selected.size} of ${lines.length} selected`}
            </p>
            {!loading && lines.length > 0 && (
              <button
                onClick={() => setSelected(allSelected ? new Set() : new Set(lines.map(l => l.key)))}
                className="text-xs text-[#93b8d8] hover:text-[#f0f6ff] underline underline-offset-2 transition-colors"
              >
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            )}
          </div>

          {!loading && lines.length > 0 && (
            <div className="max-h-64 overflow-y-auto border border-[#1e5080] rounded-lg divide-y divide-[#1e5080]">
              {lines.map(l => {
                const isOn = selected.has(l.key)
                return (
                  <label
                    key={l.key}
                    className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                      isOn ? 'bg-[#1a4d8a]/50' : 'hover:bg-[#1a4d8a]/25'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => toggle(l.key)}
                      className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[#c8102e] cursor-pointer"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-sm text-[#f0f6ff]">{formatDate(l.date)}</span>
                        <span className="text-xs text-[#93b8d8] flex-shrink-0">{formatTime(l.startTime)} – {formatTime(l.endTime)}</span>
                      </span>
                      <span className="flex items-baseline justify-between gap-2 mt-0.5">
                        <span className="text-xs text-[#6a96bb] truncate">{l.bodyName} · {l.roomOrTable}</span>
                        <span className="text-xs font-mono text-[#93b8d8] flex-shrink-0">{l.reservationCode}</span>
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          )}

          {!loading && lines.length === 0 && (
            <p className="text-sm text-[#6a96bb]">
              {skipped.length > 0
                ? 'Nothing with a reservation code is marked Pending Cancellation.'
                : 'Nothing is marked Pending Cancellation.'}
            </p>
          )}
        </div>

        {/*
          Shown, not hidden. These are pending cancellations this tool cannot
          action -- without a code CSC has nothing to look up, and cancelling them
          in Chambers anyway would put the two systems out of step. They are not
          selectable, and an admin needs to know they are still outstanding.
        */}
        {skipped.length > 0 && !loading && (
          <div className="border border-[#fb923c]/40 bg-[#3d2200]/40 rounded-lg px-3 py-2.5">
            <p className="text-xs text-[#fb923c] font-medium mb-1">
              {skipped.length} not listed — no reservation code
            </p>
            <p className="text-xs text-[#93b8d8] mb-1.5">
              These cannot be sent or cancelled here. Add the code to the booking, or handle them with CSC directly.
            </p>
            <ul className="text-xs text-[#6a96bb] space-y-0.5">
              {skipped.slice(0, 5).map((sk, i) => (
                <li key={i}>{formatDate(sk.date)} · {sk.bodyName} · {sk.roomOrTable}</li>
              ))}
              {skipped.length > 5 && <li>…and {skipped.length - 5} more</li>}
            </ul>
          </div>
        )}

        {error && <p className="text-[#c8102e] text-sm">{error}</p>}

        {!loading && selected.size > 0 && (
          <p className="text-xs text-[#6a96bb]">
            Goes to <span className="text-[#93b8d8]">{recipient || 'CSC'}</span>
            {cc && <>, copying <span className="text-[#93b8d8]">{cc}</span></>}.
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={send}
            disabled={sending || loading || selected.size === 0}
            className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {sending ? 'Sending…' : `Send & mark cancelled (${selected.size})`}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[#1e5080] text-[#f0f6ff] text-sm rounded-lg hover:bg-[#1a4d8a] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </BookingModal>
  )
}
