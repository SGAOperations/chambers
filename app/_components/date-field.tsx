'use client'

interface DateFieldProps {
  value: string // YYYY-MM-DD, matching a native <input type="date">
  onChange: (value: string) => void
  min?: string
  required?: boolean
}

function formatDisplay(value: string): string | null {
  if (!value) return null
  // Parsed as local midnight, not UTC, to avoid the date flipping back a day near midnight.
  const d = new Date(value + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * A styled wrapper around native <input type="date">.
 *
 * Confirmed on-device (issue #24) that mobile WebKit/Blink has two problems here no CSS fix
 * could reach:
 *   1. The overflow fixed in globals.css (-webkit-appearance: none) is necessary -- without it
 *      the native control's own chrome renders wider than its box and spills past it -- but it
 *      also throws away the native "mm/dd/yyyy" placeholder, since that ghost text was part of
 *      the chrome being stripped.
 *   2. The internal value/placeholder text renders centered on that engine regardless of
 *      text-align, direction, or targeting the ::-webkit-datetime-edit-* parts directly. Tried
 *      all three; none worked. The calendar-picker-indicator icon also doesn't reliably render
 *      once the host's `color` is set (some engines tie its fill to currentColor), and no CSS
 *      filter can recover an icon rendered at alpha 0.
 *
 * The only way left to control that text is to stop asking the browser to render it. The real
 * <input> is kept fully functional -- a real form control, tap opens the native picker, its own
 * value drives everything -- but rendered invisible and stretched to fill the box. Our own left-
 * aligned text and calendar icon draw on top from the bound value, which is guaranteed to render
 * identically everywhere since it's now plain content we control rather than native internals.
 */
export default function DateField({ value, onChange, min, required }: DateFieldProps) {
  const display = formatDisplay(value)

  return (
    <div className="relative w-full h-[42px] bg-[#0f2a4a] border border-[#1e5080] rounded-lg box-border focus-within:ring-2 focus-within:ring-[#c8102e]/30 focus-within:border-[#c8102e] transition">
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        min={min}
        required={required}
        // date-field-native-input hides two things this engine still renders despite the
        // input's text being transparent (both confirmed, see globals.css):
        //   - the calendar-picker-indicator, which would otherwise show faintly behind our
        //     own drawn icon on engines that don't tie its fill to text color;
        //   - the focused-segment selection highlight (e.g. tabbing into "mm"), which
        //     browsers render with their own default foreground specifically so selected
        //     text stays legible against transparent-text tricks -- it renders right over
        //     our overlay text otherwise.
        className="date-field-native-input absolute inset-0 w-full h-full m-0 px-3 box-border bg-transparent border-none text-sm text-transparent [color-scheme:dark] focus:outline-none appearance-none"
      />
      <span className="absolute inset-0 flex items-center justify-between gap-2 pl-3 pr-2.5 pointer-events-none">
        <span className={`text-sm truncate ${display ? 'text-[#f0f6ff]' : 'text-[#6a96bb]'}`}>
          {display ?? 'Select a date'}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#93b8d8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="flex-shrink-0"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </span>
    </div>
  )
}
