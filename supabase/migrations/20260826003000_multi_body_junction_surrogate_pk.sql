-- Multi-body bookings (issue #19) -- hotfix for PGRST201.
--
-- 20260826000000 created booking_bodies and room_request_bodies with a composite
-- primary key on (parent_id, body_id). That is the textbook junction-table shape, and
-- PostgREST detects it as one: it began inferring a many-to-many relationship
-- `bookings <-> bodies` through booking_bodies, in ADDITION to the long-standing
-- many-to-one `bookings.body_id -> bodies.id`.
--
-- With two candidate relationships, every `bodies(name)` embed became ambiguous and
-- PostgREST answered 300 Multiple Choices / PGRST201. Because the app's read routes do
-- `data || []` without checking the error, that surfaced as "No bookings found"
-- everywhere rather than as an error -- and it broke code that predates this feature,
-- since the mere existence of the tables was enough.
--
-- board_memberships is the precedent already in this schema: also a junction table
-- (user_id + body_id), but with a surrogate id primary key and the pair merely UNIQUE.
-- That shape does not trigger m2m inference, which is why users <-> bodies embeds have
-- always been unambiguous. Match it.
--
-- The unique constraint preserves the real invariant (a body appears at most once per
-- booking); only the index backing it changes.

alter table public.booking_bodies drop constraint booking_bodies_pkey;
alter table public.booking_bodies add column id uuid not null default gen_random_uuid();
alter table public.booking_bodies add constraint booking_bodies_pkey primary key (id);
alter table public.booking_bodies
  add constraint booking_bodies_booking_id_body_id_key unique (booking_id, body_id);

alter table public.room_request_bodies drop constraint room_request_bodies_pkey;
alter table public.room_request_bodies add column id uuid not null default gen_random_uuid();
alter table public.room_request_bodies add constraint room_request_bodies_pkey primary key (id);
alter table public.room_request_bodies
  add constraint room_request_bodies_request_id_body_id_key unique (request_id, body_id);

-- PostgREST caches the schema; without this it keeps serving the ambiguous relationship.
notify pgrst, 'reload schema';
