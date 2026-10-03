# code-discovery-2026-10-03 — Challan-first orders

**Status:** DISCOVERY ONLY. No code written, nothing built, no decision taken. Read-only SELECTs against
production (catalog + counts), run 2026-10-03.
**Feature (context, not a build order):** some orders cannot be billed in SAP today (mostly credit
block). Goods go out on a delivery challan first; billing punches the SO later, pastes it against the
challan, and the OBD that SAP then produces must be linked to the challan, marked bill-only, and never
reach picking / Floor / Orbit trips / dispatch. Lines are matched; an ageing list shows challans with no SO.
**Closest pattern:** the Telephonic tab (`docs/prompts/drafts/web-update-2026-09-21-billing-telephonic-tab.md`,
built through step 6: `lib/billing/telephonic-apply.ts` is live in import).

**Method / reading note (honest):** code was traced by symbol with three parallel read-only passes and
the load-bearing citations re-checked by hand (`app/api/import/obd/route.ts` R1/R2 and the bill-only
gate, `lib/floor/queries.ts` arm 2 + hold, `lib/trips/find-bill.ts`, `lib/floor/search.ts`, the challan
allocator, `prisma/schema.prisma` orders). Canon read: `CLAUDE.md`, `CLAUDE_FREIGHT_TRIPS.md` (full), the
Telephonic draft (full), `CLAUDE_TINT.md §9`, `CLAUDE_CORE.md §13`, `CLAUDE_CI.md §8/§13 (CI-8, CI-14)`;
the other domain files were consulted by section, not read end to end. Line numbers are as of `10674e7a`.

---

## Q1. An order without an OBD

**Schema vs live — they disagree.**

| | `prisma/schema.prisma` | Live DB (pg_catalog `attnotnull`, 2026-10-03) |
|---|---|---|
| `orders.obdNumber` | `String @unique` — required (`:1049`) | **nullable** (`attnotnull = false`), **UNIQUE** (`orders_obdNumber_key UNIQUE ("obdNumber")`) |
| `orders.batchId` | `Int` required (`:1050`), FK `import_batches` | nullable |
| `orders.shipToCustomerId` | `String` required (`:1054`) | nullable |
| `orders.orderType` | `String` required (`:1058`) | nullable |
| `import_raw_line_items.obdNumber / rawSummaryId / skuCodeRaw / unitQty / lineId` | required | all nullable live |

- Live, the only non-PK/FK constraint on `orders` is `orders_obdNumber_key` (no CHECK on any column —
  matches the schema comment at `:1231-1233`). Postgres UNIQUE allows many NULLs, so **the DB would accept
  OBD-less orders**; Prisma's generated client would not (the field is a required `string`), and **0 of
  16,619** live orders have a null `obdNumber` today.
- Every NOT NULL column on `orders` live has a default. So the hard blockers are in the CODE, not the DB.

**What assumes an order has an OBD (code wins).** Verdict for (a) `obdNumber = NULL` and (b) a synthetic
Orbit number written into `obdNumber` with matching summary + line rows.

| Area | Where | NULL | Synthetic |
|---|---|---|---|
| **Lines (the root)** | `import_raw_line_items.obdNumber` (`schema.prisma:979`), `import_raw_summary.obdNumber` (`:949`), `import_obd_query_summary.obdNumber @unique` (`:1030`). **No FK from lines to `orders.id`** — every lines view joins by the OBD string; lines also need `rawSummaryId` → `import_raw_summary` → `batchId` | no lines anywhere | fine if Orbit writes summary + line rows under the same number |
| Picking | lines by OBD `app/api/picking/order/[orderId]/route.ts:113`, `app/api/picking/combined/route.ts:128`, `lib/picking/queue.ts:741,1028`; findings copy OBD `app/api/picking/findings/report/route.ts:308` | breaks (OBD-keyed maps merge all NULLs into one entry) | fine |
| Floor | `lib/floor/order-detail.ts:58,65`; `lib/floor/queries.ts:544` (`billToByObd`), `:580` (line map); `lib/floor/search.ts:62` `tokenMatchesObd` does `obdNumber.includes(...)` → throws on null; `components/floor/pdf-preview.tsx:90` `key={r.obdNumber}` | breaks | search half-works (numeric-tail logic) |
| Floor trips | drop key is the **customer**, not the OBD: `computeDropKey` (`lib/trips/drop-key.ts`) → `c:<shipToOverrideCustomerId ?? customerId>` / `s:<shipToCustomerId>`; add/remove by `orderId` (`app/api/floor/trips/[id]/bills/route.ts:119-238`) | fine for drops | **unfindable by typed lookup**: `parseBillLookupTerm` (`lib/trips/find-bill.ts:41`) accepts only `^\d{9,12}$` / `^I\d{9}$`; same path feeds re-delivery (`lib/trips/redelivery.ts:284`) |
| Delivery challan | created at import only (`createChallanForOrder`, `app/api/import/obd/route.ts:798-837`, and inline loops); document reads header/lines by OBD (`app/api/tint/manager/challans/[orderId]/route.ts:99,116,132`); formulas FK to `import_raw_line_items` | no header, no lines | fine with summary/lines; Orbit must create the `delivery_challans` row itself |
| Billing | `lib/billing/pick-delete.ts:407,559`, `lib/billing/telephonic-apply.ts:287`, `app/api/billing/picking/order/[orderId]/route.ts:147`, `lib/billing/print.ts:239` | breaks | fine |
| Tint | `app/api/tint/manager/orders/route.ts:576,643,693`, `app/api/tint/operator/done/route.ts:79`, `lib/tint/ti-save.ts:135,245`, manual-entry lookup `app/api/tint/manager/manual-entry/lookup/route.ts:51` (exact OBD) | breaks | fine |
| CI search | `lib/ci/queries.ts:171-211` exact `obdNumber: query`, then lines by OBD; `lib/ci/full-bill.ts:73`, `lib/ci/auto.ts:159`; `lib/ci/bill-only.ts` refuses a bill with no active lines | breaks | fine (exact match on the synthetic string) |
| Notifications | `lib/push/hand.ts:55` prints the OBD in the push text | prints "null" | fine |
| SAP import | upserts by `obdNumber` (`app/api/import/obd/route.ts:681,993`) | — | a non-numeric synthetic is never touched by SAP; a numeric one could collide |

~1,165 code references to `obdNumber` and ~67 `obdNumber: string` type declarations: making it nullable in
Prisma would fail `tsc --noEmit` widely.

**Row in `orders`, or a separate table? — facts for both, no decision.**
- *Row in `orders`:* it flows through picking / Floor / trips / challan print "normally" for free (step 1
  of the feature needs exactly that). Costs: a synthetic `obdNumber`, a synthetic `import_batches` +
  `import_raw_summary` + `import_raw_line_items` set (or every lines view is empty), a material code per
  line (Q7), and `smu` set to a challan-eligible value. Later, the real SAP OBD arrives as a **second**
  `orders` row (import creates by OBD) — so the challan order and the SAP bill are two rows for one sale
  and need a link column and a rule for which one counts in reports.
- *Separate table:* nothing in picking / Floor / trips / challan reads it, so step 1 ("flows to picking,
  floor, dispatch normally, challan printed") would need every one of those surfaces taught a second
  source. Lines would also be a new table. The later SAP OBD is the only `orders` row — cleaner for
  reports, but the physical dispatch then has no `orders` row at all.

**Answer:** the live column is nullable but UNIQUE, Prisma says required, and the code assumes an OBD
everywhere lines are read — a synthetic Orbit number plus synthetic summary/line rows is workable, NULL is not.

---

## Q2. The catch point

All four sources live in `app/api/import/obd/route.ts` (`POST` dispatches on `?action=`). A new bill is
created at `pending_support` (non-tint) or `pending_tint_assignment` (tint); "released" =
`workflowStage = SUPPORT_DONE_OUTPUT` = `"pending_picking"` (`lib/workflow-stages.ts:61`).

**Two releasers, both called by all four sources after the order write:**
- **R1 `applyMailOrderEnrichment(soNumbers)`** (`:246`), keyed on **SO**. If the mail order carries
  dispatch, the auto-done block (`:556-600`) moves `{soNumber, workflowStage:"pending_support"}` to
  `pending_picking` + `dispatchStatus:"dispatch"`. Already contains a bill-only gate:
  `mo_orders.billOnlyAt` (`:275-279`) suppresses status/slot/priority and a safety-net hold (`:409-440`).
- **R2 `applyNoMailOrderFallback(obdNumbers)`** (`:667`), keyed on **OBD**: candidates
  `pending_support, dispatchStatus:null, orderType ≠ tint, isRemoved:false` (`:678-686`) → released.
- Between them, **`applySoTagHolds`** (`lib/billing/telephonic-apply.ts:273`) — the Telephonic hook —
  runs at all four sites. It works only because R2 skips any bill whose `dispatchStatus` is not null.
- Tint bills are released later by tint completion, not by import.

| Source | Caller (verified) | Handler → create | R1 | hook → R2 |
|---|---|---|---|---|
| SAP xlsx | `components/import/import-page-content.tsx:300`, `components/import/import-modal.tsx:504` → `?action=manual-sap-confirm` | `handleManualSapConfirm` (`:1926`) → `upsertObd(…, "manual-sap")` (`:2060`) → `prisma.orders.create` (`lib/import-upsert.ts:165`) | effect loop `:2099` (only when SO new/changed, `lib/import-upsert/effects.ts:52-54`) | `:2141` → `:2142` |
| Clipboard paste | `import-modal.tsx:489` → `?action=sap-paste-confirm` | `handleSapPasteConfirm` (`:2478`) → `upsertObd` (`:2617`) | `:2656` | `:2687` → `:2688` |
| Manual template | `import-page-content.tsx:377/428`, `import-modal.tsx:553/594` → `?action=preview` / `confirm` | `handleConfirm` (`:1332`) → `prisma.orders.createMany` (`:1513`) | `:1528` | `:1541` → `:1542` |
| Auto-json | `docs/Powershell/Auto-Import-v2.ps1:58`, `-v3.ps1:76` → `?action=auto-json` (`handleAutoImportJson` `:4258`); older `Auto-Import.ps1:47` → `?action=auto` (`:3329`) — both → `processAutoImportRows` | `prisma.orders.createMany` (`:3974`) | `:3987` | `:3996` → `:3997` |

Not release paths: `upsertObd` at `:2914`/`:3213` (`dryRun: true`), `patch-headers` (`:4301`, header +
slot only). Which PowerShell script the import PC actually schedules is not knowable from the repo.

**Earliest single point.** The SO is known before the order exists in every path, but no single parse
step is shared. The earliest point **one edit pair** covers for all four is **inside R1 + R2** (same
file, all four callers): extend R1's bill-only test so the auto-done block is skipped, and exclude the
challan-linked SO from R2's candidates (or mark the bill first, as `applySoTagHolds` does, so R2's
`dispatchStatus:null` filter skips it). **A hook between R1 and R2 alone (the Telephonic placement) is
not enough** — R1 has already released a mail-matched bill by then; that is exactly why the mail-order
CI path needed its own gate inside R1.

⚠ In template (and likely auto) the `delivery_challans` row is created *after* the release; in
manual-sap/paste the `challan-create` effect runs *before* R2. A check keyed on "an existing challan row
for this order" would therefore behave differently by source — key on the SO link.

**Answer:** one point (R1 + R2, both in `route.ts`) covers all four sources; a Telephonic-style hook
before R2 alone does not, because R1 releases mail-matched bills first.

---

## Q3. What keeps a bill off every dispatch screen today

| Surface | Predicate |
|---|---|
| Picking Assign + My Picks + marker | `buildPickingWhere` (`lib/picking/queue.ts:354`): `dispatchStatus:"dispatch", isRemoved:false`, OR [`waitingBranchWhere` = `pending_picking` (+ trip shown when the gate is on, `lib/picking/visibility-gate.ts:101`), `pick_assigned`/`pick_done`, `pick_checked` today]; My Picks adds `pickAssignment.pickerId` (`:579-582`) |
| Floor arm 1 | `floorLiveBaseWhere` (`lib/floor/queries.ts:434`): `dispatch`, not removed, picking-open stages |
| Floor arm 2 | `floorUnslottedWhere` (`:173`): `workflowStage in RAIL_STAGES, dispatchStatus:null, isRemoved:false` |
| Floor arm 3 | `floorCarriedPoolWhere` (`:211`): `dispatch`, `pick_checked`, `tripDropId:null` |
| Floor arm 4 | `floorTripBillsWhere` (`:328`): `dispatch`, on a live trip |
| Floor Hold tab | `floorHoldWhere` (`:1261`): `{dispatchStatus:"hold", isRemoved:false}` (+ hide, + `extraWhere`) |
| Trip add | `app/api/floor/trips/[id]/bills/route.ts:137-207`: not removed, not on another drop, Hand matches Hand — **no stage / hold / hide check**; typed lookup `billLookupWhere` (`lib/trips/find-bill.ts:56`) |
| Billing Picking | `buildBillingPendingWhere` (`lib/billing/picking-where.ts:49`): `pick_checked, invoice null, dispatch` + hide; `buildBillingInvoicedInfoWhere` (`:114`) |
| Billing Print | by trip: `sentToBillingAt` set, trip not cancelled (`lib/billing/print.ts:279`); bills by `tripDropId` (`:152`), no hide |

**Existing states that hide a bill everywhere without "held":**
- `isRemoved = true` — every predicate pins `isRemoved:false`, but it means "TM removed OBD" and shows in
  Removed Orders (restorable). Wrong meaning.
- **`workflowStage = "cancelled"`, `dispatchStatus = null`** — in no stage set, so off picking, Floor
  board, billing. **This is what the live bill-only CI path already does**
  (`lib/billing/telephonic-apply.ts:422-424`, after `lib/ci/bill-only.ts` raises the CI). But it lands
  on **Floor's Cancelled tab**, and before the cancel the bill is safety-net HELD (`route.ts:417-430`).
- `isHidden` — no: picking queue, picking marker, Print, trip detail, CI search and trip add do not apply
  `getHideExclusion()`.
- A new `dispatchStatus` value — forbidden by the schema comment (`schema.prisma:1250-1252`: every board
  predicate pins `'dispatch'`).

**Smallest set a new flag (e.g. `orders.billOnlyAt`) must join:** if the bill never gets
`dispatchStatus='dispatch'`, picking, billing Picking/Print and Floor arms 1/3/4 already exclude it. The
real exposure is: (1) `floorUnslottedWhere` (arm 2 — a fresh bill with null status sits there; safest via
`floorBoardWhere`, which also feeds the marker), (2) `floorHoldWhere` (counts + freight pool), (3) the
trip-add route + `billLookupWhere` (no stage check today), (4) the tint manager orders route (tint stages),
(5) R1/R2 themselves (Q2) so status never becomes `dispatch`. Belt-and-braces: `buildPickingWhere` and
`buildBillingPendingWhere`. `getHideExclusion()` would cover most in one edit but gives the flag the
admin-Hide meaning.

**Answer:** nothing hides a bill everywhere without showing it somewhere (held → Hold tab, cancelled →
Cancelled tab, removed → Removed Orders); a new flag needs Floor arm 2, Floor hold, trip add/lookup, tint
manager and the two import releasers.

---

## Q4. Challan numbering (`delivery_challans`)

- **Columns (live):** `id` serial · `orderId` int NOT NULL **UNIQUE** FK `orders(id)` · `challanNumber`
  text NOT NULL **UNIQUE** · `transporter` · `vehicleNo` · `printedAt` · `printedBy` FK users ·
  `createdAt` · `updatedAt` · `isVoided` (default false) · `voidReason` · `voidRemark` · `voidedAt`.
  Child `delivery_challan_formulas` (`challanId`, `rawLineItemId` FK `import_raw_line_items`,
  `@@unique([challanId, rawLineItemId])`, `schema.prisma:1926-1939`). **No challan line table** — the
  document's lines are the order's SAP raw lines. Created by `prisma/migrations/v14_delivery_challans.sql`.
  Has a `live_changes` trigger (v27.48).
- **Allocation:** no DB sequence, no shared helper. Copied inline at 6 sites — `findFirst orderBy id desc`,
  parse the tail after the last `-`, +1, `CHN-${new Date().getFullYear()}-${pad5}`
  (`app/api/import/obd/route.ts:1577-1598`, `:2079-2091`, `:2636-2648` → `createChallanForOrder`
  `:798-837`, `:4042-4063`; `app/api/tint/manager/manual-entry/route.ts:284-303`;
  `app/api/admin/fix-challans/route.ts:55-76`).
- **Yearly reset: none.** The year prefix changes; the counter carries on (`lib/ci/number.ts:6-10` says
  so in so many words). 2027's first would be `CHN-2027-0289x`-ish, not `00001`.
- **Voided rows count** — no allocator filters `isVoided` (deliberate, CORE §13).
- **Who gets one:** `smu` ∈ {Retail Offtake, Decorative Projects} (`CHALLAN_ELIGIBLE_SMU`,
  `lib/import-upsert/effects.ts:57-65`; `route.ts:1553`, `:4008`), and auto/effects need ≥1 active line.
  Tint and non-tint alike (live: tint 1,239, non-tint 1,342).
- **Live gap:** 2,581 rows but max number `CHN-2026-02892` — ~311 numbers unaccounted for (not explained
  by voids, which are rows). Not investigated.
- **Concurrency:** read-then-write; only `createChallanForOrder` retries a P2002 (once); the bulk loops at
  `:1593`/`:4058` abort the rest of the batch on one P2002 (logged "non-fatal"); ordering by `id` not
  number. `manual-entry:278-279` checks `isVoided:false` but `orderId` is UNIQUE, so a re-issue after a
  void throws and is swallowed (`:305`).

**Reuse?** Table: only with an `orders` row (FK NOT NULL UNIQUE) and SAP-style raw lines for the
document. Sequence: technically shareable (UNIQUE stops duplicates), but a new writer racing the
import's 1-retry/no-retry loops would make imports silently drop challans. And when the SAP OBD arrives
for an SMU-eligible SO, **import will auto-create a second CHN number** on the new bill — so a
challan-first order would end up with two challans unless the import skips challan creation for a
linked SO.

**Answer:** one challan per order, number = last-by-id +1 with the current year (no reset, voids
included); reusable only via an `orders` row, and the later SAP OBD would get a second CHN unless import
is told not to.

---

## Q5. Place Order

- **Desktop `/place-order`:** `handleSend` `app/(place-order)/place-order/place-order-page.tsx:641-655` →
  `buildMailtoUrl` (`lib/place-order/email.ts:282`) → `window.location.href = mailto:`; body from
  `buildEmail` (`email.ts:211`, invoked `:613-633`); then `clearDraft`/`addRecent` (localStorage) and
  `resetCart`. **No API call, no server write.**
- **Mobile `/po`:** `handleSend` `app/po/po-page.tsx:1957-2010` → `mailto:${ORDER_TO}` (`:1959`/`:1994`),
  body from `buildEmailParts` (`:1954`); `addSentOrder` is a localStorage log only. **No server write.**
- **Held at that moment** (`app/(place-order)/place-order/types.ts`): customer `{name, code, area?}` from
  `mo_customer_keywords` (no `delivery_point_master` id; whether `code` = SAP ship-to code is
  unverified); `shipTo` free text; `dispatch`, `callTarget`, `marker`, `crossDepot`, `notes`; lines
  `CartLine {productId (= mo_order_form_index_v2.id), family, subProduct, product, uiGroup, displayName,
  baseColour, packQtys}` with `packQtys["<packCode>|<unit>"]` = **tins**. **No SAP material code on the
  line** (it is fetched — `mo_sku_lookup_v2.material`, `app/api/place-order/data/route.ts:102,156` — but
  not stored on the cart; the L/LT collapse at `:134-144` can make one cell map to more than one material).
- **Enough for an order + lines?** Not as-is. Needs: a resolved customer (`customerId`,
  `shipToCustomerId`), `orderType`, `smu` (drives challan eligibility), a material code per line, and —
  per Q1 — a synthetic OBD + batch + raw summary/lines.
- **SAP-only columns that would be empty:** `obdNumber`, `soNumber`, `invoiceNo`, `invoiceDate`,
  `obdEmailDate`, `orderDateTime` (also the CI search window, `lib/ci/queries.ts:174`), `smu`,
  `sapStatus`, `materialType`, `natureOfTransaction`, `warehouse`, `totalUnitQty`, `grossWeight`,
  `volume`; on lines `batchCode`, `volumeLine` (litres), `netWeight`, `totalWeight`,
  `article`/`articleTag`, `skuDescriptionRaw`.

**Answer:** both pages only open a `mailto:` with no server write; they hold customer name/code, free-text
ship-to and lines as product + pack + tins, but no material code and no customer id — not enough without
a resolve step.

---

## Q6. "Freight trip"

Searched plain text (`grep -rliE "freight"` over `app lib components docs`, plus live
`information_schema`). Three things exist:
1. **Freight Trips — a real, live module** (2026-10-03): `freight_trips` / `freight_trip_bills` /
   `freight_trip_activity`, `/freight-trips`, `docs/CLAUDE_FREIGHT_TRIPS.md`. Report-only paper trips
   over **held** bills; never writes `orders`/`trips`. Live: 7 trips, all active, 182 active bill rows.
   ⚠ Its pool is `getFloorHold` — `dispatchStatus = 'hold'` only (`CLAUDE_FREIGHT_TRIPS.md §5`), and
   adding a bill requires it to be held right now. A bill-only challan OBD that is NOT held (Q3) would
   not be eligible today.
2. NTS mirror: `trip_report` drops rows where `modi_inv = 'FRT'` (freight rows), `CLAUDE_TRIP_REPORT.md:45`.
3. `docs/Powershell/0-FrtIngestion.ps1` — Breakwalls freight automation, not OrbitOMS (`CLAUDE_IMPORT.md:1155`).
No freight column on `orders` or `trips`.

**Answer:** "freight trip" almost certainly means the new `/freight-trips` module (paper trips, record
only) — but it accepts held bills only, so a non-held bill-only OBD would need its pool widened.

---

## Q7. Line matching

- **Table:** `import_raw_line_items` (`schema.prisma:975-1012`), keyed by `obdNumber` + `lineId`, index
  `(obdNumber, lineStatus)`. SKU = `skuCodeRaw` (SAP material); qty = `unitQty` Int (tins) and
  `volumeLine` (litres); `lineStatus` active/removed.
- `unitQty` is SAP's **delivery** quantity; **there is no invoiced-quantity column anywhere**
  (`CLAUDE_CI.md` CI-14, `:278-279`). It is never null/zero live (CI-8).
- Duplicate SKU lines within one OBD are possible (`schema.prisma:989-992`) → aggregate qty per SKU
  before comparing.
- Natural key: (`skuCodeRaw` ↔ material code, Σ`unitQty`). **Never an id**: `sku_master` and
  `sku_master_v2` ids have zero overlap (CORE §13); every resolver matches `sku_master_v2.material` to
  `skuCodeRaw` (`lib/picking/resolve-lines.ts`, `lib/mrn/resolve-lines.ts`, `lib/ci/resolve-lines.ts`).
- Challan side: Place Order has no material on the cart line (Q5) — the challan lines would need the
  material stored at creation (`mo_sku_lookup_v2.material`, `@unique`, `schema.prisma:2318`).

**Answer:** yes — SAP lines land per OBD with material code + delivery qty in tins, so a match on
material + summed tins works, provided the challan stores the material code (Place Order does not today).

---

## Q8. Live numbers (read-only, 2026-10-03)

| Metric | Value |
|---|---|
| `delivery_challans` total | 2,581 |
| voided | 48 |
| this year (`CHN-2026-%` and `createdAt ≥ 2026-01-01`) | 2,581 (all; first row 2026-05-14) |
| max number | `CHN-2026-02892` (gap of ~311 vs row count) |
| by order type / SMU | tint·Deco Projects 919 · non-tint·Deco Projects 711 · non-tint·Retail Offtake 631 · tint·Retail Offtake 320 |
| orders total | 16,619 |
| orders with null `obdNumber` | 0 |
| orders with null `soNumber` | 0 |
| SO numbers on >1 order, last 30 days | 56 (of 3,661 distinct SOs, ~1.5%) |
| tables with "freight" | `freight_trips`, `freight_trip_bills`, `freight_trip_activity` |
| columns with "freight" | `freight_trip_bills.freightTripId`, `freight_trip_activity.freightTripId` |
| freight trips / active / active bill rows | 7 / 7 / 182 |
| `so_tags` (Telephonic) | 38 (ci 21, hold 17) |

**Answer:** 2,581 challans (48 voided, all 2026), zero OBD-less orders, 56 multi-OBD SOs in 30 days,
and the only "freight" schema is the new Freight Trips module.

---

## Risks

1. **Two `orders` rows per sale** if the challan order lives in `orders`: the SAP OBD import creates a
   new row by OBD. Every report (TI, tint summary, trip detail, freight, MIS) would double-count unless
   one is excluded.
2. **Second challan number** — import auto-creates a CHN for SMU-eligible OBDs (Q4).
3. **R1 releases before any between-hook runs** (Q2) — a design that copies the Telephonic placement
   only would leak mail-matched bill-only OBDs to picking.
4. **Synthetic OBD shape** — lookups that regex numbers (`parseBillLookupTerm`, `tokenMatchesObd`) won't
   find a lettered number; a numeric one risks colliding with SAP's space.
5. **Prisma/live drift on `orders`** — live allows NULL `obdNumber`, `batchId`, `orderType`,
   `shipToCustomerId`; Prisma says required. A raw-SQL writer could create rows the app then crashes on.
6. **Challan allocator races** — a new writer competing with import's no-retry loops can make imports
   silently drop challans (Q4).
7. **Freight pool is held-only** — "freight trip for record" needs either a hold (which shows on Floor's
   Hold tab — the thing we don't want) or a widened pool.
8. **Name collision** — "bill-only" already means the mail-order **CI** mark (`mo_orders.billOnlyAt`,
   R1 `:275-279`) and the Telephonic `ci` tag, both of which **cancel** the bill. A new "bill-only"
   flag on `orders` must not be confused with them.
9. **Place Order has no server path and no material code** — the create step is new end to end; the
   L/LT collapse can make a cart cell ambiguous.
10. **No invoiced qty** — matching compares against SAP delivery qty only.

## Open questions for owner

1. Should the challan order be a row in `orders` (flows everywhere, two rows per sale) or its own table
   (clean reports, every dispatch screen taught a second source)?
2. What does the later SAP OBD become: cancelled like the CI path, a new hidden state, or merged into the
   challan order (lines replaced)?
3. "Freight trip for record only" — is this the new `/freight-trips` module? If yes, should its pool
   accept non-held bill-only OBDs?
4. Orbit order number format — must it be searchable on Floor/trips (digits) and never collide with SAP?
5. Should the Orbit challan reuse the `CHN-` sequence, or a separate prefix (e.g. its own allocator like
   CI/MRN)? And should SAP import skip CHN creation for a linked SO?
6. Which SMU / orderType does an Orbit order carry (drives challan eligibility and tint routing)? Can a
   challan-first order be tint?
7. Who resolves the customer on Place Order (the page has `mo_customer_keywords.code`, not a
   `delivery_point_master` id)?
8. One SO → several OBDs (56 such SOs in 30 days): all OBDs bill-only against one challan?
9. Ageing list: threshold days, and who owns chasing it?
10. Line mismatch: flag only, or block the link?
