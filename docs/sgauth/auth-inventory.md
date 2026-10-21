# Chambers auth and authorization inventory

Issue #148 (CHAMBERS-C01), for the SGAuth integration epic (v3.0.0). Taken from `dev` at v2.3.0 (`c18016f`).

Every place Chambers decides who someone is, or what they may do, and what replaces it once Chambers signs in through SGAuth. The later tickets work from this list:

| Ticket | What it does with this list |
|---|---|
| #149 CHAMBERS-C02 | §1, §2, §3: swap the session source, add the proxy, delete the login UI |
| #150 CHAMBERS-C03 | §6: re-key `users` and drop the auth-only columns |
| #151 CHAMBERS-C04 | §4, §5: role and membership checks become position checks |
| #152 CHAMBERS-C05 | §7: delete the live-role and revocation machinery |
| #155 CHAMBERS-C08 | §8: what has to stay reachable without a user session |

## 0. Where things stand

The ticket was written against a Supabase-Auth Chambers. Since then, #136 moved Chambers to Neon and to its own **Better Auth** login. That has already changed a few of the ticket's starting assumptions:

- **No Supabase Auth calls remain.** No `supabase.auth.*` calls and no `@supabase/*` auth packages are left. `@supabase/postgrest-js` is still installed, but it is only the Data API client (`lib/db/data-api.ts`), which signs its own server tokens. It is not a login. Many routes still name their client `supabase`; that is just a variable name.
- **The SQL helpers are gone.** `is_admin()`, `is_iems()`, `my_body_ids()` and `revoke_user_sessions()` do not exist on Neon (`db/neon/0001_baseline.sql`, header). RLS is enabled but default-deny, and the only role it serves is `chambers_server`, which has full access (`0003`). Every authorization decision is already made in app code, so #151 has no RLS to replace. They still appear in `supabase/migrations/*`, but nothing applies those files any more.
- **`app_metadata` is a leftover name.** `AuthedUser.app_metadata` is filled only by `getAuthedUserWithLiveRoles()`, from the `users` row. It is not a token claim. About 30 routes read `user.app_metadata?.is_admin` / `admin_role` / `iems_role`.
- **The login is Chambers' own.** Better Auth in `lib/better-auth.ts` uses `public.users` as its user table, plus `auth_sessions`, `auth_accounts` and `auth_verifications` (`0002`). For SGAuth this means it is the *Better Auth* layer that gets removed, not Supabase.
- **The admin tiers have changed since #151 was written.** `Digital Innovation Project Member` is no longer an admin role (`0015`). `Student Body President` is now one, in a third, **view-only** tier (`VIEW_ONLY_ROLES`, issue #217). So there are three admin tiers, not two. See `docs/sgauth/position-mapping.md`.

Replacement column key:

- **Session**: `getSession()` / `requireSession()` from the SGAuth SDK (SGAOperations/auth#71).
- **Position**: a check against the session's SGAuth position keys, through the not-yet-written `lib/permissions.ts` (#151).
- **Membership**: Chambers' own `board_memberships` table, but filled from positions (#151), not from the admin UI.
- **Delete**: SGAuth owns this now; Chambers removes it.
- **Keep**: not user auth. It stays as it is and goes on the proxy's public list.

## 1. Session core (`lib/`)

| Location | What it does today | Replacement |
|---|---|---|
| `lib/better-auth.ts` | Better Auth server: bcrypt passwords, 2-day sliding sessions in `auth_sessions`, password-reset email, a session-create hook that refuses deactivated users | **Delete**. Passwords, sessions, resets and deactivation all move to SGAuth. bcrypt hashes carry over through AUTH-T87's import. |
| `app/api/auth/[...all]/route.ts` | Better Auth's HTTP handler | **Delete**. |
| `lib/auth-client.ts` | Browser Better Auth client (`signIn`, `signOut`, `requestPasswordReset`, `resetPassword`) | **Delete**. Sign-out becomes a redirect to SGAuth's sign-out URL (SDK URL helpers). |
| `lib/auth.ts` `getAuthedUser()` | Reads the Better Auth session and returns `{ id, email, issuedAt, app_metadata: {} }`. Takes an ignored `_legacyClient` argument. | **Session**: a thin wrapper over `getSession()`. Drop `issuedAt` and the legacy argument. The id is now the SGAuth user id (#150). |
| `lib/authorization.ts` `getAuthedUserWithLiveRoles()` | `getAuthedUser()` plus a `users` read: `admin_role`, `iems_role`, `is_active`, `sessions_revoked_at`. Sets `rolesVerifiedLive`. | **Position**. Roles come from the SDK session's positions, within its 60-second cache. `is_active` → SGAuth deactivation (the SDK returns 401). `sessions_revoked_at` → **Delete** (#152). |
| `lib/auth-types.ts` `AuthedUser`, `hasLiveAdmin()` | The user shape; a fail-closed admin check that requires `rolesVerifiedLive` | **Position**. Replace with typed capabilities from `lib/permissions.ts`, e.g. `can(user, 'bookings.write')`. Keep the fail-closed rule: capabilities exist only on a user built from an SDK session. |
| `lib/auth-admin.ts` `createPasswordUser`, `setUserPassword`, `revokeUserSessions` | Invite and signup-code account creation, one-time password, ending sessions | **Delete**. Accounts are created in SGAuth (self-sign-up for `northeastern.edu`, or an admin invite there). Revocation is SGAuth admin revoke. |
| `lib/sign-out.ts` | Sign-out that works offline: remembers a pending sign-out in `localStorage` and finishes it on the next online load | **Session**. Point it at SGAuth's sign-out. Keep the pending-sign-out logic: the httpOnly-cookie problem it solves is the same with SGAuth's cookie. |
| `lib/shell-identity.ts` `resolveShellIdentity()` | Server-side identity for the dashboard shell: `is_active`, `has_completed_onboarding`, `admin_role`, `iems_role`, Leadership flag | **Session + Position + Membership**. `isAdmin` / `adminRole` / `isIEMS` come from positions, `isLeadership` from the synced `board_memberships`. `deactivated` → SDK 401. `onboarding` stays Chambers' own (see §3). |
| `lib/admin-roles.ts` | `ADMIN_ROLES`, `MANAGEMENT_ROLES`, `VIEW_ONLY_ROLES`, `REQUEST_ALERT_ROLES`; `isManagementRole`, `isViewOnlyRole`, `canWriteAdmin` | **Position**. The three tiers are kept, but resolved from position keys (`docs/sgauth/position-mapping.md`). `REQUEST_ALERT_ROLES` becomes a list of position keys (§5). |

## 2. Pages and client gates

| Location | What it does today | Replacement |
|---|---|---|
| `app/page.tsx` + `app/_components/LoginCard.tsx` | Email/password form, forgot-password, OTP-invite detection, forwards a signed-in user to `/my-rooms` or `/onboarding` | **Delete** `LoginCard`. `/` sends an unauthenticated visitor to SGAuth's sign-in with `returnTo`. Keep the network-retry and offline message for the session-fetch failure case (#149). |
| `app/reset-password/page.tsx` | Better Auth password reset | **Delete** (SGAuth handles resets). Redirect old links to SGAuth. |
| `app/signup/page.tsx`, `app/api/signup/request`, `app/api/signup/verify` | Signup-code flow: emails an OTP, creates the account (`createPasswordUser`), signs in | **Delete**. SGAuth self-sign-up replaces it. A first sign-in creates the Chambers row with no memberships (#150). |
| `app/onboarding/page.tsx` | Profile, body selection (membership requests) and a password step. Signs out deactivated users. | **Membership**. The **password step goes** (`/api/onboarding/password`, `/api/onboarding/invalidate-otp`). The profile step stays. The body-selection step should be removed or turned informational: memberships now come from positions, so a self-selected body would be overwritten on the next sync (#151). |
| `app/(dashboard)/layout.tsx` | Calls `resolveShellIdentity()` and redirects to `/` or `/onboarding`, or renders `ForceSignOut` | **Session**. The proxy redirects unauthenticated requests first, so this layout only sees signed-in users. Keep the onboarding redirect. |
| `app/(dashboard)/force-sign-out.tsx` | `authClient.signOut()` for deactivated users | **Delete**. A deactivated user gets 401 from the SDK and is sent to SGAuth, which explains the deactivation. |
| `app/(dashboard)/dashboard-shell.tsx` | 48 h idle sign-out (`IDLE_MS`), `signOutThisDevice()`, nav gated on `isManagementRole` / `canWriteAdmin` | **Session + Position**. Drop the idle timer or align it with SGAuth's 30-day sliding session (a product decision; the server no longer enforces 2 days). Nav gating uses capabilities from the identity. |
| `app/(dashboard)/adminguard.tsx`, `managementguard.tsx`, `eventsguard.tsx` | Client gates from identity (`isAdmin`, `isManagementRole`, `canWriteAdmin`, `isIEMS`) | **Position**, through the shell identity. They only hide UI; the server-side checks in §4 are what enforce access. |
| `app/(dashboard)/identity-context.tsx`, `my-rooms/page.tsx` | `getAuthedUser()` for the caller's id | **Session**. |
| `app/(dashboard)/bookings/*`, `nusso/page.tsx`, `request/page.tsx`, `sga-spaces/page.tsx` | UI tier checks (`isViewOnlyRole`, `canWriteAdmin`) | **Position** (identity). |
| `app/(dashboard)/management/users-tab.tsx` | Invite, admin_role / iems_role selects, Leadership/Member toggles, deactivate | **Delete** the role and deactivate controls. Link to the SGAuth user page instead (#152). Body memberships become read-only views of the synced positions (#151). |
| `app/(dashboard)/settings-modal.tsx` | Email-preference eligibility from `admin_role` / `iems_role`; shows memberships | **Position**. `getPrefsForRole()` takes capabilities (§5). |
| `app/slack/connect/page.tsx` | Sends an unauthenticated user to `/?redirectTo=/slack/connect?token=…` | **Session**. Send them to SGAuth's sign-in with `returnTo` set to the same URL. |
| `app/faq/page.tsx` | Release-notes copy about live roles and password sign-in | Update the copy in #149 / #152. |

## 3. API routes that only need "signed in"

All of these call `getAuthedUser()` and check only `!user`. **Replacement: Session** (`requireSession()`, or `getSession()` → 401). No role logic.

`api/alerts`, `api/me/login-state`, `api/me/memberships`, `api/me/requests`, `api/me/settings`, `api/my-rooms`, `api/nusso/settings`, `api/onboarding/{bodies,complete,memberships,profile,state}`, `api/slack/connect`, `api/spaces`, `api/spaces/remaining-hours`, `api/users/by-ids`, `api/users/search`.

Notes:

- `api/me/login-state` exists only for `LoginCard`. **Delete** it with `LoginCard`.
- `api/onboarding/password` and `api/onboarding/invalidate-otp` handle the invite OTP. **Delete** both.
- `api/onboarding/state` returns 403 for a deactivated user. With SGAuth that is the SDK's 401, so drop the branch.
- `api/me/memberships` (POST/DELETE) lets a user request or leave a body. #151 has to decide what this means when memberships are derived from positions. The recommendation is to remove self-service join and leave.

## 4. API routes with role checks

Today's pattern is `getAuthedUserWithLiveRoles()` → `!user.app_metadata?.is_admin` → 401, then a tier check → 403. Under SGAuth, the 401 means "no session" and the 403 means "lacks the capability". **Replacement: Position** for all of them. Tier names follow `docs/sgauth/position-mapping.md`.

| Route (methods) | Check today | Capability needed |
|---|---|---|
| `administrator/archive` (GET) | admin + `isManagementRole` | management |
| `administrator/audit-logs` (GET) | admin + `isManagementRole` | management |
| `administrator/bodies` (GET) | any admin | any admin tier (includes view-only) |
| `administrator/bodies` (POST, PATCH) | admin + `isManagementRole` | management |
| `administrator/bookings` (GET) | any admin | any admin tier |
| `administrator/bookings` (PATCH) | admin + `canWriteAdmin` | booking write (management or booking) |
| `administrator/bookings/{one-time,tabling,weekly}` (POST, PATCH) | admin + `canWriteAdmin`, then `loadScopeContext` | booking write |
| `administrator/bookings/cancel` (POST) | admin + `canWriteAdmin` | booking write |
| `administrator/call-for-programs` (GET, POST, PATCH) | admin + `isManagementRole` | management |
| `administrator/cancellations`, `…/auto-cancel` (GET, POST, PATCH) | admin + `canWriteAdmin` | booking write |
| `administrator/counts` (GET) | admin + `canWriteAdmin` | booking write |
| `administrator/membership-requests`, `…/[id]` (GET, PATCH) | admin + `isManagementRole` | management. **Retired by #151** (no more join requests). |
| `administrator/requests`, `…/bookings`, `…/auto-request` (GET, POST, PATCH) | admin + `canWriteAdmin` | booking write |
| `administrator/revisions` (GET, PATCH) | admin + `canWriteAdmin` | booking write |
| `administrator/semesters` (GET) | any admin | any admin tier |
| `administrator/semesters` (POST, PATCH, DELETE) | admin + `canWriteAdmin` (DELETE has a further 403) | booking write |
| `administrator/settings` (GET, PATCH) | admin + `isManagementRole` | management |
| `administrator/users` (GET, POST, PATCH) | admin + `isManagementRole`. Creates accounts, sets roles, deactivates, revokes sessions. | **Mostly deleted** (#152). GET stays as a read-only list (management). POST (invite) and the role and `is_active` fields of PATCH move to SGAuth. |
| `administrator/users/memberships` (POST, DELETE, PATCH) | admin + `isManagementRole` | **Retired by #151** for body assignment (positions drive it). |
| `administrator/users/resend-invite` (POST) | admin + `isManagementRole`, `setUserPassword` | **Delete**. |
| `dashboard` (GET) | signed in, plus `is_admin && canWriteAdmin` for the admin counts | Session + booking write |
| `events`, `events/forms`, `events/checklist` | booking-write admin **or** any `iems_role` | booking write **or** iems |
| `events/form-templates` | read: booking-write admin or iems; write: `isManagementRole` | read: booking write or iems; write: management |
| `request` (GET, POST) | signed in, then `loadScopeContext` (Leadership scope, or admin `canWriteAdmin`) | Session + Membership (Leadership) + booking write |
| `call-for-programs` (GET, POST) | signed in; POST requires Leadership of the chosen body | Session + Membership |
| `cancellation-requests` (POST), `revision-requests` (GET, POST) | signed in, then `requireBookingManager` (Leadership of the booking's body, or `hasLiveAdmin`) | Session + Membership, or any admin tier¹ |
| `nusso/*` (`availability`, `book`, `bookings`, `cancel`, `rooms`, `search`) | `getNussoCaller()` (`lib/nusso/authorize.ts`): live roles + Leadership. `book` and `cancel` require Leadership or admin. | Session + Membership + booking write |
| `spaces/bookings` (GET, POST), `spaces/bookings/[id]` (PATCH, DELETE) | signed in; writing for others needs `is_admin && canWriteAdmin`; creating needs Leadership or admin | Session + Membership + booking write |
| `spaces/series` (POST), `spaces/series/[id]` (GET, PATCH, DELETE) | signed in; `canBookSpaces` (Leadership or `hasLiveAdmin`); manage = creator or `hasLiveAdmin` | Session + Membership, or any admin tier¹ |
| `spaces/blackouts`, `…/[id]` | `resolveBlackoutAccess`: booking-write admin, or iems (own blackouts) | booking write, or iems |
| `spaces/limit-overrides`, `…/[id]` | admin + `canWriteAdmin` | booking write |

¹ `hasLiveAdmin()` is true for **every** admin tier, including view-only Student Body President. `requireBookingManager`, `loadScopeContext`, `canBookSpaces` and the series `mayManage` all use it, so the SBP passes them today. That looks unintended given #217 (view-only means "writes nothing"). #151 should decide whether these become booking write, and the decision belongs in its PR, not in a silent behavior change.

## 5. Shared authorization helpers (`lib/`)

| Location | Use | Replacement |
|---|---|---|
| `lib/booking-scope.ts` `loadScopeContext()` | Admin flag via `hasLiveAdmin`, plus the caller's `board_memberships` and their Leadership bodies | **Position** for the admin flag, **Membership** for bodies. Body-scoped rules stay unchanged (#151 acceptance criteria). |
| `lib/booking-scope.ts` `requireBookingManager()` | Leadership of the booking's body, or `hasLiveAdmin` | Same, with a capability check (see ¹ above). |
| `lib/booking-scope.ts` `resolveBookingRecipients()` | Emails Leadership and Members of a body, skipping `users.is_active = false` | **Membership**. `is_active` becomes a local mirror of SGAuth status, or is dropped once deactivated users lose their positions (and so their memberships). #150 decides which. |
| `lib/blackout-access.ts` | Booking-write admin or iems | **Position**. |
| `lib/space-series-data.ts` `canBookSpaces()` | Leadership, or `hasLiveAdmin` | Position + Membership. |
| `lib/nusso/authorize.ts` `getNussoCaller()` | Live roles + `isLeadership` | Position + Membership. |
| `lib/slack-cancel.ts` `slackUser()` | Builds an `AuthedUser` from a Slack link with **no** roles, so Slack cancellations are Leadership-only | **Keep** the design: there is no SGAuth session in a Slack request. It becomes a `{ id }`-only principal that grants no capabilities. |
| `lib/pending-actions.ts` | `isManagementRole(adminRole)` decides which pending actions an admin sees | **Position**. |
| `lib/email-preferences.ts` `getPrefsForRole()`, `userWantsEmail()` | Eligibility by `admin_role` (`EMAIL_PREF_ADMIN_ROLES`) or `iems_role` | **Position**. Note that `EMAIL_PREF_ADMIN_ROLES` is not `MANAGEMENT_ROLES`: it includes Comptroller and leaves out Digital Innovation Manager. Map it explicitly; do not derive it from a tier. |
| `lib/admin-slack-alerts.ts` | DMs users whose `admin_role` is in `REQUEST_ALERT_ROLES`, found by `users.admin_role` | **Position**. This runs outside any request, so it cannot read a session. It needs either a synced local copy of each user's positions or an SGAuth "users holding position X" API. Raise this with SGAuth (it may need its own ticket). |
| `lib/audit.ts` | Stamps the acting admin's `admin_role` onto audit entries | **Position**. Stamp the tier or the position key that granted the action. Existing rows keep their text value. |
| `lib/spaces-email.ts`, `lib/booking-scope.ts`, `api/request`, `api/slack/command`, `api/spaces/bookings` | `board_memberships … role = 'Leadership'` lookups | **Membership** (unchanged queries; the table is now filled from positions). |
| `lib/active-semester.ts` and the bodies and semesters admin | `is_active` on `semesters` and `bodies` | **Keep**: not user auth. Listed only because a search for `is_active` finds them. |

## 6. Database (`public.users` and auth tables)

| Object | Today | Replacement (#150 / #152) |
|---|---|---|
| `users.id` | Better Auth user id (uuid, the old Supabase id). Many FKs point at it. | Re-key to the SGAuth id, or add `sgauth_user_id` and repoint, using AUTH-T87's id-mapping file. Bookings history must stay attached. |
| `users.admin_role`, `users.iems_role` (+ check constraints) | Role source of truth | **Delete** after #151 reads positions. Keep them through cutover for rollback. |
| `users.is_active` | Deactivation (session hook, recipients, live roles) | SGAuth status. Either drop the column or keep it as a mirror updated at sign-in (#150). |
| `users.sessions_revoked_at` | Second revocation lock | **Delete** (#152). |
| `users.email_verified`, `users.image`, `users.updated_at` (`0002`) | Better Auth fields | **Delete** `email_verified` and `image` with Better Auth (#150). `updated_at` is worth keeping. |
| `users.has_completed_onboarding`, `users.otp_hash`, `users.otp_expires_at` | Onboarding and invite flow | Keep `has_completed_onboarding`. Delete `otp_hash` and `otp_expires_at` with the invite flow. |
| `auth_sessions`, `auth_accounts`, `auth_verifications` | Better Auth tables | **Delete** after the 7-day rollback window (#154). |
| `board_memberships` | Admin-assigned Leadership/Member per body | **Keep the table**, filled from positions on sign-in or SDK refresh (#151). |
| `membership_requests` | Self-requested body joins, approved by management | **Retire** with #151. |
| `slack_connect_tokens`, `slack_connections` (`chambers_user_id`) | Links a Slack user to a Chambers user | **Keep**. Repoint to the new user key in #150. |
| `supabase/migrations/*` | Historical Supabase RLS: `is_admin()`, `my_body_ids()`, `revoke_user_sessions`, live-role triggers | Not applied anywhere. Delete the folder in #152 so it stops showing up in searches. |

## 7. Live-role and revocation machinery (#152)

All of this exists because a role change had to take effect before a token expired. SGAuth's SDK cache (60 s) and admin revoke (401) replace it:

- `getAuthedUserWithLiveRoles()`, `rolesVerifiedLive`, `hasLiveAdmin()`, `AuthedUser.issuedAt`
- `revokeUserSessions()` and its call in `PATCH /api/administrator/users` on any role or `is_active` change
- `users.sessions_revoked_at`
- the `session.create` deactivation hook in `lib/better-auth.ts`
- `ForceSignOut` and the `deactivated` branch of `resolveShellIdentity()`

## 8. Not user auth: must stay reachable without a session

These go on the proxy's public path list (#149) and get verified in #155.

| Path | Gate | Notes |
|---|---|---|
| `/display/[spaceId]`, `/display/committees` (pages) | none on the page; the data comes from the APIs below | kiosk screens |
| `/api/display/[spaceId]`, `/api/display/all-spaces`, `/api/display/committees` | `?key=` = `DISPLAY_KEY` | `app/display/committees/spaces-card.tsx` passes the key through |
| `/api/cron/warm`, `/api/cron/slack-reminders`, `/api/cron/weekly-cancel-reminder` | `Authorization: Bearer $CRON_SECRET` | GitHub Actions / Vercel cron |
| `/api/slack/command`, `/api/slack/interaction` | Slack signing secret (`lib/slack-verify.ts`) | Slack calls these with no cookies |
| `/slack/connect` | redirects to sign-in when there is no session | public entry point, then a session |
| `/sw.js`, `/workbox-*.js`, `/manifest.json`, `/icons/*`, `/opsemaillogo.png` | none | PWA assets (`next-pwa`, `dest: 'public'`). The logo is loaded by email clients. |
| `/data-api-jwks.json`, `/data-api-jwks-production.json` | none | **Fetched by Neon's Data API** to verify Chambers' server tokens. If the proxy redirects these, every query fails. |
| `/faq`, `/legal` | none | public pages |
| `/api/auth/*` | Better Auth | Remove it with Better Auth. Do not proxy-protect it during the transition. |

Resend sends from the server and needs no inbound route. Its email links point at Chambers pages, which simply need a session.

## 9. Gaps and questions for later tickets

1. **SBP and the "any admin" helpers** (¹ in §4). Should view-only pass `requireBookingManager`, `canBookSpaces` and series management? Decide in #151.
2. **Self-service memberships.** With positions driving `board_memberships`, remove onboarding body selection, `me/memberships` and membership requests in #151, or keep a Chambers-only "guest" membership that a sync never overwrites. The recommendation is to remove them.
3. **Background jobs that need positions** (`admin-slack-alerts`, cron reminders, `resolveBookingRecipients`) cannot read a request session. Either keep a local mirror of positions, synced at sign-in (stale for anyone who has not signed in), or get an SGAuth directory API. This needs a decision with SGAuth before #151.
4. **Idle sign-out.** The client enforces 48 h today and the server 2 days. SGAuth uses a 30-day sliding session. Decide whether Chambers keeps a shorter client idle timer.
5. **There is no test suite.** Chambers has no test runner (`package.json` has no `test` script). #156's "replace Supabase JWT tests" has nothing to replace; it starts from scratch.
