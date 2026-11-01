# Verifying what reaches Chambers without a person

Issue #155 (CHAMBERS-C08). Under `SGAUTH_ENABLED`, `proxy.ts` sends anyone without an SGAuth cookie to sign in. Some callers never have one: the kiosk screens, Slack, GitHub Actions, mail clients, and Neon. Each of these has to stay on the proxy's public path list and authenticate in its own way.

## Automated

`tests/proxy.test.ts` runs in CI (`npm test`). With the flag on and no cookie, it checks:

- These paths pass straight through: `/display/*`, `/api/display/*`, `/api/cron/*`, `/api/slack/command`, `/api/slack/interaction` (including a POST), `/opsemaillogo.png`, both `data-api-jwks*.json`, `/sw.js`, `workbox-*.js`, `/manifest.json`, `/icons/*`, `/`, `/faq` and `/legal`.
- Every other `/api` route passes through and answers 401 JSON itself.
- People opening `/my-rooms`, `/bookings`, `/management`, `/request` or `/slack/connect` get a 307 to SGAuth sign-in, which brings them back to that URL.

The test covers the proxy. The checks below cover each caller end to end, which a unit test cannot.

## Manual: on dev, then on production

Run on `chambers-dev.northeasternsga.com` with the flag on before cutover, and again on production in the cutover window ([cutover.md](cutover.md)). Use a private window, or one with no SGAuth cookie, wherever the step says "signed out".

| # | What | How | Expected | Dev | Prod |
|---|---|---|---|---|---|
| 1 | Kiosk screen | Signed out, open `/display/<DISPLAY_KEY>` for a room | The schedule renders and refreshes. No redirect to sign-in | ☐ | ☐ |
| 2 | Kiosk data | Signed out, the screen's network calls to `/api/display/<space>` | 200 JSON | ☐ | ☐ |
| 3 | Warm cron | GitHub → Actions → **keep-warm** → Run workflow | Green; route answers 200 | ☐ | ☐ |
| 4 | Slack reminders cron | Actions → **slack-reminders** → Run workflow | Green; reminders post to linked channels (prod) or are withheld and logged (dev) | ☐ | ☐ |
| 5 | Weekly cancel reminder | Actions → **weekly-cancel-reminder** → Run workflow | Green | ☐ | ☐ |
| 6 | Slash command | In Slack, `/chambers-room` as someone who linked Slack in their SGA account | The room modal opens. A person with no link is sent a link instead | ☐ | ☐ |
| 7 | Slack interaction | Submit that modal | The request is created and confirmed in Slack | ☐ | ☐ |
| 8 | Request alert | Submit any room request | The VP of Operational Affairs and the Comptroller get a Slack DM. They are found **by position** now (`lib/office-holders.ts`), so each must have signed in to Chambers once under SGAuth | ☐ | ☐ |
| 9 | Event channel | Mark a booking as an event | A private channel is created with VPOA, Comptroller and VP of External Affairs (by position) and the body's Leadership | ☐ | ☐ |
| 10 | Resend email | Trigger a booking email | It arrives; the logo loads; its links open sign-in when signed out and land on the right page afterwards | ☐ | ☐ |
| 11 | Data API | Any signed-in page that lists bookings | Loads. A JWKS behind the proxy would fail every query | ☐ | ☐ |
| 12 | Landing page | Signed out, `/` | Shows the SGA sign-in card and the Comptroller's name (by position) | ☐ | ☐ |

On dev, Slack and email go to `PREVIEW_SLACK_RECIPIENT` and `PREVIEW_EMAIL_RECIPIENT`, or are withheld and logged. That is still a pass: check the log line names the right recipients.

**Production needs `SGAUTH_PRODUCT_API_KEY` for rows 6–9.** Slack identities come from SGAuth's product API under the flag (`lib/slack-identity.ts`). As of 2026-11-01 that key is set only for Preview on the `dev` branch.
