'use client'

import {
  BAR_START_MINUTES,
  BAR_RANGE_MINUTES,
  formatBarTime,
  occupancyAt,
  orderSpaces,
  toSegments,
  type DisplaySpace,
  type Occupancy,
} from '@/lib/spaces-display'

/**
 * The All Spaces card on the corridor display.
 *
 * Its own file rather than another hundred lines in page.tsx, which already
 * carries the rotation, the polling and the meeting card. Exported so it can be
 * rendered against fixtures without a DISPLAY_KEY or a database -- the layout is
 * the part of this most likely to be wrong, and it is the part hardest to reach
 * behind the display's key gate.
 */

/**
 * The hours the shared axis is labelled at.
 *
 * Every other hour: enough to place a block by eye from across the corridor,
 * few enough that the labels do not crowd into each other on the short edge of
 * a wall-mounted screen.
 */
const HOUR_TICKS = [7, 9, 11, 13, 15, 17, 19, 21, 23]

/**
 * The panel chrome, written once because the time axis has to mirror it exactly.
 *
 * The axis is a fourth column with no border and no text, so the only thing
 * keeping 7:00 AM level with the top of the bars is that it carries the same
 * border width, the same padding and the same two header lines as a panel. A
 * margin guessed against them drifts the moment the type rescales, which on a
 * viewport-sized board is every screen it gets hung on.
 */
const PANEL_INSET = 'border-[0.25vh] p-[1.4vh]'
const HEADER_NAME = 'text-[min(2.19vw,3.89vh)] font-bold'
const HEADER_STATUS = 'text-[min(1.41vw,2.5vh)] font-medium mt-[0.8vh]'
const BAR_TOP = 'relative flex-1 min-h-0 mt-[1.8vh]'

function topPctOf(minutes: number): number {
  return ((minutes - BAR_START_MINUTES) / BAR_RANGE_MINUTES) * 100
}

/**
 * The wash inside each panel.
 *
 * The same two colours the per-space kiosk uses for its whole screen -- red for
 * a room you cannot walk into, green for one you can -- so the two displays do
 * not disagree about what red means. Closed and in use share the red, as they
 * do there: the difference between them matters to whoever booked it and not at
 * all to someone deciding whether to try the door.
 *
 * Held inside the panel rather than bled across the board. A wash that runs
 * past its own space says something about the space next to it, which on a
 * three-panel board is the one thing the colour must never do.
 */
const TINTS: Record<Occupancy['state'], string> = {
  free: 'bg-[#093318]',
  'in-use': 'bg-[#2e0707]',
  closed: 'bg-[#2e0707]',
}

/** What a space is doing, in the fewest words that still say when it changes. */
function statusLine(occupancy: Occupancy): { text: string; className: string } {
  if (occupancy.state === 'closed') {
    // Lighter than the red used elsewhere for a warning, because this one sits
    // on a red panel rather than on the board's own near-black.
    return { text: `Closed until ${formatBarTime(occupancy.untilMinutes)}`, className: 'text-[#fca5a5]' }
  }
  if (occupancy.state === 'in-use') {
    return { text: `In use until ${formatBarTime(occupancy.untilMinutes)}`, className: 'text-[#f0f6ff]' }
  }
  // "Free" with nothing after it reads as a field that failed to load, so the
  // no-more-bookings case says so in as many words rather than trailing off.
  return {
    text: occupancy.nextStartMinutes === null
      ? 'Free · nothing else today'
      : `Free until ${formatBarTime(occupancy.nextStartMinutes)}`,
    className: 'text-[#4ade80]',
  }
}

/**
 * Every SGA Space and its day, as one card in the rotation.
 *
 * Three panels in the order given for this screen -- President's Corner, Recess
 * Corner, Conference Room -- with time running down a shared axis on the left.
 * Fixed rather than sorted, so the columns never swap under someone who has
 * learned where to look.
 *
 * This card always shows now, even when the meetings beside it have rolled on
 * to a later day. That is deliberate and it is why the label says so: an
 * occupancy bar is only worth reading live, and a reader who sees "Tomorrow" on
 * one card must not carry it over to this one.
 */
export function SpacesCard({ spaces, nowMinutes }: { spaces: DisplaySpace[]; nowMinutes: number }) {
  // Worked out once per space and used twice: for the words and for the wash
  // behind them, which must never disagree.
  const states = orderSpaces(spaces).map(space => ({
    space,
    occupancy: occupancyAt(space, nowMinutes),
    segments: toSegments(space),
  }))

  const nowPct = topPctOf(nowMinutes)
  // Before 7 AM the marker would sit above the bar, which reads as a block of
  // its own rather than as the time.
  const nowOnBar = nowPct >= 0 && nowPct <= 100

  return (
    <div className="flex-1 min-h-0 flex flex-col px-[4.2vw] pb-[1.5vh]">
      <p className="text-[min(1.88vw,3.33vh)] font-medium uppercase tracking-widest text-[#93b8d8]">
        Right now
      </p>

      <div className="flex-1 min-h-0 flex gap-[1.4vw] mt-[2.6vh]">
        {/* One axis for all three panels, rather than three sets of labels: the
            panels are read against each other, so they have to share a scale.
            Transparent border and invisible header lines, so it lines up with
            the bars by construction -- see PANEL_INSET. */}
        <div
          className={`w-[5.5vw] flex-shrink-0 flex flex-col border-transparent ${PANEL_INSET}`}
          aria-hidden
        >
          <p className={`${HEADER_NAME} invisible`}>&nbsp;</p>
          <p className={`${HEADER_STATUS} invisible`}>&nbsp;</p>
          <div className={BAR_TOP}>
            {HOUR_TICKS.map(h => (
              <span
                key={h}
                className="absolute right-0 -translate-y-1/2 text-[min(1.15vw,2.04vh)] text-[#6a96bb] tabular-nums whitespace-nowrap"
                style={{ top: `${topPctOf(h * 60)}%` }}
              >
                {formatBarTime(h * 60)}
              </span>
            ))}
          </div>
        </div>

        {states.map(({ space, occupancy, segments }) => {
          const status = statusLine(occupancy)
          // Blackouts paint over the bookings they cover, matching occupancyAt,
          // which lets a closure outrank a booking. Painted underneath instead,
          // a three-hour closure with an hour's booking inside it came out as
          // two separate red blocks beside a status line reading "Closed".
          const painted = [...segments].sort(
            (a, b) => Number(a.kind === 'blackout') - Number(b.kind === 'blackout')
          )

          return (
            <div
              key={space.id}
              className={`flex-1 min-w-0 flex flex-col rounded-[1.6vh] border-white/75 transition-colors duration-1000 ease-in-out ${PANEL_INSET} ${TINTS[occupancy.state]}`}
            >
              <p className={`${HEADER_NAME} text-[#f0f6ff] truncate`}>{space.name}</p>
              <p className={`${HEADER_STATUS} truncate ${status.className}`}>{status.text}</p>

              {/* Darker than the panel rather than lighter, so a block reads as
                  something laid on the day rather than as a hole in it. */}
              <div className={`${BAR_TOP} rounded-[0.8vh] bg-black/30 overflow-hidden`}>
                {painted.map(seg => (
                  <div
                    key={seg.id}
                    className={`absolute left-0 right-0 px-[0.5vw] overflow-hidden ${
                      seg.kind === 'blackout'
                        ? 'bg-[#991b1b] border-y border-[#fca5a5]/50'
                        : 'bg-[#2563a8] border-y border-[#93b8d8]/30'
                    }`}
                    style={{ top: `${seg.offsetPct}%`, height: `${seg.lengthPct}%` }}
                  >
                    {/* Only where the block is tall enough to hold a line of it.
                        A title clipped to two characters is noise on a screen
                        read at a walking pace. */}
                    {seg.lengthPct >= 7 && (
                      <p className="text-[min(1.09vw,1.94vh)] text-[#f0f6ff] leading-tight truncate">
                        {seg.kind === 'blackout' ? 'Closed' : seg.title ?? 'Booked'}
                      </p>
                    )}
                  </div>
                ))}

                {nowOnBar && (
                  /* A knob at the leading edge, centred on the minute. A bare
                     rule across a block read as a strikethrough -- which on this
                     display already means cancelled, on the meeting card beside
                     this one -- so a booking the line happened to cross looked
                     called off. */
                  <div
                    className="absolute left-0 right-0 z-10 flex items-center -translate-y-1/2"
                    style={{ top: `${nowPct}%` }}
                    aria-hidden
                  >
                    <span className="w-[1vh] h-[1vh] rounded-full bg-[#4ade80] flex-shrink-0" />
                    <span className="flex-1 h-[0.35vh] bg-[#4ade80]" />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
