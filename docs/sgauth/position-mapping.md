# Chambers role-to-position mapping (draft for approval)

Issue #153 (CHAMBERS-C06). **Status: draft.** The Chambers lead and the Primary Admin both need to approve it. Once they do, set `"status": "approved"` in `chambers-position-map.json`, and set `approvedBy` / `approvedAt` in the import file.

There are two files, because they answer two different questions:

| File | Question | Used by |
|---|---|---|
| [`chambers-position-map.json`](chambers-position-map.json) | *Going forward*: what does holding position X let someone do in Chambers? | `lib/permissions.ts` and the membership sync (#151) |
| [`chambers-positions.draft.json`](chambers-positions.draft.json) | *Once, at import*: which positions should an existing Chambers user be given? | SGAuth `scripts/import-users.ts` (AUTH-T87, SGAOperations/auth#99) |

All keys come from the curated list in SGAOperations/auth `prisma/seed/positions.json`, and have been checked against it, with two exceptions: `digital-innovation-senateportal-team-lead` and `digital-innovation-website-creation-team-lead` are **not curated yet** (see Q6). `chambers-iems` is the only product role. Body names match `public.bodies` in production (31 active bodies, 2026-10-20).

## 1. Admin tiers

Since #151 was written, there are three tiers, not two. Issue #217 added a view-only tier, and `0015` removed `Digital Innovation Project Member`.

| Chambers `admin_role` (holders today) | Tier | Position key |
|---|---|---|
| Executive Vice President (1) | Management | `executive-vice-president` |
| Vice President of Operational Affairs (1) | Management | `vice-president-of-operational-affairs` |
| Digital Innovation Manager (1) | Management | `digital-innovation-manager` |
| Information Manager (1) | Management | `information-manager` |
| Comptroller (1) | Booking (full Bookings, no Management) | `comptroller` |
| Student Body President (1) | View-only (reads Bookings) | `student-body-president` |

All six offices already exist as curated keys, so no product role is needed. #151 suggested `chambers-admin` for Digital Innovation Project Member, but that role no longer exists and nobody holds it. **Recommendation: do not create `chambers-admin`** until there is an admin who is not an SGA office.

Two other lists hang off `admin_role` today and get mapped explicitly, not derived from a tier:

- `requestAlerts` (`REQUEST_ALERT_ROLES`): VP of Operational Affairs and Comptroller.
- `adminEmailPrefs` (`EMAIL_PREF_ADMIN_ROLES`): EVP, VPOA, Comptroller and Information Manager. It does **not** match the Management tier: it leaves out Digital Innovation Manager and includes Comptroller.

## 2. IEMS

| Chambers `iems_role` (holders today) | Position key |
|---|---|
| Vice President of External Affairs (1) | `vice-president-of-external-affairs` |
| Director of Events (1) | `director-of-events` |

Both are curated offices, so the import gives them those positions directly. The IEMS capability is granted by either of those keys **or** the `chambers-iems` product role. The product role covers anyone given IEMS access who does not hold one of the two offices.

## 3. Body memberships

`chambers-position-map.json` → `bodies` lists, for each body, which positions make someone **Leadership** and which make them a **Member**. Rules used:

- Each body's director or chair key → Leadership. Its `-member` / `-committee-member` / `-board-member` key → Member.
- **The division VP → Leadership of every body in their division.** This is a proposal, not something already in the data. Most bodies have about one more Leadership seat today than they have director keys, which fits VP + director. Holding Leadership is what lets someone book for a body.
- If someone holds positions that map to both roles in the same body, Leadership wins.
- Positions with no Chambers body grant nothing in Chambers: faculty-senate-student-representative, university-undergraduate-curriculum-committee-representative, college-liaison, assistant-vice-president-of-external-affairs, assistant-director-of-events, graphic-design-manager, finance-manager, boston-intercollegiate-government-representative, legislative-affairs-coordinator, senate-operations-coordinator, senate-communications-coordinator.

### Decisions needed

| # | Body | Question | Draft answer |
|---|---|---|---|
| Q1 | (all divisional bodies) | Is the division VP Leadership of every body in their division? | Yes |
| Q2 | Executive Board | **Decided:** Leadership = SBP + EVP. Members = the seven division VPs, the Parliamentarian and the Speaker of the Senate. That accounts for 9 of today's 10 Member rows; the tenth is a deactivated former VP, who gets no positions on import. | Decided |
| Q3 | Appeals Board | ~~No chair key; who is Leadership?~~ **Decided:** the Parliamentarian is Leadership. Justices are Members. | Decided |
| Q4 | SGA General | **Decided:** Leadership = VP of Operational Affairs. No member positions. The current holder already gets that position from their `admin_role`, so the import covers this seat with no hand assignment. | Decided |
| Q5 | Student-Designed NU Merch Team | Is this the curated "T-Shirt Team"? | Yes |
| Q6 | SenatePortal / Website Creation Team | ~~Shared team lead?~~ **Decided:** each team gets its own lead. Leadership = that team's lead + DIM + VPOA. The curated list still has one shared `digital-innovation-team-lead`; SGAuth needs to replace it with `digital-innovation-senateportal-team-lead` and `digital-innovation-website-creation-team-lead` (proposed names, matching the member keys). | Decided |
| Q7 | Senate | ~~Speaker + Senate Operations Coordinator?~~ **Decided:** the EVP is the Senate's vice chair for Chambers purposes. Leadership = Speaker + EVP. | Decided |
| Q8 | Student Organization boards | There are 3 to 4 Leadership seats each today but only director + VP keys. Are some of today's "Leadership" really Members? | Director + VPSI. The rest become Members. |
| Q9 | Communications & Events | Include assistant-director-of-events and the AVP of External Affairs as Leadership? | No (not drafted) |
| Q10 | Global Experience Office / Holistic Wellness WGs | Leadership = the matching Student Success director, with no VP? | As drafted |

## 4. The import: what it can and cannot carry

AUTH-T87 maps **role values to position lists**, and every user with that value gets every listed position. That works for `admin_role` and `iems_role`, where one value means one office. It does not work well for board memberships:

1. **The planned export key carries no role.** AUTH-T87 plans `board:<id-or-slug>` with no Leadership/Member split, so any positions mapped to a body would go to its Leaders and Members alike. The draft uses `board:<slug>:Leadership` / `board:<slug>:Member`. The key regex already accepts that, but **#98's export and #99's `toImportRow` need to emit it.** Raise this on SGAOperations/auth#98 / #99 before the dry run.
2. **Leadership cannot be mapped mechanically.** One "Leadership of X" row could be the director, the VP or a chair, so mapping it to all of them would over-grant. The draft maps every `:Leadership` key to `[]`. About 70 Leadership seats across 31 bodies are **assigned by hand in the SGAuth admin UI** before cutover, using a per-body list of current Leaders that Chambers can produce from `board_memberships`.
3. **Member maps cleanly** to the body's single member key, with one exception: Executive Board's Members are VPs who hold different offices (Q2), so it maps to `[]` and is assigned by hand.

After cutover, a user's Chambers memberships are exactly what their positions say. So anyone whose positions were not assigned would lose Leadership, and with it the ability to book. Before the Chambers cutover (#154), the checklist must compare each body's Leaders today with the Leaders that the synced positions produce.

## 5. Approval

- [ ] Chambers lead: tiers, IEMS, body table, Q1–Q10
- [ ] Primary Admin: import file (then set `approvedBy` / `approvedAt`)
- [ ] `board:<slug>:<role>` keys agreed on SGAOperations/auth#98 / #99
- [ ] Per-team lead keys (Q6) added to the curated list in SGAOperations/auth
