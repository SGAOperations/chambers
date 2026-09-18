import Link from 'next/link'
import { db } from '@/lib/db/data-api'

const adminSupabase = db

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
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.16.0</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              We don&apos;t exactly know yet! If there&apos;s anything you&apos;d like to see, send a Slack DM to the Vice President of Operational Affairs ({vpName}) and the Digital Innovation Manager ({dimName}).
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.15.0 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              SGA Space bookings can now repeat weekly. When you book a space, tick Repeat weekly and choose the date it runs until, up to the end of the semester. If some weeks can&apos;t be booked &mdash; the space is already taken, a blackout covers it, the week would put you over your hours, or it&apos;s too soon to book &mdash; you&apos;ll see which ones before anything is saved, and you can book the rest. Weekly bookings are marked with &#8635; on the calendar, and you get one email for the whole series with a calendar invite covering every week.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Opening a week of a weekly booking lets you change just that week or the whole series. Changing the series updates every upcoming week, including weeks you had changed on their own, and cancelling it removes every upcoming week. Past weeks are always left as they were.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Editing an SGA Space booking now updates it on everyone&apos;s calendar, and you can move it to a different space instead of cancelling and booking again. People you add get the invite, and people you remove have it taken off their calendar.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              The SGA Spaces calendar now opens on All spaces, which shows every space side by side in its own colour, so you can find a free room without switching tabs. Clicking an open time selects an hour instead of 15 minutes, and dragging still sets any length.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Emails from Chambers now show &ldquo;Chambers&rdquo; as the sender instead of a bare address. On My Rooms, the Attendance Manager link on Senate cards no longer makes cards taller than the ones beside them.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.14.3 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              If you hold Leadership in a body, you can now choose where your SGA Spaces confirmations go: your personal email, your SGA email, or both. Open Settings and pick from the SGA emails that belong to the bodies you lead. Cancellations follow the same choice, so a booking&apos;s calendar invite and its cancellation always land in the same inbox.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              If you step down from the body whose SGA email you picked, your confirmations go back to your personal email automatically.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.14.2 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Bookings can now be marked Alternate Room and Time, for when both the room and the time have changed. It appears right under Alternate Time in status lists, in the same blue as the other alternates.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Committee meeting reminders in Slack have new wording. They name the room and time and call out in bold whichever one is an alternate, point you to your Chair or Director when a meeting is virtual, and say plainly when there is no meeting. A week that is waitlisted, tentative or pending cancellation gets no reminder at all until its status is settled.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.14.1 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Update emails about a weekly booking now describe the week that actually changed. They had been pointing at whichever week carried the oldest override, which was usually not the week anyone had touched &mdash; so the email named a date months off and listed no changes at all. If one save moves several weeks, the email now covers each of them rather than only the first.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Senate session types you deselect in Settings now stop the emails and the alerts too, not just the rows in My Rooms. If you follow Full Body but not Office Hours, you will still hear about a change that moved both.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              An SGA Space booking inside the advance notice window can be edited again. You can shorten it, start it later, rename it or cancel it outright at any point &mdash; only adding time to a booking still needs notice, and extending one that ends outside the window is fine. Previously such a booking could not be opened at all.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.14.0 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Your booking cards in My Rooms now lead with what the booking is <em>for</em> rather than which body it belongs to, and clicking one opens its full details. Full Body and Weekly Senate sessions carry a link straight to Attendance Manager.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Emails do more. You now get one when a booking is created, not only when it changes, and an update email says exactly what moved rather than just restating where the booking now is. If a single week of a weekly booking is edited, the email is about that week instead of the whole series.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Room requests now ask how many people you expect, so Operational Affairs can book a room that actually fits without having to come back and ask. The SGA Spaces calendar fills the page rather than sitting in a small scrolling box.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              For administrators: revision requests can now be denied with a reason, instead of sitting on the list forever when the change cannot be made. Auto-Cancel, on the Cancellations tab, sends CSC a single request covering whichever pending cancellations you select, and marks each one with the outcome its request asked for.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v2.0.0</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Operational Affairs is working to standardize account management across SGA custom projects (Chambers, SenatePath, Attendance Manager, Aplio, and more). Once centralized accounts have been successfully tested on our products, they&apos;ll be implemented fully as v2.0.0.
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
