import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
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
  // Set-Cookie path (which is the only reason this middleware exists), but tokens
  // are ES256 so the JWT is verified locally against a cached JWKS instead of a
  // network round trip to /auth/v1/user on every document/RSC navigation. Same
  // rationale as lib/auth.ts getAuthedUser().
  await supabase.auth.getClaims()

  return supabaseResponse
}

export const config = {
  matcher: [
    // `api` is excluded: this middleware exists only to refresh the auth cookie
    // on document/RSC navigations. Every route under /api authenticates itself,
    // so running it there added a second Supabase Auth round trip per API call
    // whose result was discarded.
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}