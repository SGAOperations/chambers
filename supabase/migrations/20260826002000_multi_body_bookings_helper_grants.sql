-- Multi-body bookings (issue #19) -- part 3 of 3: lock down the helper functions.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, so every helper added in
-- 20260826001000_multi_body_bookings_rls.sql was reachable by the anon role as an RPC endpoint
-- (/rest/v1/rpc/<fn>), which the Supabase linter flags as
-- anon_security_definer_function_executable. These are internal RLS predicates, not API surface.
--
-- IMPORTANT, verified empirically before writing this: evaluating an RLS policy DOES require the
-- querying role to hold EXECUTE on any function that policy calls. Revoking from `authenticated`
-- makes every booking read fail with "permission denied for function my_body_ids". So
-- `authenticated` must keep EXECUTE -- only PUBLIC and anon are revoked. Revoking from PUBLIC is
-- the part that actually does the work: revoking from `anon` alone is a no-op, because anon
-- inherits the default PUBLIC grant.
--
-- The pre-existing is_admin / is_body_member / is_body_leadership helpers carry the same lint and
-- are deliberately left alone here -- changing their grants is a wider blast radius than this
-- issue, and they leak nothing beyond the caller's own memberships.

revoke execute on function
  public.my_body_ids(), public.my_leadership_body_ids(),
  public.my_divisions(), public.my_leadership_divisions(),
  public.booking_body_is_member(uuid), public.booking_body_is_leadership(uuid),
  public.booking_is_visible(uuid), public.booking_is_manageable(uuid),
  public.weekly_booking_is_visible(uuid), public.tabling_booking_is_visible(uuid),
  public.request_body_is_member(uuid), public.request_is_visible(uuid),
  public.request_owner_is_leadership(uuid)
from public, anon;

grant execute on function
  public.my_body_ids(), public.my_leadership_body_ids(),
  public.my_divisions(), public.my_leadership_divisions(),
  public.booking_body_is_member(uuid), public.booking_body_is_leadership(uuid),
  public.booking_is_visible(uuid), public.booking_is_manageable(uuid),
  public.weekly_booking_is_visible(uuid), public.tabling_booking_is_visible(uuid),
  public.request_body_is_member(uuid), public.request_is_visible(uuid),
  public.request_owner_is_leadership(uuid)
to authenticated, service_role;
