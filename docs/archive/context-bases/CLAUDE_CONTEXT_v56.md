# CLAUDE_CONTEXT.md -- Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v56.md fully before doing anything else."
# Version: Phase 1 Go-Live . Schema v26.2 . Context v56 . April 2026

---

## 1-64. [Unchanged from v52-v54]

(All sections 1 through 64 remain unchanged -- refer to v52 for base content, v53 context-update for session 53 changes, v54 context-update for session 54 changes)

---

## 65. Session v53 Changes (unchanged -- see context-update-v53.md)

## 66. Session v54 Changes (unchanged -- see context-update-v54.md)

---

## 67. Session v55 Changes (unchanged -- see CLAUDE_CONTEXT_v55.md)

---

## 68. Session v56 Changes (NEW -- April 2026)

### Enrichment Data Audit + Keyword Cleanup + Engine Fixes

Deep-dive audit of all 4 data sources (mo_product_keywords,
mo_base_keywords, mo_sku_lookup, Stock_File) cross-referenced
against 2,364 real order lines (Apr 6-7).

### SQL Data Fixes Applied

**Batch 1 -- enrichment-fix-v56.sql (run in Supabase SQL Editor):**

Deletes (~149 rows):
- 90 duplicate product keyword rows (batch insert artifact, IDs 706-1027)
- 34 generic ambiguous keywords (STAINER->11 products, FAST->8, TINTER->2,
  MACHINE->1, MACHINE STAINER->3, MACHINE TINTER->2, MACHINE TINTERS->2,
  UNIVERSAL STAINER->3, UNIVERSAL STAINER FAST->2, STAINER FAST->1)
- 16 orphan product keywords (SMOKE GREY, DARK BROWN, PHIROZA, PHIROZA BLUE,
  PO RED, DEEP ORANGE, GOL BROWN as products -- these are base colours;
  VT BASECOAT, PU PRIME SEALER orphan names;
  2KPU GLOSS/MATT 90/93 BASE sub-products)
- 5 wrong-mapping fixes (VT ETERNA MATT->ETERNA, SADOLIN PU MATT->OPQ,
  SADOLIN 2K MATT->OPQ, SADOLIN PU THINNER->PU PRIME MATT,
  PROMISE 2IN1 PRIMER->FREEDOM)
- 4 ambiguous base keywords (RED->FAST RED, 322->FAST RED,
  ORANGE->ORGANIC ORANGE, WHT->WHITE)

Inserts (~94 rows):
- 18 specific tinter/stainer compound keywords
  (MACHINE TINTER BLK, UNIVERSAL STAINER BLACK, etc.)
- 47 missing product keywords: PU PRIME CLEAR SEALER, SADOLIN PU PRIMER
  SURFACER, 1KPU CLEAR, ROOTCOAT->ROOF COAT, N01->NO1, SMARTCOICE/SMT CHOICE
  typos, PROIMSE typos, TEXTUTE, GLOSS GOES YEARS, VELVET PEARL GLO,
  AQUATECH CRACK
- 10 missing base keywords (SANDSTONE, IVORY, SMOKE GREY, BASECOAT,
  93 BASE CLR, SIGNAL RED PLUS)
- 14 M900 entries (13 SKUs + 5 product keywords)
- 1 Crackfiller 5MM 300G SKU (material 5964276)

**Batch 2 -- hotfix after regressions:**
- Added FAST GREEN product keyword (all 3 originals were generic and
  got deleted in batch 1: FAST, STAINER, UNIVERSAL STAINER FAST)
- Also added STAINER FAST GREEN, STAINER GREEN, GREEN STAINER

### Engine Bug Fixes (enrich.ts)

**Fix 1 -- COLOUR -> NUMBERED strategy for mixed-base products:**
Products like PROTECT and MAX have BOTH numbered bases (90-98 BASE)
AND named colour bases (TERACOTTA, SIGNAL RED, etc.).
buildProductProfiles classified them as COLOUR strategy.
Fix: if any base matches /^9[0-8]/, classify as NUMBERED.
NUMBERED handles both keyword-detected bases AND regex-detected
numbered bases, plus BW fallback. Named colour bases still found
via detectedBases in NUMBERED strategy.

**Fix 2 -- Pack expansion tie causing false partials:**
Root cause of major regressions. When PACK_EXPAND generates
alternate packs (e.g. pack=1 expands to [1, 2, 0.925, 0.9, 0.975]),
both primary and expansion packs could match different SKUs with
identical scores. Example: PROTECT|94 BASE|1 (5880395) and
PROTECT|94 BASE|0.9 (5880418) both score 5. Same score + different
material = tie = partial.
Fix: Added `isPrimaryPack` to ScoredCandidate. Primary pack
(cleanPack, first in packsToTry) always beats expansion packs
when scores are equal. Tie detection also checks isPrimaryPack --
if one is primary and other isn't, not a real tie.

**Fix 3 -- Cross-product tie causing false partials:**
Tie detection fired between candidates for DIFFERENT products
(e.g. PROTECT vs WS PROTECT RAINPROOF) with same score.
Fix: Added `candidates[1].product === top.product` to tie condition.
Cross-product "ties" are not real ties -- sort already picked best.

**Fix 4 -- Same-product base tie (BW vs empty base):**
NUMBERED strategy with no detected base generates basesToTry=[BW,""].
Both produce candidates with identical scores. Different materials
-> tie -> partial.
Fix: Sort prefers non-empty base over empty. Tie detection checks
`(!!second.base) === (!!top.base)` -- BW vs "" is not a real tie.

### New Endpoints

**app/api/mail-orders/re-enrich/route.ts -- UPDATED (v2)**
POST endpoint. Session auth + maxDuration=300. Loads keywords/SKUs,
builds v2 maps (byComboAlt + buildProductProfiles), fetches lines
from last 2 days, re-enriches each with all 8 enrichLine args,
updates changed lines, recalculates matchedLines. Returns
{ total, updated, unchanged, ordersRecalculated }. Idempotent.

NOTE: The old backfill-enrich endpoint still exists at
app/api/mail-orders/backfill-enrich/route.ts but uses v1 (6 args,
no productProfiles). Do NOT use it for re-enrichment. Always use
/api/mail-orders/re-enrich.

**app/api/mail-orders/debug-enrich/route.ts -- CREATED**
GET endpoint. Session auth. Query params: ?text=...&pack=...
Returns enrichLine result + debug info (matched keywords, detected
bases, product profile, combo map sizes). Used for troubleshooting.

### Results

Before session: 2287 matched (96.7%), 50 partial, 27 unmatched
After session:  2306 matched (97.5%), 33 partial, 27 unmatched

Net: +19 matched, -17 partial. 27 unmatched unchanged (noise lines,
brush material codes, phone numbers -- correctly unmatched).

### Files Modified

- lib/mail-orders/enrich.ts
  - buildProductProfiles: NUMBERED strategy for mixed-base products
  - ScoredCandidate: added isPrimaryPack field
  - Candidate sort: isPrimaryPack preference, non-empty base preference
  - Tie detection: isPrimaryPack check, same-product check, base-presence check

### Files Created

- app/api/mail-orders/re-enrich/route.ts (v2 re-enrich endpoint)
- app/api/mail-orders/debug-enrich/route.ts (debug endpoint)

### Files NOT Modified

- app/api/mail-orders/ingest/route.ts (already v2 from v55)
- mail-orders-table.tsx, mail-orders-page.tsx, focus-mode-view.tsx
- resolve-line-panel.tsx, types.ts, customer-match.ts, delivery-match.ts
- utils.ts, Parse-MailOrders-v5.ps1

---

## 55. Session Start Checklist (UPDATED v56)

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
13. **Mail Order enrichment v2 (v55-v56):** Generate -> verify -> rank. Full-text scoring (no stripping). Product-aware base resolution with 4 strategies: DIRECT/FIXED/NUMBERED/COLOUR. Strategy bonuses, pack rounding, bidirectional pack fallback, category keyword penalty (-2 for STAINER/TINTER/FAST), colour-as-product no-double-count, alt SKU tracking, isPrimaryPack preference, cross-product tie guard, base-presence tie guard. 97.5% on 2,366 real lines.
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
35. **Enrichment v2 candidate sorting (v55-v56):** candidates sorted by score DESC -> isPrimaryPack DESC -> non-fallback first -> non-empty base first -> longer keyword. NOT keyword length DESC like v1.
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

---

## Pending Items (carry forward to v57)

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

### From v55 (updated):
15. **Fuzzy matching (Level B):** READY FOR NEXT SESSION. 33 partial + 27 unmatched lines available as test set.
16. **Learning from corrections (Level C):** Resolve panel corrections feed back into lookup.
17. ~~Stainer keyword cleanup~~ **DONE in v56** -- generic keywords deleted, specific compounds added.
18. **Audit system:** Confidence scoring per line, batch stats, admin view, keyword management.
19. ~~Tinter code space-variant keywords~~ -- NO1/NO 1, BU1/BU 1 etc. already exist as product keywords (verified in v56 audit). Base keyword variants not needed (these are product names, not bases).
20. **Unicode x parser fix** (carried from v53)

### From v56 (new):
21. **CATEGORY_KEYWORDS cleanup:** The set in enrich.ts (STAINER, FAST, TINTER, etc.) is now dead code since those keywords were deleted from DB. Can be removed for clarity.
22. **PU PRIME WHITE SEALER keyword conflict:** keyword "PU PRIME WHITE SEALER" (id=802) maps to INT CLR 2K PU SEALER, but enrichLine shows productName="PU PRIME WHITE SEALER" in partial results. The keyword product field is correct (INT CLR 2K PU SEALER) but partial fallback at line 457 picks the keyword TEXT as product name. Needs investigation or the actual Sadolin PU Prime White Sealer product needs to be added as a distinct product in mo_sku_lookup if it exists.
23. **M900 base detection:** "M900 92" (line 32985) resolves base as "90 BASE" instead of "92 BASE". The "90" in "M900" matches base keyword "90"->"90 BASE" before regex catches "92". Need to ensure "M900" doesn't trigger base "90". Could add "M900" to a no-base-from-product-name exclusion list.

---

*Version: Phase 1 Go-Live . Schema v26.2 . Context v56 . April 2026*
