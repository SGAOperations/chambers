'use client'

import { useEffect, useState, useCallback, useSyncExternalStore } from 'react'

/**
 * The responsibilities anyone booking through NUSSO is agreeing to.
 *
 * Browse/Book puts a real reservation on Northeastern's calendar under SGA's
 * shared EMS account, with no NUSSO staff step in between. Nobody downstream
 * reviews the title, the attendance figure, or whether the room is still wanted
 * -- so the notice goes up once per sign-in rather than living in a help page
 * nobody opens.
 *
 * Acknowledgement is per browser session (sessionStorage): the first visit after
 * signing in shows it, later visits in the same session do not, and the next
 * sign-in shows it again. The header's "Your responsibilities" button reopens it
 * at any time, which is also what keeps the auto-show unobtrusive.
 */

const ACK_KEY = 'chambers_nusso_responsibilities_ack'

/** sessionStorage is unavailable in some privacy modes; a throw must not blank the page. */
function readAck(): boolean {
  try {
    return sessionStorage.getItem(ACK_KEY) === '1'
  } catch {
    return false
  }
}

function writeAck() {
  try {
    sessionStorage.setItem(ACK_KEY, '1')
  } catch {
    /* Not acknowledged for next time; showing it again is the safe failure. */
  }
}

const RESPONSIBILITIES: { title: string; body: string }[] = [
  {
    title: 'Revise and cancel your own bookings',
    body:
      'A reservation made here is yours to maintain. If the plan changes, come back and revise it, or cancel it, so the space is released for someone else. Nobody will do it for you.',
  },
  {
    title: 'Apply appropriate official titles',
    body:
      'Every reservation appears on Northeastern’s calendar as “SGA - …”. Use the event’s real, official name — the one you would be willing to see published — not a placeholder or an inside joke.',
  },
  {
    title: 'Be accurate about your expected attendance',
    body:
      'NUSSO allocates rooms and setup from the attendance you enter. Over-stating it takes space away from other groups; under-stating it can leave you in a room that does not fit.',
  },
]

/** The small header control that reopens the notice. */
export function ResponsibilitiesButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-xs text-[#93b8d8] hover:text-[#f0f6ff] border border-[#1e5080] hover:border-[#2f6ba5] rounded-full px-2.5 py-1 transition-colors"
      title="Show what you are responsible for when booking through NUSSO"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      Your responsibilities
    </button>
  )
}

export function ResponsibilityModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="nusso-responsibilities-title"
    >
      <div
        className="bg-[#0a1628] border border-[#1e5080] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[#1e5080]">
          <div>
            <h2 id="nusso-responsibilities-title" className="text-lg font-semibold text-[#f0f6ff]">
              Before you book through NUSSO
            </h2>
            <p className="text-xs text-[#93b8d8] mt-0.5">
              These reservations go straight onto Northeastern&apos;s calendar under SGA&apos;s account.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 text-[#93b8d8] hover:text-[#f0f6ff] transition-colors"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-[#f0f6ff]">You are responsible for:</p>
          <ul className="space-y-3">
            {RESPONSIBILITIES.map(r => (
              <li key={r.title} className="rounded-lg border border-[#1e5080] bg-[#0f2a4a] px-4 py-3">
                <p className="text-sm font-medium text-[#f0f6ff]">{r.title}</p>
                <p className="text-xs text-[#93b8d8] mt-1 leading-relaxed">{r.body}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-[#6a96bb]">
            You can reopen this from <span className="text-[#93b8d8]">Your responsibilities</span> at the top of the page.
          </p>
        </div>

        <div className="flex items-center justify-end px-6 py-4 border-t border-[#1e5080]">
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg bg-[#c8102e] hover:bg-[#a50d26] text-white font-medium transition-colors"
          >
            I understand
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Owns whether the notice is up: auto-shown once per session, and reopened on
 * demand. The page renders the modal when `open` and puts the button in its
 * header.
 *
 * The acknowledgement is read through useSyncExternalStore rather than an effect
 * because sessionStorage does not exist while the page is server-rendered. The
 * server snapshot says "acknowledged", so the first paint never carries the
 * modal; React then re-reads on the client and puts it up if this session has
 * not seen it. Nothing here subscribes -- the value only changes when this
 * component writes it -- so the subscribe function is a no-op.
 */
const noSubscribe = () => () => {}

export function useResponsibilityNotice() {
  const acknowledgedThisSession = useSyncExternalStore(noSubscribe, readAck, () => true)
  const [dismissed, setDismissed] = useState(false)
  const [reopened, setReopened] = useState(false)

  const open = reopened || (!acknowledgedThisSession && !dismissed)

  const close = useCallback(() => {
    writeAck()
    setReopened(false)
    setDismissed(true)
  }, [])

  const reopen = useCallback(() => setReopened(true), [])

  return { open, close, reopen }
}
