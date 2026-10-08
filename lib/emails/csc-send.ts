import { resend } from '@/lib/resend'

type Payload = Parameters<typeof resend.emails.send>[0]

/**
 * Sends one of the emails addressed to CSC, and throws if it did not go.
 *
 * The Resend client does not throw on failure: an API error comes back as
 * `{ error }`, and so does a mail withheld by the preview guard in lib/resend.ts.
 * Every member-facing template ignores the result, which is fine for a
 * notification nobody is waiting on. It is not fine here. Auto-Cancel and
 * Auto-Request both move statuses on the strength of the email having gone, and
 * a result that is never read is a send that always "succeeds" -- the booking
 * marked Cancelled, or the request marked Awaiting CSC, with nothing in CSC's
 * inbox to show for it.
 *
 * So the result is read, and a failure becomes an exception the route already
 * knows how to answer: nothing changed, try again.
 */
export async function sendToCsc(payload: Payload): Promise<void> {
  const { error } = await resend.emails.send(payload)
  if (error) throw new Error(`CSC email not sent: ${error.message}`)
}
