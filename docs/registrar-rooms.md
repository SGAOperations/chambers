# Registrar rooms (25Live)

The Registrar schedules most of Northeastern's Boston rooms in **25Live**
(CollegeNET's Series25). Chambers shows those rooms, read-only, next to NUSSO's
on Browse/Book Rooms and in the room picker on Request a Booking. It never books
or requests a Registrar room itself: Operational Affairs asks the Registrar.

The code is `lib/25live/client.ts`; `/api/registrar-spaces` serves it to the
pages. Everything is behind `REGISTRAR_SPACES_ENABLED` (off unless `"true"`).

## Where the data comes from

Northeastern's 25Live has a **Viewer Seat**: what someone who is not signed in
may see. Its data endpoints therefore answer without credentials:

| Endpoint | What it returns |
|---|---|
| `https://25live.collegenet.com/25live/data/northeastern/run/spaces.json` | Every space the seat can see. Filters are ignored. |
| `…/run/rm_reservations.json?start_dt=YYYYMMDD&end_dt=YYYYMMDD` | Every reservation in those spaces for the range. Leave out `space_id` to get the whole campus in one call. |

The official API (`webservices.collegenet.com/r25ws/wrd/northeastern/…`) needs
credentials and answers 401 without them.

What the seat showed in October 2026:

- **178 spaces.** 145 are "BOSTON NON CLASSROOMS" (department seminar and
  conference rooms), only one is a Registrar general-purpose classroom, and about
  25 are on the Oakland campus. Large lecture halls and Curry Student Center are
  not in it.
- Chambers keeps the **152 in Boston**. It drops Oakland and two records that are
  not real rooms ("BK 725 (Copy)" and the retired "xx-sn 058").
- 77 spaces have no building name. Chambers takes it from a sibling with the
  same formal-name prefix, so "BOS-Holmes-014" files under Holmes Hall.
- Capacities of 0 and 999 are placeholders, and Chambers shows them as unknown.
  99 appears often enough that it may be a placeholder too, but it is shown as
  given.
- Almost every reservation's event name is "(Private)", so Chambers can say when
  a room is busy, not what it is busy with.

This path is undocumented. The university can narrow or close the seat without
notice, which is why the feature is flagged. The lasting fix is sanctioned
read-only access to the web-services API, requested from the 25Live
administrators.

## Considered and not built: sending requests to the Registrar automatically

We could probably go further and send room requests to the Registrar
automatically, by working out how NU Engage submits them and having Chambers do
the same. That would turn a picked Registrar room straight into a request in the
Registrar's queue, with no Operational Affairs hand-off.

We are **not building it**, at the direction of OotP. Registrar rooms stay
view-only in Chambers, and Operational Affairs keeps requesting them by hand.
Revisit this only if that direction changes.

## Picked rooms on requests

When a one-time request's Preferred Room is picked from the timeline, rather
than typed, `room_request_details` records where it came from:

- `room_source` is `'nusso'` or `'registrar'`.
- `room_ref` is the EMS room id or the 25Live space id.

Both are NULL for a typed room (see `db/neon/0019_room_request_picked_room.sql`).
Weekly requests do not use the picker, because a term is too many days to check
against one day's timeline.
