# code-discovery — 2026-10-24 — Canon plan: Add invoices + invoice pairs

**Status:** PLAN, approved by the owner 2026-10-24 with four decisions (below). Read + plan pass at HEAD
`a05769b7` (origin/main). Later batches — possibly fresh sessions — work from this file.
**Owner decisions (2026-10-24):**
1. Create `docs/CLAUDE_ORDER_INVOICES.md` as the owner file, with a router row (in B9).
2. Fix the other sessions' stale lines in the same pass (five tabs, Print v2, TRIP_ACTIONS 18, CI-5,
   v27.68) so each touched file's schema stamp can honestly go to v27.74.
3. Pair leftovers (tint warning, partner line in panel) → ROADMAP, not built.
4. Commit `docs/mockups/add-invoices/` in B10.

Only CORE (schema chain v27.63 → v27.74) is current. No domain file mentions `order_invoices`, invoice
rows, `inv:` ticks, `partlyOnTrip`, the pair token or per-invoice copies / re-deliveries / CIs. Every domain
file is stamped Schema v27.24 and dated ≤ 3 Oct (FLOOR_TRIPS 19 Oct, ship-to only).

---

## Step 1 — Inventory (34 commits)

| Commit | Date | What it changed |
|---|---|---|
| **Invoice pairs** | | |
| `fc21b712` | 10-08 | `lib/floor/invoice-pairs.ts`: board + history rows carry partner OBDs on the same invoice and where each is now (data only) |
| `64324b49` | 10-08 | Live feed carries partners to every row on the invoice |
| `fd0fa9d6` | 10-08 | OBDs sharing an invoice kept adjacent after the spine sort (`keepPairsAdjacent`) — table, route cards, load plans |
| `17a071de` | 10-08 | Render pairs: merged tick + invoice cell, "k of n", partner chips (`pair-cells.tsx`) |
| `6285f6b7` | 10-09 | Pair tick selects all OBDs on the invoice; `pair` colour token (#818CF8) + unbroken bar |
| **Add invoices — phase 1/2** | | |
| `6ac1d51e` | 10-10 | Schema v27.63: `order_invoices` + `order_invoice_lines`; seq-1 row on every new order (import, OBD import, challan create, `sap-row.ts`) |
| `c62a9a11` | 10-10 | `floor_add_invoices` tick + save/undo API, `rules.ts` / `split.ts`, CI search-term shared |
| `c7fef916` | 10-10 | Add invoices modal + detail-panel invoices section + '+n' chip (record only) |
| `32578e8e` | 10-10 | Schema v27.65: live-feed triggers on `order_invoices` |
| **Phase 3** | | |
| `bf34baed` | 10-12 | Schema v27.66 (row = dispatch unit: trip / hold / dispatched columns; per-row keys on copies / re-deliveries / CI); save edits in place (`plan.ts`) |
| `335e874c` | 10-12 | Lock rule "split inside the trip" — new rows inherit seq-1 stop + hold; edit/undo only in one shared state |
| `e0d2989f` | 10-12 | One trip writer (`trip-link.ts`) dual-writing invoice rows + OBD |
| `7203d9f3` | 10-12 | Readers A: trip screens / sheet / reports / lookup / find-bill read stops through invoice rows (`trip-read.ts`) |
| `912f17ec` | 10-12 | Readers B: Floor queries + search, picking gate + sync, Print, billing sync, load plan, live-trips, show |
| `a4fcbc72` | 10-13 | Readers C: trip actions + guards (bills / cancel / dispatch), pick-delete, refusal, challan board, off-floor, tint base feed |
| **Phase 4** | | |
| `e11e7115` | 10-13 | Invoice rows on board payload + search by any invoice number (Floor, trip lookup, sheet, CI) |
| `94a18e3f` | 10-13 | Schema v27.67: live-feed triggers on `order_invoice_lines` |
| `79274c13` | 10-13 | Kg per invoice from learned SAP kg per tin (`kg-per-unit.ts`) |
| `e8942595` | 10-13 | One Floor row per invoice (table, hold, cancelled, selection, freight queries) |
| `d2852ebd` | 10-13 | Repeat OBD on every invoice row (owner) |
| `30293890` | 10-13 | Detail panel scoped to an invoice (`detail-scope.ts`) |
| **Phase 5** | | |
| `668089fc` | 10-13 | P5-1: per-invoice trip data + litres/kg totals (`invoice-load.ts`), no UI change |
| `c10dffaf` | 10-15 | P5-2: per-invoice trip writer `setRowsTrip`; Schema v27.69 `orders.partlyOnTrip`; board arms 3/4 + desk rule; refusals per invoice |
| `366eada2` | 10-17 | P5-3: per-invoice ticks on Floor (`inv:` keys), amber split-across-places bar/chip |
| `34b7c6ab` | 10-17 | Confirm before adding ticked bills to a rail trip *(trips — same files)* |
| `c460367a` | 10-17 | Move ticked bills between trips with confirm *(trips — same files)* |
| `68f10b94` | 10-17 | P5-4: copies + re-deliveries keyed by invoice row (behaviour unchanged); PART 7 gate SQL |
| **Phase 6** | | |
| `92dfe7fa` | 10-19 | 6.1: hold / release per invoice, On hold tab per invoice, `hold.ts` + `mirrorObdHoldSafe` in every OBD hold writer; Schema v27.72 `orderInvoiceIds` on status logs; hold-mirror rerun SQL |
| `6ec2d7c5` | 10-19 | 6.1 fix: panel Hold / Release act on the scoped invoice |
| `3e319529` | 10-19 | 6.3: CI per invoice (`ci-plan.ts`) + held invoice can't join a trip |
| `4c97fd2f` | 10-19 | 6.4: per-invoice dispatched + OBD done rule (`dispatch.ts`, unsplit mirror) |
| `a05769b7` | 10-23 | P5-5: per-invoice copies + re-deliveries; Schema v27.74 (PART 7 + 6c recorded); links fallback dropped |
| **Pre-feature, same files** | | |
| `d51e7671` | 10-07 | Billing Print "Copy inv" (Schema v27.61) — base for P5-5's per-invoice Copy inv |
| `9ee92a8b` | 10-06 | Floor search by full OBD / invoice / SO — base extended by `e11e7115` |

**Other sessions' commits on the same canon** (not ours, but each leaves a stale line in a file we will
edit): `c6d6a8c7` CI bill-to / ship-to (v27.70, reverses CI §13 CI-5 for display) · `faf42277` OBD import
source (v27.68, missing from IMPORT) · challan slices (Floor now has 5 top tabs) · Print v2 (v27.56 — BILLING
§7/§10 were already stale) · ship-to free text commits (touched `trip-sheet/load.ts`, Floor).

## Step 3 — Live read-only check (24 Oct 2026, data stamp 02:59 UTC)

Script: scratchpad `_canon-check-oi.ts` (one UNION ALL of counts + the split-OBD list; not in the repo).

| Fact | Live |
|---|---|
| orders (not removed) | 20,463 · 0 without an invoice row |
| `order_invoices` rows | 20,518 (sap 20,515 · manual 3) |
| `order_invoice_lines` rows | 4 |
| Split OBDs | **1** — order 18648 (OBD 9109951956), pick_checked; rows 716 + 714 on trip 1140, 713 + 715 on trip 605; none held / dispatched |
| Rows held / on a trip / dispatched (all) | 193 / 6,019 / 7,361 |
| Split rows held / on trip / dispatched | 0 / 4 / 0 |
| Split OBDs on >1 stop | 1 (18648) |
| `orders.partlyOnTrip` = true | 0 |
| CIs | 231, all with `orderInvoiceId`; 0 on the split OBD |
| `trip_bill_copies` | 857 (0 on a seq>1 row) |
| `trip_redeliveries` | 74 (2 on seq>1 rows: 28 → 713, 86 → 715) |
| NULL `orderInvoiceId` copies / redel | 0 / 0 |
| Invoice pairs | 22 invoices, all 2-OBD (code comment says 21 on 10-08) |
| `floor_add_invoices` tick | Ajay Vansiya #29, Dhanraj Shah #30, Priya Chaudhari #31 (view/edit); no `role_permissions` row |

## Step 4a — What is stale or missing

**CLAUDE_FLOOR.md** (v1.9, 3 Oct)

| Section | Stale / missing | Source |
|---|---|---|
| §1 access + ownership | No `floor_add_invoices` tick (needs `floor` canEdit too); no rows for pairs / Add invoices / per-invoice actions | c62a9a11, fc21b712 |
| §2 screen | FALSE "four top tabs" — 5 (challan); Cancelled is "Cancel & CI". Missing: one row per invoice, OBD repeated, "k/n", pairs adjacent | e8942595, d2852ebd, fc21b712 |
| §2.1 tab rules | FALSE pool test `tripDropId === null` → "any invoice row in pool, held invoice not"; "no amber" — split bar/chip are amber | c10dffaf, 366eada2, 92dfe7fa |
| §3 board predicate | FALSE arm 3 `tripDropId IS NULL` → `HAS_ROW_OFF_TRIP_WHERE` (+`partlyOnTrip`); arm 4 + desk rule gained the seq>1 row branch; all cited line numbers drifted | c10dffaf (v27.69) |
| §3 Hold / Cancelled | FALSE `floorHoldWhere` = 2 arms (arm 2 = held invoice row of a split OBD); Cancel & CI carries per-invoice CI rows; payload fields `invoicePartners`, `invoiceRows`, kg per invoice missing | 92dfe7fa, 3e319529, 79274c13 |
| §4.1 / §4.2 actions | FALSE "`{action, orderIds[]}`, exactly five" — eight; hold/unhold take `invoiceRowIds` via `hold.ts`; release per invoice; cancel/CI per invoice; held invoice can't join a trip | 92dfe7fa, 6ec2d7c5, 3e319529 |
| §4.6 selection / bottom bar | Missing pair tick → all OBDs on the invoice; `inv:<id>` + `rd:` keys; "1 invoice · 2 OBDs"; Add invoices needs all invoices ticked; FALSE "no confirm" | 6285f6b7, 366eada2, 34b7c6ab, c460367a |
| §4.7 detail panel | Missing: scoped to an invoice; invoices section; Add invoices modal + '+n' chip; save/undo API; lock rules (first split allowed on trip/held, rows inherit; edit/undo only one shared state; refused if any row dispatched or any CI) | 30293890, c7fef916, bf34baed, 335e874c |
| §4.9 bill table | Missing pair drawing (rowspan tick + invoice cell, partner chips, 3-state bar, dashed in-block line), per-invoice "k/n", amber away chip, kg per invoice, search by any invoice, amber search-hit mark | fc21b712–6285f6b7, e11e7115 |
| §4.10 HoldTable | Missing per-invoice rows + hold/release per invoice | 92dfe7fa |
| §5 live sync | Missing `order_invoices` / lines triggers feed the board | v27.65, v27.67 |
| §10 landmines | Missing: never hardcode 2 in pairs; `HAS_ROW_OFF_TRIP_WHERE` + arm 4's 2nd branch kept for query speed; unsplit row `isHeld` never read | c10dffaf, 6.1 |
| §11 key files + change log | ~25 files missing (pair-cells, add-invoices-dialog, detail-invoices, bill-ref-cells, invoice-pairs, invoice-rows, detail-scope, invoices API…); no change log since 3 Oct | — |

**CLAUDE_UI.md** (v5.39)

| Section | Stale / missing | Source |
|---|---|---|
| §2.1 families table | No `pair` row — `DEFAULT #818CF8`, Floor pair/split bar only, periwinkle not brand (violet = selected); `warn` row doesn't list split-across-places bar/chip or search hit | 6285f6b7 |
| §1 philosophy | Amber now also "invoice split across places / pair member not ready" | 6285f6b7, 366eada2 |
| §8 cards / §27 fixed tables | Missing pointer for pair/split row drawing (rowspan cells map positionally, dashed in-block line) and the Add invoices modal | fc21b712, c7fef916 |

**CLAUDE_FLOOR_TRIPS.md** (v1.3)

| Section | Stale / missing | Source |
|---|---|---|
| §3.5 columns | FALSE "`orders.tripDropId` the one trip pointer" — membership is `order_invoices.tripDropId`; `orders.tripDropId` derived (lowest-seq row); `partlyOnTrip` missing | e0d2989f, c10dffaf |
| §7 drops | FALSE "a bill is on at most one trip", "removing sets `tripDropId=null`" — remove strips only that trip's rows via `setRowsTrip`; cancel row-wise | c10dffaf |
| §13 invariant table, §15 landmines 7/8 | FALSE "one `orders.update` per bill, `tripDropId` only" — writer is `setRowsTrip` (rows, then one `orders.update` with derived `tripDropId` + `partlyOnTrip`); remove-path URL-trip check needs re-read | e0d2989f, c10dffaf |
| §4 isReady, §8 carry, §14 dispatched writers | Missing per-invoice dispatched + OBD done rule; FALSE "no path writes `dispatched`" | 4c97fd2f |
| §8 / new | Missing: stops read through invoice rows (readers A/B/C); per-invoice litres/kg, counts per OBD | 7203d9f3, 912f17ec, a4fcbc72, 668089fc |
| Re-deliveries (new section) | Missing entirely (even v27.53): one row per invoice row per trip, per-invoice attempt/prevTripId, dialog ticks single invoices, refusals, `/redeliveries` route | 68f10b94, a05769b7 |
| Copies | BILLING owns; FLOOR_TRIPS only cross-ref | — |
| §17 open items 5 / 6 | FALSE "move between trips not built" (built); "held bills on trips undecided" (decided: held invoice can't join) | c460367a, 3e319529 |
| §1/§3.3/§12/§16 (other debt) | `TRIP_ACTIONS` 18 not 14; `lib/trips` 21 files not 9; take-back lock removed; `billingDoneAt` missing; `lib/order-invoices/*` absent from key files | v27.53, v27.56 |

**CLAUDE_BILLING.md** (v1.0, 18 Sep — pre Print v2)

| Section | Stale / missing | Source |
|---|---|---|
| §1, §4, §7, §10 | Still slice 9: "invoice numbers distinct", "never a partial set", `invoices_copied` / `copyTripInvoices` — all FALSE. Missing Print v2 (OBD numbers, ready / review, Done + reopen, `billingDoneAt`, `order` + `done` routes), Copy inv (v27.61), `trip_bill_copies` one row per invoice row per trip, split bill one line per invoice with own copy state, whole-OBD pre-split copy covers every invoice (copy 276), Copy inv per-invoice numbers | v27.56, d51e7671, 68f10b94, a05769b7 |
| §6 Picking tab | Reads `orders.invoiceNo` / `invoicedAt` — needs a code read for split OBDs | — |
| Cross-ref line 48 | "UI §10 hide-don't-disable" — target doesn't hold the rule | — |

**CLAUDE_CI.md** (v1.4)

| Section | Stale / missing | Source |
|---|---|---|
| §3 tables | Missing `ci_returns.orderInvoiceId` (all 231 live CIs carry it) | v27.66 |
| §5 search + invoice rule | STALE: search also matches any invoice row's number (lowest seq per OBD); a seq-2+ CI reads that row's number live | e11e7115, 3e319529 |
| §5 | FALSE "a CI never changes `workflowStage`" — a FULL CI counts in the OBD done rule; raising one can set 'dispatched' (only if ≥1 row really dispatched) | 4c97fd2f |
| §1/§7 faces | Missing CI per invoice from Floor (`/api/floor/ci`, `raise-ci.ts`, `ci-plan.ts`), per-row duplicate guard; "Add invoices refused once any CI exists, void incl." | 3e319529, bf34baed |
| §9 auto-CI | Missing explicit note: still whole-OBD (orderId + `auto_finding`; NULL row on a split OBD) — open item | — |
| §13 CI-5, §14 key files | CI-5 reversed for display by v27.70 (other session); 5 key files missing | c6d6a8c7 |

**CLAUDE_PICKING.md** (v1.19)

| Section | Stale / missing | Source |
|---|---|---|
| §5.2 gate, lines 47-48, key files, §10.0 sync | Missing: gate + sync read "any invoice row of the OBD on a shown trip" (`trip-read.ts`); one line "picking stays per OBD (Model A)" | 912f17ec |

**CLAUDE_IMPORT.md** (v1.11)

| Section | Stale / missing | Source |
|---|---|---|
| §2, §4, §6, §7 | Missing: seq-1 row on every new order; patch-headers syncs it; `sap-row.ts` the one mirror writer (reads from `orders`, nulls only, never throws; callers incl. `split.ts`) + a hard rule | 6ac1d51e |
| §4 `import_raw_line_items` | Missing: `totalWeight` read downstream → learned kg per tin per SKU (not stored) | 79274c13 |
| §9 routes | Missing: OBD import route mirrors carried hold onto invoice rows (`mirrorObdHoldSafe`) | 92dfe7fa |
| §3 / §9 (other debt) | v27.68 OBD source card | faf42277 |

**CLAUDE_CORE.md** (v150) — chain complete; gaps elsewhere:

| Section | Stale / missing | Source |
|---|---|---|
| §5 page-key table | No `floor_add_invoices` row (it is in `lib/permissions.ts`) | c62a9a11 |
| §7.3 `order_invoices` block | FALSE "written by nothing yet" — `setRowsTrip`, `hold.ts`, `dispatch.ts` write it | e0d2989f, 92dfe7fa, 4c97fd2f |
| §12 Floor Control | No Add invoices / per-invoice rows / pointer to the owner file | — |
| §13 landmines | FALSE "`isDispatched` is not dual-written yet" (6.4 added `mirrorObdDispatchedSafe`). Missing rules: **only trip writer = `setRowsTrip`**; **only hold writer = `hold.ts`, plus `mirrorObdHoldSafe` in every OBD hold writer**; **never hand-sweep a split OBD — run the dispatched / hold mirror after any SQL sweep**. Drift-repair order 1 → 1b → 2 → 3 → 4 is there — keep, point to it | c10dffaf, 92dfe7fa, 4c97fd2f |
| §15 key lib modules | No `lib/order-invoices/*` | — |

**Router CLAUDE.md** (v1.14)

| Section | Stale / missing |
|---|---|
| §3 | No row for `order_invoices` / Add invoices / `lib/order-invoices/*`; CI row lacks the Floor CI path |
| §4 snapshot | Says CORE v27.35, 18 files — would be 19 with a new owner file |

**ROADMAP.md** — header (3 Oct) and footer (19 Sep) disagree; no Add invoices section; only "loading screen
dispatch" is partly there (line 1197, pre-invoices, says `markBillsDispatched` has no caller — the trip
dispatch route calls it now; re-check).

## Step 4b — Ownership

**Decision: `docs/CLAUDE_ORDER_INVOICES.md`, with a router row.** The model is cross-cutting — single
writers for trip / hold / dispatched / seq-1 mirror, derived OBD columns, the lock rule, per-invoice plan
modules — and feeds Floor, trips, CI, Billing, Picking and Import.

| Behaviour | Owner | Cross-ref from |
|---|---|---|
| Model A, invoice-row columns, derived OBD rules (`tripDropId`, `dispatchStatus`, `workflowStage` done rule, `partlyOnTrip`), single writers, unsplit mirror + drift repair, `lib/order-invoices/*` | **ORDER_INVOICES** | CORE §7 keeps schema; §13 one-line rules + pointer |
| Add invoices: tick + permission, save/undo API, edit in place, lock rules, `blockedReason` | **ORDER_INVOICES** | FLOOR §4.7 (modal + panel UI only) |
| Floor board arms 3/4 + desk rule (as screen behaviour), one row per invoice, "k/n", `inv:` ticks, amber split bar/chip, On hold + Cancel & CI per invoice, scoped panel, search by any invoice | **FLOOR** | ORDER_INVOICES for the why |
| Invoice pairs (shared `orders.invoiceNo`; no schema) | **FLOOR** | UI (token) |
| `pair` token, amber reuse, pair/split row drawing | **UI** | — |
| `setRowsTrip` usage: add / remove strips only that trip / move + confirm; per-invoice totals; re-delivery per invoice; held invoice can't join | **FLOOR_TRIPS** | ORDER_INVOICES (writer contract) |
| Print per invoice: copies, Copy inv, pre-split whole-OBD copy | **BILLING §7** | FLOOR_TRIPS (cross-ref only) |
| CI per invoice, auto-CI still whole-OBD, CI in OBD done rule | **CI** | ORDER_INVOICES (done rule) |
| Pick gate "any invoice on a shown trip" | **PICKING** (FLOOR_TRIPS §11 already owns the gate definition — PICKING adds the invoice wording + pointer) | — |
| Seq-1 row on every new order, learned kg per tin | **IMPORT** | ORDER_INVOICES (`sap-row.ts`, `kg-per-unit.ts`) |

Schema stamps: router §4 forbids bumping without a full reconciliation — a file goes to **v27.74** only if
its batch also fixes the other sessions' stale lines in it (owner decision 2: yes, do it).

## Step 4c — Stale code comments (22, verified in code)

- **prisma/schema.prisma** `:1533-1540` order_invoices header ("PARTs … run; nothing writes them yet") — 6c
  + 7 ran; all 7 state columns written · `:4206`, `:4505` "one row per (trip, bill)" → per (trip, invoice row).
- `lib/trips/redelivery.ts:611-612` "(tripId, orderId) unique, which PART 7 drops" → already dropped.
- **"Totals stay per OBD until Phase 5"** — `lib/trips/queries.ts:462-464`, `lib/order-invoices/trip-read.ts:19-21`,
  `lib/floor/load-plan-check-data.ts:144-145`, `lib/billing/print.ts:286-287`, `lib/trip-sheet/load.ts:179`,
  `lib/reports/trip-detail-data.ts:218` (+ `:253` cites `placeLoad` in `invoice-load.ts`; it lives in
  `lib/floor/invoice-rows.ts`) — split OBDs use `placeLoad`; only counts stay per OBD.
- **"From Phase 5 rows can differ / only a later phase can move one row"** — `lib/trips/drop.ts:41-44`,
  `lib/order-invoices/plan.ts:19`, `lib/floor/invoice-rows.ts:46-48`.
- **"NULL on a split one until Phase 6 assigns it from lines"** — `lib/floor/raise-ci.ts:241`,
  `lib/ci/bill-only.ts:178`, `lib/ci/auto.ts:332`, `app/api/ci/draft/route.ts:150` — a whole-OBD CI stays NULL
  for good (covers every row).
- **"Cancel / Raise CI grey while partly ticked"** — `lib/floor/selection.ts:267-270`,
  `components/floor/floor-bottom-bar.tsx:144-148`, `components/floor/floor-page.tsx:4371-4373`,
  `components/floor/hold-bar.tsx:67-68` (+ dead `offFloorBlock` prop) — since 6.3 only Add invoices needs
  every invoice ticked.
- `lib/floor/dispatch.ts:51-53` "one column … nothing else" — also writes invoice rows now.
- `lib/floor/types.ts:595-596` "per-invoice hold is Phase 6" — shipped (6.1).
- `components/floor/detail-panel.tsx:243-244` "per-invoice On hold / Cancel & CI is Phase 6" — shipped.
- `app/api/floor/trips/[id]/bills/route.ts:42-43` "Floor still sends whole OBDs (P5-3 adds…)" — shipped.
- Possibly: `floor-page.tsx:2498` (History "per-invoice there is Phase 6" — no such item planned);
  `lib/trips/live-trips.ts:56-57` ("nothing writes `dispatched`" — dispatch route does; not this feature).
- Found while writing B1: `lib/floor/invoice-rows.ts` header "The OBD is still the unit of selection …
  in Phase 4" — selection is per invoice since P5-3 (`inv:` keys). `lib/order-invoices/sap-row.ts` header
  "Nothing reads these rows yet in Phase 1" — every trip / hold / CI reader reads them now.

## Step 4d — Batches (no file in two batches)

| # | Files | Content |
|---|---|---|
| B1 | **new** `docs/CLAUDE_ORDER_INVOICES.md` + this plan | Owner file: model, derived rules, writers, mirrors + drift repair, Add invoices + lock rules + permission, plan modules, live numbers, landmines |
| B2 | `CLAUDE_FLOOR.md`, `CLAUDE_UI.md` | FLOOR rows from 4a (pairs, per invoice, arms, ticks, panel, search, hold/CI) + five-tab fix; UI `pair` token, amber, row drawing; + `code-update-2026-10-17-trip-move.md`'s visual part |
| B3 | `CLAUDE_FLOOR_TRIPS.md` | Writer contract, remove/move/confirm, totals, re-delivery section, dispatched, open items 5/6, `TRIP_ACTIONS` 18, file counts, take-back; merge the trip-move draft |
| B4 | `CLAUDE_BILLING.md` | §1/§4/§7/§10 rewrite to Print v2 + Copy inv + per-invoice copies; line 48 cross-ref |
| B5 | `CLAUDE_CI.md`, `CLAUDE_PICKING.md`, `CLAUDE_IMPORT.md` | Rows from 4a; CI-5 + v27.68 so stamps can honestly bump |
| B6 | 22 code files in 4c (+ the two found in B1) | Comment-only edits; `tsc`; verify in an `archive/` worktree |
| B7 | `docs/CLAUDE_CORE.md` | §5 page key, §7.3 "written by nothing yet", §12 pointer, §13 (fix `isDispatched` line; add the three rules; point to 1 → 1b → 2 → 3 → 4), §15 modules, change log + footer v151 (no schema bump) |
| B8 | `docs/ROADMAP.md` | Add invoices section (4e), re-check line 1197, align header/footer |
| B9 | `CLAUDE.md` | §3 row for ORDER_INVOICES, CI row Floor-CI path, §4 snapshot; then VERIFY: grep every "see CLAUDE_X §n" / "→ `CLAUDE_X.md §n`" across all canon and confirm each target heading exists; LF check |
| B10 | drafts + archive | Move `code-update-2026-10-10-floor-add-invoices-grant.sql`, `code-update-2026-10-17-trip-move.md`, and this plan → `docs/prompts/archive/2026-10/` (new folder). The trip-move draft points to `code-update-2026-10-17-rail-add-confirm.md`, which is not in the repo — merge from commit `34b7c6ab` instead. Commit `docs/mockups/add-invoices/` (owner decision 4). Commit; list unpushed; no push |

Each batch: one commit, stage by name, never the other session's files; B6 is the only code-touching batch.
B1 first (others point at it).

## Step 4e — Open items for ROADMAP

1. **Auto-CI per invoice** — `lib/ci/auto.ts` still whole-OBD (orderId + `auto_finding`; NULL row on split).
2. **Loading screen dispatch** — re-check ROADMAP line 1197 (the trip dispatch route now calls `markBillsDispatched`).
3. **Floor board speed on busy afternoons** — baseline: marker ~35 ms (the v27.69 trade-off).
4. **"Vaload / Valod" duplicate area.**
5. **Pair leftovers** — tint warning, partner line in the detail panel (owner decision 3: ROADMAP, not built).
6. **Stale git worktree records** that `git worktree prune` can't remove (Permission denied; includes `_wt-v55`).
7. **`use-tint-manager-live` test** failing (457 / 458).
8. Found: BILLING behind Print v2 since v27.56 (CORE v129 / v134 logged it).
9. Found: Floor History still shows a split OBD whole — decide whether it should go per invoice.
10. Found: dead `offFloorBlock` prop in `hold-bar.tsx`.
11. Found: `rail-add-confirm` draft missing from the repo.
