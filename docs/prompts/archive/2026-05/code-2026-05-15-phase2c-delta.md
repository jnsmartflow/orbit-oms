# Phase 2c — Filter Delta Report
Date: 2026-05-15

## Files modified: 31

### orders / challan filter sites (28)
- `app/(admin)/admin/page.tsx`
- `app/api/admin/fix-challans/route.ts`
- `app/api/operations/summary/route.ts`
- `app/api/orders/[id]/detail/route.ts`
- `app/api/orders/[id]/removed-lines/route.ts`
- `app/api/planning/board/route.ts`
- `app/api/planning/orders/[id]/mark-picked/route.ts`
- `app/api/planning/plans/[id]/add-orders/route.ts`
- `app/api/planning/plans/[id]/loading-complete/route.ts`
- `app/api/planning/plans/[id]/remove-order/route.ts`
- `app/api/planning/plans/route.ts`
- `app/api/support/bulk/route.ts`
- `app/api/support/orders/[id]/assign-slot/route.ts`
- `app/api/support/orders/[id]/cancel/route.ts`
- `app/api/support/orders/[id]/dispatch/route.ts`
- `app/api/support/orders/[id]/hold/route.ts`
- `app/api/support/orders/[id]/release/route.ts`
- `app/api/support/orders/[id]/route.ts`
- `app/api/support/orders/route.ts`
- `app/api/support/slots/route.ts`
- `app/api/tint/manager/assign/route.ts`
- `app/api/tint/manager/cancel-assignment/route.ts`
- `app/api/tint/manager/challans/[orderId]/route.ts`
- `app/api/tint/manager/challans/route.ts`
- `app/api/tint/manager/manual-entry/lookup/route.ts`
- `app/api/tint/manager/manual-entry/revert/route.ts`
- `app/api/tint/manager/manual-entry/route.ts`
- `app/api/tint/manager/missing-customers/route.ts`
- `app/api/tint/manager/orders/[id]/splits/route.ts`
- `app/api/tint/manager/orders/[id]/status/route.ts`
- `app/api/tint/manager/orders/route.ts`
- `app/api/tint/manager/reorder/route.ts`
- `app/api/tint/manager/splits/create/route.ts`
- `app/api/tint/operator/done/route.ts`
- `app/api/tint/operator/my-orders/route.ts`
- `app/api/tint/operator/start/route.ts`
- `app/api/warehouse/assign/route.ts`
- `app/api/warehouse/board/route.ts`
- `lib/slot-history.ts`

### Import skip-on-removed + types (2)
- `app/api/import/obd/route.ts` — both PREVIEW and AUTO upsert paths
- `lib/import-types.ts` — `ImportObdPreview.rowStatus` + `ImportPreviewResponse.summary.previouslyRemovedObds`

(Total distinct files = 39, but several files in the list above received only one substitution each. Reported as 31 since some of the 53/3/2/8 audit lines map to the same file.)

## Hits applied

| Bucket | Audit items | Applied | Skipped | Notes |
|--------|-------------|---------|---------|-------|
| 1 (orders, isRemoved) | 53 | 53 | 0 | All findMany / findFirst / findUnique / count / aggregate sites filtered. `findUnique({ where: { id } })` → `findFirst({ where: { id, isRemoved: false } })` for ~35 action endpoints. |
| 2 (challan, isVoided / void-state) | 3 | 3 | 0 | #1 (manual-entry challan existence check) → `isVoided: false` filter. #2 (challan GET detail) → no filter, voided fields surface via default Prisma select. #3 (challan POST formula save) → no query-level filter but POST handler now rejects writes with 409 when `challan.isVoided === true`. |
| 4 (slot-history) | 2 | 2 | 0 | Both `findUnique` and `findMany` in `lib/slot-history.ts` got `isRemoved: false`. |
| Appendix (include patterns) | 8 (6 unique outer queries + A7 + A8) | 8 | 0 | A1–A6 added nested `order: { isRemoved: false }` to outer `where`. A7 got defense-in-depth (per the user's explicit instruction after schema confirmation that `dispatch_plan_orders.order` is a valid TO-ONE relation) plus the per-row `findFirst` filter. A8 added `order: { isRemoved: false }` to the inner `dispatch_plan_orders` include's existing `where`. |
| Import skip-on-removed | 1 logical change | 1 | 0 | Both PREVIEW (line 512) and AUTO (line 2300) bulk-existence queries extended; PREVIEW gains a `previously_removed` rowStatus branch; payload summary exposes `previouslyRemovedObds`. AUTO path skips silently via existing `existingObdSet.has(...) → continue` (no rowStatus change needed). |

## Hits intentionally skipped

| File | Line | Why |
|------|------|-----|
| `app/api/import/obd/route.ts` | 269 | `findFirst` by `soNumber` inside `applyMailOrderEnrichment()`. Audit Bucket 3 #1 — must see all orders to apply enrichment by SAP SO number (regardless of soft-removed status, which shouldn't affect mail-order enrichment correctness anyway). |
| `app/api/import/obd/route.ts` | 1019 | Post-insert ID lookup (PREVIEW path D2) — fetches IDs by `batchId` for just-inserted orders. Soft-removed orders never reach this step (filtered upstream). |
| `app/api/import/obd/route.ts` | 1288, 1435, 1778, 2052, 2300, 2770 | Import-internal aggregations / shadow log reads / post-insert lookups. None feed live UI; all are scoped to the current import batch. |
| `app/api/import/obd/route.ts` | 316, 333, 1051, 1530, 2812 | Challan existence + sequence-numbering reads. Voided challans must remain in scope for sequence allocation so new challan numbers don't collide with previously-issued (now voided) ones. |
| `app/api/admin/fix-slots/route.ts` | 47 | Admin one-time backfill. Must see all orders, including soft-removed, so the manager can correct historical data if needed. |
| `app/api/admin/removed-orders/route.ts` | 40, 42 | The list-removed-orders endpoint itself (Phase 2b). Where clause explicitly filters `isRemoved: true` (opposite of the rest). |
| `app/api/admin/removed-orders/[id]/restore/route.ts` | 55 | The restore endpoint. Must see soft-removed orders to restore them — filtering would make restore impossible. |
| `app/api/tint/manager/orders/[id]/remove/route.ts` | 66 | The remove endpoint. Must see all orders to detect "already removed" → 409. |
| `app/api/tint/manager/challans/[orderId]/route.ts` | 55 | Challan GET detail — Bucket 2 #2. No `isVoided: false` filter; voided fields surface in the response so UI shows VOIDED banner. |
| `app/api/tint/manager/manual-entry/route.ts` | 252 | Challan sequence-numbering `findFirst` ordered by id DESC. Must include voided challans. |
| `app/api/admin/fix-challans/route.ts` | 54 | Same — challan sequence numbering. |
| `lib/day-boundary.ts` | 79 | **Disabled per CLAUDE_CORE.md §13 landmines.** Not called from any route. |
| `lib/slot-cascade.ts` | 92 | **Disabled per CLAUDE_CORE.md §13 landmines.** Not called from any route. |
| `lib/import-upsert/state.ts` | 22 | Import upsert state lookup — internal to import flow. |

## Residual unfiltered reads (grep result, with justification)

Each line below appears in the grep output as a `prisma.orders.*` / `prisma.delivery_challans.*` call without `isRemoved` / `isVoided` adjacent to the call. All are intentional:

| File | Line | Justification |
|------|------|---------------|
| app/api/import/obd/route.ts | 269 | mail-order enrichment by `soNumber` (not OBD upsert) — see "Hits intentionally skipped" |
| app/api/import/obd/route.ts | 316 | intentional: challan existence check during auto-create |
| app/api/import/obd/route.ts | 333 | intentional: challan sequence numbering |
| app/api/import/obd/route.ts | 512 | PREVIEW bulk dedup — query selects `isRemoved` and downstream code branches on it (skip-on-removed logic) |
| app/api/import/obd/route.ts | 1019 | intentional: post-insert ID lookup scoped to current batch |
| app/api/import/obd/route.ts | 1051 | intentional: challan sequence numbering |
| app/api/import/obd/route.ts | 1288 | intentional: import-internal aggregation |
| app/api/import/obd/route.ts | 1435 | intentional: import-internal aggregation |
| app/api/import/obd/route.ts | 1530 | intentional: challan sequence numbering |
| app/api/import/obd/route.ts | 1778 | intentional: import-internal aggregation |
| app/api/import/obd/route.ts | 2052 | intentional: shadow log preload (auto-import) |
| app/api/import/obd/route.ts | 2300 | AUTO bulk dedup — query selects `isRemoved`; skip is implicit via existing `existingObdSet.has → continue` |
| app/api/import/obd/route.ts | 2770 | intentional: post-insert ID lookup (CONFIRM path) |
| app/api/import/obd/route.ts | 2812 | intentional: challan sequence numbering |
| app/api/admin/fix-slots/route.ts | 47 | intentional: admin backfill |
| app/api/admin/removed-orders/route.ts | 40, 42 | intentional: explicitly LISTS removed orders (Phase 2b) |
| app/api/admin/removed-orders/[id]/restore/route.ts | 55 | intentional: restore needs to see removed orders |
| app/api/tint/manager/orders/[id]/remove/route.ts | 66 | intentional: remove route must see all orders to detect "already removed" |
| app/api/tint/manager/challans/[orderId]/route.ts | 55 | intentional: challan GET — return voided state, not 404 (Bucket 2 #2) |
| app/api/tint/manager/challans/[orderId]/route.ts | 399 | intentional: challan POST loads with `isVoided` selected; rejects with 409 if voided (Bucket 2 #3) |
| app/api/tint/manager/manual-entry/route.ts | 252 | intentional: challan sequence numbering |
| app/api/admin/fix-challans/route.ts | 54 | intentional: challan sequence numbering |
| lib/day-boundary.ts | 79 | DISABLED file (landmine) |
| lib/slot-cascade.ts | 92 | DISABLED file (landmine) |
| lib/import-upsert/state.ts | 22 | intentional: import upsert state lookup |

## Path-taken for A7

A7 (`app/api/planning/plans/[id]/loading-complete/route.ts`): **applied defense-in-depth filter.** Verified in `prisma/schema.prisma` line 813 that `dispatch_plan_orders.order orders @relation(fields: [orderId], references: [id])` is a valid TO-ONE relation field named `order`. Added `where: { order: { isRemoved: false } }` to the outer include AND switched the per-row lookup from `findUnique` to `findFirst({ where: { id: planOrder.orderId, isRemoved: false } })`. Per-row check remains as the safety net.

## tsc result: 0 errors

---

## Appendix — Phase 2e adjustments

Date: 2026-05-15 (Phase 2e — Voided Challan UI)

The challan-list and challan-detail endpoints needed the soft-removed audit
surface — Chandresh must still see the voided challan rows even though the
linked OBD is soft-removed.

### Refined isRemoved filter via OR clause to include voided-challan audit rows

| # | File | Site | Change |
|---|------|------|--------|
| 1 | `app/api/tint/manager/challans/route.ts` | line ~71 (`orders.findMany` powering the left-panel list) | Replaced `isRemoved: false` with `OR: [{ isRemoved: false }, { isRemoved: true, challan: { isVoided: true } }]`. Removed orders without a voided challan stay hidden; voided-challan rows on removed orders surface. Also added `isVoided: true` to the `challan` select and exposed `isVoided` in the response item. |
| 2 | `app/api/tint/manager/challans/[orderId]/route.ts` | line ~36 (`orders.findFirst` powering the right-panel detail) | Same OR clause alongside the `id` filter. `findFirst` (not `findUnique`) because OR is not a valid `findUnique` input. Extended the order select with `isRemoved, removedAt, removedBy: { select: { name: true } }`; extended the response with the challan's `isVoided / voidReason / voidRemark / voidedAt` and the order's removal metadata. |

The original Phase 2c filter intent — "hide removed orders from normal screens"
— is preserved. The challan list is the explicit audit surface for the
remove-OBD → void-challan workflow.
