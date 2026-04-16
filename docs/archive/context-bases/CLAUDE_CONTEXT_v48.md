# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v48.md fully before doing anything else."
# Version: Phase 1 Go-Live · Schema v25 · Context v48 · April 2026

---

## 1-41. [Unchanged from v38]

(All sections 1 through 41 remain unchanged — refer to v38 for full content)

---

## 42. Known Issues / Pending Fixes (UPDATED v48)

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
19. **Mail Order — Sara Paints bill split blocked** — Order #893 (v3 single order) blocks bill-split re-processing. Delete #893 from DB, then re-run parser to create 3 separate bill orders.
20. **Mail Order — Shree Khodiyar unmatched bills** — Order-i Shree Khodiyar-643685 Bill 3 & Bill 4 have 0/4 matched lines. Need to check rawText and add missing keywords.

---

## 43. Queued Features (UPDATED v48)

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

## 57. Mail Order Pipeline (UPDATED v45 — unchanged in v48)

(Refer to v45 for full Mail Order Pipeline documentation including customer matching)

---

## 58. Universal Header System (NEW v46 — unchanged in v48)

(Refer to v46 for full Universal Header documentation)

---

## 59. Mail Order SKU Line Enrichment — Volume, Batch Copy, Auto-Split, Sort (NEW v47 — unchanged in v48)

(Refer to v47 for full §59 documentation)

---

## 60. Mail Order Parser v4 + Enrichment Keywords + Ship-To Override + Signal Badges (NEW v48 — April 5, 2026)

### Overview

Major parser overhaul (v3 → v4), enrichment keyword expansion, server-side ship-to override detection from delivery remarks, and Remarks column redesign from raw text to signal badges.

### Parse-MailOrders-v4.ps1 — Parser Fixes

**File:** `Parse-MailOrders-v4.ps1` (replaces v3 on Deepanshu's machine)
**Location:** `C:\Users\HP\OneDrive\VS Code\mail-orders\`

**Fix A1 — Period-after-variant:** `"Water satin 92. 1*6"` → normalized to `"Water satin 92 - 1*6"` before parsing. Regex: `(\d{2,3})\.\s+(\d+[\*xx\/@\-]\d+)` → `$1 - $2`.

**Fix A2 — Multi-line product + colon-separated packs:** When product name (no digits) is on line 1 and colon-separated variant+packs on line 2, lines are combined. E.g. `"Vt pearl glo"` + `"Br white:20*2, 10*2, 4*4"` → `"Vt pearl glo Br white:20*2, 10*2, 4*4"`.

**Fix A3 — Double-colon variant:** `"MAX:92:20*2"` → normalized to `"MAX 92 - 20*2"`. Regex: `^([A-Za-z\s]+):(\d{2,3}):(\d+[\*xx\/@\-]\d+)`.

**Fix A4 — Bill splitting:** Emails with "Bill 1", "Bill 2" etc. markers are split into separate API calls. Each bill gets `emailEntryId = {original}__Bill{N}`. Bill marker regex: `^\s*Bill\s*[\.\-:]?\s*(\d+)\s*[\-:]?\s*$`. Product rows use `__BILL_MARKER__` sentinel. Main loop splits on markers and POSTs each bill separately.

**Fix A5 — Trailing remarks filter:** Skip patterns added for "SHARE DPL VALUE", "PUNCHED AFTER 7 DAYS", "KINDLY PROVIDE/SHARE", "CALL SO", "Sent from Outlook", "Get Outlook", "Bill in X order", "Delivery:", "Challan", URLs. ALL skipped lines accumulated into `$BodyRemarks` (semicolon-joined), not discarded.

**Fix C2 — Equal-sign / slash separators:** `"product = 20*5 / 10*10"` → normalized to `"product - 20*5, 10*10"`.

**Fix D1 — Subject signal extraction:** New `Extract-SubjectSignals` function parses subject for: customer code (6-7 digits), bill tomorrow, extension, cross billing (with code), OD/CI, CIC, bounce.

**Fix D2 — Build-BillRemarks:** New `Build-BillRemarks` function merges subject signals + body bill markers + billing-relevant body remarks into one semicolon-separated `billRemarks` field.

**Fix D3 — Delivery remarks expansion:** Regex expanded to catch both `"Delivery:"` and `"Challan in name of"` patterns. Challan attachment detection: if email has attachments AND mentions "challan" → `remarks += "Challan attachment"`.

**Key distinction — Hold vs Billing Block:**
- **Dispatch Hold** (dispatchStatus = "Hold"): call SO, call dealer, hold — order punched, don't dispatch yet
- **Billing Block** (billRemarks only): bounce, extension, OD/CI, bill tomorrow, 7 days, credit — order can't be punched, needs resolution. Does NOT change dispatchStatus.

**Cross billing:** Goes into billRemarks only. Does NOT set shipToOverride. Cross billing = order for another depot, not a delivery address change.

### Enrichment Keywords — SQL Additions

**124 product keywords** added to `mo_product_keywords`. Key mappings corrected against actual `mo_sku_lookup` product names:
- RED OXIDE → `ROM` (not "RED OXIDE METAL PRIMER")
- FARCO PRIMER → `DUWEL FARCO WHITE PRIMER`
- MULTIPURPOSE THINNER → `PU PRIME THINNER`
- SADOLIN 2KPU / SADOLIN PU MATT → `2KPU MATT`
- PU PRIME WHITE SEALER → `INT CLR 2K PU SEALER`
- LUXURIO → `LUXURIO PU MATT` / `LUXURIO PU GLOSS`
- AQUATECH FLEXIBLE ADVANCE → `FLEXIBLE COAT`
- AQUATECH ROOF → `ROOF COAT`
- GVA → individual stainer names (BLACK, YELLOW OXIDE, FAST VIOLET, etc.)

**18 base colour keywords** added to `mo_base_keywords`:
- BUSS GREEN, D.A GREY, GOLDEN BROWN, GOLDEN YELLOW, MINT GREEN, PO RED, SIGNAL RED, PHIROZA, SMAOKE GREY, SMOKE GREY, BACK→BLACK, VOILET→FAST VIOLET, ORGANIC VOILET, YELLOWOXIDE, MID YELLOW, BURNT SENA, OFF WHITE, LEAF BROWN

**DB counts after inserts:** 829 product keywords, 208 base keywords, 1051 SKU lookup entries.

**Keyword ordering:** Already implemented — both keyword arrays sorted by `keyword.length DESC` at lines 99 and 103 of ingest route. Longest keywords tried first.

### Ship-To Override Detection — Server-Side

**New file:** `lib/mail-orders/delivery-match.ts`

`matchDeliveryCustomer(deliveryRemarks, mainCustomerCode, prisma)`:
1. Strips prefixes ("delivery to", "challan in name of", etc.)
2. Skips junk words ("attachment", "urgent", etc.)
3. Searches `delivery_point_master` with case-insensitive contains, active only, limit 5
4. Returns match only on exactly 1 result (unambiguous)
5. Compares with main customer code — same customer = not override
6. Null main customer = conservative override flag

**Integration in ingest route (Step 4c):** After customer matching, calls `matchDeliveryCustomer()`. If override detected: sets `shipToOverride = true`, appends `[→ CustomerName (Code)]` to deliveryRemarks. Both Group A and Group B orders inherit resolved values.

### Remarks Column Redesign — Signal Badges

**Replaced:** Raw text dump of remarks + billRemarks with compact signal badges.

**Signal extraction:** `extractSignals(order)` in mail-orders-table.tsx parses combined remarks/billRemarks/deliveryRemarks via regex. Each signal gets a typed badge.

**Badge types and colours:**
| Type | Colour | Signals |
|------|--------|---------|
| blocker | Red (bg-red-50 text-red-700 border-red-200) | OD, CI, Bounce |
| timing | Amber (bg-amber-50 text-amber-700 border-amber-200) | Bill Tomorrow, 7 Days |
| bill | Gray (bg-gray-50 text-gray-600 border-gray-200) | Bill N |
| context | Gray (bg-gray-50 text-gray-500 border-gray-200) | DPL, 📎 Challan |
| cross | Purple (bg-purple-50 text-purple-600 border-purple-200) | Cross billing |
| shipto | Orange (bg-orange-50 text-orange-600 border-orange-200) | → Ship-to |

**Deduplication rules:**
- Extension badge hidden when Bill Tomorrow is present (same signal)
- Customer code stripped from remarks display (redundant with Code column)
- Full raw text on hover via title attribute

**Lock column (isOdCiFlagged):** Now checks remarks + subject + billRemarks using word-boundary regex patterns (`\bOD\b`, `\bCI\b`). "Bill tomorrow" added as lock trigger. Fixed false positives where "od" substring matched "Plywood", "Khodiyar", etc.

**Expanded view footer:** Body Remarks section removed. Now 3 columns only: Delivery Remarks | Bill Remarks | Received.

**Bill sort order:** `groupOrdersBySlot()` updated with `getBillNumber()` helper. Sort order: dispatch weight → receivedAt → bill number → split label.

**Ship-to override in Customer column:** Removed (was added then removed in same session). Ship-to now shown as `→ Ship-to` badge in Remarks column instead.

### Files Created/Modified in v48

**New files:**
- `lib/mail-orders/delivery-match.ts` — matchDeliveryCustomer() for ship-to override
- `Parse-MailOrders-v4.ps1` — full parser rewrite (replaces v3)

**Modified files:**
- `lib/mail-orders/utils.ts` — isOdCiFlagged() updated to word-boundary regex, "bill tomorrow" added to lock triggers, getBillNumber() helper, groupOrdersBySlot() bill sort
- `app/api/mail-orders/ingest/route.ts` — Step 4c delivery match integration
- `app/(mail-orders)/mail-orders/mail-orders-table.tsx` — signal badges, expanded footer cleanup, bill sort

**SQL only (no code files):**
- 124 INSERTs into mo_product_keywords
- 18 INSERTs into mo_base_keywords

### Test Results (v48 run — April 5, 2026)

- **200 orders created** from 146 emails (bill splitting creates multiple orders per email)
- **845/909 lines** across all orders
- **Overall match rate: 86%** (136/158 in the v4 run)
- **Bill splitting confirmed working:** Mohan Colour 13 bills, Shree Khodiyar 5 bills, etc.
- **Keyword improvements visible:** SBCP, WB SATIN, OIL SATIN, VT, WS products now matching

---

## 55. Session Start Checklist (UPDATED v48)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v25** (v24 + mo_orders: splitFromId, splitLabel; mo_order_lines: originalLineNumber)
3. **Universal header (v46):** `<UniversalHeader />` in `components/universal-header.tsx`. Used by ALL 8 boards. Do NOT create new header patterns.
4. **CLAUDE_UI.md v4.5:** Load alongside this file for ALL UI work
5. **Planning is ORDER level** (v28 correction still applies)
6. **Tint Manager uses OrderDetailPanel** not SkuDetailsSheet (v39)
7. **Delivery type dot colors:** blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross). Normalize with .toUpperCase().
8. **Slot segments:** 4 slots only — Morning, Afternoon, Evening, Night. Filter out Next Day Morning (isNextDay).
9. **Shade Master:** No segments, no date picker. Search + filter only.
10. **TI Report:** Date presets as segments, DateRangePicker as leftExtra, Download button, no date stepper.
11. **page.tsx pattern:** All board pages are bare `<ComponentName />` — no wrapper div, no title
12. **Mail Order frontend:** LIVE. 12-column table (widths unchanged from v47). Signal badges in Remarks column. Lock auto-triggers on OD/CI/Bill Tomorrow.
13. **Mail Order enrichment:** Try-and-verify engine. 829 product keywords, 208 base keywords, 1051 SKU lookup entries.
14. **Mail Order PowerShell:** `Parse-MailOrders-v4.ps1` — v4 deployed. Bill splitting, subject signal extraction, delivery/challan detection, remark filtering. Location: `C:\Users\HP\OneDrive\VS Code\mail-orders\`.
15. **Mail Order Lock flag:** Auto-locks on OD, CI, Bill Tomorrow (word-boundary regex). Manual lock still local state only — not persisted to DB yet.
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
28. **Mail Order parser v4 (v48):** Bill splitting, subject signals, delivery/challan, remark filtering, period/colon/equals normalization. See §60.
29. **Mail Order ship-to override (v48):** Server-side deliveryRemarks match against delivery_point_master. lib/mail-orders/delivery-match.ts. See §60.
30. **Mail Order signal badges (v48):** Remarks column shows typed badges (blocker/timing/bill/context/cross/shipto). No raw text. Hover for full text. See §60.
31. **Mail Order bill sort (v48):** Bills sort by number within same receivedAt. getBillNumber() in utils.ts.
32. **Cross billing ≠ shipToOverride.** Cross billing = another depot, informational only. Ship-to = different delivery address, detected from deliveryRemarks.
33. All existing checklist items from v38 #36 still apply

---

*Version: Phase 1 Go-Live · Schema v25 · Context v48 · April 2026*
