# Chambers role-to-position mapping

Issue #153 (CHAMBERS-C06). **Status: approved.** The Chambers lead and the Primary Admin (the same person; see §5) approved the mapping, and the import ran on 2026-10-28.

There are two files, because they answer two different questions:

| File | Question | Used by |
|---|---|---|
| [`chambers-position-map.json`](chambers-position-map.json) | *Going forward*: what does holding position X let someone do in Chambers? | `lib/permissions.ts` reads its admin tiers and IEMS keys. Its `bodies` section seeded `body_position_roles` once (`db/neon/0022_sgauth_positions.sql`); after that, Management edits body seats on the **Bodies** tab, and the database is the source, not this file (#151) |
| [`chambers-positions.json`](chambers-positions.json) | *Once, at import*: which positions should an existing Chambers user be given? | SGAuth `scripts/import-users.ts` (AUTH-T87, SGAOperations/auth#99). This is the exact file the production run used (sha256 `393dd51d…`, matching the run report). |

All keys come from the curated list in SGAOperations/auth `prisma/seed/positions.json` and have been checked against it, including the two per-team lead keys added for Q6. `chambers-iems` is the only product role. Body names match `public.bodies` in production (31 active bodies, 2026-10-20).

## 1. Admin tiers

Since #151 was written, there are three tiers, not two. Issue #217 added a view-only tier, and `0015` removed `Digital Innovation Project Member`. `0020` (#266) also removed `Digital Innovation Manager`, so the Management tier is now three offices.

| Chambers `admin_role` (holders today) | Tier | Position key |
|---|---|---|
| Executive Vice President (1) | Management | `executive-vice-president` |
| Vice President of Operational Affairs (1) | Management | `vice-president-of-operational-affairs` |
| Information Manager (1) | Management | `information-manager` |
| Comptroller (1) | Booking (full Bookings, no Management) | `comptroller` |
| Student Body President (1) | View-only (reads Bookings) | `student-body-president` |

All five offices already exist as curated keys, so no product role is needed. #151 suggested `chambers-admin` for Digital Innovation Project Member, but that role no longer exists and nobody holds it. **Recommendation: do not create `chambers-admin`** until there is an admin who is not an SGA office.

`digital-innovation-manager` grants no admin capability. It still makes its holder Leadership of the SenatePortal and Website Creation teams (§3). The import ran before 0020, while the role still existed, so the holder got the position automatically.

Two other lists hang off `admin_role` today and get mapped explicitly, not derived from a tier:

- `requestAlerts` (`REQUEST_ALERT_ROLES`): VP of Operational Affairs and Comptroller.
- `adminEmailPrefs` (`EMAIL_PREF_ADMIN_ROLES`): EVP, VPOA, Comptroller and Information Manager. It is the Management tier plus Comptroller.

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
| Q1 | (all divisional bodies) | **Decided:** yes, the division VP is Leadership of every body in their division. | Decided |
| Q2 | Executive Board | **Decided:** Leadership = SBP + EVP. Members = the seven division VPs, the Parliamentarian and the Speaker of the Senate. That accounts for 9 of today's 10 Member rows; the tenth is a deactivated former VP, who gets no positions on import. | Decided |
| Q3 | Appeals Board | ~~No chair key; who is Leadership?~~ **Decided:** the Parliamentarian is Leadership. Justices are Members. | Decided |
| Q4 | SGA General | **Decided:** Leadership = VP of Operational Affairs. No member positions. The current holder already gets that position from their `admin_role`, so the import covers this seat with no hand assignment. | Decided |
| Q5 | Student-Designed NU Merch Team | **Decided:** yes, it is the curated T-Shirt Team. Leadership = `t-shirt-team-chair`, Members = `t-shirt-team-member`. | Decided |
| Q6 | SenatePortal / Website Creation Team | ~~Shared team lead?~~ **Decided:** each team gets its own lead. Leadership = that team's lead + DIM + VPOA. The curated list still has one shared `digital-innovation-team-lead`; SGAuth needs to replace it with `digital-innovation-senateportal-team-lead` and `digital-innovation-website-creation-team-lead` (proposed names, matching the member keys). | Decided |
| Q7 | Senate | ~~Speaker + Senate Operations Coordinator?~~ **Decided:** the EVP is the Senate's vice chair for Chambers purposes. Leadership = Speaker + EVP. | Decided |
| Q8 | Student Organization boards | **Decided:** Leadership = the board's director + VPSI; anyone else is a Member. This is the official mapping for SGAuth. Some of today's extra Leadership seats are temporary access for a transition (the EVP and the previous VP of Student Involvement). They do not carry over (see the note below this table). | Decided |
| Q9 | Communications & Events | **Decided:** no. Only chairs/directors and VPs are Leadership. The assistant roles can be added later if someone asks. | Decided |
| Q10 | Global Experience Office / Holistic Wellness WGs | **Decided:** Leadership = the matching Student Success director + the VP of Student Success. | Decided |

**Transitional access goes away at cutover.** Memberships are derived only from positions, so the temporary Student Organization Leadership seats held by the EVP and the previous VP of Student Involvement (Q8) disappear when Chambers switches to SGAuth. If they still need that access then, give them the matching position in SGAuth for the transition and take it away afterwards. Chambers has no override of its own.

## 4. The import (ran 2026-10-28)

The merged script keys boards as `board:<body_id>:Leadership` and `board:<body_id>:Member`, using the body's uuid. It gives every listed position to every user with that key.

**What went wrong:** the file that ran gave each `:Leadership` key the whole Leadership list from `chambers-position-map.json`, usually the director plus the division VP. So every Leader of a body got *all* of that body's Leadership positions, for 245 position assignments across 49 users. The Primary Admin then corrected positions by hand on both production and dev. **The positions in SGAuth now are the hand-corrected ones, not what this file implies.** Do not re-run the import with it: the run is idempotent for users, but it would assign the extra positions again.

If an import is ever needed again, map each `:Leadership` key to `[]` and assign Leadership by hand. One Leadership row can be any of several offices, so it cannot be mapped mechanically.

`chambers-position-map.json` is unaffected. It answers the opposite question (which positions make someone Leadership), and a list is right there.

After cutover, a user's Chambers memberships are exactly what their positions say. Before the Chambers cutover (#154), the checklist must compare each body's Leaders today with the Leaders that the synced positions produce.

## 5. Approval

The Chambers lead and the Primary Admin are the same person: the VP of Operational Affairs. They hold the SGAuth Primary Admin account through `sgaoperations@northeastern.edu`, which is technically the Information Manager's account. Q1–Q10 were decided by the VP of Operational Affairs in review.

- [x] Chambers lead: tiers, IEMS, body table, Q1–Q10
- [x] Primary Admin: import file. `approvedBy` `sgaoperations@northeastern.edu`, `approvedAt` 2026-10-28
- [x] Leadership/Member board keys: the script uses `board:<body_id>:<role>` (SGAOperations/auth#98, #99)
- [x] Per-team lead keys (Q6) added to the curated list in SGAOperations/auth
- [x] Positions corrected by hand on production and dev after the over-assignment (§4)
