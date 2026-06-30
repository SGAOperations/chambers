import Link from 'next/link'

export default function LegalPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#112244] via-[#0a1628] to-[#060e1a] flex items-start justify-center px-4 py-12 relative">
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

      <div className="bg-[#184073] rounded-2xl shadow-2xl w-full max-w-2xl p-10 space-y-8 relative z-10">
        {/* Brand */}
        <div>
          <span className="text-[#c8102e] font-bold text-3xl tracking-tight">Chambers</span>
          <p className="text-[#93b8d8] text-xs mt-1">Northeastern University Student Government Association (NUSGA)</p>
        </div>

        {/* Privacy Policy */}
        <div id="privacy">
          <h1 className="text-[#f0f6ff] font-semibold text-xl">Privacy Policy</h1>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">What We Collect</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Chambers collects only the information necessary to operate the SGA room reservation system: your name and Northeastern email address provided at onboarding, your SGA body memberships and administrative roles, a history of your room reservation requests and their statuses, and session activity timestamps used for idle-session security enforcement.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">How We Use It</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Your information is used exclusively to facilitate room reservations for SGA activities, send booking status notifications via Slack, and enforce role-based access controls within the platform. We do not use your data for advertising, analytics sold to third parties, or any purpose unrelated to SGA operations.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">Storage &amp; Infrastructure</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Data is stored on Supabase, a cloud database provider hosted in the United States. Slack is used for booking notifications. Beyond these infrastructure services, your data is not shared with or sold to any third parties.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">Retention &amp; Deletion</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Your account data is retained for as long as your SGA membership is active, and for a reasonable period thereafter for recordkeeping purposes. To request deletion of your data, contact the Vice President of Operational Affairs via Slack.
            </p>
          </section>
        </div>

        {/* Divider */}
        <div className="border-t border-[#1e5080]" />

        {/* Terms of Service */}
        <div id="terms">
          <h1 className="text-[#f0f6ff] font-semibold text-xl">Terms of Service</h1>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">Eligibility</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Access to Chambers is restricted to active SGA members who have received a valid invitation from an administrator or have been granted access to closed-body information by an administrator. Use of this platform by unauthorized individuals is prohibited.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">Acceptable Use</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Chambers may only be used for legitimate SGA room reservations. Abuse of the booking system — including making reservations for non-SGA purposes, submitting false booking information, or exploiting the platform in any unintended way — is prohibited and may result in immediate access revocation.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">Account Security</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              You are responsible for maintaining the confidentiality of your credentials. Do not share your password or allow others to access your account. Report any suspected unauthorized access to an administrator immediately.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">Accurate Information</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              You agree to provide accurate and complete information when creating bookings and maintaining your account profile. Knowingly submitting false information is a violation of these terms.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">Termination</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              NUSGA reserves the right to suspend or terminate access to Chambers at any time, with or without notice, for violations of these terms or for any other operational reason. These terms may be updated periodically; continued use of Chambers constitutes acceptance of any changes.
            </p>
          </section>
        </div>

        <div className="border-t border-[#1e5080] pt-6 flex items-center justify-between">
          <Link href="/" className="text-sm text-[#93b8d8] hover:text-[#f0f6ff] font-medium transition">
            ← Back to Chambers
          </Link>
          <span className="text-xs text-[#6a96bb]">© 2026 NUSGA</span>
        </div>
      </div>
    </div>
  )
}
