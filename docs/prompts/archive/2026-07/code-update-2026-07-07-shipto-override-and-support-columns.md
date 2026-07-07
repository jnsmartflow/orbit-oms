# Code Update — Ship-to override + Support columns (Material Type, Article)
2026-07-07 · Session doc for consolidation into canonical context files

Scope: two features shipped this session — (1) a ship-to override that flows through the mail-order pipeline AND is manually settable on the Support board, mirroring how dispatchStatus is carried; (2) two new display-only columns on the Support board (Material Type, Article).

All work read-only-discovered first, then built one step at a time, tsc-gated, committed to main, pushed. Schema is now v27.9 after two ALTERs (see below).

---

## Feature 1 — Ship-to override

### What it does (plain English)
An order's ship-to (delivery point) can now be redirected to a different **real customer** from `delivery_point_master`. Two entry points:
- **Mail-order enrichment** sets it automatically (same plumbing that already carries dispatchStatus).
- **Support staff** set it manually via an inline searchable cell on the Support board.

Storage decision: **id only** (a resolved FK), NOT a free-text or name/code snapshot. When the master customer's name is corrected later, the override reflects the correction automatically (the id is a live pointer, name/code read through it). No denormalized copy to go stale.

### Schema changes (two ALTERs, via Supabase SQL Editor)

**orders** — new column:
```
shipToOverrideCustomerId  Int?   // FK → delivery_point_master(id), nullable
```
Relation added in schema.prisma as `shipToOverrideCustomer` with `@relation("OrderShipToOverride")`.
IMPORTANT prisma gotcha: `orders` now has TWO relations to `delivery_point_master` (existing `customer` + new override). Both must be explicitly NAMED on all four sides. The existing `customer` relation was named `@relation("OrderCustomer")`; the new one `@relation("OrderShipToOverride")`. Unnamed → prisma generate ambiguity error.

**mo_orders** — new column:
```
shipToOverrideCustomerId  Int?   // FK → delivery_point_master(id), nullable
```
Relation `shipToOverrideCustomer` with `@relation("MoOrderShipToOverride")`. This is mo_orders' FIRST relation to delivery_point_master (no double-relation trap).

Both columns nullable, no default. Existing boolean flags `orders.shipToOverride` / `mo_orders.shipToOverride` are retained and kept in sync (true when an id is set, false when cleared).

### Code changes

**lib/mail-orders/delivery-match.ts** — `matchDeliveryCustomer()`:
- The `findMany` on delivery_point_master now selects `id: true` (previously fetched only customerCode + customerName — id was never queried).
- Return type widened to include `customerId: number`; override-hit return now includes `customerId: match.id`. Null-return paths (not-found / same-customer) unchanged.
- The `[→ Name (Code)]` suffix text encoding into deliveryRemarks is UNCHANGED — the id is stored ALONGSIDE it, not instead of it.

**app/api/mail-orders/ingest/route.ts** — the `mo_orders.create`:
- On an override hit (`deliveryMatch && deliveryMatch.isOverride`), sets `shipToOverrideCustomerId: deliveryMatch.customerId`.
- Existing `shipToOverride` flag + deliveryRemarks suffix lines unchanged.

**app/api/import/obd/route.ts** — `applyMailOrderEnrichment()`:
- Beside the existing `shipToOverride` flag copy, added:
  ```ts
  if (mailOrder.shipToOverrideCustomerId != null) {
    updateData.shipToOverrideCustomerId = mailOrder.shipToOverrideCustomerId;
  }
  ```
- Uses `!= null` (not truthiness) so a valid id is never dropped. The mo_orders `findFirst` fetches the whole row, so no select change was needed.
- Copies onto orders via the existing `orders.updateMany({ where: { soNumber }, data: updateData })` — same path as dispatchStatus.

**app/api/support/orders/[id]/route.ts** — the Support PATCH route:
- `patchSchema` extended: `shipToOverrideCustomerId: z.number().int().positive().nullable().optional()` (number = set, null = clear, omitted = no change).
- New diff block mirrors the dispatchStatus block exactly: compares against current, sets `updateData.shipToOverrideCustomerId`, ALSO sets `updateData.shipToOverride = (value !== null)` to keep the flag synced, and pushes an `order_status_logs` entry.
- No new delivery_point_master lookup (FK enforces validity at DB layer). No new prisma.$transaction — rides the EXISTING (pre-existing landmine) transaction in this route.
- Type note: `updateData` annotation changed `Prisma.ordersUpdateInput → Prisma.ordersUncheckedUpdateInput` so the raw FK scalar can be assigned directly (standard prisma move for scalar FK writes).

**app/api/support/orders/route.ts** — the Support board payload:
- `ORDER_INCLUDE` now includes `shipToOverrideCustomer: { select: { id, customerName, area: { select: { name } } } }`, matching the existing `customer` include style.
- The `shipToOverrideCustomerId` scalar rides along automatically (route uses `include`, and `mappedOrders` spreads `...order`) — no explicit select needed.

**app/api/support/ship-to-search/route.ts** — NEW read-only route:
- `GET /api/support/ship-to-search?q=...` — auth-gated (support/admin/operations), `export const dynamic = 'force-dynamic'`.
- Short-circuits to `[]` when q is missing or under 2 chars.
- Queries delivery_point_master: `contains` + `mode: "insensitive"` on customerName, `isActive: true`, `take: 8`, ordered by name.
- Returns flat array `[{ id, customerName, area }]`. SELECT only.

**components/support/ship-to-override-cell.tsx** — NEW component:
- Props: `{ orderId, current: { id, customerName } | null, onSave: (orderId, customerId | null) => Promise<void> }`.
- Three states:
  - EMPTY (current null, not editing) — faint "Set ship-to" affordance, click enters editing.
  - EDITING — autofocused text input, ~250ms-debounced fetch to the ship-to-search route (skipped under 2 chars), dropdown of results (customer name on top + area underneath); click a result → onSave(id), exit; Esc / blur-with-delay cancels without saving.
  - SET (current not null) — compact teal pill showing **customerName ONLY** (no area — per approved refinement) + ✕ to clear (onSave(null)).
- Debounce via useRef timeout; no request-abort (fine at 8 results, single in-flight). Saving state disables input/pill; toast on fetch failure (sonner, already imported).

**components/support/support-page-content.tsx**:
- `handleShipToOverride` added, structurally identical to `handleDispatch` but hitting the generic PATCH route `/api/support/orders/${orderId}` with `{ shipToOverrideCustomerId }`, toast, then `await refresh()`. Passed to the table as `onShipToOverride`.

**components/support/support-orders-table.tsx**:
- `SupportOrder` interface gained `shipToOverrideCustomerId?` and `shipToOverrideCustomer?: { id, customerName, area?: { name } | null } | null`.
- GRID template gained one track for the SHIP-TO OVERRIDE column (inserted after CUSTOMER). Header + `<ShipToOverrideCell>` inserted after the CUSTOMER cell, `onShipToOverride` threaded through the same relay as `onSingleDispatch`.

### Landmine noted (do NOT "fix" without instruction)
- **`components/support/ship-to-override-modal.tsx` is orphaned dead code.** It predates this build: no button opens it (no `onShipOverride(...)` trigger in OrderRow), its form is free-text (not the picker), and its onSave is a no-op (never calls fetch). It was LEFT UNTOUCHED this session (CORE: never delete files unless instructed). Flag for a later cleanup pass. The live ship-to override is the inline cell, fully independent of this modal.

### Verified live
Support board shows the SHIP-TO OVERRIDE column: empty rows show "Set ship-to"; a set override shows a name-only teal chip with ✕. Column aligned. Search/pick/save/clear pattern matches the dispatch-slot inline pattern.

### Parked / follow-ups
- **2b live test (PENDING):** confirm a real post-deploy mail order with a resolved redirect actually fills `mo_orders.shipToOverrideCustomerId` → then flows to `orders.shipToOverrideCustomerId` via enrichment. Verify SQL:
  ```sql
  SELECT id, "createdAt", "customerCode", "shipToOverride", "shipToOverrideCustomerId", "deliveryRemarks"
  FROM mo_orders
  WHERE "shipToOverride" = true
  ORDER BY "createdAt" DESC
  LIMIT 15;
  ```
  (Older rows are null — expected, no backfill. Only a post-deploy override-match row proves the path.)
- **`shipToOverride = true` can fire with no resolved customer** (free-text redirects like "as per challan", "Delivery on Challan copy") — those will never have an id, only text. So "flag true" does NOT guarantee "id present." Any screen displaying the override must handle: id set (show resolved customer) vs flag-only (text/no clean id).
- **Ship-to override on OTHER screens (Planning, Warehouse, challan, etc.) — DEFERRED.** Smart Flow wants these one screen at a time, later. Nothing built yet.
- **Backfill of historical overrides — DEFERRED, maybe never.** Old mo_orders only carry the redirect as `[→ Name (Code)]` text in deliveryRemarks; recovering the id needs a parse-then-resolve one-off script. Not needed to proceed.

---

## Feature 2 — Support board: Material Type + Article columns (display-only)

### What it does
Two new read-only columns on the Support board, surfacing data auto-import already stores:
- **MATERIAL TYPE** ← `orders.materialType` (e.g. "FG")
- **ARTICLE** ← `orders.querySnapshot.articleTag` (e.g. "18 Drum, 2 Carton") — the human-readable pack breakdown tag. (Chose the TAG, not the numeric `totalArticle` count.)

### Discovery findings (for reference)
- `orders.materialType` — `String?` scalar, written directly at import (`app/api/import/obd/route.ts` — `materialType: summary.materialType`). Rides down via `include` automatically but was NOT typed on `SupportOrder`.
- **No `article` column on orders.** "Article" lives on the related `import_obd_query_summary` table (1:1 via `orders.querySnapshot`): `totalArticle Int` (summed count) + `articleTag String?` (text tag). Raw per-line values on `import_raw_line_items` (`article Int?`, `articleTag String?`) get summed into the summary at import.
- `articleTag` was ALREADY selected in `ORDER_INCLUDE.querySnapshot.select` AND already typed on `SupportOrder` — so no payload change was needed for the tag.
- `totalArticle` is NOT selected/typed (not used — we chose the tag).

### Code change (one file)
**components/support/support-orders-table.tsx**:
- `SupportOrder` gained `materialType?: string | null` (articleTag already typed under querySnapshot — not re-added).
- GRID template extended 10 → 12 tracks (the 10 already included the ship-to override column from Feature 1). Two new tracks + two header cells + two plain-text data cells inserted between ROUTE/TYPE and VOL(L):
  - MATERIAL TYPE cell → `order.materialType ?? "—"`
  - ARTICLE cell → `order.querySnapshot?.articleTag ?? "—"`
- Styled like the existing ROUTE/TYPE text cell. Display-only — no edit, no save. No schema change, no API/payload change.

### Verified live
Both columns show between ROUTE/TYPE and VOL(L), filled from imported data ("FG", "18 Drum, 2 Carton"), empty rows show "—", headers aligned (header + data rows both 12 grid cells).

---

## Schema version
Two ALTERs this session (orders + mo_orders each gained `shipToOverrideCustomerId`). Bump CORE schema version accordingly when consolidating (was v27.7 at session start).

## Commits (all on main, pushed)
- `d3486a12` — orders.shipToOverrideCustomerId + schema mirror (dual-relation naming)
- `aa30ea6c` — mo_orders.shipToOverrideCustomerId + schema mirror
- `c9894e5e` — delivery-match saves id + ingest persists it
- `27247319` — enrichment copies id → orders
- `18ccdcb9` — Support PATCH route accepts shipToOverrideCustomerId
- `29ce8aa5` — NEW ship-to-search read-only route
- `4492ac1a` — Support payload carries current override
- `05c3abe0` — ShipToOverrideCell + wiring (inline column)
- `714251ef` — Material Type + Article columns (display-only)

## Consolidation targets
- **CLAUDE_CORE.md** — schema section (two new columns + relations), schema version bump, §13 landmine (orphaned ship-to-override-modal).
- **CLAUDE_MAIL_ORDERS.md** — Enrichment v3 (id copy-through), delivery-match (id now returned + persisted to mo_orders), ingest write.
- **CLAUDE_SUPPORT.md** — new SHIP-TO OVERRIDE column + inline picker + PATCH field; new Material Type + Article columns; new ship-to-search route; column list now 11 columns.
- **CLAUDE_UI.md** — Support screen visual spec: ship-to override cell (3 states, name-only chip), two new text columns, GRID track count.
