import Link from 'next/link'
import { db } from '@/lib/db/data-api'

type RoleHolder = { full_name: string; admin_role: string }

/**
 * Who currently holds the two roles the FAQ names. A failed read -- including a
 * build with no database configured, like CI's -- falls back to the role titles
 * below rather than failing the page.
 */
async function loadRoleHolders(): Promise<RoleHolder[]> {
  try {
    const { data } = await db
      .from('users')
      .select('full_name, admin_role')
      .in('admin_role', ['Vice President of Operational Affairs', 'Digital Innovation Manager'])
    return (data as RoleHolder[] | null) ?? []
  } catch {
    return []
  }
}

export default async function FaqPage() {
  const roles = await loadRoleHolders()

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
            <h2 className="text-[#f0f6ff] font-medium text-base">v2.2.0</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              We don&apos;t exactly know yet! If there&apos;s anything you&apos;d like to see, send a Slack DM to the Vice President of Operational Affairs ({vpName}) and the Digital Innovation Manager ({dimName}).
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v2.1.2 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Slack meeting reminders are no longer only for committees. Any body can have them &mdash; a board, a team, a working group. Ask an administrator to link your body&apos;s Slack channel in Management and invite the Chambers bot to it, and the bot will post there the day before each meeting, naming the room and the time.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              If you hold Leadership in the body, you can turn the reminders off yourself from inside the channel with /chambers-reminders off, and start them again with /chambers-reminders on. Nothing changes for the committees that already get reminders, and no body starts getting them until its channel is linked.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v2.1.1 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              The corridor committee display now scales to whatever screen it lands on, so the same board fills a small monitor and a large one without anything being cut off or stranded in a corner.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v2.1.0 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Recurring bookings now arrive in Outlook as one repeating event instead of a separate attachment for each week. A weekly SGA Space series or weekly room booking used to vanish from your calendar after the first week; the whole series now shows.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              There is a new corridor display for committee meetings. It cycles through one meeting at a time, names the room and the time, and points the way when it is time to walk. A cancelled meeting stays on the board through its slot &mdash; with no direction to walk in &mdash; so nobody sets off to a meeting that is not happening. IEMS events are drawn too.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Smaller things: the weekly bookings grid leads with the reservation code, pending actions are measured against Boston&apos;s date rather than the server&apos;s, NUSSO bookings can be seen and audited from Management, editing a room series no longer wipes an override you had made on a past week, and room bookings follow the same choice of email destination that SGA Space bookings already did.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v2.0.0 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Chambers can now book Northeastern&apos;s own room system directly. The new Browse/Book NUSSO tab searches nuevents for free rooms and reserves one without leaving Chambers, tabling included. A booking made this way is recorded in My Rooms like any other, and cancelling it in Chambers releases the real reservation instead of leaving a room held for a meeting nobody will attend.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Booking through NUSSO makes you responsible for the space, so the Safety &amp; Security terms are quoted where you agree to them, and booking is limited to official SGA meetings. Anyone signed in can browse. Booking is limited to admins and body Leadership, because it acts under SGA&apos;s shared account and puts a real reservation on Northeastern&apos;s calendar.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.17.0 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              SGA Space bookings can now repeat every other week, not only every week.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Tabling requests now ask where you would like to table and how many tables you need, and weekly room requests start on the hour or the half hour.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Event tracking can carry extra forms, each with its own deadline, set per event.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.16.1 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Internal safeguards, with nothing to do differently: no preview or test copy of Chambers can email a real student, and a missing email key outside production no longer breaks the page.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.16.0 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Chambers moved to a new database and a new login system. Your account and your password carried over &mdash; sign in exactly as you did before. Nothing else about the app changed; this release was the groundwork.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.15.2 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              A booking now records when the meeting itself starts, separately from the window the room is held for. A body that books 6:00 to 9:00 to allow for setup can still tell its members to arrive at 6:30, and reminders and cards print that time rather than the moment the room merely unlocks. On My Rooms cards, Start Time gets its own line.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              An admin can now dismiss a cancellation request, and dismissing one leaves the booking as it was instead of stranding it as pending. A whole weekly SGA Space booking can move to a different space.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Long SGA Space booking text wraps instead of running off the card, anyone can open a booking to view it, each audit entry says what changed and where, and the Attendance Manager link is now called Go to SenatePortal.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.15.1 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Room bookings now come with a calendar invite, the way SGA Space bookings already did.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              You can add external attendees to an SGA Space booking, so someone without a Chambers account still gets the invite by email.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              A request now moves through Ops Review and Awaiting CSC, so you can tell whether Operational Affairs still has it or has passed it to CSC Operations. The All spaces calendar has a phone layout.
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
              Operational Affairs is working to standardize account management across SGA custom projects (Chambers, SenatePath, SenatePortal, Aplio, and more). Once centralized accounts have been successfully tested on our products, they&apos;ll be implemented fully as v2.0.0.
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
