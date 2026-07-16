# Dispatch Brain V2 — Discovery Findings (BUILD PAUSED)
# Session: 2026-07-13 · web-discovery · Read-only. No code, no schema change.
# Related: web-update-2026-07-12-dispatch-brain-v2-capacity-locked.md (the LOCKED design)
#          web-update-2026-07-12-picking-queue-v1-sort-spec.md (the seam we'll wire into)
# Status: discovery DONE · two build decisions OPEN · build not started

---

## 0. Why we stopped

Discovery surfaced a real mismatch between the **locked design** and the **live fleet data**.
That mismatch changes how much we even need to build, so we paused before writing any code.
This doc captures everything found so the build can be planned cleanly in a fresh session.

---

## 1. The seam (where V1 picking gets its "ready" signal) — CONFIRMED CLEAN

Two spots in `lib/picking/`, both wired to today's flat `>= 950 kg = ready` rule:

- **Where "ready" is computed:** `lib/picking/queue.ts`, inside `getPickingQueue()`,
  per-route aggregation block ~lines 180–213. The literal threshold:
  - line **211**: `row.isReadyRoute = group.weight >= 950;`
  - weight summed per `windowId::deliveryType::route` key ~lines 187–204, reading
    `orders[i].grossWeight` (line 191), scoped to `deliveryType === "Local"` only.
- **Where a ready route rises in the sort:** `lib/picking/sort.ts`, the `byRouteReady`
  rule (lines 65–80), slotted 3rd in `PICKING_SPINE` (line 124) — after `byWindow`,
  before `byDeliveryType`/`byRoute`.

**Swap point (locked):** change `row.isReadyRoute` at `queue.ts:211` to read the brain's
output instead of `group.weight >= 950`. Leave `sort.ts` **completely untouched** — it only
consumes the boolean `isReadyRoute` + `readyRouteEarliestDateTime`, no weight math of its own.
One boolean crosses the boundary. This keeps the "picking queue stays a pure sort" rule intact.

---

## 2. Live data findings (from Supabase, 2026-07-13)

### 2a. Fleet — `vehicle_master` (6 rows, pre-existing, NOT created this session)
These rows were already in the table from an earlier setup. Number-plates look like
placeholders (`GJ-05-AB-1234`…) — **UNVERIFIED whether real fleet or early dummy seed.**

| category    | capacityKg | maxCustomers | deliveryTypeAllowed |
|-------------|-----------:|-------------:|---------------------|
| Tata Ace    |        750 |            8 | Local               |
| Tata Ace    |        750 |            8 | Local               |
| Tata 407    |       1500 |           12 | Local               |
| Tata 407    |       1500 |           12 | Upcountry           |
| Eicher 14ft |       2500 |           15 | Local               |
| Eicher 14ft |       2500 |           15 | Upcountry           |

Each truck = **one flat weight cap + one flat customer cap**. No sliding.

### 2b. Dispatch tables — EMPTY scaffolding
- `dispatch_plans` = 0 rows
- `dispatch_plan_orders` = 0 rows
Nothing live to break. Clean slate to build on.

### 2c. Cutoff clock — EXISTS, untyped
`dispatch_slot_master` holds 4 windows: **10:30, 12:30, 16:00, 18:00**.
Stored as free-text `windowTime` String, not TIME/TIMESTAMPTZ. Parseable, but needs a
parse/typing step before the brain can compare "now" against it.

### 2d. Weight quality — 99.3% clean
- Total active orders (`isRemoved = false`): **7518**
- Valid positive `grossWeight`: **7466**
- Null: **49** · Zero-or-negative: **3** → **52 bad rows** need a fallback rule later.

### 2e. Route + customer-count join — WORKS on live rows
`COALESCE(shipToOverrideCustomerId, customerId)` → `delivery_point_master` → `area_master`
→ `route_master` resolves correctly. Busiest routes: Adajan, Ghod Dod, Navsari, Varachha, Vapi.
**Flag:** most `dispatchStatus = 'dispatch'` orders have **no `dispatchWindowId` stamped**
(null window). Must sanity-check *today's* live orders before wiring — the brain groups by
`route + cutoff`, and cutoff = window. If window is usually null, grouping needs a fallback.

---

## 3. THE FORK (must be answered before build) — OPEN

The locked design assumes a **6-slot sliding capacity table** (tempo A/B/C/D, weight shrinks
as distinct-customer count rises: 3000 → 950 kg). The **live fleet does not work that way** —
each real truck has a flat weight cap and a flat customer cap that don't slide.

**Decision A — sliding is REAL.** Depot genuinely carries less weight with more drop-points
(loose stacking). Want it enforced. → build a new seeded capacity lookup
(type × customer-count band → maxKg); ignore flat `capacityKg`. Bigger build.

**Decision B — sliding was THEORETICAL.** Real loading = each truck's flat `capacityKg` +
`maxCustomers`, already in `vehicle_master`. → much simpler brain, no new table, use the
6 trucks as-is. Smaller build.

**Test question for the depot:** when the team loads a tempo, does adding more customers force
them to carry *less* weight — or does the truck just hold what it holds regardless of stops?

---

## 4. Second open decision (from design §8) — still OPEN

Does the picking queue rise a **whole route** (as today) or **one tempo-group's bills kept
adjacent** (pick by loadable truck)? Decides how invasive the sort change is. Defer until the
fork above is settled — the answer may depend on it.

---

## 5. Schema gaps (for whichever path wins)

- `vehicle_master.capacityKg` = single Float. Cannot express the sliding 6-slot table (needed
  only if Decision A).
- `vehicle_master.category` = raw String, no enum/FK to A/B/C/D. Nothing enforces stored values
  match any capacity table.
- `dispatch_slot_master.windowTime` = String, not TIME. Needs parse/typing for clock compare.
- No volume/space cap on `vehicle_master` (`orders.volume` exists as input; deferred anyway).
- No stored distinct-customer-count — derivable live via the join, but re-walked each check.
- No link between `dispatch_slot_master` and `vehicle_master` (which tempos eligible per window).

---

## 6. Next session — start here

1. **Answer the fork (§3): A or B.** Everything downstream depends on it.
2. If verifying fleet realness first: check `vehicle_master` `createdAt` + `transporterId`
   (all same-second + null transporter = dummy seed).
3. Confirm today's live `dispatch` orders actually carry `dispatchWindowId` (§2e flag).
4. Then lock the queue-unit decision (§4) and stage the build:
   seed capacity/cutoffs → brain as pure testable function → wire into `queue.ts:211` seam.

---

*Discovery locked 2026-07-13 · Build paused pending fork decision · OrbitOMS*
