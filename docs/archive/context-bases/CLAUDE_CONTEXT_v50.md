# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v50.md fully before doing anything else."
# Version: Phase 1 Go-Live · Schema v25 · Context v50 · April 2026

---

## 1-41. [Unchanged from v38]

(All sections 1 through 41 remain unchanged — refer to v38 for full content)

---

## 42. Known Issues / Pending Fixes (UPDATED v50)

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
21. **Mail Order — Parser Unicode × fix pending** — `Parse-MailOrders-v4.ps1` needs `×` (U+00D7) added to all `[\*xx\/@\-]` separator regexes. ~30 unmatched lines affected. Manual edit, not in orbit-oms repo.
22. **Mail Order — FLEXIBLE COAT ADVANCE fallback** — bare "Aquatech Flexible 4*5" has no base → empty base fails. FLEXIBLE COAT only has ADVANCE/NEO bases. Need code fallback to try ADVANCE when empty base fails (same pattern as BW fallback). ~5 lines.
23. **Mail Order — Bare colour base matching** — "Dark brown 200*1" matches keyword DARK BROWN → GLOSS, but remaining text is empty → no base found. The keyword text itself IS the base colour. Need enrichLine() to also check keyword match as potential base. ~15 lines.
24. **Mail Order — Orphan variant lines** — 60 lines with bare "92", "90" etc. Parser carry-forward breaks when bill markers or unmatched remark lines reset LastProductBaseName. Parser improvement needed.
25. **Mail Order — 1KPU product unknown** — 11 lines. Need Deepanshu to confirm which Sadolin sub-product "1KPU" refers to.
26. **Mail Order — Remaining 360 unmatched** — breakdown: 114 partial (SKU combos missing), 246 unmatched (junk/orphans/unknown). ~60 fixable with more effort, ~300 true junk. Current rate: 97.2%.

---

## 43. Queued Features (UPDATED v50)

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
- ~~**Mail Order — Enrichment engine hardening**~~ — **DONE v50.** Match rate 85.4% → 97.2%. Candidate sorting, BW fallback, pack 1→2 fallback, keyword cleanup, SKU inserts. See §62.
- **Mail Order — Parser × fix** — Unicode multiplication sign in separator regex. ~30 lines. Manual PS1 edit.
- **Mail Order — Enrichment to 99%+** — FLEXIBLE COAT fallback, bare colour base matching, orphan variant parser fix, remaining partial SKU combos, 1KPU identification.
- **Mail Order — backfill-enrich endpoint cleanup** — `app/api/mail-orders/backfill-enrich/route.ts` is permanent (POST with HMAC). Temporary GET handler already removed.
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

## 57. Mail Order Pipeline (UPDATED v45 — unchanged in v50)

(Refer to v45 for full Mail Order Pipeline documentation including customer matching)

---

## 58. Universal Header System (NEW v46 — unchanged in v50)

(Refer to v46 for full Universal Header documentation)

---

## 59. Mail Order SKU Line Enrichment — Volume, Batch Copy, Auto-Split, Sort (NEW v47 — unchanged in v50)

(Refer to v47 for full §59 documentation)

---

## 60. Mail Order Parser v4 + Enrichment Keywords + Ship-To Override + Signal Badges (NEW v48 — unchanged in v50)

(Refer to v48 for full §60 documentation)

---

## 61. Mail Order — Sort Fix, Customer Extraction, Volume Fix, UI Layout, Keyword Cleanup (NEW v49 — unchanged in v50)

(Refer to v49 for full §61 documentation)

---

## 62. Mail Order Enrichment Hardening v50 (NEW — April 2026)

### Match Rate Improvement

| Metric | Before (v49) | After (v50) |
|--------|:---:|:---:|
| Match rate | 85.4% | 97.2% |
| Matched lines | 10,689 | 12,295 |
| Total lines | 12,516 | 12,655 |
| Lines fixed | — | 1,606 |

### Code Changes

**1. Candidate sorting (enrich.ts)**
After building candidates array in Step 3, sort by keyword length DESC:
```typescript
candidates.sort((a, b) => b.keyword.length - a.keyword.length);
```
Ensures longest (most specific) keyword match wins. Fixes all
substring collision ordering: ROOF/DUSTPROOF, SATIN/WB SATIN,
PROTECT/DAMP PROTECT 2IN1, GLOSS/2KPU GLOSS, etc.

**2. Brilliant White fallback (enrich.ts)**
In Step 4, after trying all bases including empty base, try
BRILLIANT WHITE as final fallback before partial match. Fixes
single-colour products where SOs skip the colour name.
Products fixed: PROMISE SMARTCHOICE INT/EXT, ROOF COAT,
DUWEL WOOD PRIMER, MAX BRILLIANT WHITE, OPQ 2K PU MATT/PRIMER.

**3. Pack 1→2 fallback (enrich.ts)**
When pack=1 lookup fails, also try pack=2. Fixes Sadolin products
where 2L is the smallest available pack but SOs write "1*6".
Products fixed: PU PRIME MATT, PU PRIME MATT CLEAR.

**4. Backfill endpoint (route.ts)**
`POST /api/mail-orders/backfill-enrich` — HMAC protected.
Loads all keyword/SKU data, re-enriches every mo_order_line,
only upgrades matchStatus. Batch processing (100 lines per batch).
maxDuration=300s for Vercel serverless.

### Keyword Changes

**Deleted (5 keywords):**
- WHITE → WHT (id=561) — hijacked MAX/WS Brilliant White contexts
- BLACK → BLACK stainer (id=486) — hijacked Gloss Black
- BLACK → BLK tinter (id=568) — same collision
- FAST → BLACK stainer (id=487) — FAST is brand, not always black
- BLK → BLACK stainer (id=489) — collided with BLK tinter

**Added (~80 keywords):** WS→PROTECT, MAX→MAX, TEXTURE→TEXTURE,
RUSTIC→TEXTURE, MULTI PURPOSE THINNER, POLLY PUTTY variants,
OIL PAINT→GLOSS, CRACK FILLER PASTE, tinter space variants
(NO 1, BU 1, XY 1, etc.), Sadolin typo variants, bare colour
names (DARK BROWN, SMOKE GREY, etc.), typo keywords (GLOOS,
SMACTCHOICE, WOODPRIMER, AQAUTECH, REDOIXDE, etc.), safe
replacements (STAINER WHITE, WHITE STAINER, STAINER BLK).

**Added 8 base keywords:** 90BASE through 98BASE (no-space variants).

### SKU Lookup Changes

**Added ~25 entries:**
- GLOSS 93 BASE: 1L (5867122), 4L (5867123), 20L (5867125)
- SUPER SATIN 93 BASE: 1L (5867118), 4L (5867119), 20L (5867121)
- SATIN STAY BRIGHT 93 BASE: 1L (5867126), 4L (5867127)
- MAX 90 BASE: 1L, 4L (new); 92 BASE: all 4 packs; 97 BASE: 20L
- PU PRIME MATT: 90 BASE 1L, 93 BASE 1L, CLEAR 1L
- TEXTURE 90 BASE 25kg (5953877), updated 94 BASE (5953878)
- VT CONCRETE FINISH: 5kg, 10kg, 15kg, 25kg
- RP LATEX 20L, CRACKFILLER 5MM 1KG, GLOSS SMOKE GREY 20L

**Corrected:** MAX 92 BASE pack 4↔10 were swapped in original CSV
(5948213=4L, 5948214=10L based on SAP descriptions).

### Collision Analysis

**Problem identified:** enrichLine() iterated candidates in DB
order, not by specificity. Short generic keywords (WHITE, BLACK,
ROOF, SATIN) could beat longer specific ones depending on array
position. Combined with duplicate keywords mapping to different
products (BLACK→BLACK stainer AND BLACK→BLK tinter), this caused
~53 wrong matches.

**Solution:** Three-part fix:
1. Sort candidates by keyword length DESC (code)
2. Delete dangerous generic keywords (SQL)
3. Add safe replacement keywords (SQL)

### Remaining Gap (360 lines = 2.8%)

- 114 partial: product found but SKU combo missing (wrong packs,
  parser base/pack confusion)
- 246 unmatched: orphan variants (60), junk/remarks/phones (120),
  parser garbage (30), unknown products (20), ambiguous codes (16)

### Files Modified in v50

- `lib/mail-orders/enrich.ts` — candidate sorting, BW fallback,
  pack 1→2 fallback
- `app/api/mail-orders/backfill-enrich/route.ts` — NEW endpoint

**SQL only (not in code):**
- 5 keyword DELETEs from mo_product_keywords
- ~80 keyword INSERTs into mo_product_keywords
- 8 base keyword INSERTs into mo_base_keywords
- ~25 SKU INSERTs into mo_sku_lookup
- 1 TEXTURE 94 BASE UPDATE in mo_sku_lookup
- 1 mo_orders matchedLines/totalLines sync UPDATE

---

## 55. Session Start Checklist (UPDATED v50)

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
13. **Mail Order enrichment:** Try-and-verify engine. ~865 product keywords, ~215 base keywords, ~1080 SKU lookup entries. Candidate sort by keyword length. BW fallback. Pack 1→2 fallback.
14. **Mail Order PowerShell:** `Parse-MailOrders-v4.ps1` → **v4.1.0** (× fix pending → v4.2.0). Parser location unchanged.
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
35. **Enrichment candidate sorting (v50):** candidates sorted by keyword length DESC before Step 4. Longest keyword wins. This makes ROOF safe (DUSTPROOF beats ROOF), SATIN safe (WB SATIN beats SATIN), PROTECT safe (DAMP PROTECT 2IN1 beats PROTECT).
36. **Brilliant White fallback (v50):** After all bases tried including empty, enrichLine tries BRILLIANT WHITE as final fallback. Fixes single-colour products (Smartchoice, Roof Coat, Wood Primer, MAX BW, OPQ 2K PU).
37. **Pack 1→2 fallback (v50):** When pack=1 lookup fails, tries pack=2. Fixes Sadolin products where 2L is smallest pack but SOs write pack=1.
38. **Deleted keywords (v50):** WHITE→WHT, BLACK→BLACK/BLK, FAST→BLACK, BLK→BLACK removed. These caused wrong matches (WHT hijacking MAX/WS Brilliant White contexts). Safe replacements added (STAINER WHITE, WHITE STAINER, etc.).
39. **Re-added keywords (v50):** WS→PROTECT (safe with sorting), MAX→MAX, TEXTURE→TEXTURE, RUSTIC→TEXTURE, WBC→INTERIOR WBC.
40. **Backfill endpoint (v50):** `POST /api/mail-orders/backfill-enrich` — HMAC protected. Re-enriches all existing mo_order_lines against current keyword/SKU tables. Only upgrades matchStatus (never downgrades). Also updates mo_orders matchedLines/totalLines counts.
41. **Order count sync SQL (v50):** After backfill, run:
    ```sql
    UPDATE mo_orders SET "matchedLines" = sub.matched, "totalLines" = sub.total
    FROM (SELECT "moOrderId", COUNT(*) as total,
    SUM(CASE WHEN "matchStatus"='matched' THEN 1 ELSE 0 END) as matched
    FROM mo_order_lines GROUP BY "moOrderId") sub
    WHERE mo_orders.id = sub."moOrderId"
    AND (mo_orders."matchedLines" != sub.matched OR mo_orders."totalLines" != sub.total);
    ```

---

*Version: Phase 1 Go-Live · Schema v25 · Context v50 · April 2026*
