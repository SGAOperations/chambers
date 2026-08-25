import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import SlackConnectForm from './SlackConnectForm'

export default async function SlackConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  const supabase = await createClient()
  const user = await getAuthedUser(supabase)

  if (!user) {
    const redirectTo = token
      ? `/?redirectTo=${encodeURIComponent(`/slack/connect?token=${token}`)}`
      : '/'
    redirect(redirectTo)
  }

  if (!token) {
    return (
      <PageShell>
        <p className="text-[#93b8d8] text-sm text-center">
          This connect link is invalid. Please use the link sent to you in Slack.
        </p>
      </PageShell>
    )
  }

  return <SlackConnectForm token={token} />
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#112244] via-[#0a1628] to-[#060e1a] flex items-center justify-center px-4 relative">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      <div className="bg-[#184073] rounded-2xl shadow-2xl w-full max-w-md p-10 space-y-6 relative z-10">
        <div className="text-center space-y-1">
          <p className="text-[#c8102e] font-bold text-3xl tracking-tight">Chambers</p>
        </div>
        {children}
      </div>
    </div>
  )
}
