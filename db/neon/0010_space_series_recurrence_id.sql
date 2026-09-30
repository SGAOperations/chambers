-- Which master occurrence a series week's calendar invite overrides (issue #184).
--
-- A recurring SGA Space booking's calendar invite is one VEVENT with an RRULE,
-- not one VEVENT per week (Outlook only auto-adds the first VEVENT of a
-- METHOD:REQUEST file, so a series sent that way never put its later weeks on
-- a calendar). A week that has drifted from the series' pattern -- kept at its
-- old time because the pattern's new one conflicted, moved to another space on
-- its own, or edited on its own through the ordinary one-off booking screen --
-- needs a RECURRENCE-ID override VEVENT instead of a plain one, and that
-- override has to name which generated occurrence it replaces.
--
-- That name is this column: the instant the series' pattern would generate for
-- this row, as of the last time a series-level create or edit set it. It is not
-- the row's own start_time -- a one-off edit changes start_time freely (even to
-- a different day) without ever touching this column, which is exactly what
-- keeps the RECURRENCE-ID stable across more than one such edit. Only a series
-- create or a series-level edit (which resets every kept week back to the
-- pattern) ever writes it. NULL for a one-off booking, which has no pattern to
-- override.
--
-- Every series week that exists already predates this column and has never
-- had a chance to diverge under it, so its current start_time IS its pattern
-- slot -- backfilling recurrence_id to start_time is exact, not a guess, for
-- every one of them. A week from before this migration that had already been
-- edited on its own under the old (independent-UID) scheme has no history to
-- recover; it starts fresh here as though it were on-pattern, and the next
-- series-level edit -- which every series eventually gets, since it is the
-- only way to add or remove weeks -- re-anchors it correctly regardless.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** in the Neon console: PostgREST will not see this column until then,
-- and the spaces booking and series routes both select it
-- (db/neon/README.md).
--
-- To undo:
--   alter table public.space_bookings drop column if exists recurrence_id;
-- Every series' calendar invites revert to being sent as independent VEVENTs
-- again, which is issue #184's original bug.

alter table public.space_bookings
  add column if not exists recurrence_id timestamptz;

update public.space_bookings
  set recurrence_id = start_time
  where series_id is not null and recurrence_id is null;

comment on column public.space_bookings.recurrence_id is
  'The instant the parent series'' RRULE would generate for this week, as of the last series-level create or edit. Used as the RECURRENCE-ID when this row''s own start_time/end_time/space_id has since diverged from the pattern (via a conflict kept at its old time, or a one-off edit) and its calendar invite needs to override one occurrence of the series rather than stand alone. NULL for a one-off booking.';
