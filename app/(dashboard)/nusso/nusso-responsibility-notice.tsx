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
 * It also states the two answers Chambers submits on the booker's behalf. EMS
 * requires both (lib/nusso/config.ts sends them as required UDFs on every
 * profile) and neither is on any Chambers form, so a booker would otherwise
 * attest to them without ever being shown them -- which is why the Safety &
 * Security section they are agreeing to is quoted here in full rather than
 * merely cited.
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
    title: 'Book only official SGA meetings',
    body:
      'Browse/Book NUSSO reserves space under SGA\u2019s account, for SGA business \u2014 body, board, committee and team meetings and the events they run. It is not for personal use, for another organisation, or for holding a room \u201cjust in case\u201d.',
  },
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

/**
 * The two required EMS answers Chambers fills in for every reservation, both
 * hard-coded in lib/nusso/config.ts: UDF 34 (external control) answered "No",
 * and UDF 32 (Safety & Security) answered "there WILL NOT BE any
 * safety/security concerns". Keep this list in step with those profiles.
 */
const FIXED_ANSWERS: string[] = [
  'No one external to the university has any control over the nature or execution of this event.',
  'You have read the Safety & Security section of the Terms & Conditions and determined that there WILL NOT BE any safety/security concerns.',
]

/**
 * The Safety & Security section itself, quoted from NUSSO's Terms & Conditions.
 *
 * Chambers answers that section on the booker's behalf, so it has to put the
 * section in front of them: asking someone to attest to terms they have not been
 * shown is not an attestation. The four examples are what makes the question
 * answerable -- "any safety or security concerns" means little until you see
 * that cash and controversial subject matter are among them.
 */
const SAFETY_TERMS = {
  heading: 'Safety and Security',
  body:
    'You are responsible for notifying Public Safety of any safety or security concerns that might arise from your activities on campus, including but not limited to the following:',
  examples: [
    'The serving of alcohol',
    'The collecting of cash',
    'The restriction of access to a space or venue',
    'The presentation of potentially controversial subject matter',
  ],
}

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
          <p className="text-sm text-[#f0f6ff]">You are responsible for the following:</p>
          <ul className="space-y-3">
            {RESPONSIBILITIES.map(r => (
              <li key={r.title} className="rounded-lg border border-[#1e5080] bg-[#0f2a4a] px-4 py-3">
                <p className="text-sm font-medium text-[#f0f6ff]">{r.title}</p>
                <p className="text-xs text-[#93b8d8] mt-1 leading-relaxed">{r.body}</p>
              </li>
            ))}
          </ul>
          {/*
            Not one of the three responsibilities above: this is an attestation
            made in the booker's name that they never see a field for, so it gets
            its own block and the loudest styling on the page.
          */}
          <div className="rounded-lg border border-[#c8102e] bg-[#c8102e]/10 px-4 py-3 space-y-2">
            <p className="text-sm font-medium text-[#f0f6ff]">
              Two answers are submitted for you
            </p>
            <p className="text-xs text-[#93b8d8]">
              NUSSO requires both, and Chambers answers them the same way on every
              reservation it sends:
            </p>
            <ul className="text-xs text-[#93b8d8] list-disc pl-5 space-y-1">
              {FIXED_ANSWERS.map(a => <li key={a}>{a}</li>)}
            </ul>

            {/* The section being agreed to, verbatim, so the second answer means something. */}
            <div className="rounded-md border border-[#1e5080] bg-[#0a1628] px-3 py-2.5 space-y-1.5">
              <p className="text-xs font-semibold text-[#f0f6ff]">
                {SAFETY_TERMS.heading}
                <span className="font-normal text-[#6a96bb]"> · from NUSSO&apos;s Terms &amp; Conditions</span>
              </p>
              <p className="text-xs text-[#93b8d8] leading-relaxed">{SAFETY_TERMS.body}</p>
              <ul className="text-xs text-[#93b8d8] list-disc pl-5 space-y-0.5">
                {SAFETY_TERMS.examples.map(e => <li key={e}>{e}</li>)}
              </ul>
            </div>

            <p className="text-sm text-[#f0f6ff] leading-relaxed">
              If either of those is not true of your event,{' '}
              <span className="font-bold text-[#ff6b7f]">STOP. Do not create a booking.</span>{' '}
              Contact Operational Affairs.
            </p>
          </div>

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
