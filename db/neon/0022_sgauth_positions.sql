-- Standing Body seats come from SGAuth positions (issue #151).
--
-- Under SGAUTH_ENABLED, who is Leadership or a Member of a body is no longer
-- set per person. Management maps SGAuth positions to bodies on the Bodies tab,
-- and each user's board_memberships rows are synced from the positions their
-- SGAuth session carries (lib/position-sync.ts).
--
--   sgauth_positions       the positions Chambers knows about, so the Bodies
--                          tab can offer them by name. Seeded from SGAuth's
--                          curated list (SGAOperations/auth prisma/seed/
--                          positions.json); every session adds or renames
--                          what it carries.
--   body_position_roles    which position makes someone Leadership or a Member
--                          of which body. Seeded from the approved mapping
--                          (docs/sgauth/chambers-position-map.json, #153) by
--                          body name; a name that does not match a body is
--                          skipped, so check the counts this prints.
--   users.sgauth_position_keys
--                          the position keys each user's session carried when
--                          they last used Chambers. Read only where Chambers
--                          needs someone *other* than the caller by office --
--                          request alerts, event channels, the Comptroller on
--                          the landing page. The caller's own access is always
--                          read from their live session, never from here.
--
-- Nothing here touches admin_role, iems_role, is_active or the existing
-- board_memberships rows, so turning SGAUTH_ENABLED off is still the rollback.
-- The cutover runbook (docs/sgauth/cutover.md) snapshots board_memberships
-- before the flag goes on, because the sync rewrites those rows.
--
-- The seed rows below were generated once from those two files. After this
-- runs, the mapping is edited on the Bodies tab, not here.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** (db/neon/README.md).
--
-- To undo:
--   drop table if exists public.body_position_roles;
--   drop table if exists public.sgauth_positions;
--   alter table public.users drop column if exists sgauth_position_keys;
--   alter table public.users drop column if exists sgauth_positions_synced_at;

create table if not exists public.sgauth_positions (
  key text not null,
  name text not null,
  category text,
  last_seen_at timestamp with time zone,
  constraint sgauth_positions_pkey primary key (key),
  constraint sgauth_positions_key_check check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create table if not exists public.body_position_roles (
  body_id uuid not null references public.bodies(id) on delete cascade,
  position_key text not null,
  role text not null,
  created_at timestamp with time zone not null default now(),
  constraint body_position_roles_pkey primary key (body_id, position_key),
  constraint body_position_roles_key_check check (position_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint body_position_roles_role_check check (role = any (array['Leadership'::text, 'Member'::text]))
);

create index if not exists body_position_roles_position_key_idx
  on public.body_position_roles (position_key);

alter table public.users
  add column if not exists sgauth_position_keys text[] not null default '{}'::text[];
alter table public.users
  add column if not exists sgauth_positions_synced_at timestamp with time zone;

create index if not exists users_sgauth_position_keys_idx
  on public.users using gin (sgauth_position_keys);

-- RLS with only the chambers_server policy, as in 0004 and 0018: the API
-- routes decide who may read or write these rows.

alter table public.sgauth_positions enable row level security;
alter table public.body_position_roles enable row level security;

grant select, insert, update, delete on public.sgauth_positions to chambers_server;
grant select, insert, update, delete on public.body_position_roles to chambers_server;

drop policy if exists chambers_server_all on public.sgauth_positions;
create policy chambers_server_all on public.sgauth_positions
  for all to chambers_server using (true) with check (true);

drop policy if exists chambers_server_all on public.body_position_roles;
create policy chambers_server_all on public.body_position_roles
  for all to chambers_server using (true) with check (true);

-- 84 positions: SGAuth's curated list, plus the chambers-iems product role.
insert into public.sgauth_positions (key, name, category) values
  ('student-body-president', 'Student Body President', 'Office of the President'),
  ('executive-vice-president', 'Executive Vice President', 'Office of the President'),
  ('parliamentarian', 'Parliamentarian', 'Office of the President'),
  ('appeals-board-justice', 'Appeals Board Justice', 'Office of the President'),
  ('director-of-elections', 'Director of Elections', 'Office of the President'),
  ('vice-chair-of-elections', 'Vice-Chair of Elections', 'Office of the President'),
  ('elections-board-member', 'Elections Board Member', 'Office of the President'),
  ('t-shirt-team-chair', 'T-Shirt Team Chair', 'Office of the President'),
  ('t-shirt-team-member', 'T-Shirt Team Member', 'Office of the President'),
  ('governmental-relations-team-chair', 'Governmental Relations Team Chair', 'Office of the President'),
  ('governmental-relations-team-vice-chair', 'Governmental Relations Team Vice-Chair', 'Office of the President'),
  ('governmental-relations-team-member', 'Governmental Relations Team Member', 'Office of the President'),
  ('vice-president-of-academic-affairs', 'Vice President of Academic Affairs', 'Academic Affairs'),
  ('director-of-academic-services', 'Director of Academic Services', 'Academic Affairs'),
  ('director-of-co-op', 'Director of Co-op', 'Academic Affairs'),
  ('chair-of-ai-advisory-board', 'Chair of AI Advisory Board', 'Academic Affairs'),
  ('faculty-senate-student-representative', 'Faculty Senate Student Representative', 'Academic Affairs'),
  ('university-undergraduate-curriculum-committee-representative', 'University Undergraduate Curriculum Committee Representative', 'Academic Affairs'),
  ('college-liaison', 'College Liaison', 'Academic Affairs'),
  ('academic-services-committee-member', 'Academic Services Committee Member', 'Academic Affairs'),
  ('ai-advisory-board-member', 'AI Advisory Board Member', 'Academic Affairs'),
  ('co-op-working-group-member', 'Co-op Working Group Member', 'Academic Affairs'),
  ('vice-president-of-campus-affairs', 'Vice President of Campus Affairs', 'Campus Affairs'),
  ('director-of-campus-services', 'Director of Campus Services', 'Campus Affairs'),
  ('director-of-sustainability', 'Director of Sustainability', 'Campus Affairs'),
  ('director-of-green-initiatives', 'Director of Green Initiatives', 'Campus Affairs'),
  ('chair-of-campus-planning-advisory-board', 'Chair of Campus Planning Advisory Board', 'Campus Affairs'),
  ('chair-of-dining-advisory-board', 'Chair of Dining Advisory Board', 'Campus Affairs'),
  ('campus-services-committee-member', 'Campus Services Committee Member', 'Campus Affairs'),
  ('sustainability-committee-member', 'Sustainability Committee Member', 'Campus Affairs'),
  ('campus-planning-advisory-board-member', 'Campus Planning Advisory Board Member', 'Campus Affairs'),
  ('dining-advisory-board-member', 'Dining Advisory Board Member', 'Campus Affairs'),
  ('green-initiatives-board-member', 'Green Initiatives Board Member', 'Campus Affairs'),
  ('vice-president-of-diversity-equity-and-inclusion', 'Vice President of Diversity, Equity, and Inclusion', 'Diversity, Equity, and Inclusion'),
  ('director-of-diversity-equity-and-inclusion', 'Director of Diversity, Equity, and Inclusion', 'Diversity, Equity, and Inclusion'),
  ('director-of-internal-advancement', 'Director of Internal Advancement', 'Diversity, Equity, and Inclusion'),
  ('diversity-equity-and-inclusion-committee-member', 'Diversity, Equity, and Inclusion Committee Member', 'Diversity, Equity, and Inclusion'),
  ('internal-advancement-board-member', 'Internal Advancement Board Member', 'Diversity, Equity, and Inclusion'),
  ('vice-president-of-external-affairs', 'Vice President of External Affairs', 'External Affairs'),
  ('assistant-vice-president-of-external-affairs', 'Assistant Vice President of External Affairs', 'External Affairs'),
  ('director-of-communications', 'Director of Communications', 'External Affairs'),
  ('director-of-events', 'Director of Events', 'External Affairs'),
  ('assistant-director-of-events', 'Assistant Director of Events', 'External Affairs'),
  ('graphic-design-manager', 'Graphic Design Manager', 'External Affairs'),
  ('finance-manager', 'Finance Manager', 'External Affairs'),
  ('boston-intercollegiate-government-representative', 'Boston Intercollegiate Government Representative', 'External Affairs'),
  ('communications-and-events-committee-member', 'Communications and Events Committee Member', 'External Affairs'),
  ('vice-president-of-student-involvement', 'Vice President of Student Involvement', 'Student Involvement'),
  ('director-of-student-organization-approvals', 'Director of Student Organization Approvals', 'Student Involvement'),
  ('director-of-student-organization-compliance', 'Director of Student Organization Compliance', 'Student Involvement'),
  ('director-of-student-organization-governance', 'Director of Student Organization Governance', 'Student Involvement'),
  ('director-of-student-organization-finance', 'Director of Student Organization Finance', 'Student Involvement'),
  ('director-of-student-organization-operations', 'Director of Student Organization Operations', 'Student Involvement'),
  ('student-organization-approvals-board-member', 'Student Organization Approvals Board Member', 'Student Involvement'),
  ('student-organization-compliance-board-member', 'Student Organization Compliance Board Member', 'Student Involvement'),
  ('student-organization-governance-board-member', 'Student Organization Governance Board Member', 'Student Involvement'),
  ('student-organization-finance-board-member', 'Student Organization Finance Board Member', 'Student Involvement'),
  ('student-organization-operations-committee-member', 'Student Organization Operations Committee Member', 'Student Involvement'),
  ('vice-president-of-student-success', 'Vice President of Student Success', 'Student Success'),
  ('director-of-student-engagement', 'Director of Student Engagement', 'Student Success'),
  ('director-of-global-experience', 'Director of Global Experience', 'Student Success'),
  ('director-of-wellness', 'Director of Wellness', 'Student Success'),
  ('student-engagement-committee-member', 'Student Engagement Committee Member', 'Student Success'),
  ('global-experience-committee-member', 'Global Experience Committee Member', 'Student Success'),
  ('wellness-committee-member', 'Wellness Committee Member', 'Student Success'),
  ('global-experience-office-working-group-member', 'Global Experience Office Working Group Member', 'Student Success'),
  ('holistic-wellness-working-group-member', 'Holistic Wellness Working Group Member', 'Student Success'),
  ('vice-president-of-operational-affairs', 'Vice President of Operational Affairs', 'Operational Affairs'),
  ('comptroller', 'Comptroller', 'Operational Affairs'),
  ('digital-innovation-manager', 'Digital Innovation Manager', 'Operational Affairs'),
  ('information-manager', 'Information Manager', 'Operational Affairs'),
  ('webmaster', 'Webmaster', 'Operational Affairs'),
  ('digital-innovation-senateportal-team-lead', 'Digital Innovation SenatePortal Team Lead', 'Operational Affairs'),
  ('digital-innovation-website-creation-team-lead', 'Digital Innovation Website Creation Team Lead', 'Operational Affairs'),
  ('vice-chair-of-website-management-team', 'Vice-Chair of Website Management Team', 'Operational Affairs'),
  ('digital-innovation-senateportal-team-member', 'Digital Innovation SenatePortal Team Member', 'Operational Affairs'),
  ('digital-innovation-website-creation-team-member', 'Digital Innovation Website Creation Team Member', 'Operational Affairs'),
  ('website-management-team-member', 'Website Management Team Member', 'Operational Affairs'),
  ('speaker-of-the-senate', 'Speaker of the Senate', 'Senate'),
  ('senate-operations-coordinator', 'Senate Operations Coordinator', 'Senate'),
  ('legislative-affairs-coordinator', 'Legislative Affairs Coordinator', 'Senate'),
  ('senate-communications-coordinator', 'Senate Communications Coordinator', 'Senate'),
  ('senator', 'Senator', 'Senate'),
  ('chambers-iems', 'Chambers IEMS', 'Chambers')
on conflict (key) do nothing;

-- 100 seats across 31 bodies, joined to public.bodies by name.
insert into public.body_position_roles (body_id, position_key, role)
select b.id, s.position_key, s.role
  from (values
  ('Appeals Board', 'parliamentarian', 'Leadership'),
  ('Appeals Board', 'appeals-board-justice', 'Member'),
  ('Elections Board', 'director-of-elections', 'Leadership'),
  ('Elections Board', 'vice-chair-of-elections', 'Leadership'),
  ('Elections Board', 'elections-board-member', 'Member'),
  ('Executive Board', 'student-body-president', 'Leadership'),
  ('Executive Board', 'executive-vice-president', 'Leadership'),
  ('Executive Board', 'vice-president-of-academic-affairs', 'Member'),
  ('Executive Board', 'vice-president-of-campus-affairs', 'Member'),
  ('Executive Board', 'vice-president-of-diversity-equity-and-inclusion', 'Member'),
  ('Executive Board', 'vice-president-of-external-affairs', 'Member'),
  ('Executive Board', 'vice-president-of-student-involvement', 'Member'),
  ('Executive Board', 'vice-president-of-student-success', 'Member'),
  ('Executive Board', 'vice-president-of-operational-affairs', 'Member'),
  ('Executive Board', 'parliamentarian', 'Member'),
  ('Executive Board', 'speaker-of-the-senate', 'Member'),
  ('Governmental Relations Team', 'governmental-relations-team-chair', 'Leadership'),
  ('Governmental Relations Team', 'governmental-relations-team-vice-chair', 'Leadership'),
  ('Governmental Relations Team', 'governmental-relations-team-member', 'Member'),
  ('Student-Designed NU Merch Team', 't-shirt-team-chair', 'Leadership'),
  ('Student-Designed NU Merch Team', 't-shirt-team-member', 'Member'),
  ('AI Advisory Board', 'chair-of-ai-advisory-board', 'Leadership'),
  ('AI Advisory Board', 'vice-president-of-academic-affairs', 'Leadership'),
  ('AI Advisory Board', 'ai-advisory-board-member', 'Member'),
  ('Academic Services Committee', 'director-of-academic-services', 'Leadership'),
  ('Academic Services Committee', 'vice-president-of-academic-affairs', 'Leadership'),
  ('Academic Services Committee', 'academic-services-committee-member', 'Member'),
  ('Co-op Working Group', 'director-of-co-op', 'Leadership'),
  ('Co-op Working Group', 'vice-president-of-academic-affairs', 'Leadership'),
  ('Co-op Working Group', 'co-op-working-group-member', 'Member'),
  ('Campus Planning Advisory Board', 'chair-of-campus-planning-advisory-board', 'Leadership'),
  ('Campus Planning Advisory Board', 'vice-president-of-campus-affairs', 'Leadership'),
  ('Campus Planning Advisory Board', 'campus-planning-advisory-board-member', 'Member'),
  ('Campus Services Committee', 'director-of-campus-services', 'Leadership'),
  ('Campus Services Committee', 'vice-president-of-campus-affairs', 'Leadership'),
  ('Campus Services Committee', 'campus-services-committee-member', 'Member'),
  ('Dining Advisory Board', 'chair-of-dining-advisory-board', 'Leadership'),
  ('Dining Advisory Board', 'vice-president-of-campus-affairs', 'Leadership'),
  ('Dining Advisory Board', 'dining-advisory-board-member', 'Member'),
  ('Green Initiatives Board', 'director-of-green-initiatives', 'Leadership'),
  ('Green Initiatives Board', 'vice-president-of-campus-affairs', 'Leadership'),
  ('Green Initiatives Board', 'green-initiatives-board-member', 'Member'),
  ('Sustainability Committee', 'director-of-sustainability', 'Leadership'),
  ('Sustainability Committee', 'vice-president-of-campus-affairs', 'Leadership'),
  ('Sustainability Committee', 'sustainability-committee-member', 'Member'),
  ('DEI Committee', 'director-of-diversity-equity-and-inclusion', 'Leadership'),
  ('DEI Committee', 'vice-president-of-diversity-equity-and-inclusion', 'Leadership'),
  ('DEI Committee', 'diversity-equity-and-inclusion-committee-member', 'Member'),
  ('Internal Advancement Board', 'director-of-internal-advancement', 'Leadership'),
  ('Internal Advancement Board', 'vice-president-of-diversity-equity-and-inclusion', 'Leadership'),
  ('Internal Advancement Board', 'internal-advancement-board-member', 'Member'),
  ('Communications & Events Committee', 'director-of-communications', 'Leadership'),
  ('Communications & Events Committee', 'director-of-events', 'Leadership'),
  ('Communications & Events Committee', 'vice-president-of-external-affairs', 'Leadership'),
  ('Communications & Events Committee', 'communications-and-events-committee-member', 'Member'),
  ('SenatePortal Team', 'digital-innovation-senateportal-team-lead', 'Leadership'),
  ('SenatePortal Team', 'digital-innovation-manager', 'Leadership'),
  ('SenatePortal Team', 'vice-president-of-operational-affairs', 'Leadership'),
  ('SenatePortal Team', 'digital-innovation-senateportal-team-member', 'Member'),
  ('Website Creation Team', 'digital-innovation-website-creation-team-lead', 'Leadership'),
  ('Website Creation Team', 'digital-innovation-manager', 'Leadership'),
  ('Website Creation Team', 'vice-president-of-operational-affairs', 'Leadership'),
  ('Website Creation Team', 'digital-innovation-website-creation-team-member', 'Member'),
  ('Website Management Team', 'webmaster', 'Leadership'),
  ('Website Management Team', 'vice-chair-of-website-management-team', 'Leadership'),
  ('Website Management Team', 'website-management-team-member', 'Member'),
  ('Senate', 'speaker-of-the-senate', 'Leadership'),
  ('Senate', 'executive-vice-president', 'Leadership'),
  ('Senate', 'senator', 'Member'),
  ('Student Organization Approvals Board', 'director-of-student-organization-approvals', 'Leadership'),
  ('Student Organization Approvals Board', 'vice-president-of-student-involvement', 'Leadership'),
  ('Student Organization Approvals Board', 'student-organization-approvals-board-member', 'Member'),
  ('Student Organization Compliance Board', 'director-of-student-organization-compliance', 'Leadership'),
  ('Student Organization Compliance Board', 'vice-president-of-student-involvement', 'Leadership'),
  ('Student Organization Compliance Board', 'student-organization-compliance-board-member', 'Member'),
  ('Student Organization Finance Board', 'director-of-student-organization-finance', 'Leadership'),
  ('Student Organization Finance Board', 'vice-president-of-student-involvement', 'Leadership'),
  ('Student Organization Finance Board', 'student-organization-finance-board-member', 'Member'),
  ('Student Organization Governance Board', 'director-of-student-organization-governance', 'Leadership'),
  ('Student Organization Governance Board', 'vice-president-of-student-involvement', 'Leadership'),
  ('Student Organization Governance Board', 'student-organization-governance-board-member', 'Member'),
  ('Student Organization Operations Committee', 'director-of-student-organization-operations', 'Leadership'),
  ('Student Organization Operations Committee', 'vice-president-of-student-involvement', 'Leadership'),
  ('Student Organization Operations Committee', 'student-organization-operations-committee-member', 'Member'),
  ('Global Experience Committee', 'director-of-global-experience', 'Leadership'),
  ('Global Experience Committee', 'vice-president-of-student-success', 'Leadership'),
  ('Global Experience Committee', 'global-experience-committee-member', 'Member'),
  ('Global Experience Office Working Group', 'director-of-global-experience', 'Leadership'),
  ('Global Experience Office Working Group', 'vice-president-of-student-success', 'Leadership'),
  ('Global Experience Office Working Group', 'global-experience-office-working-group-member', 'Member'),
  ('Holistic Wellness Working Group', 'director-of-wellness', 'Leadership'),
  ('Holistic Wellness Working Group', 'vice-president-of-student-success', 'Leadership'),
  ('Holistic Wellness Working Group', 'holistic-wellness-working-group-member', 'Member'),
  ('Student Engagement Committee', 'director-of-student-engagement', 'Leadership'),
  ('Student Engagement Committee', 'vice-president-of-student-success', 'Leadership'),
  ('Student Engagement Committee', 'student-engagement-committee-member', 'Member'),
  ('Wellness Committee', 'director-of-wellness', 'Leadership'),
  ('Wellness Committee', 'vice-president-of-student-success', 'Leadership'),
  ('Wellness Committee', 'wellness-committee-member', 'Member'),
  ('SGA General', 'vice-president-of-operational-affairs', 'Leadership')
  ) as s (body_name, position_key, role)
  join public.bodies b on b.name = s.body_name
on conflict (body_id, position_key) do nothing;

do $$
declare
  seeded int;
  bodies_mapped int;
begin
  select count(*), count(distinct body_id) into seeded, bodies_mapped from public.body_position_roles;
  raise notice 'body_position_roles: % seats across % bodies (the map lists 100 across 31)', seeded, bodies_mapped;
end $$;
