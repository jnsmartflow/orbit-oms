# CLAUDE_CONTEXT.md -- Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v52.md fully before doing anything else."
# Version: Phase 1 Go-Live . Schema v26 . Context v52 . April 2026

---

## 1-41. [Unchanged from v38]

(All sections 1 through 41 remain unchanged -- refer to v38 for full content)

---

## 42. Known Issues / Pending Fixes (UPDATED v52)

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
18. ~~**Mail Order -- paintType data enrichment pending**~~ -- partially addressed by keyword cleanup v52. ~130 products still need paintType column classification.
19. ~~**Mail Order -- Sara Paints bill split blocked**~~ -- resolved via full data wipe and re-ingest.
20. **Mail Order -- Shree Khodiyar unmatched bills** -- aai Shree Khodiyar-549434 bills have some 0/x matched lines. Need to check rawText and add missing keywords.
21. ~~**Mail Order -- Parser Unicode x fix**~~ -- **FIXED v51.** x (U+00D7) added to all separator regexes in Parse-MailOrders-v5.ps1.
22. ~~**Mail Order -- FLEXIBLE COAT ADVANCE fallback**~~ -- **FIXED v51.** enrichLine() tries ADVANCE as fallback base after BW.
23. ~~**Mail Order -- Bare colour base matching**~~ -- **FIXED v51.** enrichLine() searches keyword text for base when remaining is empty.
24. **Mail Order -- Orphan variant lines** -- 60 lines with bare "92", "90" etc. Parser carry-forward breaks when bill markers or unmatched remark lines reset LastProductBaseName. Partially addressed by v5 remark engine (remarks no longer reset carry-forward), but orphans from historical data remain.
25. **Mail Order -- 1KPU product unknown** -- 11 lines. Need Deepanshu to confirm which Sadolin sub-product "1KPU" refers to.
26. **Mail Order -- Remaining unmatched** -- After v52 keyword cleanup, 247 unmatched out of 12,833 lines (98.1%). Remaining are orphan variants, junk lines, and a few missing keywords.
27. **Mail Order -- Subject remark extraction** -- ~~Subject line contains both customer name and remarks mixed together.~~ **DONE v52.** parseSubject() separates customer name, code, and remarks. detectedBy="subject" in mo_order_remarks.
28. **Mail Order -- Space-separated pack/qty** -- ~~Lines like "Promise int 90 4 8" classified as unknown_long.~~ **FIXED v52.** Parser v5.1.0 Step 1b + SPACE-SEPARATED parser path with ValidPacks set.
29. ~~**Mail Order -- BW fallback false matches**~~ -- **FIXED v52.** Fallback moved outside candidate loop. Only fires when remaining text is empty. Greedy product keywords cleaned up.

---

## 43. Queued Features (UPDATED v52)

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
- ~~**Mail Order -- Subject remark extraction engine**~~ -- **DONE v52.** parseSubject() in customer-match.ts. See SS64.
- ~~**Mail Order -- Space-separated pack/qty detection**~~ -- **DONE v52.** Parser v5.1.0 Step 1b + ValidPacks. See SS64.
- ~~**Mail Order -- BW fallback fix**~~ -- **DONE v52.** Fallback moved outside candidate loop. See SS64.
- ~~**Mail Order -- Greedy keyword cleanup**~~ -- **DONE v52.** Removed product keywords that ate base colours. Re-added stainer keywords with correct mappings. See SS64.
- **Mail Order -- Frontend redesign** -- Full UI overhaul for Deepanshu's workflow. See next session plan.
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

## 57. Mail Order Pipeline (UPDATED v45 -- unchanged in v52)

(Refer to v45 for full Mail Order Pipeline documentation including customer matching)

---

## 58. Universal Header System (NEW v46 -- unchanged in v52)

(Refer to v46 for full Universal Header documentation)

---

## 59. Mail Order SKU Line Enrichment (NEW v47 -- unchanged in v52)

(Refer to v47 for full SS59 documentation)

---

## 60. Mail Order Parser v4 + Enrichment Keywords + Ship-To Override + Signal Badges (NEW v48 -- unchanged in v52)

(Refer to v48 for full SS60 documentation)

---

## 61. Mail Order -- Sort Fix, Customer Extraction, Volume Fix, UI Layout (NEW v49 -- unchanged in v52)

(Refer to v49 for full SS61 documentation)

---

## 62. Mail Order Enrichment Hardening v50 (NEW v50 -- unchanged in v52)

(Refer to v50 for full SS62 documentation)

---

## 63. Line Classification Engine + Enrichment Fixes v51 (unchanged in v52)

(Refer to v51 for full SS63 documentation)

---

## 64. Session v52 Changes (NEW -- April 2026)

### Parser v5.1.0 -- Space-Separated Pack/Qty

**Problem:** Lines like "Promise int 90 4 8" (pack=4 qty=8 with space separator) classified as unknown_long because Classify-Line Step 1 only checks for */x/@/- separators.

**Fix (two parts):**

1. **ValidPacks array** -- hardcoded set of valid container sizes: 1,2,3,4,5,10,15,20,22,25,30,40,50,100,200,250,400,500. Defined above Classify-Line function.

2. **Step 1b in Classify-Line** -- after Step 1 fails (no separator), checks if line has letters AND ends with two space-separated numbers where the first is a valid pack code. If yes, classifies as "product".

3. **SPACE-SEPARATED parser path** -- new elseif block in the product parsing section, placed before TRAILING NUMBER. Extracts product name + pack + qty from space-separated trailing numbers. Includes standard carry-forward logic. Falls back to trailing-number behavior if pack is not in ValidPacks.

**Parser file:** Parse-MailOrders-v5.ps1 version 5.1.0.

### Subject Remark Extraction Engine

**Problem:** Email subject contains customer name + code + remarks mixed together. "FW: Order : Shivam Paints. Bill Tomorrow OD" -- customer matching received "Shivam Paints. Bill Tomorrow OD" and failed or matched wrong.

**Fix:** New `parseSubject()` function in customer-match.ts.

**Flow:**
1. Strip FW/RE/Fwd prefixes
2. Strip "Urgent" (noise)
3. Strip "Order" prefix, extract customer code if present
4. Extract trailing/leading/parenthesized/dash codes
5. Scan for remark signals using SUBJECT_SIGNALS patterns (cross, timing, blocker, instruction, context)
6. Strip matched signals from string
7. Clean remaining text = customer name
8. Return { customerCode, customerName, remarks[] }

**Signal patterns (case-sensitive for OD/CI/CIC):**
- Cross: cross billing, cross bill, do cross
- Timing: bill tomorrow, 7 days, extension
- Blocker: bounce, overdue, CIC, CI, OD
- Instruction: save and share dpl, share dpl, share value, call so, call dealer
- Context: truck order, truck, challan

**Integration:** ingest/route.ts uses parseSubject() instead of extractCustomerFromSubject() for customer matching. Subject remarks stored in mo_order_remarks with detectedBy="subject" and lineNumber starting at 901. Stored for both original and split orders.

**extractCustomerFromSubject() kept** for backward compatibility (backfill and other callers).

### BW/ADVANCE Fallback Fix

**Problem:** FALLBACK_BASES block inside the candidate loop returned wrong "matched" results. When a colour keyword (e.g. "GOLDEN BROWN") matched as a product keyword with a longer length, it was tried first. Its remaining text had no base colour, so BW fallback fired and returned GLOSS BRILLIANT WHITE instead of GLOSS GOLDEN BROWN.

**Root cause:** "GOLDEN BROWN" registered as both a product keyword (product="GLOSS") and a base keyword (baseColour="GOLDEN BROWN"). Candidate sorting by keyword length DESC meant "GOLDEN BROWN" (12 chars) was tried before "GLOSS" (5 chars). The BW fallback inside the loop returned early before the correct "GLOSS" candidate could be tried.

**Fix (two parts):**

1. **Move fallback outside candidate loop.** Step 4e (main loop) tries ALL candidates with real detected bases only. If any candidate matches correctly, it returns immediately. Step 4f (fallback loop) runs ONLY after all candidates fail.

2. **Fallback only when remaining is empty.** Step 4f skips candidates where c.remaining is non-empty (user typed a colour we can't find -- don't substitute BW, fall to partial).

### Greedy Keyword Cleanup

**Problem:** Product keywords that included base colour words consumed the colour during keyword matching, leaving nothing for base detection.

Examples:
- "PROMISE ENAMAL CLASSIC" (product keyword) ate "CLASSIC" from "CLASSIC WHITE"
- "GOLDEN BROWN" (GLOSS product keyword) ate the entire base colour name

**Fix:**
- Deleted greedy product keywords: PROMISE ENAMAL CLASSIC, PROMISE ENAMAL PHIROZA, PROMISE ENAMAL SMOKE GREY, PROMISE ENAMEL CLASSIC WHITE, PROMISE ENAMEL SMAOKE GREY, PROMISE SHEEN WHITE
- Deleted base-colour-as-GLOSS-product keywords: GOLDEN BROWN, DA GREY, SMOKE GREY, GOL BROWN, DARK BROWN, DEEP ORANGE, PO RED, PHIROZA, PHIROZA BLUE, GOLDEN YELLOW
- Re-added stainer product keywords with correct product mappings (GRN->GRN, BLK->BLACK, WHT->WHT, VOILET->FAST VIOLET, etc.)
- Added new keywords: FY GREEN, GRN1, BLK1, BRWHITE

**Match rate after cleanup:** 12,586 matched / 12,833 total = 98.1%. 247 unmatched (orphan variants, junk lines, missing keywords).

### Files Modified in v52

**Code (orbit-oms repo):**
- `lib/mail-orders/customer-match.ts` -- parseSubject() function, SUBJECT_SIGNALS patterns
- `lib/mail-orders/enrich.ts` -- Step 4f moved outside candidate loop, remaining guard
- `app/api/mail-orders/ingest/route.ts` -- uses parseSubject(), stores subject remarks

**Parser (local, not in repo):**
- `Parse-MailOrders-v5.ps1` -- v5.1.0. ValidPacks array, Step 1b, SPACE-SEPARATED parser path

**Data (Supabase):**
- mo_product_keywords -- deleted greedy keywords, re-added stainer keywords
- mo_order_lines -- full reset + backfill with fixed enrichment logic

---

## 55. Session Start Checklist (UPDATED v52)

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
13. **Mail Order enrichment:** Try-and-verify engine. ~809 product keywords, ~189 base keywords, ~1080 SKU lookup entries. Candidate sort by keyword length. BW + ADVANCE fallback OUTSIDE candidate loop, only when remaining empty. Pack 1->2 fallback. Bare colour base matching.
14. **Mail Order PowerShell:** `Parse-MailOrders-v5.ps1` -- **v5.1.0**. Line Classification Engine. Fetches keywords from API at startup. Classifies every line as product/remark/noise. Remarks stored in mo_order_remarks. Space-separated pack/qty via ValidPacks.
15. **Mail Order Lock flag:** Auto-locks on OD, CI, Bill Tomorrow (word-boundary regex). Manual lock still local state only -- not persisted to DB yet.
16. **billing_operator role:** id=13, pageKey=mail_orders. Users: Deepanshu (id 25), Bankim (id 26). Password: Billing@123.
17. **SAP import enrichment:** `applyMailOrderEnrichment()` auto-applies dispatch data from mo_orders to orders when soNumber matches.
18. **soNumber on orders:** Mapped from SAP XLS "SONum" column in both manual and auto-import. Indexed.
19. **Mail Order customer matching:** LIVE (v45). customer-match.ts. Three states: exact/multiple/unmatched. parseSubject() now handles subject parsing (v52). extractCustomerFromSubject() kept for backward compat.
20. **Mail Order keyboard shortcuts:** C=copy code, S=copy SKU (batch-aware), P=open picker, Esc=close popover, up/down=navigate, Enter=expand.
21. **Smart title case:** smartTitleCase() in lib/mail-orders/utils.ts.
22. **Backfill endpoint:** `/api/mail-orders/backfill-enrich` -- GET handler kept for ongoing use. POST is HMAC protected. Only upgrades match status (newRank > oldRank). To force re-enrich, reset lines to unmatched first via SQL.
23. **Universal header color rule:** ONE teal element (active slot). Everything else gray.
24. **Universal header props:** segments (count optional), leftExtra, rightExtra, showDatePicker, showDownload.
25. **Old header cleanup pending:** TM has display:none wrapper. Old header files exist but unused.
26. **Mail Order split system (v47):** Auto-split at ingest (>1500L or >20 lines, and >1 line). Category-first algorithm with weighted score balancing.
27. **Mail Order volume (v49):** Stored as unit-aware packCode (e.g. "50ML" for stainers). Client-side calc.
28. **Mail Order parser v5.1 (v52):** Line Classification Engine + ValidPacks space-separated detection. See SS64.
29. **Mail Order ship-to override (v48):** Server-side deliveryRemarks match against delivery_point_master.
30. **Mail Order signal badges (v49):** Types: blocker/timing/bill/context/cross/shipto/split/warning/truck.
31. **Mail Order bill sort (v49):** time -> bill number -> split label. No dispatch weight.
32. **Cross billing != shipToOverride.** Cross billing = another depot. Ship-to = different delivery address.
33. **ML unit stainer volume (v49):** enrich.ts appends "ML" suffix to packCode when sku.unit="ML".
34. All existing checklist items from v38 #36 still apply
35. **Enrichment candidate sorting (v50):** candidates sorted by keyword length DESC.
36. **BW/ADVANCE fallback (v52):** OUTSIDE candidate loop. Only fires when c.remaining is empty. Prevents wrong SKU when colour keyword overlaps product keyword.
37. **Pack 1->2 fallback (v50):** When pack=1 lookup fails, tries pack=2.
38. **Bare colour base matching (v51):** When remaining empty and product has no base, search keyword text for base.
39. **Keywords API (v51):** `GET /api/mail-orders/keywords` -- public, no auth. Returns productKeywords, baseKeywords, customerKeywords.
40. **mo_order_remarks table (v51):** Stores remark lines from parser. remarkType: billing/delivery/contact/instruction/cross/customer/unknown. detectedBy: pattern/keyword/unknown/subject.
41. **Remark engine (v51):** Parser v5 classifies every line. Remarks don't reset carry-forward. All remarks captured (not just first). Customer keywords checked in Step 4b. See SS63.
42. **Order count sync SQL (v50):** After backfill, run sync query for matchedLines/totalLines.
43. **Keywords endpoint auth (v51):** /api/mail-orders/keywords excluded from middleware auth. Public read-only.
44. **Parser encoding (v51):** Parse-MailOrders-v5.ps1 must be saved as UTF-8 with BOM. Non-ASCII chars (except x) cause PowerShell 5.1 parse errors. All comments use plain ASCII dashes, not em dashes or box-drawing chars.
45. **Subject remark extraction (v52):** parseSubject() in customer-match.ts. Separates customer name, code, and remark signals from subject. Case-sensitive OD/CI/CIC. detectedBy="subject" in mo_order_remarks. lineNumber 901+.
46. **ValidPacks (v52):** Hardcoded pack code set in parser. Used by Classify-Line Step 1b and SPACE-SEPARATED parser path. Values: 1,2,3,4,5,10,15,20,22,25,30,40,50,100,200,250,400,500.
47. **Greedy keyword rule (v52):** Product keywords must NOT include base colour words. Base colours detected separately by findAllBases(). Stainer products (GRN, BLK, WHT etc.) are legitimate product keywords mapping to their own products, not to GLOSS.

---

*Version: Phase 1 Go-Live . Schema v26 . Context v52 . April 2026*
