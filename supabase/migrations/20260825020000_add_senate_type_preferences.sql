-- Per-user preference for which Senate session types (Full Body, Weekly, Office
-- Hours) show up in My Rooms. Mirrors email_preferences: a jsonb map of type ->
-- boolean, where a missing key defaults to true (visible) so existing users see
-- everything until they opt out of a type.
alter table public.users
  add column senate_type_preferences jsonb not null default '{}'::jsonb;
