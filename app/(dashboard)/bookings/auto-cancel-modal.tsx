'use client'

import { useCallback, useEffect, useState } from 'react'
import BookingModal from './booking-modal'

interface CancellationLine {
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

type TypeFilter = 'all' | 'One-Time Room' | 'Weekly Room' | 'Tabling'

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'One-Time Room', label: 'One-Time' },
  { value: 'Weekly Room', label: 'Weekly' },
  { value: 'Tabling', label: 'Tabling' },
]

const inputCls = "w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2 text-sm text-[#f0f6ff] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"

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
 * Builds the cancellation request CSC receives, and shows it before it goes.
 *
 * The preview is not a courtesy. This is the only mail Chambers sends outside
 * SGA, it goes to a university office that will act on it, and it cannot be
 * recalled -- so the admin approves the actual list rather than a count, and the
 * send button says who it is going to.
 */
export default function AutoCancelModal({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<TypeFilter>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [lines, setLines] = useState<CancellationLine[]>([])
  const [skipped, setSkipped] = useState<SkippedReservation[]>([])
  const [recipient, setRecipient] = useState('')
  const [cc, setCc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sentCount, setSentCount] = useState<number | null>(null)

  const loadPreview = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({ type })
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const res = await fetch(`/api/administrator/cancellations/auto-cancel?${qs}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load the preview.')
      const data = await res.json()
      setLines(data.lines ?? [])
      setSkipped(data.skipped ?? [])
      setRecipient(data.recipient ?? '')
      setCc(data.cc ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the preview.')
      setLines([])
      setSkipped([])
    }
    setLoading(false)
  }, [type, from, to])

  useEffect(() => { loadPreview() }, [loadPreview])

  const send = async () => {
    setSending(true)
    setError('')
    const res = await fetch('/api/administrator/cancellations/auto-cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The count the admin actually approved. The server refuses if the set
      // moved while this was open.
      body: JSON.stringify({ type, from: from || null, to: to || null, expectedCount: lines.length }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setSentCount(data.sent ?? lines.length)
    } else {
      setError(data.error || 'The request could not be sent.')
      // Whatever went wrong, the list on screen may no longer be the truth.
      loadPreview()
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
          </p>
          {skipped.length > 0 && (
            <p className="text-sm text-[#fb923c]">
              {skipped.length} reservation{skipped.length === 1 ? '' : 's'} had no reservation code and
              {skipped.length === 1 ? ' was' : ' were'} left alone — neither sent nor cancelled. Add the code, or cancel with CSC by hand.
            </p>
          )}
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
          Collects every booking marked <span className="text-[#fb923c] font-medium">Pending Cancellation</span> that
          has a reservation code, emails CSC a single request listing the date, time and code of each,
          then marks them <span className="text-[#f0f6ff]">Cancelled</span>.
        </p>

        <div>
          <label className={labelCls}>Booking type</label>
          <div className="flex gap-1 flex-wrap">
            {TYPE_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setType(f.value)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                  type === f.value
                    ? 'bg-[#c8102e] text-white'
                    : 'bg-[#0f2a4a] border border-[#1e5080] text-[#93b8d8] hover:text-[#f0f6ff] hover:border-[#93b8d8]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>From (optional)</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>To (optional)</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div className="border-t border-[#1e5080] pt-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#6a96bb] mb-2">
            {loading
              ? 'Finding reservations…'
              : lines.length === 0
              // The empty state below says the rest; "0 reservations will be
              // listed" above it just says the same thing twice.
              ? 'Nothing to send'
              : `${lines.length} reservation${lines.length === 1 ? '' : 's'} will be listed`}
          </p>

          {!loading && lines.length > 0 && (
            <div className="max-h-56 overflow-y-auto border border-[#1e5080] rounded-lg divide-y divide-[#1e5080]">
              {lines.map((l, i) => (
                <div key={i} className="px-3 py-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[#f0f6ff]">{formatDate(l.date)}</span>
                    <span className="text-[#93b8d8] text-xs flex-shrink-0">{formatTime(l.startTime)} – {formatTime(l.endTime)}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 mt-0.5">
                    <span className="text-xs text-[#6a96bb]">{l.bodyName} · {l.roomOrTable}</span>
                    <span className="text-xs font-mono text-[#93b8d8] flex-shrink-0">{l.reservationCode}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && lines.length === 0 && (
            <p className="text-sm text-[#6a96bb]">
              {skipped.length > 0
                ? 'Nothing with a reservation code is marked Pending Cancellation for these filters.'
                : 'Nothing is marked Pending Cancellation for these filters.'}
            </p>
          )}
        </div>

        {error && <p className="text-[#c8102e] text-sm">{error}</p>}

        {/*
          Shown, not hidden. These are pending cancellations that this tool
          cannot action -- without a code CSC has nothing to look up, and
          cancelling them in Chambers anyway would put the two systems out of
          step. An admin needs to know they are still outstanding.
        */}
        {skipped.length > 0 && !loading && (
          <div className="border border-[#fb923c]/40 bg-[#3d2200]/40 rounded-lg px-3 py-2.5">
            <p className="text-xs text-[#fb923c] font-medium mb-1">
              {skipped.length} skipped — no reservation code
            </p>
            <p className="text-xs text-[#93b8d8] mb-1.5">
              Not sent and not cancelled. Add the code to the booking, or handle these with CSC directly.
            </p>
            <ul className="text-xs text-[#6a96bb] space-y-0.5">
              {skipped.slice(0, 5).map((sk, i) => (
                <li key={i}>{formatDate(sk.date)} · {sk.bodyName} · {sk.roomOrTable}</li>
              ))}
              {skipped.length > 5 && <li>…and {skipped.length - 5} more</li>}
            </ul>
          </div>
        )}

        {!loading && lines.length > 0 && (
          <p className="text-xs text-[#6a96bb]">
            Goes to <span className="text-[#93b8d8]">{recipient || 'CSC'}</span>
            {cc && <>, copying <span className="text-[#93b8d8]">{cc}</span></>}.
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={send}
            disabled={sending || loading || lines.length === 0}
            className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {sending ? 'Sending…' : `Send & mark cancelled (${lines.length})`}
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
