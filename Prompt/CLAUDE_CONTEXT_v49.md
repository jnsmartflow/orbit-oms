# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v49.md fully before doing anything else."
# Version: Phase 1 Go-Live · Schema v25 · Context v49 · April 2026

---

## 1-41. [Unchanged from v38]

(All sections 1 through 41 remain unchanged — refer to v38 for full content)

---

## 42. Known Issues / Pending Fixes (UPDATED v49)

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
13. **Mail Order — Lock persistence** — Lock flag is currently local state only (lost on refresh). Add `isLocked` boolean field to `mo_orders` table + PATCH API endpoint to persist flag.
14. **Universal header — old header code** — TM has old header wrapped in `display:none` div. Should be fully removed in cleanup pass.
15. **Universal header — production verification pending** — Only TM, Tint Operator, and Mail Orders headers verified in production. Support, Planning, Warehouse, TI Report, Shade Master need verification after respective users log in.
16. **Mail Orders — auto-refresh** — Page doesn't auto-refresh when new orders arrive via PowerShell. Need setInterval (30-60s) on the fetch useEffect.
17. ~~**Mail Order — sort/product-category fine-tuning**~~ — **FIXED v49.** Dispatch weight removed from sort. Volume moved to customer subtext. Split/warning badges moved to Remarks column.
18. **Mail Order — paintType data enrichment pending** — `mo_sku_lookup` needs a `paintType` column (oil/water/stainer) for warehouse-zone-aware splitting. ~130 products need classification. Data task not yet started.
19. ~~**Mail Order — Sara Paints bill split blocked**~~ — resolved via full data wipe and re-ingest.
20. **Mail Order — Shree Khodiyar unmatched bills** — aai Shree Khodiyar-549434 bills have some 0/x matched lines. Need to check rawText and add missing keywords.

---

## 43. Queued Features (UPDATED v49)

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
- ~~**Mail Order — Parser v4 fixes**~~ — **DONE v48.** See §60 for full documentation.
- ~~**Mail Order — Enrichment keywords**~~ — **DONE v48.** 124 product + 18 base keywords added.
- ~~**Mail Order — Ship-to override detection**~~ — **DONE v48.** See §60.
- ~~**Mail Order — Remarks signal badges**~~ — **DONE v48.** See §60.
- ~~**Mail Order — Sort fix, customer extraction, ML volume, UI layout**~~ — **DONE v49.** See §61.
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
- **Mail Order — SAP pick slip sequence investigation** — SAP reorders OBDs when generating pick slips. Need to check SAP delivery creation T-code, grouping settings, and pick slip output sort key. Requires operator input on T-codes used.

---

## 52-54. [Unchanged from v39-v40]

(Tint Manager Redesign, Shade Master Redesign, TI Report Redesign — refer to respective versions)

---

## 56. Email Monitor Pipeline — RE: Emails (DEPRECATED v44)

**DEPRECATED.** Refer to v41 for historical reference only.

---

## 57. Mail Order Pipeline (UPDATED v45 — unchanged in v49)

(Refer to v45 for full Mail Order Pipeline documentation including customer matching)

---

## 58. Universal Header System (NEW v46 — unchanged in v49)

(Refer to v46 for full Universal Header documentation)

---

## 59. Mail Order SKU Line Enrichment — Volume, Batch Copy, Auto-Split, Sort (NEW v47 — unchanged in v49)

(Refer to v47 for full §59 documentation)

---

## 60. Mail Order Parser v4 + Enrichment Keywords + Ship-To Override + Signal Badges (NEW v48 — unchanged in v49)

(Refer to v48 for full §60 documentation)

---

## 61. Mail Order — Sort Fix, Customer Extraction, Volume Fix, UI Layout, Keyword Cleanup (NEW v49 — April 2026)

### Sort Order Fix

**Removed dispatch weight from `groupOrdersBySlot()`.** Hold/Urgent orders no longer pinned to top of slot. Sort is now pure time-based:
1. `receivedAt` (earliest first)
2. Bill number (Bill 1 → Bill 2 → Bill 3...)
3. Split label (A before B)

`getDispatchSortWeight()` function deleted from `lib/mail-orders/utils.ts`. Hold/Urgent status visible via badge only.

### Auto-Split Single-Line Exemption

Single-line orders (1 product line) now exempt from auto-split even if volume > 1500L. Guard added in ingest route:
```
enrichedLines.length > 1 && (totalVolume > SPLIT_VOLUME_THRESHOLD || enrichedLines.length > SPLIT_LINE_THRESHOLD)
```

### Customer Code Extraction Fixes

**File:** `lib/mail-orders/customer-match.ts` — `extractCustomerFromSubject()`

Multiple fixes applied:
- **Leading "Urgent" strip** — `"Urgent Order-..."` → strips "Urgent " before processing
- **"Order -Name" space-dash** — new pattern handles `"Order -Hindustan Hw"` → `"Hindustan Hw"`
- **Trailing code detection** — if result ends with 4+ digit code, prepends it so `matchCustomer()` Step 0 can do exact code lookup. e.g. `"Shivshakti Hardware 106058"` → `"106058 Shivshakti Hardware"` → exact match
- **"Order-LETTERS" strip** — `"Order-Aryan coating"` → strip `"Order-"` prefix → `"Aryan coating"` (was over-stripping previously)

**Verify mentally:**
- `"FW: Order -Hindustan Hw 109547"` → `"109547 Hindustan Hw"` → Step 0 exact match
- `"FW: Order : Shivshakti Hardware 106058"` → `"106058 Shivshakti Hardware"` → Step 0 exact match
- `"Order-Aryan coating"` → `"Aryan coating"` → keyword match
- `"FW: Order-678709 Mistry Brothers"` → `"678709 Mistry Brothers"` → Step 0 exact match

**Note:** Customer matching fixes only affect NEW ingests. Existing DB rows are not updated retroactively.

### cleanSubject() Display Fixes

**File:** `mail-orders-table.tsx` — `cleanSubject()`

Comprehensive rewrite handling:
- Strip leading `"Urgent "`
- Strip `"Order -"` (space-dash)
- Strip `"Order-LETTERS"` prefix via `"Order-"` fallback
- Strip trailing `"- Truck Order"`, `"- Truck"`, `"(truck order)"`
- Strip parenthesized codes like `"(106058)"`
- Strip trailing code digits e.g. `"Shivshakti Hardware 106058"` → `"Shivshakti Hardware"`
- Strip trailing customer code with dash e.g. `"Shree Khodiyar-549434"` → `"Shree Khodiyar"`

### Truck Badge

Signal badge added for truck orders. Detects `"truck"` in subject, billRemarks, or remarks → shows `🚛 Truck` context badge in Remarks column.

### Volume Display Moved to Customer Subtext

**Volume** moved from Lines column to Customer column subtext (below name, before area · route). Color-coded: green if fully matched, amber if unmatched lines exist.

**Lines column** now shows ONLY the match count (X/Y). No volume, no split label.

### Split/Warning Badges Moved to Remarks Column

- `✂ A` / `✂ B` — split label shown as purple badge in Remarks
- `⚠ Split` — split warning (volume > 1500L or lines > 20) shown as amber badge in Remarks

New signal types added to `signalStyles`:
- `split`: `bg-purple-50 text-purple-600 border-purple-200`
- `warning`: `bg-amber-50 text-amber-700 border-amber-200`

### subjectCode Hidden for Exact-Matched Orders

`extractSubjectCode()` removed entirely. Subject code no longer shown in customer subtext for exact-matched orders (code already visible in Code column).

### ML Unit Volume Fix

**Root cause:** `mo_sku_lookup` stores `packCode="50"` and `unit="ML"` for stainer SKUs. `getPackVolumeLiters("50")` returned 50L instead of 0.05L.

**Fix in `enrich.ts`:**
- Added `resolvedPackCode(sku)` helper — appends `"ML"` suffix when `sku.unit === "ML"`
- Added `packCode` field to `EnrichResult` interface
- All matched return paths now include resolved packCode

**Fix in ingest route:**
- `mo_order_lines.create()` now uses `result.packCode || line.packCode` — enriched unit-aware value takes priority
- Stainer 50ML lines now stored as `packCode="50ML"` → `getPackVolumeLiters("50ML")` → 0.05L ✓

**Affected SKUs:** All DN Stainer lines (50ML, 100ML, 200ML pack sizes)

### Dangerous Short Keyword Cleanup

Deleted 9 keywords from `mo_product_keywords` that caused false positive matches via substring collision:

| Keyword | Was mapped to | Problem |
|---------|--------------|---------|
| ST | SB CEMENT PRIMER | Hit inside "FAST", "BEST" etc. |
| S T PRIMER | SB CEMENT PRIMER | Duplicate, redundant |
| PU | PU ENAMEL | Hit inside "PUTTY", "PURPLE" |
| WS | PROTECT | Hit inside "WEATHERSHIELD" |
| RED | FAST RED | Hit inside "CREDITED" |
| OIL | SUPER SATIN | Hit inside "FOIL", "COIL" |
| MAX | MAX | Hit inside "MAXIMUM" |
| PF | POWERFLEXX | Longer fallbacks exist |
| WBC | INTERIOR WBC | Longer fallbacks exist |

All deleted keywords have longer, unambiguous fallbacks in the DB.

### Parser v4.1 — Bill Marker Fixes

**File:** `Parse-MailOrders-v4.ps1` → bumped to v4.1.0

**Fix 1 — Bill marker regex capture group:**
After updating the bill marker regex to handle `"Bill No.-1"` format, `$Matches[2]` was used but the new regex only has one capture group → bill number was always empty → "Bill 0". Fixed to `$Matches[1]`.

**Fix 2 — Skip BillNumber=0 group:**
Rows before the first bill marker (BillNumber=0) are pre-order remarks, not product lines. Added `if ($bg.BillNumber -eq 0) { continue }` to skip posting these as a separate Bill 0 order.

**Bill marker regex (current):**
```powershell
(?i)^\s*Bill\s*[\.\-:\s]*(?:No)?[\.\-:\s]*(\d+)\s*[\-:]?\s*$
```
Handles: `"Bill 1"`, `"Bill No.1"`, `"Bill No.-1"`, `"Bill No 1"`, `"Bill-1"`, `"Bill:1"`

### Shivshakti 106058 — Manual Keyword Insert

Customer code 106058 not in `mo_customer_keywords`. Added manually:
```sql
INSERT INTO mo_customer_keywords (keyword, "customerCode", "customerName", area, "deliveryType", route)
VALUES ('106058', '106058', 'Shivshakti HW', null, null, null);
INSERT INTO mo_customer_keywords (keyword, "customerCode", "customerName", area, "deliveryType", route)
VALUES ('Shivshakti', '106058', 'Shivshakti HW', null, null, null);
```

### Files Modified in v49

- `lib/mail-orders/utils.ts` — removed `getDispatchSortWeight()`, updated `groupOrdersBySlot()` sort
- `lib/mail-orders/enrich.ts` — `resolvedPackCode()` helper, `packCode` in `EnrichResult`
- `lib/mail-orders/customer-match.ts` — `extractCustomerFromSubject()` multi-fix
- `app/api/mail-orders/ingest/route.ts` — single-line split guard, enriched packCode storage
- `app/(mail-orders)/mail-orders/mail-orders-table.tsx` — `cleanSubject()` rewrite, truck badge, volume to customer subtext, split/warning to remarks badges, subjectCode removed
- `Parse-MailOrders-v4.ps1` → v4.1.0 — bill marker `$Matches[1]` fix, BillNumber=0 skip

**SQL only:**
- 9 keyword DELETEs from `mo_product_keywords`
- 2 INSERTs into `mo_customer_keywords` for Shivshakti 106058

---

## 55. Session Start Checklist (UPDATED v49)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v25** (v24 + mo_orders: splitFromId, splitLabel; mo_order_lines: originalLineNumber)
3. **Universal header (v46):** `<UniversalHeader />` in `components/universal-header.tsx`. Used by ALL 8 boards. Do NOT create new header patterns.
4. **CLAUDE_UI.md v4.6:** Load alongside this file for ALL UI work
5. **Planning is ORDER level** (v28 correction still applies)
6. **Tint Manager uses OrderDetailPanel** not SkuDetailsSheet (v39)
7. **Delivery type dot colors:** blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross). Normalize with .toUpperCase().
8. **Slot segments:** 4 slots only — Morning, Afternoon, Evening, Night. Filter out Next Day Morning (isNextDay).
9. **Shade Master:** No segments, no date picker. Search + filter only.
10. **TI Report:** Date presets as segments, DateRangePicker as leftExtra, Download button, no date stepper.
11. **page.tsx pattern:** All board pages are bare `<ComponentName />` — no wrapper div, no title
12. **Mail Order frontend:** LIVE. 12-column table. Signal badges in Remarks column (includes ✂ split, ⚠ warning, 🚛 Truck). Volume in customer subtext. Lines column = match count only.
13. **Mail Order enrichment:** Try-and-verify engine. ~820 product keywords (9 dangerous short ones deleted), 208 base keywords, 1051 SKU lookup entries.
14. **Mail Order PowerShell:** `Parse-MailOrders-v4.ps1` → **v4.1.0**. Bill marker regex fixed (`$Matches[1]`). BillNumber=0 group skipped. Location: `C:\Users\HP\OneDrive\VS Code\mail-orders\`.
15. **Mail Order Lock flag:** Auto-locks on OD, CI, Bill Tomorrow (word-boundary regex). Manual lock still local state only — not persisted to DB yet.
16. **billing_operator role:** id=13, pageKey=mail_orders. Users: Deepanshu (id 25), Bankim (id 26). Password: Billing@123.
17. **SAP import enrichment:** `applyMailOrderEnrichment()` auto-applies dispatch data from mo_orders to orders when soNumber matches.
18. **soNumber on orders:** Mapped from SAP XLS "SONum" column in both manual and auto-import. Indexed.
19. **Mail Order customer matching:** LIVE (v45). customer-match.ts. Three states: exact/multiple/unmatched. extractCustomerFromSubject() handles: Urgent strip, space-dash, trailing code, Order-LETTERS prefix.
20. **Mail Order keyboard shortcuts:** C=copy code, S=copy SKU (batch-aware), P=open picker, Esc=close popover, ↑↓=navigate, Enter=expand.
21. **Smart title case:** smartTitleCase() in lib/mail-orders/utils.ts.
22. **Backfill endpoint:** `/api/mail-orders/backfill-customers` — temporary, delete after production verification.
23. **Universal header color rule:** ONE teal element (active slot). Everything else gray.
24. **Universal header props:** segments (count optional), leftExtra, rightExtra, showDatePicker, showDownload.
25. **Old header cleanup pending:** TM has display:none wrapper. Old header files exist but unused.
26. **Mail Order split system (v47):** Auto-split at ingest (>1500L or >20 lines, and >1 line). Category-first algorithm with weighted score balancing. Manual split API for post-resolve threshold crossing. View Original toggle.
27. **Mail Order volume (v49):** Stored as unit-aware packCode (e.g. "50ML" for stainers). Client-side calc. Displayed in customer subtext (not Lines column). Per-line in expanded view.
28. **Mail Order parser v4.1 (v49):** Bill marker `$Matches[1]` fix. BillNumber=0 skip. See §61.
29. **Mail Order ship-to override (v48):** Server-side deliveryRemarks match against delivery_point_master. lib/mail-orders/delivery-match.ts. See §60.
30. **Mail Order signal badges (v49):** Types: blocker/timing/bill/context/cross/shipto/split/warning/truck. No raw text. Hover for full. See §61.
31. **Mail Order bill sort (v49):** time → bill number → split label. No dispatch weight. getBillNumber() in utils.ts.
32. **Cross billing ≠ shipToOverride.** Cross billing = another depot, informational only. Ship-to = different delivery address, detected from deliveryRemarks.
33. **ML unit stainer volume (v49):** enrich.ts appends "ML" suffix to packCode when sku.unit="ML". Stainer 50ML → stored as "50ML" → 0.05L per unit. See §61.
34. All existing checklist items from v38 #36 still apply

---

*Version: Phase 1 Go-Live · Schema v25 · Context v49 · April 2026*
