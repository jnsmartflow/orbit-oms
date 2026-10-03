# code-discovery-2026-10-03 (2) — Challan orders

**Status:** DISCOVERY ONLY. No code, no schema, no data written. Read-only SELECTs against production,
2026-10-03. Follows `code-discovery-2026-10-03-challan-first-orders.md` (`e0c6c321`).

**Files read in full:** `CLAUDE.md` (router v1.14), `docs/CLAUDE_CORE.md` (v125 · Schema v27.53),
`docs/CLAUDE_UI.md` §31–§32 (as asked), `docs/CLAUDE_PLACE_ORDER.md` (v1.9), `docs/CLAUDE_BILLING.md` (v1.0),
`docs/CLAUDE_PICKING.md` (v1.19), `docs/CLAUDE_FLOOR.md` (v1.9), `docs/CLAUDE_FLOOR_TRIPS.md` (v1.1),
`docs/CLAUDE_TINT.md` (v2.2), `docs/CLAUDE_IMPORT.md` (v1.11), the previous report, and for Freight Trips
`docs/CLAUDE_FREIGHT_TRIPS.md` (v1.0) in full plus the opening of
`docs/prompts/drafts/code-discovery-2026-10-01-freight-trips.md`. No stamp is ahead of CORE; nothing stops.
Code was traced by symbol with three read-only passes; load-bearing citations re-checked by hand. Line
numbers as of `10674e7a`.

**Locked decisions this report works inside:** a challan order is created on desktop `/place-order` only,
stored as a normal `orders` row with `ORB-2026-NNNNN` in `obdNumber` plus a new flag, NON-TINT only in
Phase 1, goes straight to picking → check → Floor → trip, never to billing's Picking / Print tabs, prints
on the existing Delivery Challan document with the ORB number, and its later SAP OBD gets a NEW hidden
status shown only in a new Billing "Challan Orders" tab. Below, the flag is called `isChallan`.

---

## Q1. Freight Trips

**What it is.** Live since 2026-10-03, canonised in `docs/CLAUDE_FREIGHT_TRIPS.md` v1.0 (router §3 row).
Report-only PAPER trips over HELD bills for a future freight / MIS report: a bill that is held at the
depot gets a vehicle / transporter / driver recorded on a freight trip, and nothing physical or on the
floor changes.

- **Tables** (v27.51): `freight_trips` (number `F-YYMMDD-NN`, never reused), `freight_trip_bills`
  (membership, partial unique `freight_trip_bills_order_active_key` = one active freight trip per
  `orderId`), `freight_trip_activity`. No `live_changes` trigger by design.
- **Code:** `lib/freight-trips/*` (11 files), `/api/freight-trips/*` (7 route files),
  `components/freight-trips/*`, page `/freight-trips`. 🔴 Never writes `orders`, `trips`, `trip_drops`,
  `trip_activity`, `order_status_logs`.
- **Who uses it:** page key `freight_trips` — live 3 users view + edit; every live freight trip (7, all
  active, 182 active bill rows) was created by **Operations User**.
- **Why held only — the predicate.** The pool is `getFloorHold(..., extraWhere = { freightTripBills: { none:
  { removedAt: null } } })` (`lib/freight-trips/pool.ts:22`, `:36`), i.e. Floor's `floorHoldWhere`
  `{ dispatchStatus: "hold", isRemoved: false }` (`lib/floor/queries.ts:1261`) + hide. The add path refuses
  anything not held right now: `if (o.dispatchStatus !== "hold") … "is not on hold"`
  (`lib/freight-trips/bills.ts:81`). It is held-only **by design** — freight exists to give held bills
  (which ride no Orbit trip) a vehicle in the report (`CLAUDE_FREIGHT_TRIPS.md §1, §5`).

**Could a challan order or its SAP OBD be recorded on one?**
- The **challan order itself** physically leaves on a real Orbit trip — it needs no freight trip (its
  vehicle is the Orbit trip's).
- The **linked SAP OBD** is bill-only and will carry the new hidden status, not `dispatchStatus='hold'`,
  so today it is **refused by both** the pool and the add guard.
- To allow it, the change is two predicates: widen the pool's `extraWhere` path (or add a second source)
  to `OR isChallanLinkedObd`, and relax `bills.ts:81` to "held OR challan-linked". ⚠ But the pool reuses
  Floor's `getFloorHold` and `HoldTable` read-only (`CLAUDE_FREIGHT_TRIPS.md §9` item 9) — a non-held
  source means freight's own query, not an edit to Floor's. The open freight-report rule ("on an active
  freight trip → that vehicle, else its Orbit trip", §10) would, for a challan pair, double-report the
  goods unless the report knows the ORB row and the SAP row are one shipment.

**Answer:** Freight Trips is a live, canonised paper-trip report over held bills (held-only by its pool
and add guard); a challan's SAP OBD can't go on one today, and probably shouldn't need to, since the ORB
row already rides a real Orbit trip.

---

## Q2. Hand-made order — what import fills, what is nullable, what breaks if blank

**Live nullability (pg_catalog, not schema.prisma).** Every SAP-filled column on `orders`,
`import_raw_summary`, `import_raw_line_items`, `import_obd_query_summary` is **nullable live**; the only
live NOT NULL columns all carry defaults (`workflowStage` 'order_created', `priorityLevel` 3,
`sequenceOrder` 0, the booleans; raw lines `isTinting`/`rowStatus`/`lineStatus`; `totalArticle` 0).
🔴 **Prisma is stricter and is what the code obeys:** required in `schema.prisma` —
`orders.obdNumber/batchId/shipToCustomerId/orderType` (`:1049-1058`), `import_raw_summary.batchId/obdNumber`,
`import_raw_line_items.rawSummaryId/obdNumber/lineId/skuCodeRaw/unitQty`,
`import_obd_query_summary.totalLines/totalUnitQty/totalWeight/totalVolume/hasTinting`. A NULL in any of
these breaks every `include` read of the row (Picking and Floor read with `include`). Live: 0 of 16,625
orders have null `batchId`/`orderType`/`obdNumber`; 0 orders have a non-numeric `obdNumber`; 0 start `ORB`.

**What import writes on `orders`** (template `app/api/import/obd/route.ts:1471-1503`, auto ~`:3940-3966`,
SAP `lib/import-upsert.ts:155-183`): `obdNumber`, `batchId`, `customerId`, `shipToCustomerId`,
`shipToCustomerName`, `orderType`, `workflowStage` (`:1446-1449`), `dispatchSlot`, `slotId`,
`originalSlotId`, `arrivalSlotId`, `priorityLevel` (1 for key customer/site, `:1458`), `invoiceNo`,
`soNumber`, `invoiceDate`, `obdEmailDate`, `orderDateTime`, `smu`, `sapStatus`, `materialType`,
`natureOfTransaction`, `warehouse`, `totalUnitQty`, `grossWeight`, `volume`, `customerMissing`. Then the
fallback (`applyNoMailOrderFallback`) adds `dispatchStatus`, stage, `dispatchTargetDate`,
`dispatchWindowId`, `dispatchSlotSource`, `dispatchSlotRuleId`. Then `import_obd_query_summary`
(`:1640-1650`), `order_status_logs`, `import_enriched_line_items` (template/auto only), and
`delivery_challans` (SMU-gated).

**What live screens read, and what goes wrong if blank:**

| Column / table | Reader | If blank |
|---|---|---|
| `obdNumber` | every lines join (`lib/picking/queue.ts:739,1028`, `lib/floor/queries.ts:580`, `app/api/picking/order/[orderId]/route.ts:113`, challan doc) | Prisma error / no lines |
| `batchId`, `orderType`, `shipToCustomerId` | Prisma `include` reads everywhere | Prisma conversion error |
| `customerId` | route / area / bay / delivery type / key-customer sort (`queue.ts:865-870`, `floor/queries.ts:1030`), Floor scope `inScope` (`lib/floor/scope.ts:50-53`), drop key | bill shows only on Floor's **All** tab under "No route" / missing customer; drop keys on `s:<shipToCustomerId>` |
| `shipToCustomerName` | dealer-name fallback (`queue.ts:844-847`, `floor/queries.ts:993`) | "(Unmatched)" |
| `dispatchStatus` | every board arm (`'dispatch'`) | invisible to picking and to Floor at pick_checked |
| `dispatchTargetDate`/`dispatchWindowId` | zone due/upcoming, `byWindow` sort (`queue.ts:817-823`) | treated as due, "no slot" chip — tolerated |
| `orderDateTime` / `obdEmailDate` | FIFO (`queue.ts:955`), hide `daysOld` rule, Floor display date | sorts last |
| `materialType` | `'GIFTS'` zeroes load (`lib/orders/gift.ts:26`) | fine if not GIFTS |
| `smu` | SMU badge, challan list filter, dispatch engine (only Deco Retail slots) | no badge, no auto-slot |
| `import_obd_query_summary` | the ONLY kg / L source for picking, Floor, trips, load plan (`queue.ts:917-919`, `floor/queries.ts:1041-1043`, `lib/trips/queries.ts:467-479`) | 0 L, "+" weight unknown |
| `import_raw_summary` | Floor bill-to line (`floor/queries.ts:543`), challan list + document | no bill-to, challan unfindable |
| `import_raw_line_items` | picker / supervisor detail, Combined, findings, challan lines | empty bill — nothing to pick |

Not read by these screens: `invoiceNo`/`invoiceDate` (display only), `sapStatus`, `natureOfTransaction`,
`soNumber` (duplicate-SO flag only), `import_enriched_line_items`.

**Minimum set a challan order must fill:**
1. One synthetic `import_batches` row (e.g. one per day or per order; `headerFile` prefix like
   `[challan-order]` — §4 of IMPORT: source is readable only from that prefix).
2. `orders`: `obdNumber` (ORB-…), `batchId`, `orderType='non_tint'`, `shipToCustomerId` (the dpm
   `customerCode`), `customerId` (dpm id), `shipToCustomerName`, `orderDateTime` + `obdEmailDate`,
   `priorityLevel` (from dpm key flags), `smu` (owner choice), `materialType` (not GIFTS),
   `workflowStage` + `dispatchStatus` (see Q4/Q5 — `pending_picking` + `'dispatch'` to reach picking),
   `isChallan = true`, optional `totalUnitQty`/`volume`/`grossWeight`.
3. `import_raw_summary`: `batchId`, `obdNumber`, bill-to/ship-to ids and names, `smu`.
4. `import_raw_line_items` per line: `rawSummaryId`, `obdNumber`, `lineId` (10, 20, …), `skuCodeRaw` =
   SAP material, `skuDescriptionRaw`, `unitQty` (tins), `volumeLine` (pack litres × tins),
   `isTinting=false`, `rowStatus='valid'`, `lineStatus='active'`; `article`/`articleTag` via
   `computeArticleInfo` (`lib/article-tag.ts`) if the picker tag is wanted.
5. `import_obd_query_summary` with `orderId` and the five required totals.
6. One `order_status_logs` row. `import_enriched_line_items` not needed. `delivery_challans` only for print (Q8).

⚠ **Weight has no catalog source** — `sku_master_v2` has no weight column. The only per-unit weights are
historical `import_raw_line_items.totalWeight / unitQty` per `skuCodeRaw` (1,139 of 1,339 codes seen in
180 days). Old `sku_master.grossWeightPerUnit` is behind the id-space landmine (code-join only, CORE §13).

**Answer:** live Postgres would accept almost anything, but Prisma requires `obdNumber`, `batchId`,
`orderType`, `shipToCustomerId` and the line/summary keys, and the screens need a customer id, a
`dispatch` status, raw summary + raw lines + a query summary — so a challan order is five table writes,
not one.

---

## Q3. Material code and customer

**How a desktop line is built.** `CartLine` (`app/(place-order)/place-order/types.ts:56-80`) holds
`productId` (= `mo_order_form_index_v2.id`), `family`, `subProduct`, `product`, `uiGroup`, `baseColour`,
`displayName`, `packQtys` keyed `"<packCode>|<unit>"` (`lib/place-order/pack.ts:77`) → **tins**. The data
route already sends `material` on each `RawPack` (`lib/place-order/pack-buckets.ts:18`,
`app/api/place-order/data/route.ts:156`), but the cart drops it.

**Path to the SAP material.** `(product ?? subProduct, baseColour, packCode, unit)` →
`mo_sku_lookup_v2.material` (natural key, `@unique`), `isPrimary = true` — the same join the page itself
uses (`CLAUDE_PLACE_ORDER.md §8`). Never an id (CORE §13). Live:
- 471 active menu rows, **0 with no packs**, 1,354 rendered cells.
- **10 cells map to >1 primary material** — exact duplicate `isPrimary` twins (PROMISE ×7, VELVET TOUCH
  ×2, WS ×1), e.g. `WS MAX|BRILLIANT WHITE|10L` → `5948206` / `IN46359082`. The page's
  `addToPackMap` keeps the first row with **no `orderBy`** (PLACE_ORDER §22) — undefined winner.
- L/LT collapse collisions: 0. Product-level key mixing colours: 0. Every primary material exists in
  `sku_master_v2` (0 of 1,391 missing).
- 220 cells also have a hidden non-primary twin — irrelevant if `isPrimary` is enforced.

**Customer.** The page's `{name, code, area}` is from `mo_customer_keywords` (`data/route.ts:60-67`).
Live: all **712** distinct codes match `delivery_point_master.customerCode` exactly (0 unmatched, 0
multi), **4 only to an inactive dpm row**. So `code` → `delivery_point_master.id` is reliable.
**Ship-to is free text** (`"Name (Code)"` in a string, `cart-panel.tsx:22,26,137`, only with
`place_order_ship_to` canEdit) — not an id; a challan order needs a real picker for
`shipToOverrideCustomerId`, or defaults ship-to to the customer.

**How often lines fail today (proxy).** Mail-order lines, last 30 days: 11,167 matched, 125 partial, 225
unmatched — **350 of 11,517 (3.0%)** with no material. That loss is the email re-parse; a direct
structured insert from `/place-order` skips the parser, so the expected unresolvable rate is the 10
duplicate cells, not 3%.

**Answer:** yes — product + base + pack + unit resolves to one SAP material on all but 10 duplicate-twin
cells (fix the twins or block on >1 match), and the customer code maps 1:1 to `delivery_point_master`;
ship-to is the weak spot (free text).

---

## Q4. Skipping billing — every path onto the Picking and Print tabs

**Picking tab — one predicate.** `buildBillingPendingWhere` (`lib/billing/picking-where.ts:49-83`):
`workflowStage:'pick_checked', invoiceNo:null, invoicedAt:null, isRemoved:false, dispatchStatus:'dispatch'`
+ hide. **A challan order at `pick_checked` matches it today.** Callers (all verified to a client fetch):
the list's pending arm (`app/api/billing/picking/list/route.ts:123` ← `billing-picking-tab.tsx:46`), the
pill count `countBillingPending` (`lib/billing/marker-counts.ts:19-23` ← `picking/marker/route.ts:97` and
`lib/billing/sync.ts:123` ← `billing-live.tsx:261`), the marker key `buildBillingMarkerWhere`
(`picking-where.ts:197-207`), the mark-done guard (`mark-done/route.ts:104`), and the detail route's
`isPending` (`order/[orderId]/route.ts:130`).
- **Smallest change:** add `isChallan: false` to the first object of `buildBillingPendingWhere` — one
  edit covers list, count, marker, mark-done, detail and sync. (Make the column NOT NULL DEFAULT false;
  if nullable use `{ not: true }`, CORE §13 NULL three-valued logic.)
- `buildBillingInvoicedInfoWhere` (`:114-178`) needs `invoiceNo` not null — a challan order can't match.
  The Done "marked" arm keys on `invoicedAt`, only set by mark-done — safe once the above is in.

**Print tab — via trips.** Send to billing: `trip-detail-header.tsx` → `floor-page.tsx` (~`:959`/`:1364`) →
`POST /api/floor/trips/[id]/billing` → `setTripSentToBilling` (`lib/trips/billing.ts:39-113`); writes
`trips.sentToBillingAt/ById` only, refuses a cancelled/dispatched or empty trip (`:49`, `:74`), **no invoice
gate**. Print lists `ON_PRINT = sentToBillingAt not null, status <> cancelled` (`lib/billing/print.ts:279`)
via `loadPrintTrips` (`print/list/route.ts:48-50` ← `billing-print-tab.tsx:40`), the pill
`getPrintCount` (`marker-counts.ts:30-42`), copy `copyTripInvoices` (`print.ts:388` ←
`billing-print-tab.tsx:229`).
- 🔴 **A mixed trip breaks Print.** `loadPrintTrips` counts every non-held bill as eligible
  (`print.ts:216-231`); `ready = eligible > 0 && invoiced === eligible` (`:222`). A challan bill never has
  an invoice, so the trip is **never copyable** (409 "never a partial set", `:404-412`), stays uncopied on
  Print and in the pill **forever**; a challan bill joining a copied trip reopens it for good (`:228`).
- **Smallest change:** in `loadPrintTrips`, select `isChallan` and exclude it exactly as held bills are
  excluded at `:216` (`!o.isChallan`), keeping the row visible with a marker; eligible / invoiced / ready /
  state / copy set / count all follow. Optionally refuse Send to billing when `eligible === 0` (a
  challan-only trip), which `setTripSentToBilling` gets for free because it reuses `loadPrintTrips`.

**Answer:** two predicate edits keep a challan order off billing — `isChallan: false` in
`buildBillingPendingWhere`, and `!isChallan` beside the held filter in `loadPrintTrips` — and the second is
mandatory, or any trip carrying a challan bill can never be copied.

---

## Q5. Floor visibility and trips for a check-done order that never touched billing

**Board arms** (`floorBoardWhere`, `lib/floor/queries.ts:494-510`) — none reads `invoiceNo`, `invoicedAt`,
`batchId`, `soNumber`, `mailMatched`, `slotId` or `billingCopiedAt`:
1. `floorLiveBaseWhere` (`:434-451`): `dispatch`, open picking stage, or `pick_checked` checked/direct-loaded
   **today** → shows.
2. `floorUnslottedWhere` (`:173`): rank < 60 + null status → not a pick_checked bill.
3. `floorCarriedPoolWhere` (`:211-218`): `dispatch` + `pick_checked` + `tripDropId null`, **any date** →
   keeps an unplanned challan bill on the board until it is on a trip.
4. `floorTripBillsWhere` (`:328-337`): `dispatch` and on a live trip → shows.

**Conditions that hide it:** `dispatchStatus` must be `'dispatch'`; the hide exclusion (`isHidden`, HOLD,
`daysOld` on `orderDateTime`); **no `customerId`** → `inScope` drops it from every tab but **All**
(`lib/floor/scope.ts:50-53`) and it lands as "No route"; 0 L without a query summary.

**Trips.** `POST /api/floor/trips/[id]/bills` refuses only cancelled/dispatched trips, removed bills,
bills on another trip, and a Hand mismatch (`handAt` vs `trips.isHand`) — no stage, invoice or billing
check (by rule, FLOOR_TRIPS §13). Drop key `c:<customerId>` else `s:<shipToCustomerId>`
(`lib/trips/drop-key.ts`). Typed lookup `parseBillLookupTerm` accepts only `^\d{9,12}$` / `^I\d{9}$`
(`lib/trips/find-bill.ts:41`) — an `ORB-…` number **cannot be typed in** (ticking from the pool still
works). No trip action requires invoices; `markBillsDispatched` (`lib/floor/dispatch.ts:129-200`) needs
only `pick_checked` and not held — but its only route has **no client caller** (FLOOR_TRIPS §14), so
nothing in the app moves any bill to `dispatched` today ("goods leave" is not recorded for any bill).

**Pick gate.** `picking.visibilityGate` — live **OFF** (SELECT 2026-10-03). Fails closed to OFF. If turned
ON, a waiting challan bill reaches pickers only on a shown trip.

**Answer:** yes — a `pick_checked` challan order with `dispatchStatus='dispatch'` and a real `customerId`
stays on Floor (arm 3 until planned, arm 4 after) and can be added to any trip; nothing about invoices or
billing hides it, but without a `customerId` it hides from every tab except All, and its ORB number can't
be found by typed lookup.

---

## Q6. Pull-back — what today's cancel / hold do, and where a pull-back is safe

| Action | Code | Stages allowed / refused | Writes | Trip | Push |
|---|---|---|---|---|---|
| Floor **cancel** | `app/api/floor/actions/route.ts:56` → `applyBillAction` (`lib/floor/bill-actions.ts:214-241`, `:367-371`) | refuses via `offFloorRefusal` (`lib/floor/off-floor.ts:84-97`): cancelled, dispatched, **on a trip**, `tint_assigned`/`tinting_in_progress`; allows everything else incl. `pick_assigned`/`pick_done`/`pick_checked` | `{workflowStage:'cancelled', dispatchStatus:null}`, `pick_assignments.deleteMany`, one log | refuses, never detaches | none |
| Floor **hold** | same file `:172-178` | refuses only cancelled | `{dispatchStatus:'hold', heldAt}`, one log `FLOOR_HOLD_NOTE` | ignores trip | none |
| Floor **release / unhold** | `lib/floor/release.ts`; `release-stages.ts:16-29`, `:67-72` | `pending_support`/`pending_picking`; held `pick_assigned` → picker removed via `returnAssignedBillToQueue` (`lib/picking/unassign.ts:43`); held `pick_done`/`pick_checked` → hold cleared only; refuses a live CI | slot + `'dispatch'` + `pending_picking` | — | none |
| Floor **Raise CI** | `lib/floor/raise-ci.ts:144`, `:267-275` | Floor-cancel refusals + CI guards | CI, then cancel writes | refuses | none |
| Picking **cancel** | `app/api/picking/cancel/route.ts:165-171`, `:198`, `:229`, `:236` | only `pending_picking`/`pick_assigned`/`pick_done`; refuses live CI; **does not check `tripDropId`** | cancel writes + `pick_assignments.deleteMany` + log | leaves bill on its trip | "Bill cancelled" to the picker (`:268-283`) |
| Billing **pick-delete** | `lib/billing/pick-delete.ts:216-243`, `:731-779` | `offFloorRefusal` + `closed` + needs a live twin + no live CI | claim row, then **compare-and-swap** `updateMany where {id, workflowStage: fromStage}` (409 "changed — refresh"), `pick_assignments.deleteMany`, log | refuses | to the picker |
| Telephonic CI | `lib/billing/telephonic-apply.ts:200-216`, `:422-430` | record-only for removed/dispatched/cancelled, on a trip, tint room | cancel writes + `pick_assignments.deleteMany` + log | refuses | none |

⚠ **Canon drift found:** `CLAUDE_FLOOR.md §4.1` says Floor cancel is "Not stage-gated"; the code refuses
on-trip / dispatched / tint-room bills through `offFloorRefusal`. Code wins.

None writes `tint_assignments` (except Floor cancel's tint split stop). Every write lands in `live_changes`
through the DB triggers, so a new writer is visible to every screen for free.

**Can a pull-back reuse them?** Not as-is — all of them write `cancelled` (which puts the bill on Floor's
Cancelled tab — the thing the decision avoids). A pull-back should be a **new writer** that copies:
pick-delete's claim + compare-and-swap, the one-`orders.update` / `pick_assignments.deleteMany` / one-log
order, `offFloorRefusal` for dispatched / on-trip / tint-room, the live-CI check, and Picking cancel's push
when a picker held it. It writes the new hidden status instead of `cancelled`.

**Stage ladder** (`lib/workflow-stages.ts:36-50`): order_created 10 · pending_tint_assignment 20 ·
tint_assigned 30 · tinting_in_progress 40 · pending_support 50 · pending_picking / closed 60 ·
pick_assigned 70 · pick_done 80 · pick_checked 90 · dispatched 100 · cancelled terminal.

| Stage / state | Pull-back |
|---|---|
| `pending_support`, `pending_picking` with no `pick_assignments` row and `tripDropId` null (held or not) | **Safe** — nothing physical happened (same line as `MANUAL_TINT_PULLABLE_STAGES`, `:84`) |
| `pending_tint_assignment` | Safe (Phase 1 has no tint, but the SAP OBD may be tint) |
| `pick_assigned` | **Refuse + warn**, or allow only with a push to the picker (release's picker-removed path) — owner decision |
| `pick_done`, `pick_checked` | **Refuse + warn** — goods off the shelf |
| `tint_assigned`, `tinting_in_progress` | **Refuse + warn** — operator holds it |
| any stage with `tripDropId` set | **Refuse + warn** — on a truck plan |
| `dispatched`, `cancelled`, `closed`, a live CI, `handAt` set | **Refuse** |

**Answer:** today's actions all write `cancelled` and differ in what they refuse, so a pull-back must be a
new writer borrowing pick-delete's compare-and-swap and `offFloorRefusal`; it is safe only before a picker,
an operator or a trip has touched the bill.

---

## Q7. Tint routing

**How a bill becomes tint.** At creation: `hasTinting = validLines.some(l => l.isTinting)`, `orderType =
hasTinting ? 'tint' : 'non_tint'`, stage `pending_tint_assignment` or `pending_support`, tint slot null
(`app/api/import/obd/route.ts:1446-1455` template, `:3910-3916` auto, `lib/import-upsert.ts:155-160` SAP).
Line `isTinting` comes from: SAP .xlsx / paste — `itemCategory === "Z007"` (`CLAUDE_IMPORT.md §3.1`);
template and auto — the payload's `Tinting` cell (`parseBooleanCell`, `route.ts:1119`, `:3526`), computed
on the depot PC by `Get-Tinting` (SMU gate + keywords). Branches on `orderType = 'tint'`: Tint Manager Set
A/B (`app/api/tint/manager/orders/route.ts:166-170`, `:304-315`), its marker (`marker/route.ts:131`), the
fallback exclusion (`route.ts:680-686`), picking's tint workload (`lib/picking/tint-workload.ts:177`),
Base bills, Tint Summary, enrichment's slot skip.

**What a challan order must set:** `orderType = 'non_tint'`; every raw line `isTinting = false`;
`import_obd_query_summary.hasTinting = false`; `workflowStage` never `pending_tint_assignment`;
`manualTintEntry = false`; a real `slotId` (non-tint convention).

**What could flip it later:**
- **Re-import / patch:** cannot — `orderType`/stage are locked on the patch path
  (`lib/import-upsert/header.ts:6`), and SAP never sends an ORB number.
- 🔴 **Manual tint entry ("Add to Tint", `M`):** `app/api/tint/manager/manual-entry/route.ts:230-239` flips
  `non_tint` → `tint` / `pending_tint_assignment` and sets lines `isTinting=true` for any bill at
  `pending_support`/`pending_picking` (`:151`), gate `tint_manager` canEdit. A challan order WITH raw lines
  passes it. **Needs a guard** (refuse `isChallan`).
- **Mail-order enrichment** writes by `soNumber` (`route.ts:375-378`, bill-only hold `:395-420`) — it
  never changes `orderType`, but if the ORB row ever carries the real SO it is hit, and it also becomes a
  duplicate-SO twin (`lib/picking/duplicate-so.ts:113-127`) of the SAP OBD.
- Splits are tint-only — not applicable.

**Answer:** tint is decided once at creation from line `isTinting` → `orderType`; a challan order set to
`non_tint` with non-tint lines stays non-tint, except that Tint Manager's manual "Add to Tint" can flip it
and must refuse challan orders.

---

## Q8. Challan print

**The document** (`components/tint/challan-document.tsx`, data from GET
`app/api/tint/manager/challans/[orderId]/route.ts`):

| Field | Source | ORB order with no SAP data |
|---|---|---|
| Challan number (`doc:238`), transporter, vehicle | `delivery_challans` | needs a row — **route 404s without one** (`:84-86`) |
| Company name, address, GSTIN, regd. office | `system_config` (`:149-152`, `:379-388`) | fine |
| OBD number | `import_raw_summary` → else `orders.obdNumber` (`:391`) | ORB number shows |
| SMU (`doc:276`), OBD date (`doc:241`), warehouse | `import_raw_summary` only (`:392-396`) | blank ("—") unless a raw summary is written |
| Bill-to name / code | `import_raw_summary` (`:403-405`) | blank unless written |
| Bill-to address / contact | `delivery_point_master` + contacts by bill-to code (`:163-181`, `:300-309`) | blank unless written |
| Ship-to name / address / code / route / area | `shipToOverrideCustomerId` else dpm by `rawSummary.shipToCustomerId ?? orders.shipToCustomerId` (`:158`, `:279-288`) | **resolves** if `orders.shipToCustomerId` holds the dpm code |
| Sales officer | PRIMARY link → group → contact (`:325-357`) | resolves from ship-to |
| Site contact | contacts (`:311-323`) | resolves |
| Lines (SKU via `resolveFiniMap`, qty, volume, Tint column, formula) | `import_raw_line_items` by obdNumber (`:115-128`), formulas `delivery_challan_formulas` (`:143-146`) | **empty table** unless raw lines are written |
| Totals block | `import_obd_query_summary` (`:131-140`) | hidden when absent (`doc:484`) |

- **The list breaks first:** `app/api/tint/manager/challans/route.ts:9`, `:55-68` starts from
  `import_raw_summary` filtered to SMU Retail Offtake / Decorative Projects — an ORB order is invisible.
- The challan number is `delivery_challans.challanNumber` (UNIQUE, `CHN-YYYY-NNNNN`, allocated by import
  only — previous report Q4). The decision "ORB number instead of CHN" means either a `delivery_challans`
  row whose `challanNumber` = the ORB number (it is free text; UNIQUE holds since ORB ≠ CHN), or the
  document reading `orders.obdNumber` when `isChallan`.

**Gates.** Both API routes: `tint_manager` canView (GET `:35`), canEdit (PATCH `:531`). Page
`/tint/manager/challan`: layout `tint_manager` canView (`app/(tint)/tint/manager/layout.tsx:26`) **plus**
`requireRole([TINT_MANAGER, ADMIN, OPERATION_MANAGER])` (`challan/page.tsx:13`) — a job-title gate with no
superuser arm (CORE §13). `/challan`: `requireRole([TINT_MANAGER, ADMIN])`. The `delivery_challans` page
key gates only the sidebar row.

**Could Floor reach it?** Live `floor` canEdit holders: Prakash, Ajay Vansiya, Priya Chaudhari, Dhanraj
Shah, Harsh, Chandresh Kolgha, Operations User. Live `tint_manager` canView: Deepanshu Thakur, Prakash,
Harsh, Chandresh Kolgha. So **Operations User — the main Floor desk user and creator of every freight
trip — cannot open the challan page** (no tick, and the role gate refuses `operations`); Ajay, Priya and
Dhanraj cannot either. Only Prakash, Harsh and Chandresh hold both.

**Answer:** not as it stands — the list filters by SAP SMU, the detail 404s without a `delivery_challans`
row, and the lines come only from `import_raw_line_items`; with a raw summary, raw lines and a challan row
written under the ORB number it would render fully, but the people who run Floor (Operations User) can't
open the challan screen today.

---

## Risks

1. **Print tab blocked forever** by any challan bill on a trip unless `loadPrintTrips` excludes it (Q4).
2. **Billing Picking tab** shows challan orders at `pick_checked` unless `buildBillingPendingWhere` excludes them (Q4).
3. **Manual tint entry can flip a challan order to tint** (Q7).
4. **Five-table write per order** with Prisma-required fields; a raw-SQL or partial write leaves a row
   that breaks every `include` read (Q2). Never `$transaction` (CORE §3) — so the create needs an ordered,
   restartable sequence (orders last, or a cleanup path), like `lib/ci/auto.ts`'s claim/write pattern.
5. **`soNumber` on the ORB row** makes it an enrichment target and a duplicate-SO twin of the SAP OBD;
   keep it null and store the link elsewhere (Q7).
6. **ORB number not typeable** in trip lookup / re-delivery (`find-bill.ts:41`) or Floor numeric search
   (`lib/floor/search.ts:62`) (Q5).
7. **No customerId → bill hides** on every Floor tab but All (Q5); ship-to on Place Order is free text (Q3).
8. **10 duplicate-twin cells** give an undefined material (Q3).
9. **No weight source** for kg on the trip / load plan (Q2).
10. **Nothing records `dispatched`** for any bill today (FLOOR_TRIPS §14) — "goods leave" has no event, so
    the challan ageing list cannot key on dispatch.
11. **Challan screen gated to tint roles** — the Floor desk can't print (Q8). The page's `requireRole`
    ignores ticks and the superuser flag.
12. **`dispatchStatus` must be `'dispatch'`** for every board; a challan order created at
    `pending_support`/null would sit in Floor arm 2 waiting for a release Floor has no button for
    (`CLAUDE_FLOOR.md §10b`) — create it at `pending_picking` + `'dispatch'` directly.
13. **Canon drift:** `CLAUDE_FLOOR.md §4.1` "cancel not stage-gated" is false (Q6).

## Open questions for owner

1. Create the challan order at `pending_picking` + `'dispatch'` (straight to picking, as decided) — with a
   slot from the engine, a manual slot, or none?
2. One `import_batches` row per challan order, or one synthetic batch per day?
3. Store the challan's SAP material at add-to-cart (carry `pack.material`) or resolve at save — and block
   or pick when a cell has two primary twins? Fix the 10 twins first?
4. Ship-to: require a real dpm pick for challan orders, or always ship to the bill-to customer?
5. Challan number: put the ORB number into `delivery_challans.challanNumber`, or have the document show
   `orders.obdNumber` for challan orders with no `delivery_challans` row?
6. Who prints? Give Operations User (and the other Floor desk users) `tint_manager` canView, or move the
   challan print to a key the Floor desk holds — and replace the page's `requireRole`?
7. Pull-back at `pick_assigned`: refuse, or allow with a push to the picker?
8. Should challan orders carry kg (from historical per-code weights) or show weight unknown?
9. The SAP OBD's hidden status: a new `workflowStage` value (21 files key on stages — see the
   `directLoadedAt` reasoning in CORE v27.52) or a flag beside the stage?
10. Freight: should the SAP OBD of a challan pair ever go on a freight trip, given the ORB row already
    rode a real trip?
11. How is "goods left" recorded for the ageing list, given no app path writes `dispatched` today?
