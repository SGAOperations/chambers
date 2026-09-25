import { NextResponse } from 'next/server'
import { NussoApiError, NussoAuthError, NussoConfigError } from './types'

/**
 * Turn a NUSSO client error into the right HTTP response.
 *
 * The distinction matters to the UI: a config error means Chambers itself is
 * not set up (a 503 the user can do nothing about), an auth error means the
 * shared EMS login failed (a 502 an admin must look into), and an API error is
 * NUSSO refusing the specific request (surface its message). Anything else is a
 * real bug and should 500.
 */
export function handleNussoError(err: unknown): NextResponse {
  if (err instanceof NussoConfigError) {
    // The message names exactly what is missing (credentials, requestor, ...).
    return NextResponse.json({ error: err.message || 'The NUSSO integration is not configured.' }, { status: 503 })
  }
  if (err instanceof NussoAuthError) {
    return NextResponse.json({ error: 'Could not sign in to NUSSO. An administrator should check the credentials.' }, { status: 502 })
  }
  if (err instanceof NussoApiError) {
    return NextResponse.json({ error: err.message }, { status: 502 })
  }
  console.error('Unexpected NUSSO error:', err)
  return NextResponse.json({ error: 'Something went wrong talking to NUSSO.' }, { status: 500 })
}
