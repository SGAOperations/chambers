import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Refreshes the Supabase auth cookie on document and RSC navigations.
 *
 * Formerly middleware.ts. Next 16 deprecates that file convention in favour of
 * proxy.ts, which runs on the Node.js runtime by default rather than Edge. No
 * runtime is exported here deliberately: the default is what we want. It puts
 * this work in the same region as the route handlers and the database, rather
 * than at whichever edge location is nearest the user -- which is the wrong
 * place to be when the work is a round trip to Supabase in us-east-1.
 *
 * The body is otherwise unchanged from the middleware version.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getClaims() rather than getUser(): it still runs the ssr auto-refresh +
  // Set-Cookie path (which is the only reason this proxy exists), but tokens
  // are ES256 so the JWT is verified locally against a cached JWKS instead of a
  // network round trip to /auth/v1/user on every document/RSC navigation. Same
  // rationale as lib/auth.ts getAuthedUser().
  await supabase.auth.getClaims()

  return supabaseResponse
}

export const config = {
  matcher: [
    // `api` is excluded: this proxy exists only to refresh the auth cookie
    // on document/RSC navigations. Every route under /api authenticates itself,
    // so running it there added a second Supabase Auth round trip per API call
    // whose result was discarded.
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}