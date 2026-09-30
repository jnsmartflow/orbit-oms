# Code plan — 2026-09-30 — Tint on the live change feed (Manager + Operator)

**PLAN ONLY. No code changed, nothing committed.** Sizing done with read-only SELECTs from temporary `scripts/_tmp_tint_size*.ts` scripts, which were deleted after the runs. The sizing was taken at 13:34 IST on 2026-09-30.

**Files read:**
- `CLAUDE.md`, `docs/CLAUDE_CORE.md` (v117 · Schema v27.47), `docs/CLAUDE_UI.md`, `docs/CLAUDE_TINT.md` (v2.2 · Schema v27.24, which lags CORE; this is normal), `docs/CLAUDE_PICKING.md` §10;
- `components/tint/manager/use-tint-manager-sync.ts`, `components/tint/tint-manager-content.tsx`, `components/tint/tint-operator-content.tsx`, `components/tint/tint-table-view.tsx`, `components/tint/challan-content.tsx`;
- `app/api/tint/manager/{marker,missing-customers,orders}/route.ts`, `app/api/tint/operator/my-orders/route.ts`, every tint write route (by grep for the tables it writes);
- `lib/hooks/use-picking-marker.ts`, `lib/live/*`, `sql/2026-09-30-live-changes-*.sql`, `prisma/schema.prisma`.

**Pattern reused:** Billing 2b and Picking 4a/4b. That means the switch pair, a legacy child that holds the old poll unchanged, the hint key, the held queue, and the "Changed — Reload" strip.

---

## Measured facts (read-only, production)

| What | Value |
|---|---|
| Open tint bills (the 3 open stages) | **19** |
| Tint jobs done today | **7** orders (the UTC-midnight and IST-midnight windows give the same count at 13:34 IST) |
| `tint_assignments` / `order_splits` total rows | 1,243 / 9 (0 active splits) |
| `orders` total / `customerMissing = true` | 16,240 / 554. Of the 554: 322 closed, 172 dispatched, 54 pick_checked, 6 cancelled. After the route's filters, **12 rows** come back |
| **Marker SQL** (the route's predicate, hand-written): EXPLAIN (ANALYZE, BUFFERS) | Index scan on `orders_orderType_idx` (1,216 rows read, 26 kept), plus two hashed sub-plans: a seq scan of `tint_assignments` (1,243 rows, 42 buffers) and a seq scan of `order_splits` (9 rows, 1 buffer). **1.8 ms, 544 buffers, all cache hits** |
| Marker in `pg_stat_statements` (since 2026-09-07 17:59 UTC; the route last changed 2026-09-06) | **3,270 calls**, mean **63 ms**, max **13.2 s** (that max is the outage) |
| **Missing-customers SQL**: EXPLAIN | **Seq scan on `orders`**: 16,240 rows read, 12 kept. **5.4 ms, 696 buffers**. No index on `customerMissing` |
| Missing-customers in `pg_stat_statements` | **2,002 calls**, mean **79 ms**, max **4.5 s** |
| Proposed extra marker aggregate: `GREATEST(max(ta.updatedAt), max(os.updatedAt), max(dc.updatedAt))` | Measured the first two: **0.45 ms, 43 buffers**. `delivery_challans` has 2,513 rows, so an estimated +~1 ms |
| Round trip, dev PC → pooler | `SELECT 1` median **107 ms**. The marker is 104 ms and the extra aggregate 99 ms. **Round trip is the whole cost; the SQL itself is 1–5 ms** |
| `live_changes` today by `sourceTable` (tint-relevant) | `orders` 1,210 rows / 166 ids; **`tint_assignments` 40 / 21**; `delivery_point_master` 10. `order_splits` 0 (no split activity today) |
| `live_changes` rows for **tint orders** today | **214 rows / 27 ids**. Busiest hour 10:00 IST = **74 rows in 73 transactions**; 12:00 = 45; 09:00 = 44 |
| Live triggers (information_schema) | **Present:** `orders`, `tint_assignments`, `order_splits`, `users` (3 each). **Absent:** `tinter_issue_entries`, `tinter_issue_entries_b`, `delivery_challans`, `manual_tint_entries`, `tint_skip_events`, `tint_pause_events`, `slot_master`, `import_raw_*`, `tint_logs` |
| Untriggered table write rates (rows, last 24 h) | `delivery_challans` **48** · `tinter_issue_entries` 14 · `tinter_issue_entries_b` 7 · `tint_pause_events` 1 · `tint_skip_events` 0 · `manual_tint_entries` **0 ever** |

**How many tabs are open?** 3,270 marker calls since 2026-09-07 comes to about 23 days × ~11 working hours ≈ 250 hours, which is **~13 probes/h**. One always-visible Manager tab probes 240/h, so on average **a Tint Manager tab is visible about 5% of the working day**: typically 0 tabs, sometimes 1. The 2,002 missing-customers calls (~8/h) agree with that.
- The Operator makes **no background calls at all** (below). Canon names two operators, each on their own phone.
- A caveat: an entry in `pg_stat_statements` can be evicted and re-created, which undercounts. So treat "≈5%" as a floor, not a fact.

**What that means for the outage log.** The tint marker had 8 statement timeouts and missing-customers had 13 on 2026-09-29. Those queries were **victims of queueing, not the cause**: each runs in 1–5 ms when there is no contention. With `connection_limit=1`, every statement holds the single pooler slot for its round trip. The lever is **statement count and frequency**, not the plans.

---

## A. Inventory — every timer, marker and refetch on tint screens

| # | File:line | Kind | Interval | Endpoint | Statements / call | Measured | Pauses on | Mounted by |
|---|---|---|---|---|---|---|---|---|
| 1 | `components/tint/manager/use-tint-manager-sync.ts:56` → `lib/hooks/use-picking-marker.ts` | Marker probe | **15 s** (`PICKING_MARKER_POLL_MS`); on hidden → no probe; one probe on becoming visible | `GET /api/tint/manager/marker` | **3**: `getHideExclusion`, `getBaseOperatorId`, `orders.aggregate` (3-arm OR). Plus session/permission | SQL 1.8 ms; prod mean 63 ms | `paused` = `panelKey !== null \|\| selection.size > 0`. Still probes; a change is deferred and fires once on resume | Manager page: `/tint/manager`, `/operations/tinting`, `/admin/tint-manager` |
| 2 | `use-tint-manager-sync.ts:72-79` | **Blind refetch** `setInterval` | **60 s** (`SLOW_REFETCH_MS`). The tick no-ops when hidden or paused; the interval itself is never cleared | calls `onChange` = #3 + #4 | **~40–54** (#3) + ~3 (#4) | — | `pausedRef`, `visibilityState` | same |
| 3 | `tint-manager-content.tsx:175` `fetchBoard` | Full board reload | on mount, on every marker change (#1), every blind tick (#2), after every manager write (assign :463, reorder :768, base-bypass/undo, splits, remove…) | `GET /api/tint/manager/orders` | 6-way `Promise.all` (serialised on 1 connection) + import lookups ≈ **40 today** (0 splits, so the split sub-trees stop early); **~54** with active splits. The disk-io report says "~50+" | not measured end to end (no login used; see memory) | — | same |
| 4 | `tint-manager-content.tsx:194` `fetchMissingCustomers` | Side list reload | with every #3 from #1/#2, and on mount | `GET /api/tint/manager/missing-customers` | ~3 (hide + 1 seq-scan query + auth) | SQL 5.4 ms; prod mean 79 ms | — | same |
| 5 | `tint-manager-content.tsx:206-207` | Init | once | orders + operators (+ #4) | — | — | — | same |
| 6 | `tint-table-view.tsx:336` | `setInterval(setNow)` | 60 s | **none** — a render clock only | 0 | — | — | inside the manager |
| 7 | `tint-operator-content.tsx:527` `fetchOrders` | Operator list reload | **only** on mount (:646) and after his own actions (:670, 698, 1262, 1482, 1518, 1540) and the modals (:2822, 2835, 2849). **No marker, no timer** | `GET /api/tint/operator/my-orders` | 4 parallel queries with deep includes + import lines/summary + `tinter_issue_entries(_b)` ≈ **~25** | — | n/a | `/tint/operator`, `/operations/tint-operator` |
| 8 | `tint-operator-content.tsx:855` | `setInterval(update, 1000)` | 1 s | **none** — the elapsed-time clock | 0 | — | — | operator |
| 9 | `components/tint/challan-content.tsx:127/154/219` | Challan list / one / save | on demand only | `/api/tint/manager/challans…` | — | — | — | `/tint/manager/challan`, `/challan` |
| 10 | TI report, shades, sampling library, Tint Summary report | on demand only; no timers (grep: no `setInterval` / marker / `useLiveFeed` under `components/tint` other than #1, #2, #6, #8) | — | — | — | — | — | — |

**No tint push exists.** There is no `sendToUser` under `app/api/tint` or `lib/tint`. The service worker's tag pattern is picking-only.

## B. What each screen shows, and which tables feed it

**Tint Manager** (one response from #3 renders both the rail and the grouped table; `components/tint/manager/rows.ts`):

| Section of `/api/tint/manager/orders` | Feeds | Triggered? |
|---|---|---|
| 1 `activeOrders` — the 3 open stages | orders · customer → salesOfficerGroup → salesOfficer · salesOfficerLinks · querySnapshot · tintAssignments(active, take 1) → assignedTo · splits(≠cancelled) → lineItems → rawLineItem · **challan (number, isVoided)** · skipEvents(1) · pauseEvents(1) | orders ✔ · tint_assignments ✔ · order_splits ✔ · **delivery_challans ✘** · skip/pause events ✘ (but see note) · customer masters ✘ (config) |
| 2 `completedTodayOrders` — done today, non-base | the same tree | same |
| 3 `activeSplits` | order_splits → order → customer…, lineItems → raw | order_splits ✔ |
| 4 `completedSplits` — today | same | ✔ |
| 5 `completedAssignments` — today | tint_assignments → order → customer…, salesOfficer | ✔ |
| 6 `allSlots` → `slotSummary` | slot_master | ✘ — **and the client does not use `slotSummary`** |
| + lookups | `import_raw_summary`, `import_raw_line_items` by obdNumber | written with the order at import (orders INSERT ✔) |
| Missing-customers side list (#4) | orders (**all order types**, not only tint) with `customerMissing` | orders ✔ |

**Tint Operator** (`my-orders`): his tint_assignments + his splits (active and done today) with order → customer → area…, import lines/summary, **tinter_issue_entries / _b** (for the TI badge).

**Which write moves what.** From the write-route audit (every `app/api/tint/**` POST/PATCH/PUT/DELETE):

| Write | Tables it touches | Old marker sees it? | Feed sees it? |
|---|---|---|---|
| assign, reorder, base-bypass(+undo), cancel-assignment, manual-entry(+revert), remove, status, splits create/cancel, operator start/done/skip, split done | `orders` (+ ta/os) | ✔ | ✔ |
| **operator pause / resume** | `tint_assignments` + `tint_pause_events` | **✘** (orders untouched, count unchanged) — today only the blind 60 s catches it | ✔ via `tint_assignments` |
| **split start, split status, splits reassign** | `order_splits` | **✘** | ✔ via `order_splits` |
| **tinter-issue (A / B) create** | `tinter_issue_entries(_b)` + `order_splits` + `tint_assignments` | **✘** | ✔ via ta/os (the TI row itself ✘) |
| **challan create / edit / void** | `delivery_challans` (orders untouched) | **✘** | **✘ — missing trigger** |
| customer / SO master edits | masters | ✘ | ✘ (accepted; this is the same today on Floor) |

**Missing triggers:**

| Table | Maps to | Needed? | Why |
|---|---|---|---|
| **`delivery_challans`** | `order` parent `"orderId"` (INS/UPD/DEL) | **Yes** | The board renders the challan number and the void pre-warning. There are 48 writes/day, and nothing else moves when a challan changes |
| `tinter_issue_entries`, `tinter_issue_entries_b` | `order` parent `"orderId"` | **Optional** (decision 5) | Every create also updates ta/os, so it is already caught. Only an *edit* of an existing TI row (`[id]` routes) would be missed. Its only reader is the operator's own list, which refetches after his own save |
| `tint_pause_events`, `tint_skip_events` | — | No | pause/resume write `tint_assignments`; skip writes `orders`. Both are already caught |
| `manual_tint_entries` | — | No | 0 rows ever, and the route also writes `orders` |
| `slot_master` | — | No | only feeds `slotSummary`, which is unused |

**Disagreements with the docs and the disk-io report (the code wins):**
1. The report lists the marker's `tint_assignments(status, completedAt)` / `order_splits(orderId, status, completedAt)` sub-queries as "unindexed (sweep)" and a cost problem. That is true, but they sweep **1,243 and 9 rows in 1.8 ms total**. An index buys nothing at this size. `tint_assignments` has `(orderId)` and `(assignedToId, operatorSequence)` indexes; `order_splits` has only `(assignedToId, operatorSequence)`.
2. `CLAUDE_TINT §1.9` describes the 60 s refetch as belt-and-braces for a failing probe. **It is also the only thing that refreshes the board after a pause/resume, a split start/status/reassign, a TI entry, or a challan change** (the table above). So removing it without widening the marker is a real regression. §1.9 should say so.
3. The report counts `/api/tint/manager/orders` at "~50+" statements. Today it is ~40, because Prisma skips child queries under empty parents and there are 0 active splits. It rises toward ~54 on split days.
4. `CLAUDE_TINT §1.9` says the marker is "the union approximation of the six feeds". It covers orders only, not the child tables (see 2).
5. The report's "Tint manager ≈ 7,000 statements/h" is per **visible** tab. Real usage (≈5% visible) makes Tint's actual share small. It was a victim in the 2026-09-29 outage, not a driver.

## C. Quick win — ships alone, helps while the switch is OFF

**C1. Drop the blind 60 s; widen the marker so it sees everything the 60 s used to catch.**
- `use-tint-manager-sync.ts`: delete the `setInterval` (lines 67-79 and `SLOW_REFETCH_MS`).
  - The failing-probe recovery it claimed is already in `usePickingMarker`: it probes once on becoming visible and resumes after failures, and a failed probe does not stop the loop.
- `app/api/tint/manager/marker/route.ts`: add **one** statement:
  ```sql
  SELECT GREATEST(
    (SELECT max("updatedAt") FROM tint_assignments),
    (SELECT max("updatedAt") FROM order_splits),
    (SELECT max("updatedAt") FROM delivery_challans)) AS m
  ```
  Fold it into the returned `max` (use the larger of the orders max and `m`). The response shape stays the same, so the hook does not change.
  - `@updatedAt` is on all three models. Prisma sets it on every `update`, including pause/resume, split start/status/reassign, TI's ta/os updates, and challan save/void.
  - The query is unfiltered on purpose. Any change to those tables is tint work, and a false "changed" costs one board reload, which is what the blind tick paid every 60 s anyway.
  - Parameterised `$queryRaw`, no user input.
- **Before → after, per visible Manager tab, per hour** (arithmetic in F):
  - busy hour: **~5,200 → ~3,400 statements (−35%)**;
  - quiet hour: **~3,700 → ~1,400 (−62%)**.
- The marker goes from 3 statements to 4. SQL cost goes from 1.8 ms to ~3 ms. Round trips go from 3 to 4 per probe (+~5 ms on Vercel bom1; ~100 ms extra only from the dev PC).
- Board freshness is **better**, not worse: a pause, split change or challan change shows within 15 s instead of ≤ 60 s.

**C2. Take missing-customers off the board reload.**
- Refetch it (a) on mount, (b) on the manager's own writes that can change it (none today; it follows imports and customer master edits), and (c) on a **5-minute visible-only timer**, plus once on becoming visible.
- Stop calling it on every marker change.
- Effect: from 60+/h to 12/h × 3 statements.
- The query itself (seq scan of 16k rows, 5 ms, 696 buffers) is left alone. A partial index `orders("createdAt") WHERE "customerMissing"` would make it ~0.1 ms, but that is DDL; see decision 3.

**C3. Not in the quick win:**
- the marker's OR / sub-query shape: already 1.8 ms; the gain is nil;
- the UTC "today" in the marker, the orders route and my-orders: `CLAUDE_TINT §1.9` says "fix both together or neither". The IST and UTC counts are equal at 13:34 IST; they only differ for jobs done 00:00–05:30 IST;
- the unused `allSlots` query in the orders route: a 1-statement trim, but it changes the payload. Offered as decision 7.

**Parity plan (read-only, `scripts/parity-tint-marker.ts`, snapshot/compare like the earlier parity scripts):**
1. **Static audit** (committed in the plan above, re-checked by a unit test): every tint write route must move `orders.updatedAt`, `tint_assignments.updatedAt`, `order_splits.updatedAt` or `delivery_challans.updatedAt`. A test greps `app/api/tint/**/route.ts` for `prisma.<table>.(update|create|delete…)` and fails if a route writes a board table without one of those four.
2. **Live watch** (read-only, run through a working hour):
   - every 15 s, compute the old signature `(count, max orders.updatedAt)`, the new signature `(count, GREATEST(...))`, and a **board fingerprint** = count + max of `updatedAt` over the tint set's orders, their active ta/os and their challan;
   - PASS = **zero windows** where the fingerprint moved and the new signature did not;
   - also report how many windows the old signature missed (the blind tick's real work) and how many false fires the new one had.
3. **Hook test:** fake clock, no `setInterval` left, and exactly one probe on becoming visible after 10 minutes hidden.
4. tsc, build and all existing suites pass.

## D. Feed design (reusing `lib/live`)

**Switch:** `app_settings 'live.feed'` AND **`'live.feed.tint'`** (absent = OFF). Add `LIVE_FEED_TINT_KEY` and `isTintFeedOn` to `cursor.ts`/`feed.ts`, the `tint` screen to `parseScreen`, and page key `tint_manager | tint_operator` to the changes route gate.

**Manager: classifier + full list reload, NOT a by-id patch (recommended).** Reasons:
- **Size:** the board is 19 open + ~7 done-today bills. A reload is one ~40-statement call, and the busiest hour has ~45 distinct change windows. A by-id path would need `onlyIds` threaded through **5** Prisma trees (two orders sets, two split sets, completed assignments) and a merge for 4 arrays that `rows.ts` groups, sorts and moves between rail and table as stages change. That carries a lot of parity risk for a saving measured in hundreds of statements an hour on a tab that is visible ~5% of the day.
- **Section moves are the common case:** assign moves a bill rail → table, done moves it active → completed-today, a split moves it into the split sections. A patch has to reproduce each move. A reload gets them for free.
- **The classifier is what makes it cheap:** `GET /api/live/changes?screen=tint` narrows the changed `order` ids to **tint orders** with one indexed statement (`id = ANY($1) AND "orderType"='tint'`).
  - Today that drops 1,210 → 214 order rows.
  - A glance whose changes are all non-tint answers "nothing for you" and the client does nothing.
  - `config` changes (hide rules, `delivery_point_master`) → reload.
- **Missing-customers:** the classifier also returns `missingTouched` when any changed id has `customerMissing = true` (same statement, one more column). The client refetches the side list only then, plus on the C2 5-minute timer as a safety net.
- **By-id stays a later option** (decision 2) if Tint usage grows. The seam would be `onlyIds` on the 5 finds, exactly like `getPickingQueue`.

**Operator face: his own jobs only, like the picker filter.** `?screen=tint&face=operator&held=<his order ids ≤ 100>`.
- The server narrows the changed order ids to those in `held` ∪ any order with a `tint_assignments` / `order_splits` row whose `assignedToId` is the session user, active or completed today (one indexed statement via `idx_ta_assignedToId_opSeq` / `idx_os_assignedToId_opSeq`).
- Any hit → one `my-orders` refetch.
- This gives him a **new job appearing without a tap** and a manager's reassign/cancel showing within ~15 s. Today he sees neither until he acts.
- **Push/instant: not in this plan.** No tint push exists, and the brief says to use push only where one already exists. Adding a `tint-assigned-<id>` push is decision 6, a separate step (the SW pattern + NOTIFICATIONS landmine 10).

**Client shape** (mirrors Picking 4b):
- One `useLiveFeed({ scope: "tint-manager" | "tint-operator", screen: "tint", topics: ["order", "config"], params })`.
- `LegacyTintManagerSync` = today's `useTintManagerSync` (post-C1) rendered only when not live, so the OFF path is byte-identical.
- The hint key `orbit.live.tint` avoids start/stop churn.
- Held queue under the E rules, applied once on release.
- Own writes → reload at once, as today.
- IST midnight → full reload.
- The "Changed — Reload" strip when the open detail/panel's bill changed elsewhere.

## E. Pause rules

| Situation | Rule | Today |
|---|---|---|
| Detail panel open (`panelKey !== null`) | **Hold** the reload; show the strip only if the open bill's id is in the changed set | holds (marker `paused`) |
| Rows selected (`selection.size > 0`) | **Hold**; on release apply once. Prune ticks for bills that left the rail (live-only, as in Picking) | holds |
| Drag-reorder in progress (operator sequence) | **Hold** from drag start to the reorder POST's response; then the own-write reload | **not held today** — a blind tick could land mid-drag. The feed fixes it |
| Manual-entry modal / revert modal / split builder / remove / hide / skip-history / pause-history open | **Hold** (treat any open modal as `busy`) | not held (only panel/selection) |
| Challan edit (`/tint/manager/challan`, separate page) | n/a — that page has no feed and no timer; it is not in scope | — |
| Typing in a search/filter input | **Don't hold.** Filters are client-side over the payload, so a reload keeps the filter text (state lives in the component, not the payload). Hold only if a reload would reset focus; verify during the build | — |
| Operator: a job running (timer ticking) | **Don't hold** the list (the running job's own card must update if the manager cancels it) | — |
| Operator: skip / pause / mark-done / TI modal open, or an action in flight | **Hold**; apply once on close | n/a (no sync today) |
| Tab hidden | No requests (feed-core); one glance on visible | marker: same; blind tick: no-ops but the interval keeps running |

## F. Load estimate (statements per hour)

Assumptions:
- Marker 3 statements (4 after C1), board reload ≈ 40, missing-customers ≈ 3, my-orders ≈ 25.
- Busy hour = 10:00 IST: 74 tint-order transactions ≈ **45 distinct 15 s change windows**. Quiet hour ≈ 10 windows.
- A feed glance with no change ≈ 0.5 statements (head cached ≤ 5 s per instance, switch cached 30 s). A glance with changes = range read + classify = 2.
- Pause/split/challan changes that only the widened marker sees: ~10/h busy.

**Per visible Manager tab:**

| | Busy hour | Quiet hour |
|---|---|---|
| **Today** | marker 240×3 = 720 · blind 60×(40+3) = 2,580 · change reloads 45×(40+3) = 1,935 → **≈ 5,240** | 720 + 2,580 + 10×43 = 430 → **≈ 3,730** |
| **After C (quick win)** | marker 240×4 = 960 · reloads (45+10)×40 = 2,200 · missing 12×3 = 36 + on-change 0 → **≈ 3,200** | 960 + 10×40 = 400 + 36 → **≈ 1,400** |
| **After D (feed)** | glances 240×0.5 = 120 · change glances ~150 (non-tint order traffic makes most 15 s windows "have changes") ×1.5 extra = 225 · tint reloads 55×40 = 2,200 · missing ~10×3 = 30 → **≈ 2,575** | 60 (idle cadence at 60 s after 2 min idle) ×0.5 + ~40×1.5 + 10×40 + 36 → **≈ 530** |

The reload dominates the busy hour in both C and D. The feed's big win is the quiet hours and idle tabs (60 s idle cadence, no marker every 15 s), plus correctness (drag/modal holds, open-bill strip).

**Per Operator phone (screen on at the machine):**

| | Busy hour | Quiet hour |
|---|---|---|
| **Today** | **0** background · own actions ~6×25 = 150 | same ~150 |
| **After C** | unchanged, 150 | 150 |
| **After D** | glances 240×0.5 = 120 · change glances ~150×1.5 = 225 · his refetches (own 6 + others' ~4)×25 = 250 → **≈ 600** (+450) | ~60×0.5 + 40×1.5 + ~8×25 → **≈ 290** (+140) |

The operator feed **adds** load: about +450/h per phone in the busy hour (two phones ≈ +900/h). That is the price of new jobs appearing without a tap. The manager-side saving of the quick win (≈ −2,000/h per visible tab) covers it.

## G. Build order (quick win first)

1. **Step 1 — Quick win C1 + C2** (client + marker route; no DB change). Parity script + hook test + write-route audit test. Update CLAUDE_TINT §1.9 (drop "60 s fallback", record the widened marker and disagreement 2). One commit. **Ships alone, useful with the switch OFF.**
2. **Step 2 — SQL (Smart Flow):** `sql/2026-10-xx-live-changes-tint.sql` + `-TEST.sql`. Triggers on `delivery_challans` → `order` parent `"orderId"` (INS/UPD/DEL), plus `tinter_issue_entries(_b)` if decision 5 = yes. No entity widening needed (`order` already allowed). CORE §7: mint the schema version, "applied: pending".
3. **Step 3 — Server:** `LIVE_FEED_TINT_KEY` / `isTintFeedOn`; `screen=tint` in the changes route with the tint narrowing + `missingTouched`; `face=operator` narrowing with `held`. Unit tests on the narrowing rule. Parity: a read-only script replays today's `live_changes` and checks every change window the classifier drops has no tint board fingerprint change.
4. **Step 4 — Manager client:** `useLiveFeed` + `LegacyTintManagerSync` + hint key + E holds (panel, selection, drag, modals) + strip + midnight reload. The OFF path byte-identical.
5. **Step 5 — Operator client:** `useLiveFeed` with `face=operator&held=…` + holds + strip. The OFF path unchanged (no sync, as today).
6. **Step 6 — Canon:** CLAUDE_TINT §1.9 (two paths, one switch), §3 operator live sync; `live.feed.tint` added to the switch list; rollback line.
7. **Later, separate (decision 6):** `tint-assigned-<id>` push → operator instant.

Switch-on prerequisite: Step 2's SQL applied (the challan trigger). Otherwise a challan change waits for the next other change on that bill.

---

## Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| 1 | Quick win: drop the blind 60 s **and** widen the marker with `GREATEST(max updatedAt of tint_assignments, order_splits, delivery_challans)` | **Yes.** Removing the tick alone would regress pause/resume, split and challan freshness |
| 2 | Manager feed: classifier + full reload vs by-id patch | **Classifier + full reload.** Revisit by-id only if the board grows well beyond ~30 bills or Tint Manager is visible most of the day |
| 3 | Partial index `orders("createdAt") WHERE "customerMissing"` (DDL, Smart Flow) | **Not now.** 5 ms and 12 rows; C2's frequency cut is the lever. Revisit if `orders` passes ~50k rows |
| 4 | Missing-customers cadence after C2: 5 min visible + on mount/visible (+ `missingTouched` once on the feed) | **5 min.** The list follows imports and master edits, not tint work |
| 5 | Triggers on `tinter_issue_entries` / `_b` | **Skip for now.** Creates already fire via ta/os; only edits of an existing TI row are missed, and only the operator's own list reads them |
| 6 | Operator push (`tint-assigned-<id>`) for instant new jobs | **Later, as its own step** after Step 5, only if the ~15 s feed latency is not enough at the machine |
| 7 | Drop the unused `allSlots` / `slotSummary` from the orders route (−1 statement per reload) | **Yes, in Step 1**, only after confirming no client reads `slotSummary` (grep finds none today) |
| 8 | Fix "today" = UTC midnight (marker, orders route, my-orders) to IST | **Separate step, all three together** (CLAUDE_TINT §1.9 / §3.11). Invisible in the working day |
| 9 | Operator feed at all (it adds ~+450 statements/h per phone in the busy hour) | **Yes.** The operator never sees a new or reassigned job until he taps today. The quick win's saving pays for it |
| 10 | Holds for drag-reorder and open modals (new behaviour, feed path only) | **Yes.** Today a blind tick can land mid-drag |
