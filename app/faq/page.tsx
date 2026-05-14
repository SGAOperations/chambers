import Link from 'next/link'

export default function FaqPage() {
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
              We highly encourage you to self-assign to Committees and/or the Senate (open to students-at-large) and attend as a member! If you're also interested in joining a closed body, check SGA's website for open Board/Team positions.
            </p>
          </section>
        </div>

        <div className="border-t border-[#1e5080] pt-6">
          <Link href="/" className="text-sm text-[#93b8d8] hover:text-[#f0f6ff] font-medium transition">
            ← Back to login
          </Link>
        </div>
      </div>
    </div>
  )
}
