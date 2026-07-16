# Picking Queue V1 — Design LOCKED (2026-07-12)

**Supersedes** the earlier same-day draft `web-update-2026-07-12-picking-queue-v1-sort-spec.md`
(which used a tiered cross-route model + a non-existent `weightKg` column). This is the final,
simplified model after live simulation with Smart Flow.

---

## The one principle

**One waiting line. The sort decides the order. The supervisor always serves from the top.**
Nothing else. Every rule below just feeds that single line — no rule fights for the surface.

---

## Sort order (top → bottom), within each dispatch-window tab

1. **Vehicle-ready routes first** — a route whose **total weight (assigned + waiting) ≥ 950 kg**
   rises to the top as a whole block. Multiple ready routes → earliest order-time first (FIFO).
2. **Everything else keeps the existing spine order** — route grouping → area → priority (P1) →
   key-customer float → oldest-first.
3. **FIFO (`orderDateTime`) breaks every tie**, everywhere.

> **V1 scope note:** KEY and urgent (P1) keep their CURRENT behaviour (float **within their area**).
> Promoting a whole route to the top *because* it holds a KEY/P1 dealer is **deferred** to a later
> iteration (test-and-update). V1 adds only the vehicle-ready rule on top of today's spine.

---

## Truck-ready weight math (the important nuance)

- **"Is the route full?" counts ALL the route's bills — assigned + waiting.** An assigned bill is
  still riding that truck, so it still counts toward 950. (Counting only waiting bills would wrongly
  read a nearly-loaded truck as "not full.")
- **The visible waiting LINE shows only waiting bills.** Assigned bills are frozen out of the line.
- **Weight field = `orders.grossWeight`** — confirmed clean in discovery (0/106 null over a 7-day
  Local window; values in kg). The ready-route header shows this grossWeight-based route sum (the
  number that drives the decision).
- **Watch (test item):** the existing per-row **KG** column reads a *different* source
  (`import_obd_query_summary.totalWeight`), not `grossWeight`. If the header sum and the per-row KG
  visibly diverge, reconcile the display later — the *decision* uses grossWeight.

---

## Assign = freeze

- Assigning a picker **locks** the bill. It leaves the waiting line into the "Assigned — locked" bar.
  It **never re-sorts**.
- Only **waiting** bills reshuffle when the line re-ranks.
- **Undo** returns the bill to the waiting line and it re-slots wherever the sort puts it
  (boomerang — existing behaviour, unchanged).

---

## No-jump guard (new behaviour to build)

- **Serve from the top.** A selection must be a **gap-free run from the top** of the waiting line
  (within the tab). The supervisor **cannot** assign a lower bill while waiting bills above it are
  still unassigned.
- Enforced in **two places**: the UI (rows below the first gap aren't selectable) **and** server-side
  in the assign API (reject a non-top-run assign coming from a stale screen).

---

## Split one route across pickers

- **No new feature needed.** Assign a top chunk to Picker A → those leave → assign the next chunk to
  Picker B → then the rest to Picker C. The existing bulk-assign (one picker per assign, repeat) already
  does exactly this.

---

## Scope

- **LOCAL delivery type only** for V1.
- **950 kg is the ENTIRE meaning of "truck ready" in V1.** Fleet-size fit, volume caps, drop-count,
  reshuffle — all **V2**, and all live in the **separate PLANNING board**, never in the picking queue.
  The picking queue stays a pure sort forever.

---

## Route vs area (carry-forward)

- Ready grouping is by **ROUTE** (one truck = one route), resolved via
  `COALESCE(shipToOverrideCustomerId, customerId)` → `delivery_point_master` → `area_master` → route.
- **Area** is the sub-zone inside a route.
- Smart Flow chose **not** to pre-confirm which live names are routes vs areas — will eyeball during
  testing and update if the ready-block groups at the wrong level.

---

## Build order

1. **Load-ready sort rule** (+ route weight counts assigned + waiting).
2. **No-jump assign guard** (UI + API).
3. **Verify split-across-pickers** (already works — no build).
4. **Fold into canonical `CLAUDE_*` docs** after testing settles. Also fix the two stale-doc items
   discovery flagged: (a) `CLAUDE_SUPPORT.md` doesn't yet describe `pending_picking`/`pick_assigned`
   vs the stage ladder; (b) the 2026-07-11 draft wrongly says bulk-assign is "not built" (it is live).

---

## Engineering guardrails (CORE §3)

- No `prisma.$transaction` — sequential awaits only.
- Add the ready rule as a **new rule in the existing `PICKING_SPINE`** — do NOT rewrite
  `sortPickingQueue()`.
- `export const dynamic = 'force-dynamic'` on any touched route.
- `tsc --noEmit` clean before every commit. Commit to `main`. Smoke-test on live Vercel first.
- Files that depend on each other ship in the **same commit**.
