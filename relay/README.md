# NUSSO relay (CSC office Raspberry Pis)

> **Status: dormant. Do not deploy.** Running this relay is not allowed under
> [Northeastern Policy 700](https://policies.northeastern.edu/policy700)
> (Appropriate Use of Computer and Network Resources), which requires the VPN
> for remote access to university resources. It would give an off-campus
> server standing access to a system Northeastern restricted to the campus
> network, without the VPN's sign-in. The code stays in the repository but does
> nothing unless `NUSSO_RELAY_URLS` and `NUSSO_RELAY_SECRET` are set, and they
> must stay unset unless Northeastern ITS approves this setup in writing.

## Background

Wiring NUSSO (nuevents.neu.edu, Northeastern's EMS) directly into Chambers is a
longstanding project of pataniaeli's. The direct integration shipped in v2.0.0
(September 2026): Chambers signed in to EMS as SGA's account, searched rooms
and placed and cancelled reservations itself (see
[docs/nusso-api.md](../docs/nusso-api.md)). It worked from Vercel for a time.

Then, in November 2026, Northeastern blocked connections to nuevents.neu.edu
from off-campus IP addresses unless they come through the Northeastern VPN.
Vercel's servers are off campus, so every NUSSO route began to fail. Chambers
now answers that with a 503 telling people to book on nuevents.neu.edu from
campus or the VPN. The VPN is no way around it for a server: its sign-in is a
Microsoft SAML redirect with MFA.

This relay is the design for reaching EMS from inside the campus network
instead: a small forwarder on the two Raspberry Pis in the CSC office, which
already run a Chambers display. It is built and tested against a stand-in for
EMS, and was never deployed, because of Policy 700 above. If ITS ever approves
it (or an equivalent they run), the setup below is ready to follow.

## Design

```
Chambers on Vercel ──HTTPS──▶ Tailscale Funnel ──▶ Pi: nusso_relay.py ──HTTPS──▶ nuevents.neu.edu
   (holds the EMS login,        (https://chambers-relay-N.<tailnet>.ts.net)     (campus network)
    cookies, secret)
```

## What the relay does and does not do

- Forwards only `/`, `/BrowseForSpace.aspx` and `/ServerApi.aspx/<Method>`, only
  to nuevents.neu.edu, and only with the `X-Relay-Secret` header.
- Passes EMS's response back unchanged (status, redirects, every cookie).
- Holds no EMS password or session; Chambers keeps those.
- Listens on 127.0.0.1 only. Funnel is the one way in, and no ports are opened
  on the office network.

## Failover and power cuts

Each Pi has its own URL. Chambers tries them in the order of
`NUSSO_RELAY_URLS` and sticks with the one that last worked. It moves to the
other Pi only when the request certainly never reached EMS, so a booking is
never sent twice. The relay service and Tailscale both start at boot, so a Pi
comes back on its own after an outage. If both are down, Chambers tells people
to book on nuevents.neu.edu from campus or the VPN.

Sudden power loss can corrupt a Pi's SD card over time. If outages are
frequent, a small UPS HAT or a power bank with pass-through charging is
cheap insurance.

## One-time setup (only with written ITS approval)

Tailscale admin, from any browser:

1. Create a Tailscale account owned by SGA (an operations address, not a
   personal one).
2. **DNS** page: enable MagicDNS and **HTTPS Certificates**.
3. **Access controls**: add the tag and allow Funnel for it:
   ```json
   "tagOwners": { "tag:nusso-relay": ["autogroup:admin"] },
   "nodeAttrs": [ { "target": ["tag:nusso-relay"], "attr": ["funnel"] } ]
   ```
   Tagged devices do not have key expiry, so the Pis will not drop off after
   180 days.
4. **Settings > Keys**: generate an auth key that is **Reusable** and tagged
   `tag:nusso-relay`.
5. Generate the shared secret on any computer: `openssl rand -hex 32`.

## Prepare the USB stick

Copy this `relay/` folder onto a USB stick. Copy `relay.env.example` to
`relay.env` on the stick and fill in `NUSSO_RELAY_SECRET` and `TS_AUTHKEY`.

## On each Pi (keyboard and screen)

1. Plug in the stick and open a terminal (Ctrl+Alt+T, or exit the kiosk browser
   with Alt+F4).
2. Run the installer. Use `1` on the first Pi and `2` on the second:
   ```
   sudo bash /media/$USER/*/relay/install.sh 1
   ```
3. Step 1 of the installer says whether the Pi can reach EMS. If it says
   **NO**, stop and tell the Chambers maintainers: the office network is
   blocked too.
4. Write down the URL it prints at the end, e.g.
   `https://chambers-relay-1.tail1234.ts.net`.
5. Reboot (`sudo reboot`) and check the kiosk display still comes up.

## Point Chambers at the relays (Vercel)

In the project's Environment Variables (Production):

```
NUSSO_RELAY_URLS=https://chambers-relay-1.tail1234.ts.net,https://chambers-relay-2.tail1234.ts.net
NUSSO_RELAY_SECRET=<the same secret as relay.env>
```

Redeploy. Leave both unset for local development on campus or the VPN; Chambers
then talks to EMS directly.

## Checking on it

- From anywhere: `curl -H 'X-Relay-Secret: <secret>' https://chambers-relay-1.<tailnet>.ts.net/__relay/health`
- On the Pi: `systemctl status nusso-relay`, `journalctl -u nusso-relay -f`, `tailscale funnel status`
- Rotating the secret: change it in `relay.env`, rerun the installer on both
  Pis, update Vercel, redeploy.
