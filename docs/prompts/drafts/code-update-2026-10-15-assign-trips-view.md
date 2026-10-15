# Code update — Picking › Assign tab › Trips view

**Type:** code-update (SHIPPED) · **Date:** 2026-10-15 · **Owner-tested on phone:** 2026-10-15
**Commits (confirmed with `git log`):**
- `85b64d77` (2026-10-13 23:37 IST) — `picking: GET /api/picking/trips — read-only trips feed for the Assign Trips view (slice 1)`
- `60f9fa75` (2026-10-13 23:56 IST) — `picking: Assign tab Trips view — trip list + trip screen reusing existing cards (slices 2–4)`

**Source:** written from the code at `60f9fa75`. Nothing in these files has changed since that commit (`git diff 60f9fa75 HEAD`
on `lib/picking`, `components/picking` and `app/api/picking` is empty). Design: `docs/mockups/picking/assign-trips-view.html` (v7).
Plan: `docs/prompts/drafts/code-discovery-2026-10-13-assign-trips-view.md`.

> This is a DRAFT. No canonical `CLAUDE_*.md` file was edited. Consolidation merges it, using the routing table in §1.

---

## 1. Routing table — where each section goes when merged

| Section of this draft | Canonical owner | Where |
|---|---|---|
| §2 What it is, §4 trip list, §5 trip screen, §6 hard rule, §8 owner decisions, §9 superseded | `CLAUDE_PICKING.md` | **new §5.7 "Trips view on the Assign tab"** |
| §7 back-button path, the `trip` `DetailListKey` (pager) | `CLAUDE_PICKING.md` | §5.3 (pager and phone-native navigation), with a pointer from §5.7 |
| Refresh of the trips feed (§3.6) | `CLAUDE_PICKING.md` | §10 (both paths) |
| §3 the feed: `GET /api/picking/trips`, `lib/picking/trips-view.ts`, `PickingTrip*` types | `CLAUDE_PICKING.md` | §5.7, plus §4 (routes) and §8 (key files) |
| One cross-reference row: "Picking reads trips read-only" | `CLAUDE_FLOOR_TRIPS.md` | §1 "What it does not own" |
| The ring reverses the "no progress roll-up on Picking" rule | `CLAUDE_UI.md` | §62.4 |
| §10 landmines | `CLAUDE_PICKING.md` §7 (landmines) and §5.7; the ring one also in `CLAUDE_UI.md` §62.4 |
| §11 stale facts | the files cited in each line |

Suggested `CLAUDE_FLOOR_TRIPS.md` §1 row:

| Behaviour | Owner |
|---|---|
| The supervisor's **Trips view** on `/picking` reads trips READ-ONLY through `GET /api/picking/trips` (`lib/picking/trips-view.ts`, which calls `getTripsForDate` and the desk rule). It writes nothing to `trips`, `trip_drops`, `trip_activity` or `orders` | `CLAUDE_PICKING.md` §5.7 |

---

## 2. What it is

A **Bills | Trips** segmented switch on the supervisor's **Assign** tab of `/picking` (supervisor face only;
the picker's My Picks face is untouched). Bills is the default and is the Assign tab exactly as it was.

**Trips** lists the trucks the planner made on `/floor`, one card per trip. Tapping a trip opens a trip screen with
every one of that trip's bills that the board holds, grouped into four bands (to assign, picking, needs check, done).
From there the supervisor selects and assigns that truck's bills, using the same cards, sheet and route as the Bills view.

**Why (owner):** the planner buckets work into trucks first, then shows the floor one truck at a time. The supervisor
should be able to finish a truck rather than pick across six trucks and finish none. The view is plan-first: it only
groups bills; it never changes them.

**Who sees it:** anyone whose face is the supervisor board (`picking` canView, not on the picker face). The switch
is plain `useState` (`assignView`), nothing persisted, default `"bills"`.

---

## 3. The feed — `GET /api/picking/trips`

### 3.1 Route and gate
- `app/api/picking/trips/route.ts`. `export const dynamic = "force-dynamic"`.
- 401 without a session; 403 unless `checkAnyPermission(roles, "picking", "canView")` (admin bypass inside that helper,
  the same as `/api/picking/queue`). 500 with a generic message if the builder throws.
- **Takes no query parameters.** It always answers for today's desk (IST). Nothing is read from the URL.
- Under `/api/picking/`, never `/api/trips` (FLOOR_TRIPS §15 landmine 1). Floor's `/api/floor/trips/*` was not usable:
  the list is `floor` canEdit, and no floor supervisor holds `floor`.
- ⚠ A picker also holds `picking` canView, so a picker could fetch this by URL. Same open point as the tint feed
  (PICKING §5.6). Trip numbers, plates and driver phones are exposed. See §13.

### 3.2 Which trips — `getPickingTrips()` → `buildPickingTrips(gateOn)` in `lib/picking/trips-view.ts`
1. `gateOn = await isPickGateOn()` — read live, never taken from a caller (fails OFF).
2. `getTripsForDate(today, today)` — the Floor rail's own feed, so the desk rule is `tripsOnDeskWhere`
   (`lib/trips/live-trips.ts`): today's trips plus earlier trips still holding a not-done bill.
3. Filtered to trips that are:
   - **not cancelled** (`status !== TRIP_CANCELLED`);
   - **shown to the floor when the gate is ON** (`shownAt !== null`). Gate OFF → every non-cancelled desk trip;
   - **holding at least one bill** (`counts.total > 0`, over non-removed bills).
- `buildPickingTrips(gateOn)` is exported **for the smoke script only** (it runs a read-only gate-OFF pass without
  flipping the switch). App code calls `getPickingTrips()`.

### 3.3 Payload — `PickingTripsResult` (`lib/picking/types.ts`)
`{ date, gateOn, trips: PickingTrip[], notOnTrip: { bills, notPlannedYet } }`

`PickingTrip`: `id`, `tripNumber`, `tripDate` (earlier than today on a carried trip), `typeCode` (L/U/I/C, the STORED type),
`deliveryTypeName`, `cutoff` (= `windowTime`, display only), `cutoffSortOrder` (`dispatch_slot_master.sortOrder`),
`routeLabel` ("Adajan +2" — the summary's own ranked route printed by `formatRouteLabel`, never re-ranked), `routes`
(every route, ranked like the label: most stops first, first stop breaks a tie, skipping stops with no bill, blank names
and placeholder routes; re-delivery-only stops count as carrying a bill, exactly as the label does), `stops`
(`dropCount`, every `trip_drops` row), `vehiclePlate` (`vehicle_master.vehicleNo`, else `adhocVehicleNo`, else null),
`driverName` / `driverPhone` (the trip's SNAPSHOT, never read through `vehicleId`), `isHand`, `shownAt`, `counts`,
`members`.

**Sort:** `cutoffSortOrder` ascending (no window last), then `tripNumber` (`localeCompare "en"`).

### 3.4 Counts — on the SERVER, over every non-removed bill on the trip
`PickingTripCounts`: `waiting`, `lockedUpcoming`, `tinting`, `picking`, `needsCheck`, `checked`, `held`, `other`, `total`.

**Why server-side:** the queue (`openPending`) only holds waiting / assigned / picked bills and bills **checked today**.
It never holds `dispatched` bills, held bills (`dispatchStatus = 'hold'` fails the queue's `dispatchStatus: "dispatch"`),
tint-stage bills, `pending_support`, or bills checked on an earlier day. A ring built from queue rows would be wrong on
every carried trip. Floor hit the same trap (`lib/floor/types.ts`).

**How:** one extra batched orders read through the invoice rows (`onStopsWhere` + `stopRowsSelect` + `placeOnTrips`,
v27.66 model, `isRemoved: false`, no stage filter). `bucketOf()` mirrors `bucketFor` (`lib/trips/queries.ts`):
- hold first, outranking every stage → `held`;
- `pending_picking` → `waiting` or `lockedUpcoming` by the board's own zone rule (future `dispatchTargetDate` and not
  early-released → upcoming; null date → due);
- `pick_assigned` → `picking`; `pick_done` → `needsCheck`; `pick_checked` or `dispatched` → `checked`;
- the three tint-room stages (`pending_tint_assignment`, `tint_assigned`, `tinting_in_progress`, written out as in
  `lib/picking/tint-workload.ts`) → `tinting`;
- anything else → `other`.

They reconcile with the Floor rail by construction: `waiting + lockedUpcoming` = Floor `waiting`, `tinting + other` =
Floor `other`, the rest one-to-one. `scripts/_smoke-picking-trips.ts` checks this against `getTripsForDate` for every
listed trip.

### 3.5 Members, and why no trip field on `PickingQueueRow`
`members: { orderId, dropSeq }[]` — every non-removed bill on the trip at ANY stage, sorted by `dropSeq` then `orderId`.
The phone joins a trip to its own queue rows by `orderId`.

**Trip fields were deliberately NOT added to `PickingQueueRow`.** `FloorBoardRow extends PickingQueueRow`
(`lib/floor/types.ts`), and Floor declares its own `tripDropId` / `tripNumber` / `tripStatus` there with a comment saying
to widen the Floor type, never the Picking one. Any new required row field would also have to be filled by Floor's builder.
Keeping trip data off the queue also left `queue.ts`, `sync.ts`, `live-merge.ts`, the marker and `buildPickingWhere`
untouched.

### 3.6 "Not on a trip" — a COUNT only, never a list
- **Gate ON:** `countHeldBackWaiting(buildPickingWhere({ scope: "openPending" }).where, true).unplanned` — the same
  helper and the same ungated where the queue uses for its band, so it equals the band's "N not planned yet".
  `notPlannedYet = true`. ⚠ That helper excludes Hand bills (`handAt: null`), so Hand bills on no trip are counted nowhere.
- **Gate OFF:** `orders.count({ AND: [WAITING_FOR_PICKER, { tripDropId: null }] })` — every waiting bill on no trip,
  due and upcoming, Hand included. All of them are on the Bills view. `notPlannedYet = false`.

### 3.7 Refresh (for `CLAUDE_PICKING.md` §10)
Owned by `SupervisorPickingShell` (`components/picking/picking-mobile-shell.tsx`): `trips`, `tripsFailed`,
`setTripsActive`, all on `PickingBoardContext`.
- **Fetched only while the Trips view is on screen.** The board reports `activeTab === "assign" && assignView === "trips"`
  through `setTripsActive`; `refetchTrips` is a no-op otherwise (`tripsActiveRef`). Turning the view on fetches at once.
  The Bills view costs no extra request.
- **`refetchQueue` always ends with `refetchTrips()`** — on the sync path (feed on, own write) and the full path. So every
  own action (assign, undo, approve, cancel, release, direct load, article no.), the legacy marker's `onChange`, a full
  flush and IST midnight all refresh it.
- **Feed path:** after an applied patch in `flush` (never while paused) → `refetchTrips()`. A push ("pick done") →
  `syncIds` then `refetchTrips()` only if not paused.
- Silent on failure: keeps the last good list; `tripsFailed` drives "Couldn't load trips." only when nothing is loaded.

---

## 4. The trip list (mockup ②)

Components in `components/picking/assign-trips.tsx`; data and ordering in `picking-board-mobile.tsx`.

- **Filter row in Trips view:** the existing `TypeFilterPills` with a new optional `counts` prop (All / Local / UPC counts
  of TRIPS), then the switch. No route dropdown, no summary line, no tinting strip, no search (masthead search icon hidden
  via `showSearch={!inTripsView}`).
- **Pills filter TRIPS by stored `typeCode`** (`tripMatchesType`): Local = `L`, UPC = `U`. I and C trips appear under All
  only — Floor's `tripInScope` rule. Its own state (`tripTypeFilter`), never the bill filter `activeType`.
- **`TripRow`:** round 38px tile with the type letter (L blue `#2563eb` on `#eaf1ff`, U orange `#ea580c` on `#fff1e7` —
  RouteDot's values; I / C neutral grey), trip number (17px/600), one grey line `"{cutoff ?? 'no slot'} · {routeLabel ??
  'No route'}"`. No vehicle, driver or stops on the card. Shell = the Picking-tab picker card's (`rounded-[16px]`,
  `CARD_SHADOW_V2`).
- **Ring (`TripRing`):** conic gradient from the SERVER counts, segments in order waiting (`waiting + lockedUpcoming`,
  `#d1d5db`) · tinting (`#f9a8d4`) · picking (`#0284C7`) · needs check (`NEEDS_CHECK_SEGMENT`, imported from
  `components/floor/progress-bar.tsx`) · done (`checked`, `#22c55e`). These are Floor's progress-bar tones. `held` and
  `other` are excluded. No segments → a plain `#eef1f4` ring.
- **Centre (`tripCentre`)**, from `left` = the trip's members ∩ the board's due waiting rows (the same rows the Bills view
  lets him select, ignoring Bills' type / route / search):
  1. `left > 0` → the number + "LEFT";
  2. else `lockedUpcoming > 0` → a lock glyph;
  3. else `tinting > 0` → pink "TINT" (`#be185d`);
  4. else ✓ + "ALL IN", and the card turns soft green (`#f0fdf4`, border `#dcfce7`).
- **Order:** the feed's order, then every ✓ trip moved to the bottom (stable partition).
- **"Not on a trip" card (`NotOnTripCard`):** last, under the All pill only, hidden when its count is 0. Gate ON →
  "N not planned yet", inert (a `div`). Gate OFF → "Bills the planner hasn't put on a truck" + the count + chevron;
  tapping switches to the Bills view and clears the selection.
- **The held-back band** (the amber "N trucks with the planner · N not planned yet" line) is the existing JSX and stays on
  the trip list; it is hidden inside a trip.
- **Empty / loading:** "Loading trips…"; "Couldn't load trips."; no trips at all → gate ON "No trips shown to floor yet",
  gate OFF "No trips on the desk yet"; trips exist but none of this type → "No trips of this type."

---

## 5. The trip screen (mockup ③)

- **Open:** `openTrip(id)` — saves the list's scroll position, clears the selection, sets `openTripId`, pushes ONE history
  entry (`pushScreen("trip")`), scrolls to the top. The filter row is hidden (as the Picking tab hides it at level 2).
- **`TripHeader`:** back chevron (`history.back()`), trip number (19px) + type tag (LOCAL / UPC / IGT / CROSS), "Cutoff
  {cutoff} · {stops} stops"; a details box: Vehicle (plate or "—"), Driver (name · phone, or "—"), Routes (the full ranked
  list); a status bar with the same five server segments as the ring; a counts row: to assign, picking, check, done, plus
  tinting when > 0 and "N on hold" in grey when > 0.
- **Trip left the desk while open** (cancelled, or carried trip finished): the header shows only the back chevron and
  "This trip is no longer on the desk." The screen is never auto-closed.
- **Bands, in order, each from the board's EXISTING pools ∩ the trip's members (`tripBand`), in spine order, not narrowed
  by the Bills view's filters:**
  1. **To assign** — `waitingRows`, due first, then the Bills view's own "Upcoming" lock divider and the locked cards.
     Heading action: **Select all** / **Clear** (due rows only; `brand-700` text action).
  2. **Picking** — `assignedRows`.
  3. **Needs check** — `doneRows`.
  4. **Done** — `checkedRows` (the board's checked-today rows), newest first by `doneSortAt`. If the server's
     `counts.checked` is higher than the cards shown, a quiet "+N checked earlier" line; the heading count is the server's.
- **Hidden when empty**; if every band is empty: "No bills on the board for this trip right now."
- **Selection is trip-scoped:** `selectedRows = (tripScreenOpen ? tripWaitingDue : filteredWaitingDue).filter(selected)`.
  A route filter left over from the Bills view cannot drop a selection, and no bill outside the trip can ride along.
  Selection is cleared on Bills ↔ Trips switch, trip open and trip close.
- **Floating bar, picker sheet, `POST /api/picking/assign`:** unchanged. After any action, `refetchQueue` refreshes the
  queue AND the trips feed (§3.7).
- **Bottom bar stays visible** on the trip screen; it hides on the bill detail as before (`hideBar = detailOpen`).

---

## 6. 🔴 THE HARD RULE — cards and bill flows are reused unchanged

The Trips view only GROUPS bills. Every card, tap, detail screen and action is the same code path as on the bill's home
tab:
- To assign → the Assign card (`variant="assign"`): tap = select, arrow = detail; locked → `assignLocked`, lock tap →
  the release sheet.
- Picking → the Picking card (`variant="picking"`, `nowTick`): detail = Undo, ⋯ Cancel.
- Needs check → `variant="doneCheck"`: detail = line ticks, hardener ticks, findings, WhatsApp share, article no. + Approve.
- Done → `variant="doneChecked"` with `captionSmu` and the Direct Loading undo, read-only.

**Only two additions exist:**
1. `PickingCard`'s optional `stopNumber` prop (default `null`) — a GREY "Stop N" tag in the caption run
   (`bg-gray-100 text-gray-600`; `DUP_SO_BADGE_CLASS` on a duplicate-SO card). Never violet. Existing callers do not pass
   it and render byte-identical DOM.
2. One grey line in the detail header, `"{tripNumber} · {Local|UPC|IGT|Cross} · Stop N"`, rendered only when
   `detailListKey.kind === "trip"` (11.5px, `ink-500`; `DUP_SO_MUTED` on the red header).

**Never fork or copy a card or detail component for this view.** `PickingCard` stays module-private in
`picking-board-mobile.tsx`; the trip bands are rendered inside that file for exactly this reason.

(Navigation plumbing also changed, but no card or detail markup: `TypeFilterPills` gained an optional `counts` prop, and
`pushScreen` gained an optional screen name.)

---

## 7. Back-button path (as shipped)

One popstate authority (`onPop` in `picking-board-mobile.tsx`), now with two levels: the trip screen (one entry, pushed by
`openTrip`) and the bill detail (one entry, pushed by `openDetail`). `navStateRef` gained `tripOpen` and `releaseOpen`.
Branch order in `onPop`: article-no popup → finding popup → picker sheet over detail → cancel sheet → detail (now `return`s)
→ picker sheet over the trip screen → release sheet over the trip screen → trip screen.

| # | Case | What Back does |
|---|---|---|
| 1 | Trip list → open trip → Back (hardware, iOS swipe, or the header ‹) | closes the trip, list restored at its scroll position. Never leaves `/picking` |
| 2 | Trip → bill → Back | closes the bill → trip screen. Back again → list |
| 3 | Trip → bill → picker sheet → Back | closes the sheet (re-push) → Back closes the bill → Back closes the trip |
| 4 | Trip screen → select → floating bar → picker sheet → Back | closes the sheet, re-pushes the trip entry → Back closes the trip |
| 5 | Trip screen → lock tap → release sheet → Back | closes the sheet, re-pushes → Back closes the trip |
| 6 | Assign from the bill's own CTA | `handleAssign`'s `if (detailOpen) history.back()` → lands on the trip screen |
| 7 | Assign from the floating bar on the trip screen | no history call (detail never opened) → stays on the trip screen |
| 8 | Approve / Cancel from a bill opened from a trip | their unconditional `history.back()` → trip screen |
| 9 | Bottom tab switched while a trip is open | an effect on `activeTab` calls `history.back()` → the trip closes; returning to Assign shows the trip list |
| — | Paging inside a band | no history entry (unchanged) |

**Pager:** new `DetailListKey` variant `{ kind: "trip"; tripId; band: "waiting" | "picking" | "needsCheck" | "checked" }`.
`activeDetailList` resolves it live through `tripBand`, so swiping pages only within that band of that trip; "waiting"
pages due then upcoming (as the Bills view does). A bill that leaves the band → index −1, pager inert (unchanged
`use-bill-pager.ts` behaviour).

---

## 8. Owner decisions (2026-10-13 / 14)

| Decision | Why |
|---|---|
| A view on the Assign tab, not a 4th bottom tab | Trips are a way of looking at Assign work; a 4th tab would split one job across two places |
| No Clear, Mark-done or dispatch button on the trip | Loading and dispatch are a separate job; no trip action may change a bill (FLOOR_TRIPS §13) |
| Only trips shown to the floor (gate ON) | The planner decides what the floor sees: made 5, showed 3 → supervisor sees 3 |
| The trip number is the headline; vehicle, driver and stops only inside the trip | The list must scan fast; details are for the truck you opened |
| Main route "+N" from `lib/trips/route-label.ts` | One ranking rule, so the phone and the Floor rail never disagree |
| Plain text, no purple pill; the Stop tag is grey | One-violet rule (UI §59.9) and "no brand on the card" (§62) |
| Android back: trip → list, never leaves Picking | The supervisor must not be thrown out of the module from inside a truck |
| Ring = server counts, centre = phone's "left" | Server sees the whole trip; the centre must match what the Bills view lets him assign |
| **Accepted for now (Claude Code's calls):** | |
| Masthead stays on the trip screen | Consistent with the Picking tab's level 2; mockup ③ draws none |
| Search hidden in the Trips view | A trip is the scope; the design has no search |
| ✓ = nothing left to assign (even if bills are still being picked) | The centre answers "what can I still hand out"; label "ALL IN" from the mockup |
| "Not on a trip" under All only, hidden at 0 | Those bills are every type; a 0 card is noise |
| Selection cleared on switch, trip open and close | Selection is scoped to one trip; a Bills tick must not ride into a trip's bar |

---

## 9. Superseded ideas — do not rediscover

- A 4th "Trips" bottom tab.
- kg / litres as the headline of a trip card.
- A "Clear" button on a trip at 0 assigned.
- Mark-dispatched from this screen.
- Type group headers (LOCAL / UPC sections) on the list — the pills do this.
- The vehicle plate on the list card (it is in the trip header only).
- A violet "Stop N" tag and a violet `.co` chip (both in early mockup versions).

---

## 10. Landmines

1. **The ring deliberately reverses CLAUDE_UI §62.4** ("per-route progress roll-up" rejected on Picking). Owner-approved
   2026-10-13. The code carries the comment at the ring (`assign-trips.tsx`, `TripRing`). Do not remove it as "violates
   §62.4"; record the reversal in §62.4 at consolidation.
2. **A trip taken back from the floor disappears from the Trips view** (gate ON lists shown trips only) — even if some of
   its bills are being picked or are waiting to be checked. Those bills stay on the Picking and Done tabs. The same happens
   to any unshown trip holding in-progress bills.
3. **How trips-only writes on Floor reach this view** (vehicle / driver change, show / take-back, send to billing):
   - **Feed ON (live today):** the supervisor feed subscribes to `topics: "order,trip,config"`; a `trips` write arrives as a
     trip id; `flush` posts it to `/api/picking/sync` and, once the patch is applied (not while a bill or sheet is open),
     calls `refetchTrips()`. So the trip card and header update on the next glance (15 s active / 60 s idle).
   - **Feed OFF (marker fallback):** the marker keys on `orders` (COUNT, MAX(`updatedAt`)) plus the held-back triple. A
     show / take-back with the gate ON changes the held-back count → the marker fires → `refetchQueue` → `refetchTrips`.
     A **vehicle or driver change writes no order and moves no held-back figure, so it is invisible until the next order
     change**, or until the supervisor leaves and re-enters the Trips view (`setTripsActive` refetches on entry).
4. **Never add trip fields to `PickingQueueRow`** (§3.5). Join on `members`.
5. **Membership is read through invoice rows** (`onStopsWhere` / `placeOnTrips`), not bare `orders.tripDropId` — Phase 5
   lets one OBD's invoices sit on two trips, and then the bill appears in both trips' members and both "left" counts.
6. **The waiting bucket follows `bucketFor`, not the queue:** a `pending_picking` bill whose `dispatchStatus` is null (not
   hold) counts as waiting in the ring but has no card (the queue requires `'dispatch'`). The centre number stays right
   because it is computed from the board's rows.
7. **`dropSeq` can have gaps** (FLOOR_TRIPS §7), so "Stop 5" can appear on a trip with 3 stops. It is the stop's sequence
   number, not a position.
8. **The trips feed is not cheap:** it reuses `getTripsForDate` (litres, kg, re-delivery loads, labels — about a dozen
   statements) plus its own five reads. That is why it only runs while the Trips view is on screen. Do not move it onto
   first paint or the 15 s path unconditionally.

---

## 11. Stale facts found — for consolidation to fix

| Fact (live) | Stale line(s) |
|---|---|
| The pick visibility gate is **ON** in production (`app_settings` `picking.visibilityGate` `isEnabled = true`, updated 2026-10-13 17:17:40 UTC — read-only SELECT in the discovery) | `CLAUDE_FLOOR_TRIPS.md:474` ("Live 2026-09-18: the switch is OFF … every Show press is refused"), `:653` (§17 "Desk control OFF"), §3.4 live note; `CLAUDE_PICKING.md:464` ("Live 2026-09-18: the gate is OFF (Q04)") |
| The Picking live feed is **ON** (`live.feed` and `live.feed.picking` true since 2026-10-01) | `CLAUDE_PICKING.md:1337` (§10 heading "behind `live.feed.picking` (OFF)"), `:1346` ("Marker path (switch OFF — today)") |
| With the gate ON, a waiting bill on **no trip** is hidden too (since 2026-09-21, `lib/picking/visibility-gate.ts` header and `waitingBranchWhere`); the count returns `{ bills, trucks, unplanned }` | `CLAUDE_FLOOR_TRIPS.md:437` ("only when it is on **no trip**, or on a trip that has been shown"), `:445` (predicate "`tripDropId IS NULL OR tripDrop.trip.shownAt IS NOT NULL`" — now invoice-row based, `ON_SHOWN_TRIP_WHERE`, and no NULL arm), `:446` ("returns `{ bills, trucks }`"); `CLAUDE_PICKING.md` §5.2 held-back bullet (band described as "N trucks with the planner · M bills" only; it also shows "N not planned yet") and §10.1 (`heldBack` / `heldBackTrucks` only — `heldBackUnplanned` is on the payload too) |
| `CLAUDE_FLOOR_TRIPS.md` §17 item 10 ("trip-only writes are invisible to the Floor marker") | Still true for Floor's marker; for Picking see landmine 3 above (the feed path does see them) |

---

## 12. Key files

| Path | Role |
|---|---|
| `app/api/picking/trips/route.ts` | GET, `picking` canView, no params |
| `lib/picking/trips-view.ts` | `getPickingTrips` / `buildPickingTrips`: desk filter, members, counts, routes, not-on-a-trip count |
| `lib/picking/types.ts` | `PickingTripCounts`, `PickingTrip`, `PickingTripsResult` (end of file) |
| `components/picking/assign-trips.tsx` | `TripRow`, `TripRing` (the §62.4 reversal comment), `tripCentre`, `NotOnTripCard`, `TripHeader`, `TripBandHeading`, `TRIP_SEGMENT`, `tripTypeLabel` — presentational only |
| `components/picking/picking-board-mobile.tsx` | `assignView`, `tripTypeFilter`, `openTripId`, `openTrip` / `closeTrip`, `tripMembers`, `tripBand`, `leftByTrip`, `visibleTrips`, the trip-scoped `selectedRows`, the `trip` `DetailListKey`, `onPop` branches, `PickingCard.stopNumber`, the detail trip line |
| `components/picking/picking-mobile-shell.tsx` | `trips` / `tripsFailed` / `setTripsActive` / `refetchTrips`; refresh hooks in `refetchQueue`, `flush`, the push handler |
| `lib/trips/queries.ts` (`getTripsForDate`, `getPlaceholderRouteNames`, `parseTripDate`), `lib/trips/live-trips.ts`, `lib/trips/route-label.ts`, `lib/order-invoices/trip-read.ts`, `lib/picking/visibility-gate.ts` | Reused, not changed |
| `scripts/_smoke-picking-trips.ts` | Read-only smoke: live pass + simulated gate-OFF pass, reconciles every trip with Floor's summary |
| `docs/mockups/picking/assign-trips-view.html` | Approved design v7 |

---

## 13. Open items

1. **Untested on live data:** in the 2026-10-13 smoke run, `lockedUpcoming`, `tinting`, `picking`, `needsCheck` and `held`
   were 0 on every trip, so those buckets, the 🔒 and TINT centres, and the "on hold" legend were verified only as 0 = 0.
   Watch them on the phone when a trip carries upcoming, tint or held bills.
2. **Gate ON with nothing shown:** on 2026-10-13 all 43 desk trips were unshown, so the supervisor's Trips view read "No
   trips shown to floor yet" until the planner pressed Show. Expected behaviour, but worth telling the floor.
3. **Picker access by URL** (§3.1): decide whether `/api/picking/trips` should require `picking` canEdit or a supervisor role.
4. **Hand bills on no trip with the gate ON** are counted nowhere (§3.6) — existing behaviour of `countHeldBackWaiting`,
   now visible on the "Not on a trip" card.
5. **Two places say "not planned yet"** on the trip list: the held-back band and the "Not on a trip" card. Same number, by
   construction. The owner may want one of them gone.
6. **Hardware back from the other sheets** (route filter, Done picker filter, cancel from list) is still the standing
   ROADMAP item; only the two sheets that can float over the trip screen got a branch.
7. **Pre-existing, found while reading:** `SupervisorPickingShell` sets the tab with `key as "assign" | "picking" | "done"`
   (`picking-mobile-shell.tsx`, `onTabChange`) — a cast, against PICKING §5.1's "narrow, never cast" rule that the picker
   shell follows. Not introduced by this work.
8. **Docs owed at consolidation:** PICKING §5.7 (new), §5.3, §10, §4, §8; UI §62.4 reversal note; FLOOR_TRIPS §1 row;
   ROADMAP back-nav item can note the trip level is now history-tracked (unlike the picker and tint level 2s).
