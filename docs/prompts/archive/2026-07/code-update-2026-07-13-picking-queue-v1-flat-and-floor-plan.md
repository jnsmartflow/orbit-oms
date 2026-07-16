# Picking Queue V1 — Flat strip + Route filter SHIPPED, Floor workflow plan LOCKED (2026-07-13)

**Supersedes** the load-aware model in `web-update-2026-07-12-picking-queue-v1-design-locked.md`
(the ">= 950 kg = truck ready" sort). That whole approach was deliberately **stripped** this
session. The picking queue is now brain-free by design — prove the human workflow first, add the
load "brain" later.

Commits: `03bfe175` (Step 2a strip + flatten), `3bb20de6` (Step 2b route filter + guard removal).
Both `tsc --noEmit` clean, shipped to `main`. **Live smoke-test still pending** (needs a depot login).

---

## The one principle (V1)

**One flat waiting line, sorted the same for everyone. Route is a view filter, not a sort key.**
No weight, no truck-ready logic, no "serve from the top" guard. The supervisor filters to their
route and assigns freely.

---

## What the queue is now (LOCKED)

### Sort spine (flat, top -> bottom) — `lib/picking/sort.ts` `PICKING_SPINE`
1. `byAssigned`     — assigned rows sink out of the waiting line
2. `byWindow`       — dispatch window sortOrder ascending
3. `byDeliveryType` — Local -> Upcountry -> Cross -> IGT (inert while V1 is Local-only)
4. `byKeyCustomer`  — KEY floats to the TOP, cross-route
5. `byPriority`     — priorityLevel ascending (P1 next)
6. `byFifo`         — NEW rule: `row.obdDateTime` ascending, oldest first, nulls last (universal tie-break)
7. `obdNumber`      — final deterministic fallback (inside `sortPickingQueue()`, not a named rule)

- **NO weight, NO >= 950, NO truck/load logic anywhere in the sort.**
- Route and area are **NOT** sort keys. They stay as **data** on `PickingQueueRow` (the filter needs `route`).

### Signals (confirmed in discovery)
- **KEY** -> `row.isKeyCustomer` (boolean), resolved via `shipToOverrideCustomer ?? customer` ->
  `delivery_point_master.isKeyCustomer`. Set once per row in `queue.ts`.
- **Urgent / P1** -> `row.priorityLevel` (number, schema default 3). "P1" is a UI-only label
  (`isP1 = priorityLevel === 1`).
- **FIFO** -> `row.obdDateTime` = `order.orderDateTime ?? order.obdEmailDate ?? null`. Populated in practice.

### View
- **One continuous numbered list** (1..N), no route-block headers. Route-block rendering
  (`buildRouteBlocks`/`RouteBlock`/`formatBlockTotal` etc.) was deleted.
- **Route filter** (client-derived, single-select dropdown + explicit "All" chip). Options = distinct
  `row.route` values present in the current waiting rows, alphabetical. Filtering narrows the list and
  re-numbers 1..N for what's shown. Resets to "All" on tab change. Pure view filter — no refetch, no
  sort change, does not touch assigned/done rows.

---

## What was removed this session (actually deleted, not commented out)

**Step 2a — load logic strip + flatten:**
- `lib/picking/queue.ts` — the `routeWeightGroups` build + both forEach passes that stamped
  `isReadyRoute`/`routeReadyWeightKg`/`readyRouteEarliestDateTime`, and the `grossWeight` read feeding them.
- `lib/picking/sort.ts` — `byRouteReady` rule + its `PICKING_SPINE` slot.
- `lib/picking/types.ts` — the three carrier fields (`isReadyRoute`, `routeReadyWeightKg`, `readyRouteEarliestDateTime`).
- `components/picking/picking-queue.tsx` — the green "✓ X kg · truck ready" badge, `RouteBlock`,
  `buildRouteBlocks`, `computeRouteTypeCounts`, `blockHeaderLabel`, `formatBlockTotal`, `blockHeaderRight`,
  `toggleBlock`/`onToggleBlock`. Replaced with one flat `unassignedRows.map()` numbering.
- **Added** the `byFifo` rule — discovery found `orderDateTime` was NEVER wired as a general tie-break;
  it only lived inside `byRouteReady`. Stripping the weight rule would have left `obdNumber` as the only
  tie-break, missing the locked target. `byFifo` fixes that.

**Step 2b — route filter + guard removal:**
- No-jump guard removed in BOTH places: UI selection restriction (`toggleOne` is now a plain add/remove;
  no prefix/gap logic) and the server re-check in `app/api/picking/assign/route.ts` (no longer imports
  `getPickingQueue`/`validateTopPrefixSelection`; the whole re-check block is gone).
- `lib/picking/sort.ts` — dead `byRoute`/`byArea` constants + their only helper `compareNullableStringAsc` removed.

---

## Deliberately left in place (do not "fix")

- **`lib/picking/validate-assign.ts`** — still on disk, unused, zero references. Kept per CORE (never
  delete files unless instructed) and to make re-wiring the guard a one-line change later.
- **`row.weightKg` / `volumeLitres` / KG-LT columns / block subtotal display** — sourced from
  `querySnapshot.totalWeight`, NOT `orders.grossWeight`. Display data only. Never conflate with the
  removed readiness fields just because both say "weight."
- **`byRoute`/`byArea` as DATA** — `route` and `area` remain on `PickingQueueRow`. Only the unused SORT
  constants were removed.

---

## Floor workflow — designed & LOCKED this session (build is NEXT session)

The full picker/supervisor workflow was analysed but **not built** yet. Locked decisions for the
next session's mockup + board build:

### State ladder (4 states, one bill at a time)
1. **Waiting**  — in queue, unassigned (`workflowStage = pending_picking` / `SUPPORT_DONE_OUTPUT`). *(built)*
2. **Picking**  — assigned to one picker, fetching (`workflowStage = pick_assigned` / `PICK_ASSIGNED`). *(built)*
3. **Picked**   — picker taps Done, material on floor, waiting for supervisor check. **(NEW — next session)**
4. **Approved** — supervisor checks, taps Approve, bill exits picking. **(NEW — next session)**

- `pick_assignments.pickedAt` (currently null) becomes the **Done** timestamp.
- Need to add an **approved** timestamp + approvedBy for state 4.
- Dormant chains NOT used by /picking: `pick_lists`/`pick_list_items`, `orders.isPicked`/`order_splits.isPicked`
  (belong to the Planning data model). Do not wire them in.

### Team & roles
- ~3 supervisors, ~9-10 pickers. **Floor team uses an Android phone app only.**
- **All 3 supervisors can assign — equal power.** No single-assigner bottleneck.
- **Any supervisor can approve any Done bill** (V1 — no "only assigner approves" rule).

### Zoning model — route = the work lane (verbal, not enforced in V1)
- One truck = one route -> route is the natural partition. Standard **zone picking** (DHL/Flipkart pattern).
- **V1: zoning is told, not enforced.** "Rajesh -> Adajan, Suresh -> Katargam, Mahesh -> rest."
  Each supervisor applies the route filter and serves their lane. No claim system, no locks, no banner.
- **Area = sub-lane inside a route** — used only when one route is split across pickers (filter route,
  then narrow by area to hand chunks to different pickers). Not a top-level lane.

### Guard — deliberately OFF in V1
- The no-jump "serve from the top" guard is **removed**, not just relaxed. Watch how the floor actually
  uses the filter, then decide whether to re-add it (rebased to the filtered lane, not the global list).
- **Why it's safe to run without it:** double-assign is prevented by the DB (one assignment row per bill).
  The second supervisor to grab the same bill gets a harmless error. The guard only ever enforced
  "start from the top" — not data safety.

### Known V1 trade-off (on the record)
- Verbal lanes mean a KEY dealer on a route nobody filtered to could wait. Caught by eye for now.
  Acceptable at 3 coordinating supervisors. The "surface, don't enforce" fix (a "KEY waiting on
  unclaimed route" banner) is a V2 option if it bites.

---

## The V2 brain — parked, with a clean seam

- **Dispatch Brain V2** (load-aware capacity engine — six-slot weight-by-customer-count, tightest-fit
  tempo, smart-split overflow, dual readiness) is fully designed
  (`web-update-2026-07-12-dispatch-brain-v2-capacity-locked.md`) and **parked**.
- **The plug-in seam:** the old `row.isReadyRoute = group.weight >= 950` assignment in `queue.ts` is the
  single point a future readiness signal replaces. When the brain returns, it feeds a readiness/order
  signal that a re-added rule (like the old `byRouteReady`) consumes — slotted back into `PICKING_SPINE`
  above `byKeyCustomer`. `validate-assign.ts` is the dormant guard ready to re-wire alongside it.
- **Sequencing (Smart Flow's rule): pipes before brain.** Prove the human workflow end-to-end on the
  flat queue first. Only then plug the brain in behind the proven frontend.

---

## Next session (fresh deep-dive)
1. **Floor app mockup first** (HTML, `docs/mockups/picking/`) — supervisor board (Assign zone + Check zone)
   and picker Android view (only his assigned bills; Done action). Mockup approval before any React.
2. Build states 3 (Picked) + 4 (Approved): schema add (approved timestamp + approvedBy), picker Done API,
   supervisor Approve API, the two new UI zones.
3. Open picker-login question to settle before drawing the picker screen: **own phone/login each, or a
   shared terminal where the picker taps his name first.**

---

## Doc-consolidation notes (when folding into canonical `CLAUDE_*`)
- Fixed-table-standard section in `CLAUDE_UI.md` is **§27** ("Fixed table layout standard"), NOT §40
  (§40 is OT prompt screens). Earlier prompts miscited §40 — use §27 going forward.
- Update `CLAUDE_SUPPORT.md` / screens index: /picking is now a flat KEY -> P1 -> FIFO list with a route
  filter, no load logic, no guard. Retire references to the ">= 950 truck-ready" model.
- `validate-assign.ts` is DORMANT (kept on disk, not called) — note as a landmine so it isn't "cleaned up."
- `byRoute`/`byArea` sort constants removed; `route`/`area` remain as row data.

---

*Session 2026-07-13 · OrbitOMS · Picking V1 flat + route filter shipped; floor workflow + V2 brain planned.*
