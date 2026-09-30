# Code plan — 2026-09-30 — Picking on the live change feed (PLAN ONLY)

**Mode:** plan. No code changed, nothing committed. Read-only SELECTs run 2026-09-30 ~11:20 IST through throw-away scripts (deleted); numbers marked **(measured)** come from them. Wall times are from the dev PC to Supabase (Vercel `bom1` is closer — read them as relative).
**State:** Floor live on the feed (`live.feed` ON). Billing built behind `live.feed.billing` (`20aefa09`, OFF; its SQL — incl. the **`pick_findings` trigger** — pending tonight). Live: `picking.visibilityGate` = **ON** (measured).

**Read:** router v1.13 · CORE §3 (router.refresh / history-pop rule, offset-less `Date.parse`), §13 · CLAUDE_PICKING (§5.3–§5.6, §10 whole, §7 landmines as they touch sync) · CLAUDE_FLOOR_TRIPS §11 · the 7a/7b and 2b-i/2b-ii records · disk-io §A/§B/§F · `components/picking/{picking-mobile-shell,picking-board-mobile,picker-my-picks-board}.tsx` (sync-relevant parts) · `app/api/picking/{marker,queue,tint-workload,…}` · `lib/picking/{queue,visibility-gate,tint-workload,colour-work-query,pick-deleted}.ts` · `lib/hooks/use-picking-marker.ts` · `lib/live/*`.

---

## A. Inventory — every timer, marker and refetch (code as of `20aefa09`)

| # | Where | Face / who mounts | Trigger | Endpoint | Cost per call (measured wall / statements) | Pause |
|---|---|---|---|---|---|---|
| 1 | `picking-mobile-shell.tsx:510-516` `usePickingMarker({scope:"openPending"})` | Supervisor (`SupervisorPickingShell`, primary role ≠ picker) | 15 s + one on visible | `GET /api/picking/marker?scope=openPending` | **~330 ms**; 4 statements: gate read (`app_settings`) · `orders.aggregate(buildPickingWhere)` · `countHeldBackWaiting` (findMany + count; gate is ON) · `getDecisionsLatest` (+ O ≈ 0–1 with the access notebook) | `detailOpen \|\| overlayBusy` — defers `onChange` only, still probes |
| 2 | same, `onChange` → `refetchQueue` (`:492-499`, fetch `:441`) | Supervisor | marker moved | `GET /api/picking/queue?scope=openPending` | **~2.0 s, 54 KB, 55 rows** (`getPickingQueue`: gate · orders findMany + includes · dealers · users · duplicate-SO · colour work · line items ×2 · sku_master_v2 ×2 · held-back · pick-deleted ≈ 12–15 statements) | same |
| 3 | `picking-mobile-shell.tsx:560-567` second `usePickingMarker({url:"/api/picking/tint-workload/marker"})` | Supervisor | 15 s + on visible | `GET /api/picking/tint-workload/marker` | **~220 ms**; 2 aggregates | same |
| 4 | same `onChange` → `refetchTint` (`:527-535`) + once on mount | Supervisor | tint marker moved | `GET /api/picking/tint-workload` | **~840 ms, 9.5 KB** (~14 statements) | same |
| 5 | `picker-my-picks-board.tsx:510-517` `usePickingMarker({scope:"openPending", pickerId})` | Picker (`PickerPickingShell`) | 15 s + on visible | `GET /api/picking/marker?scope=openPending&pickerId=N` | ~3 statements (aggregate narrowed by `pickAssignment.pickerId` — **indexed**, `idx_pick_assignments_picker_status`) | `detailOpen \|\| marking \|\| markingAll` |
| 6 | shell `refetchQueue` (`picking-mobile-shell.tsx:335-349`) | Picker | #5 moved / after own write | `GET /api/picking/queue?scope=openPending&pickerId=N` | **~1.5 s, 23 KB, 24 rows** (busiest picker) | same |
| 7 | `picker-my-picks-board.tsx:557` | Picker, Combined tab | tab open + `pending` changes | `GET /api/picking/combined?pickerId=N` | line items of his pending bills | — |
| 8 | `picking-board-mobile.tsx:1781`, `picker-my-picks-board.tsx:590` | both | detail opened / paged | `GET /api/picking/order/[id]` | 1 bill | — |
| 9 | `picking-board-mobile.tsx:1750` | Supervisor | picker sheet | `GET /api/warehouse/pickers` | roster | — |
| 10 | `picking-board-mobile.tsx:1494` | Supervisor | 30 s | — (`setNowTick`, render only) | 0 | — |
| 11 | `markerResync` after each own write (`picking-mobile-shell.tsx:346`, `:497`; picker `:520`) | both | own write | the marker again | as #1 / #5 | — |
| 12 | `app/picking/page.tsx` server render | both | page load | `getPickingQueue` server-side (picker) | as #6 | — |

**Hidden / screen-off:** every hook above stops (`visibilityState` + `visibilitychange`, `use-picking-marker.ts`); on return: one probe each (#1, #3 on the supervisor; #5 on the picker). The 30 s render tick (#10) keeps ticking but costs nothing.
**Picking has no focus-triggered probe** and no blind poll (unlike Billing's pick-delete popup / Floor's rail poll).

## B. What each face shows, and trigger coverage

| Face / section | Reads (tables) | Triggered? |
|---|---|---|
| Supervisor Assign / Picking / Done tabs (queue rows, picker cards, bundling candidates `waitingSkus`/`oilSkus`, held-back band, pick-deleted cards) | `orders`, `pick_assignments` (+ `users` names), `delivery_point_master` (dealer), duplicate-SO (`orders` + `pick_delete_decisions`), colour work (`tint_assignments`, `order_splits`), `import_raw_line_items` + `sku_master_v2` (bundling SKUs), gate (`app_settings` + `trips.shownAt` via `trip_drops`), pick-deleted (`pick_delete_decisions` + `orders`) | `orders` ✓ · `pick_assignments` ✓ (order) · `tint_assignments` ✓ · `order_splits` ✓ · `pick_delete_decisions` ✓ · `trips` / `trip_drops` ✓ (trip) · `app_settings` ✓ (config) · `delivery_point_master` ✓ (config) · `import_raw_line_items` ✗ (see note) · `sku_master_v2` ✗ · `users` ✗ |
| Detail screen (both faces) | `orders`, line items, `pick_findings` | `pick_findings`: **trigger written in 2b-i SQL, NOT YET APPLIED** |
| Supervisor Tinting section (§5.6) | `orders` (tint stages), `tint_assignments`, `order_splits`, `users` (operator roster via `user_roles`) | ✓ except `users`/`user_roles` (access tables — deliberately untriggered) |
| Picker Pending / Combined / Done | the same queue builder narrowed to his `pickerId`, + line items (Combined), pick-deleted (his) | as the supervisor |

**Missing triggers: none required.**
- `pick_findings` → `order` is already in `sql/2026-09-30-live-changes-billing.sql` (2b-i). **Hard prerequisite: that SQL applied before Picking goes live** — a confirmed finding changes the detail and the Done badge and writes no `orders` row.
- `import_raw_line_items` — lines change only on (re-)import, which also writes `orders` / `import_obd_query_summary` (both triggered) for the same bill. Not needed.
- `sku_master_v2` — the catalog; a rename reaches a board at its next full load. Accept (same rule as Floor's master data).
- `users` / `user_roles` — a picker or operator renamed / (de)activated shows at the next full load. Deliberately untriggered (they carry the access-version triggers). Accept.

## C. The gate, `countHeldBackWaiting` and the "marker ⊇ queue" landmine

- **The waiting set depends on TRIPS, not only on orders** (gate ON live): a waiting bill is on the board only when its trip has `shownAt` (`waitingBranchWhere(gateOn)`, `lib/picking/visibility-gate.ts:101`). "Show to floor" / take back writes `trips` only → the feed carries a **trip id**, not the bills. The by-id path must therefore **expand changed trip ids to their bills** (`trip_drops` → `orders."tripDropId"`) and re-read those bills.
- **Re-use the builders, never re-declare** (Floor 7a's rule): give `getPickingQueue` an `onlyIds` option that ANDs `{ id: { in: ids } }` into the SAME `buildPickingWhere({ scope:"openPending", gateOn })` it already builds (and the same `pickerId` narrowing), so a patched row cannot differ from a full load. Ids that come back absent = left the board. The bundling siblings (`waitingSkus` / `oilSkus`, `PICKING_GROUPING_ENABLED = true`) are built for the same ids, so they patch by id too.
- **`heldBack` / `heldBackTrucks` / `heldBackUnplanned`** are aggregates, not rows: recompute them with the SAME `countHeldBackWaiting(buildPickingWhere(…ungated…).where, gateOn)` on every sync that carries an order or trip change while the gate is on (2 statements).
- **The gate switch itself** (`app_settings` `picking.visibilityGate`) arrives as `config` → one full reload (same as Floor; debounced 5 s, ≤ 1 per 2 min).
- **The landmine changes shape.** "Marker ⊇ queue" existed because the marker re-declared a predicate. On the feed there is no marker: the change book records EVERY write to every triggered table, which is a superset of any predicate by construction. The risk moves to **trigger coverage ⊇ what the queue reads** — hence §B's list, and CORE §13's rule that a new table a screen reads gets a trigger in the same commit.
- **`isPickGateOn()` must be read ONCE per sync** and passed to both the row builder and `countHeldBackWaiting` — the same "both callers pass the same `gateOn`" rule as today (`PICKING §10`).

## D. Feed design

**Switch:** `app_settings 'live.feed.picking'` AND `live.feed` (absent = OFF) — `GET /api/live/changes?screen=picking`, exactly Billing's pattern. Page gate on the changes route gains `picking` canView.

### D.1 Supervisor — by-id patch (Floor-style), ONE call per glance — recommended
`POST /api/picking/sync` `{ orderIds, tripIds, shownIds, tintShownIds }` (behind both switches, `picking` canView):
1. expand `tripIds` → bill ids on those trips; union with `orderIds`;
2. `getPickingQueue({ scope:"openPending", onlyIds })` → rows present = on the board (with their bundling siblings); absent = left;
3. heldBack triple (gate on); `pickDeleted` only when a changed id is a pick-delete decision's bill today;
4. `tintTouched` = a changed order is a tint order at a tint stage, or in `tintShownIds`, or the batch carried `tint_assignments` / `order_splits` lines (they arrive as order ids — the order-stage check catches them) → the client refetches `/api/picking/tint-workload` (9.5 KB; a by-id tint path is not worth it);
5. returns `{ enabled, date, patches: [{ id, row | null }], waitingSkus, oilSkus, heldBack…, pickDeleted?, tintTouched }`.
Classify-first: when none of the ids is (or was — `shownIds`) on the board, step 2 reads nothing heavy (a 1-statement PK facts read decides) — most glances in a busy hour carry floor/trip changes that are not the picking board's.

**Why patch, not Billing's classifier + list reload:** the supervisor's list is the expensive payload (~2 s, 54 KB per rebuild on a phone link, measured) and it changes on most busy glances; a list reload per change keeps today's cost. Billing's lists are small or rarely open. **Parity plan:** `scripts/parity-picking-rows.ts` (7a's pattern): full queue vs by-id for every id on the board (rows, siblings, heldBack) + an off-board id → absent + a trip-shown flip simulated by expanding a shown trip's bills; plus the snapshot/compare-snapshot mode around the `onlyIds` refactor.

Client merge (pure, tested — `lib/picking/live-merge.ts`): replace/insert/remove by `orderId`; re-sort with the queue's own spine (`sortPickingQueue(rows, PICKING_SPINE)`); patch the sibling arrays by id; replace the held-back triple; **prune the selection** of bills that left (the standing rule — "selection is pruned, not frozen", PICKING §10); keep `date` — a different `date` (IST midnight) → full reload.

### D.2 Picker — his own changes only
- `GET /api/live/changes?screen=picking&face=picker&held=<his current ids, ≤ 100>`: the server reads the page as usual and **returns only order ids that are assigned to the SESSION user now, or in `held`** (a bill leaving him — unassigned / reassigned / approved away — is in `held`; the server never trusts a client picker id). One extra small read per glance (`pick_assignments` by `order_id IN page` on `uq_pick_assignments_order`, `picker_id` = session user).
- On any id → refetch his own list (`?pickerId=me`, ~23 KB) — his set is small and changes ~10×/h; a by-id path is not worth it.
- **Ids leak:** with `face=picker` he receives only his own ids. Even without it, ids alone reveal nothing a picker cannot already reach: `picking` canView lets him fetch the whole board by URL today (`/api/picking/queue` is gated on `picking` canView only). ids-only is acceptable; the filter is for battery and bandwidth, not secrecy.

### D.3 Glance on phones
- Same controller (`lib/live/feed-core.ts`): **15 s active, 60 s idle** (no touch / key for 2 min), instant glance on touch-after-idle / visible / focus (≤ 1 per 3 s), **nothing while hidden** — screen-off / lock / app switch fire `visibilitychange` → hidden on Android Chrome and iOS Safari; one glance on return; ±20 % jitter; backoff 5 s → 2 min on a flaky link; fallback to the legacy markers after 3 errors (which will also be failing — harmless).
- Resume after a long sleep: cursor older than the 3-day prune → `reset` → one full reload.
- **Push as a glance trigger (optional):** the assign / done pushes already reach the phone (`public/sw.js`); a visible page can glance on the SW's `postMessage` so an idle picker sees a new assignment at once instead of within 60 s. Push is best-effort, never the only path.
- **CORE §3 history-pop:** patches are `fetch` + `setState` only — never `router.refresh()` (§5.4's lesson: a refresh paired with a history pop is discarded). The detail screen's single history entry (§5.3) is never touched by a patch; the list under an open detail is not re-rendered until release (E).

## E. Pause rules

| Face | Hold (queue; apply ONCE on release) | Apply immediately |
|---|---|---|
| Supervisor | `detailOpen` (detail / line ticks / Approve) · `overlayBusy` (picker sheet, release confirm, cancel sheet) — the existing flags (`picking-mobile-shell.tsx:515`) | with ticks up: rows patch and **ticks of bills that left are pruned** (standing rule); the held-back band; the tint section when no overlay is up |
| Picker | `detailOpen` · `marking` · `markingAll` (`picker-my-picks-board.tsx:516`) | nothing else moves on his face |
| Both | the glance keeps running while held; only applying waits | — |

- **The open bill changed elsewhere** (e.g. unassigned while the picker is in its detail): today it is silently deferred. Recommended: the Floor pattern — a quiet re-read, and a slim "Changed — Reload" bar only if it really differs (decision 5).
- **Own writes:** today each action refetches the whole queue then `resync()`s the marker. On the feed: patch the acted-on ids (one sync) instead of a full refetch; the echo of the own write in the next glance re-reads the same ids (cheap, idempotent) (decision 6).

## F. Load estimate — one visible phone, per hour (ESTIMATES; O ≈ 1 with the access notebook)

| | Today | After (feed) |
|---|---|---|
| **Supervisor, busy hour** (≈ 80 distinct orders changed/h — measured 10:00–11:00: 717 feed lines, 531 transactions, 79 orders) | markers 240 × (4 + 1) + 240 × (2 + 1) = 1,920 · queue rebuilds ~60 × ~13 = 780 · tint refetches ~20 × 14 = 280 → **≈ 3,000 statements/h; ~3.5 MB/h downloaded; ~60 × 2 s = 2 min of rebuild time** | glances 240 × 2 = 480 · syncs ~150 × (1–2 classify) + ~60 relevant × ~13 (tiny row sets) + heldBack ~150 × 2 → ≈ 1,300 · tint ~15 × 14 = 210 → **≈ 2,000 statements/h; ~0.3 MB/h; each change ~0.3 s instead of ~2 s** |
| **Supervisor, quiet hour** | markers alone 1,920 | idle glances 60 × 2 + a few syncs → **≈ 150–300** |
| **Picker, active** | marker 240 × (2 + 1) = 720 · refetch ~10 × 12 = 120 → **≈ 840** | glances 240 × 3 = 720 · refetch ~10 × 12 = 120 → **≈ 840** (no gain while he is touching it) |
| **Picker, idle / pocketed** | screen on: 720; screen off: ~0 | screen on, idle: **60 × 3 = 180**; screen off: ~0 |

Honest reading: on a phone the win is **fewer and smaller payloads, far less idle polling, and no 2 s rebuild per change** — not a dramatic statement count in a busy hour. The server-side costs of today's markers are already small (pg_stat_statements since 2026-09-07: the picking-marker aggregates average **~10–35 ms** per call over ~70,000 calls).

## G. Build order — small, separately testable

| # | Step | Test | Undo |
|---|---|---|---|
| 0 | **Prerequisite:** Smart Flow applies the 2b-i SQL (`pick_findings` trigger) | its TEST | its kill switch |
| 1 | `getPickingQueue({ onlyIds })` via the SAME `buildPickingWhere` (+ siblings for those ids) — no route yet | `scripts/parity-picking-rows.ts`: snapshot/compare-snapshot around the refactor (full queue byte-identical) and full vs by-id for every board id, per-picker too | revert |
| 2 | `POST /api/picking/sync` (behind `live.feed.picking`) — trip → bills expansion, classify-first, heldBack, pickDeleted, tintTouched | parity: sync over every board id + a shown trip's bills = the full queue's rows / heldBack; an unrelated id → nothing | revert |
| 3 | `/api/live/changes`: `screen=picking`; page gate + `picking` canView; `face=picker&held=` server filter | unit tests (Floor / Billing unaffected); a picker session sees only its ids | revert |
| 4 | Supervisor client: `PickingLiveRoot` (one `useLiveFeed`), both legacy markers moved unchanged into a child rendered when not live (Floor/Billing pattern), pure merge + tests, pause queue, selection prune, detail "Changed" bar | tsc/build/tests; two-phone hand test | `live.feed.picking` OFF |
| 5 | Picker client: filtered feed + own-list refetch, legacy marker fallback | two-phone hand test (supervisor assigns → picker sees it; approve → leaves) | switch OFF |
| 6 | (Optional) push → glance | a pushed assign appears at once on an idle phone | revert |
| 7 | Canon: PICKING §10 rewritten (feed path + legacy path), §5.6 live sync line | — | — |

**Quick win that ships alone?** None of Billing's pick-delete class. Picking has no unbounded probe: both markers are indexed aggregates (~10–35 ms server-side), `pick_assignments.picker_id` is already indexed (`idx_pick_assignments_picker_status` — the disk-io report said otherwise), and there is no focus probe or blind poll. Picking's real cost is the **full queue rebuild per change (~2 s, 54 KB)**, which only the by-id path (steps 1–4) removes.

---

## Doc / code disagreements (code wins)

1. **Disk-io §B** "`pick_assignments.picker_id` unindexed" — live has `idx_pick_assignments_picker_status (picker_id, status)` and `uq_pick_assignments_order (order_id)` (pg_indexes, measured). No `checked_at` index (5,970 rows, 1.4 MB — not worth one).
2. **PICKING §10** marker payload `{ count, latest, heldBack, heldBackTrucks }` — code also returns `heldBackUnplanned` (2026-09-21) and folds `getDecisionsLatest()` into `latest` (2026-09-27); the hook also compares `signature`.
3. **PICKING §10** line refs for the shell's markers (`:498`, `:548-554`) → now `picking-mobile-shell.tsx:510-516` and `:560-567`.
4. **PICKING §10** "while `paused` keeps tracking" is right; FLOOR §5's older wording (fixed in the disk-io report) — noted for completeness.
5. **PICKING §5.6** says the picker "can fetch `/api/picking/tint-workload` by URL" — true, and the same holds for the whole board (`/api/picking/queue` gated on `picking` canView only), which is why ids-only feed exposure adds nothing (D.2).

## Decisions for the owner (each with a recommendation)

1. **Supervisor: by-id row patch (Floor-style) vs classifier + full list reload (Billing-style)?** — *Recommend by-id patch.* The rebuild is the expensive, phone-hostile part (~2 s, 54 KB each); patching reads only the changed bills through the same builder.
2. **Picker face: convert now, later, or keep its narrowed marker?** — *Recommend convert second (step 5), with the server-side `face=picker&held=` filter.* Statement count barely moves while he is active; the gain is idle phones dropping from 240 to 60 checks/h and one consistent mechanism.
3. **Switch:** `live.feed.picking` AND `live.feed`, absent = OFF — *Recommend yes* (Billing's pattern).
4. **Phone glance values:** 15 s active / 60 s idle (2 min no touch), nothing while hidden — *Recommend yes*; revisit if pickers report a slow first assignment (then decision 7).
5. **Open detail changed elsewhere:** quiet re-read + "Changed — Reload" bar vs silent defer (today) — *Recommend the bar* (Floor's rule; a picker marking a bill that was just unassigned is the case it prevents).
6. **Own writes on the feed:** patch the acted-on ids instead of a full queue refetch + `resync()` — *Recommend yes.*
7. **Push as a glance trigger** (SW `postMessage` → glance now) — *Recommend yes, as optional step 6*, after the feed itself is proven.
8. **Hard prerequisite:** the 2b-i SQL (incl. `pick_findings`) applied before `live.feed.picking` is switched on — *Recommend yes; step 0.*
9. **Untriggered `users` / `sku_master_v2`** (names, catalog) land at the next full load — *Recommend accept* (same as Floor/Billing).
10. **Tint section:** refetch the whole workload (9.5 KB) when touched vs a by-id path — *Recommend refetch.*
11. **Canon:** rewrite PICKING §10 in the same cycle as step 4 — *Recommend yes.*
