-- Student Body President as an admin role, and Digital Innovation Project
-- Member removed.
--
-- Issue #217. The SBP needs to see what the organisation has booked. Every
-- existing admin role either runs the booking work or runs the Management page,
-- so there was nothing to give the office that did not also hand it a pair of
-- hands it was not asking for. 'Student Body President' is the first member of
-- a third tier -- view only, Bookings tab and nothing else (lib/admin-roles.ts).
--
-- 'Digital Innovation Project Member' goes in the same change, as the issue
-- asks. **This one is not additive**: four active users hold it today, and the
-- constraint cannot stop allowing a value while rows still carry it. They are
-- set to null, which is to say they stop being admins at all.
--
-- That lands the moment this runs, without waiting for a deploy or for anyone
-- to sign out. Roles are read live from this table on every authorization
-- decision (getAuthedUserWithLiveRoles in lib/authorization.ts, and
-- resolveShellIdentity for the shell), so their next request resolves
-- is_admin: false. There is no token copy to expire and no session to revoke --
-- which also means there is no window in which to apply this "ahead of" the
-- deploy: it takes effect immediately. Apply it when you are ready for those
-- four to lose the admin side.
--
-- To restore one of them afterwards, Management > Users will do it, but the
-- role itself is gone -- Comptroller is the equivalent (full Bookings, no
-- Management).
--
-- No Data API schema cache refresh is needed: Postgres enforces the constraint
-- itself and no column has changed, so there is nothing new for PostgREST to
-- see (db/neon/README.md).
--
-- Apply with scripts/neon/apply-file.mjs.
--
-- To undo, restore the previous list. The four demotions are *not* undone by
-- this -- their old role is no longer recorded anywhere, so put them back by
-- hand if you need to:
--   alter table public.users drop constraint if exists users_admin_role_check;
--   alter table public.users add constraint users_admin_role_check
--     check (admin_role = any (array['Executive Vice President','Vice President of Operational Affairs','Comptroller','Digital Innovation Manager','Digital Innovation Project Member','Information Manager']));

update public.users
  set admin_role = null
  where admin_role = 'Digital Innovation Project Member';

alter table public.users
  drop constraint if exists users_admin_role_check;

-- Null stays allowed by omission rather than by an explicit `is null` arm:
-- `null = any (array[...])` is null, and a check constraint passes on null.
-- That is the shape the baseline used and the shape the column has always had.
alter table public.users
  add constraint users_admin_role_check
  check (
    admin_role = any (array[
      'Executive Vice President'::text,
      'Vice President of Operational Affairs'::text,
      'Comptroller'::text,
      'Digital Innovation Manager'::text,
      'Information Manager'::text,
      'Student Body President'::text
    ])
  );

comment on column public.users.admin_role is
  'Which admin the user is, or null for none. Three tiers: MANAGEMENT_ROLES run the Management page, Comptroller does the booking work without it, and Student Body President reads the Bookings tab and writes nothing (issue #217). The authoritative list is lib/admin-roles.ts; this constraint is the copy Postgres can enforce.';
