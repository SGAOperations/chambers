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
            <h2 className="text-[#f0f6ff] font-medium text-base">v2.3.0</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              We don&apos;t exactly know yet! If there&apos;s anything you&apos;d like to see, send a Slack DM to the Vice President of Operational Affairs ({vpName}) and the Digital Innovation Manager ({dimName}).
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v2.2.0</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              My Rooms now explains itself. Next to All Bookings there is a link, &ldquo;What do these statuses mean?&rdquo;, that lists every status a booking can carry &mdash; Reserved, Waitlisted, Pending Cancellation, Virtual and the rest &mdash; in the colour it appears in, with a line on what it means and whether you need to do anything about it.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Operational Affairs hears about a request the moment it is filed. Every new booking, revision and cancellation request sends a Slack message to the Vice President of Operational Affairs and the Comptroller, leading with how soon the reservation is, so a cancellation filed an hour before a meeting is read in time to matter. Tabling requests can also go to CSC in a batch: Auto-Request Tables writes the reservation email for the ones an administrator picks, the way Auto-Cancel already does for cancellations. Only a request with every detail filled in can go, so a tabling request now needs a preferred location for each session &mdash; on the request form and in <code>/chambers-table</code> on Slack, which also asks for the number of tables now. Auto-Cancel itself no longer offers dates that have passed, or cancellations that were dismissed.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              IEMS can now black out the Conference Room for events in SGA, from the SGA Spaces page, without going through Operational Affairs. The Student Body President&apos;s view-only role can open any booking to read its details, still with nothing to edit or cancel. And a divisional booking is named for its division on the corridor display &mdash; &ldquo;Division of Campus Affairs&rdquo; rather than whichever committee happened to file it.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v2.1.7</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              There is a new administrator role for the Student Body President, and it is the first one that only reads. It opens the Bookings tab and nothing else &mdash; no Requests, no Cancellations, no SGA Spaces, no Management, no Events &mdash; and on that tab there is nothing to click: no new booking, no edit, no cancel, no marking an event or hiding a row. The office can see what the organisation has booked without being handed the booking work along with it.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              The Digital Innovation Project Member role has been removed. Anyone who held it is no longer an administrator; Comptroller is the equivalent role for someone who should keep doing the booking work.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v2.1.6</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Slack reminders now reach everyone a booking is for. A divisional booking &mdash; one made for a whole division rather than a single body &mdash; used to remind only the committee that happened to file it, and announced that committee as the one meeting. It now posts in every channel across the division, names the division, and says underneath which body booked it and who it is open to. A booking that belongs to one body reads exactly as it always did, and a channel that has switched reminders off still gets nothing.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              The audit log has started recording cancellation requests. Asking for a cancellation moves a booking to Pending Cancellation, but the log only ever picked the story up at the far end, when an administrator marked the request done or dismissed it &mdash; so a booking sitting at Pending Cancellation had nothing on it saying who put it there or when. Every request now writes its own entry, naming the week, session or series it covers and the status it moved from.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Cancellation requests also show the time they came in, not just the date. How much notice CSC was given is often what decides whether a room can still be released, and a date on its own could not answer that for a request made the day before.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v2.1.5</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              An event form that was never required can now be marked as such. The Event Management Form is not asked for when the event is in a normal Curry space, and until now there was nothing to do about it: the form sat on the Administrator&apos;s pending actions until the event passed, turning red on the way, and the only way to clear it was to tick a form nobody had filled in.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Administrators now get a &ldquo;Not required&rdquo; option beside the Event Management Form and the Engage Form on each event in the Events tab. A form marked that way stops being a pending action, reads as not required rather than as done, and can be put back if it turns out to be needed after all. Ticking forms off works exactly as before, and anyone who can open the Events tab can still do that.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v2.1.4</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              On the corridor display, a meeting whose body name runs to two lines no longer pushes the room and its arrow down onto the footer. The spacing closes up instead, so the room is clear of the bottom of the screen whatever the body is called.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              The arrows are drawn heavier, too. They were letters borrowed from the typeface and read as too thin from across a corridor next to the chevrons beside them.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v2.1.3 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              The corridor display now carries the SGA Spaces too. A panel each for President&apos;s Corner, Recess Corner and the Conference Room comes round in the rotation, showing the day as a bar and colouring the whole panel green when the space is free and red when it is not, so you can tell from down the hall whether there is anywhere to sit.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              It also points at rooms outside Curry. Snell, Egan, Krentzman, Blackman, Ryder, West Village and Centennial each have a direction now, where before they got a room name and nothing else. How far the walk is shows in the mark: an arrow for this floor, one chevron for another floor, two for another building.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              The SGA Spaces calendar no longer draws midnight to six. Nothing can be booked before 7 AM, so those hours were a quarter of the grid you had to scroll past to reach the times you actually wanted.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              The version under the Chambers name in the sidebar is now read from the build itself, so it always matches what you are running. It had been typed in by hand and could sit a release behind.
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
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.13.8 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Room requests now ask how many people you expect, and an admin can deny a revision request rather than only accepting it. The SGA Spaces calendar fills the page instead of sitting in a narrow column.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              The richer booking cards and the new update emails also landed here; they are described under v1.14.0.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.13.7 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Being signed out for idling stopped being so aggressive: a session is held for hours rather than tens of minutes. The idle sign-out now works when you have no network, and a dropped connection says so rather than reporting &ldquo;failed to fetch&rdquo;.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.13.6 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              The Administrator area was split in two: Bookings, for the day-to-day work, and a separate Management page for the settings that need a higher role. Pending actions and booking rows are titled by what the booking is for, rather than by the body that holds it.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.13.5 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              A single week of a weekly booking can now override its own purpose and visibility, so one week can be private or described differently without touching the series. Weekly events are marked on the week rather than the series.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Signing out signs out the device you are on and leaves your other sessions alone. An error from the server no longer takes the whole page down with it.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.13.4 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              My Rooms is rendered on the server with one unambiguous idea of what &ldquo;today&rdquo; is, so it no longer disagrees with itself depending on where you opened it. The Events tab is ordered by when the event happens rather than when it was created.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Roles are read from your account rather than from your sign-in token, which means a change to your role or standing takes effect immediately instead of waiting for you to sign in again.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.13.3 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Clicking a week of a weekly booking opens that week, and scrolls it into view rather than leaving you to hunt for it.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.13.2 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              The Pending Actions badge is coloured by how urgent the oldest item is, with a breakdown on hover, and the thresholds behind it can be edited in Other Settings. Actions that cannot be undone sit idle for a moment before they will take a click.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              A long pass on speed: the dashboard loads from a single call rather than several, the font is served by Chambers instead of fetched from elsewhere, and the functions behind the dashboard are kept warm so the first page of the day is not the slowest.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.13.1 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Date fields were rebuilt so they stop overflowing their box on phones, which had been cutting the year off. Mobile layout was fixed across five more screens, and the weekly bookings view in Administrator is segmented by day of the week.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              The room display stops polling while it is in the background, and a request now shows which bodies it was made on behalf of.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.13.0 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              A booking can belong to more than one body. All seven booking forms carry a scope selector, and permission to edit a booking is resolved across every body in that scope rather than just the first.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Members are no longer told about hidden bookings, which had been announcing bookings that were meant to be private.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.12.4 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              The My Rooms bookings view was reworked. Email recipients are blind-copied instead of being listed where everyone can read them, the Administrator tab bar scrolls on a phone, and progress through an event checklist survives closing the tab.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.12.3 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Sign-in is restricted to northeastern.edu addresses, and moving between dashboard pages got noticeably quicker.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.12.2 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              The Information Manager role was added. Bookings outside the active semester can be edited, admins can look at any date on the SGA Spaces calendar, and a booking no longer reports one status when created and a different one when edited.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.12.1 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Fixes: the SGA Spaces calendar display, a signup passcode that could be sent to a deactivated address, and onboarding failing to record what it had just set.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.12.0 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Chambers arrived in Slack. You can ask for a room or a tabling session with a slash command, and link your Chambers account the first time with a one-time link sent to you in a DM.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.11.2 through v1.11.11 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              The SGA Space display arrived. Blackouts stopped misbehaving, a run of time-zone and login bugs was cleared, limit overrides showed up in Administrator again, and members can no longer drag out time slots on the SGA Space calendar they are not booking.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Several of the versions in this range contain nothing but build fixes, so they are collected here rather than listed one by one.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.11.0 and v1.11.1 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              A signup flow, so a new member can get an account without one being made for them, and users became searchable in Administrator.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.10.0 through v1.10.6 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              One-time passcodes arrived, with a flow for resetting them. Emails were restructured, protected against injection, and stopped reaching deactivated accounts.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              A stretch of time-zone and time-display bugs on SGA Spaces was fixed. Couch Corner became Recess Corner, and the Digital Innovation Manager was given access.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.9.0 through v1.9.3 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              SGA Spaces arrived, along with a substantial rework of the pages around it. Password reset was added, IEMS events were drawn for the first time, and loading skeletons replaced blank screens while a page was still fetching.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.7.0 through v1.8.2 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Chambers became installable on your phone as an app. The semester system arrived, so a booking belongs to a term, and cancellation notifications started going out.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">v1.0.0 through v1.6.2 &mdash; released</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Where Chambers started. In eleven days it went from an empty project to something SGA could use: room requests linked to bookings, My Rooms, the fulfilment and cancellation flow with admin badges and denial confirmations, revision requests, Senate session types and filtering, alerts and an audit trail, automatic emails, rate limiting, and the first access guards. It was named Chambers on 14 March, the day after the first commit.
            </p>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Version numbers in this stretch were written by hand while the app itself still reported 0.1.0, so the nineteen of them are collected here as one entry rather than pulled apart into releases that never quite existed.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[#f0f6ff] font-medium text-base">Centralized SGA accounts &mdash; planned</h2>
            <p className="text-[#93b8d8] text-sm leading-relaxed">
              Operational Affairs is working to standardize account management across SGA custom projects (Chambers, SenatePath, SenatePortal, Aplio, and more), so that one account signs you in to all of them. Once centralized accounts have been tested on our products they will be rolled out here; this entry will say which version carries them when that is settled.
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
