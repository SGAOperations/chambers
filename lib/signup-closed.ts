import { NextResponse } from 'next/server'

/**
 * Signup is closed during the SGAuth export → cutover window so no new
 * Chambers users are created after the export. Remove this (and its two
 * callers in app/api/signup) once cutover is done.
 */
export function signupClosedResponse(): NextResponse | null {
  return NextResponse.json(
    { error: 'New account registration is temporarily closed. Please check back soon.' },
    { status: 503 }
  )
}
