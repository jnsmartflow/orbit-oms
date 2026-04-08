================================================================
CONTEXT UPDATE — v56 → v57
================================================================

Add to CLAUDE_CONTEXT_v57.md:

================================================================
## 69. Session v57 Changes (April 2026)
================================================================

### Engine Bug Fix — NUMBERED Strategy Tie Detection

**Root cause:** When NUMBERED strategy had no detected base in the
text, basesToTry included BW and "" (empty). Both produced candidates
for the same product with identical scores but different materials
(e.g. PROTECT|BW|20 vs PROTECT||20). Tie detection fired → partial.

This affected ANY NUMBERED-strategy product where the user didn't
specify a base: PROTECT, PEARL GLO, MAX, POWERFLEXX, LUXURIO PU
SEALER, LUXURIO PU MATT, etc. — dozens of lines across all orders.

**Fix applied (commit fc985f18):**
1. Sort: Added non-empty base preference — BW always sorts before ""
   when scores are equal
2. Tie detection: Added `(!!second.base) === (!!top.base)` check —
   BW vs "" is not a real tie since sort decisively picks BW

**Impact:** +17 matched lines in 2-day window (2306→2323 matched).

### SQL Data Fixes — enrichment-fix-v57.sql

**Product keywords added:**
- PU PRIME CLEAR MATT → PU PRIME MATT CLEAR (+ CLR variant + SADOLIN prefix)
- PU PRIME CLEAR GLOSS → PU PRIME GLOSS CLEAR (preemptive)
- TINTER BLK / TINTER BLACK → BLK (tinter product, not stainer BLACK)
- WEATHERSHIELD / WEATHER SHIELD / WEATHERSHIED → PROTECT
- PU SMOKE GREY / PU SMOKE GRAY / PU DARK BROWN / PU WHITE → PU PRIME MATT

**SKU added:**
- Crackfiller 5MM 300G (material 5964276) — was in v56 SQL but
  never actually inserted into DB

**Base keywords added:**
- M900 90 → 90 BASE, M900 92 → 92 BASE, M900 93 → 93 BASE
  (compound keywords to prevent "90" in "M900" from matching as base)

**NOT run (needs real material codes from SAP):**
- M900 SKU entries (13 SKUs) — commented out in SQL with placeholders.
  Must get actual material codes from stock file before inserting.

### Debug Endpoint Enhanced (then reverted)

Temporarily added candidate simulation logging to debug-enrich
endpoint to trace the tie bug. Reverted after fix confirmed.

### Results

Before session: 2306 matched (97.5%), 33 partial, 27 unmatched
After engine fix: 2323 matched (98.2%), 16 partial, 27 unmatched
After SQL fixes: TBD (SQL not yet run — run + re-enrich next session)

Expected after SQL: ~2328-2330 matched (~98.4%), ~11 partial, ~25 unmatched

### Files Modified

- lib/mail-orders/enrich.ts — tie detection fix (BW vs empty base
  preference in sort + tie check)
- app/api/mail-orders/debug-enrich/route.ts — temp debug logging
  added then reverted

### Files NOT Modified

- app/api/mail-orders/ingest/route.ts
- app/api/mail-orders/re-enrich/route.ts
- All UI files, types.ts, customer-match.ts, delivery-match.ts
- Parse-MailOrders-v5.ps1

================================================================
## Update Pending Items (carry forward to v58)
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
21. **Run enrichment-fix-v57.sql** — product keywords, crackfiller
    300G SKU, M900 base keywords. Then re-enrich.
22. **M900 SKU entries** — need actual SAP material codes from stock
    file. 13 SKUs (BW + 90/92/93 BASE × 4 packs). Commented out in
    enrichment-fix-v57.sql with placeholders.
23. **M900 base detection** — "M900 92" picks up "90" from product
    name. Compound base keywords added (M900 90/92/93) as workaround.
    Proper fix: exclude product-name substrings from base regex. Low
    priority if compound keywords work.
24. **BW → 90 BASE fallback** — Products like 2KPU MATT/GLOSS have
    90 BASE = white but no BW SKU. When user says "2K Matt White",
    BW is detected but not in product's validBases → 0 candidates →
    partial. Engine needs: if BW detected but not in validBases, and
    product has 90 BASE, try 90 BASE as BW equivalent. Affects 2KPU
    MATT, 2KPU GLOSS, possibly others.
25. **Stainer pack extraction from rawText** — Lines like "Burnt
    senna 100gm X" have pack in rawText but parser sends pack=null.
    Either fix Parse-MailOrders-v5.ps1 to extract "100gm"→100, or
    add rawText pack extraction pass in enrichLine before step 2.
26. **BLK/BLK1 tinter vs stainer** — "Blk" pack=null defaults to
    1L → stainer BLACK has no 1L SKU, tinter BLK has 1L. When pack
    is 1L, prefer tinter BLK over stainer BLACK. Engine heuristic
    needed.
27. **DIY Spray products** — Not in mo_sku_lookup at all. "DIY
    Spray Phiroza/smoke grey/Dark Brown/Silver" all pack=400.
    Either add DIY Spray SKUs from stock file or accept as
    permanently unmatched.
28. **Truncated material codes** — "320768" (DULUX WB CEMENT PRIMER
    partial material code IN32076823/71/81/82). Parser sends as text
    not __MATERIAL_CODE__. Could add prefix matching in enrichLine
    material code step.

================================================================
*Version: Phase 1 Go-Live . Schema v26.2 . Context v57 . April 2026*
================================================================
