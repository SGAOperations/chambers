-- Digital Innovation Manager is no longer an admin role.
--
-- The holder keeps everything else they have in Chambers -- their body
-- memberships, and any Leadership that comes with them -- but loses the
-- admin side: Bookings, Requests, SGA Spaces admin and the Management page.
-- That leaves three Management roles (EVP, VP of Operational Affairs,
-- Information Manager), and lib/admin-roles.ts drops the role in the same
-- change.
--
-- **Not additive**, like 0015: one active user holds the role today, and the
-- constraint cannot stop allowing a value while a row still carries it. They
-- are set to null, which is to say they stop being an admin at all.
--
-- That lands the moment this runs, without waiting for a deploy or a sign-out.
-- Roles are read live from this table on every authorization decision
-- (getAuthedUserWithLiveRoles in lib/authorization.ts, and resolveShellIdentity
-- for the shell), so the holder's next request resolves is_admin: false. It
-- also works the other way round: deploying the code without running this file
-- changes nothing for the current holder, who keeps admin until it runs.
--
-- The FAQ's "send a DM to the Digital Innovation Manager (name)" line finds the
-- name by admin_role, so after this it shows the title instead of the name.
--
-- No Data API schema cache refresh is needed: no column has changed, and
-- Postgres enforces the constraint itself (db/neon/README.md).
--
-- Apply with scripts/neon/apply-file.mjs.
--
-- To undo, restore the previous list. The demotion is *not* undone by this --
-- the old role is no longer recorded anywhere, so set it back by hand:
--   alter table public.users drop constraint if exists users_admin_role_check;
--   alter table public.users add constraint users_admin_role_check
--     check (admin_role = any (array['Executive Vice President','Vice President of Operational Affairs','Comptroller','Digital Innovation Manager','Information Manager','Student Body President']));

update public.users
  set admin_role = null
  where admin_role = 'Digital Innovation Manager';

alter table public.users
  drop constraint if exists users_admin_role_check;

alter table public.users
  add constraint users_admin_role_check
  check (
    admin_role = any (array[
      'Executive Vice President'::text,
      'Vice President of Operational Affairs'::text,
      'Comptroller'::text,
      'Information Manager'::text,
      'Student Body President'::text
    ])
  );

comment on column public.users.admin_role is
  'Which admin the user is, or null for none. Three tiers: MANAGEMENT_ROLES run the Management page, Comptroller does the booking work without it, and Student Body President reads the Bookings tab and writes nothing (issue #217). Digital Innovation Manager stopped being an admin role in 0020. The authoritative list is lib/admin-roles.ts; this constraint is the copy Postgres can enforce.';
