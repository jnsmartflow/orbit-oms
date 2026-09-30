# Code plan — 2026-09-30 — Billing desk on the live change feed (PLAN ONLY)

**Mode:** plan. No code changed, nothing committed. Read-only SELECTs against production were run
(2026-09-30 ~09:00 IST) through a throw-away script, since deleted; every number marked **(measured)** comes from them.
**State at writing:** Floor live on the feed since ~08:52 IST (`live.feed` ON, `48a5e978`); access notebook ON;
triggers live on `orders` + 23 tables (confirmed: `information_schema.triggers`, 24 tables × 3).

**Read:** CLAUDE.md router v1.13 · CLAUDE_CORE §3/§13 · CLAUDE_BILLING v1.0 (whole) · CLAUDE_MAIL_ORDERS (Orders tab + marker) ·
`code-discovery-2026-09-29-disk-io.md` §A/§B/§F/§G · `code-discovery-2026-09-29-live-change-feed.md` §F/§G/§L ·
`code-update-2026-09-30-live-feed-7a.md` / `-7b.md` · `components/billing/**` · `app/(mail-orders)/mail-orders/**` (page, layout, review-view call sites) ·
`app/api/billing/**` (picking, print, telephonic, pick-delete routes) · `app/api/mail-orders/marker` · `lib/billing/**` (pick-delete, print, telephonic, picking-where) ·
`lib/picking/duplicate-so.ts` · `lib/ci/live-ci.ts` · `lib/floor/off-floor.ts` · `lib/live/*` · `sql/2026-09-30-live-changes*.sql`.

---

## A. Inventory — every timer, marker, focus/visibility trigger and duplicate probe (code as of `48a5e978`)

All run on the `/mail-orders` billing face (`billingV2` is `ALL_USERS`). "O" = auth + permission overhead per request; with the access
notebook ON it is ≈ 0–1 statements on a warm lambda (was 5–7 in the disk-io report).

| # | Where (file:line) | What | Interval / trigger | Endpoint | Statements per call (excl. O) |
|---|---|---|---|---|---|
| 1 | `components/billing/billing-marker-provider.tsx:142` (`ActiveBillingMarkerProvider` → `usePickingMarker`), mounted `mail-orders-page.tsx:1553` | Picking marker | 30 s (`BILLING_MARKER_POLL_MS`, `:47`), + one on visible | `GET /api/billing/picking/marker` | 3: hide · `orders.aggregate _count` (pending) · `orders.aggregate _max` (pending ∪ info) (`marker/route.ts:95-106`) |
| 2 | same provider, mounted `:1556` | Print marker | 30 s | `GET /api/billing/print/marker` | ~5–11: `getPrintWorkTripIds` (`trips.findMany` + raw EXISTS) · `trips.findMany id IN` · `loadPrintTrips` · `getPrintMarkerLatest` (1 raw, 3 MAX) (`lib/billing/print.ts:293-368`) |
| 3 | same provider, mounted `:1559` | Telephonic marker | 30 s | `GET /api/billing/telephonic/marker` | 7: `so_tags.count` · `so_tags.aggregate` · `so_tag_matches.aggregate` · `so_tag_matches.count` · **`so_tag_matches.findMany distinct orderId` (unbounded, in memory)** · `orders.aggregate id IN (every matched bill ever)` · `ci_returns.aggregate` same list (`lib/billing/telephonic.ts:444-474`) |
| 4 | same provider, mounted `:1563`, `pollMs = BILLING_PICK_DELETE_POLL_MS` | **Pick-delete marker** | **10 s** (`:57`), + one on visible | `GET /api/billing/pick-delete/marker` | **≈ 14**: see §C (measured **1.2 s** wall per call from the dev PC) |
| 5 | `components/billing/billing-pick-delete-popup.tsx:95-97` | Popup first look | on mount | same pick-delete marker | ≈ 14 |
| 6 | `billing-pick-delete-popup.tsx:98` | Popup re-check | **every change the provider (#4) detects → the SAME heavy marker again** | same | ≈ 14 |
| 7 | `billing-pick-delete-popup.tsx:101-109` | Popup re-check | **every `window` focus** (unthrottled) + `PICK_DELETE_CHECK_EVENT` (History Undo, `billing-pick-delete-tab.tsx:84`) | same | ≈ 14 |
| 8 | `billing-pick-delete-popup.tsx:113-116` | Popup re-check | an Import on this screen finishes | same | ≈ 14 |
| 9 | `components/billing/billing-tab-bar.tsx:119-124` | Telephonic pill count | mount + **every change of #3 → re-fetches the same marker** | telephonic marker | 7 |
| 10 | `billing-tab-bar.tsx:140-145` | Print pill count | mount + every change of #2 → same marker again | print marker | ~5–11 |
| 11 | `billing-tab-bar.tsx:174-183` | Picking pill count | mount + every change of #1 → same marker again | picking marker | 3 |
| 12 | `billing-picking-tab.tsx:182`, pause `:190` (selection / busy); `billing-order-detail-panel.tsx:142` (marking) | Picking list | change of #1, tab open | `GET /api/billing/picking/list` | ~6: hide · pending `findMany` + 2 relation selects · `pick_findings` · done-today `findMany` + 3 selects |
| 13 | `billing-print-tab.tsx:193`, pause `:195` (copy in flight) | Print list | change of #2, tab open | `GET /api/billing/print/list` | ~10 |
| 14 | `billing-telephonic-tab.tsx:390`, pause `:393` (text typed / busy) | Telephonic list | change of #3, tab open | `GET /api/billing/telephonic/list?month=` | ~8 |
| 15 | `billing-pick-delete-queue.tsx:195`, pause `:196` (busy / confirmation panel) — inside the popup | Pick-delete queue | change of #4 while the popup is open | `GET /api/billing/pick-delete/list?month=` | ≈ 14 (the same group work) + lines + catalog + month decisions |
| 16 | `billing-pick-delete-tab.tsx:74`, pause `:75` | History tab | change of #4, tab open | same list | same |
| 17 | `app/(mail-orders)/mail-orders/mail-orders-page.tsx:391-397` | **Orders-tab marker** (every viewer, both faces) | 30 s (`MAIL_ORDERS_MARKER_POLL_MS`, `:100`), **no pause** | `GET /api/mail-orders/marker` | 2: `mo_orders.aggregate` (IST day) · `app_tag_settings.aggregate` → on change `GET /api/mail-orders?date=` (~13–14) |
| 18 | `mail-orders-page.tsx:399-414` | Auto sign-out at IST midnight (`window.location = /api/auth/signout`) | once | — | — (relevant: **Billing needs no midnight reload**) |
| 19 | `mail-orders-page.tsx:362-366` + the `!loading` gate `:1532` | Date change → `loading=true` → **all four billing providers unmount and remount** → 4 fresh probes + 3 tab-bar mount fetches + popup mount check | per date step | 1–4 + 9–11 + 5 | — |

**Hidden tab:** #1–#4 and #17 stop (hook); on visible each fires once; #7 (`focus`) also fires, so returning to the tab costs **two heavy pick-delete calls at once** (#4's visible probe + #7).
**Timers per desk holding all keys:** 5 intervals (#1, #2, #3, #4, #17) = 2 + 2 + 2 + **6** + 2 = **14 marker requests/min** before anything changes.

## B. What each tab shows and which tables feed it

| Surface | Mounted when | Reads | Triggered today? |
|---|---|---|---|
| **Orders** tab (mail orders, the default) | always (billing face) | `mo_orders` (IST day by `receivedAt`) + `mo_order_lines`, `mo_line_status`, `mo_order_remarks`, `users` (punchedBy), ship-to → `delivery_point_master`/area/route, `mo_customer_keywords`, `mo_sku_lookup_v2` (5-min cache), `app_tag_settings` | **`mo_orders`: NO.** `app_tag_settings`, `delivery_point_master`: yes (config). Others: no |
| **Picking** tab | `billing_picking` canView, tab open | `orders` (pending: `pick_checked`, no invoice, `dispatch`, not removed, hide; info: invoiced-not-marked, checked today; done: `invoicedAt` today), `pick_assignments.checkedAt`, `pick_findings` (confirmed), `dispatch_slot_master`, `users` (invoicedBy), `obd_visibility_rules` | `orders`, `pick_assignments`, hide rules: yes. **`pick_findings`: NO** (same gap as today's marker, which reads only `orders.updatedAt`) |
| **Print** tab | `billing_print` canView, tab open (its trip list portals into the left column) | `trips` (`sentToBillingAt`, `billingCopiedAt`), `trip_drops`, `orders` (invoiceNo, hold, updatedAt), `trip_activity` (`bills_added`, `invoices_copied`) | all yes — and the `orders` trigger **already emits `entity='trip'` for any bill on a trip** (`sql/2026-09-30-live-changes.sql:24-25,160,187,203`), so Print can be driven by trip ids alone |
| **Telephonic** tab | `billing_telephonic` canView, tab open | `so_tags` (waiting / matched, month), `so_tag_matches`, `orders` of matched bills, `ci_returns` on them | `so_tag_matches`, `orders`, `ci_returns`: yes. **`so_tags`: NO** (adding / removing / expiring a tag writes only `so_tags`) |
| **Pick delete** — blocking popup (every tab, `billing_pick_delete` canEdit) + History tab (canView) | popup: mounted always for canEdit holders, opens when count > 0; History: tab open | `orders` (SO, stage, isRemoved, tripDropId, updatedAt), `pick_delete_decisions`, `ci_returns`, `trips` (number), `import_raw_line_items` + `sku_master_v2` (lines), customers | `orders`, `pick_delete_decisions` (→ `order` ids from `orderIds`/`keptOrderIds`/`deletedOrderId`), `ci_returns` (→ `order`): yes. Lines: re-import also writes `orders`/`import_obd_query_summary` (triggered) |
| **Tab-bar counts** | always | Picking = pending count (#1); Print = trips with copy work (#2); Telephonic = waiting tags (#3); Pick delete = no count (History label) — the popup carries it; Orders = unpunched mail orders, **derived client-side** from the loaded list (`review-view.tsx:810-813`) | as above |

"Lazy tabs" are **already true** for the bodies: Picking / Print / Telephonic / History lists load only when their tab mounts. What is not lazy is the **count machinery**: four markers + three tab-bar re-fetches run all day regardless of the open tab.

## C. The pick-delete check — why it is unbounded, and a bounded version with the same answer

### Today (`lib/billing/pick-delete.ts:79-90, 251-281, 402-421`)
`getPickDeleteMarker()` → `getActionableGroups()` →
1. `getOpenGroups()` step 1: `orders.findMany { isRemoved:false, stage NOT IN (cancelled, dispatched, closed), soNumber NOT NULL }, distinct: soNumber` — Prisma 5 has no `nativeDistinct`, so **every open row is fetched and de-duplicated in Node**. **Measured: 1,787 open rows / 1,775 distinct SOs; 1,534 of them `pick_checked`** (the ever-growing pool: nothing writes `dispatched`).
2. `getDuplicateGroups()` → `getTwinIdsBySo(1,775 SOs)`: **2 chunked `IN` queries returning 1,791 rows** (measured) → keep SOs with ≥ 2 → `getActiveAllOkSets` (1).
3. `readBills(openIds)`: `orders.findMany` + 4 relation selects (≈ 6 statements; Prisma 5 has no relation joins).
4. **N+1**: `pickDeleteCheck` → `findLiveCi` = one `ci_returns.findFirst` per bill passing the cheap checks, **sequentially** (measured k = 2 today; grows with groups).
5. `pick_delete_decisions.aggregate` + `orders.aggregate where id IN (openIds)`.

≈ **14 statements, ~3,600 rows shipped to the app, 1.2 s wall (measured, dev PC → Supabase)** — every 10 s, plus every focus, plus every change twice (provider + popup). The file header (`:72-78`) and `duplicate-so.ts`'s header both promise "never a scan of the whole table"; step 1 is exactly that scan, done in Node.

### Bounded version — ONE statement, same answer
```sql
WITH grp AS (                       -- the twin rule, grouped in the database
  SELECT "soNumber" AS so, array_agg(id ORDER BY id) AS ids, max("updatedAt") AS latest
  FROM orders
  WHERE "isRemoved" = false AND "workflowStage" <> 'cancelled'
    AND "soNumber" IS NOT NULL AND btrim("soNumber") <> ''
  GROUP BY "soNumber"
  HAVING count(*) >= 2                                            -- ≥ 2 live twins
     AND bool_or("workflowStage" NOT IN ('dispatched','closed'))  -- ≥ 1 bill still open
), live AS (                        -- minus groups covered by an active All OK
  SELECT g.* FROM grp g WHERE NOT EXISTS (
    SELECT 1 FROM pick_delete_decisions d
    WHERE d.kind = 'all_ok' AND d."undoneAt" IS NULL AND d."soNumber" = g.so AND d."orderIds" @> g.ids)
)
SELECT l.so, l.ids, l.latest, EXISTS (      -- "actionable": some bill passes pickDeleteCheck
  SELECT 1 FROM orders o
  WHERE o.id = ANY (l.ids)
    AND o."workflowStage" NOT IN ('dispatched','closed','tint_assigned','tinting_in_progress')
    AND o."tripDropId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM ci_returns c WHERE c."orderId" = o.id
                    AND c."isVoided" = false AND c.status <> 'draft' AND c."returnType" = 'full')
) AS actionable
FROM live l;
```
Marker = `{ count: rows where actionable, latest: max(MAX(pick_delete_decisions.updatedAt), max(latest)) }` (the decisions MAX can be a scalar sub-select in the same statement → **1 statement**). The list reuses the same rows: `readBills` / lines / catalog only for the **shown groups' ids** (13 bills today, not 1,787).

### Equivalence — term by term
| Today | Bounded | Same because |
|---|---|---|
| Step 1: SO has a bill not removed, stage ∉ {cancelled, dispatched, closed}, SO not null; `nonBlankDistinct` then drops blank | `bool_or(stage ∉ {dispatched, closed})` over rows already filtered `not removed, stage ≠ cancelled, SO not null, btrim ≠ ''` | same set of SOs. ⚠ JS `trim()` also strips tabs/NBSP; `btrim` only spaces — **measured 0 rows** where the two differ; the build uses `btrim(x, E' \t\n\r ')` to close it |
| Twins: not removed, stage ≠ cancelled (dispatched/closed count) | the `WHERE` of `grp` | identical predicate (`duplicate-so.ts:107-113`) |
| `ids.length > 1` | `HAVING count(*) >= 2` | — |
| `isAcknowledged`: some active All OK set ⊇ current ids | `d."orderIds" @> g.ids` on `kind='all_ok' AND undoneAt IS NULL` | set containment; served by `pick_delete_decisions_all_ok_live_key` |
| `pickDeleteCheck` allows ⇔ not cancelled (twins already exclude), not dispatched, no trip, not tint_assigned / tinting_in_progress (`offFloorRefusal`), not closed, is a twin with ≥ 2 (always true inside a group), no live FULL CI (`findLiveCi`) | the `actionable` EXISTS | same five conditions; `findLiveCi`'s `where` copied verbatim |
| `openIds` = every bill of every non-acknowledged group; `latest` = MAX over those + decisions MAX | `ids` / `latest` of every `live` row | — |

**Proven on live data (measured, 2026-09-30 ~09:00 IST):** current `{count: 1, latest: 2026-09-30T02:42:47.973Z}` = bounded `{count: 1, latest: 2026-09-30T02:42:47.973Z}`; open ids 13 = 13, identical; shown SOs identical (`1046953937`). A two-scan variant (DISTINCT open SOs ⨝ twins) also matched; the one-scan form above is preferred.

### Size (measured)
| | Today | Bounded |
|---|---|---|
| Statements per marker call | ≈ 14 (+ k CI look-ups) | **1** |
| Rows shipped to the app | ~3,600 | **6** (one per open group) |
| Server time | — | **39.7 ms** execution (EXPLAIN ANALYZE), **724 shared-buffer hits, 0 reads** — one seq scan of `orders` (heap 5.4 MB, 696 pages) + PK probes for the 6 groups + `ci_returns` (tiny) |
| Wall from the dev PC | **1,222 ms** | **114–152 ms** |

Still O(orders) per call — but one in-database pass over a 5.4 MB, cache-resident table instead of three round-trips shipping ~3,600 rows plus N+1. **Optional, owner decision 4:** a partial covering index `ON orders ("soNumber") INCLUDE ("workflowStage","tripDropId","updatedAt") WHERE "isRemoved" = false AND "workflowStage" <> 'cancelled'` would turn the scan into an index-only scan of ~16k small entries; not needed to ship.

**Usable by both paths:** the timer path (switch OFF) simply gets a cheaper `getPickDeleteMarker()`; the feed path calls the same function when §D's classifier says an order change touched a same-SO group.

## D. Feed design for Billing

### Switch
`app_settings 'live.feed.billing'` (absent = OFF). Billing is live only when **`live.feed` AND `live.feed.billing`** are both ON (one global kill switch for every screen, one per screen). `GET /api/live/changes?screen=billing` answers `enabled` = both; without `screen` it keeps today's meaning (Floor unchanged). The route's `PAGE_KEYS_THAT_CONSUME_THE_FEED` gains `mail_orders` (billing staff do not hold `floor`).

### What wakes it
| Entity | Source | New? |
|---|---|---|
| `order` | `orders`, `pick_assignments`, `ci_returns`, `so_tag_matches`, `pick_delete_decisions`, `import_obd_query_summary`, … | existing |
| `trip` | `trips`, `trip_drops`, `trip_activity`, **and** any order on a trip (the orders trigger) | existing |
| `config` | `app_tag_settings`, `obd_visibility_rules`, `dispatch_slot_master`, `delivery_point_master`, `app_settings`, … | existing |
| **`mail_order`** | **`mo_orders`** INSERT/UPDATE/DELETE, id = `mo_orders.id` (`'self'`) | **NEW** — see §"New triggers" |
| **`so_tag`** | **`so_tags`** INSERT/UPDATE/DELETE, id = `so_tags.id` | **NEW** |

Topics asked by Billing: `order,trip,config,mail_order,so_tag` (Floor keeps asking `order,trip,config`, so it never sees the new entities).

### One glance, one classifier call
Reuse `lib/live/use-live-feed.ts` / `feed-core.ts` unchanged (15 s active / 60 s idle, extra glance on input-after-idle / visible / focus ≤ 1 per 3 s, hidden = nothing, backoff, lag handling). The hook is mounted **above** the `!loading` gate (`mail-orders-page.tsx:1532`) so a date step no longer restarts it.

On each glance with changes, **one** `POST /api/billing/sync` `{ orderIds, tripIds, soTagChanged, mailOrderIds, shown: { pickingIds, printTripIds, telephonicOrderIds, pickDeleteIds } }` (the `shown` ids let the server see a bill that LEFT a list). Server, per key the caller holds (each arm gated exactly like its marker route):
| Arm | "Touched" when | Then returns |
|---|---|---|
| Picking | any changed order is `pick_checked`/`dispatched` now, has `invoicedAt` today, or is in `shown.pickingIds` | fresh pending count (1 aggregate) |
| Print | any trip id has `sentToBillingAt` not null now, or is in `shown.printTripIds` | fresh print count (`getPrintWorkTripIds` + `loadPrintTrips`) |
| Telephonic | `soTagChanged`, or a changed order is in `so_tag_matches`, or in `shown.telephonicOrderIds` | fresh waiting count (1 count) |
| Pick delete | a changed order's SO has ≥ 2 live twins now (one `idx_orders_sonumber` probe), or the id is in `shown.pickDeleteIds` | the bounded marker (§C, 1 statement) |
| Mail orders | `mailOrderIds` non-empty, or a `config` change | `touched: true` (client refetches its day list — see below) |

Response: `{ enabled, touched: {picking, print, telephonic, pickDelete, mailOrders}, counts: {…only the touched ones} }`. Classifier cost ≈ 3–4 PK/indexed statements per call.

### Client — the smallest diff
- A new `BillingLiveProvider` implements the **same `BillingMarkerApi` contexts** (`subscribe` / `setPaused`) that the four providers expose today. When `touched.X` is true it fires X's subscribers (the tabs' `load` — unchanged code in `billing-picking-tab.tsx:182`, `billing-print-tab.tsx:193`, `billing-telephonic-tab.tsx:390`, `billing-pick-delete-queue.tsx:195`, `billing-pick-delete-tab.tsx:74`), honouring each context's pause keys exactly like `usePickingMarker`'s `paused` (queue, fire once on release).
- **Counts:** the provider also exposes the counts it received; the tab bar reads them instead of re-fetching markers (#9–#11 disappear in live mode). The popup reads the pick-delete count the same way (#5–#8 disappear).
- **Lazy tabs:** bodies already load on open (§B). A closed tab only has its pill count patched; its list loads when opened, as today.
- **Orders tab:** `mail_order` change (or `config`) → `loadOrders()` (today's handler for a marker change), at most once per glance, deferred by the pause rules in §E. Phase 2 (decision 5): `GET /api/mail-orders?ids=` patch by id.
- **Popup:** opens when the pick-delete count > 0 (unchanged rule). While open, only its "N left" moves; the queue re-reads after each decision (as today) and when the popup's own pause is released. An Import finishing → an immediate glance (not a direct marker call).
- **Legacy fallback:** `<BillingLegacySync>` = today's four `Billing*MarkerProvider`s + the Orders-tab `usePickingMarker`, rendered when the feed is **not** live (off, fallback after errors, or unknown on a browser that never saw it on) — exactly Floor's `LegacyFloorSync` pattern; OFF path byte-identical.
- **No midnight reload** (the page signs out at IST midnight, #18). Render tick not needed (no elapsed-time pills on the billing tabs — to confirm in build).

### New triggers needed (SQL, Smart Flow)
1. **`ALTER TABLE live_changes DROP CONSTRAINT chk_live_changes_entity, ADD CONSTRAINT … CHECK (entity IN ('order','trip','config','mail_order','so_tag'))`** — the CHECK is `sql/2026-09-30-live-changes.sql:118`.
2. **`mo_orders`** → `live_changes_child_*('mail_order','self','id')` via the step-4 generic functions (INSERT/UPDATE/DELETE). The UPDATE diff already ignores `updatedAt` (step-4 design), so `trg_mo_orders_updated_at`'s stamp alone writes nothing. Coverage equals today's marker: the eleven write routes all end on a `mo_orders` write (`app/api/mail-orders/marker/route.ts` header). Est. volume: ~100–150 orders/day × a handful of writes ≈ **500–1,000 rows/day**.
3. **`so_tags`** → `('so_tag','self','id')`. Tiny (19 rows ever, measured).
4. *(Optional, decision 3)* **`pick_findings`** → `('order','parent','orderId')` — a confirmed finding removes the Picking-tab checkbox; today's marker does not see it either (UNVERIFIED whether confirming a finding also writes `orders`; check before deciding).
5. Code: `lib/live/cursor.ts` `LIVE_TOPICS` / `parseTopics` gain the two entities (Floor unaffected — it names its topics).
**Not needed:** `mo_order_lines` / `mo_order_remarks` (writers also write `mo_orders`), `mo_line_status` (accepted gap, marker header item 1), `trips`/`trip_drops`/`trip_activity`/`ci_returns`/`so_tag_matches`/`pick_delete_decisions` (already triggered), `billing_settings` (read per page load).

## E. What must not move under the operator's hand

| Surface | Hold changes (queue; apply once on release) while | Today |
|---|---|---|
| Orders tab | a text field in the orders pane is focused (notes, remarks, SO/customer search, ship-to pencil search); smart copy running (`smartCopyOrderId !== null`); code popover / SKU panel / split / resolve-line panel open (`openCodePopoverId`, `skuPanelOrderId`, …); a punch/actions write in flight | **no pause at all** — `loadOrders` replaces the list mid-action (`mail-orders-page.tsx:391-397`). The feed path adds these holds; the legacy path stays as is |
| Picking tab | rows selected or a write in flight (`billing-picking-tab.tsx:190`); detail panel marking (`billing-order-detail-panel.tsx:142`) | same keys, kept |
| Print tab | copy in flight (`billing-print-tab.tsx:195`); the selected trip is kept by id across a refetch | same |
| Telephonic tab | text typed in the entry box or busy (`billing-telephonic-tab.tsx:393`) | same |
| Pick-delete popup / queue | a decision in flight or the confirmation panel up (`billing-pick-delete-queue.tsx:196`); **while the popup is open the queue never re-orders by itself** — only its count moves; a group that changed under the operator is refused by the server ("Group changed — refresh", `pick-delete.ts:464`) | queue re-reads on every marker change unless busy |
| History tab | Undo in flight (`billing-pick-delete-tab.tsx:75`) | same |
| All | the glance keeps running; only applying waits; counts in the tab bar may update (they move no rows) | — |

## F. Load estimate — one billing desk, one visible hour (all keys)

Assumptions: access notebook ON → O ≈ 1; busy hour ≈ 400 order changes (≈ 1 per 9 s, so most 15-s glances carry one); ~20 mail-order changes/h; ~60 window focus events/h; pick-delete ≈ 14 statements/call today (§C). ESTIMATES except where marked measured.

| | Arithmetic | Statements/h | Requests/h |
|---|---|---|---|
| **Today** | pick-delete: (360 poll + ~60 focus + ~10 change re-checks) = 430 × (14 + 1) = **6,450** · picking marker 120 × 4 = 480 · print 120 × ~10 = 1,200 · telephonic 120 × 8 = 960 · tab-bar re-fetches ~15 × ~7 = 105 · Orders marker 120 × 3 = 360 · lists on change ~35 × ~10 = 350 | **≈ 9,900** (+ ~1.5 M rows/h shipped by pick-delete; **~430 × 1.2 s ≈ 8.6 min of lambda/connection time per hour**, measured per-call wall) | ≈ 1,000 |
| **After step 1 only** (bounded pick-delete, switch OFF) | pick-delete 430 × (1 + 1) = 860 · rest unchanged ≈ 3,450 | **≈ 4,300** (rows shipped ≈ 2,600/h) | ≈ 1,000 |
| **After the feed — busy hour** | glances 240 × 2 = 480 · classifier ~200 × ~5 = 1,000 · touched counts: picking ~10 × 2 + print ~15 × 10 + telephonic ~5 × 2 + pick-delete ~30 × 2 = 240 · open-tab list refetches ~20 × ~10 = 200 · Orders list 20 × 15 = 300 | **≈ 2,200** | ≈ 500 |
| **After the feed — quiet hour** | glances 60–240 × 2 + a few syncs | **≈ 200–600** | ≈ 70–260 |
| Hidden tab | ~0 before and after (+ one glance on return; today: 5 probes + a focus probe) | ~0 | ~0 |

Four desks: **≈ 40,000/h today → ≈ 17,000 after step 1 → ≈ 9,000 after the feed (busy)**. The larger win is not the count but the **shape**: no request ships thousands of rows or holds a connection for a second, which is what drained Supavisor's 15 connections on 09-29.

## G. Build order — small, separately testable, reversible

| # | Step | Test | Undo |
|---|---|---|---|
| 1 | **Pick-delete bounded query** — `getOpenGroups`/`getActionableGroups` rewritten on the §C statement (one `$queryRaw`), `readBills` / lines only for shown groups, `getPickDeleteMarker` = 1 statement. No route, client or schema change. **Ships alone, helps with the switch OFF.** | read-only parity script (`scripts/parity-pick-delete.ts`): old vs new `{count, latest, openIds, shown SOs, per-bill canDelete/label}` on live data, plus the list payload deep-equal; unit test of the pure mapping | `git revert` |
| 1b | Popup: throttle the `focus` re-check (≥ 10 s since the last check) and drop the duplicate provider-change re-fetch by reading the count the provider already fetched *(small client change, optional — decision 2)* | two-window test: popup still opens within 10 s | revert |
| 2 | Telephonic marker bounded — the `distinct orderId` + two `IN (all matched)` aggregates folded into one `$queryRaw` with joins (same MAXes) | parity old vs new marker | revert |
| 3 | **SQL**: widen `chk_live_changes_entity`; triggers on `mo_orders` (`mail_order`) and `so_tags` (`so_tag`) [+ `pick_findings` if decided]; TEST file; CORE §7 schema bump; `cursor.ts` topics; changes route `?screen=billing` + `mail_orders` page key | TEST block: a `mo_orders` update writes one `mail_order` line, an `updatedAt`-only stamp writes none; `so_tags` insert/remove each one line; Floor's glances unchanged | `DISABLE TRIGGER` / drop; revert |
| 4 | `POST /api/billing/sync` (classifier + counts), behind `live.feed.billing` | parity: for a recorded set of ids, `counts` equal the four markers' `count`; `touched` false for an unrelated order | revert |
| 5 | Client: `BillingLiveProvider` (same contexts) + `BillingLegacySync` fallback + counts to tab bar/popup + Orders-tab refetch with the §E holds; `useLiveFeed` mounted above the `!loading` gate | tsc/build/tests; two-PC hand test (punch, mark done, send to billing → Print, copy, telephonic add/match, a same-SO import → popup, idle/hidden, switch OFF → old markers return without reload) | **`live.feed.billing` OFF** |
| 6 | Observe a working day: `live_changes` by `sourceTable`, `pg_stat_statements` calls for the pick-delete/billing statements, Vercel invocations | numbers into CLAUDE_BILLING §8 | switch OFF |
| 7 | Canon: CLAUDE_BILLING §3/§8 rewritten (5 tabs, popup, feed), MAIL_ORDERS marker section, CORE landmine list gains `mo_orders`/`so_tags` | — | — |
| 8 | *(Later)* `GET /api/mail-orders?ids=` by-id patch; incremental per-SO pick-delete | parity | revert |

---

## Doc / code disagreements (code wins)

1. **CLAUDE_BILLING §1/§3** — "three tabs (Orders, Picking, Print)"; code has **five**: + Telephonic (2026-09-22) + Pick delete (History only since 2026-09-28) (`billing-tab-bar.tsx` pills; `mail-orders-page.tsx:297-303`).
2. **CLAUDE_BILLING §8** — "two marker providers, cadence 30 s, mounted `mail-orders-page.tsx:1486-1489`"; code has **four** (+ Telephonic 30 s, + Pick delete **10 s**) plus the blocking popup's own probes, mounted `:1553-1625`. The Orders marker is at `:391-397` (§8 says `:366-372`).
3. **CLAUDE_BILLING** has no section for the blocking Pick-delete popup (`billing-pick-delete-popup.tsx`, 2026-09-28) or the Telephonic tab.
4. **`lib/billing/pick-delete.ts:72-78`** "two bounded steps, never a scan of the whole orders table" and **`lib/picking/duplicate-so.ts:20-24`** "never about the whole table" — `getOpenGroups` step 1 fetches every open row (1,787 measured) and de-duplicates in Node.
5. **Disk-io report §B** — "`mo_orders.receivedAt` unindexed", "`mo_order_lines.moOrderId` unindexed": live has **`idx_mo_orders_receivedAt`** and **`idx_mo_order_lines_moOrderId`** (pg_indexes, measured). Its "S ≈ a few thousand open SOs" is now measured: **1,775**; k = **2**.
6. **`app/api/billing/picking/marker/route.ts` comment** "it polls every 15s" — the provider polls at 30 s (`billing-marker-provider.tsx:47`).
7. **Live-change-feed design §F.1** — response shape `changes: { order: [], trip: [], config: [] }` and "no `after` → `reset:false`"; the shipped route returns `changes: [{ entity, ids }]` and `reset: true` for a head answer (`app/api/live/changes/route.ts`).
8. **Disk-io §A #3** says the tab bar re-fetch is at `billing-tab-bar.tsx:159` etc. — still true; but the doc's "mounted `:1553`" list omits the popup's import-done trigger (#8 above).

## Decisions for the owner (each with a recommendation)

1. **Ship the pick-delete bounded query first, alone, before any feed work?** — *Recommend yes.* Same answer (proven on live data), 14 → 1 statement, ~3,600 → 6 rows, ~1.2 s → ~0.1 s per call, and it helps with every switch OFF. Nothing else depends on it.
2. **Pick-delete cadence with the switch OFF after step 1:** keep 10 s, and throttle the window-`focus` re-check to ≥ 10 s + stop the popup re-fetching what the provider just fetched (step 1b)? — *Recommend yes to all three*: the poll is cheap now; focus + duplicate re-checks were the burst on tab-switch.
3. **New triggers:** `mo_orders` → `mail_order`, `so_tags` → `so_tag` (+ widen the entity CHECK) — *Recommend yes.* **`pick_findings`** → `order` — *recommend yes only if* a read shows confirming a finding writes no `orders` row (today's marker has the same blind spot, so it is not a regression either way).
4. **Partial covering index for the same-SO scan** (§C) — *Recommend not now*; one 5.4 MB cached scan per call is fine. Revisit if `orders` passes ~100k rows.
5. **Orders tab on the feed:** full day refetch on a `mail_order` change (today's behaviour on a marker change) vs a new by-id patch endpoint — *Recommend the full refetch first* (≈ 20/h, same payload as today, removes the 120/h marker); by-id later (step 8).
6. **Switch semantics:** Billing live = `live.feed` AND `live.feed.billing` (absent = OFF) — *Recommend yes*: one global kill switch, one per screen.
7. **One classifier call per glance (`POST /api/billing/sync`) vs "refresh all four counts on any change"** — *Recommend the classifier*: 3–4 cheap statements that usually say "nothing of yours", vs ~25 statements on every busy glance.
8. **Pick-delete latency:** the popup would appear within 15 s (active) instead of 10 s — *Recommend accept 15 s*; if not, Billing can run its glance at 10 s (a `feed-core` option; +50 % glances, still one tiny indexed read each).
9. **Popup while open:** only the "N left" count moves; the queue re-reads after each decision or on release — *Recommend yes* (never re-order groups under the operator).
10. **Orders-tab holds (§E)** apply only in feed mode; the legacy path keeps today's no-pause behaviour — *Recommend yes* (OFF stays byte-identical).
11. **Canon:** rewrite CLAUDE_BILLING §3/§8 and add the popup + Telephonic sections in the same cycle as step 5 — *Recommend yes*; §8 is already stale.
