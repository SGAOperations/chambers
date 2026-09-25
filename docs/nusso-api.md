# NUSSO / EMS API integration

"NUSSO" is how SGA refers to **nuevents.neu.edu**, Northeastern's deployment of
Accruent's **EMS Web App** (formerly Virtual EMS). It is an ASP.NET WebForms
application with an undocumented JSON API. Chambers integrates with it to browse
spaces and create reservations directly, without a person driving the EMS web UI.

This document records what we reverse-engineered from authenticated browser
captures. The API is not published by the vendor and can change without notice,
so the client (`lib/nusso/`) validates responses rather than trusting them.

## Authentication

There is **no federated SSO and no MFA**. Login is a plain ASP.NET WebForms
form post to the app root, and the session is carried by cookies.

```
GET  /                      -> Set-Cookie: ASP.NET_SessionId, __AntiXsrfToken,
                               EmsBadBrowserCookie   + hidden WebForms fields
                               (__VIEWSTATE, __VIEWSTATEGENERATOR,
                                __EVENTVALIDATION, deaCSRFToken)
POST /   (form urlencoded)  -> 302  Set-Cookie: EMSCookie   (the auth cookie)
     Location: /Default.aspx
GET  /BrowseForSpace.aspx   -> read the authenticated #deaCSRFToken hidden input
```

The login POST body mirrors the browser exactly:

| field | value |
|---|---|
| `__EVENTTARGET`, `__EVENTARGUMENT` | empty |
| `__VIEWSTATE`, `__VIEWSTATEGENERATOR`, `__EVENTVALIDATION` | scraped from `GET /` |
| `deaCSRFToken` | scraped from `GET /` (a short pre-auth token) |
| `userID_input` | username |
| `password_input` | password (plaintext) |
| `pwdhid` | password again (EMS mirrors it; both were 14 chars — no client hash) |
| `cancel-notes` | empty |
| `ctl00$pc$btnLogin` | `Sign In` |

Success is a **302** that sets `EMSCookie`. A **200** means the login page
re-rendered with an error — almost always bad credentials.

Authenticated requests carry four cookies: `ASP.NET_SessionId`,
`__AntiXsrfToken`, `EmsBadBrowserCookie`, `EMSCookie`.

### CSRF token

Every authenticated page renders a hidden input:

```html
<input type="hidden" name="deaCSRFToken" id="deaCSRFToken" value="<GUID>" />
```

The front end reads it and sends it as the **`dea-CSRFToken`** header on every
`ServerApi.aspx` call. The value differs from the pre-auth login-page token, so
the client re-scrapes it from an authenticated page after login.

## ServerApi

All actions are `POST https://nuevents.neu.edu/ServerApi.aspx/<Method>`, JSON in,
JSON out. Responses are wrapped in ASP.NET's envelope:

```json
{ "d": "<stringified JSON>" }
```

Required headers: `Content-Type: application/json; charset=UTF-8`,
`X-Requested-With: XMLHttpRequest`, `Origin`, `Referer`, `dea-CSRFToken`, plus
the cookies. A lapsed session is answered with the login HTML (not an error), so
the client retries once after re-authenticating when a response is not JSON.

### Methods used

| Method | Purpose | Client fn |
|---|---|---|
| `GetBrowseLocationsBookings` | existing bookings in a window (calendar) | `browseBookings` |
| `GetBrowseLocationsRooms` | rooms across buildings (picker) | `browseRooms` |
| `GetAvailabilityList` | is a room free for a window | `getAvailability` |
| `AddToCartCheck` | validate a selection before saving | `createBooking` (step 1) |
| `GetServicesForBooking` | services/UDF context; primes server state | `createBooking` (step 2) |
| `SaveReservation` | **create the reservation** | `createBooking` (step 3) |

`SaveReservation` returns `{ "Success": true, "SuccessMessage": "<json>" }` where
`SuccessMessage` is itself stringified JSON containing `ReservationId` and a
`ReservationSummaryLink`.

## Times

EMS speaks **Boston wall-clock** strings with second precision and no offset
(`"2026-09-27 21:00:00"`), the same domain SGA Spaces stores in (see
`lib/boston-time.ts`). Cart entries additionally carry GMT equivalents; the
client derives the offset per-instant so both EDT and EST are correct.

## SGA's EMS identifiers

Observed on nuevents.neu.edu; overridable by env (see `lib/nusso/config.ts`).
Org-level ids (`NUSSO_ORG`) are the same for every reservation type; the
template and event type are per-**profile** (see below).

| thing | id | scope |
|---|---|---|
| SGA group | `225399` | org |
| Eastern time zone | `61` | org |
| room-request template | `25` | `room-request` profile |
| room-request event type | `657` | `room-request` profile |
| tabling template | `22` | `tabling` profile |
| tabling event type | `387` | `tabling` profile |

### Reservation profiles (room request vs. tabling vs. ...)

Different EMS reservation types run under a different process template, carry a
different event type, set a different cart `RecordType`, enforce a different
required-UDF set, and may be submitted from a different page.
`lib/nusso/config.ts` models each as a `NussoReservationProfile`, and the client
(`getAvailability`, `createBooking`) and the API routes (`reservationType`) take
one, defaulting to `room-request`. Adding a new type is a profile plus its form;
nothing else in the client changes.

Captured differences:

| | room-request | tabling |
|---|---|---|
| templateId | 25 | 22 |
| eventTypeId | 657 | 387 |
| cart `RecordType` | 1 | 2 |
| required UDFs | 23, 34, 32 | **78, 77, 34, 32** |

Tabling's UDFs differ: it drops the projector question (23) and adds **78** (a
single-select "what type of tabling event"; `99` is one captured option) and
**77** — a **required free-text** "describe this event" field that the form must
collect from the user (the profile ships an empty default that EMS would reject
on its own).

Every `SaveReservation` also carries `recurrences` (a "no recurrence" default
for a single booking), `serviceOrders: []`, and `tzMinuteBias` (minutes GMT is
ahead of Boston: -240 EDT / -300 EST). The client sends all three.

### Required user-defined fields (UDFs)

`SaveReservation` rejects a request that omits a required UDF. The SGA template
enforces **three** single-select UDFs. The answer values below are the exact
option ids that produced a successful reservation in the capture and are sent by
default (`NUSSO_REQUIRED_UDFS`):

| Id | prompt | answer id |
|---|---|---|
| 23 | projector / plasma TV access | 18 |
| 34 | external control over the event | 31 |
| 32 | Safety & Security terms acknowledgement | 27 |

> **Validation caveat.** These answers, and the ID catalog above, were captured
> from a single real booking (test reservation #696860). They have not been
> re-verified against a live booking from this integration. Before enabling
> booking in production, run one end-to-end reservation and confirm the UDF set
> and option ids still match — EMS can renumber them.

## Configuration

Set `NUSSO_USERNAME` / `NUSSO_PASSWORD` (a shared SGA EMS web-user account) in
the environment. See `.env.example` for the full list. Without them, the
Browse/Book NUSSO tab returns 503 ("not configured") rather than failing loudly.

**Booking also requires the 1st-contact phone.** EMS's Reservation Details tab
requires the Customer (group), 1st Contact, 1st Contact **phone**, and 1st
Contact email; a reservation missing any is rejected with a generic "complete
the required fields" error. Name and email default to SGA operations, but the
phone has no default -- set `NUSSO_CONTACT_PHONE`, or `createBooking` fails fast
with a clear message. The **2nd contact / requestor** (`NUSSO_REQUESTOR_*`) is
optional; leave it blank and EMS accepts it.

## Chambers surface & authorization

The **Browse/Book NUSSO** tab is a "find a room" flow: pick a date, time window
and (optionally) minimum capacity, and the page lists every **available** room
for that window, grouped by building and showing each room's capacity. Booking a
result opens a confirm modal (room + window fixed) that collects the event name,
attendance and — for tabling — the required description.

Routes (`app/api/nusso/`):

- `POST /api/nusso/search` — available rooms for a window (`searchAvailableRooms`,
  a GetAvailabilityList with RoomId -1 filtered to free rooms). The find-a-room query.
- `POST /api/nusso/book` — create the reservation.
- `POST /api/nusso/availability` — availability for one specific room.
- `GET /api/nusso/rooms`, `GET /api/nusso/bookings` — the raw room list and a
  day's existing bookings (browse helpers).

Authorization:

- **Browsing / searching**: any signed-in Chambers user.
- **Booking**: admins and body Leadership only (`lib/nusso/authorize.ts`),
  because it acts under SGA's single shared EMS account and puts a real
  reservation on Northeastern's calendar.

## Recording into Chambers (My Rooms)

A successful NUSSO reservation is written into Chambers' own booking model so it
appears in **My Rooms** with its EMS reservation code attached
(`lib/nusso/record-booking.ts`). The booking modals collect a body + scope
(`BookingScopeSelector`, fed by `/api/request`; single / divisional / multi-body,
same rules as the request form), and `/api/nusso/book`:

1. validates the scope selection and the active semester **before** the EMS call
   (so it never makes a reservation it cannot record);
2. makes the EMS reservation;
3. on success, inserts a `bookings` parent (`One-Time Room` for a room request,
   `Tabling` for tabling) scoped to the chosen body + active semester, plus the
   child session row(s) with `reservation_code` = the EMS reservation id and
   status `Reserved` — the exact rows My Rooms already reads.

The EMS reservation is irreversible, so if step 3 fails the response still
carries the reservation id with a `chambersBookingRecorded: false` warning rather
than discarding the booking. No emails are sent for a NUSSO booking (unlike the
admin create flow). Weekly/recurring NUSSO bookings are not yet supported — the
booking flow is single-session.
