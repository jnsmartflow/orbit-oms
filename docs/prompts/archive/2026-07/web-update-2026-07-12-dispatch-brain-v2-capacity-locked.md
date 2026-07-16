# Dispatch Planning Brain V2 — Capacity + Readiness Model (DESIGN LOCKED)
# Session: 2026-07-12 · web-planning · Design only, no code/SQL
# Destination: consolidate into a new canonical CLAUDE_PLANNING.md later (+ router row)
# Related: CLAUDE_SUPPORT.md (dispatch/slot upstream), V1 Picking Queue design (2026-07-12)

---

## 0. Framing — brain vs board

- We are building a **brain**: an engine that reads all waiting bills + tempo capacities and
  works out the best loading plan in real time. This is the real product.
- The **board** (`/planning` UI) is just the *eye* — a window to watch the brain and override it.
  Board is designed later. This doc is the brain's logic only.
- The brain **only suggests**. A human always approves or nudges. It never force-assigns.

---

## 1. Scope locked this session

- The capacity model runs **one route at a time**. A route is a sealed box.
- **No route-mixing yet.** Combining routes that ride together is a *later* feature. When added,
  it only changes what goes into the "gather bills" step — the capacity math below is unchanged.
- Grouping works on **same-cutoff** bills only. No cross-cutoff grouping.
- Route resolves the usual way: `COALESCE(shipToOverrideCustomerId, customerId)` →
  `delivery_point_master` → `area_master` → route. Weight = `orders.grossWeight` (kg, clean).

---

## 2. The capacity table (6 slots) — LOCKED

Capacity is **not** one number per tempo. It bends with the number of **distinct customers**
on board (more drop-points → looser stacking → less usable weight).

| Type | Distinct customers | Max weight |
|------|--------------------|------------|
| A    | 1–2                | 3000 kg    |
| B    | 1                  | 2200 kg    |
| B    | 2–3                | 2000 kg    |
| C    | 1                  | 1500 kg    |
| C    | 2–5                | 1200 kg    |
| D    | 1–9                | 950 kg     |

Read as: the brain never asks "what is tempo B's max?" — it asks
**"what is tempo B's max *at this customer count*?"** Capacity is a lookup, not a constant.

Same weight, different customer split → different answer:
- 2100 kg on **1** customer → fits **B** (2200 @ 1).
- 2100 kg on **2** customers → does NOT fit B (2000 @ 2) → needs **A**.

---

## 3. Core suggestion logic — LOCKED

For each route, for the same cutoff:

1. Gather the route's bills.
2. Read **total weight AND distinct customer count together.**
3. Suggest the **smallest tempo** whose (type + customer-count) slot legally holds the group
   — tightest-fit, cheapest legal slot wins.
   - e.g. 1 customer / 1400 kg → suggest **C** (1500 @ 1), never B. Never up-size when a smaller fits.
4. Emit as a **suggestion**; human approves or adjusts.

**"Legal truckload" = obeys BOTH limits at once — weight AND customer count.**
- Route X: 1400 kg / 1 customer → fits C → legal → ready.
- Route Y: 1000 kg / 15 customers → no tempo allows 15 (D maxes at 9) → NOT one legal load →
  must be split before anything leaves.

---

## 4. Two overflow triggers — LOCKED

### 4a. Weight overflow — group too heavy for one tempo
Smart split:
- Pack the **big tempo to its max** first.
- Drop the **leftover on the smallest tempo that fits**.
- All bills move this cutoff — no lonely leftovers, no giant half-empty second tempo.
- Editable suggestion; human approves.
- (Also handles "one customer > 3000 kg": big tempo maxed, remainder on smallest tempo that holds it.)

### 4b. Customer overflow — more distinct customers than ANY single tempo allows
(e.g. 7+ distinct customers — C caps at 5, B at 3, A at 2, so no single tempo is legal.)
- Suggest **multiple D tempos** (950 kg, up to 9 customers each — D is the widest door).
- **Balance** the distinct customers across the fewest Ds needed.
- Keep **each D under 9 customers** where possible → leaves a free seat so a late same-cutoff bill
  for a new customer has somewhere to go without re-planning the route.

### 4c. Tie-break when 4a and 4b collide (LOCKED)
When balancing customers would push a D over 950 kg:
- **950 kg is the hard physical limit and wins.**
- Customer-balance is the "nice to have" and **bends** to respect weight.

Worked example: 20 distinct customers, 1600 kg on a route.
- 20 ÷ 9 = 3 Ds by customers; 1600 ÷ 950 = 2 Ds by weight → stricter (3) wins → **3 Ds**.
- Spread ≈ 7 / 7 / 6 customers (balanced, under 9), respecting 950 kg each.

---

## 5. Readiness model — WHEN a load is "ready" — LOCKED

Real-depot truth: **the max load is usually NOT filled.** A D holds 950 kg but a cutoff often
only produces 750–800 kg. That partial load is still the final load — it must go, not wait for a
950 that never arrives.

So a load becomes ready by **either** trigger, whichever comes first:

1. **Full enough, early** — a route forms a legal truckload before the cutoff clock →
   suggest it now, get the truck out early.
2. **Cutoff clock passes** — cutoff is a **fixed clock time**. When it passes, no more bills are
   coming → the brain **seals** each route's accumulated bills (even a half-full 800 kg on a 950 D)
   → suggest the smallest tempo(s) that fit.

**Cutoff sealing does NOT relax the limits.** The clock passing only stops *new* bills. The same
capacity + overflow rules still apply at sealing:
- 800 kg / 12 customers at cutoff → still can't fit one D (max 9) → sealed into **two Ds**, balanced.

---

## 6. Priority tie-break — LOCKED

When two legal truckloads are ready at the same moment, the truck carrying a
**KEY or urgent customer goes first.** (Feeds the picking queue's ordering — see §8.)

---

## 7. Full locked spec (one-glance)

1. One route at a time. No route-mixing yet.
2. Gather that route's same-cutoff bills.
3. Read total weight + distinct customer count **together**.
4. Suggest the **smallest legal tempo** from the 6-slot table.
5. **Weight overflow** → smart split: big tempo to max, leftover on smallest that fits.
6. **Customer overflow** → multiple **D** tempos; balanced, under 9 where possible;
   **950 kg hard limit wins** if the two collide.
7. **Ready when:** full-enough early **OR** cutoff clock passes (seal partial loads; limits still apply).
8. **Tie-break:** KEY / urgent customer's truck goes first.
9. Everything is a **suggestion**; human approves or nudges.

---

## 8. How it plugs into V1 (picking queue) — PROPOSAL, not yet locked

Boundary (locked in V1): **the picking queue stays a pure sort forever — it only answers
"what to pick next."** The brain does NOT move into it. The brain emits a **readiness signal**;
the queue sorts on it.

- Today the queue reads a cheap "≥ 950 kg = ready" line. It's blind to customer count and to
  whether a real truck can leave.
- With the brain, "ready" = "the brain has closed at least one full, legal tempo group for this
  route (or the cutoff sealed it)." A real loadable truck, not a raw number.
- Effect on the sort: brain-ready trucks rise to the top; **KEY/urgent truck first** (§6); the
  existing KEY → P1 → route/area/FIFO ladder stays underneath. The list re-sorts live as bills
  land/hold and as cutoffs seal.

**Open decision (next session):** whether the queue should rise **whole routes** (as today) or
rise **one tempo-group's bills kept adjacent** (pick by loadable truck, not route-blob). Bigger
change — decide deliberately.

---

## 9. Known data-model impact (for the discovery session — NOT solved)

- `vehicle_master.capacityKg` is a **single number** — it **cannot express** the 6-slot
  weight × customer-count table. Needs a capacity-by-customer-count lookup (type → customer-count
  band → maxKg), driven by **data, not hardcoded constants**.
- `vehicle_master` has **no volume/space cap** column — volume (cube-out) is deferred but will
  need a home later.
- Cutoff is a **fixed clock time** → the brain needs the cutoff clock per dispatch window as data
  (inspect `dispatch_slot_master`).
- Tables to inspect before designing: `vehicle_master`, `dispatch_plans`, `dispatch_plan_orders`,
  `dispatch_slot_master`, `orders.grossWeight`, `orders.volume`.

---

## 10. Explicitly OUT of scope this session (deferred, not rejected)

- **Route combination** — which routes may ride together. Big lever, designed later.
- **Volume / space capacity** — the cube-out logic. Capacity table is weight+customers only for now.
- **The board UI** — designed after the brain logic is fully locked.

---

## 11. Open items for the NEXT session

1. **"Which customer rides with which"** — when a route can be split several *legal* ways, we
   locked the *limits* but not always the *preference* between valid groupings.
2. **V1 integration (§8)** — lock whole-route vs tempo-group as the unit that rises in the queue.
3. Confirm the capacity table + cutoff clocks as **seed data** (source of truth), not DB-only rows.

---

*Design locked 2026-07-12 · Brain V2 capacity + readiness model · OrbitOMS*
