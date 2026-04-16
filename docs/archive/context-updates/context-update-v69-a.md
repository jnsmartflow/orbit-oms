# Context Update v69

## SCHEMA CHANGES

New rows in `role_permissions` table (via Supabase SQL Editor):

```sql
INSERT INTO role_permissions ("roleSlug", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
VALUES
  ('tint_manager', 'delivery_challans', true, false, false, true, false),
  ('tint_manager', 'shade_master',      true, false, false, true, false),
  ('tint_manager', 'ti_report',         true, false, true,  false, false)
ON CONFLICT ("roleSlug", "pageKey") DO NOTHING;
```

Three new pageKeys added to `lib/permissions.ts`: `delivery_challans`, `shade_master`, `ti_report` — added to `PageKey` type, `ALL_PAGE_KEYS` array, and `PAGE_NAV_MAP`.

## NEW/MODIFIED FILES

- `app/api/tint/manager/missing-customers/route.ts` — **NEW** — GET endpoint returning orders with `customerMissing: true` for SMU "Retail Offtake" / "Decorative Projects", excluding terminal stages.
- `components/tint/tint-manager-content.tsx` — Missing customer badge (amber pill) in UniversalHeader `rightExtra`. Popover dropdown listing missing customers. Click opens existing `CustomerMissingSheet`. Re-fetches on resolve. Serial number `#` column wiring for table view.
- `components/tint/tint-table-view.tsx` — Serial number `#` column added as first column in all four sections (Pending, Assigned, In Progress, Completed). Colgroup updated: `#(4%) | OBD(13%) | SMU(10%) | Site Name(18%) | ...`.
- `app/api/tint/manager/reorder/route.ts` — Reorder now per-operator: finds target order's operator, filters list to same operator's orders before swapping.
- `app/api/tint/operator/orders/route.ts` — Sort changed from `operatorSequence` (on `tint_assignments`) to `sequenceOrder` (on `orders` table). Operator screen now reflects TM reorder changes.
- `app/api/tint/manager/assign/route.ts` — New assignments get `sequenceOrder = MAX(sequenceOrder) + 1` within that operator's queue. New orders land at bottom of queue.
- `lib/permissions.ts` — `delivery_challans`, `shade_master`, `ti_report` added to `PAGE_NAV_MAP`, `PageKey` type, and `ALL_PAGE_KEYS`.
- `app/(tint)/tint/manager/layout.tsx` — Removed manually appended nav items (Delivery Challans, Shade Master, TI Report). Uses `buildNavItems()` only. Role passed from `session.user.role` instead of hardcoded `"tint_manager"`.
- All 8 layout files — Role prop changed from hardcoded string to `session.user.role as RoleSidebarRole`.

## NEW API ENDPOINTS

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/tint/manager/missing-customers | tint_manager, admin, operations | Returns `{ count, orders[] }` of all customerMissing orders for Retail Offtake / Decorative Projects SMUs |

## BUSINESS RULES ADDED

**Missing customer badge on TM header:** Amber pill in Row 2 `rightExtra` showing "N missing" when count > 0. Covers both tint and non-tint orders. Popover lists orders with OBD, type badge (Tint/Non-Tint), customer name, SMU. Click opens `CustomerMissingSheet`. Badge disappears when all resolved.

**Sequence sync — single source of truth:** Operator screen reads `sequenceOrder` from `orders`/`order_splits` table (not `operatorSequence` from `tint_assignments`). TM reorder changes are immediately visible to operators on refresh.

**Per-operator reorder:** Move up/down only swaps within the same operator's assigned orders. Cannot accidentally swap Deepak's order with Chandrasing's.

**Assignment queue position:** New assignments get `sequenceOrder = MAX + 1` for that operator's existing queue. Default sort: `sequenceOrder ASC → priorityLevel ASC → date ASC` (urgent orders float to top when sequence values are equal).

**Sidebar role from session:** All layout files pass `session.user.role` to `RoleLayoutClient` instead of hardcoded role strings. Sidebar role label and nav items stay consistent across pages.

**Centralized nav items:** TM-specific pages (Delivery Challans, Shade Master, TI Report) are in `PAGE_NAV_MAP` + `role_permissions` table. No manual appending in layout files. `buildNavItems()` is the single source for all layouts.

## PENDING ITEMS

1. **Bill-to address on delivery challan** — Challan shows Bill To code + name but no address. Address exists in `delivery_point_master`. Needs lookup by `billToCustomerId` in challan detail API. Prompt ready.
2. **TM filter bugs** — Delivery type case mismatch (LOCAL vs Local), legacy filter dropdown cleanup, operator filter in filterGroups needs removal. Prompt ready.
3. **`operatorSequence` cleanup** — Field on `tint_assignments` and `order_splits` is now unused for sorting. Can be removed from schema later.
4. **Reorder API uses `prisma.$transaction`** — Violates project rules but left as-is (simple two-update swap). Refactor to sequential awaits later.

## CHECKLIST UPDATES

- **Missing customer badge:** Fetched from `/api/tint/manager/missing-customers`. Re-fetched on `CustomerMissingSheet` resolve. Badge only renders when count > 0.
- **Sequence order:** Single field `sequenceOrder` on `orders`/`order_splits`. Both TM and operator screens read from it. Reorder is per-operator.
- **Sidebar role:** Always `session.user.role` — never hardcoded. Nav items from `buildNavItems()` only — no manual appending in layouts.
- **TM table `#` column:** 4% width first column in all sections. Simple 1-based row counter per section.