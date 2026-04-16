# Context Update v72 — Parser v6.5 + Enrichment carryProduct + Keyword Batches 3-4

## NEW/MODIFIED FILES

- `Parse-MailOrders-v6_5.ps1` — Parser v6.5.0. Multi-customer split, multi-delivery split, comma loop, digit-dash stainer guard, carryProduct hint field. Replaces v6.4 on depot PC.
- `lib/mail-orders/enrich.ts` — `enrichLine()` accepts `carryProduct` param (11th). Wrapper calls `enrichLineCore()`, retries with `${carryProduct} ${rawText}` when unmatched/partial.
- `app/api/mail-orders/ingest/route.ts` — Passes `line.carryProduct || null` to `enrichLine()`. Type includes `carryProduct?: string | null`.
- `app/api/mail-orders/debug-enrich/route.ts` — Accepts `?carryProduct=` query param, passes to `enrichLine()`, includes in response.

## BUSINESS RULES ADDED

**Parser v6.5 — 5 features:**

1. **Multi-pack comma loop (Item 3):** `do/while` loop replaces single-pass regex in P3. Fixes 3+ adjacent pack*qty groups: `Black 4*4 1*6 500*12 100*24` → 4 entries. Loop guard max 10 iterations.

2. **Digit-dash normalization with stainer guard (Item 4):** `(\d{1,3})-(\d{1,4})\s*$` → `$1*$2` at end of line. Skips when preceded by stainer code. 23 hardcoded stainer codes: NO, BU, RE, OR, XR, MA, GR, YE, XY, BLK, WHT, COB, COG, HEY, HER, FFR, OXR, WH, YOX, TBL, MAG, LFY, GRN. Fixes `Promise 2in1 primer 20-5` → `20*5`. Protects `NO 1-4` stainer format.

3. **carryProduct hint (Item 6):** Send-ToApi compares longest product keyword match vs longest base keyword match per line. If base keyword is longer (colour-only line like "Golden yellow"), sets `carryProduct` = last line that had a dominant product keyword (e.g. "Gloss Bw"). Parser sends `carryProduct` field on each line in API payload. Server enrichment retries with `${carryProduct} ${rawText}` when normal matching returns unmatched or partial.

4. **Multi-customer split (Item 1):** `Detect-SectionHeaders()` function. Two-pass: Pass 1 scans for numbered customer headers (`N.Customer Name`). If 2+ found → customer split mode. Each section POSTed as separate order with `bodyCustomerName`/`bodyCustomerCode`. entryId: `{original}__Sec{N}`.

5. **Multi-delivery split (Item 2):** Pass 2 (only if <2 customer headers) scans for delivery headers (line ends with "delivery"). If 2+ found → delivery split mode. Each section POSTed as separate bill with `deliveryRemarks`. entryId: `{original}__Bill{N}`. Rule: customer split > delivery split. An email is EITHER multi-customer OR multi-delivery, never both at top level.

**Detection safety rules:** Minimum 2 headers required. Product keyword in line → NOT a header (disqualified). Pack*qty in line → NOT a header. Numbered prefix always = customer type (overrides delivery keyword). Fallback = single order mode (zero changes to existing flow).

**carryProduct colour-only detection:** Compares `longestProdKwLen` vs `longestBaseKwLen`. `isColourOnly = (baseLen > prodLen) OR (prodLen == 0 AND baseLen > 0)`. This correctly handles `YELLOW` (6 chars, prod kw for FAST YELLOW) inside "Golden yellow" where `GOLDEN YELLOW` (13 chars) base keyword is longer → colour-only → carryProduct set.

**Keyword SQL Batch 3:** VT PG→PEARL GLO, WS BR/BW→PROTECT, PROMISE ENAMEL CLASSIC→PROMISE ENML, SUPWR CLEAN→SUPERCLEAN, BURN SENA→BURNT SIENNA, SOLVENT SATIN→SUPER SATIN, INTERIOR→PROMISE INTERIOR, YOX→YELLOW OXIDE. Base: SINGLE RED→SIGNAL RED, CLASSIC WHITE.

**Keyword SQL Batch 4:** HI SHEEN/HISHEEN→HISHEEN, VT CONCRETE FINISH, SB PRIMER→SB CEMENT PRIMER, PROMISE INT PRIMER→DUWEL INTERIOR ACRYLIC PRIMER, WS PRIME COAT→EXTERIOR ACRYLIC PRIMER, CRACK PASTE→CRACKFILLER, DUCO PU GLOSSY→DUCO PU CLEAR, SANDING SLR→NC SANDING SEALER. Base: MOHGNY→MAHOGANY, SINGAL RED→SIGNAL RED, GOLDEN DARK BROWN→DARK BROWN.

**Dangerous colour keywords removed:** GOLDEN BROWN, GOLDEN YELLOW, PHIROZA, DA GREY, SMOKE GREY, OXFORD BLUE, SAND STONE, SANDSTONE, SINGLE RED, SIGNAL RED, DARK BROWN — all deleted from `product=GLOSS`. Also deleted: GOLDEN YELLOW→FAST YELLOW, LEMON YELLOW→FAST YELLOW from mo_product_keywords. Colour-only lines are now handled by carryProduct hint, not product keywords.

**Script-scope variables (parser):** `$script:ProdKW` added alongside `$script:BaseKW`. Both set in Parse-EmailBody, used in Send-ToApi for carry-forward product detection.

## PENDING ITEMS

1. **Auto-split rawText preservation (Item 5)** — server-side. When auto-split divides order into A/B, lines from same `originalLineNumber` lose rawText. Needs Claude Code prompt to fix split algorithm. 2 lines affected per large order.
2. **VT Velvetino** — not in mo_sku_lookup. Cannot match until SKU data added.
3. **WS Metallic Silver/Gold** — not in mo_sku_lookup. Cannot match until SKU data added.
4. **SR Spray Paint** — SKUs exist but pack=400ML mismatch. Need packCode fix or pack expansion rule.
5. **PU Interior Glossy** — product doesn't exist in SKU table.
6. **Carry-forward base bleeding** — parser still appends stale carry base (e.g. "94") to unrelated products. Low priority — enrichment handles correctly via DIRECT/FIXED strategies.

## CHECKLIST UPDATES

- **Parser version:** v6.5.0. File: `Parse-MailOrders-v6_5.ps1`. Items 1-4+6 implemented. Stainer codes hardcoded in Normalize-Line.
- **carryProduct:** Parser sends `carryProduct` field per line. Server `enrichLine()` accepts as 11th param. `enrichLineCore()` is the private implementation. Debug: `?carryProduct=` param on debug-enrich endpoint.
- **Colour-only detection:** `longestBaseKwLen > longestProdKwLen` → colour-only → carryProduct set. Do NOT add colour names as product keywords — use carryProduct hint instead.
- **Multi-customer:** `Detect-SectionHeaders` two-pass. Customer headers (numbered prefix) take priority over delivery headers. entryId `__Sec{N}` for customer, `__Bill{N}` for delivery.
- **Digit-dash stainer guard:** 23 stainer codes hardcoded. If new stainer codes added, update the list in Normalize-Line.
- **Keyword deletions:** No colour names as product keywords for GLOSS. No GOLDEN YELLOW/LEMON YELLOW→FAST YELLOW. These cause false positives when carry-forward context is available.
