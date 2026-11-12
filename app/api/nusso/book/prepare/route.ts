import { NextResponse } from 'next/server'
import { serverBookingSettings } from '@/lib/nusso/client'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { checkBooking } from '@/lib/nusso/book-request'

export const runtime = 'nodejs'

/**
 * Step 1 of booking through the Chambers for NUSSO extension.
 *
 * Runs every check the server-side booking runs -- the caller may book, the
 * form is complete, Chambers can record it -- before the booker's browser makes
 * the irreversible EMS reservation. Answers the exact request to send and the
 * SGA-side values it carries (group, group contact), which the browser cannot
 * read from Chambers' environment. This server does not contact EMS.
 */
export async function POST(request: Request) {
  const checked = await checkBooking(request)
  if (!checked.ok) return checked.res
  const b = checked.value

  const rateLimitRes = await checkRateLimit(b.caller.user.id)
  if (rateLimitRes) return rateLimitRes

  const settings = serverBookingSettings()
  if (!settings.contact.firstContactPhone) {
    return NextResponse.json(
      { error: 'NUSSO 1st-contact phone is required: set NUSSO_CONTACT_PHONE (NUSSO_CONTACT_NAME and NUSSO_CONTACT_EMAIL default to SGA operations).' },
      { status: 503 }
    )
  }

  return NextResponse.json({ request: b.request, reservationType: b.profile.key, settings })
}
