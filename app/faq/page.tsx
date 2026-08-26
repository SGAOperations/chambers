import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function FaqPage() {
  const { data: roles } = await adminSupabase
    .from('users')
    .select('full_name, admin_role')
    .in('admin_role', ['Vice President of Operational Affairs', 'Digital Innovation Manager'])

  const vpName = roles?.find(u => u.admin_role === 'Vice President of Operational Affairs')?.full_name ?? 'Vice President of Operational Affairs'
  const dimName = roles?.find(u => u.admin_role === 'Digital Innovation Manager')?.full_name ?? 'Digital Innovation Manager'

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#112244] via-[#0a1628] to-[#060e1a] flex items-start justify-center px-4 py-12 relative">
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

      <div className="bg-[#184073] rounded-2xl shadow-2xl w-full max-w-2xl p-10 space-y-8 relative z-10">
        {/* Brand */}
        <div>
          <span className="text-[#c8102e] font-bold text-3xl tracking-tight">Chambers</span>
          <p className="text-[#93b8d8] text-xs mt-1">Northeastern Student Government Association</p>
        </div>

        <div>
          <h1 className="text-[#f0f6ff] font-semibold text-xl">Update Roadmap</h1>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.14.0</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              We don't exactly know yet! If there's anything you'd like to see, send a Slack DM to the Vice President of Operational Affairs ({vpName}) and the Digital Innovation Manager ({dimName}).
            </p>
          </section>
        </div> 

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v2.0.0</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Operational Affairs is working to standardize account management across SGA custom projects (Chambers, SenatePath, Attendance Manager, Aplio, and more). Once centralized accounts have been successfully tested on our products, they'll be implemented fully as v2.0.0.
            </p>
          </section>
        </div>       

        <div>
          <h1 className="text-[#f0f6ff] font-semibold text-xl">Frequently Asked Questions</h1>
        </div>

        {/* FAQ list */}
        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">Why can&apos;t I self-assign my group?</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Some SGA Bodies, namely Committees, are open to all students and welcome new members at any time. These groups are able to be self assigned. Other groups, including Boards, Advisory Boards, and Teams are closed and have a defined number of members who are confirmed by the Executive Board, selected by a Leadership member, or otherwise selected in a closed process. These bodies are not able to be self-assigned to ensure only actual members of these bodies can view their information.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              We highly encourage you to self-assign to Committees and/or the Senate (open to students-at-large) and attend as a member! If you&apos;re also interested in joining a closed body, check <a href="https://www.northeasternsga.com/applications" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[#f0f6ff] transition">SGA&apos;s website</a> for open Board/Team positions.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">Why can&apos;t I see my Working Group rooms?</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Chambers is built to track reservations, not meetings. Though meeting times and reservation times often align, sometimes they don&apos;t, and a reservation in Chambers will appear longer than the actual meeting or event itself.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Since Working Groups get their rooms in collaboration with administration/faculty rather than via Operational Affairs, we don&apos;t track their rooms here unless we get a special request.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">Something is broken. Who do I contact?</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Send a Slack DM to the Vice President of Operational Affairs ({vpName}) and the Digital Innovation Manager ({dimName}).
            </p>
          </section>
        </div>

        <div className="border-t border-[#1e5080] pt-6">
          <Link href="/" className="text-sm text-[#93b8d8] hover:text-[#f0f6ff] font-medium transition">
            ← Back to Chambers
          </Link>
        </div>
      </div>
    </div>
  )
}
