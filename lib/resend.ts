import { Resend } from 'resend'
export const resend = new Resend(process.env.RESEND_API_KEY)

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
