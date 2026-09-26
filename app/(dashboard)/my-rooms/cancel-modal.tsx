'use client'

import { useState } from 'react'

interface CancelModalProps {
  booking: {
    id: string
    type: 'One-Time Room' | 'Weekly Room' | 'Tabling'
    bodyName: string
    purpose: string
    location: string
    date: string
    occurrenceId?: string
    sessionCount?: number
    /**
     * The EMS reservation id, when this booking came from Browse/Book NUSSO.
     * Its presence is what offers the NUSSO Cancellation action: only those
     * bookings have a reservation of ours to release.
     */
    reservationCode?: string | null
  }
  onClose: () => void
  onSuccess: () => void
}

export default function CancelModal({ booking, onClose, onSuccess }: CancelModalProps) {
  const isWeekly = booking.type === 'Weekly Room'
  const isMultiSession = !isWeekly && (booking.sessionCount ?? 1) > 1

  const [scope, setScope] = useState<'occurrence' | 'series'>(
    isWeekly || isMultiSession ? 'occurrence' : 'series'
  )
  const [cancellationType, setCancellationType] = useState<'Cancellation' | 'Virtual'>('Cancellation')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  /** A completed NUSSO cancellation that came back with something to say. */
  const [nussoWarning, setNussoWarning] = useState('')

  // Whether this booking is one of ours in NUSSO. When it is, releasing the
  // reservation IS the cancellation and there is no second option to pick: the
  // manual request still exists, but only as the failsafe the route falls back
  // to on its own. When it is not, nothing here changes -- the booking follows
  // the ordinary request-an-admin path exactly as it always has.
  const canCancelInNusso = !!booking.reservationCode && booking.type !== 'Weekly Room'

  const handleSubmit = async () => {
    setSubmitting(true)
    const res = await fetch('/api/cancellation-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: booking.id,
        occurrence_id: scope === 'occurrence' ? booking.occurrenceId : null,
        scope,
        cancellation_type: cancellationType,
      }),
    })

    if (res.ok) {
      onSuccess()
      onClose()
    } else {
      const data = await res.json()
      setError(data.error || 'Something went wrong.')
    }
    setSubmitting(false)
  }

  /**
   * Release the reservation in NUSSO rather than asking an admin to.
   *
   * On success the route has already applied Cancelled (or Virtual) and the
   * modal can close. On a partial or failed release it has filed the ordinary
   * cancellation request as a backup and returned a warning, which is held on
   * screen instead of closing -- the requester needs to read it, because the
   * booking is now Pending Cancellation and somebody has to finish the job.
   */
  const handleNussoCancel = async () => {
    setSubmitting(true)
    setError('')
    setNussoWarning('')
    try {
      const res = await fetch('/api/nusso/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: booking.id,
          occurrence_id: scope === 'occurrence' ? booking.occurrenceId : null,
          scope,
          cancellation_type: cancellationType,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'The NUSSO cancellation was rejected.')
        return
      }
      if (data.warning) {
        // Deliberately not onSuccess() here: that closes the modal, and this is
        // the one outcome the requester has to read before it goes away. The
        // list is refreshed when they dismiss it instead.
        setNussoWarning(data.warning)
        return
      }
      onSuccess()
      onClose()
    } catch {
      setError('Could not reach Chambers to run the NUSSO cancellation.')
    } finally {
      setSubmitting(false)
    }
  }

  const showScopeSelector = isWeekly || isMultiSession

  const seriesWarning = isWeekly
    ? 'This will request cancellation of all occurrences in this series.'
    : (booking.sessionCount ?? 1) > 1
      ? 'This will request cancellation of all sessions in this booking.'
      : 'This will request cancellation of this booking.'

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#184073] rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-[#f0f6ff]">Request Cancellation</h2>
          <button onClick={onClose} className="text-[#6a96bb] hover:text-[#f0f6ff] text-lg leading-none transition-colors">✕</button>
        </div>

        {/* Booking summary */}
        <div className="bg-[#0f2a4a] rounded-lg px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-[#f0f6ff]">{booking.bodyName} — {booking.location}</p>
          <p className="text-xs text-[#93b8d8]">{booking.purpose} · {booking.type === 'One-Time Room' ? 'One-Time/Multiple Room' : booking.type}</p>
        </div>

        {/* Cancellation type selector */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-[#93b8d8]">Cancellation Type</p>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="cancellationType"
                value="Cancellation"
                checked={cancellationType === 'Cancellation'}
                onChange={() => setCancellationType('Cancellation')}
                className="accent-[#c8102e]"
              />
              <span className="text-sm text-[#f0f6ff]">Full Cancellation</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="cancellationType"
                value="Virtual"
                checked={cancellationType === 'Virtual'}
                onChange={() => setCancellationType('Virtual')}
                className="accent-[#c8102e]"
              />
              <span className="text-sm text-[#f0f6ff]">Going Virtual</span>
            </label>
          </div>
        </div>

        {/* Scope selector — weekly uses occurrence/series labels; one-time/tabling use session labels */}
        {showScopeSelector && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#93b8d8]">Cancellation Scope</p>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  value="occurrence"
                  checked={scope === 'occurrence'}
                  onChange={() => setScope('occurrence')}
                  className="accent-[#c8102e]"
                />
                <span className="text-sm text-[#f0f6ff]">
                  {isWeekly ? 'This occurrence only' : 'This session only'}
                </span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  value="series"
                  checked={scope === 'series'}
                  onChange={() => setScope('series')}
                  className="accent-[#c8102e]"
                />
                <span className="text-sm text-[#f0f6ff]">
                  {isWeekly ? 'Entire series' : 'All sessions'}
                </span>
              </label>
            </div>
          </div>
        )}

        {/* Series warning */}
        {scope === 'series' && (
          <div className="bg-[#3d2200] border border-[#f97316] rounded-lg px-4 py-3">
            <p className="text-sm font-semibold text-[#fb923c]">Warning</p>
            <p className="text-sm text-[#fdba74] mt-0.5">
              {seriesWarning}
              {' '}
              {canCancelInNusso
                ? 'Each one held in NUSSO is released as part of this.'
                : 'An admin may reach out to confirm the cancellation.'}
            </p>
          </div>
        )}

        {error && <p className="text-[#c8102e] text-sm">{error}</p>}

        {nussoWarning && (
          <div className="bg-[#3d2200] border border-[#f97316] rounded-lg px-4 py-3">
            <p className="text-sm font-semibold text-[#fb923c]">Automatic cancellation did not complete</p>
            <p className="text-sm text-[#fdba74] mt-0.5">{nussoWarning}</p>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          {/*
            One action, whichever path this booking takes. On a NUSSO booking it
            releases the reservation and settles the status; on any other it
            files the request an admin picks up. The manual request is never a
            choice the requester has to make -- on a NUSSO booking the route
            files it for them if the release does not go through.
          */}
          <button
            onClick={canCancelInNusso ? handleNussoCancel : handleSubmit}
            // After a fallback the backup request is already filed; pressing
            // again would only file a duplicate.
            disabled={submitting || !!nussoWarning}
            className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] hover:scale-105 text-white text-sm rounded-lg font-medium transition-all disabled:opacity-50"
          >
            {submitting
              ? (canCancelInNusso ? 'Cancelling in NUSSO...' : 'Submitting...')
              : (canCancelInNusso ? 'Submit Cancellation' : 'Submit Request')}
          </button>
          <button
            onClick={() => (nussoWarning ? onSuccess() : onClose())}
            className="px-4 py-2 border border-[#1e5080] text-[#f0f6ff] text-sm rounded-lg hover:bg-[#1a4d8a] transition-colors"
          >
            {nussoWarning ? 'Close' : 'Cancel'}
          </button>
        </div>

        {canCancelInNusso && !nussoWarning && (
          <p className="text-xs text-[#6a96bb]">
            Releases reservation #{booking.reservationCode} in NUSSO and sets this
            booking to {cancellationType === 'Virtual' ? 'Virtual' : 'Cancelled'}. If NUSSO
            cannot be reached, a cancellation request is filed for Operational Affairs instead.
          </p>
        )}

      </div>
    </div>
  )
}
