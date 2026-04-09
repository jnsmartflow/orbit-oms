# CLAUDE_CONTEXT.md -- Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v57.md fully before doing anything else."
# Version: Phase 1 Go-Live . Schema v26.2 . Context v57 . April 2026

---

## 1-64. [Unchanged from v52-v54]

(All sections 1 through 64 remain unchanged -- refer to v52 for base content, v53 context-update for session 53 changes, v54 context-update for session 54 changes)

---

## 65. Session v53 Changes (unchanged -- see context-update-v53.md)

## 66. Session v54 Changes (unchanged -- see context-update-v54.md)

---

## 67. Session v55 Changes (unchanged -- see CLAUDE_CONTEXT_v55.md)

## 68. Session v56 Changes (unchanged -- see CLAUDE_CONTEXT_v56.md)

---

## 69. Session v57 Changes (April 2026)

### Engine Bug Fix -- NUMBERED Strategy Tie Detection

**Root cause:** When NUMBERED strategy had no detected base in the
text, basesToTry included BW and "" (empty). Both produced candidates
for the same product with identical scores but different materials
(e.g. PROTECT|BW|20 vs PROTECT||20). Tie detection fired -> partial.

This affected ANY NUMBERED-strategy product where the user didn't
specify a base: PROTECT, PEARL GLO, MAX, POWERFLEXX, LUXURIO PU
SEALER, LUXURIO PU MATT, etc. -- dozens of lines across all orders.

**Fix applied (commit fc985f18):**
1. Sort: Added non-empty base preference -- BW always sorts before ""
   when scores are equal
2. Tie detection: Added `(!!second.base) === (!!top.base)` check --
   BW vs "" is not a real tie since sort decisively picks BW

**Impact:** +17 matched lines in 2-day window (2306->2323 matched).

### SQL Data Fixes -- enrichment-fix-v57.sql

**Product keywords added:**
- PU PRIME CLEAR MATT -> PU PRIME MATT CLEAR (+ CLR variant + SADOLIN prefix)
- PU PRIME CLEAR GLOSS -> PU PRIME GLOSS CLEAR (preemptive)
- TINTER BLK / TINTER BLACK -> BLK (tinter product, not stainer BLACK)
- WEATHERSHIELD / WEATHER SHIELD / WEATHERSHIED -> PROTECT
- PU SMOKE GREY / PU SMOKE GRAY / PU DARK BROWN / PU WHITE -> PU PRIME MATT

**SKU added:**
- Crackfiller 5MM 300G (material 5964276) -- was in v56 SQL but
  never actually inserted into DB

**Base keywords added:**
- M900 90 -> 90 BASE, M900 92 -> 92 BASE, M900 93 -> 93 BASE
  (compound keywords to prevent "90" in "M900" from matching as base)

**NOT run (needs real material codes from SAP):**
- M900 SKU entries (13 SKUs) -- commented out in SQL with placeholders.
  Must get actual material codes from stock file before inserting.

### Debug Endpoint Enhanced (then reverted)

Temporarily added candidate simulation logging to debug-enrich
endpoint to trace the tie bug. Reverted after fix confirmed.

### Results

Before session: 2306 matched (97.5%), 33 partial, 27 unmatched
After engine fix: 2323 matched (98.2%), 16 partial, 27 unmatched
After SQL fixes: TBD (SQL not yet run -- run + re-enrich next session)

Expected after SQL: ~2328-2330 matched (~98.4%), ~11 partial, ~25 unmatched

### Files Modified

- lib/mail-orders/enrich.ts -- tie detection fix (BW vs empty base
  preference in sort + tie check)
- app/api/mail-orders/debug-enrich/route.ts -- temp debug logging
  added then reverted

### Files NOT Modified

- app/api/mail-orders/ingest/route.ts
- app/api/mail-orders/re-enrich/route.ts
- All UI files, types.ts, customer-match.ts, delivery-match.ts
- Parse-MailOrders-v5.ps1

---

## 55. Session Start Checklist (UPDATED v57)

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
13. **Mail Order enrichment v2 (v55-v57):** Generate -> verify -> rank. Full-text scoring (no stripping). Product-aware base resolution with 4 strategies: DIRECT/FIXED/NUMBERED/COLOUR. Strategy bonuses, pack rounding, bidirectional pack fallback, category keyword penalty (-2 for STAINER/TINTER/FAST), colour-as-product no-double-count, alt SKU tracking, isPrimaryPack preference, cross-product tie guard, base-presence tie guard. 98.2% on 2,366 real lines (2323/2366 matched).
14. **Mail Order PowerShell:** `Parse-MailOrders-v5.ps1` -- **v5.1.0**. Line Classification Engine. Fetches keywords from API at startup. Classifies every line as product/remark/noise. Remarks stored in mo_order_remarks. Space-separated pack/qty via ValidPacks.
15. **Mail Order Lock flag:** Auto-locks on OD, CI, Bill Tomorrow (word-boundary regex). Manual lock persisted to DB (isLocked on mo_orders).
16. **billing_operator role:** id=13, pageKey=mail_orders. Users: Deepanshu (id 25), Bankim (id 26). Password: Billing@123.
17. **SAP import enrichment:** `applyMailOrderEnrichment()` auto-applies dispatch data from mo_orders to orders when soNumber matches.
18. **soNumber on orders:** Mapped from SAP XLS "SONum" column in both manual and auto-import. Indexed.
19. **Mail Order customer matching:** LIVE (v45). customer-match.ts. Three states: exact/multiple/unmatched. parseSubject() handles subject parsing (v52). extractCustomerFromSubject() kept for backward compat.
20. **Mail Order keyboard shortcuts (v53):** Q=code, W=SKUs, E=SO input, R=reply, F=flag, A=SO Summary, /=search, N=next unmatched, P=pick, T=toggle punched, S=SKU panel, L=order list, Esc=cascade.
21. **Smart title case:** smartTitleCase() in lib/mail-orders/utils.ts.
22. **Backfill endpoint:** `/api/mail-orders/backfill-enrich` -- DEPRECATED for re-enrichment. Use /api/mail-orders/re-enrich instead (v2, all 8 args).
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
35. **Enrichment v2 candidate sorting (v55-v57):** candidates sorted by score DESC -> isPrimaryPack DESC -> non-fallback first -> non-empty base first -> longer keyword. NOT keyword length DESC like v1.
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
58. **Enrichment v2 (v55):** enrich.ts fully replaced. buildProductProfiles() + skuByComboAlt passed from ingest route.
59. **Re-enrich endpoint (v55-v56):** POST /api/mail-orders/re-enrich. Uses v2 with all 8 enrichLine args. Session auth + maxDuration=300. Idempotent. Do NOT use /api/mail-orders/backfill-enrich (v1).
60. **Re-enrich endpoint (v56):** /api/mail-orders/re-enrich (POST, session auth). Uses v2 with all 8 enrichLine args. Do NOT use /api/mail-orders/backfill-enrich (v1, 6 args).
61. **Debug-enrich endpoint (v56):** /api/mail-orders/debug-enrich (GET, session auth). ?text=...&pack=... Returns result + debug info.
62. **Pack expansion tie fix (v56):** isPrimaryPack on ScoredCandidate. Primary pack beats expansion packs at equal score. Tie detection respects isPrimaryPack.
63. **NUMBERED strategy override (v56):** Any product with bases matching /^9[0-8]/ gets NUMBERED, even if it also has named colour bases.
64. **Generic keywords deleted (v56):** STAINER, FAST, TINTER, MACHINE, MACHINE STAINER/TINTER/TINTERS, UNIVERSAL STAINER, UNIVERSAL STAINER FAST -- all deleted from mo_product_keywords. Replaced with specific compound keywords. CATEGORY_KEYWORDS set in enrich.ts is now dead code (can be removed).
65. **BW vs empty base tie fix (v57):** Sort prefers non-empty base. Tie detection checks base-presence equality. NUMBERED with no detected base -> BW wins over "".

---

## Pending Items (carry forward to v58)

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
15. **Fuzzy matching (Level B):** Design ready (see v56 next-session
    prompt). After v57 SQL fixes, pull full historical partial/unmatched
    set for proper fuzzy threshold design. Edit-distance fallback after
    exact match produces 0 candidates.
16. **Learning from corrections (Level C):** Resolve panel corrections
    feed back into lookup.
17. **Audit system:** Confidence scoring per line, batch stats, admin
    view, keyword management UI.
18. **Unicode x parser fix** (carried from v53)

### From v56 (still pending):
19. **CATEGORY_KEYWORDS cleanup:** The set in enrich.ts (STAINER,
    FAST, TINTER, etc.) is now dead code. Can be removed.
20. **PU PRIME WHITE SEALER:** Keyword maps to product name
    "PU PRIME WHITE SEALER" which has no SKU entries. Either add
    real SKUs or remap keyword to existing product (INT CLR 2K PU
    SEALER?). Investigate what actual Sadolin product this is.

### From v57 (new):
21. **Run enrichment-fix-v57.sql** -- product keywords, crackfiller
    300G SKU, M900 base keywords. Then re-enrich.
22. **M900 SKU entries** -- need actual SAP material codes from stock
    file. 13 SKUs (BW + 90/92/93 BASE x 4 packs). Commented out in
    enrichment-fix-v57.sql with placeholders.
23. **M900 base detection** -- "M900 92" picks up "90" from product
    name. Compound base keywords added (M900 90/92/93) as workaround.
    Proper fix: exclude product-name substrings from base regex. Low
    priority if compound keywords work.
24. **BW -> 90 BASE fallback** -- Products like 2KPU MATT/GLOSS have
    90 BASE = white but no BW SKU. When user says "2K Matt White",
    BW is detected but not in product's validBases -> 0 candidates ->
    partial. Engine needs: if BW detected but not in validBases, and
    product has 90 BASE, try 90 BASE as BW equivalent. Affects 2KPU
    MATT, 2KPU GLOSS, possibly others.
25. **Stainer pack extraction from rawText** -- Lines like "Burnt
    senna 100gm X" have pack in rawText but parser sends pack=null.
    Either fix Parse-MailOrders-v5.ps1 to extract "100gm"->100, or
    add rawText pack extraction pass in enrichLine before step 2.
26. **BLK/BLK1 tinter vs stainer** -- "Blk" pack=null defaults to
    1L -> stainer BLACK has no 1L SKU, tinter BLK has 1L. When pack
    is 1L, prefer tinter BLK over stainer BLACK. Engine heuristic
    needed.
27. **DIY Spray products** -- Not in mo_sku_lookup at all. "DIY
    Spray Phiroza/smoke grey/Dark Brown/Silver" all pack=400.
    Either add DIY Spray SKUs from stock file or accept as
    permanently unmatched.
28. **Truncated material codes** -- "320768" (DULUX WB CEMENT PRIMER
    partial material code IN32076823/71/81/82). Parser sends as text
    not __MATERIAL_CODE__. Could add prefix matching in enrichLine
    material code step.

---

*Version: Phase 1 Go-Live . Schema v26.2 . Context v57 . April 2026*
