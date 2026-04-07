# CLAUDE_CONTEXT.md -- Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v55.md fully before doing anything else."
# Version: Phase 1 Go-Live . Schema v26.2 . Context v55 . April 2026

---

## 1-64. [Unchanged from v52-v54]

(All sections 1 through 64 remain unchanged -- refer to v52 for base content, v53 context-update for session 53 changes, v54 context-update for session 54 changes)

---

## 65. Session v53 Changes (unchanged -- see context-update-v53.md)

## 66. Session v54 Changes (unchanged -- see context-update-v54.md)

---

## 67. Session v55 Changes (NEW -- April 2026)

### Enrichment Engine v2 -- Full Rebuild

Complete rewrite of `lib/mail-orders/enrich.ts`. Old engine
used sequential strip-and-search (pick keyword -> strip from
text -> search base in remaining -> first hit wins). New engine
uses generate -> verify -> rank (search full text -> generate
all candidates -> score -> highest wins).

Tested on 2,364 real order lines (Apr 6-7, 2026):
- 99% accuracy, 0 regressions
- 103 wrong matches fixed
- 28 previously unmatched lines now resolved
- Re-enrichment of last 2 days: 328 lines updated, 158 orders

### Data Fixes Applied (Phase 1 + Phase 1B)

**Phase 1 -- SQL executed in Supabase SQL Editor:**
- Fixed 8 PU Prime pack sizes (2->1 per stock file)
- Added 12 missing PU Prime SKUs (Clear Gloss, White/Clear
  Sealer 1L/4L/20L, 90/93 Base 20L variants)
- Deleted 2 wrong keyword mappings
- Added 16 new product keywords (PU Prime variants, Promise
  2in1, Promise Enamel Classic White variants)
- Deleted dangerous base keyword WHITE SEALER->BW

**Phase 1B -- 345 SKU backfill:**
- Added 345 orderable paint SKUs missing from mo_sku_lookup
- Derived from Stock_File.csv cross-reference
- Covers: Promise, WS Protect, WS Max, WS Powerflexx,
  SuperClean, 5in1, 3in1, Gloss, Diamond Glo, Eterna,
  Floor Plus, Lustre, Auto Star, Duco PU, and more
- Used ON CONFLICT (material) DO NOTHING

### New enrichLine() Algorithm -- 6 Phases

**Phase 1 -- Material code check** (unchanged)
Direct IN12345 or 5826215 lookup against byMaterial map.

**Phase 2 -- Product keyword search**
Find ALL matching product keywords in FULL text (no stripping).
Keywords pre-sorted by length DESC. Deduped by product|keyword.

**Phase 3 -- Base keyword search** (parallel with Phase 2)
Find ALL matching base keywords in FULL text simultaneously.
Also detect numbered bases via regex `\b(9[0-8])\b`.

**Phase 4 -- Product-aware base resolution**
For each matched product, look up its base profile from SKU
table. Classify into one of 4 strategies:

  DIRECT (82 products): No base. Primer, thinner, clear, putty.
    -> Only try empty base. Ignore any colour words in text.
    -> Score bonus: +3

  FIXED (16 products): Single predetermined base.
    -> Use that base directly. No search needed.
    -> Score bonus: +2 (unless colour-as-product)

  NUMBERED (26 products): 90/92/93/94/95/96/97/98 + BW.
    -> Use detected base keywords first (authoritative),
      then regex-detected number, then BW fallback.
    -> Score bonus: +1 for detected, -1 for fallback

  COLOUR (14 products): Named colour bases.
    -> Use detected base keywords from full text.
      Fallback to BW/ADVANCE if no colour detected.
    -> Score bonus: 0 for detected, -1 for fallback

**Phase 5 -- Candidate generation + SKU verification**
For each (product x base x pack) combination, check against
skuByCombo map. Only verified combos become candidates.
Also tracks alternate SKU (skuByComboAlt) for same combo.

**Phase 6 -- Scoring + winner selection**
Score = product keyword length + base keyword length + bonuses

  Strategy confidence bonus:
    DIRECT +3, FIXED +2, NUMBERED match +1, fallback -1

  Category keyword penalty: -2
    For generic words: STAINER, TINTER, MACHINE, FAST, etc.

  Colour-as-product no-double-count:
    When product name IS the base colour (BLACK stainer,
    FAST RED stainer), don't add base keyword score to
    product score. Prevents Stainer BLACK from beating
    Gloss + base=BLACK.

  Tie detection:
    Same score, different SKU -> partial status for manual
    resolution by Deepanshu.

**Pack handling:**
  Pack rounding: 0.925->1, 0.9->1, 3.7->4, 9.25->10, 18.5->20
  Bidirectional fallback: 1<->2 (Sadolin), 1->0.925/0.9,
    4->3.6/3.7, 10->9/9.25, 20->18/18.5

**Alt SKU signal:**
  When duplicate product|base|pack combos exist (e.g. WS Max
  10yr vs base-size SKUs), track alternate material code.
  Deepanshu can switch if stock is under alt code.

### Product Type Classification (Deep Dive)

138 total products classified by base resolution strategy:

  NO-BASE / DIRECT (82 products):
    All primers (ROM, Promise 2in1, Alkali Bloc, SB Cement,
    Zinc Yellow, EAP, Dulux WB Cement, etc.)
    All thinners (PU Prime Thinner, 2KPU Thinner, Melamine,
    NC Wood Thinner, etc.)
    All clear coats (Int/Ext CLR 2K PU Gloss/Matt/Sealer,
    NC Clear Lacquer, Synthetic Varnish, etc.)
    Putty (Acrylic Putty, Duwel Polyputty)
    Waterproofing (Aquatech 2in1, LW Plus, RP Latex, etc.)
    Machine Tinters (NO1, BU1, WH1, etc. -- all 1L only)

  FIXED-BASE (16 products):
    Promise SmartChoice INT/EXT (always BW)
    OPQ 2K PU Matt/Primer Surfacer (always BW)
    IBC Advance (always ADVANCE)
    Damp Protect Basecoat (always BASECOAT)
    BLACK stainer, BLK tinter (always BLACK)
    Duwel Enamel (always PHIROZA BLUE)

  NUMBERED-ONLY (26 products):
    Promise Interior/Exterior, Promise Sheen Int/Ext
    Diamond Glo, Pearl Glo, Platinum Glo, Eterna, Eterna Matt
    WS Max, Powerflexx, Protect, Protect Rainproof, HiSheen
    Superclean, 3in1, Supercover, Supercover Sheen
    PU Prime Gloss/Matt, 2KPU Gloss/Matt, Luxurio Gloss/Matt
    Satin Stay Bright, Lustre, Duwel Magik

  COLOUR (14 products):
    Promise Enamel (Black, Bus Green, Classic White, etc.)
    Gloss (29 named colours + 4 numbered)
    Super Satin (Teak, Black, Brown, etc.)
    PU Enamel (Black, Dark Brown, etc.)
    Floor Plus (10 colours)
    Wood Stain, Wood Filler
    Roof Coat (Grey, Terracotta)

### Stainer / Tinter Product Families

Two separate families sharing the word "stainer":

**Universal Stainer (STAINER category):**
  Pack sizes: 50ML, 100ML, 200ML ONLY
  10 colour products: Black, Burnt Sienna, Fast Blue,
    Fast Green, Fast Orange, Fast Red, Fast Violet,
    Fast Yellow, FastYellowGreen, Yellow Oxide
  Each colour = separate product in mo_sku_lookup

**Machine Tinter / Acotone (TINTER category):**
  Pack size: 1L ONLY
  22 code products: BLK, WHT, NO1, NO2, BU1, BU2,
    RE1, RE2, GR1, WH1, XR1, XY1, YE1, YE2, MA1,
    FFR, GRN, LFY, MAG, TBL, OXR, YOX
  Also: GVA (12 colour bases, 1L)
  Each tinter code = separate product

**Pack size disambiguates:** No overlap.
  50/100/200ML -> Universal Stainer
  1L -> Machine Tinter
  Generic keywords (STAINER, TINTER, MACHINE) get -2 penalty.

### Key Shared Keywords (Disambiguation)

20 keywords map to multiple products. The engine resolves
them via scoring (longer keyword wins) + pack verification
(invalid pack eliminated) + strategy bonuses.

Key conflicts and how they resolve:
- STAINER -> 11 products. Category penalty -2.
- FAST -> 8 stainer products. Category penalty -2.
- BLACK -> Stainer (50-200ML) vs Tinter BLK (1L) vs
  Gloss base (1-20L). Pack + product keyword disambiguates.
- YOX -> Yellow Oxide stainer (50-200ML) vs YOX tinter (1L).
- WB CEMENT PRIMER -> Dulux (1/4/20L) vs Duwel (10L only).
- SADOLIN PU THINNER -> PU Prime Matt vs PU Prime Thinner.
  Thinner packs=1/5/20, Matt packs=2/4. Pack disambiguates.
- VT ETERNA MATT -> Eterna vs Eterna Matt. "MATT" in text
  makes the longer keyword win.
- PROMISE 2IN1 PRIMER -> Promise 2in1 vs Promise Freedom 2in1.

### Files Changed

- lib/mail-orders/enrich.ts -- REPLACED with v2 engine
  New exports: buildProductProfiles(), buildSkuMaps() now
  returns { byCombo, byComboAlt, byMaterial }
  enrichLine() has 2 new optional params: skuByComboAlt,
  productProfiles (backward compatible)

- app/api/mail-orders/ingest/route.ts -- MODIFIED
  Imports buildProductProfiles. Destructures skuByComboAlt.
  Passes both new params to enrichLine().

- app/api/mail-orders/re-enrich/route.ts -- CREATED
  POST endpoint. Loads keywords/SKUs, builds v2 maps,
  fetches lines from last 2 days, re-enriches each,
  updates changed lines, recalculates matchedLines.
  Returns { total, updated, unchanged, ordersRecalculated }.
  Session auth required (call from browser console).

### Files NOT Modified

- mail-orders-table.tsx (no changes)
- mail-orders-page.tsx (no changes)
- focus-mode-view.tsx (no changes)
- resolve-line-panel.tsx (no changes)
- Parse-MailOrders-v5.ps1 (no changes)
- types.ts (no changes -- EnrichResult interface unchanged)
- customer-match.ts (no changes)
- delivery-match.ts (no changes)
- utils.ts (no changes)

### Re-enrichment Endpoint Usage

The re-enrich endpoint requires session auth (NextAuth
middleware). Call from logged-in browser console:

```javascript
fetch('/api/mail-orders/re-enrich', { method: 'POST' })
  .then(r => r.json()).then(d => console.log(d))
```

First run result: {total: 2366, updated: 328, unchanged: 2038,
ordersRecalculated: 158}

Use again after: adding new keywords, fixing SKU data, or
deploying algorithm changes. Safe to run multiple times
(idempotent -- only updates lines that would change).

---

## 55. Session Start Checklist (UPDATED v55)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v26.2** (v26 + mo_order_remarks + mo_line_status)
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
13. **Mail Order enrichment v2 (v55):** Generate -> verify -> rank. Full-text scoring (no stripping). Product-aware base resolution with 4 strategies: DIRECT/FIXED/NUMBERED/COLOUR. Strategy bonuses, pack rounding, bidirectional pack fallback, category keyword penalty (-2 for STAINER/TINTER/FAST), colour-as-product no-double-count, alt SKU tracking, tie->partial. 99% on 2,364 real lines.
14. **Mail Order PowerShell:** `Parse-MailOrders-v5.ps1` -- **v5.1.0**. Line Classification Engine. Fetches keywords from API at startup. Classifies every line as product/remark/noise. Remarks stored in mo_order_remarks. Space-separated pack/qty via ValidPacks.
15. **Mail Order Lock flag:** Auto-locks on OD, CI, Bill Tomorrow (word-boundary regex). Manual lock persisted to DB (isLocked on mo_orders).
16. **billing_operator role:** id=13, pageKey=mail_orders. Users: Deepanshu (id 25), Bankim (id 26). Password: Billing@123.
17. **SAP import enrichment:** `applyMailOrderEnrichment()` auto-applies dispatch data from mo_orders to orders when soNumber matches.
18. **soNumber on orders:** Mapped from SAP XLS "SONum" column in both manual and auto-import. Indexed.
19. **Mail Order customer matching:** LIVE (v45). customer-match.ts. Three states: exact/multiple/unmatched. parseSubject() handles subject parsing (v52). extractCustomerFromSubject() kept for backward compat.
20. **Mail Order keyboard shortcuts (v53):** Q=code, W=SKUs, E=SO input, R=reply, F=flag, A=SO Summary, /=search, N=next unmatched, P=pick, T=toggle punched, S=SKU panel, L=order list, Esc=cascade.
21. **Smart title case:** smartTitleCase() in lib/mail-orders/utils.ts.
22. **Backfill endpoint:** `/api/mail-orders/backfill-enrich` -- GET handler kept for ongoing use. POST is HMAC protected.
23. **Universal header color rule:** ONE teal element (active slot). Everything else gray.
24. **Universal header props:** segments (count optional), leftExtra, rightExtra, showDatePicker, showDownload.
25. **Old header cleanup pending:** TM has display:none wrapper. Old header files exist but unused.
26. **Mail Order split system (v47):** Auto-split at ingest (>1500L or >20 lines, and >1 line). Category-first algorithm with weighted score balancing.
27. **Mail Order volume (v49):** Stored as unit-aware packCode (e.g. "50ML" for stainers). Client-side calc.
28. **Mail Order parser v5.1 (v52):** Line Classification Engine + ValidPacks space-separated detection. See SS64.
29. **Mail Order ship-to override (v48):** Server-side deliveryRemarks match against delivery_point_master.
30. **Mail Order signal badges (v53):** 4-tier: blocker(red)/attention(amber)/info(gray)/split(purple). Hold removed from remarks.
31. **Mail Order bill sort (v49):** time -> bill number -> split label. No dispatch weight.
32. **Cross billing != shipToOverride.** Cross billing = another depot. Ship-to = different delivery address.
33. **ML unit stainer volume (v49):** enrich.ts appends "ML" suffix to packCode when sku.unit="ML".
34. All existing checklist items from v38 #36 still apply
35. **Enrichment v2 candidate sorting (v55):** candidates sorted by score DESC -> non-fallback first -> longer keyword. NOT keyword length DESC like v1.
36. **BW/ADVANCE fallback (v55):** Part of candidate generation per strategy. COLOUR/NUMBERED strategies add BW/ADVANCE to basesToTry with -1 penalty. No separate fallback pass.
37. **Pack rounding + expansion (v55):** PACK_ROUND (fractional->standard), PACK_EXPAND (standard->fractional bidirectional). Both applied before candidate generation.
38. **Bare colour base matching:** Removed in v2 (replaced by product-aware base resolution).
39. **Keywords API (v51):** `GET /api/mail-orders/keywords` -- public, no auth. Returns productKeywords, baseKeywords, customerKeywords.
40. **mo_order_remarks table (v51):** Stores remark lines from parser. remarkType: billing/delivery/contact/instruction/cross/customer/unknown. detectedBy: pattern/keyword/unknown/subject.
41. **Remark engine (v51):** Parser v5 classifies every line. Remarks don't reset carry-forward. All remarks captured (not just first). Customer keywords checked in Step 4b. See SS63.
42. **Order count sync SQL (v50):** After backfill, run sync query for matchedLines/totalLines.
43. **Keywords endpoint auth (v51):** /api/mail-orders/keywords excluded from middleware auth. Public read-only.
44. **Parser encoding (v51):** Parse-MailOrders-v5.ps1 must be saved as UTF-8 with BOM. Non-ASCII chars (except x) cause PowerShell 5.1 parse errors.
45. **Subject remark extraction (v52):** parseSubject() in customer-match.ts. Separates customer name, code, and remark signals from subject.
46. **ValidPacks (v52):** Hardcoded pack code set in parser. Used by Classify-Line Step 1b and SPACE-SEPARATED parser path.
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
58. **Enrichment v2 (v55):** enrich.ts fully replaced. buildProductProfiles() + skuByComboAlt passed from ingest route. re-enrich endpoint at /api/mail-orders/re-enrich (POST, session auth).
59. **Re-enrich endpoint (v55):** POST /api/mail-orders/re-enrich. Fetches lines from last 2 days, re-enriches with v2, updates changed lines, recalculates matchedLines. Idempotent.

---

## Pending Items (carry forward to v56)

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

### From v55 (new pending):
15. **Fuzzy matching (Level B):** Edit distance 1-2 fallback pass for typos (PROMSE, SADDOLIN). Runs only when exact match scores low.
16. **Learning from corrections (Level C):** Resolve panel corrections feed back into lookup. "Remember this match" checkbox stores raw text -> SKU mapping. Checked before keyword engine runs.
17. **Stainer keyword cleanup:** Remove generic STAINER / UNIVERSAL STAINER / MACHINE STAINER mappings that point to wrong products. Add specific compound keywords (UNIVERSAL STAINER BLK -> BLACK, etc.).
18. **Audit system:** Confidence scoring per line, batch stats capture, admin audit view, re-enrichment trigger UI, admin keyword management.
19. **Tinter code space-variant keywords:** NO 1, BU 1 etc. (carried from v53)
20. **Unicode x parser fix** (carried from v53)

---

*Version: Phase 1 Go-Live . Schema v26.2 . Context v55 . April 2026*
