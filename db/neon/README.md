# Chambers on Neon

Issue #136. The schema, copy script and runbook for moving Chambers' database and login from Supabase to Neon.

| File | What it is |
|---|---|
| `0001_baseline.sql` | Production `public` schema, generated from the live Supabase catalog on 2026-09-17. Foreign keys to `auth.users` are repointed at `public.users`. It has no row-level security policies or Supabase helper functions; RLS is enabled with no policies, so it defaults to deny. |
| `0002_better_auth.sql` | Better Auth on top: three columns on `users`, plus `auth_sessions`, `auth_accounts` and `auth_verifications`. |
| `0003_data_api_server_role.sql` | The `chambers_server` role the server's Data API tokens use: full access to app tables, none to `auth_*`. |
| `after-data-api.sql` | Run on each branch once its Data API is enabled. |
| `../../scripts/neon/copy-data.mjs` | Copies every table in one transaction, imports logins with their bcrypt hashes, and checks row counts. Has a `--dry-run` flag. |

## Rehearsal (on a Neon branch, any time)

1. In Neon, create a branch named `rehearsal` from an empty `main`.
2. Apply the schema, using the **unpooled** connection string:
   ```bash
   psql "$NEON_UNPOOLED_URL" -f db/neon/0001_baseline.sql
   psql "$NEON_UNPOOLED_URL" -f db/neon/0002_better_auth.sql
   ```
3. Copy the data. For the source, use Supabase's direct or session-pooler string, not the transaction pooler:
   ```bash
   SOURCE_DATABASE_URL="$SUPABASE_DIRECT_URL" TARGET_DATABASE_URL="$NEON_UNPOOLED_URL" node scripts/neon/copy-data.mjs --dry-run
   SOURCE_DATABASE_URL="$SUPABASE_DIRECT_URL" TARGET_DATABASE_URL="$NEON_UNPOOLED_URL" node scripts/neon/copy-data.mjs
   ```
4. Set up the Data API on the branch:
   - In the Neon console, go to **Postgres database → Data API** and click enable. Leave **Use Managed Better Auth** and **Grant public schema access** unchecked.
   - Under the Data API **Settings**, choose **Other Provider** and set the JWKS URL to the app's `/data-api-jwks.json`.
   - Run `db/neon/after-data-api.sql`, which lets the Data API switch into `chambers_server`.
   - **Refresh schema cache.** Neon's Data API ignores PostgREST's `notify pgrst`, so this has to be done after **every** schema change, on every branch.
   - Verify with `node scripts/neon/test-data-api.mjs`, with `NEON_DATA_API_URL` and `DATA_API_PRIVATE_JWK` set.
5. Point a Vercel preview at the branch: set `DATABASE_URL` (pooled), `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` (the preview's origin).
6. Check that an existing account signs in with its **current** password. That proves the bcrypt import worked. Also check a password reset, an invite, and deactivating a user.

To start over, delete the branch and repeat. The copy script refuses to write into tables that already have rows.

## Cutover

1. Announce a short window. Stop writes by putting the site in maintenance or pausing traffic in Vercel.
2. Create a fresh `main` state on Neon, then run steps 2–3 above against it.
3. Set production `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` in Vercel, then deploy.
4. Everyone signs in again, since sessions aren't copied. Passwords are unchanged.
5. Leave Supabase untouched. To roll back, restore the old environment variables and redeploy the last Supabase build. Anything written to Neon in between would need copying back by hand.

## Not done yet

The login lives in Neon, but most server routes still query through the Supabase client (`lib/supabase/server.ts` and the service-role clients). Before cutover, that query layer has to move to Neon as well. See the #136 plan.
