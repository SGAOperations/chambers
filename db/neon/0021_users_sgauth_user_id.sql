-- The SGAuth user each Chambers user is (issues #149, #150).
--
-- Chambers is moving its sign-in to SGAuth. A session from SGAuth names an
-- SGAuth user id, and every foreign key in Chambers names users.id. This column
-- joins the two, so nothing else has to move: users.id stays the key every
-- booking, membership and audit row points at.
--
-- Filled three ways:
--   * scripts/sgauth/link-users.mjs, from the id-map the SGAuth import wrote
--     (SGAOperations/auth#99) -- every user who existed at import time;
--   * on first SGAuth sign-in, by lower-cased email, for a row the map missed
--     and that is not linked yet (lib/sgauth.ts);
--   * on first SGAuth sign-in with no matching row, by creating one.
--
-- Nullable until every row is linked. This is the expand step: nothing reads it
-- unless SGAUTH_ENABLED is on, and Better Auth keeps working beside it.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** in the Neon console (db/neon/README.md).
--
-- To undo:
--   alter table public.users drop column if exists sgauth_user_id;

alter table public.users
  add column if not exists sgauth_user_id uuid;

alter table public.users
  drop constraint if exists users_sgauth_user_id_key;

alter table public.users
  add constraint users_sgauth_user_id_key unique (sgauth_user_id);

comment on column public.users.sgauth_user_id is
  'The SGAuth user this Chambers user is, or null until linked. users.id stays the key everything else references (issue #150).';
