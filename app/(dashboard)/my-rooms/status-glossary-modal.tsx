'use client'

import BookingModal from '../bookings/booking-modal'
import {
  BOOKING_STATUSES,
  STATUS_DEFINITIONS,
  statusColors,
  statusTextColors,
  openRequestStatusStyles,
} from './shared'
import { OPEN_REQUEST_STATUSES, OPEN_STATUS_DESCRIPTIONS } from '@/lib/request-status'

/**
 * What each status on My Rooms means (issue #228).
 *
 * Renders straight from BOOKING_STATUSES and STATUS_DEFINITIONS, with each
 * status drawn in the same colours the cards and lists use, so the glossary
 * cannot list a status the page never shows or describe one in a colour it
 * isn't drawn in.
 */
export default function StatusGlossaryModal({ onClose }: { onClose: () => void }) {
  return (
    <BookingModal title="What the statuses mean" onClose={onClose}>
      <p className="text-sm text-[#93b8d8] leading-relaxed">
        Operational Affairs sets most of these as CSC confirms each booking. A few change on their own: a booking moves to Pending Cancellation when your leadership asks to cancel it, and to Cancelled or Virtual when its reservation is released through NUSSO.
      </p>

      <dl className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {BOOKING_STATUSES.map(status => (
          <div key={status} className="rounded-xl border border-[#1e5080] bg-[#0e2f4f] p-4 space-y-2">
            <dt>
              <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${statusColors[status]} ${statusTextColors[status]}`}>
                {status}
              </span>
            </dt>
            <dd className="text-sm text-[#f0f6ff] leading-relaxed">{STATUS_DEFINITIONS[status].meaning}</dd>
            <dd className="text-sm text-[#93b8d8] leading-relaxed">
              <span className="text-[#6a96bb]">What to do: </span>
              {STATUS_DEFINITIONS[status].action}
            </dd>
          </div>
        ))}
      </dl>

      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-[#f0f6ff]">Revision requests</h3>
          <p className="text-sm text-[#93b8d8] leading-relaxed mt-1">
            When leadership asks for a change to a booking, its details show where the request stands until it closes. Once it closes, the booking shows the change, or whoever asked gets a notification that it was denied, with the reason when one was given.
          </p>
        </div>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {OPEN_REQUEST_STATUSES.map(status => (
            <div key={status} className={`rounded-lg border px-3 py-2.5 text-sm ${openRequestStatusStyles[status]}`}>
              <dt className="font-semibold">{status}</dt>
              <dd className="text-xs mt-0.5 opacity-90">{OPEN_STATUS_DESCRIPTIONS[status]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </BookingModal>
  )
}
