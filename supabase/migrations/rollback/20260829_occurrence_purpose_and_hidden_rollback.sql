-- Rollback for 20260829000000_occurrence_purpose_and_hidden.sql.
--
-- Drops both columns. Any per-occurrence overrides that had been set are lost,
-- and those occurrences fall back to their booking's purpose and hidden flag --
-- which is the behaviour that existed before the migration, so nothing breaks,
-- but a hidden occurrence of a visible series becomes visible again.

alter table public.weekly_room_occurrences
  drop column if exists purpose,
  drop column if exists hidden;
