# Chambers for NUSSO (browser extension)

Northeastern accepts connections to nuevents.neu.edu (EMS, "NUSSO") only from
the campus network or the Northeastern VPN, so Chambers' servers on Vercel
cannot reach it. This extension lets Chambers reach NUSSO the way you already
can: **from your own browser, with your own NUSSO sign-in, while you are on
campus or the VPN.**

Chambers' server never connects to NUSSO. It checks who may book and records
what was booked. Browsing and booking happen between your browser and NUSSO.
That is ordinary use of access you already have, which keeps it inside
[Policy 700](https://policies.northeastern.edu/policy700). (The server-side
relay in `relay/` would not be, and stays dormant.)

## How it works

```
Chambers page ──(chrome.runtime message)──▶ extension ──HTTPS, your NUSSO session──▶ nuevents.neu.edu
     │                                                                          (campus / VPN)
     └── /api/nusso/book/prepare and /book/record ──▶ Chambers server (checks, records; never calls EMS)
```

- The Browse/Book page runs the NUSSO client (`lib/nusso/client.ts`) in the
  browser. `lib/nusso/local.ts` sends each EMS call to this extension, which
  sends it from your browser with your NUSSO cookies and the page's CSRF token.
- Booking: Chambers checks the booking (`/book/prepare`: you may book, the
  form is complete, Chambers can record it) → your browser makes the NUSSO
  reservation → Chambers records it in My Rooms (`/book/record`).
- Without the extension, Chambers falls back to its server, which answers 503
  from Vercel.

## What it can and cannot do

- Only Chambers' own pages can talk to it (`externally_connectable`:
  chambers.northeasternsga.com and localhost for development).
- It only sends the ServerApi calls Chambers uses: room and booking browse,
  availability, the three booking steps, and cancel. Anything else is refused.
- It knows no password and stores nothing. It uses the NUSSO session you
  already have in this browser.
- It sets Origin/Referer to nuevents.neu.edu only on its own requests. Your
  normal NUSSO tabs are untouched.

## Install (Chrome or Edge, desktop)

1. Get the `extension/nusso` folder: run `scripts/pack-nusso-extension.sh` and
   unzip `chambers-nusso-extension.zip`, or copy the folder from the repo.
2. Go to `chrome://extensions` (or `edge://extensions`) and turn on
   **Developer mode**.
3. Click **Load unpacked** and choose the folder.
4. On campus or the VPN, sign in to [nuevents.neu.edu](https://nuevents.neu.edu)
   (the extension's toolbar button opens it). Then use Browse/Book Rooms in
   Chambers as usual.

The `key` in `manifest.json` fixes the extension id at
`plhndefpbpcglbhgmimjejkchmmoopbi`, which Chambers looks for. A Chrome Web
Store listing would get its own id: set `NEXT_PUBLIC_NUSSO_EXTENSION_ID` to it
in Vercel.

## Your NUSSO account

Bookings are made under the NUSSO account you are signed in as, so they carry
your name, and NUSSO must allow your account to book for SGA's group. If it
does not, NUSSO's own error appears in Chambers.

## Not yet covered

- Cancelling from My Rooms still goes through the server, so from Vercel it
  falls back to a manual cancellation request.
- Phones: Chrome on Android and iOS does not run extensions.

## Verified

`tests/nusso-extension.test.ts` covers the page side and the worker. The
worker was also run in real Chromium against a stand-in for nuevents.neu.edu:
it reported signed-out, then (after signing in in a normal tab) sent your
session cookies, the CSRF token and the rewritten Origin/Referer, and left a
normal tab's requests alone. It has not yet run against the real NUSSO.
