-- Where SGA Spaces confirmations are sent (issue #109).
--
-- SGA Spaces confirmation and cancellation emails went only to the address a
-- person signed up with. Leadership often want them in their body's shared SGA
-- inbox instead -- or as well -- so the calendar invite lands where the rest of
-- that body's scheduling lives.
--
-- Two halves:
--   * bodies.sga_emails    -- which shared inboxes a body's Leadership may choose.
--   * users.spaces_email_* -- what each person chose.
--
-- The choice is re-checked against live Leadership every time an email is sent
-- (lib/spaces-email.ts), not only when it is saved. Someone who steps down keeps
-- their stored choice but stops being able to use it, and their confirmations
-- fall back to their personal email.

-- ---------------------------------------------------------------------------
-- bodies.sga_emails
-- ---------------------------------------------------------------------------
-- A column rather than a map in code keyed on division and body name. The
-- mapping mostly follows division, but not entirely -- Finance Board carves out
-- of Student Involvement, and the Office of the President boards each have their
-- own -- and name-matching is exactly what issue #95 moved body types away from.
-- Management can correct it in the Bodies tab.
--
-- An array because Executive Board has two inboxes (President and EVP). Each is
-- offered as its own choice; picking the body does not send to both.

alter table public.bodies
  add column if not exists sga_emails text[] not null default '{}';

comment on column public.bodies.sga_emails is
  'Shared SGA inboxes Leadership of this body may send their SGA Spaces confirmations to. Each is offered as a separate choice. Empty means none.';

-- Backfill from the list in issue #109, checked against the 31 bodies live at
-- the time of writing. The named bodies are tested before the division rules so
-- Finance Board does not inherit Student Involvement's inbox.
--
-- Deliberately left empty: SGA General, Governmental Relations Team and
-- Student-Designed NU Merch Team, which the issue gives no inbox for. Their
-- Leadership see only their personal email.
update public.bodies set sga_emails = case
  when name = 'Student Organization Finance Board' then array['sgaFinanceBoard@northeastern.edu']
  when name = 'Appeals Board'                      then array['sgaOAB@northeastern.edu']
  when name = 'Elections Board'                    then array['sgaElections@northeastern.edu']
  when name = 'Executive Board'                    then array['sgaPresident@northeastern.edu', 'sgaEVP@northeastern.edu']
  when division = 'Academic Affairs'               then array['sgaAcademicAffairs@northeastern.edu']
  when division = 'Campus Affairs'                 then array['sgaCampusAffairs@northeastern.edu']
  when division = 'DEI'                            then array['sgaDEI@northeastern.edu']
  when division = 'External Affairs'               then array['sgaExternalAffairs@northeastern.edu']
  when division = 'Operational Affairs'            then array['sgaOperations@northeastern.edu']
  when division = 'Senate'                         then array['sgaSenateSpeaker@northeastern.edu']
  when division = 'Student Involvement'            then array['sgaStudentInvolvement@northeastern.edu']
  when division = 'Student Success'                then array['sgaStudentSuccess@northeastern.edu']
  else '{}'::text[]
end;

-- ---------------------------------------------------------------------------
-- users: the choice
-- ---------------------------------------------------------------------------

alter table public.users
  add column if not exists spaces_email_destination text not null default 'personal';

alter table public.users
  drop constraint if exists users_spaces_email_destination_check;

alter table public.users
  add constraint users_spaces_email_destination_check
  check (spaces_email_destination in ('personal', 'sga', 'both'));

comment on column public.users.spaces_email_destination is
  'Where SGA Spaces confirmation and cancellation emails go: personal (users.email), sga (spaces_sga_email), or both. Falls back to personal whenever spaces_sga_email is not currently allowed.';

-- Plain text, not a foreign key to a body: the same inbox can be reached through
-- several bodies (every Campus Affairs body shares one), and which of them the
-- person leads can change without the choice needing to.
alter table public.users
  add column if not exists spaces_sga_email text;

comment on column public.users.spaces_sga_email is
  'The SGA inbox chosen for SGA Spaces emails. Only honored while it appears in bodies.sga_emails for a body this user holds Leadership in.';
