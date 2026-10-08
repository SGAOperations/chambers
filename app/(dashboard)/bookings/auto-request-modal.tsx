'use client'

import { useCallback, useEffect, useState } from 'react'
import BookingModal from './booking-modal'

interface TablingRequestLine {
  id: string
  requesterName: string
  bodyName: string
  purpose: string
  sessions: {
    date: string
    startTime: string
    endTime: string
    location: string | null
    tables: number | null
  }[]
  pastSessions: number
  previouslySentAt: string | null
  previouslySentBy: string | null
}

/** In Ops Review, but every date has passed, so there is nothing to ask CSC for. */
interface SkippedTablingRequest {
  id: string
  bodyName: string
  purpose: string
  lastDate: string | null
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
function formatStamp(ts: string) {
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * Lists tabling requests in Ops Review and lets an admin choose which to send to
 * CSC as a reservation request (issue #226).
 *
 * Nothing is selected when this opens, for the reason Auto-Cancel gives: the
 * send is an email to a university office and a status change in Chambers, and
 * neither can be taken back. A request is selected whole -- see
 * lib/pending-tabling-requests.ts for why it cannot be split by date.
 */
export default function AutoRequestModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [lines, setLines] = useState<TablingRequestLine[]>([])
  const [skipped, setSkipped] = useState<SkippedTablingRequest[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [recipient, setRecipient] = useState('')
  const [recipientIsReal, setRecipientIsReal] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [cc, setCc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ sent: number; sessions: number; failed: string[] } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/administrator/requests/auto-request')
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load the list.')
      const data = await res.json()
      setLines(data.lines ?? [])
      setSkipped(data.skipped ?? [])
      setRecipient(data.recipient ?? '')
      setRecipientIsReal(!!data.recipientIsReal)
      setBlocked(data.blocked ?? null)
      setCc(data.cc ?? null)
      // Dropped on every reload: the list may have moved, and a selection
      // carried across it would approve rows never seen.
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the list.')
      setLines([])
      setSkipped([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = lines.length > 0 && selected.size === lines.length
  const selectedSessions = lines.filter(l => selected.has(l.id)).reduce((n, l) => n + l.sessions.length, 0)
  // Called out beside the button as well as on the row: the row may be scrolled
  // out of view by the time someone presses send.
  const selectedResends = lines.filter(l => selected.has(l.id) && l.previouslySentAt).length

  const send = async () => {
    setSending(true)
    setError('')
    const res = await fetch('/api/administrator/requests/auto-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setResult({ sent: data.sent ?? selected.size, sessions: data.sessions ?? selectedSessions, failed: data.statusUpdateFailed ?? [] })
      onSent()
    } else {
      setError(data.error || 'The request could not be sent.')
      // Whatever went wrong, the list on screen may no longer be the truth.
      load()
    }
    setSending(false)
  }

  if (result) {
    return (
      <BookingModal title="Tabling Request Sent" onClose={onClose}>
        <div className="space-y-4">
          <p className="text-sm text-[#f0f6ff]">
            Sent {result.sessions} session{result.sessions === 1 ? '' : 's'} from {result.sent} request{result.sent === 1 ? '' : 's'} to{' '}
            <span className="font-medium">{recipient}</span>
            {cc && <>, copying <span className="font-medium">{cc}</span></>}.
          </p>
          <p className="text-sm text-[#93b8d8]">
            {result.sent - result.failed.length > 0 && (
              <>Those requests are now <span className="text-[#a78bfa]">Awaiting CSC</span>, and each requester has been told. </>
            )}
            When CSC replies, fulfill each request with the reservation code they give, or deny it.
          </p>
          {result.failed.length > 0 && (
            <div className="border border-[#fb923c]/50 bg-[#3d2200]/50 rounded-lg px-3 py-2.5">
              <p className="text-xs text-[#fb923c] font-semibold mb-1">Sent, but not moved to Awaiting CSC</p>
              <p className="text-xs text-[#93b8d8] mb-1.5">
                CSC has the email for these. Someone changed them while you were choosing, or the update failed — check each
                and set its status by hand rather than sending again.
              </p>
              <ul className="text-xs text-[#6a96bb] space-y-0.5">
                {result.failed.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}
          <button onClick={onClose} className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors">
            Close
          </button>
        </div>
      </BookingModal>
    )
  }

  return (
    <BookingModal title="Auto-Request — Ask CSC for Tables" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-[#93b8d8]">
          Every tabling request in <span className="text-[#fb923c] font-medium">Ops Review</span> with an upcoming date is listed below.
          Tick the ones to send; CSC gets a single email with each request&apos;s dates, times, preferred locations and table counts,
          and those requests move to <span className="text-[#a78bfa] font-medium">Awaiting CSC</span>. Room requests are not included.
        </p>

        <div className="border-t border-[#1e5080] pt-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#6a96bb]">
              {loading
                ? 'Loading…'
                : lines.length === 0
                ? 'No tabling requests to send'
                : `${selected.size} of ${lines.length} selected`}
            </p>
            {!loading && lines.length > 0 && (
              <button
                onClick={() => setSelected(allSelected ? new Set() : new Set(lines.map(l => l.id)))}
                className="text-xs text-[#93b8d8] hover:text-[#f0f6ff] underline underline-offset-2 transition-colors"
              >
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            )}
          </div>

          {!loading && lines.length > 0 && (
            <div className="max-h-72 overflow-y-auto border border-[#1e5080] rounded-lg divide-y divide-[#1e5080]">
              {lines.map(l => {
                const isOn = selected.has(l.id)
                return (
                  <label
                    key={l.id}
                    className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                      isOn ? 'bg-[#1a4d8a]/50' : 'hover:bg-[#1a4d8a]/25'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => toggle(l.id)}
                      className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[#c8102e] cursor-pointer"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-[#f0f6ff] truncate">{l.bodyName}</span>
                      <span className="block text-xs text-[#6a96bb] truncate">{l.purpose} · requested by {l.requesterName}</span>
                      <ul className="mt-1 space-y-0.5">
                        {l.sessions.map((s, i) => (
                          <li key={i} className="text-xs text-[#93b8d8]">
                            {formatDate(s.date)} · {formatTime(s.startTime)} – {formatTime(s.endTime)}
                            {s.location && <span className="text-[#6a96bb]"> · {s.location}</span>}
                            {s.tables != null && <span className="text-[#6a96bb]"> · {s.tables} {s.tables === 1 ? 'table' : 'tables'}</span>}
                          </li>
                        ))}
                      </ul>
                      {l.pastSessions > 0 && (
                        <span className="block text-[10px] text-[#6a96bb] mt-1">
                          {l.pastSessions} earlier date{l.pastSessions === 1 ? ' has' : 's have'} passed and will be left out
                        </span>
                      )}
                      {/*
                        A request moved back to Ops Review after Chambers already
                        mailed CSC for it. Selectable -- CSC may have asked for it
                        again -- but it should never be resent by accident.
                      */}
                      {l.previouslySentAt && (
                        <span className="inline-block mt-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#3d2200] text-[#fb923c]">
                          Already sent {formatStamp(l.previouslySentAt)}{l.previouslySentBy ? ` by ${l.previouslySentBy}` : ''}
                        </span>
                      )}
                    </span>
                  </label>
                )
              })}
            </div>
          )}

          {!loading && lines.length === 0 && !error && (
            <p className="text-sm text-[#6a96bb]">No tabling request in Ops Review has an upcoming date.</p>
          )}
        </div>

        {/*
          Shown so they are not mistaken for handled. There is nothing to ask CSC
          for, but each still needs denying or fulfilling by hand.
        */}
        {skipped.length > 0 && !loading && (
          <div className="border border-[#fb923c]/40 bg-[#3d2200]/40 rounded-lg px-3 py-2.5">
            <p className="text-xs text-[#fb923c] font-medium mb-1">
              {skipped.length} not listed — every date has passed
            </p>
            <ul className="text-xs text-[#6a96bb] space-y-0.5">
              {skipped.slice(0, 5).map(sk => (
                <li key={sk.id}>{sk.bodyName} · {sk.purpose}{sk.lastDate && <> · last date {formatDate(sk.lastDate)}</>}</li>
              ))}
              {skipped.length > 5 && <li>…and {skipped.length - 5} more</li>}
            </ul>
          </div>
        )}

        {error && <p className="text-[#c8102e] text-sm">{error}</p>}

        {!loading && blocked && (
          <div className="border border-[#fb923c]/50 bg-[#3d2200]/50 rounded-lg px-3 py-2.5">
            <p className="text-xs text-[#fb923c] font-semibold mb-1">Sending is disabled here</p>
            <p className="text-xs text-[#93b8d8]">{blocked}</p>
          </div>
        )}

        {!loading && !blocked && selected.size > 0 && (
          <div className={`rounded-lg px-3 py-2.5 border ${
            recipientIsReal
              ? 'border-[#c8102e]/60 bg-[#3d0f0f]/50'
              : 'border-[#1e5080] bg-[#0f2a4a]'
          }`}>
            <p className="text-xs text-[#93b8d8]">
              {recipientIsReal ? 'This goes to CSC for real:' : 'Redirected — this is not CSC:'}
            </p>
            <p className="text-sm text-[#f0f6ff] font-medium break-all mt-0.5">{recipient}</p>
            {cc && <p className="text-xs text-[#6a96bb] mt-0.5">copying {cc}</p>}
            {selectedResends > 0 && (
              <p className="text-xs text-[#fb923c] mt-1.5">
                {selectedResends} of these {selectedResends === 1 ? 'has' : 'have'} been sent to CSC before.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={send}
            disabled={sending || loading || selected.size === 0 || !!blocked}
            className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {sending ? 'Sending…' : `Send to CSC (${selectedSessions} session${selectedSessions === 1 ? '' : 's'})`}
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
