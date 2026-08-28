import { anonSupabase } from '@/lib/supabase/anon'
import LoginCard from '@/app/_components/LoginCard'

/**
 * Regenerate at most once a minute.
 *
 * This is the first page every user hits, and it was re-rendering -- and
 * re-querying -- on every single request, measured at 0.5-1.1s TTFB against
 * production. Nothing on it is per-user: a comptroller's name, the active
 * semester, and a booking count, all readable by `anon` under RLS. It was
 * dynamic only because it built its Supabase client from cookies(), and calling
 * cookies() opts a route into dynamic rendering whether or not the cookies end
 * up mattering.
 *
 * Behaviour change worth knowing: the fact on the left is picked with
 * Math.random() at render time, so it now varies per revalidation window rather
 * than per request. Two people signing in within the same minute see the same
 * piece of trivia.
 */
export const revalidate = 60

type StaticFact = { kind: 'static'; text: string }
type LiveFact   = { kind: 'live'; label: string; value: number }
type Fact = StaticFact | LiveFact

function FactDisplay({ fact }: { fact: Fact }) {
  if (fact.kind === 'live') {
    return (
      <div className="text-center px-8 w-80" style={{ animation: 'factFadeIn 1.4s ease both' }}>
        <p className="text-sm text-white/30 uppercase tracking-widest mb-3">{fact.label}</p>
        <p className="text-4xl text-white/40 leading-snug">{fact.value.toLocaleString()}</p>
      </div>
    )
  }
  return (
    <div className="text-center px-8 w-80" style={{ animation: 'factFadeIn 1.4s ease both' }}>
      <p className="text-4xl text-white/40 leading-snug">{fact.text}</p>
    </div>
  )
}

export default async function LoginPage() {
  // Anonymous client, not the cookie-scoped one -- see lib/supabase/anon.ts and
  // the revalidate note above. Reading as `anon` is also the more correct
  // reading here: "Bookings this semester" means all of them, whereas the
  // cookie client would have counted only what the visitor's RLS lets them see,
  // so a signed-in visitor and a signed-out one saw different numbers for a
  // figure that is supposed to describe the whole organisation.
  const [comptrollerResult, semResult] = await Promise.allSettled([
    anonSupabase.from('users').select('full_name').eq('admin_role', 'Comptroller').eq('is_active', true).limit(1).single(),
    anonSupabase.from('semesters').select('id').eq('is_active', true).single(),
  ])

  // Comptroller name (for static fact #8)
  let comptrollerName: string | null = null
  if (comptrollerResult.status === 'fulfilled' && comptrollerResult.value.data?.full_name) {
    comptrollerName = comptrollerResult.value.data.full_name
  }

  // Bookings this semester (depends on sem.id — second wave)
  let bookingsThisSemester: number | null = null
  const sem = semResult.status === 'fulfilled' ? semResult.value.data : null
  if (sem) {
    try {
      const { count } = await anonSupabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('semester_id', sem.id)
      if (typeof count === 'number') bookingsThisSemester = count
    } catch {}
  }

  // Build fact pool
  const pool: Fact[] = [
    { kind: 'static', text: 'SGA has represented Northeastern students since 1924.' },
    { kind: 'static', text: 'SGA oversees $4.8M in annual student organization funding.' },
    { kind: 'static', text: 'Northeastern has over 500 recognized student organizations.' },
    { kind: 'static', text: "SGA's Senate meets 10–15 times per semester." },
    { kind: 'static', text: "The Division of Operational Affairs manages all of SGA's digital infrastructure." },
    { kind: 'static', text: 'Chambers was built in three months, two weeks, and four days.' },
    { kind: 'static', text: 'SGA serves an undergraduate student body of over 20,000.' },
    ...(comptrollerName
      ? [{ kind: 'static' as const, text: `Got questions? Contact the Comptroller, ${comptrollerName}.` }]
      : []),
    ...(bookingsThisSemester !== null && bookingsThisSemester > 0
      ? [{ kind: 'live' as const, label: 'Bookings this semester', value: bookingsThisSemester }]
      : []),
    // An "Active reservations right now" fact used to live here. It filtered on
    // status 'Confirmed', which exists in none of the three tables it queried --
    // the real vocabulary is Reserved / Tentative / Virtual / Alternate Time /
    // Waitlisted / Unavailable / Cancelled -- so its count was always 0 and the
    // fact, gated on `> 0`, could never render. It also compared Boston booking
    // times against a UTC clock. Its three queries ran on every load of the
    // entry page to produce nothing, so they are gone rather than repaired.
  ]

  // Fisher-Yates shuffle, pick first 1
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const [leftFact] = shuffled

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#112244] via-[#0a1628] to-[#060e1a] lg:grid lg:grid-cols-2">
      <style>{`@keyframes factFadeIn { from { opacity: 0; } to { opacity: 1; } } @keyframes keyFlyIn { from { opacity: 0; translate: 150vw 0px; } to { opacity: 0.17; translate: 0px 0px; } } @keyframes keyBodyRotate { from { transform: rotate(-120deg); } to { transform: rotate(0deg); } }`}</style>
      {/* Subtle grid texture */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

      {/* Decorative key graphic — right side, behind all content */}
      <div className="absolute hidden lg:block top-1/2 z-0 pointer-events-none select-none" style={{ left: '75%', transform: 'translateX(-50%) translateY(-50%)' }}>
        <svg
          width="700"
          viewBox="-220 -125 450 255"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ transform: 'scaleX(-1) rotate(-60deg)', opacity: 0.17, animation: 'keyFlyIn 1.2s cubic-bezier(0.22, 1, 0.36, 1) forwards' }}
        >
          <circle cx="-100" cy="0" r="95" fill="none" stroke="white" strokeWidth="40" />
          <circle cx="-100" cy="0" r="38" fill="#0a1628" />
          <g transform="translate(-100, 0)">
            <g style={{ animation: 'keyBodyRotate 1.4s cubic-bezier(0.22, 1, 0.36, 1) forwards' }}>
              <g transform="translate(100, 0)">
                <rect x="-15" y="-22" width="230" height="44" rx="10" fill="white" />
                <rect x="80" y="-22" width="40" height="90" rx="8" fill="white" />
                <rect x="130" y="-22" width="40" height="72" rx="8" fill="white" />
                <rect x="180" y="-22" width="40" height="110" rx="8" fill="white" />
              </g>
            </g>
          </g>
        </svg>
      </div>

      {/* Left column: login card — always visible, vertically centered */}
      <div className="flex items-center justify-center lg:justify-end min-h-screen lg:min-h-0 relative z-10 px-4 lg:pr-2">
        <LoginCard />
      </div>

      {/* Right column: fact — desktop only */}
      <div className="hidden lg:flex items-center justify-start pl-16 relative z-10">
        {leftFact && <FactDisplay fact={leftFact} />}
      </div>
    </div>
  )
}
