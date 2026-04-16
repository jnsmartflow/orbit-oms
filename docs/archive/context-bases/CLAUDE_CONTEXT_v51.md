# CLAUDE_CONTEXT.md -- Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v51.md fully before doing anything else."
# Version: Phase 1 Go-Live . Schema v26 . Context v51 . April 2026

---

## 1-41. [Unchanged from v38]

(All sections 1 through 41 remain unchanged -- refer to v38 for full content)

---

## 42. Known Issues / Pending Fixes (UPDATED v51)

1. **Warehouse header stats mismatch** -- header shows different count than unassigned panel in history view
2. **Cleanup Prisma field mapping** -- pick_assignments.clearedAt had @map("cleared_at") mismatch, fixed by removing @map. Verify cleanup runs correctly on next day boundary.
3. ~~**Slot cascade (NOT YET BUILT)**~~ -- **DONE v33.**
4. **Duplicate pick columns** -- orders and order_splits both have camelCase (isPicked, pickedAt, pickedById) AND snake_case (is_picked, picked_at, picked_by_id) columns. Use camelCase ones via Prisma.
5. ~~**Tint manager filter crash**~~ -- **FIXED v36.** All array assignments in tint-manager-content.tsx and tint-operator-content.tsx have ?? [] fallbacks.
6. **Slot cascade changedById** -- uses hardcoded userId=1 (admin) for system-generated audit logs.
7. ~~**Import not working**~~ -- **FIXED v34.**
8. **Slot cascade cascades pending_support orders** -- cascade moves ALL orders including those not yet submitted by Support. Consider adding workflowStage filter to cascade eligibility.
9. **Support board default slot on refresh** -- intermittent issue, deprioritised.
10. ~~**TM slot filter broken**~~ -- **FIXED v39.**
11. ~~**TM dispatch filter misleading**~~ -- **FIXED v39.**
12. **Shade Master isActive filter** -- UI sends `isActive=true/false` param but `/api/admin/shades` may not handle it yet. Verify and add if missing.
13. **Mail Order -- Lock persistence** -- Lock flag is currently local state only (lost on refresh). Add `isLocked` boolean field to `mo_orders` table + PATCH API endpoint to persist flag.
14. **Universal header -- old header code** -- TM has old header wrapped in `display:none` div. Should be fully removed in cleanup pass.
15. **Universal header -- production verification pending** -- Only TM, Tint Operator, and Mail Orders headers verified in production. Support, Planning, Warehouse, TI Report, Shade Master need verification after respective users log in.
16. **Mail Orders -- auto-refresh** -- Page doesn't auto-refresh when new orders arrive via PowerShell. Need setInterval (30-60s) on the fetch useEffect.
17. ~~**Mail Order -- sort/product-category fine-tuning**~~ -- **FIXED v49.**
18. **Mail Order -- paintType data enrichment pending** -- `mo_sku_lookup` needs a `paintType` column (oil/water/stainer) for warehouse-zone-aware splitting. ~130 products need classification.
19. ~~**Mail Order -- Sara Paints bill split blocked**~~ -- resolved via full data wipe and re-ingest.
20. **Mail Order -- Shree Khodiyar unmatched bills** -- aai Shree Khodiyar-549434 bills have some 0/x matched lines. Need to check rawText and add missing keywords.
21. ~~**Mail Order -- Parser Unicode x fix**~~ -- **FIXED v51.** x (U+00D7) added to all separator regexes in Parse-MailOrders-v5.ps1.
22. ~~**Mail Order -- FLEXIBLE COAT ADVANCE fallback**~~ -- **FIXED v51.** enrichLine() tries ADVANCE as fallback base after BW.
23. ~~**Mail Order -- Bare colour base matching**~~ -- **FIXED v51.** enrichLine() searches keyword text for base when remaining is empty.
24. **Mail Order -- Orphan variant lines** -- 60 lines with bare "92", "90" etc. Parser carry-forward breaks when bill markers or unmatched remark lines reset LastProductBaseName. Partially addressed by v5 remark engine (remarks no longer reset carry-forward), but orphans from historical data remain.
25. **Mail Order -- 1KPU product unknown** -- 11 lines. Need Deepanshu to confirm which Sadolin sub-product "1KPU" refers to.
26. **Mail Order -- Remaining unmatched** -- After v51 remark engine, junk lines no longer created as mo_order_lines. Remaining gap is real product partials only. Re-measure after cleanup.
27. **Mail Order -- Subject remark extraction** -- Subject line contains both customer name and remarks (Bill Tomorrow, OD, Extension, Cross billing) mixed together. extractCustomerFromSubject() partially handles this but not systematically integrated with the remark engine. See next session plan.
28. **Mail Order -- Space-separated pack/qty** -- Lines like "Promise int 90 4 8" (pack 4 qty 8, no * separator) are classified as unknown_long by the engine because no pack*qty pattern. These go through the "PAIR NUMBERS" parser path in v4 but the classification engine intercepts them first. Need to add space-separated digit pair detection to Classify-Line Step 1.

---

## 43. Queued Features (UPDATED v51)

- ~~**Slot cascade**~~ -- **DONE v33**
- ~~**Import debugging**~~ -- **DONE v34**
- ~~**OBD date parsing fix**~~ -- **DONE v34**
- ~~**Support history view**~~ -- **DONE v35**
- ~~**Order detail panel**~~ -- **DONE v35** (Support only -> now also TM v39)
- ~~**Role-based navigation + redirects**~~ -- **DONE v36**
- ~~**Operations role + unified ops view**~~ -- **DONE v36**
- ~~**TM filter fix + slot awareness**~~ -- **DONE v39**
- ~~**TM neutral palette redesign**~~ -- **DONE v39**
- ~~**TM order detail panel integration**~~ -- **DONE v39**
- ~~**Shade Master neutral redesign**~~ -- **DONE v40**
- ~~**TI Report neutral redesign**~~ -- **DONE v40**
- ~~**Mail Order email parsing + SKU enrichment (PowerShell)**~~ -- **DONE v41.**
- ~~**Mail Order backend (DB + APIs + enrichment engine)**~~ -- **DONE v42.**
- ~~**Mail Order frontend page**~~ -- **DONE v43.**
- ~~**Mail Order role**~~ -- **DONE v43.**
- ~~**soNumber import mapping**~~ -- **DONE v44.** SAP SONum -> orders.soNumber.
- ~~**Dispatch enrichment from FW: email**~~ -- **DONE v44.** PS v3 extracts dispatch data.
- ~~**Mail Order -- customer matching**~~ -- **DONE v45.** Customer code auto-matching from email subject.
- ~~**Universal header system**~~ -- **DONE v46.** Shared `<UniversalHeader />` component across all 8 boards.
- ~~**Mail Order -- SKU line enrichment (volume, batch copy, split, sort)**~~ -- **DONE v47.** See SS59 for full documentation.
- ~~**Mail Order -- Parser v4 fixes**~~ -- **DONE v48.** See SS60 for full documentation.
- ~~**Mail Order -- Enrichment keywords**~~ -- **DONE v48.** 124 product + 18 base keywords added.
- ~~**Mail Order -- Ship-to override detection**~~ -- **DONE v48.** See SS60.
- ~~**Mail Order -- Remarks signal badges**~~ -- **DONE v48.** See SS60.
- ~~**Mail Order -- Sort fix, customer extraction, ML volume, UI layout**~~ -- **DONE v49.** See SS61.
- ~~**Mail Order -- Enrichment engine hardening**~~ -- **DONE v50.** Match rate 85.4% -> 97.2%. See SS62.
- ~~**Mail Order -- Parser x fix**~~ -- **DONE v51.** Unicode multiplication sign added to all separator regexes.
- ~~**Mail Order -- Bare colour base matching**~~ -- **DONE v51.** enrichLine() keyword-as-base fallback.
- ~~**Mail Order -- FLEXIBLE COAT ADVANCE fallback**~~ -- **DONE v51.** FALLBACK_BASES array: BW then ADVANCE.
- ~~**Mail Order -- Line Classification Engine**~~ -- **DONE v51.** See SS63. Parser v5, remark extraction, signal patterns, keyword-based classification.
- **Mail Order -- Subject remark extraction engine** -- Subject line has mixed customer+remark data. Need systematic extraction integrated with remark engine.
- **Mail Order -- Space-separated pack/qty detection** -- "Promise int 90 4 8" not detected by Classify-Line. Need digit pair pattern in Step 1.
- **Mail Order -- Existing data cleanup** -- Migrate junk mo_order_lines to mo_order_remarks, sync counts.
- **Mail Order -- backfill-enrich endpoint** -- GET handler kept for ongoing use. Remove when enrichment work complete.
- **Cascade badge** -- When `originalSlotId !== slotId`, show badge on order rows.
- **Apply neutral theme to all screens** -- Support, Planning, Warehouse, Tint Operator.
- **Order detail panel** -- wire into Planning board and Warehouse board
- **Audit history in detail panel** -- order_status_logs exists, not yet fetched/rendered
- **CustomerMissingSheet styling** -- not matching admin customer form
- **Smart slot assignment** -- orders arriving at/after slot cutoff auto-escalate
- **MIS Override Layer** -- Admin-only field-level overrides per OBD
- **Barcode/QR label generation** -- post-TI submission
- **Mail Order -- Lock persistence** -- flag is currently local state only. Need DB persistence.
- **Mail Order -- auto-refresh** -- add setInterval polling for new orders
- **Mail Order -- paintType enrichment** -- classify ~130 products for warehouse-zone splitting.
- **Universal header cleanup** -- remove display:none old header code from TM.

---

## 52-54. [Unchanged from v39-v40]

(Tint Manager Redesign, Shade Master Redesign, TI Report Redesign -- refer to respective versions)

---

## 56. Email Monitor Pipeline -- RE: Emails (DEPRECATED v44)

**DEPRECATED.** Refer to v41 for historical reference only.

---

## 57. Mail Order Pipeline (UPDATED v45 -- unchanged in v51)

(Refer to v45 for full Mail Order Pipeline documentation including customer matching)

---

## 58. Universal Header System (NEW v46 -- unchanged in v51)

(Refer to v46 for full Universal Header documentation)

---

## 59. Mail Order SKU Line Enrichment (NEW v47 -- unchanged in v51)

(Refer to v47 for full SS59 documentation)

---

## 60. Mail Order Parser v4 + Enrichment Keywords + Ship-To Override + Signal Badges (NEW v48 -- unchanged in v51)

(Refer to v48 for full SS60 documentation)

---

## 61. Mail Order -- Sort Fix, Customer Extraction, Volume Fix, UI Layout (NEW v49 -- unchanged in v51)

(Refer to v49 for full SS61 documentation)

---

## 62. Mail Order Enrichment Hardening v50 (NEW v50 -- unchanged in v51)

(Refer to v50 for full SS62 documentation)

---

## 63. Line Classification Engine + Enrichment Fixes v51 (NEW -- April 2026)

### Enrichment Code Fixes

**1. Bare colour base matching (enrich.ts)**
In Step 4 else branch, when remaining text is empty and product name yields no bases, also search the keyword text (c.keyword) for bases. Fixes "Dark brown 200*1" where keyword DARK BROWN is itself the base colour.

**2. ADVANCE fallback (enrich.ts)**
Extended BW fallback to loop over FALLBACK_BASES array: ["BRILLIANT WHITE", "ADVANCE"]. Tries BW first, then ADVANCE. Fixes FLEXIBLE COAT products where ADVANCE is the default base.

**3. Match rate after enrichment fixes**
97.2% -> 97.3% (20 lines fixed by bare colour + ADVANCE fallback).

### Line Classification Engine (Parser v5)

Major parser rewrite from v4.2 to v5.0.0. Every email body line is now classified before product parsing.

**Classification flow (Classify-Line function):**
```
1. Has pack*qty pattern? (d+[*xx x/@-]d+) -> PRODUCT
2. Bill marker? (Bill N) -> BILL_MARKER
3. SAP material code? (IN?d{5,10}) -> PRODUCT
4a. Product/base keyword match? (from DB) -> PRODUCT_NAME (carry-forward)
4b. Customer keyword match? (from DB) -> REMARK type "customer"
5. Signal word match? (hardcoded patterns) -> REMARK (auto-typed)
6. No match + short (1-2 words) -> UNKNOWN_SHORT (carry-forward + flag)
7. No match + long (3+ words) -> UNKNOWN_LONG (remark only)
8. Blank or <=2 chars -> NOISE (discard)
```

**Signal word patterns (hardcoded, ~30 words):**

| Category | Signal Words |
|---|---|
| delivery | DELIVERY, CHALLAN, GODOWN, DISPATCH, TRANSPORT, LORRY, TRUCK, SITE DELIVERY |
| billing | DPL, CREDIT, EXTENSION, BOUNCE, BILL TOMORROW, PUNCH, 7 DAYS, OVERDUE |
| contact | CONTACT NO, CONTACT NUMBER, MOBILE, PHONE NO + regex d{10,} |
| instruction | PLEASE, KINDLY, STICKER, SHADE CARD, CALL SO, CALL DEALER, PROVIDE, SHARE DPL, ALSO PLACE, DEALER NAME |
| cross | CROSS BILLING, CROSS BILL, DO CROSS |
| noise | SENT FROM OUTLOOK, SENT FROM MY, GET OUTLOOK, REGARDS, THANK YOU, HTTPS://, HTTP:// |

**Key behavior changes from v4:**
- Old `$skipPatterns` array removed entirely -- replaced by engine
- Remarks no longer reset `$LastProductBaseName` -- fixes orphan variant carry-forward
- ALL remarks captured (not just first one) -- stored in `$RemarkRows` array
- Customer names in body detected via keyword DB -- classified as remark, not product
- Unknown short lines (1-2 words) still allow carry-forward but also flagged
- Unknown long lines (3+ words) classified as remark, no carry-forward

**Keyword fetch at startup:**
Parser calls `GET /api/mail-orders/keywords` once at startup. Returns flat unique uppercase arrays: productKeywords (~809), baseKeywords (~189), customerKeywords (~652). Cached in memory for session.

### Schema Change (v26)

**New table: `mo_order_remarks`**
```sql
CREATE TABLE mo_order_remarks (
  id SERIAL PRIMARY KEY,
  "moOrderId" INTEGER NOT NULL REFERENCES mo_orders(id) ON DELETE CASCADE,
  "lineNumber" INTEGER NOT NULL,
  "rawText" TEXT NOT NULL,
  "remarkType" TEXT NOT NULL DEFAULT 'unknown',
  "detectedBy" TEXT NOT NULL DEFAULT 'unknown',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_mo_order_remarks_order ON mo_order_remarks("moOrderId");
```

**Prisma model:** `mo_order_remarks` with relation `remarks_list` on `mo_orders`.

**remarkType values:** billing, delivery, contact, instruction, cross, customer, noise, unknown
**detectedBy values:** pattern (signal word), keyword (DB match), unknown (fallback)

### API Changes

**New endpoint: `GET /api/mail-orders/keywords`**
- Public (no auth) -- excluded from middleware auth check
- Returns `{ productKeywords, baseKeywords, customerKeywords }` as flat uppercase string arrays
- Called by parser at startup to cache classification keywords

**Updated: `POST /api/mail-orders/ingest`**
- Accepts optional `remarkLines` array in payload
- Each: `{ rawText, remarkType, detectedBy }`
- Stored in `mo_order_remarks` table
- remarkType "noise" skipped (not stored)
- Backward compatible -- missing remarkLines silently ignored

**Updated: `GET /api/mail-orders`**
- Response includes `remarks_list` array on each order via Prisma include
- Type: `MoOrderRemark[]` with id, rawText, remarkType, detectedBy

### UI Changes

**New type: `MoOrderRemark`** in lib/mail-orders/types.ts
```typescript
export interface MoOrderRemark {
  id: number;
  rawText: string;
  remarkType: string;
  detectedBy: string;
}
```

Added `remarks_list?: MoOrderRemark[]` to MoOrder interface.

**Expanded view footer: 4 columns (was 3)**
```
DELIVERY REMARKS | BILL REMARKS | ORDER NOTES | RECEIVED
```

ORDER NOTES column shows each remark with coloured type badge:
- billing: amber
- delivery: blue
- contact: gray
- instruction: gray
- cross: purple
- customer: teal
- unknown: amber (stands out for review)

Shows "-" when empty. Null-safe with `?? []` fallback.

### Parser File

`Parse-MailOrders-v5.ps1` -- version 5.0.0. Located in mail-orders folder (NOT in orbit-oms repo).

Changes from v4.2:
- New `Classify-Line` function
- New `Fetch-ClassificationKeywords` function
- `$SignalPatterns` hashtable for signal word patterns
- `Parse-EmailBody` accepts `$classificationKeywords` parameter
- `$RemarkRows` array collected alongside `$ProductRows`
- `Send-ToApi` includes `remarkLines` in payload
- Bill-split orders share same `RemarkRows` across all bills
- Console output shows remark count: "X lines, Y remarks"
- Startup shows keyword counts: "809 prodKW | 189 baseKW | 652 custKW"
- All separator regexes include x (U+00D7)
- UTF-8 BOM encoding required for PowerShell 5.1

### Files Modified in v51

**Code (orbit-oms repo):**
- `lib/mail-orders/enrich.ts` -- bare colour base match, ADVANCE fallback
- `lib/mail-orders/types.ts` -- MoOrderRemark interface, remarks_list on MoOrder
- `app/api/mail-orders/keywords/route.ts` -- NEW endpoint
- `app/api/mail-orders/ingest/route.ts` -- accept remarkLines
- `app/api/mail-orders/route.ts` -- include remarks_list in GET response
- `app/api/mail-orders/backfill-enrich/route.ts` -- GET handler kept
- `prisma/schema.prisma` -- mo_order_remarks model + relation
- `middleware.ts` -- exclude /api/mail-orders/keywords from auth
- Mail orders table component -- 4-column footer, remarks_list null safety

**SQL (Supabase):**
- CREATE TABLE mo_order_remarks
- CREATE INDEX idx_mo_order_remarks_order

**Parser (local, not in repo):**
- `Parse-MailOrders-v5.ps1` -- complete rewrite with classification engine

### Test Results (April 5 re-ingest)

Parser v5 successfully re-processed a full day of orders:
- Keywords loaded: 809 product, 189 base, 652 customer
- Most orders: 100% match rate (matched/matched)
- Remarks detected: "Call SO for Delivery", "Share DPL value", "Bill in bounce order", delivery instructions, contact numbers
- Remark counts shown in console: "X lines, Y remarks"
- Previously-SKIPped orders (Shree Radhe Paints, Shree Gautam HW, Hari om Hardware) now process successfully with product lines

---

## 55. Session Start Checklist (UPDATED v51)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v26** (v25 + mo_order_remarks table)
3. **Universal header (v46):** `<UniversalHeader />` in `components/universal-header.tsx`. Used by ALL 8 boards. Do NOT create new header patterns.
4. **CLAUDE_UI.md v4.6:** Load alongside this file for ALL UI work
5. **Planning is ORDER level** (v28 correction still applies)
6. **Tint Manager uses OrderDetailPanel** not SkuDetailsSheet (v39)
7. **Delivery type dot colors:** blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross). Normalize with .toUpperCase().
8. **Slot segments:** 4 slots only -- Morning, Afternoon, Evening, Night. Filter out Next Day Morning (isNextDay).
9. **Shade Master:** No segments, no date picker. Search + filter only.
10. **TI Report:** Date presets as segments, DateRangePicker as leftExtra, Download button, no date stepper.
11. **page.tsx pattern:** All board pages are bare `<ComponentName />` -- no wrapper div, no title
12. **Mail Order frontend:** LIVE. 12-column table. Signal badges in Remarks column. Volume in customer subtext. Lines column = match count only. ORDER NOTES in expanded footer (4 columns).
13. **Mail Order enrichment:** Try-and-verify engine. ~809 product keywords, ~189 base keywords, ~1080 SKU lookup entries. Candidate sort by keyword length. BW + ADVANCE fallback. Pack 1->2 fallback. Bare colour base matching.
14. **Mail Order PowerShell:** `Parse-MailOrders-v5.ps1` -- **v5.0.0**. Line Classification Engine. Fetches keywords from API at startup. Classifies every line as product/remark/noise. Remarks stored in mo_order_remarks.
15. **Mail Order Lock flag:** Auto-locks on OD, CI, Bill Tomorrow (word-boundary regex). Manual lock still local state only -- not persisted to DB yet.
16. **billing_operator role:** id=13, pageKey=mail_orders. Users: Deepanshu (id 25), Bankim (id 26). Password: Billing@123.
17. **SAP import enrichment:** `applyMailOrderEnrichment()` auto-applies dispatch data from mo_orders to orders when soNumber matches.
18. **soNumber on orders:** Mapped from SAP XLS "SONum" column in both manual and auto-import. Indexed.
19. **Mail Order customer matching:** LIVE (v45). customer-match.ts. Three states: exact/multiple/unmatched. extractCustomerFromSubject() handles: Urgent strip, space-dash, trailing code, Order-LETTERS prefix.
20. **Mail Order keyboard shortcuts:** C=copy code, S=copy SKU (batch-aware), P=open picker, Esc=close popover, up/down=navigate, Enter=expand.
21. **Smart title case:** smartTitleCase() in lib/mail-orders/utils.ts.
22. **Backfill endpoint:** `/api/mail-orders/backfill-enrich` -- GET handler kept for ongoing use. POST is HMAC protected.
23. **Universal header color rule:** ONE teal element (active slot). Everything else gray.
24. **Universal header props:** segments (count optional), leftExtra, rightExtra, showDatePicker, showDownload.
25. **Old header cleanup pending:** TM has display:none wrapper. Old header files exist but unused.
26. **Mail Order split system (v47):** Auto-split at ingest (>1500L or >20 lines, and >1 line). Category-first algorithm with weighted score balancing.
27. **Mail Order volume (v49):** Stored as unit-aware packCode (e.g. "50ML" for stainers). Client-side calc.
28. **Mail Order parser v5 (v51):** Line Classification Engine. Classify-Line function with 8 steps. Signal patterns + keyword DB. See SS63.
29. **Mail Order ship-to override (v48):** Server-side deliveryRemarks match against delivery_point_master.
30. **Mail Order signal badges (v49):** Types: blocker/timing/bill/context/cross/shipto/split/warning/truck.
31. **Mail Order bill sort (v49):** time -> bill number -> split label. No dispatch weight.
32. **Cross billing != shipToOverride.** Cross billing = another depot. Ship-to = different delivery address.
33. **ML unit stainer volume (v49):** enrich.ts appends "ML" suffix to packCode when sku.unit="ML".
34. All existing checklist items from v38 #36 still apply
35. **Enrichment candidate sorting (v50):** candidates sorted by keyword length DESC.
36. **Brilliant White + ADVANCE fallback (v51):** FALLBACK_BASES = ["BRILLIANT WHITE", "ADVANCE"]. Tries both after empty base fails.
37. **Pack 1->2 fallback (v50):** When pack=1 lookup fails, tries pack=2.
38. **Bare colour base matching (v51):** When remaining empty and product has no base, search keyword text for base.
39. **Keywords API (v51):** `GET /api/mail-orders/keywords` -- public, no auth. Returns productKeywords, baseKeywords, customerKeywords.
40. **mo_order_remarks table (v51):** Stores remark lines from parser. remarkType: billing/delivery/contact/instruction/cross/customer/unknown. detectedBy: pattern/keyword/unknown.
41. **Remark engine (v51):** Parser v5 classifies every line. Remarks don't reset carry-forward. All remarks captured (not just first). Customer keywords checked in Step 4b. See SS63.
42. **Order count sync SQL (v50):** After backfill, run sync query for matchedLines/totalLines.
43. **Keywords endpoint auth (v51):** /api/mail-orders/keywords excluded from middleware auth. Public read-only.
44. **Parser encoding (v51):** Parse-MailOrders-v5.ps1 must be saved as UTF-8 with BOM. Non-ASCII chars (except x) cause PowerShell 5.1 parse errors. All comments use plain ASCII dashes, not em dashes or box-drawing chars.

---

*Version: Phase 1 Go-Live . Schema v26 . Context v51 . April 2026*
