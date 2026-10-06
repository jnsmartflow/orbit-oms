# code-update-2026-10-06 — Challan Orders slice 2: exclusion locks

**Status:** BUILT, `tsc --noEmit` clean, `npm run build` clean (405 route-table entries, 84/84 static pages).
Committed with this file. **Two items STOPPED** (§3) — the plan's predicate did not match the code.
Design: `docs/prompts/drafts/web-update-2026-10-06-challan-orders.md`. Plan: `code-plan-2026-10-06-challan-slice1.md` §2.
Schema: v27.60 (slice 1, `e9143c1f`).

**Two kinds of row the locks keep in place** (zero of either exist live — §4):
- **ORB order** — `orders.isChallanOrder = true`. Flows picking → Floor → an Orbit trip. Never Billing, never tint.
- **Linked SAP OBD** — `workflowStage = 'challan_linked'` (+ `challanOrderId`). Nowhere but the future Challan orders screen.

## 1. One owner per rule

| Thing | Owner | Used by |
|---|---|---|
| The stage value | `CHALLAN_LINKED`, `lib/workflow-stages.ts` (slice 1) | tint routes, trip add, Telephonic planner |
| "Leave linked bills out" filter | **`NOT_CHALLAN_LINKED`** = `{ workflowStage: { not: CHALLAN_LINKED } }`, `lib/workflow-stages.ts` (new) | `floorHoldWhere`, `billLookupWhere`, Billing actions read |
| The ORB number shape | **`ORB_NUMBER_RE` / `isOrbNumber`**, `lib/challan-orders/orb-number.ts` (new, pure) — the code twin of `chk_orders_orb_number` | `parseBillLookupTerm` (server), `lookupTermOf` (client) |

`workflowStage` is NOT NULL (live: 0 nulls), so every `not` needs no null arm; `isChallanOrder` is NOT NULL DEFAULT false (CORE §13).

## 2. The locks

| # | File · function | Live caller (verified) | Before → after | Why a no-op today |
|---|---|---|---|---|
| 1 | `lib/billing/picking-where.ts` · `buildBillingPendingWhere` (pending arm) | `/api/billing/picking/list` ← `billing-picking-tab.tsx`; `/marker` ← `billing-marker-provider.tsx` + `billing-tab-bar.tsx`; `/mark-done`; `/order/[orderId]` (`isPending`); `lib/billing/marker-counts.ts`, `lib/billing/order-detail.ts` | `{ workflowStage:'pick_checked', invoiceNo:null, invoicedAt:null, isRemoved:false, dispatchStatus:'dispatch' }` → **+ `isChallanOrder: false`**. Info arm untouched (an ORB order never has an invoiceNo). | 0 rows have `isChallanOrder = true`; every live row is `false`. |
| 3a | `app/api/tint/manager/manual-entry/route.ts` · `POST` ("Add to Tint") | `components/tint/manual-tint-entry-modal.tsx:188` | New refusal, before the tint-type test: `order.isChallanOrder` → 400 `CHALLAN_ORDER` "Challan orders are non-tint in Phase 1"; `workflowStage === CHALLAN_LINKED` → 400 `CHALLAN_ORDER` (linked-bill wording). | 0 rows match either test; every other order reaches the existing checks unchanged. |
| 3b | `app/api/tint/manager/manual-entry/lookup/route.ts` · `GET` | `manual-tint-entry-modal.tsx:150` (called before the POST) | Same refusal, same code. | Same. |
| 3c | `components/tint/manual-tint-entry-modal.tsx` · `ERROR_MESSAGES` | — (the modal maps codes to text) | + `CHALLAN_ORDER: "Challan orders are non-tint in Phase 1 — this bill cannot be pulled into tinting."` Without it the modal shows "Could not complete request". | Display only. |
| 4 | `lib/floor/queries.ts` · `floorHoldWhere` | `/api/floor/hold` ← `floor-page.tsx:661`; `lib/floor/counts.ts` (tab count); `lib/floor/rows.ts` (live feed); `/api/tint/manager/hold` + `/marker`; `lib/freight-trips/pool.ts`, `/queries.ts`, `/api/freight-trips/marker` | `{ dispatchStatus:'hold', isRemoved:false }` → **+ `...NOT_CHALLAN_LINKED`**. One edit reaches every reader of the held set. | 0 rows at `challan_linked`; every held bill has some other stage, so the held set is identical. |
| 5a | `app/api/floor/trips/[id]/bills/route.ts` · `POST` add branch | `floor-page.tsx:987/1079/1178/3034` (rail, add band, New trip, load plan) — the ONLY runtime writer of `tripDropId` | New per-bill refusal before the stop logic: `workflowStage === CHALLAN_LINKED` → `failed` "…billed against a challan order … never goes on a trip". One extra column in the existing read; no extra query, no write. ⚠ The route's header says "do not add a stage guard": this refuses only the stage that is off every board by design; membership stays open at every working stage. | 0 rows at `challan_linked`. |
| 5b | `lib/trips/find-bill.ts` · `parseBillLookupTerm` + `billLookupWhere` | `/api/floor/search` ← `floor-page.tsx:1769` (`commitSearch`, LIVE); `/api/floor/trips/lookup` (no UI caller since 2026-10-06); `lib/trips/redelivery.ts` `searchForRedelivery` | Parse: **`ORB-YYYY-NNNNN` is now one full number** (`{ q, invoiceTerms: [] }` — matches the obdNumber arm). Where: **+ `...NOT_CHALLAN_LINKED`** so typing a linked bill's SO/OBD/invoice finds nothing. | No `ORB-` obdNumber exists (0), so an ORB search finds nothing yet; every numeric / `I…` input parses exactly as before (checked: `9109338810`, `I536229654`, `536229654`, `1536229654`); 0 linked rows to hide. |
| 5c | `lib/floor/search.ts` · `lookupTermOf` (client) | `floor-page.tsx:1844/1870` | Accepts the ORB shape too, so the box asks the server for it. | Same as 5b. |
| 6a | `app/api/billing/mail-order/actions/route.ts` · `POST`, write 2 (per-bill read by SO) | `lib/billing/mo-actions.ts:64` ← the Billing ribbon / ship-to pencil | `where: { soNumber, isRemoved:false }` → **+ `...NOT_CHALLAN_LINKED`**. A linked bill is never held / released / slotted / marked urgent / Hand / ship-to'd from Billing, and is not even reported as skipped. | 0 linked rows; the read returns the same bills. |
| 6b | `lib/billing/telephonic-apply.ts` · `planSoTagApplications` (pure) | `applySoTagHolds` ← import hook (`route.ts:1541/2141/2687/3996`), late tag `lib/billing/telephonic.ts:359`, Billing CI press `lib/billing/mo-ci-tag.ts:168` | New FIRST decision: `workflowStage === CHALLAN_LINKED` → `{ action: 'skip', reason: 'challan linked' }` — no claim, no hold, no CI, no cancel. Checked: a linked bill skips, a `pending_support` bill on the same tag still holds. | 0 linked rows. The import route itself is not edited (slice 6). |
| 7 | Freight Trips — **no edit** | — | Pool = `getFloorHold` → `floorHoldWhere` (lock 4 now excludes linked bills). Add guard `lib/freight-trips/bills.ts:81` requires `dispatchStatus === 'hold'`; a linked bill carries `null` (design D9). **A `challan_linked` row cannot enter a freight trip today.** D13 (how it is added) stays parked; widening the pool is slice 8. | — |

Also confirmed, no edit needed: **re-deliveries** (`lib/trips/redelivery.ts`) admit only `pick_checked` / `dispatched`
bills (`GONE_OUT_STAGES`), so a linked bill is refused there, and its search now cannot find one (5b).

## 3. STOPPED — not built

**Lock 2 — Billing Print tab (`lib/billing/print.ts` `loadPrintTrips`). The site does NOT match the plan.** The plan
(discovery 2 Q4, written 2026-10-03) relied on slice 9's "never a partial set" rule: a challan bill with no invoice would
make its trip uncopyable. **Print v2 (2026-10-05, v27.56) removed that rule** — copies are per bill, keyed on OBD number,
and "ready" means `pick_checked` / `dispatched` with no confirmed finding. So today an ORB order at `pick_checked` on a
sent trip would read **ready** and its **`ORB-…` number would go into the bulk Copy and be pasted into SAP** — worse
than the plan's failure, and still live once ORB orders exist. Excluding it now touches three places and needs a UI decision:
1. `loadPrintTrips` — select `isChallanOrder`; give such a row a state that is neither copied nor counted (eligible /
   ready / canDone / copiedCount all follow from `!r.held` today).
2. `getPrintWorkTripIds` (raw SQL) — `AND o."isChallanOrder" = false` beside `"dispatchStatus" IS DISTINCT FROM 'hold'`,
   or a Done trip carrying an ORB bill reads "work outstanding" forever while `loadPrintTrips` calls it done.
3. **Owner decision:** how the Print tab shows an ORB row — reuse "held" (wrong label), or a new `PrintBillState`
   (e.g. `"challan"`) with its own pill in `components/billing/billing-print-tab.tsx`. (Or keep ORB orders off
   `/print` entirely by refusing Send to billing for a challan-only trip — `lib/trips/billing.ts`.)
Zero ORB orders exist and nothing creates one until slice 3, so nothing is exposed today — but **lock 2 must land
before slice 3 ships**.

**Lock 6, first writer — mail-order enrichment.** It exists only as `applyMailOrderEnrichment` in
`app/api/import/obd/route.ts` — release function R1 (discovery 2 Q2; grep: no second enrichment writer anywhere).
The brief says both "each must skip challan_linked" and "do NOT touch the import release functions". Left for slice 6,
where R1 gets the catch anyway. The edit it needs: exclude `CHALLAN_LINKED` from its by-SO `updateMany` / `findMany`
(`route.ts:372-386`, `:395`, `:417`, `:452`, `:528`, `:562`) — today the auto-done block (`:562`) is already pinned to
`pending_support`, but the general enrichment write (`:385`, `not: 'cancelled'`), the ship-to carry (`:395`, same), the
CI-mark safety-net hold (`:417`, `notIn: ['cancelled','dispatched']` + `dispatchStatus: null`) and the hold loop
(`:528`, `not: 'cancelled'`) would all write a linked bill.

## 4. Live check (read-only, 2026-10-06)

`workflowStage = 'challan_linked'` 0 · `isChallanOrder` true 0 · `challanOrderId` set 0 · `obdNumber LIKE 'ORB-%'` 0 ·
`challan_order_so_links` rows 0 · `workflowStage IS NULL` 0. Every lock above therefore changes no answer for any
existing row.

## 5. Step 0 (version number)

Already correct from slice 1b (`e9143c1f`). Remaining `27.59` hits, none changed: `sql/2026-10-06-challan-orders-ddl.sql:12`
and `code-plan-2026-10-06-challan-slice1.md:7` (both say "drafted as v27.59 … so v27.60" — correct as written);
`CLAUDE_CORE.md:385, 981, 1925, 1927, 1930` and the footer's "Prior, v132" text — all the real v27.59
(`mo_orders_soNumber_idx`); `prisma/schema.prisma:2268, 2308` — the same index. No canonical file or challan draft
mis-labels challan work as v27.59.
