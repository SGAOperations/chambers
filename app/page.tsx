import { createClient } from '@/lib/supabase/server'
import LoginCard from '@/app/_components/LoginCard'

type StaticFact = { kind: 'static'; text: string }
type LiveFact   = { kind: 'live'; label: string; value: number }
type Fact = StaticFact | LiveFact

function FactDisplay({ fact }: { fact: Fact }) {
  if (fact.kind === 'live') {
    return (
      <div className="text-center px-8 max-w-sm" style={{ animation: 'factFadeIn 1.4s ease both' }}>
        <p className="text-sm text-white/30 uppercase tracking-widest mb-3">{fact.label}</p>
        <p className="text-4xl text-white/40 leading-snug">{fact.value.toLocaleString()}</p>
      </div>
    )
  }
  return (
    <div className="text-center px-8 max-w-sm" style={{ animation: 'factFadeIn 1.4s ease both' }}>
      <p className="text-4xl text-white/40 leading-snug">{fact.text}</p>
    </div>
  )
}

export default async function LoginPage() {
  const supabase = await createClient()

  // Comptroller name (for static fact #8)
  let comptrollerName: string | null = null
  try {
    const { data } = await supabase
      .from('users')
      .select('full_name')
      .eq('admin_role', 'Comptroller')
      .eq('is_active', true)
      .limit(1)
      .single()
    if (data?.full_name) comptrollerName = data.full_name
  } catch {}

  // Bookings this semester
  let bookingsThisSemester: number | null = null
  try {
    const { data: sem } = await supabase
      .from('semesters')
      .select('id')
      .eq('is_active', true)
      .single()
    if (sem) {
      const { count } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('semester_id', sem.id)
      if (typeof count === 'number') bookingsThisSemester = count
    }
  } catch {}

  // Active reservations right now
  let activeNow = 0
  const now = new Date()
  const todayDate = now.toISOString().split('T')[0]           // 'YYYY-MM-DD'
  const nowTime   = now.toTimeString().split(' ')[0].slice(0, 5) // 'HH:MM'

  try {
    const { count: c1 } = await supabase
      .from('one_time_room_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('booking_date', todayDate)
      .lte('start_time', nowTime)
      .gte('end_time', nowTime)
      .eq('status', 'Confirmed')
    if (typeof c1 === 'number') activeNow += c1
  } catch {}

  try {
    const { count: c2 } = await supabase
      .from('weekly_room_occurrences')
      .select('id', { count: 'exact', head: true })
      .eq('occurrence_date', todayDate)
      .lte('start_time', nowTime)
      .gte('end_time', nowTime)
      .eq('status', 'Confirmed')
    if (typeof c2 === 'number') activeNow += c2
  } catch {}

  try {
    const { count: c3 } = await supabase
      .from('tabling_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('session_date', todayDate)
      .lte('start_time', nowTime)
      .gte('end_time', nowTime)
      .eq('status', 'Confirmed')
    if (typeof c3 === 'number') activeNow += c3
  } catch {}

  // Build fact pool
  const pool: Fact[] = [
    { kind: 'static', text: 'SGA has represented Northeastern students since 1926.' },
    { kind: 'static', text: 'SGA oversees $4.8M in annual student organization funding.' },
    { kind: 'static', text: 'Northeastern has over 600 recognized student organizations.' },
    { kind: 'static', text: "SGA's Senate meets 10–15 times per semester." },
    { kind: 'static', text: "The Division of Operational Affairs manages all of SGA's digital infrastructure." },
    { kind: 'static', text: 'Chambers was built in three months, two weeks, and four days.' },
    { kind: 'static', text: 'SGA serves an undergraduate student body of over 20,000.' },
    ...(comptrollerName
      ? [{ kind: 'static' as const, text: `For questions, contact the Comptroller, ${comptrollerName}.` }]
      : []),
    ...(bookingsThisSemester !== null && bookingsThisSemester > 0
      ? [{ kind: 'live' as const, label: 'Bookings this semester', value: bookingsThisSemester }]
      : []),
    ...(activeNow > 0
      ? [{ kind: 'live' as const, label: 'Active reservations right now', value: activeNow }]
      : []),
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
      <style>{`@keyframes factFadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
      {/* Subtle grid texture */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

      {/* Decorative key graphic — right side, behind all content */}
      <div className="absolute hidden lg:block top-1/2 z-0 pointer-events-none select-none" style={{ left: '75%', transform: 'translateX(-50%) translateY(-50%)' }}>
        <svg
          width="700"
          viewBox="-220 -125 450 255"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ transform: 'scaleX(-1) rotate(-60deg)', opacity: 0.17 }}
        >
          <circle cx="-100" cy="0" r="95" fill="none" stroke="white" strokeWidth="40" />
          <circle cx="-100" cy="0" r="38" fill="#0a1628" />
          <rect x="-15" y="-22" width="230" height="44" rx="10" fill="white" />
          <rect x="80" y="-22" width="40" height="90" rx="8" fill="white" />
          <rect x="130" y="-22" width="40" height="72" rx="8" fill="white" />
          <rect x="180" y="-22" width="40" height="110" rx="8" fill="white" />
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
