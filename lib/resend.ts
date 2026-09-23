import { Resend } from 'resend'

/**
 * Every email Chambers sends goes through here, and outside production none of
 * it reaches the person it names.
 *
 * Recipients are not configuration. They come out of the database -- a whole
 * body's membership on a booking email, a user's own address on an invite or a
 * password reset -- so a preview deployment or a developer's laptop pointed at
 * real data will happily email real students while someone is clicking around.
 * No Resend API key prevents that: a key scopes what may send and from which
 * domain, never who receives.
 *
 * So the guard is here rather than in configuration. In production the client is
 * used exactly as before. Anywhere else (VERCEL_ENV is 'preview', 'development'
 * or unset) every To, Cc and Bcc is replaced by PREVIEW_EMAIL_RECIPIENT, with
 * the intended recipients moved into the subject so a test inbox still shows who
 * would have been written to. With no PREVIEW_EMAIL_RECIPIENT set the email is
 * withheld and logged, which is the same "refuse rather than default" rule
 * CSC_EMAIL follows in the auto-cancel route.
 *
 * The export is a narrow wrapper, not the Resend client, on purpose: a call site
 * cannot reach past it to an unguarded `send`, and a new one added later is
 * covered without anyone having to remember this file exists.
 */

let client: Resend | null = null

/**
 * The Resend client, or null when there is no key to build it with.
 *
 * Constructed on first use rather than at import. The Resend constructor throws
 * when RESEND_API_KEY is missing, and `next build` loads this module while
 * collecting page data, so building without a key used to fail -- which meant a
 * preview deployment needed a real key even though, with the guard below, it may
 * never send anything.
 *
 * Null rather than a throw, because a send is never worth a crash: with a key
 * set for production only, `new Resend(undefined)` threw straight through
 * sendSignupOtpEmail and turned /api/signup/request into a 500 -- nobody could
 * get into a preview at all. A caller that cannot send should learn that the
 * same way it learns about any other failed send. Production still fails loudly,
 * and early: see the check at the bottom of this file.
 */
function api(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!client) client = new Resend(process.env.RESEND_API_KEY)
  return client
}

function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production'
}

type SendArgs = Parameters<Resend['emails']['send']>
type SendPayload = SendArgs[0]
type SendOptions = SendArgs[1]
type SendResult = Awaited<ReturnType<Resend['emails']['send']>>

type Addresses = string | string[] | undefined

function listOf(value: Addresses): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

/** Everyone a payload would reach, in the order the headers are read. */
function recipientsOf(payload: SendPayload): string[] {
  return [
    ...listOf(payload.to),
    ...listOf(payload.cc as Addresses),
    ...listOf(payload.bcc as Addresses),
  ]
}

/**
 * Not sent, and said so: logged with who it would have reached, and answered
 * with the shape of a Resend failure rather than a success. No call site reads
 * the result today, and one that starts should not be told the mail was sent.
 */
function withhold(payload: SendPayload, intended: string[], reason: string): SendResult {
  console.warn(
    `[email] Withheld "${payload.subject}" — would have gone to ${
      intended.join(', ') || '(no recipients)'
    }. ${reason}`
  )
  return {
    data: null,
    error: { name: 'application_error', message: `Email withheld: ${reason}` },
  } as SendResult
}

export const resend = {
  emails: {
    async send(payload: SendPayload, options?: SendOptions): Promise<SendResult> {
      const sender = api()

      if (isProduction()) {
        // Unreachable: the check at the bottom of this file fails the server, and
        // the production build, long before a send gets here without a key.
        if (!sender) throw new Error('RESEND_API_KEY is not set.')
        return sender.emails.send(payload, options)
      }

      const intended = recipientsOf(payload)
      const to = process.env.PREVIEW_EMAIL_RECIPIENT

      if (!to) {
        return withhold(
          payload,
          intended,
          'Set PREVIEW_EMAIL_RECIPIENT to receive it instead.'
        )
      }
      if (!sender) {
        return withhold(
          payload,
          intended,
          'RESEND_API_KEY is not set for this environment, so nothing can be sent.'
        )
      }

      return sender.emails.send(
        {
          ...payload,
          to,
          cc: undefined,
          bcc: undefined,
          subject: `[preview → ${intended.join(', ') || 'nobody'}] ${payload.subject}`,
        },
        options
      )
    },
  },
}

/** The name mail clients show beside the sending address. */
const SENDER_NAME = 'Chambers'

/**
 * The From header for every email Chambers sends: "Chambers <address>".
 *
 * RESEND_FROM_EMAIL holds a bare address, and a bare address is all a
 * recipient saw -- chambers.notify@northeasternsga.com with no name beside it.
 * The name is added here rather than by changing the variable, because the same
 * variable is also used as a To address. A value that already carries a name
 * ("Someone <address>") is left as it is.
 */
export function emailFrom(): string {
  const address = process.env.RESEND_FROM_EMAIL!
  return address.includes('<') ? address : `${SENDER_NAME} <${address}>`
}

// Deferring construction would otherwise turn a production misconfiguration
// from a failed build into emails that quietly stop sending, so the loud check
// stays -- narrowed to where it matters. Vercel sets VERCEL_ENV at build time as
// well as at runtime, so a production build still fails here exactly as it did
// before; a preview build takes 'preview' and needs no key at all.
if (isProduction() && !process.env.RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY is not set.')
}
