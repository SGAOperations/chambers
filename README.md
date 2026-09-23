# Chambers

Chambers is a website built to replace the Internal Call for Programs and Event Bookings spreadsheets that the Operational Affairs division of the Northeastern University Student Government Association currently uses.

Bodies request rooms, tabling and SGA Spaces; Operational Affairs reviews those requests, runs the booking calendar, tracks the paperwork an event owes, and manages users, bodies and semesters.

## Stack

TypeScript throughout, on Next.js (App Router) with Tailwind CSS, deployed to Vercel — the Operational Affairs division standard.

- **Database:** Neon Postgres. Login and the live role checks hold a `pg` pool (`lib/db/pool.ts`); everything else queries the Neon Data API, which speaks PostgREST (`lib/db/data-api.ts`).
- **Login:** Better Auth (`lib/better-auth.ts`). A Chambers user and a login are one row in `public.users`. Nobody signs up through it — accounts come from Chambers' own invite and signup-code flows.
- **Email:** Resend (`lib/resend.ts`). Outside production every recipient is rewritten, so no preview or laptop can mail a real student.
- **Also:** Upstash Redis for rate limiting, Slack for committee meeting reminders, and a service worker (next-pwa) so the app opens offline.

Chambers ran on Supabase until September 2026; `db/neon/README.md` records that move, and `supabase/migrations/` is kept as history.

## Running it

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

`.env.example` explains what each variable is for. You need at minimum a database (`DATABASE_URL`), the Data API pair (`NEON_DATA_API_URL`, `DATA_API_PRIVATE_JWK`), `BETTER_AUTH_SECRET`, and the Upstash pair — without Upstash, every API route fails on its first rate-limit check.

```bash
npm run build   # production build, as CI runs it
npm run lint
```

## How it is put together

- `app/` — routes. `app/(dashboard)/` is the signed-in application, `app/api/` its endpoints, `app/display/` the kiosk pages outside rooms.
- `lib/` — everything that is not a route: the database clients, authorization, email, and the domain logic worth naming (`pending-actions.ts`, `weekly-occurrences.ts`, `event-forms.ts`).
- `db/neon/` — the schema, as numbered SQL files, plus the runbooks.
- `scripts/neon/` — applying schema, copying data, comparing row counts.

Two things to know before changing anything:

**Access is decided in application code, not by the database.** Row-level security is enabled on every table with no policy but the server's own, so it denies by default and grants nothing. Each API route checks the caller itself — and reads roles live from `users` via `getAuthedUserWithLiveRoles`, because a role stamped into a token an hour ago may since have been revoked.

**Dates are Boston days.** `booking_date`, `occurrence_date` and `session_date` are DATE columns meaning a calendar day where the rooms are, not on the server or in the viewer's timezone. `lib/app-zone.ts` is the one place that decides what "today" means.

## Changing the schema

Add a numbered file to `db/neon/`, apply it, then **refresh the Data API schema cache** in the Neon console — PostgREST does not see new tables or columns until you do, and requests touching them fail until then.

```bash
TARGET_DATABASE_URL="<unpooled connection string>" node scripts/neon/apply-file.mjs db/neon/000N_your_change.sql
```

PowerShell has no inline `VAR=value command` form, so set it first and quote the string singly, or its `&` is read as the call operator:

```powershell
$env:TARGET_DATABASE_URL = '<unpooled connection string>'
node scripts/neon/apply-file.mjs db/neon/000N_your_change.sql
```

Say in the file's header comment what it changes and how to undo it. Migrations ship with the code that needs them, so apply one before or with the deploy that depends on it.

## Environments

Production deploys from `main`. `db/neon/README.md` covers setting up previews, rehearsing a migration, and the Supabase cutover that got us here.

GitHub Actions runs the build on every pull request, and drives two schedules: keeping a warm function instance ready, and the Slack meeting reminders.

## Contributing

Branch from `dev` and open pull requests against `dev`. `main` only ever receives `dev`, as a release. Label a pull request by what it is — `bug`, `enhancement`, `documentation`; `gh label list` has the rest — and link the issue it closes in the body, so merging closes it.

Comments here explain *why*, not what. If a decision looks odd, the reason it was made is worth more to the next reader than a description of the code in front of them.

# Contributors

## Author
Eli Patania (VP of Operational Affairs '26-'27, Comptroller '26)

## Deployment Logistics & QA
Logan Ravinuthala (Digital Innovation Manager '26-'27, Digital Innovation Team Lead '25-'26)
