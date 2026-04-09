# CLAUDE_CONTEXT.md -- Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v58.md fully before doing anything else."
# Version: Phase 1 Go-Live . Schema v26.3 . Context v58 . April 2026

---

## 1-64. [Unchanged from v52-v54]

(All sections 1 through 64 remain unchanged -- refer to v52 for base content, v53 context-update for session 53 changes, v54 context-update for session 54 changes)

---

## 65. Session v53 Changes (unchanged -- see context-update-v53.md)

## 66. Session v54 Changes (unchanged -- see context-update-v54.md)

---

## 67. Session v55 Changes (unchanged -- see CLAUDE_CONTEXT_v55.md)

## 68. Session v56 Changes (unchanged -- see CLAUDE_CONTEXT_v56.md)

## 69. Session v57 Changes (unchanged -- see CLAUDE_CONTEXT_v57.md)

---

## 70. Session v58 Changes (April 2026)

### Overview

Major session: full forensic data analysis of parser failures + enrichment
v3 + parser v6 rewrite. Three-phase implementation completed in one session.

### Schema Changes (v26.3)

**mo_sku_lookup — new column:**
- `piecesPerCarton` INTEGER (nullable) — carton pack size per SKU
- Populated: stainers 50/100/200=20, Gloss 100=24, Gloss 200=12,
  all 500=12, standard 1L=6, MAX+EAP 1L=9, all 4L=4. NULL for 10L+.

**mo_order_lines — new columns:**
- `isCarton` BOOLEAN DEFAULT FALSE — parser detected carton suffix
- `cartonCount` INTEGER (nullable) — original carton count before multiplication

### Enrichment v3 (enrich.ts) — Deployed

Three targeted changes to enrichment engine:

**1. Word-boundary keyword matching:**
- All `text.includes(pk.keyword)` replaced with `\b...\b` regex
- Pre-compiled regex maps via `buildKeywordRegexes()` for performance
- `enrichLine()` accepts optional `prodRegexMap` + `baseRegexMap` params
- No more length >= 3 threshold — "VT" (2 chars) now matches safely
- `escapeRegex()` helper added

**2. BW-fallback → partial when unrecognized base text:**
- After winner selection, if `top.isFallback`, checks for alphabetic
  text after product keyword that doesn't match any known base keyword
- If >= 3 chars unrecognized → returns partial with
  `skuDescription: "Unrecognized base: {TEXT}"`
- "Promise enamel phrliroza" → partial (was silently matched as BW)
- "Promise enamel white" → still matched (WHITE is recognized)

**3. Carton multiplication plumbing:**
- `SkuEntry` interface has `piecesPerCarton: number | null`
- Ingest route accepts optional `isCarton` per line (backward compat)
- When `isCarton && matched`: `finalQty = qty * sku.piecesPerCarton`
- Stores `isCarton` + `cartonCount` on mo_order_lines
- Re-enrich route has same logic

**Impact:** Re-enrich results: 2,323 → 2,420 matched (+97 lines).
15 remaining partials are real issues (parser-level or missing SKUs).

### Parser v6 (Parse-MailOrders-v6.ps1) — Created, Tested

Complete rewrite of line parsing pipeline. File lives OUTSIDE git repo
(same location as v5 on depot PC). v5 kept as backup.

**Architecture: Normalize → Comma Split → Extract per segment**

**Phase 1 — Normalize (runs on full line before comma split):**
- Carton suffix detection: cartoon/cartton/carton/cartn/ctn/box/bx/c
  → stripped, `isCarton = true` for entire line
- Piece suffix stripping: pcs/pic/nos/tin/Drums → stripped, no flag
- Divider normalization: `&` → `*`, `×` → `*`
- Unit-attached pack normalization: gm/ml/ltr/lt/kg → stripped
  ("100gm" → "100", "1ltr" → "1")
- Noise word stripping: "oil paint", "goes years"
- Equals separator: `=` → `-`
- "All" prefix stripped

**Phase 2 — Comma Split:**
- Split AFTER normalization (critical fix — v5 split before normalize)
- Each segment processed independently
- Carry-forward context: lastProduct, lastBase across segments

**Phase 3 — Extract (per segment, priority-ordered patterns):**
- P0: Empty/noise check
- P1: Bill marker
- P2: Material code
- P3: Explicit separator (NUM*NUM) — with product-boundary detection
- P4: Space-separated with text ("VT 90 1 36")
- P5: Number-only with base code ("94 1 6")
- P6: Number-only pair ("4 8")
- P6b: Multi-pair numbers ("1 6 4 2")
- P7: Product text + trailing number — base code detection prevents
  "Gloss 90" from being parsed as qty=90
- P8: Signal/remark detection (including area keywords)
- P9: Product name only (carry-forward)
- P10: Fallback unknown

**Key new functions:**
- `Normalize-Line` — Phase 1 normalization
- `Extract-ProductLines` — Phase 2+3 unified extraction
- `Extract-SinglePackQty` — helper for pack*qty segments
- `Resolve-ProductBase` — product/base text resolution with carry-forward
- `Test-KeywordWB` — word-boundary keyword matching

**API payload extended:**
- Each line now sends `isCarton` boolean
- `Send-ToApi` includes isCarton per line in JSON payload

**Test results (production emails):**
- Khatushyam: v5=40 lines, v6=64 lines (+24 recovered)
- Asian Colour Home: v5=21 lines, v6=28 lines (+7 recovered)
- All existing orders: no regressions, all DUPE responses clean

### Keyword DB Updates

**Product keywords added:**
- 800 SATIN, 800SATIN, SATIN FINISH 800, SATIN 800 → SUPER SATIN
- STANNER, UNIVERSAL STANNER → BLACK (stainer typo)
- GLOSSPHIROZA → GLOSS
- 1KPU, 1KPU CLEAR → INT CLR 1K PU GLOSS
- PROMISE 2IN 1 PRIMER, PROMISE 2IN 1, PROMISE 2IN PRIMER → PROMISE 2IN1
- PROMISE SHEEN INTERIOR94/92/90/93 → PROMISE SHEEN INTERIOR (concatenated base)

**Base keywords added:**
- 800 → 90 BASE (old market name)
- BRWHITE → BRILLIANT WHITE (no-space variant)

**Base keyword fixed:**
- Removed duplicate: 800 → BRILLIANT WHITE (was wrong, kept 800 → 90 BASE)

### Forensic Analysis Completed

Full database analysis of 50 ORDER NOTES, 42 unmatched/partial lines,
13 null-pack lines, 56 suspected-carton lines, 500 unique rawText patterns.

**14 confirmed bugs documented:**
1. cartoon suffix kills multi-pack lines (25 lines lost)
2. Space-separated with short keyword (7 lines lost)
3. `&` divider not recognized
4. `c` suffix on number-only continuation
5. `×` divider orphaned after comma split
6. `gm` unit not recognized
7. `ltr` unit missing from main pack regex
8. Number-only lines classified as unknown_long
9. "Gloss 90" base code parsed as qty
10. Short tinter codes (Ye, Blk) fail matching
11. BW-fallback silently matches wrong product
12. "Bill Tommorow" typo misses signal
13. Two products on one line
14. "MA - 2" tinter formatting

**9 new format patterns discovered:**
- Concatenated product+variant (800satin, GlossPhiroza, AQUATECTDAMP)
- Noise/marketing text in lines (oil paint, goes years)
- Truncated product names (2in vs 2in1)
- Unknown products (Panas=area name, Spray Paint, DIY Spray)
- Material code formats (6-digit partial, phone numbers)
- Form template headers (DEALER NAME:-, SITE NAME:-)

**Carton multiplier design decision:**
- Multiplication happens AFTER enrichment (not in parser)
- Because carton sizes vary by product (Gloss 100ML=24, Stainer 100ML=20)
- Parser just flags `isCarton=true` and sends raw count
- Enrichment looks up `piecesPerCarton` from matched SKU
- Unknown carton size → keeps raw qty for human review

### Files Modified

- lib/mail-orders/enrich.ts — enrichment v3 (word-boundary, BW-fallback, carton)
- app/api/mail-orders/ingest/route.ts — isCarton handling, regex maps
- app/api/mail-orders/re-enrich/route.ts — same updates
- app/api/mail-orders/backfill-enrich/route.ts — type fix
- app/api/mail-orders/debug-enrich/route.ts — created/updated
- lib/mail-orders/types.ts — isCarton, cartonCount on MoOrderLine
- prisma/schema.prisma — new columns synced

### Files Created (outside repo)

- Parse-MailOrders-v6.ps1 — new parser, on depot PC alongside v5

### Files NOT Modified

- All UI files (no UI changes this session)
- Parse-MailOrders-v5.ps1 (kept as backup)
- customer-match.ts, delivery-match.ts
- utils.ts

---

## 55. Session Start Checklist (UPDATED v58)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v26.3** (v26.2 + piecesPerCarton + isCarton + cartonCount)
3. **Universal header (v46):** `<UniversalHeader />` in `components/universal-header.tsx`. Used by ALL 8 boards. Do NOT create new header patterns. Title accepts ReactNode (v54).
4. **CLAUDE_UI.md v4.7:** Load alongside this file for ALL UI work
5. **Planning is ORDER level** (v28 correction still applies)
6. **Tint Manager uses OrderDetailPanel** not SkuDetailsSheet (v39)
7. **Delivery type dot colors:** blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross). Normalize with .toUpperCase().
8. **Slot segments:** 4 slots only -- Morning, Afternoon, Evening, Night. Filter out Next Day Morning (isNextDay).
9. **Shade Master:** No segments, no date picker. Search + filter only.
10. **TI Report:** Date presets as segments, DateRangePicker as leftExtra, Download button, no date stepper.
11. **page.tsx pattern:** All board pages are bare `<ComponentName />` -- no wrapper div, no title
12. **Mail Order frontend:** LIVE. 12-column table. Signal badges in Remarks column. Volume in customer subtext. Lines column = match count only. ORDER NOTES in expanded footer (4 columns).
13. **Mail Order enrichment v3 (v58):** Word-boundary keyword matching (pre-compiled regexes). BW-fallback with unrecognized base → partial. Pack-size disambiguation. Carton multiplication via piecesPerCarton on matched SKU. buildKeywordRegexes() exported. enrichLine accepts optional prodRegexMap + baseRegexMap.
14. **Mail Order PowerShell:** `Parse-MailOrders-v6.ps1` -- **v6.0.0**. Normalize → Comma Split → Extract architecture. Carton suffix detection (isCarton flag). Word-boundary keyword matching. Unit normalization (gm/ml/ltr). Divider normalization (&→*). Number-only continuation lines. Product-boundary detection. Area keyword classification. File lives OUTSIDE git repo on depot PC.
15. **Mail Order Lock flag:** Auto-locks on OD, CI, Bill Tomorrow (word-boundary regex). Manual lock persisted to DB (isLocked on mo_orders).
16. **billing_operator role:** id=13, pageKey=mail_orders. Users: Deepanshu (id 25), Bankim (id 26). Password: Billing@123.
17. **SAP import enrichment:** `applyMailOrderEnrichment()` auto-applies dispatch data from mo_orders to orders when soNumber matches.
18. **soNumber on orders:** Mapped from SAP XLS "SONum" column in both manual and auto-import. Indexed.
19. **Mail Order customer matching:** LIVE (v45). customer-match.ts. Three states: exact/multiple/unmatched. parseSubject() handles subject parsing (v52). extractCustomerFromSubject() kept for backward compat.
20. **Mail Order keyboard shortcuts (v53):** Q=code, W=SKUs, E=SO input, R=reply, F=flag, A=SO Summary, /=search, N=next unmatched, P=pick, T=toggle punched, S=SKU panel, L=order list, Esc=cascade.
21. **Smart title case:** smartTitleCase() in lib/mail-orders/utils.ts.
22. **Backfill endpoint:** `/api/mail-orders/backfill-enrich` -- DEPRECATED for re-enrichment. Use /api/mail-orders/re-enrich instead (v3, all 8+2 args).
23. **Universal header color rule:** ONE teal element (active slot). Everything else gray.
24. **Universal header props:** segments (count optional), leftExtra, rightExtra, showDatePicker, showDownload.
25. **Old header cleanup pending:** TM has display:none wrapper. Old header files exist but unused.
26. **Mail Order split system (v47):** Auto-split at ingest (>1500L or >20 lines, and >1 line). Category-first algorithm with weighted score balancing.
27. **Mail Order volume (v49):** Stored as unit-aware packCode (e.g. "50ML" for stainers). Client-side calc.
28. **Mail Order parser v6 (v58):** Normalize → Split → Extract. Carton detection. Word-boundary keywords. See §70.
29. **Mail Order ship-to override (v48):** Server-side deliveryRemarks match against delivery_point_master.
30. **Mail Order signal badges (v53):** 4-tier: blocker(red)/attention(amber)/info(gray)/split(purple). Hold removed from remarks.
31. **Mail Order bill sort (v49):** time -> bill number -> split label. No dispatch weight.
32. **Cross billing != shipToOverride.** Cross billing = another depot. Ship-to = different delivery address.
33. **ML unit stainer volume (v49):** enrich.ts appends "ML" suffix to packCode when sku.unit="ML".
34. All existing checklist items from v38 #36 still apply
35. **Enrichment v3 candidate sorting (v58):** candidates sorted by score DESC -> isPrimaryPack DESC -> non-fallback first -> non-empty base first -> longer keyword. Word-boundary regex matching. BW-fallback with unrecognized base → partial.
36. **BW/ADVANCE fallback (v55):** Part of candidate generation per strategy. COLOUR/NUMBERED strategies add BW/ADVANCE to basesToTry with -1 penalty. No separate fallback pass. v58: fallback with unrecognized base text → partial.
37. **Pack rounding + expansion (v55):** PACK_ROUND (fractional->standard), PACK_EXPAND (standard->fractional bidirectional). Both applied before candidate generation.
38. **Bare colour base matching:** Removed in v2 (replaced by product-aware base resolution).
39. **Keywords API (v51):** `GET /api/mail-orders/keywords` -- public, no auth. Returns productKeywords, baseKeywords, customerKeywords. v58: should also return areaKeywords (pending).
40. **mo_order_remarks table (v51):** Stores remark lines from parser. remarkType: billing/delivery/contact/instruction/cross/customer/area/unknown. detectedBy: pattern/keyword/unknown/subject.
41. **Remark engine (v58):** Parser v6 classifies via signal patterns + keyword DB. Area keywords from customer table (pending API extension).
42. **Order count sync SQL (v50):** After backfill, run sync query for matchedLines/totalLines.
43. **Keywords endpoint auth (v51):** /api/mail-orders/keywords excluded from middleware auth. Public read-only.
44. **Parser encoding (v51):** Parse-MailOrders-v6.ps1 must be saved as UTF-8 with BOM. Non-ASCII chars (except x) cause PowerShell 5.1 parse errors.
45. **Subject remark extraction (v52):** parseSubject() in customer-match.ts. Separates customer name, code, and remark signals from subject.
46. **ValidPacks (v58):** Hardcoded in parser v6: 1,2,3,4,5,10,15,20,22,25,30,40,50,100,200,250,400,500.
47. **Greedy keyword rule (v52):** Product keywords must NOT include base colour words. Base colours detected separately. Stainer products (GRN, BLK, WHT etc.) are legitimate product keywords.
48. **Mail Order column toggle (v53):** ALL_COLUMNS in mail-orders-table.tsx. localStorage "mo-column-visibility". Dispatch defaultVisible:false.
49. **Mail Order lock persistence (v53):** isLocked on mo_orders. PATCH /api/mail-orders/[id]/lock.
50. **Mail Order SO Summary (v53):** so-summary-panel.tsx. Right slide-out. A key opens.
51. **Mail Order slot completion (v53):** slot-completion-modal.tsx. Auto-popup when slot 100% punched. Auto/Manual toggle.
52. **Focus Mode (v54):** focus-mode-view.tsx. Table/Focus toggle in header title (gray-800, not teal). S key opens SKU panel. Card max-w-2xl, inline nav below, slide anim. activeLineId: null=closed, -1=list, >0=detail.
53. **SKU Line Status (v54):** mo_line_status table (UNIQUE on lineId, CASCADE delete). PATCH /api/mail-orders/lines/[lineId]/status. LineStatus interface + LINE_STATUS_REASONS in types.ts. saveLineStatus() in api.ts.
54. **Focus Mode keyboard (v54):** Q=code, W=SKUs, E=SO input, R=reply, F=flag, N=next unmatched, S=SKU panel, L=order list, arrows=navigate, Esc=cascade close. Panel: arrows navigate, -/+ toggle, 1-5 reason, Enter=detail/save.
55. **Header (v54):** UniversalHeader title accepts ReactNode. Toggle gray-800 dark. Stats show N% badge. Completed slots checkmark prefix. Shortcuts Q/W/E/R/F/S/N.
56. **Progress bar (v54):** Single smart bar for all queue sizes. Green fill (punched %) + teal dot (current position with clamp). No dot strip. No segment bar.
57. **Grace period fix (v54):** justDoneIdRef pins currentIndex when queue re-sorts after punch.
58. **Enrichment v3 (v58):** enrich.ts fully updated. buildKeywordRegexes() + pre-compiled regex maps passed from ingest/re-enrich routes. escapeRegex() helper. BW-fallback partial logic. piecesPerCarton on SkuEntry.
59. **Re-enrich endpoint (v58):** POST /api/mail-orders/re-enrich. Uses v3 with all args + regex maps + carton logic. Session auth + maxDuration=300.
60. **Debug-enrich endpoint (v58):** /api/mail-orders/debug-enrich (GET, session auth). ?text=...&pack=... Returns result + debug info.
61. **Carton multiplication (v58):** Parser detects suffix → sets isCarton=true → sends raw count. Ingest route multiplies qty × sku.piecesPerCarton after enrichment match. Stores isCarton + cartonCount on mo_order_lines. piecesPerCarton on mo_sku_lookup (product-specific).
62. **Carton sizes (v58):** Stainer 50/100/200ML=20. Gloss 100ML=24. Gloss 200ML=12. All 500ML=12. Standard 1L=6. MAX+EAP 1L=9. All 4L=4. 10L+=NULL. Pending Prakashbhai confirmation.
63. **Parser v6 architecture (v58):** Normalize-Line (Phase 1) → comma split (Phase 2) → Extract-ProductLines with P0-P10 priority patterns (Phase 3). Carry-forward via $script:CarryProduct/$script:CarryBase. Resolve-ProductBase handles variant codes and keyword matching. Test-KeywordWB for word-boundary matching.
64. **NUMBERED strategy override (v56):** Any product with bases matching /^9[0-8]/ gets NUMBERED, even if it also has named colour bases.
65. **BW vs empty base tie fix (v57):** Sort prefers non-empty base. Tie detection checks base-presence equality.

---

## Pending Items (carry forward to v59)

### From v53 (still pending):
1. OBD date parsing -- DD-MM-YYYY causes null obdEmailDate
2. CustomerMissingSheet styling not matching admin form
3. CustomerMissingSheet area/route dropdown 403 verify
4. paintType column on mo_sku_lookup
5. WhatsApp notification Option C
6. MIS override layer (mis_dispatch_overrides table)
7. Barcode/QR label printing
8. Sentry error monitoring (OneDrive EPERM issue)
9. Customer master coordinate enrichment

### From v54 (still pending):
10. buildReplyTemplate update in utils.ts
11. Slot completion in Focus Mode
12. Focus Mode search/filter integration
13. Next Slot button
14. SO input + action button on same row

### From v55 (still pending):
15. **Fuzzy matching (Level B):** Edit-distance fallback after exact match.
16. **Learning from corrections (Level C):** Resolve panel corrections feed back.
17. **Audit system:** Confidence scoring, batch stats, admin view, keyword management UI.
18. **Unicode x parser fix** (carried from v53)

### From v56 (still pending):
19. **CATEGORY_KEYWORDS cleanup:** Dead code in enrich.ts. Can remove.
20. **PU PRIME WHITE SEALER:** Keyword maps to nonexistent product.

### From v57 (still pending):
21. **Run enrichment-fix-v57.sql** -- product keywords, crackfiller 300G SKU, M900 base keywords.
22. **M900 SKU entries** -- need SAP material codes.
23. **M900 base detection** -- compound keywords workaround.
24. **BW → 90 BASE fallback** -- for products that have 90 BASE but no BW SKU.
25. **Stainer pack extraction from rawText** -- partially addressed by v6 gm normalization.
26. **BLK/BLK1 tinter vs stainer** -- pack-size disambiguation partially addressed by enrichment v3.
27. **DIY Spray products** -- not in SKU table, not priority.
28. **Truncated material codes** -- "320768" prefix matching.

### From v58 (new):
29. **Area keywords in keywords API** -- extend GET /api/mail-orders/keywords to return areaKeywords from mo_customer_keywords.area. Parser v6 already handles them.
30. **Switch depot PC to parser v6** -- update Task Scheduler from v5 to v6. Keep v5 as backup.
31. **Confirm carton sizes from Prakashbhai** -- email sent with table. Update piecesPerCarton if corrections.
32. **types.ts update** -- isCarton and cartonCount may not be in MoOrderLine interface yet (Claude Code linter removed them). Verify and re-add if needed.
33. **UI: Carton display** -- show carton icon/badge when isCarton=true. Show "3 CTN × 20 = 60" breakdown. Future session.
34. **Panas = area** -- confirmed. Area keyword classification pending API extension (#29).
35. **"800" = old market name for Super Satin 90 BASE** -- keywords added. If other old market names surface, add to keyword DB.
36. **Historical carton backfill** -- existing orders with carton suffix have wrong qty (raw carton count, not multiplied). Can be corrected via re-parse with v6 if original emails available.
37. **Enrichment v3 false positive monitoring** -- watch for BW-fallback → partial reclassifications that shouldn't be partial. Add keywords for common typos/variants as they surface.

---

*Version: Phase 1 Go-Live . Schema v26.3 . Context v58 . April 2026*
