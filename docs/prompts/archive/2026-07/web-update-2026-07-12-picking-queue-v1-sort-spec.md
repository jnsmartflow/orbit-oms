# Picking Queue — Vehicle-Load-Aware Sort · V1 Spec (LOCKED)

**Session:** 2026-07-12 · planning + simulation (claude.ai)
**Status:** design locked. Discovery + build = next session.
**Module:** Picking Queue (adds to existing sort spine — NOT a rewrite).

---

## 1. What this is

The picking queue is a **pure sequencing** module. Its only job: decide **which
order gets picked first**. It **ranks** — it never assigns vehicles and never
moves bills between vehicles.

Vehicle-load awareness is used **only as a ranking signal** ("this route is full
enough to roll → push it up"), not as an action. Packing / reshuffle / vehicle
assignment is a **separate planning module**, built later.

The queue **re-sorts on every batch** of incoming orders. Already-picked bills
never move — only the pending pick order re-ranks.

---

## 2. V1 sort hierarchy (LOCKED)

```
1. Vehicle-ready route (route load ≥ 950 kg)  → ready routes rise as a block
                                                 (earliest-ready route first)
2. KEY dealers    (cross-route)
3. Urgent (P1)    (cross-route)
4. Plain          → grouped by route

INSIDE a ready route:   KEY → urgent → plain

FIFO (oldest order date-time first) = the order WITHIN every group, everywhere.
```

### Reading the hierarchy

- **Nothing ready →** KEY dealers lead (any route), then urgent (any route),
  then plain grouped by route. This is the "buckets still filling" behaviour.
- **A route crosses 950 kg →** that whole route rises to the top as a block so
  it can complete and dispatch fast. This can happen on ANY batch (1st or 10th).
- **Multiple ready routes →** earliest-ready first (consistent with FIFO).
- **Inside a ready route →** KEY → urgent → plain, so the important dealers are
  already picked the instant the vehicle fills → zero dispatch delay.
- **FIFO is the universal tie-breaker** at every level: two ready routes, two
  KEY dealers, two urgent, two plain — oldest order date-time wins.

### Key definitions

- **Vehicle-ready = route load ≥ 950 kg.** Dead simple. No fleet-size matching,
  no "which bucket fits" — that is V2. Crossing 950 just flips a route to ready.
- **Dealer / keep-together identity** (for later modules) = effective delivery
  point: `COALESCE(shipToOverrideCustomerId, customerId)` → delivery point master.
  (Not needed for V1 ranking, but noted for V2.)
- **Route** = geographic cluster (Adajan, Ghoddod, Varachha …). **Area** =
  sub-zone inside a route. **One vehicle = one route** (a vehicle may span the
  route's areas, never mixes routes) — relevant to V2, not V1.
- **Scope:** LOCAL delivery type only for v1. Ignore Upcountry / Cross / IGT.

### Deliberately dropped in V1

- Area / delivery-number ordering — **removed** for consistency. FIFO within
  every group is the single rule. (Revisit only if testing shows a reason.)

---

## 3. Why this shape (design rationale)

- **KEY/urgent don't fight fill — they serve it.** A KEY dealer's material can
  only ship once its vehicle is ready. So KEY/urgent front-load *within* a route
  → the important bills are staged the moment the truck fills → instant dispatch.
- **A ready route outranks a waiting KEY dealer.** A truck that can roll clears
  the floor now; the KEY dealer in a not-yet-full route can't ship yet anyway.
- **North star:** pick the right material in the right order so that the instant
  picking finishes, a full load is ready to go — shrink the staging gap between
  "picked" and "loaded" toward zero. That idle staged stock is the waste we kill.

---

## 4. The version ladder (each rung ships + is trusted before the next)

```
V0  Discovery — confirm weightKg clean + order date-time field exists (SQL only)
V1  THIS SPEC — load-aware ranking added to the existing sort spine. Ranks only.
V2  Planning module (SEPARATE): draft vehicles, fleet-size fit, reshuffle to keep
    dealers whole, max-unique-deliveries-per-vehicle (drop-count) rule, between-
    fleet-size split logic (one big vehicle vs two fuller small ones).
V3+ Gate (where a bill becomes un-reshuffleable) + supervisor override
    (force-send / split / merge / dedicate), volume-vs-weight cap, oversized bill
    (>3000) split policy, route-never-fills-by-cutoff handling, multi-route packing.
```

**V2 is a different module (planning), not more of the picking queue.** The
picking queue stays a pure sort forever.

---

## 5. Known dependencies / things to verify in discovery

1. **`weightKg` on live LOCAL dispatch orders** — must be non-null at scale.
   Prior note: a sample showed 0/42 rows null (fully populated). Confirm it holds
   across a full day. If null anywhere, tier 1 (vehicle-ready) has nothing to read.
2. **Order date-time field for FIFO** — confirm the exact column used as the
   authoritative arrival time for ranking (order create time in IST).
3. **No vehicle/capacity table exists** — confirmed not present. V1 does NOT need
   one (950 is a code constant). A real fleet/capacity table is a V2 dependency.

---

## 6. Open item carried forward

- Tie-break for **two simultaneously-ready routes** set to **earliest-ready
  first** (FIFO-consistent). Confirm this reads right once seen on live data.

---

## 7. Engineering guardrails (from CORE §3) for the build

- No `prisma.$transaction` — sequential awaits only.
- Schema changes (if any) via Supabase SQL Editor → hand-edit schema.prisma →
  `npx prisma generate`. Never `db push` / `db pull` locally.
- All API routes: `export const dynamic = 'force-dynamic'`.
- `tsc --noEmit` clean before every commit. Commit to main. Smoke-test first.
- Slot in as a **layer over the existing modular sort spine** — do not rewrite
  `sortPickingQueue()`.
```
