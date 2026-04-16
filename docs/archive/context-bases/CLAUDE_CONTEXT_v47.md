# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v47.md fully before doing anything else."
# Version: Phase 1 Go-Live · Schema v25 · Context v47 · April 2026

---

## 1-41. [Unchanged from v38]

(All sections 1 through 41 remain unchanged — refer to v38 for full content)

---

## 42. Known Issues / Pending Fixes (UPDATED v47)

1. **Warehouse header stats mismatch** — header shows different count than unassigned panel in history view
2. **Cleanup Prisma field mapping** — pick_assignments.clearedAt had @map("cleared_at") mismatch, fixed by removing @map. Verify cleanup runs correctly on next day boundary.
3. ~~**Slot cascade (NOT YET BUILT)**~~ — **DONE v33.**
4. **Duplicate pick columns** — orders and order_splits both have camelCase (isPicked, pickedAt, pickedById) AND snake_case (is_picked, picked_at, picked_by_id) columns. Use camelCase ones via Prisma.
5. ~~**Tint manager filter crash**~~ — **FIXED v36.** All array assignments in tint-manager-content.tsx and tint-operator-content.tsx have ?? [] fallbacks.
6. **Slot cascade changedById** — uses hardcoded userId=1 (admin) for system-generated audit logs.
7. ~~**Import not working**~~ — **FIXED v34.**
8. **Slot cascade cascades pending_support orders** — cascade moves ALL orders including those not yet submitted by Support. Consider adding workflowStage filter to cascade eligibility.
9. **Support board default slot on refresh** — intermittent issue, deprioritised.
10. ~~**TM slot filter broken**~~ — **FIXED v39.**
11. ~~**TM dispatch filter misleading**~~ — **FIXED v39.**
12. **Shade Master isActive filter** — UI sends `isActive=true/false` param but `/api/admin/shades` may not handle it yet. Verify and add if missing.
13. **Mail Order — Lock persistence** — Lock flag (formerly OD/CI) is currently local state only (lost on refresh). Add `isLocked` boolean field to `mo_orders` table + PATCH API endpoint to persist flag.
14. **Universal header — old header code** — TM has old header wrapped in `display:none` div. Should be fully removed in cleanup pass.
15. **Universal header — production verification pending** — Only TM, Tint Operator, and Mail Orders headers verified in production. Support, Planning, Warehouse, TI Report, Shade Master need verification after respective users log in.
16. **Mail Orders — auto-refresh** — Page doesn't auto-refresh when new orders arrive via PowerShell. Need setInterval (30-60s) on the fetch useEffect.
17. **Mail Order — sort/product-category fine-tuning** — Pack-size sort and product grouping in expanded view needs debugging. Sorting logic and product category display under review.
18. **Mail Order — paintType data enrichment pending** — `mo_sku_lookup` needs a `paintType` column (oil/water/stainer) for warehouse-zone-aware splitting. ~130 products need classification. Data task not yet started.

---

## 43. Queued Features (UPDATED v47)

- ~~**Slot cascade**~~ — **DONE v33**
- ~~**Import debugging**~~ — **DONE v34**
- ~~**OBD date parsing fix**~~ — **DONE v34**
- ~~**Support history view**~~ — **DONE v35**
- ~~**Order detail panel**~~ — **DONE v35** (Support only → now also TM v39)
- ~~**Role-based navigation + redirects**~~ — **DONE v36**
- ~~**Operations role + unified ops view**~~ — **DONE v36**
- ~~**TM filter fix + slot awareness**~~ — **DONE v39**
- ~~**TM neutral palette redesign**~~ — **DONE v39**
- ~~**TM order detail panel integration**~~ — **DONE v39**
- ~~**Shade Master neutral redesign**~~ — **DONE v40**
- ~~**TI Report neutral redesign**~~ — **DONE v40**
- ~~**Mail Order email parsing + SKU enrichment (PowerShell)**~~ — **DONE v41.**
- ~~**Mail Order backend (DB + APIs + enrichment engine)**~~ — **DONE v42.**
- ~~**Mail Order frontend page**~~ — **DONE v43.**
- ~~**Mail Order role**~~ — **DONE v43.**
- ~~**soNumber import mapping**~~ — **DONE v44.** SAP SONum → orders.soNumber.
- ~~**Dispatch enrichment from FW: email**~~ — **DONE v44.** PS v3 extracts dispatch data.
- ~~**Mail Order — customer matching**~~ — **DONE v45.** Customer code auto-matching from email subject.
- ~~**Universal header system**~~ — **DONE v46.** Shared `<UniversalHeader />` component across all 8 boards.
- ~~**Mail Order — SKU line enrichment (volume, batch copy, split, sort)**~~ — **DONE v47.** See §59 for full documentation.
- **Cascade badge** — When `originalSlotId !== slotId`, show `⏩ from {originalSlot.name}` badge on order rows.
- **Apply neutral theme to all screens** — Support, Planning, Warehouse, Tint Operator need same neutral palette as TM v39.
- **Order detail panel** — wire into Planning board and Warehouse board
- **Audit history in detail panel** — order_status_logs exists, not yet fetched/rendered
- **CustomerMissingSheet styling** — not matching admin customer form
- **Smart slot assignment** — orders arriving at/after slot cutoff auto-escalate
- **Visual "carried over" indicator for overdue orders in slot tabs**
- **MIS Override Layer** — Admin-only field-level overrides per OBD
- **Barcode/QR label generation** — post-TI submission
- **Customer data enrichment** — remaining area batches
- **Operations password change** — operations@orbitoms.com temp password 'operations123' must be changed in prod
- **Mail Order — Lock persistence** — flag is currently local state only. Need DB persistence.
- **Mail Order — SAP operator role page** — consider adding read-only ops view
- **Mail Order — auto-refresh** — add setInterval polling for new orders
- **Watch-OrderEmails-v2.ps1 retirement** — RE: email script no longer needed.
- **Mail Order — backfill endpoint cleanup** — `app/api/mail-orders/backfill-customers/route.ts` is temporary, delete after confirming.
- **Universal header cleanup** — remove display:none old header code from TM, delete unused old header component files.
- **Mail Order — paintType enrichment** — add `paintType` column to `mo_sku_lookup`, classify ~130 products as oil/water/stainer, use in split algorithm for warehouse-zone grouping.

---

## 52-54. [Unchanged from v39-v40]

(Tint Manager Redesign, Shade Master Redesign, TI Report Redesign — refer to respective versions)

---

## 56. Email Monitor Pipeline — RE: Emails (DEPRECATED v44)

**DEPRECATED.** Refer to v41 for historical reference only.

---

## 57. Mail Order Pipeline (UPDATED v45 — unchanged in v47)

(Refer to v45 for full Mail Order Pipeline documentation including customer matching)

---

## 58. Universal Header System (NEW v46 — unchanged in v47)

(Refer to v46 for full Universal Header documentation)

---

## 59. Mail Order SKU Line Enrichment — Volume, Batch Copy, Auto-Split, Sort (NEW v47 — April 4, 2026)

### Overview

Enriched the mail order experience with volume calculation, batch copy for large orders, auto-split for high-volume/high-line-count orders, picker-optimized line sorting, and original email view toggle.

### Schema Changes (v25)

**mo_orders — 2 new columns:**
```sql
ALTER TABLE mo_orders
  ADD COLUMN IF NOT EXISTS "splitFromId" INT,
  ADD COLUMN IF NOT EXISTS "splitLabel" TEXT;
```

**mo_order_lines — 1 new column:**
```sql
ALTER TABLE mo_order_lines
  ADD COLUMN IF NOT EXISTS "originalLineNumber" INT;
```

**Prisma model additions:**
```prisma
// mo_orders
splitFromId  Int?
splitLabel   String?

// mo_order_lines
originalLineNumber Int?
```

### Feature 1 — Volume Calculation (client-side)

**Utility functions in `lib/mail-orders/utils.ts`:**
- `getPackVolumeLiters(packCode)` — maps packCode to liters. 20 known values from mo_sku_lookup. Values ≥100 are milliliters (100→0.1L, 200→0.2L, 500→0.5L). Also parses suffixed formats from email (500ml, 200ml, 25kg→0). Full map: 0.2→0.2L, 0.5→0.5L, 1→1L, 2→2L, 3→3L, 4→4L, 5→5L, 10→10L, 15→15L, 20→20L, 22→22L, 25→25L, 30→30L, 40→40L, 50→50L, 100→0.1L, 200→0.2L, 250→0.25L, 400→0.4L, 500→0.5L.
- `getLineVolume(qty, packCode)` — qty × packVolume
- `getOrderVolume(lines)` — sum of line volumes
- `formatVolume(liters)` — "500ml" for <1L, "25L" for ≥1L

**Display locations:**
- Expanded view: `Vol` column per line (e.g. "600L", "200ml")
- Collapsed row Lines cell: stacked below fraction (e.g. "4/4" then "480L")
- Slot section header: total slot volume (e.g. "127/139 lines · 8,721L")

### Feature 2 — SKU Description in Expanded View

**Expanded view colgroup changed from 6 to 8 columns:**
```
# (38) | Raw Text (30%) | SKU Code (130) | Description (30%) | Pk (48) | Qty (52) | Vol (56) | Status (76)
```
- Description shows `skuDescription` from mo_order_lines (populated by enrich.ts)
- Fills the large gap that existed in the old 6-column layout

### Feature 3 — Batch Copy (>20 lines)

**Constants:** `BATCH_COPY_LIMIT = 20`

**Behavior:**
- ≤20 matched lines: single copy button, unchanged (📋 4)
- \>20 matched lines: progressive single button (📋 1-20 (1/2))
- Click copies current batch, advances to next (📋 21-34 (2/2))
- Wraps around after last batch
- S key shortcut follows same cycle
- Batch state shared between button click and S key (lifted to page.tsx via `batchStates` Record + `onAdvanceBatch` callback)

**Utilities:** `buildBatchClipboardText(lines, batchIndex)` in utils.ts alongside existing `buildClipboardText()`.

### Feature 4 — Auto-Split at Ingest

**Thresholds:**
- `SPLIT_VOLUME_THRESHOLD = 1500` (liters)
- `SPLIT_LINE_THRESHOLD = 20` (lines)

**Trigger:** During `POST /api/mail-orders/ingest`, after enriching all lines, if total volume > 1500L OR total lines > 20 → auto-split.

**Algorithm — Category-first split (`splitLinesByCategory` in utils.ts):**

1. Group lines by `productName` → category blocks
2. If any single block has >60% of total volume → sub-split that block by `packCode`
3. Sort blocks by volume DESC
4. Greedy bin-pack with **weighted score**: `0.5 × (vol/totalVol) + 0.5 × (count/totalCount)`. Balances both volume and line count.
5. Guard rail: if either group has <8 lines → rebalance using same weighted score by line count DESC
6. Nuclear fallback: if still unbalanced → simple halving
7. Sort lines within each group by pack volume DESC (largest packs first for picker efficiency)

**Split data model:**
- Original order becomes Group A: `splitLabel="A"`, `splitFromId=null`
- New order is Group B: `splitLabel="B"`, `splitFromId=orderA.id`
- Both are `status="pending"` — both visible in table
- Group B `emailEntryId` = `${original}__B` for unique constraint
- Customer matching data copied to both halves
- Lines reassigned via `updateMany`, re-numbered sequentially per group
- `originalLineNumber` set at creation time, preserved through split

### Feature 5 — Manual Split (post-resolve threshold crossing)

**Endpoint:** `POST /api/mail-orders/[id]/split`
- Body: `{ groups: [groupALineIds[], groupBLineIds[]] }`
- Validates all line IDs belong to order, no duplicates, all accounted for
- Creates Group B order, updates Group A, reassigns lines
- Re-numbers in the order received (preserves frontend's pack-size sorted order)

**Frontend trigger (ExpandRow):**
- `useEffect` watches `resolvedLines` state
- When total volume crosses threshold (including newly resolved lines) AND order has no splitLabel → shows amber split suggestion banner
- Banner shows: "⚠ Large order — split recommended" with Group A/B preview (line counts + volumes)
- "✂ Split Order" button → calls split API → triggers `onSplitComplete` (page refetch)
- "Dismiss" button → hides banner for this session (resets on close/reopen)

### Feature 6 — Picker-Optimized Line Sort

**Utility:** `sortLinesForPicker(lines)` in utils.ts
- Primary sort: `productName` alphabetical (keeps same product together)
- Secondary sort: pack volume DESC (largest pack first within each product)
- Unknown/zero-volume packs (kg, null) sort to end

**Applied to:**
- Expanded view: all orders with >5 lines (`SORT_DISPLAY_THRESHOLD = 5`)
- SKU copy: clipboard uses sorted order for SAP paste
- Split groups: lines within each group sorted by pack size (server-side during split)

**Future enhancement:** When `paintType` column is added to `mo_sku_lookup`, sort becomes three-level: `paintType → productName → packSize DESC`. This groups all oil-paint SKUs together and all water-paint SKUs together, matching warehouse zone layout.

### Feature 7 — View Original / Email Order Toggle

**For split orders (>5 lines):**
- Toggle button: "📧 Original Order" / "✂ Split View"
- Fetches ALL lines from both halves via `GET /api/mail-orders/[id]/original-lines`
- `OriginalLinesTable` component: shows all lines in `originalLineNumber` order, Group column with purple A / blue B pills, current group at full opacity, other group at 50%

**For non-split orders (>5 lines):**
- Toggle button: "📧 Email Order" / "📦 Sorted View"
- No API call — uses existing `order.lines` unsorted (email sequence)
- Same table, no Group column

**For orders ≤5 lines:** No toggle, no sort. Lines show in email sequence.

**Endpoint:** `GET /api/mail-orders/[id]/original-lines`
- Finds both sibling orders via `splitFromId` relationship
- Returns all lines sorted by `originalLineNumber` ASC
- Tags each line with `groupLabel: "A" | "B"`

### Feature 8 — Split Pair Display

**Visual indicators on collapsed rows:**
- Customer name suffix: `"(A)"` / `"(B)"` appended to display name
- Purple left border: `3px solid #a78bfa` (purple-400)
- ✂ badge in Lines cell: `"✂ A"` / `"✂ B"` in purple-500

**Sort order:** Split pairs appear in time sequence (by `receivedAt`), A before B within same time. Uses combined sort: dispatch weight → receivedAt → splitLabel.

**Volume warning badge:** Non-split, non-punched orders exceeding thresholds show amber `⚠ {volume}` or `⚠ {lineCount} lines` badge in Lines cell.

### Column Widths (parent table, updated v47)

```
Time(68) | SO Name(120) | Customer(220) | Lines(56) | Dispatch(80) |
Remarks(120) | Code(90) | SKU(82) | SO No.(110) | Lock(46) | Status(80) | Punched By(100)
```

Changes from v46: Remarks 140→120, SKU 60→82, Lock 70→46, Status 100→80, Punched By 120→100, Lines 54→56.

### Files Modified/Created in v47

**New files:**
- `app/api/mail-orders/[id]/split/route.ts` — manual split endpoint
- `app/api/mail-orders/[id]/original-lines/route.ts` — fetch both halves for original view

**Modified files:**
- `prisma/schema.prisma` — splitFromId, splitLabel on mo_orders; originalLineNumber on mo_order_lines
- `lib/mail-orders/utils.ts` — volume utilities, batch copy, split algorithm, sort utility, constants
- `lib/mail-orders/types.ts` — splitFromId, splitLabel, originalLineNumber on types
- `app/api/mail-orders/ingest/route.ts` — auto-split after enrichment, originalLineNumber on line creation
- `app/api/mail-orders/[id]/split/route.ts` — manual split preserving pack-size order
- `app/(mail-orders)/mail-orders/mail-orders-table.tsx` — expanded view redesign, batch copy, split display, volume badges, sort, toggle, OriginalLinesTable component
- `app/(mail-orders)/mail-orders/page.tsx` (mail-orders-page.tsx) — batch state, onSplitComplete, onAdvanceBatch props

### Constants Reference

```typescript
BATCH_COPY_LIMIT = 20           // lines per clipboard batch
SPLIT_VOLUME_THRESHOLD = 1500   // liters — auto-split trigger
SPLIT_LINE_THRESHOLD = 20       // lines — auto-split trigger
MIN_GROUP_LINES = 8             // minimum lines per split group (internal)
DOMINANT_CATEGORY_THRESHOLD = 0.6  // 60% — when to sub-split by packCode (internal)
SORT_DISPLAY_THRESHOLD = 5      // show sort + toggle for orders >5 lines
```

---

## 55. Session Start Checklist (UPDATED v47)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v25** (v24 + mo_orders: splitFromId, splitLabel; mo_order_lines: originalLineNumber)
3. **Universal header (v46):** `<UniversalHeader />` in `components/universal-header.tsx`. Used by ALL 8 boards. Do NOT create new header patterns.
4. **CLAUDE_UI.md v4.4:** Load alongside this file for ALL UI work
5. **Planning is ORDER level** (v28 correction still applies)
6. **Tint Manager uses OrderDetailPanel** not SkuDetailsSheet (v39)
7. **Delivery type dot colors:** blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross). Normalize with .toUpperCase().
8. **Slot segments:** 4 slots only — Morning, Afternoon, Evening, Night. Filter out Next Day Morning (isNextDay).
9. **Shade Master:** No segments, no date picker. Search + filter only.
10. **TI Report:** Date presets as segments, DateRangePicker as leftExtra, Download button, no date stepper.
11. **page.tsx pattern:** All board pages are bare `<ComponentName />` — no wrapper div, no title
12. **Mail Order frontend:** LIVE. 12-column table (widths updated v47), customer code matching, delivery type dots, smart title case, dispatch badges, SO Number auto-punch, Lock column, urgent banner.
13. **Mail Order enrichment:** Try-and-verify engine.
14. **Mail Order PowerShell:** `Parse-MailOrders-v3.ps1` — run manually for now, Task Scheduler setup pending.
15. **Mail Order Lock flag:** Local state only — not persisted to DB yet.
16. **billing_operator role:** id=13, pageKey=mail_orders. Users: Deepanshu (id 25), Bankim (id 26). Password: Billing@123.
17. **SAP import enrichment:** `applyMailOrderEnrichment()` auto-applies dispatch data from mo_orders to orders when soNumber matches.
18. **soNumber on orders:** Mapped from SAP XLS "SONum" column in both manual and auto-import. Indexed.
19. **Mail Order customer matching:** LIVE (v45). customer-match.ts. Three states: exact/multiple/unmatched.
20. **Mail Order keyboard shortcuts:** C=copy code, S=copy SKU (batch-aware), P=open picker, Esc=close popover, ↑↓=navigate, Enter=expand.
21. **Smart title case:** smartTitleCase() in lib/mail-orders/utils.ts.
22. **Backfill endpoint:** `/api/mail-orders/backfill-customers` — temporary, delete after production verification.
23. **Universal header color rule:** ONE teal element (active slot). Everything else gray.
24. **Universal header props:** segments (count optional), leftExtra, rightExtra, showDatePicker, showDownload.
25. **Old header cleanup pending:** TM has display:none wrapper. Old header files exist but unused.
26. **Mail Order split system (v47):** Auto-split at ingest (>1500L or >20 lines). Category-first algorithm with weighted score balancing. Manual split API for post-resolve threshold crossing. View Original toggle. Picker-optimized sort (productName → packSize DESC). See §59.
27. **Mail Order volume (v47):** Client-side calculation from packCode × quantity. Displayed per-line, per-order, per-slot. See §59.
28. All existing checklist items from v38 #36 still apply

---

*Version: Phase 1 Go-Live · Schema v25 · Context v47 · April 2026*
