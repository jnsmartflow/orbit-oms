# Code discovery — Trip re-delivery (2026-10-03)

**Status:** DISCOVERY ONLY. No code, SQL, schema or canon file was changed. Not committed.
**Code at:** `fa6e5c8d` (HEAD on `main`, working tree with uncommitted canon edits).
**Rule applied:** where canon and code disagree, the code wins — every disagreement is recorded in §3.

**Canon read:** `CLAUDE.md` (router v1.14), `CLAUDE_FLOOR_TRIPS.md` v1.1, `CLAUDE_FLOOR.md` v1.9,
`CLAUDE_BILLING.md` v1.0, `CLAUDE_TRIP_REPORT.md` v1.3 — in full. `CLAUDE_CORE.md` v123 (Schema v27.51):
§1–§9, §7.1–§7.4, §7.11, §7.12, §7.16 and the v27.25–v27.51 chain in full; §7.5–§7.10, §7.13–§7.15,
§7.17–§7.19, §10–§15 by heading only. `CLAUDE_UI.md` v5.36: §1–§11 in full, the rest by heading.
`CLAUDE_PICKING.md` and `CLAUDE_CI.md` (v1.4): **searched by topic (trip, gate, returned_to_floor,
workflowStage), not read end to end** — answers in those areas rest on the code, cited below.

Confidence: **High** = read the call site and its caller. **Medium** = read the code, but the live
data could change the answer (a SELECT in §5 settles it). **Low** = inferred.

---

## 1. Answers

### A. Finding the bill

**A1. The OBD and invoice columns.** — High (schema), Medium (fan-out counts)

| Column | Type | Null | Unique | Evidence |
|---|---|---|---|---|
| `orders.obdNumber` | `String` (text) | NOT NULL | **UNIQUE** (`orders_obdNumber_key`) | `prisma/schema.prisma:1045` |
| `orders.invoiceNo` | `String?` (text) | nullable | not unique; plain index `orders_invoiceNo_idx` | `schema.prisma:1072`, `:1267` |
| `orders.invoiceDate` | `DateTime?` | nullable | — | `schema.prisma:1074` |
| `orders.soNumber` | `String?` | nullable | not unique; live index `idx_orders_sonumber` (not modelled) | `schema.prisma:1073`; CORE §7.12 drift note |

- **One OBD = exactly one `orders` row**, ever. The unique has no `isRemoved` carve-out, so a
  soft-removed row still holds its OBD number (CORE §3 soft-delete rule; `schema.prisma:1136`).
  A lookup must filter `isRemoved: false` and treat "found but removed" as not found.
- **One invoice can cover more than one OBD.** `lib/ci/queries.ts:126-128`: *"11 live invoice numbers
  map to TWO OBDs each — a split bill fanning out, always sharing one soNumber."* So invoice lookup
  must return a LIST and let the planner pick (CI's own rule: never `findFirst`).
- **Tint children are not `orders` rows.** Splits live in `order_splits` / `split_line_items`
  (CORE §7.3). A redelivery is per `orders.id`; tint splits do not multiply rows.
- **Invoice shape:** every live invoice is `I` + 9 digits (`lib/ci/queries.ts:77-80`; restated at
  `app/api/floor/trips/lookup/route.ts:25-28`). OBD is 10 digits. The two cannot collide.
- `invoiceNo` arrives AFTER dispatch from SAP; 44% of orders had no `invoiceDate` on 2026-09-01
  (`lib/ci/queries.ts:145-150`). A bill that has left may still have no invoice number → OBD search
  is the only way to find it.

**A2. Existing lookups — reuse, do not duplicate.** — High

| What | Where | Fit for re-delivery |
|---|---|---|
| **`GET /api/floor/trips/lookup?q=`** — "which trip is this bill on, any day". Whole OBD / SO / invoice (`I…`, bare 9 digits, `1`-for-`I` misread), `isRemoved:false`, hide rules applied, follows `tripDropId → trip_drops → trips`, skips cancelled trips, returns `onLiveDesk` | `app/api/floor/trips/lookup/route.ts:43-129`; client gate `lookupTermOf` `lib/floor/search.ts:164-167`; called from `floor-page.tsx` `commitSearch` | **Closest existing piece.** Same normalisation, same gate (`floor` canView), same follow-the-pointer. But it only returns bills WITH a `tripDropId` (`:68`), so it cannot find a bill that went out before Orbit trips. ⚠ Not in canon — `CLAUDE_FLOOR_TRIPS.md §10` lists 9 route files; there are 10 (§3 below) |
| `searchCiBills(rawQuery)` + `normaliseCiSearchTerm` | `lib/ci/queries.ts:96-100`, `:162-240` | Matches `invoiceNo` OR `obdNumber`, list result, adds last-4-digit invoice suffix. **Fenced to 31 days on `orderDateTime`** (`:72`, `:169-182`) — a redelivery is usually days, so the fence may fit, but it is CI's product rule, not ours |
| `parseSearch` / `tokenMatchesObd` / `tokenMatchesInvoice` / `lookupTermOf` | `lib/floor/search.ts:30-167` | Client-side matching over loaded rows only — not a server lookup |
| Freight Trips search | `lib/freight-trips/*` | Over the held pool only — not relevant |

Recommendation for the build (not decided here): extract the normalise-and-match block of
`lookup/route.ts:51-77` into a small `lib/trips/find-bill.ts` that both the lookup route and the
new redelivery route call. Today that logic is inline in the route.

**A3. What marks a bill as "already gone out".** — High (code), Medium (live reliability)

| Candidate | What it actually means in code | Writer today | Trust |
|---|---|---|---|
| `orders.workflowStage = 'dispatched'` | goods gone | **No reachable in-repo writer since 2026-09-15.** Only `markBillsDispatched` (`lib/floor/dispatch.ts:129`, `:178`), imported only by `app/api/floor/trips/[id]/dispatch/route.ts:5,139`, which has no client caller (FLOOR_TRIPS §14 — re-verified by grep this session: no other `workflowStage: DISPATCHED` write in `app/ lib/ components/ scripts/ sql/ db/`). 7,330 rows on 2026-09-18 came from hand SQL / outside the repo | **Low as a gate** — a bill that really left is usually still at `pick_checked` |
| `orders.workflowStage = 'pick_checked'` | the floor finished it | picking approve | Necessary, not sufficient — checked bills can sit at the depot |
| `orders.invoicedAt` | billing marked it invoiced (Picking tab) | `mark-done` (`CLAUDE_BILLING.md §6`) | Medium — an office act, not a truck leaving |
| `orders.invoiceNo` set | SAP invoiced it | import | Medium — SAP invoices around dispatch, not at it |
| `trips.billingCopiedAt` on the bill's trip | billing copied the trip's invoices into SAP to print | `copyTripInvoices` `lib/billing/print.ts:381-450` | Medium-high that the paperwork left |
| `orders.dispatchStatus = 'dispatch'` | a **decision**, not an event (FLOOR_TRIPS §15 item 12) | many | **None** — never use it |
| bill on a trip with `trips.status = 'dispatched'` | trip closed | unreachable (no caller) | **None today** |
| `trip_report` row with `deliveryNo = obdNumber` | NTS mirror says it went on an NTS truck | external puller | **High for NTS loads**, but NTS-only (transporter Nagadhiraj, FRT excluded — TRIP_REPORT §2) |

**Finding:** there is no single trustworthy "gone out" column today. The most defensible gate is a
composite: *on a trip dated before today (or an NTS row) AND at `pick_checked`/`dispatched` AND not
removed/cancelled* — and the planner confirms. Whether to hard-require any of these is an owner
decision (§4). The redelivery route must not *write* any of them (FLOOR_TRIPS §13).

**A4. Bills from before Orbit trips (`tripDropId` null) and the NTS mirror.** — High (schema), Medium (coverage)

- `trip_report.deliveryNo` **is the OBD number** — the 2026-09-11 backfill joins
  `trip_report t ON t."deliveryNo" = o."obdNumber"` (`scripts/backfill-nts-trips-2026-09-11.ts:164-186`).
  Columns available: `tripNo`, `disDate`, `vehicleNo`, `driverName`, `driverMobile`
  (`schema.prisma:2630-2675`).
- **No invoice number** in `trip_report` (`modiInv` is the INV/FRT mode the puller filters on, and
  `promoType` is INV/PROMO — TRIP_REPORT §2, §4). Invoice → OBD must go through `orders` first.
- **History is kept**: the mirror deletes only rows absent from the batch *for the dates in the
  batch*, so past days stay (6,779 rows over 53 days on 2026-09-08, TRIP_REPORT §2.1).
- ⚠ **NTS can already hold a re-delivery**: the unique is `(deliveryNo, disDate)`
  (`schema.prisma:2671`), so the same OBD on two dispatch dates is two rows. Showing "previous NTS
  trip" should take the LATEST `disDate`, and the attempt count could count NTS rows too (§4).
- Read-only. Never write `trip_report` (FLOOR_TRIPS §15 item 1). No Prisma relation exists between
  `orders` and `trip_report`; a read is a separate `findMany` on `deliveryNo`.
- Some pre-Orbit bills DO have a `tripDropId`: the one-time backfill made Orbit trips for NTS-shipped
  bills (FLOOR_TRIPS §2). So "`tripDropId` null" does not mean "never on a truck".

### B. Fitting into the trip

**A5 → B5. `getTripDetail` / `getTripsForDate` shape, and where redeliveries go.** — High

- `getTripsForDate(tripDate, todayDate, onlyIds?)` → `TripSummary[]` (`lib/trips/queries.ts:806-878`).
  `getTripDetail(tripId)` → `TripDetail | null` = `TripSummary` + `drops: TripDropSummary[]` +
  `activity` (`:892-964`; types `:84-227`).
- **Every count comes from `loadTripBills(dropIds)`**, which reads `orders WHERE tripDropId IN (…)
  AND isRemoved=false` (`:360-377`). `counts`, `isReady` (`:754-757`), `bucketFor` (`:270-294`),
  `dispatchedCount`, litres/kg, and `deliveryTypes` / the mix chip (`:710-719`) are all built from
  that read only.
- **So a separate `trip_redeliveries` table changes none of them** — the redelivered bill's
  `tripDropId` still points at trip 1, and trip 2's `loadTripBills` never sees it. Confirmed
  naturally excluded: counts, `isReady`, `bucketFor`, `deliveryTypes`, mix chip, litres, kg.
- ⚠ **Two things it DOES change, through the drop row:**
  1. `dropCount` = number of `trip_drops` rows (`:854-858`, `:953`) — a stop created only for a
     redelivery is counted as a stop. Probably right, but decide it.
  2. Area/route labels skip stops with `hasBills: false` (`:855-865`, `:604-641`) — a
     redelivery-only stop does not name the trip's area/route.
- **Where to add them:** a new field on `TripDropSummary` (e.g. `redeliveries: […]`) filled by one
  more batched read in `getTripDetail` keyed on `tripDropId IN (…)`, plus a per-trip count on
  `TripSummary` from one batched read in `getTripsForDate` (so the rail card can say "+1 re-del").
  Keep it a **separate figure beside `counts`, not a bucket** — the same reasoning the file already
  gives for `dispatchedCount` (`:147-167`).
- ⚠ The **rows** under a stop do NOT come from `getTripDetail`: `trip-desk.tsx:940-988` maps
  `d.orderIds` onto the **board payload** (`unfilteredRows`). A redelivered bill is not in the board
  payload (see B7/C11), so the redelivery block must render from data carried on `TripDetail`
  itself, not from `FloorBoardRow`s.

**B6. Reusing the drop key and stop find-or-create.** — High

- `computeDropKey`, `effectiveCustomerId`, `dropShipToCode` are pure exports in
  `lib/trips/drop-key.ts:61-103` — **reusable as-is**.
- **Find-or-create the stop is INLINE in the route**, `app/api/floor/trips/[id]/bills/route.ts:221-287`:
  `findFirst({tripId, dropKey})`, `MAX(dropSeq)+1`, customer snapshot read
  (`delivery_point_master` with area + primaryRoute), `dealerDisplayName(...)` fallback, `create`.
  To reuse it without copying, extract `findOrCreateTripDrop(tripId, order)` into `lib/trips/`
  (input: the `DropKeyInput` fields + `shipToCustomerName`) and have both routes call it.
- ⚠ The inline block itself re-spells `order.shipToOverrideCustomerId ?? order.customerId` at
  `:247` — the exact thing FLOOR_TRIPS §15 item 6 says never to inline. The extraction should call
  `effectiveCustomerId()` and fix that in passing.
- Race backstop: the unique `trip_drops_trip_key_key (tripId, dropKey)` (CORE §7.16). The current
  code does not retry on P2002 (a second planner adding the same shop at once gets a per-bill
  `failed`). An extracted helper should keep that behaviour or re-read once.

**B7. The carry rule — would an open-redelivery-only trip drop off today's desk?** — High: **YES, it would.**

`tripsOnDeskWhere` (`lib/trips/live-trips.ts:115-123`):
```ts
if (deskDate.getTime() < todayDate.getTime()) return { tripDate: deskDate };
return { OR: [
  { tripDate: deskDate },
  { tripDate: { lt: deskDate }, drops: { some: { orders: { some: BILL_NOT_DONE } } } },
]};
```
with `BILL_NOT_DONE = { isRemoved:false, workflowStage:{ notIn:[pick_checked, dispatched, cancelled] },
dispatchStatus not 'hold' }` (`:60`, `:68-72`).

- A trip dated today shows regardless (arm 1).
- A trip from an earlier day is carried only through `drops → orders`. A redelivery row is neither,
  and the redelivered bill is (a) not on this trip's drops and (b) usually `pick_checked` or
  `dispatched` anyway. **So a re-delivery trip built yesterday with only open redeliveries leaves
  the desk at IST midnight**, and also stops being `onLiveDesk` in the lookup route (`lookup/route.ts:120-122`).
- Fix needed (build step, not done): a third arm in `tripsOnDeskWhere`, e.g.
  `{ tripDate: { lt: deskDate }, redeliveries: { some: { status: 'planned' } } }`. Because
  `liveTripsOnDeskWhere` (`:150-152`) → `floorTripBillsWhere` (`lib/floor/queries.ts:328-337`) →
  `floorBoardWhere` → the marker all derive from it, the edit lands in one place — but it adds an
  EXISTS to a predicate that runs in the 15 s marker; re-take the EXPLAIN (live-trips.ts:110-113).

**B8. Cancel route vs redeliveries.** — High

- The dispatched-refusal (`app/api/floor/trips/[id]/cancel/route.ts:145-162`) counts **orders**
  `WHERE tripDropId IN (this trip's drops) AND workflowStage='dispatched'`. A redelivered bill's
  `tripDropId` points at trip 1, so: **it neither blocks trip 2's cancel, nor is touched by it.**
- ⚠ **But it can wrongly block trip 1.** If a redelivered bill is (ever) at `dispatched`, trip 1
  already refuses cancel because of it — unchanged behaviour, not new.
- Cancel detaches bills (`:221-232`) and **keeps the drop rows** (FLOOR_TRIPS §7). It never reads
  redeliveries, so open redeliveries would survive on a cancelled trip as `planned` forever, under a
  trip the rail hides (`trip-rail.tsx:159`) and the board arm excludes (`liveTripsOnDeskWhere`).
- **Cancel must** (build): set every `planned` redelivery on the trip to `cancelled` (stamp
  closedAt/ById), include their OBDs in the `cancelled` activity row (written before the loop,
  `:200-211`), and decide whether a trip with an already-CLOSED redelivery (delivered/returned) may
  still be cancelled — the analogue of the dispatched refusal.

**B9. The remove-bill path must never see a redelivery.** — High

- `bills/route.ts` remove (`:142-173`) writes `orders.update({ tripDropId: null })` on **whatever
  stop the bill is on** — it does not check the trip in the URL (FLOOR_TRIPS §15 item 8). Called
  with a redelivered bill's `orderId` from trip 2, it would **wipe the bill's link to trip 1**.
- The client caller groups the selection by the ROW's own `tripNumber` (`floor-page.tsx:1097-1124`)
  — and a `FloorBoardRow`'s `tripNumber` is the bill's FIRST trip. If redelivery rows were ever
  rendered as selectable `FloorTable` rows, "Remove from trip" would post to trip 1 and detach the
  bill from it. **Redelivery rows must be non-selectable and must never carry an `orderId` into the
  shared selection.**
- 🔴 **Second landmine on the same path:** after a remove, the stop is deleted when
  `orders.count({tripDropId: dropId}) === 0` (`:169-172`). A stop holding a normal bill AND a
  redelivery loses its last normal bill → the drop is deleted. With `trip_redeliveries.tripDropId`
  as `ON DELETE RESTRICT` the delete throws *after* the `orders.update` succeeded (the bill lands in
  both `changed` and `failed`); with `CASCADE` the redelivery silently vanishes; with `SET NULL` it
  loses its stop. The emptiness count must include open redeliveries (build edit to this route).

### C. Side effects elsewhere

**C10. Billing — Send to billing and the Print tab.** — High

- `loadPrintTrips` reads bills **only** via `orders WHERE tripDropId IN (drops) AND isRemoved=false`
  (`lib/billing/print.ts:144-165`). `setTripSentToBilling` takes its counts from it
  (`lib/trips/billing.ts:57-60`). `getPrintWorkTripIds` (`:293-323`) and `getPrintMarkerLatest`
  (`:355-369`) join `orders o ON o."tripDropId" = d.id`. → **A separate table is naturally excluded
  everywhere on the Print path.** Nothing must filter it out.
- Consequence to decide: a trip holding ONLY redeliveries has `bills = 0`, so **Send to billing is
  refused** — "has no bills to send to billing" (`lib/trips/billing.ts:74-76`), and the header
  greys the button (`trip-detail-header.tsx:180-181`, `isEmpty = bar.total === 0` at `:133`).
  Probably correct (no new invoice), but it is a visible behaviour.
- Side note, no change needed: `getPrintMarkerLatest` takes `MAX(trips.updatedAt)` over every trip;
  a redelivery write that does not touch the `trips` row does not move it.
- ⚠ **Also excluded, maybe unwantedly:** the **Trip Detail report** (`lib/reports/trip-detail-data.ts`,
  read by `app/api/reports/trip-detail/route.ts`) — "one row per bill loaded on a Floor trip", via
  `tripDropId`. A re-delivery will not appear on that sheet unless it is taught to.

**C11. Floor board predicate, the marker, and the live feed.** — High (code), Medium (switch state)

- `floorBoardWhere` (`lib/floor/queries.ts:488-504`) = OR of `floorLiveBaseWhere` (`:434`),
  `floorUnslottedWhere` (`:173`), `floorCarriedPoolWhere` (`:211`, needs `tripDropId IS NULL`),
  `floorTripBillsWhere` (`:328-337`, `dispatchStatus='dispatch'` + `tripDrop.trip` on the live desk).
  All four key on `orders`. A redelivery writes no order row, so **the redelivered bill shows on the
  board only if it already matches an arm for its own reasons** (e.g. trip 1 is still on today's
  desk, or it is at an open stage). It never appears under trip 2 from the board payload.
- Marker (`app/api/floor/marker/route.ts:33-56`): `orders.aggregate` over the same predicate +
  pick-delete decisions clock. **A redelivery write is invisible to it** (FLOOR_TRIPS §17 item 10).
- 🔴 **Canon gap: Floor now has a LIVE CHANGE FEED** behind `app_settings 'live.feed'`
  (`floor-page.tsx:65-68`, `:507`, `topics: "order,trip,config"` at `:535`; `GET /api/floor/trips?ids=`
  `app/api/floor/trips/route.ts:95-118`). It is fed by statement-level triggers on `trips`,
  `trip_drops` and `trip_activity` publishing `entity='trip'` (`sql/2026-09-30-live-changes-step4.sql:19-20`,
  CORE v27.46). **A new `trip_redeliveries` table needs its own three
  `trg_live_changes_trip_redeliveries_{ins,upd,del}` triggers** on the generic
  `live_changes_child_*()` with `('trip','parent','tripId')`, or other desks will not see a
  redelivery while the feed is on. (The `trip_activity` row each action writes does publish, so a
  desk would refresh anyway — but only if the activity insert succeeds; `writeActivity` swallows
  failures, `lib/trips/activity.ts:149-172`.) Whether `live.feed` is ON live is a SELECT (§5).
- The Picking supervisor shell also subscribes to `order,trip,config`
  (`components/picking/picking-mobile-shell.tsx:729`) — a trip line makes it re-sync trip ids;
  harmless (it reads orders via `tripDropId`), just traffic.

**C12. Picking.** — High

- The queue (`buildPickingWhere`, `lib/picking/queue.ts:354-495`), the gate
  (`waitingBranchWhere`, `lib/picking/visibility-gate.ts:100-108`), `countHeldBackWaiting` and the
  picking marker all read `orders` and reach trips only through `orders.tripDropId → trip.shownAt`.
  **Nothing would see a redelivery row.** A redelivered bill at `pick_checked`/`dispatched` is not
  in any picking stage arm except "checked today" (`:465-468`).
- **Re-picking a returned bill — what exists, nothing decided:** there is no path that takes a bill
  from `pick_checked`/`dispatched` back to picking. `FLOOR_RELEASABLE_STAGES` is
  `pending_support`/`pending_picking` only (CLAUDE_FLOOR §4.2) and must not gain picked stages.
  `returnAssignedBillToQueue` (`lib/picking/unassign.ts:43`) handles `pick_assigned` only. A
  "Came back" bill whose goods need re-picking has no Orbit move today.

**C13. CI (Goods Return Note) linkage.** — High (code), report only

- `ci_returns.orderId` → `orders` (named `CiReturnOrder`, Restrict; `schema.prisma:1118-1123`):
  *"a CI never changes the order's workflowStage … the FK is a stored link only."* No CI table
  references `trips` or `trip_drops`.
- Four `source` values live: `manual`, `auto_finding`, `auto_bill_only`, `floor` (CORE v27.40).
- **The Floor CI route refuses exactly the bills a redelivery is about**: `offFloorRefusal` returns
  "Already dispatched" for `workflowStage='dispatched'` and refuses a bill on a trip
  (`lib/floor/off-floor.ts:84-87`), called by `raiseFullBillCi` (`app/api/floor/ci/route.ts:9-60`).
  It also CANCELS the bill (`workflowStage='cancelled'`) — not something a "came back" close should
  do implicitly.
- The supervisor `/ci` path (manual) has no such refusal and is the natural place a "Came back"
  redelivery could later link (e.g. `trip_redeliveries.ciReturnId`, or `ci_returns` gaining a
  source). Nothing to build now.
- `returned_to_floor` is allowed by `chk_ci_returns_status` and written by nothing (CLAUDE_CI §2).

**C14. `trip_activity` actions — what an ALTER must touch.** — High

1. **SQL (live CHECK).** The current text was last written by `sql/2026-09-15-slice9-print-tab.sql:77-86`
   using the fence-never-down pattern: `ADD CONSTRAINT chk_trip_activity_action_v2 CHECK (action IN
   (… 14 values …))` → `DROP CONSTRAINT chk_trip_activity_action` → `RENAME … _v2 TO
   chk_trip_activity_action`, then a read-back `SELECT … FROM pg_constraint` (`:89-92`). Same
   pattern in `sql/2026-09-15-slice8-show-per-trip.sql:65-78` and `-trip-number-reuse.sql:98-110`;
   origin `db/slice-2-trip-activity.sql:49-52`. A new file adds `redelivery_added`,
   `redelivery_removed`, `redelivery_closed` (17 values). **Run the SQL before deploying code**
   (`activity.ts` header: a CHECK refusal is swallowed and logged, so the history silently loses rows).
2. **TypeScript twin:** three new `export const` beside `:46-110` and three entries in
   `TRIP_ACTIONS` (`lib/trips/activity.ts:113-128`), plus one `log…` writer each (house pattern
   `:189-636`).
3. **Schema comment:** the `trip_activity` header lists the CHECK and is already stale (shows 11
   values, `schema.prisma:3843-3848`) — update it in the same pass.
4. **UI:** `components/floor/trip-history.tsx:42-43` colours dots from a `DOT` map with a grey
   fallback — a new action renders without a code change, but gets no colour of its own.
5. **Canon:** `CLAUDE_FLOOR_TRIPS.md §3.3` and §9 (14 → 17), `CLAUDE_CORE.md §7.16` CHECK text.

**C15. Permissions.** — High

- Every trip write route gates `checkAnyPermission(roles, "floor", "canEdit")`: bills `:59`, cancel
  `:74`, show `:45`, billing `:33`, confirm `:61`, dispatch `:73`, PATCH `[id]/route.ts:127`, create
  and list `route.ts:75` (and `:134`), options `:46`. Reads: `[id]` GET and `lookup` are `canView`.
- New routes: **add / remove / close redelivery → `floor` canEdit**; a redelivery *search* (read)
  → `floor` canView, matching `lookup`. `ActionKey` is only
  `canView | canImport | canExport | canEdit | canDelete` (`lib/permissions.ts:415-420`); none is
  more specific. No new page key is needed unless the owner wants a separate tick for closing.

### D. UI placement

**D16. Where the button and the RE-DEL tag fit.** — High (components), no mockup

- **Button:** `components/floor/trip-detail-header.tsx`, **row 6** (the stops bar, `:400-428`),
  beside `+ Add bills` (`:422-427`), same `BUTTON` class (`:57-58`), same `canWrite && !adding`
  guard (`:135`). Row 1 is reserved for Send to billing / Show to floor / `···` and the file says
  `···` holds only take-backs and Cancel (`:26-28`) — so not there.
- **Search/confirm step:** a small dialog or an inline band like `trip-add-band.tsx`; Floor owns
  the single window Esc listener (`floor-page.tsx`, CLAUDE_FLOOR §4.6) — never add a second one.
- **Rows:** in `components/floor/trip-desk.tsx` `renderTripPanel` (`:910-1051`), under each stop
  header (`:1000-1011`), as a **separate block after the stop's `FloorTable`** (`:1016-1027`),
  rendered from `TripDetail` data — not `FloorTable` rows, no tick box (B9). The stop header's
  "N bills · L" line counts orders only; decide whether it adds "· 1 re-del".
- **Tag:** pattern = the trip-number chip in `floor-table.tsx:953-962` (`rounded-[3px] … font-mono
  text-[9.5px] font-semibold`) and `HandBadge` (`components/shared/hand-badge.tsx:15`, used at
  `floor-table.tsx:1068-1074`). ⚠ **Colour:** `CLAUDE_UI.md §2.1` — *"After brown, no `data.*` colour
  is free — the next category needs a new token."* RE-DEL must use `warn`/`ink` or get a new token;
  not red (red = error/destructive, §1), not `data.*`.
- **Empty states that will misfire** on a re-delivery-only trip: header `isEmpty` → "No bills yet"
  and Send to billing greyed (`trip-detail-header.tsx:133`, `:180`, `:408-409`); a stop with only
  redeliveries prints "0 bills are on this stop, not in this view." (`trip-desk.tsx:1028-1039`);
  `drops.length === 0` → "No bills on this trip yet" (`:973-980`) is not hit because the drop exists.
- **Rail card:** `components/floor/trip-rail.tsx` — needs a count from `TripSummary` to show the
  trip is not empty.

---

## 2. Model holds / model needs change

| Proposed | Verdict | Why (evidence) |
|---|---|---|
| New table `trip_redeliveries` | **Holds** | A separate table keeps every `orders`-keyed reader blind to it: counts, isReady, Print, picking, board (A5, C10–C12) |
| `tripId` + `tripDropId` | **Holds, with conditions** | Reuse the drop key (B6). But the remove path deletes a drop when it holds no **orders** (`bills/route.ts:169-172`) — must also count open redeliveries. FK on `tripDropId` should be **RESTRICT** (a stop deleted under a redelivery must fail loudly, not cascade). Consider making `tripDropId` the stop and deriving `tripId` from it, or keep both and CHECK nothing (two pointers can disagree — the reason `orders` has no `tripId`, `schema.prisma:1200-1206`). Decide |
| `orderId`, `obdNumber` + `invoiceNo` snapshots | **Holds** | Matches the house shape for records of what a human saw (`pick_findings` denormalised copies, CORE §7.4). `invoiceNo` snapshot may be NULL at add time (A1); read the live value on display, like CI does |
| `previousTripId` nullable | **Needs change in meaning** | For attempt 2, previous = the bill's own `tripDropId → trip` (or NTS). For attempt 3+, previous = the last *redelivery's* trip, not `orders.tripDropId`. Also NTS trips have no Orbit id → add nullable `previousNtsTripNo` + `previousNtsDate` snapshots, or a single `previousLabel` text |
| `attemptNo` | **Needs a rule + a guard** | Compute as 1 + (prior non-cancelled redeliveries) [+ NTS rows if counted]. Two planners can race → add a partial unique `(orderId) WHERE status = 'planned'` (one open redelivery per bill) and, if attempt numbers must be unique, `(orderId, attemptNo) WHERE status <> 'cancelled'`. Both partial → not `@@unique` in Prisma (CORE §7.16 class) |
| `reason` + `note` | Holds | Decide whether `reason` is a master table (like `ci_reason_master`) or a fixed CHECK list |
| status `planned/delivered/returned/cancelled` | **Holds; add a CHECK + a vocabulary constant** | Plain String + CHECK, one exported constant (CORE §3 status-string rule). Add a completeness CHECK like `chk_trips_cancelled_complete`: closed statuses need `closedAt`+`closedById` |
| `orders.tripDropId` NOT moved | **Holds — and is load-bearing** | Moving it would be the bills-route add path, which refuses a bill already on another trip (`bills/route.ts:179-201`), and would drop it off trip 1's history/print |
| `workflowStage` NOT changed | **Holds** | FLOOR_TRIPS §13. Note: a "Came back" close therefore leaves the bill at `pick_checked`/`dispatched` — no screen will treat it as back in the depot (C12) |
| Excluded from Send to billing / Print | **Holds by construction** | C10. Side effect: a redelivery-only trip cannot be sent (bills = 0) |
| 3 new `trip_activity` actions | **Holds** | C14 |
| *(missing)* desk carry | **Needs adding** | B7 — a third arm in `tripsOnDeskWhere` or redelivery-only trips vanish at midnight |
| *(missing)* cancel handling | **Needs adding** | B8 — close open redeliveries on cancel |
| *(missing)* live-feed triggers | **Needs adding** | C11 — `trg_live_changes_trip_redeliveries_*` |
| *(missing)* Hand trips | **Needs a rule** | `trips.isHand` (v27.41): bills route refuses Hand↔truck mismatch (`bills/route.ts:204-219`). Same rule for redeliveries? |

---

## 3. Risks and landmines

1. 🔴 **Remove path wipes trip 1's link** if a redelivery's `orderId` reaches `POST …/bills
   {action:"remove"}` — the route does not check the trip in the URL (`bills/route.ts:142-156`) and
   the client groups by the row's own (first) `tripNumber` (`floor-page.tsx:1105-1124`). Never
   render redeliveries as selectable rows.
2. 🔴 **Empty-stop delete** (`bills/route.ts:169-172`) ignores redeliveries — FK fail or silent loss
   depending on the delete rule (B9).
3. 🔴 **Midnight drop-off** of redelivery-only carried trips (B7).
4. **Cancel leaves open redeliveries orphaned** on a hidden trip (B8).
5. **"Gone out" has no trustworthy column** (A3). A hard gate on `dispatched` would refuse most real
   cases; a gate on nothing lets a planner "re-deliver" a bill still in the rack.
6. **Same bill on today's trip 1 and trip 2.** If trip 1 is still on today's desk, the bill shows
   under trip 1 (board rows) AND as a redelivery under trip 2 — two trucks, one bill, on one screen.
   Decide whether a redelivery may be added while trip 1 is on the live desk / not yet billed.
7. **Live feed blind spot** without triggers on the new table (C11).
8. **`writeActivity` swallows errors** (`activity.ts:149-172`): deploying code before the CHECK ALTER
   loses history rows silently.
9. **Partial uniques are invisible to Prisma** — no `findUnique` on them; model as comments.
10. **Re-picking a returned bill** has no Orbit move (C12) — "Came back" is a record only.
11. **Floor CI refuses dispatched / on-trip bills** (`off-floor.ts:84-87`) — a returned redelivery
    cannot be CI'd from the Floor desk; only `/ci` can.

**Canon disagreements found (code wins; for a later canon pass — not edited):**
- `CLAUDE_FLOOR_TRIPS.md §10/§16` say 9 route files under `/api/floor/trips`; there are **10** —
  `lookup/route.ts` (2026-09-29, canView) is missing.
- `CLAUDE_FLOOR_TRIPS.md §3.1` omits `trips.isHand` (v27.41) and `trips.vehicleSize`; §7 omits the
  Hand↔truck refusal in the add path (`bills/route.ts:204-219`).
- `CLAUDE_FLOOR_TRIPS.md §11`: "OFF, every waiting bill appears … ON, appears only when it is on no
  trip, or on a shown trip". Code since 2026-09-21: gate ON shows **only** waiting bills on a
  shown trip; a bill on no trip is hidden (`lib/picking/visibility-gate.ts:88-89`, `:100-108`;
  `queue.ts:418-421`).
- `CLAUDE_FLOOR_TRIPS.md §13/§17 item 10` and `CLAUDE_FLOOR.md §5` describe the marker as the only
  live-sync; the live change feed (7a/7b, `live.feed` switch) is not mentioned in either.
- `schema.prisma:3843-3848` lists 11 CHECK values for `chk_trip_activity_action`; live has 14.
- `lib/trips/queries.ts:17-18` header still lists `loading` in `chk_trips_status`.

---

## 4. Open decisions for Smart Flow (plain English, one line each)

1. What counts as "already gone out" — any bill on an earlier-dated trip, only `pick_checked`/`dispatched`, or anything the planner types?
2. If the bill is still on a trip that is on today's desk, may it be added as a re-delivery?
3. Is the attempt number counted from Orbit re-deliveries only, or does an earlier NTS row for the same OBD count as an attempt?
4. Should a bill be allowed only one open re-delivery at a time?
5. When a trip is cancelled, do its open re-deliveries become "cancelled" automatically?
6. May a trip be cancelled after one of its re-deliveries was closed as Delivered or Came back?
7. Should a trip holding only re-deliveries be sendable to billing (today: refused, no bills)?
8. Does a re-delivery stop count in the trip's "N stops", and should it name the trip's area/route?
9. Should the Trip Detail report list re-deliveries?
10. Reasons: a fixed short list (CHECK) or a master table the depot can edit?
11. Hand trips: allowed to carry a re-delivery, or truck trips only?
12. "Came back": record only, or should it later link to a CI / put the goods back for picking?
13. Who may close a re-delivery — anyone with Floor edit, or a separate tick?
14. Is the live change feed (`live.feed`) on in production? If yes, the new table gets live-feed triggers in the same SQL.

---

## 5. Read-only SELECTs for the next step (NOT run)

Rules: read-only, no BEGIN/COMMIT, every `UNION ALL` value cast to `text`, `"check"` is reserved
(use `chk` as an alias). Run in the Supabase SQL Editor.

```sql
-- Q1 · Current text of the activity CHECK (expect 14 values).
SELECT conname AS chk, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'trip_activity'::regclass AND conname LIKE 'chk_trip_activity_action%';

-- Q2 · Every constraint on trips / trip_drops / trip_activity (incl. isHand, vehicleSize CHECKs).
SELECT conrelid::regclass::text AS tbl, conname AS chk, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid IN ('trips'::regclass, 'trip_drops'::regclass, 'trip_activity'::regclass)
ORDER BY 1, 2;

-- Q3 · The orders → trip_drops FK delete rule (never in a live read before).
SELECT conname AS chk, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'orders'::regclass AND contype = 'f' AND conname ILIKE '%tripDrop%';

-- Q4 · Live-feed switches and the trip triggers.
SELECT "settingKey", "isEnabled", "updatedAt" FROM app_settings ORDER BY "settingKey";
SELECT event_object_table::text AS tbl, trigger_name::text AS trg, action_timing::text AS timing,
       event_manipulation::text AS op
FROM information_schema.triggers
WHERE event_object_table IN ('trips','trip_drops','trip_activity')
ORDER BY 1, 2, 4;

-- Q5 · Invoice fan-out: invoices covering more than one live OBD.
SELECT count(*) AS invoices_multi_obd, max(n) AS max_obds_per_invoice
FROM (SELECT "invoiceNo", count(*) AS n FROM orders
      WHERE "invoiceNo" IS NOT NULL AND "isRemoved" = false
      GROUP BY 1 HAVING count(*) > 1) x;

-- Q6 · Invoice shape check (expect every row I + 9 digits).
SELECT count(*) FILTER (WHERE "invoiceNo" ~ '^I[0-9]{9}$') AS i9,
       count(*) FILTER (WHERE "invoiceNo" !~ '^I[0-9]{9}$') AS other
FROM orders WHERE "invoiceNo" IS NOT NULL;

-- Q7 · "Gone out" signals side by side, for bills on a trip dated before today (IST).
SELECT o."workflowStage" AS stage,
       count(*) AS bills,
       count(*) FILTER (WHERE o."invoiceNo"  IS NOT NULL) AS with_invoice_no,
       count(*) FILTER (WHERE o."invoicedAt" IS NOT NULL) AS marked_invoiced,
       count(*) FILTER (WHERE t."billingCopiedAt" IS NOT NULL) AS trip_copied,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM trip_report r WHERE r."deliveryNo" = o."obdNumber")) AS on_nts
FROM orders o
JOIN trip_drops d ON d.id = o."tripDropId"
JOIN trips t      ON t.id = d."tripId"
WHERE o."isRemoved" = false AND t.status <> 'cancelled'
  AND t."tripDate" < (now() AT TIME ZONE 'Asia/Kolkata')::date
GROUP BY 1 ORDER BY 2 DESC;

-- Q8 · Did anything reach 'dispatched' since the in-repo writer went (2026-09-15 13:54 IST)?
SELECT count(*) AS orders_dispatched_now,
       count(*) FILTER (WHERE "updatedAt" >= '2026-09-15 08:24:00+00') AS touched_since
FROM orders WHERE "workflowStage" = 'dispatched' AND "isRemoved" = false;
SELECT count(*) AS app_logs, min("createdAt")::text AS first_at, max("createdAt")::text AS last_at
FROM order_status_logs WHERE "toStage" = 'dispatched' AND note LIKE 'Dispatched with trip %';

-- Q9 · NTS already records re-deliveries? Same OBD on more than one dispatch date.
SELECT count(*) AS obds_on_2plus_dates, max(n) AS max_dates
FROM (SELECT "deliveryNo", count(DISTINCT "disDate") AS n FROM trip_report
      WHERE "deliveryNo" IS NOT NULL GROUP BY 1 HAVING count(DISTINCT "disDate") > 1) x;

-- Q10 · NTS mirror coverage window.
SELECT min("disDate")::text AS first_day, max("disDate")::text AS last_day, count(*)::text AS rows_total
FROM trip_report;

-- Q11 · Bills that left on NTS but carry no Orbit trip (the previousTripId-null population).
SELECT count(DISTINCT o.id) AS nts_only_bills
FROM orders o JOIN trip_report r ON r."deliveryNo" = o."obdNumber"
WHERE o."tripDropId" IS NULL AND o."isRemoved" = false;

-- Q12 · Trip status mix, Hand trips, and empty drops (stops holding no order).
SELECT status::text AS k, count(*)::text AS n FROM trips GROUP BY status
UNION ALL SELECT 'isHand'::text, count(*)::text FROM trips WHERE "isHand"
UNION ALL SELECT 'empty_drops'::text, count(*)::text FROM trip_drops d
          WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o."tripDropId" = d.id);

-- Q13 · Name collision check for the new table and its likely constraint names.
SELECT table_name::text FROM information_schema.tables
WHERE table_schema = 'public' AND table_name ILIKE '%redeliver%';
```

---

*code-discovery-2026-10-03-trip-redelivery.md · discovery only · not committed*
