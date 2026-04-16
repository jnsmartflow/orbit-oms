================================================================
CONTEXT UPDATE — v55 → v56
================================================================

Add to CLAUDE_CONTEXT_v56.md:

================================================================
## 68. Session v56 Changes (NEW — April 2026)
================================================================

### Enrichment Data Audit + Keyword Cleanup + Engine Fixes

Deep-dive audit of all 4 data sources (mo_product_keywords,
mo_base_keywords, mo_sku_lookup, Stock_File) cross-referenced
against 2,364 real order lines (Apr 6-7).

### SQL Data Fixes Applied

**Batch 1 — enrichment-fix-v56.sql (run in Supabase SQL Editor):**

Deletes (~149 rows):
- 90 duplicate product keyword rows (batch insert artifact, IDs 706-1027)
- 34 generic ambiguous keywords (STAINER→11 products, FAST→8, TINTER→2,
  MACHINE→1, MACHINE STAINER→3, MACHINE TINTER→2, MACHINE TINTERS→2,
  UNIVERSAL STAINER→3, UNIVERSAL STAINER FAST→2, STAINER FAST→1)
- 16 orphan product keywords (SMOKE GREY, DARK BROWN, PHIROZA, PHIROZA BLUE,
  PO RED, DEEP ORANGE, GOL BROWN as products — these are base colours;
  VT BASECOAT, PU PRIME SEALER orphan names;
  2KPU GLOSS/MATT 90/93 BASE sub-products)
- 5 wrong-mapping fixes (VT ETERNA MATT→ETERNA, SADOLIN PU MATT→OPQ,
  SADOLIN 2K MATT→OPQ, SADOLIN PU THINNER→PU PRIME MATT,
  PROMISE 2IN1 PRIMER→FREEDOM)
- 4 ambiguous base keywords (RED→FAST RED, 322→FAST RED,
  ORANGE→ORGANIC ORANGE, WHT→WHITE)

Inserts (~94 rows):
- 18 specific tinter/stainer compound keywords
  (MACHINE TINTER BLK, UNIVERSAL STAINER BLACK, etc.)
- 47 missing product keywords: PU PRIME CLEAR SEALER, SADOLIN PU PRIMER
  SURFACER, 1KPU CLEAR, ROOTCOAT→ROOF COAT, N01→NO1, SMARTCOICE/SMT CHOICE
  typos, PROIMSE typos, TEXTUTE, GLOSS GOES YEARS, VELVET PEARL GLO,
  AQUATECH CRACK
- 10 missing base keywords (SANDSTONE, IVORY, SMOKE GREY, BASECOAT,
  93 BASE CLR, SIGNAL RED PLUS)
- 14 M900 entries (13 SKUs + 5 product keywords)
- 1 Crackfiller 5MM 300G SKU (material 5964276)

**Batch 2 — hotfix after regressions:**
- Added FAST GREEN product keyword (all 3 originals were generic and
  got deleted in batch 1: FAST, STAINER, UNIVERSAL STAINER FAST)
- Also added STAINER FAST GREEN, STAINER GREEN, GREEN STAINER

### Engine Bug Fixes (enrich.ts)

**Fix 1 — COLOUR → NUMBERED strategy for mixed-base products:**
Products like PROTECT and MAX have BOTH numbered bases (90-98 BASE)
AND named colour bases (TERACOTTA, SIGNAL RED, etc.).
buildProductProfiles classified them as COLOUR strategy.
Fix: if any base matches /^9[0-8]/, classify as NUMBERED.
NUMBERED handles both keyword-detected bases AND regex-detected
numbered bases, plus BW fallback. Named colour bases still found
via detectedBases in NUMBERED strategy.

**Fix 2 — Pack expansion tie causing false partials:**
Root cause of major regressions. When PACK_EXPAND generates
alternate packs (e.g. pack=1 expands to [1, 2, 0.925, 0.9, 0.975]),
both primary and expansion packs could match different SKUs with
identical scores. Example: PROTECT|94 BASE|1 (5880395) and
PROTECT|94 BASE|0.9 (5880418) both score 5. Same score + different
material = tie = partial.
Fix: Added `isPrimaryPack` to ScoredCandidate. Primary pack
(cleanPack, first in packsToTry) always beats expansion packs
when scores are equal. Tie detection also checks isPrimaryPack —
if one is primary and other isn't, not a real tie.

### New Endpoints

**app/api/mail-orders/re-enrich/route.ts — CREATED (v2)**
POST endpoint. Session auth. Loads keywords/SKUs, builds v2 maps
(byComboAlt + buildProductProfiles), fetches lines from last 2 days,
re-enriches each with all 8 enrichLine args, updates changed lines,
recalculates matchedLines. Returns { total, updated, unchanged,
ordersRecalculated }. Idempotent.

NOTE: The old backfill-enrich endpoint still exists at
app/api/mail-orders/backfill-enrich/route.ts but uses v1 (6 args,
no productProfiles). Do NOT use it for re-enrichment. Always use
/api/mail-orders/re-enrich.

**app/api/mail-orders/debug-enrich/route.ts — CREATED**
GET endpoint. Session auth. Query params: ?text=...&pack=...
Returns enrichLine result + debug info (matched keywords, detected
bases, product profile, combo map sizes). Used for troubleshooting.

### Results

Before session: 2287 matched (96.7%), 50 partial, 27 unmatched
After session:  2306 matched (97.5%), 33 partial, 27 unmatched

Net: +19 matched, -17 partial. 27 unmatched unchanged (noise lines,
brush material codes, phone numbers — correctly unmatched).

### Files Modified

- lib/mail-orders/enrich.ts
  - buildProductProfiles: NUMBERED strategy for mixed-base products
  - ScoredCandidate: added isPrimaryPack field
  - Candidate sort: isPrimaryPack preference
  - Tie detection: isPrimaryPack check

### Files Created

- app/api/mail-orders/re-enrich/route.ts (v2 re-enrich endpoint)
- app/api/mail-orders/debug-enrich/route.ts (debug endpoint)

### Files NOT Modified

- app/api/mail-orders/ingest/route.ts (already v2 from v55)
- mail-orders-table.tsx, mail-orders-page.tsx, focus-mode-view.tsx
- resolve-line-panel.tsx, types.ts, customer-match.ts, delivery-match.ts
- utils.ts, Parse-MailOrders-v5.ps1

================================================================
## Update Checklist Items
================================================================

Add to session start checklist:

60. **Re-enrich endpoint (v56):** /api/mail-orders/re-enrich (POST, session auth). Uses v2 with all 8 enrichLine args. Do NOT use /api/mail-orders/backfill-enrich (v1, 6 args).
61. **Debug-enrich endpoint (v56):** /api/mail-orders/debug-enrich (GET, session auth). ?text=...&pack=... Returns result + debug info.
62. **Pack expansion tie fix (v56):** isPrimaryPack on ScoredCandidate. Primary pack beats expansion packs at equal score. Tie detection respects isPrimaryPack.
63. **NUMBERED strategy override (v56):** Any product with bases matching /^9[0-8]/ gets NUMBERED, even if it also has named colour bases.
64. **Generic keywords deleted (v56):** STAINER, FAST, TINTER, MACHINE, MACHINE STAINER/TINTER/TINTERS, UNIVERSAL STAINER, UNIVERSAL STAINER FAST — all deleted from mo_product_keywords. Replaced with specific compound keywords. CATEGORY_KEYWORDS set in enrich.ts is now dead code (can be removed).

================================================================
## Update Pending Items (carry forward to v57)
================================================================

### From v53 (still pending):
1. OBD date parsing — DD-MM-YYYY causes null obdEmailDate
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
17. ~~Stainer keyword cleanup~~ **DONE in v56** — generic keywords deleted, specific compounds added.
18. **Audit system:** Confidence scoring per line, batch stats, admin view, keyword management.
19. ~~Tinter code space-variant keywords~~ — NO1/NO 1, BU1/BU 1 etc. already exist as product keywords (verified in v56 audit). Base keyword variants not needed (these are product names, not bases).
20. **Unicode x parser fix** (carried from v53)

### From v56 (new):
21. **CATEGORY_KEYWORDS cleanup:** The set in enrich.ts (STAINER, FAST, TINTER, etc.) is now dead code since those keywords were deleted from DB. Can be removed for clarity.
22. **PU PRIME WHITE SEALER keyword conflict:** keyword "PU PRIME WHITE SEALER" (id=802) maps to INT CLR 2K PU SEALER, but enrichLine shows productName="PU PRIME WHITE SEALER" in partial results. The keyword product field is correct (INT CLR 2K PU SEALER) but partial fallback at line 457 picks the keyword TEXT as product name. Needs investigation or the actual Sadolin PU Prime White Sealer product needs to be added as a distinct product in mo_sku_lookup if it exists.
23. **M900 base detection:** "M900 92" (line 32985) resolves base as "90 BASE" instead of "92 BASE". The "92" regex matches but "90" in "M900" also matches first via base keyword "90"→"90 BASE". Need to ensure "M900" doesn't trigger base "90". Could add "M900" to a no-base-from-product-name exclusion list.

================================================================
*Version: Phase 1 Go-Live . Schema v26.2 . Context v56 . April 2026*


================================================================
================================================================
NEXT SESSION PROMPT — Fuzzy Matching (Level B)
================================================================

UPLOAD THESE FILES:

1. CLAUDE_CONTEXT_v56.md
2. lib/mail-orders/enrich.ts (current deployed version)
3. app/api/mail-orders/re-enrich/route.ts
4. app/api/mail-orders/debug-enrich/route.ts
5. Fresh 2-day order export:
   SELECT o.id AS order_id, o."soName", ol.id AS line_id,
     ol."rawText", ol."packCode", ol.quantity, ol."productName",
     ol."baseColour", ol."skuCode", ol."matchStatus",
     o."receivedAt"::date AS order_date
   FROM mo_order_lines ol
   JOIN mo_orders o ON o.id = ol."moOrderId"
   WHERE o."receivedAt" >= NOW() - INTERVAL '2 days'
   AND ol."matchStatus" IN ('partial', 'unmatched')
   ORDER BY ol."matchStatus", ol.id;
6. mo_product_keywords — SELECT * FROM mo_product_keywords ORDER BY product, keyword;
7. mo_base_keywords — SELECT * FROM mo_base_keywords ORDER BY "baseColour", keyword;

================================================================
STEP 1 — ANALYSE REMAINING PARTIAL/UNMATCHED (no code)
================================================================

Current state (v56): 2306 matched, 33 partial, 27 unmatched on 2366 lines.

For each remaining partial/unmatched line, classify into:

A. FIXABLE BY DATA (missing keyword, missing SKU, wrong mapping)
   → Write SQL fix, I'll run it, then re-enrich.

B. FIXABLE BY FUZZY MATCHING (typo in rawText, edit distance 1-2)
   → These are the fuzzy match candidates.

C. GENUINELY AMBIGUOUS / WRONG PACK / NOT A PAINT ITEM
   → Correct as partial/unmatched. No fix needed.

Show the classification. Wait for my approval.

================================================================
STEP 2 — FUZZY MATCHING DESIGN (no code yet)
================================================================

Design edit-distance fallback for enrichLine():

WHEN to trigger:
- After Step 5 (candidate generation) produces zero candidates
- OR all candidates have score < threshold (e.g. < 3)

HOW:
- For each product keyword (len > 6): Levenshtein distance
  against sliding windows in raw text. Accept distance ≤ 2.
- For keywords 4-6 chars: accept distance ≤ 1.
- Never fuzzy match keywords < 4 chars.
- Fuzzy matches get score penalty: -3 per edit distance.
  Exact matches always beat fuzzy at same keyword length.

OUTPUT:
- matchStatus stays "matched" but can add confidence field
  to debug output (not in EnrichResult — no interface change).
- Low-confidence fuzzy matches could show a signal in UI later.

Show me the design. Wait for approval before coding.

================================================================
STEP 3 — IMPLEMENT + TEST (after design approval)
================================================================

Write TypeScript changes to enrichLine() in enrich.ts.
- Add fuzzy pass after exact-match candidate generation.
- Keep all existing logic untouched for exact matches.
- Fuzzy only activates when exact produces 0 candidates.

Test on remaining partial/unmatched lines from Step 1B.

tsc --noEmit — zero errors.
Commit + push. Re-enrich. Report before/after counts.

DO NOT change EnrichResult interface.
DO NOT change any UI code.
DO NOT change any other files except enrich.ts.

================================================================
