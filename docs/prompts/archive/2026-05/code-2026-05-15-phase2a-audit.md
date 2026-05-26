# Phase 2a — Read-API Audit
Date: 2026-05-15

## Summary
- Total query sites found: 77
- Bucket 1 (needs `isRemoved: false` filter): 53
- Bucket 2 (needs `isVoided: false` filter or voided-state handling): 3
- Bucket 3 (intentional, must NOT filter): 19
- Bucket 4 (unclear): 2

Search scope: `app/**`, `lib/**`, `prisma/**` (excluding schema.prisma). Patterns covered both `prisma.<model>.<op>` and `tx.<model>.<op>`. No hits in `scripts/**` (directory does not exist).

---

## Bucket 1 — `orders` reads needing `isRemoved: false`

| # | File | Line | Query type | UI surface (best guess) |
|---|------|------|-----------|-------------------------|
| 1 | app/api/tint/manager/orders/route.ts | 27 | findMany | TM Kanban — Pending / Assigned / In Progress columns |
| 2 | app/api/tint/manager/orders/route.ts | 84 | findMany | TM Kanban — Completed Today |
| 3 | app/api/tint/manager/missing-customers/route.ts | 17 | findMany | TM header — missing customer badge + popover |
| 4 | app/api/tint/manager/manual-entry/lookup/route.ts | 33 | findUnique | Manual Tint Entry modal — OBD lookup |
| 5 | app/api/tint/manager/manual-entry/route.ts | 107 | findUnique | Manual Tint Entry — create action |
| 6 | app/api/tint/manager/manual-entry/revert/route.ts | 103 | findUnique | Manual Tint Entry — revert action |
| 7 | app/api/tint/manager/orders/[id]/status/route.ts | 51 | findUnique | TM order — change-status action |
| 8 | app/api/tint/manager/orders/[id]/splits/route.ts | 21 | findUnique | TM order — splits drawer |
| 9 | app/api/tint/manager/splits/create/route.ts | 80 | findUnique | TM Split Builder — create action |
| 10 | app/api/tint/manager/reorder/route.ts | 41 | findMany | TM order — move up/down (per-operator queue) |
| 11 | app/api/tint/manager/assign/route.ts | 40 | findUnique (tx) | TM order — assign-to-operator action |
| 12 | app/api/tint/manager/assign/route.ts | 128 | aggregate (tx) | TM order — compute operator queue MAX seqOrder |
| 13 | app/api/tint/manager/cancel-assignment/route.ts | 28 | findUnique (tx) | TM order — cancel assignment action |
| 14 | app/api/tint/manager/challans/[orderId]/route.ts | 36 | findUnique | Challan detail — fetch order context |
| 15 | app/api/tint/manager/challans/[orderId]/route.ts | 412 | findUnique | Challan POST (regen) — refetch order context |
| 16 | app/api/tint/manager/challans/route.ts | 70 | findMany | Challan list — orders that have challans |
| 17 | app/api/tint/operator/my-orders/route.ts | 29 | findMany | Tint Operator — My Jobs queue |
| 18 | app/api/tint/operator/start/route.ts | 73 | findUnique | Tint Operator — Start Job action |
| 19 | app/api/tint/operator/done/route.ts | 36 | findUnique | Tint Operator — Mark as Done action |
| 20 | app/api/support/orders/route.ts | 124 | findMany | Support board — main order list |
| 21 | app/api/support/orders/[id]/route.ts | 29 | findUnique | Support — OrderDetailPanel GET |
| 22 | app/api/support/orders/[id]/route.ts | 116 | findUnique | Support — order PATCH |
| 23 | app/api/support/orders/[id]/release/route.ts | 23 | findUnique | Support — release from hold |
| 24 | app/api/support/orders/[id]/hold/route.ts | 23 | findUnique | Support — hold order |
| 25 | app/api/support/orders/[id]/dispatch/route.ts | 23 | findUnique | Support — mark dispatched |
| 26 | app/api/support/orders/[id]/cancel/route.ts | 36 | findUnique | Support — cancel order |
| 27 | app/api/support/orders/[id]/assign-slot/route.ts | 32 | findUnique | Support — assign slot |
| 28 | app/api/support/bulk/route.ts | 31 | findUnique | Support — bulk action loop |
| 29 | app/api/support/slots/route.ts | 47 | findMany | Support — slot summary (header) |
| 30 | app/api/support/slots/route.ts | 111 | count | Support — pending count |
| 31 | app/api/support/slots/route.ts | 119 | count | Support — dispatched count |
| 32 | app/api/support/slots/route.ts | 126 | count | Support — tinting count |
| 33 | app/api/support/slots/route.ts | 152 | count | Support — hold count |
| 34 | app/api/planning/board/route.ts | 32 | findMany | Planning Kanban — main list |
| 35 | app/api/planning/orders/[id]/mark-picked/route.ts | 26 | findUnique | Planning — mark picked action |
| 36 | app/api/planning/plans/[id]/remove-order/route.ts | 42 | findUnique | Planning — remove from plan |
| 37 | app/api/planning/plans/[id]/loading-complete/route.ts | 40 | findUnique | Planning — loading-complete action |
| 38 | app/api/planning/plans/[id]/add-orders/route.ts | 49 | findUnique | Planning — add-orders action |
| 39 | app/api/planning/plans/route.ts | 73 | findUnique | Planning — plan create/edit action |
| 40 | app/api/warehouse/board/route.ts | 70 | findMany | Warehouse board — unassigned + per-picker |
| 41 | app/api/warehouse/assign/route.ts | 38 | findUnique | Warehouse — assign to picker action |
| 42 | app/(admin)/admin/page.tsx | 29 | count | Admin dashboard — today's orders tile |
| 43 | app/(admin)/admin/page.tsx | 30 | count | Admin dashboard — pending support tile |
| 44 | app/api/operations/summary/route.ts | 20 | count | Operations summary — total today |
| 45 | app/api/operations/summary/route.ts | 23 | count | Operations summary — pending support |
| 46 | app/api/operations/summary/route.ts | 26 | count | Operations summary — on hold |
| 47 | app/api/operations/summary/route.ts | 29 | count | Operations summary — dispatched |
| 48 | app/api/operations/summary/route.ts | 70 | count | Operations summary — unassigned |
| 49 | app/api/operations/summary/route.ts | 86 | findMany | Operations summary — overdue orders list |
| 50 | app/api/operations/summary/route.ts | 112 | count | Operations summary — per-slot counts |
| 51 | app/api/orders/[id]/detail/route.ts | 21 | findUnique | OrderDetailPanel — generic detail |
| 52 | app/api/orders/[id]/removed-lines/route.ts | 34 | findUnique | OrderDetailPanel — "Show removed lines" lazy fetch |
| 53 | app/api/admin/fix-challans/route.ts | 15 | findMany | Admin backfill — only create challans for live orders |

**Pattern note for action endpoints (findUnique by id):** simplest fix is `where: { id, isRemoved: false }` → return 404 when not found. Caller error path is the existing "Order not found" branch.

---

## Bucket 2 — `delivery_challans` reads needing `isVoided: false` or voided-state handling

| # | File | Line | Query type | UI surface (best guess) | Treatment |
|---|------|------|-----------|-------------------------|-----------|
| 1 | app/api/tint/manager/manual-entry/route.ts | 244 | findUnique | Manual Tint Entry — challan existence check before reuse/create | Filter `isVoided: false` so a voided challan does not block recreation |
| 2 | app/api/tint/manager/challans/[orderId]/route.ts | 53 | findUnique | Challan detail GET — primary screen | **No query filter.** Include `isVoided`, `voidReason`, `voidRemark`, `voidedAt` in `select` and let UI show VOIDED banner. Per spec: "return special voided state, NOT 404". |
| 3 | app/api/tint/manager/challans/[orderId]/route.ts | 395 | findUnique | Challan POST (formula save / regen) — refetch after write | Same as #2 — include voided fields, allow render of voided state. If action is destructive (edit formulas), POST handler should reject when `isVoided === true`. |

---

## Bucket 3 — intentional, must NOT filter

### orders (12)

| # | File | Line | Query type | Reason |
|---|------|------|-----------|--------|
| 1 | app/api/import/obd/route.ts | 269 | findFirst | OBD upsert — must see removed orders to decide skip/restore |
| 2 | app/api/import/obd/route.ts | 510 | findMany | Bulk header validation (`obdNumber: { in: ... }`) — needs full set to detect duplicates |
| 3 | app/api/import/obd/route.ts | 1008 | findMany | Post-insert ID lookup (PREVIEW path) — fetches by batchId, includes only just-inserted IDs |
| 4 | app/api/import/obd/route.ts | 1277 | findMany | Import-internal aggregation (preview confirmation) |
| 5 | app/api/import/obd/route.ts | 1424 | findMany | Import-internal aggregation (preview confirmation) |
| 6 | app/api/import/obd/route.ts | 1767 | findMany | Import-internal aggregation |
| 7 | app/api/import/obd/route.ts | 2041 | findMany | Import-internal aggregation |
| 8 | app/api/import/obd/route.ts | 2287 | findMany | Import-internal aggregation |
| 9 | app/api/import/obd/route.ts | 2754 | findMany | Post-insert ID lookup (CONFIRM path) — same role as #3 |
| 10 | lib/import-upsert/state.ts | 22 | findUnique | Import upsert state lookup |
| 11 | lib/slot-cascade.ts | 92 | findMany | **Disabled per CLAUDE_CORE.md §13 landmines.** Not called. |
| 12 | lib/day-boundary.ts | 79 | findMany | **Disabled per CLAUDE_CORE.md §13 landmines.** Not called. |

Additional admin backfill:

| # | File | Line | Query type | Reason |
|---|------|------|-----------|--------|
| 13 | app/api/admin/fix-slots/route.ts | 47 | findMany | One-time backfill of `orderDateTime` + slot recalc — admin needs to see all orders including any that were removed |

### delivery_challans (7)

| # | File | Line | Query type | Reason |
|---|------|------|-----------|--------|
| 14 | app/api/tint/manager/manual-entry/route.ts | 250 | findFirst | `MAX(challanNumber)` for next sequence — must count voided challans so numbers do not collide |
| 15 | app/api/admin/fix-challans/route.ts | 53 | findFirst | Same sequence-numbering need |
| 16 | app/api/import/obd/route.ts | 316 | findFirst | Challan existence check during import auto-creation |
| 17 | app/api/import/obd/route.ts | 333 | findFirst | Sequence numbering during import |
| 18 | app/api/import/obd/route.ts | 1040 | findFirst | Sequence numbering (PREVIEW path D2b) |
| 19 | app/api/import/obd/route.ts | 1519 | findFirst | Sequence numbering (alternate import branch) |
| 20 | app/api/import/obd/route.ts | 2796 | findFirst | Sequence numbering (CONFIRM path D2b) |

---

## Bucket 4 — unclear, need confirmation

### 4.1 — `lib/slot-history.ts:34` (findUnique on orders)

```ts
// Fall back to originalSlotId
const order = await prisma.orders.findUnique({
  where: { id: orderId },
  select: {
    originalSlot: { select: { name: true } },
  },
});
```

**Question:** `getSlotNameAtEndOfDay()` is used to reconstruct slot history for display. If a removed order's history is still being shown anywhere (e.g. audit timeline, day-end retrospective), should this read filter removed orders out (returning `null` for the slot name), or should it continue to return the historical slot regardless of removal? My read: history/audit should show removed orders' past state, so this stays unfiltered. But I'm not 100% sure where this helper is called from. Flagging.

### 4.2 — `lib/slot-history.ts:84` (findMany on orders)

```ts
const orders = await prisma.orders.findMany({
  // ... aggregate for slot timeline ...
});
```

**Question:** Same helper module as 4.1 — aggregation likely powers an audit / timeline view. If that view should hide removed orders, this needs `isRemoved: false`. If audit/historical, it should not. Confirm intent.

---

## Notes / observations

1. **Action endpoints (findUnique by id) are the bulk of Bucket 1 (~35 of 53).** For these, the most ergonomic fix is `where: { id, isRemoved: false }` — Prisma returns `null`, existing "Order not found" path fires. Avoids `if (order.isRemoved) return 404` boilerplate at every site.

2. **`include` / nested-read patterns are NOT covered by this audit.** Several queries `include` related orders or challans through other entities (e.g. `order_splits.findMany` with `include: { order: ... }`). Phase 2c may need a second pass on those — `include: { order: { where: { isRemoved: false } } }` isn't valid Prisma (where is not allowed on to-one includes), so those will need `where: { order: { isRemoved: false } }` on the outer query instead.

3. **`prisma.orders.aggregate` in `assign/route.ts:128` (Bucket 1, #12)** computes `_max.sequenceOrder` to determine where the new assignment lands in an operator's queue. Should ignore removed orders so the new card sits at the visual end of the operator's queue (since removed cards are hidden in the UI list).

4. **Two `tint/manager/challans/[orderId]/route.ts` reads** (Bucket 2 #2 and #3) are the most subtle — they need no query-level filter but the action handler at line 395 (POST) must reject writes when the challan is voided (rather than silently accepting formula edits on a voided document).

5. **Sequence-numbering challan reads (Bucket 3 #14–20)** all rely on `findFirst` ordered by `challanNumber DESC` (or similar). Voided challans keep their challan number reserved — including them is correct so the next allocated number does not collide with a previously-issued (now voided) one.

---

## Appendix — include/nested second pass (Phase 2c pre-flight)

Date: 2026-05-15 (Phase 2c pre-flight)

Searched: `include:\s*\{\s*(order|orders|challan|challans):` across `app/**` and `lib/**`. Eight raw matches; six unique outer queries after dedup of contextual hits. No `include: { challan:` or `include: { challans:` matches.

### TO-ONE `order` includes — outer query needs nested `where: { order: { isRemoved: false } }`

| # | File | Outer query | Outer line | `include: { order:` line | Treatment |
|---|------|-------------|------------|---------------------------|-----------|
| A1 | app/api/tint/operator/my-orders/route.ts | `prisma.order_splits.findMany` (Query 2 — splits assigned to operator) | 64 | 70 | Add `order: { isRemoved: false }` to outer `where` (already filters `assignedToId`/`status`) |
| A2 | app/api/tint/operator/my-orders/route.ts | `prisma.tint_assignments.findMany` (Query 4a — completed today) | 98 | 105 | Add `order: { isRemoved: false }` to outer `where` |
| A3 | app/api/tint/operator/my-orders/route.ts | `prisma.order_splits.findMany` (Query 4b — completed splits today) | 115 | 122 | Add `order: { isRemoved: false }` to outer `where` |
| A4 | app/api/tint/manager/orders/route.ts | `prisma.order_splits.findMany` (Set C — active splits, Assigned + In Progress columns) | 124 | 128 | Add `order: { isRemoved: false }` to outer `where` |
| A5 | app/api/tint/manager/orders/route.ts | `prisma.order_splits.findMany` (Set D — completed splits today) | 162 | 168 | Add `order: { isRemoved: false }` to outer `where` |
| A6 | app/api/tint/manager/orders/route.ts | `prisma.tint_assignments.findMany` (Set E — completed assignments today) | 203 | 209 | Add `order: { isRemoved: false }` to outer `where` |

### TO-MANY `orders` includes (dispatch_plan_orders join — `orders` is the relation name on `dispatch_plans`)

| # | File | Outer query | Outer line | `include: { orders:` line | Treatment |
|---|------|-------------|------------|----------------------------|-----------|
| A7 | app/api/planning/plans/[id]/loading-complete/route.ts | `prisma.dispatch_plans.findUnique` | 21 | 24 | **No change to include.** Plan iterates `plan.orders` (the join rows) and calls `prisma.orders.findUnique({ where: { id: planOrder.orderId } })` at line 40 — already in audit Bucket 1 #37, will get `isRemoved: false` filter there. The join rows themselves aren't `orders`. |
| A8 | app/api/planning/board/route.ts | `prisma.dispatch_plans.findMany` (Planning Board UI list) | 130 | 136 | Add `order: { isRemoved: false }` to the inner `orders` include's existing `where` clause: `orders: { where: { clearedAt: ..., order: { isRemoved: false } }, include: { order: {...} } }` — this filters the `dispatch_plan_orders[]` join by their related order's `isRemoved` flag. |

### Notes

- No `include: { challan: ... }` patterns found anywhere. Challan reads happen only via direct `prisma.delivery_challans.*` calls (covered in main audit Bucket 2/3).
- Six TO-ONE includes (A1–A6) all bubble through `order_splits.findMany` or `tint_assignments.findMany` outer queries. The outer queries already gate by status/assignment — adding `order: { isRemoved: false }` filters out splits/assignments whose parent order has been soft-removed. Without this filter, a removed order whose split is still `tint_assigned`/`in_progress` would surface on the operator's queue.
- A8 (Planning Board) is the only TO-MANY case where the inner `where` is the right hook. A `dispatch_plan_orders` row whose parent order was removed should not appear in the board view; the inner filter cleanly handles it.
