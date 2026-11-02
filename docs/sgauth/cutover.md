# Chambers cutover to SGAuth

Issue #154 (CHAMBERS-C07). This moves Chambers' sign-in, user management and body memberships to SGAuth. `SGAUTH_ENABLED` is the switch and the rollback: with it off, Better Auth, the Users tab and `users.admin_role` / `iems_role` / `is_active` work exactly as before. Nothing below deletes legacy data. That waits for #250, after the retention window.

## What changes for people

- Everyone signs in on the SGA sign-in page. **Passwords carry over**: the SGAuth import brought each Chambers password across as its bcrypt hash (SGAOperations/auth#99).
- Admin access, IEMS access and body memberships come from the person's **SGA positions**. Management maps positions to bodies on the **Bodies** tab. There is no Users tab, and nobody joins or leaves a body by hand.
- Deactivating someone in SGAuth signs them out of Chambers and every other SGA tool within about a minute. Chambers has no deactivation of its own.

## Before the window

Run through the whole list on **dev** first (`chambers-dev.northeasternsga.com`, SGAuth dev), including the rollback rehearsal, then on production.

**SGAuth**
- [ ] Chambers is in the SGAuth production registry for `chambers.northeasternsga.com` (SGAOperations/auth#103). There was no entry as of 2026-10-31.
- [ ] Positions are correct for the people who book: every body's Leaders (see "Check the map" below).

**Database** (production branch, unpooled string; PowerShell users see `db/neon/README.md`)
- [ ] `0021_users_sgauth_user_id.sql` is applied.
- [ ] `0022_sgauth_positions.sql` is applied: `node scripts/neon/apply-file.mjs db/neon/0022_sgauth_positions.sql`. Its notice should report seats across 31 bodies.
- [ ] **Refresh the Data API schema cache** in the Neon console.
- [ ] Users are linked with the **production** id-map: `node scripts/sgauth/link-users.mjs <prod id-map>` (dry run), then with `--apply`.
- [ ] `node scripts/sgauth/verify-links.mjs` (with `SGAUTH_DATABASE_URL` set to SGAuth production) shows **0 dangling**. Anyone listed as **no account** cannot sign in until SGAuth gives them one. Those are the expected stragglers.

**Check the map**
- [ ] On the Bodies tab (Management; works with the flag still off), each body lists the positions you expect.
- [ ] `node scripts/sgauth/compare-memberships.mjs` shows every Leadership seat that would be lost. For each one, either give that person the matching position in SGAuth or change the map, until the list is only what you intend. Transitional seats (position-mapping.md, Q8) are expected to go.

**Vercel, Production environment**
- [ ] `SGAUTH_URL` = `https://auth.northeasternsga.com`
- [ ] `SGAUTH_COOKIE_NAME` unset (production uses SGAuth's default cookie)
- [ ] `SGAUTH_PRODUCT_API_KEY` set. As of 2026-11-01 it exists only for Preview on `dev`, and Slack identities need it.
- [ ] `SLACK_TEAM_ID` set (it is)
- [ ] `SGAUTH_ENABLED` **not yet** `true`. Note: the variable already exists in Production, but the live site still served Better Auth on 2026-10-31 with a deployment built after it was added, so its value is not exactly `true`. Re-enter it as exactly `true`, with no quotes or spaces, in the window.
- [ ] The SDK is pinned: `@nusgaops/sgauth` is `0.2.0` exactly in `package.json`.

**Comms**
- [ ] The announcement below is ready to send.

## In the window

1. Snapshot memberships, so the rollback can restore them. The sync rewrites `board_memberships` as each person signs in:
   ```sql
   create table public.board_memberships_pre_sgauth as table public.board_memberships;
   ```
2. In Vercel Production, set `SGAUTH_ENABLED` to `true`, then **Redeploy** the current production deployment. Environment changes reach only new deployments.
3. Check:
   - Signed out, `/` shows the SGA sign-in card, and `/my-rooms` redirects to `auth.northeasternsga.com`.
   - Sign in as a Management office, the Comptroller, a body Leader and a plain member. Each sees the right tabs. Management has no Users tab. The Leader can book for their body.
   - Run the production column of [verification-checklist.md](verification-checklist.md).
4. Send the announcement.

## Rollback

Rehearse this on dev before production (the acceptance criterion for #154).

1. In Vercel Production, set `SGAUTH_ENABLED` to `false` (or delete it) and **Redeploy**. Better Auth's login, the Users tab and the legacy role columns are live again, untouched.
2. Put memberships back as they were at the snapshot:
   ```sql
   begin;
   delete from public.board_memberships;
   insert into public.board_memberships select * from public.board_memberships_pre_sgauth;
   commit;
   ```
3. Tell people to sign in with their Chambers password as before. A password changed in SGAuth during the window does not carry back.

Keep Better Auth's tables, its variables and the snapshot until the retention window in SGAOperations/auth `docs/ROLLOUT.md` §4 ends; removing them is #250.

## Support window: three days

Watch Vercel runtime logs for:

- `sgauth upstream failure`: SGAuth unreachable. The SDK serves cached sessions for up to about 6 minutes.
- `position-sync: could not sync a user`: someone's memberships did not update. Their old ones stay until the next try.
- `sgauth: email already linked to another SGAuth account`: one Chambers row, two SGAuth accounts. Needs a person.
- `slack-identity:` errors, usually a missing `SGAUTH_PRODUCT_API_KEY`.

People who cannot sign in are almost always the **no account** rows from `verify-links.mjs`. An SGAuth admin creates or invites their account. Anyone missing a body needs the position in SGAuth, or a change to the map on the Bodies tab.

## Announcement (draft)

> **Chambers now uses your SGA account**
>
> Starting today, you sign in to Chambers with your SGA account, the same one used across SGA tools. Your password has not changed: use the one you already had for Chambers.
>
> Your bodies and access in Chambers now come from your SGA position. If a body is missing or your access looks wrong, reply here and we will fix your position. You no longer join bodies from Settings.
>
> If you cannot sign in, reply here and we will sort it out.
