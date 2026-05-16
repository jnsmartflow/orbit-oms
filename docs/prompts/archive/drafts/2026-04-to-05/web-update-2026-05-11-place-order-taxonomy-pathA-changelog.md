# Path A taxonomy cleanup — running change log
# /place-order family restructure · 2026-05-11
# Save to: docs/prompts/drafts/web-update-2026-05-11-place-order-taxonomy-pathA-changelog.md

---

## Purpose

This file logs every data-only SQL change made to `mo_order_form_index_v2` and `mo_sku_lookup_v2` during the May 2026 Path A taxonomy cleanup. Each family's `product` and `baseColour` columns are being repurposed to act as **bucket + variant** rather than **product + colour**.

This is technical debt by design. Stage E migration (already planned in `stage-b-design-2026-05-08.md` and `stage-c-design-2026-05-09.md`) will introduce a proper `subVariant TEXT NULL` column across `mo_sku_lookup_v2`, `mo_product_keywords`, and `mo_order_form_index_v2`, and reverse these changes.

When Stage E runs, this log is the reference: every row that has a non-colour value in `baseColour` today should be split into `baseColour = (real colour or NULL)` + `subVariant = (variant tag)`.

---

## Reasoning — why Path A

- Operator screen needed cleanup today (PRIMER, AQUATECH had cluttered tab strips with 14+ sub-products each, wrapping labels, redundant "PRIMER" suffix on every tab)
- Schema migration (Path B / Stage E) requires code change, Claude Code session, `tsc --noEmit`, deployment — too heavy for a single-session UI fix
- Pattern is mechanical and consistently applied → safe to reverse via SQL during Stage E
- All original product names preserved in `description` column → no information loss

---

## Pattern of change

For each family:
- **Catalog (`mo_order_form_index_v2`):** delete existing rows, insert new rows with `subProduct = bucket label`, `baseColour = variant tag`
- **SKU (`mo_sku_lookup_v2`):** UPDATE `product = bucket label`, UPDATE `baseColour = variant tag`
- **Untouched:** `description`, `material`, `packCode`, `category`, `paintType`, `materialType`, `piecesPerCarton`

---

## Stage E migration reversal hint

For each row logged below, the Stage E split is:
- `product` (new) ← the original product name (recoverable from `description` parse OR from old name column below)
- `subVariant` (new) ← the current `baseColour` value (the variant tag)
- `baseColour` (new) ← NULL or the real colour (from `description` parse where applicable)

Rows with `baseColour` already being a real colour (e.g. GLOSS COLOUR rows with BLACK / GOLDEN BROWN / etc., WOOD PRIMER's BRILLIANT WHITE / PINK, FLOOR PLUS's 93 BASE / BLACK / WHITE) **stay as-is** — those keep `baseColour` as colour, `subVariant` NULL.

---

# Changes log

## 1. GLOSS family — 2026-05-11

**Scope:** split single `subProduct = 'GLOSS'` with 38 baseColour rows into two sub-products `BASE` (7 rows) + `COLOUR` (32 rows). Demand-ranked top-15 sort for COLOUR.

### Catalog (`mo_order_form_index_v2`)
- Was: 38 rows with `family='GLOSS'`, `subProduct='GLOSS'`
- Now: 6 rows with `subProduct='BASE'` + 32 rows with `subProduct='COLOUR'`
- baseColour values **unchanged** (real colour values)

### SKU table (`mo_sku_lookup_v2`)
- Was: 238 rows with `product='GLOSS'`
- Now: ~50 rows with `product='BASE'` (BRILLIANT WHITE, 90 BASE, 92 BASE, 93 BASE, 93 BASE CLR, 94 BASE, GREEN BASE) + ~188 rows with `product='COLOUR'` (all named colours)
- baseColour values **unchanged**

### Stage E reversal
- All GLOSS rows: revert `product='BASE'` and `product='COLOUR'` back to `product='GLOSS'`. baseColour stays as-is. subVariant = NULL.
- Catalog: re-merge into 1 subProduct or design new structure per the family-redesign session.

### Notes
- 1 SKU with blank baseColour was caught up in the COLOUR sweep (acceptable).
- Top-15 ranking baked into sortOrder 101–115. Tail 17 at 201–217.

---

## 2. PRIMER family — 2026-05-11

**Scope:** consolidate 14 separate sub-products into 6 buckets (WOOD, METAL, CEMENT, ACRYLIC, ALKALI BLOC, PROMISE). Variant identity moves into `baseColour`. 2IN1 split into PROMISE 2IN1 vs PROMISE FREEDOM 2IN1 as separate rows.

### SKU table changes (`mo_sku_lookup_v2`)

| Old product | Old baseColour | New product | New baseColour |
|---|---|---|---|
| WOOD PRIMER | (any) | WOOD | (unchanged: BRILLIANT WHITE / PINK / NULL) |
| RED OXIDE METAL PRIMER | (blank) | METAL | RED OXIDE |
| ZINC YELLOW METAL PRIMER | (blank) | METAL | ZINC YELLOW |
| EPOXY PRIMER | (blank) | METAL | EPOXY |
| QUICK DRYING PRIMER | (blank) | METAL | ROM |
| CEMENT PRIMER WB | (blank) | CEMENT | WB |
| CEMENT PRIMER SB | (blank) | CEMENT | SB |
| INTERIOR ACRYLIC PRIMER | (blank) | ACRYLIC | INTERIOR |
| EXTERIOR ACRYLIC PRIMER | (blank) | ACRYLIC | EXTERIOR |
| ALKALI BLOC PRIMER | (blank) | ALKALI BLOC | (NULL) |
| PROMISE PRIMER | (blank) | PROMISE | PROMISE |
| 2IN1 INTERIOR-EXTERIOR PRIMER (5994750 family) | (blank) | PROMISE | PROMISE 2IN1 |
| 2IN1 INTERIOR-EXTERIOR PRIMER (9055675 family) | (blank) | PROMISE | PROMISE FREEDOM 2IN1 |
| SMARTCHOICE INT PRIMER | (blank) | PROMISE | SMARTCHOICE INT |
| SMARTCHOICE EXT PRIMER | (blank) | PROMISE | SMARTCHOICE EXT |

### Catalog (`mo_order_form_index_v2`)
- Was: 14 sub-product rows for PRIMER family
- Now: 17 rows across 6 sub-products: WOOD(3), METAL(4), CEMENT(2), ACRYLIC(2), ALKALI BLOC(1), PROMISE(5)

### Stage E reversal
- All bucket renames need to reverse to original product names
- Material code prefixes uniquely identify originals: `5994750-*` series → PROMISE 2IN1; `9055675-*` series → PROMISE FREEDOM 2IN1
- Synthetic-suffix duplicates (e.g. `5994750-PROMISE_INTERIOR`) need to be considered: they got the same baseColour assignment

### Notes
- Tab labels intentionally short (no "PRIMER" suffix) to fit single-line layout
- PROMISE bucket name does NOT collide with PROMISE family elsewhere because no other family has `product='PROMISE'` as a bare value

---

## 3. AQUATECH family — 2026-05-11 ✓ DONE

**Scope:** consolidate 14 separate sub-products into 4 buckets (PREP, BASECOAT, TOPCOAT, ADDITIVES). Based on Dulux Aquatech official workflow categorization (waterproofing system stages).

**Final state:** PREP (7 SKUs / 4 variants), BASECOAT (23 / 6), TOPCOAT (18 / 6), ADDITIVES (13 / 4). Total 61 SKUs across 20 catalog rows.

**FLOOR PLUS removed mid-migration:** initially included but reverted. FLOOR PLUS has its own category in `mo_sku_lookup_v2.category = 'FLOOR PLUS'` with 24 SKUs across multiple colour variants — it's an exterior floor coating product family in its own right, not an AQUATECH product. Handled separately as its own family.

**Final placement adjustment (after operator review):**
- DAMP PROTECT BASECOAT moved to TOPCOAT (alongside DAMP PROTECT 2IN1) — both DAMP products live in one tab per operator preference
- ROOF COAT (3 colours) moved to TOPCOAT
- BASECOAT tab now contains only INTERIOR BASECOAT, INTERIOR BASECOAT NEW, IBC ADVANCE, FBC ADVANCE, FBC NEO
- Row labels renamed for clarity: WBC → INTERIOR BASECOAT, WBC NEW → INTERIOR BASECOAT NEW, ROOF WHITE → ROOF COAT WHITE, etc.

### SKU table changes (`mo_sku_lookup_v2`)

| Old product | Old baseColour | New product | New baseColour |
|---|---|---|---|
| CRACKFILLER | 5MM | PREP | 5MM |
| CRACKFILLER | 10MM | PREP | 10MM |
| CRACKFILLER | 20MM | PREP | 20MM |
| PRETREATMENT COAT | (blank) | PREP | PRETREATMENT |
| DAMP PROTECT BASECOAT | BASECOAT | BASECOAT | DAMP PROTECT |
| IBC ADVANCE | ADVANCE | BASECOAT | IBC ADVANCE |
| INTERIOR WBC (mat 5688020/21/22/23) | (blank) | BASECOAT | WBC |
| INTERIOR WBC NEW (mat 9075187/89/90/91) | (blank) | BASECOAT | WBC NEW |
| FLEXIBLE COAT | ADVANCE | BASECOAT | FBC ADVANCE |
| FLEXIBLE COAT | NEO | BASECOAT | FBC NEO |
| DAMP PROTECT 2IN1 | (blank) | TOPCOAT | DAMP PROTECT 2IN1 |
| ROOF COAT | BRILLIANT WHITE | TOPCOAT | ROOF WHITE |
| ROOF COAT | GREY | TOPCOAT | ROOF GREY |
| ROOF COAT | TERACOTTA | TOPCOAT | ROOF TERACOTTA |
| PU COAT | (blank) | TOPCOAT | PU COAT |
| WATERBLOCK 2K | (blank) | TOPCOAT | WATERBLOCK 2K |
| FLOOR PLUS | 93 BASE | TOPCOAT | FLOOR PLUS 93 BASE |
| FLOOR PLUS | BLACK | TOPCOAT | FLOOR PLUS BLACK |
| FLOOR PLUS | BRILLIANT WHITE | TOPCOAT | FLOOR PLUS WHITE |
| FLOOR PLUS | PO RED | TOPCOAT | FLOOR PLUS PO RED |
| WRP | (blank) | ADDITIVES | WRP |
| RP LATEX | (blank) | ADDITIVES | RP LATEX |
| LW PLUS | (blank) | ADDITIVES | LW PLUS |
| TG COTTON WOOL | (blank) | ADDITIVES | TG COTTON WOOL |

### Catalog (`mo_order_form_index_v2`)
- Was: 14 sub-product rows for AQUATECH family
- Now: 24 rows across 4 sub-products: PREP(4), BASECOAT(6), TOPCOAT(10), ADDITIVES(4)

### Stage E reversal
- FLOOR PLUS may be moved out of AQUATECH family entirely during Stage F (currently flagged for EXTERIORS section move). Reversal should restore product=FLOOR PLUS, family pivot pending.
- INTERIOR WBC split by material code: 5688020 series = WBC (old), 9075187 series = WBC NEW

### Notes
- Dulux official site categorizes by workflow (prep → basecoat → topcoat → additive). This taxonomy mirrors their consumer-facing structure.
- BASECOAT and TOPCOAT buckets each carry 6 and 10 variants respectively — densest tabs across all families.

---

## 4. STAINER family — 2026-05-11 ✓ DONE

**Scope:** rename 4 of 5 sub-products for cleaner shorter labels, reorder tabs, sort rows A-Z within each tab.

### Tab renames (`mo_sku_lookup_v2.product` + `mo_order_form_index_v2.subProduct`)

| Old name | New name | SKU count |
|---|---|---|
| UNIVERSAL STAINER | UNIVERSAL STAINER (unchanged) | 30 |
| MACHINE TINTER | MACHINE STAINER | 9 |
| ACOTONE TINTER | ACOTONE | 14 |
| PU STAINER | PU | 12 |
| HP COLORANT | HP | 3 |

### Tab order (sortOrder ranges)
- UNIVERSAL STAINER → 101–130
- MACHINE STAINER → 201–209
- ACOTONE → 301–314
- PU → 401–412
- HP → 501–503

### Row sort
Within each tab: rows now sorted alphabetically by `baseColour`.

### Stage E reversal
- product renames are mechanical: ACOTONE → ACOTONE TINTER, PU → PU STAINER, HP → HP COLORANT, MACHINE STAINER → MACHINE TINTER
- baseColour values unchanged
- searchTokens now include old names + GVA / DPP-GVA aliases for resilience

### Notes
- PU and GVA are the same product line (GVA is the material code prefix, PU STAINER was the category name). Operators should be able to search either.
- HP COLORANT has only 1 baseColour variant currently, but tab kept for future expansion.

---

## 5. WS family (was MAX) — 2026-05-11 ✓ DONE

**Scope:** consolidate 4 separate WS exterior product lines (MAX, PROTECT, POWERFLEXX, RAINPROOF) plus PROTECT DUSTPROOF variant into ONE WS family with 5 sub-product tabs.

### Tab structure

| Tab | Source product | SKU count |
|---|---|---|
| MAX | MAX | 73 |
| PROTECT | PROTECT | 50 + 1 (WS CLEAR added) |
| DUSTPROOF | PROTECT DUSTPROOF → DUSTPROOF | 19 |
| RAINPROOF | RAINPROOF | 40 |
| POWERFLEXX | POWERFLEXX | 62 |

Total: 245 SKUs across 55 catalog rows under family.

### SKU table renames (`mo_sku_lookup_v2.product`)
- PROTECT DUSTPROOF → DUSTPROOF
- IN46900081 (DN WS CLEAR 20LT): product=PROTECT DUSTPROOF → product=PROTECT, baseColour="" → baseColour="WS CLEAR" (it's a WS Clear standalone, was orphaned in DUSTPROOF)

### Catalog (`mo_order_form_index_v2`)
- 55 fresh INSERT rows under family='WS'
- sortOrder ranges: MAX 1001+, PROTECT 2001+, DUSTPROOF 3001+, RAINPROOF 4001+, POWERFLEXX 5001+
- Within each tab: rows A-Z by baseColour, with BRILLIANT WHITE pinned to top

### KNOWN WART — family name vs speed-dial tile
- DB family is currently named **`MAX`** (was renamed WS → MAX as a temporary unblock)
- Reason: the /place-order speed-dial tile is hardcoded as "MAX" in frontend code (`/api/place-order/quick-tiles` or similar). Renaming the DB family to WS broke the tile click → nothing happened.
- Real fix: code change in the speed-dial tile config to say "WS" instead of "MAX"
- Until that code change ships, the DB carries the workaround: family='MAX' in catalog, but actually contains 5 product tabs (MAX/PROTECT/DUSTPROOF/RAINPROOF/POWERFLEXX). Operator-visible: tile says MAX, expands to all 5.

### Stage E reversal
- Renaming `family` back to WS: trivial UPDATE once speed-dial code updates
- product=DUSTPROOF reverts to product=PROTECT DUSTPROOF
- IN46900081 stays as PROTECT/WS CLEAR (data cleanup, not undone)

### Notes
- DEFERRED: PROTECT bucket structure review (see Deferred section below). Operators want RAINPROOF under PROTECT brand-grouping; current design keeps RAINPROOF as its own tab.
- RUSTIC + MATT (TEXTURE family) not included — deferred to later session
- 5 sub-products is the biggest single family so far (next-biggest: STAINER at 5 tabs, AQUATECH at 4)

---

## 6. (Reserved for next family)

---

## Deferred review items

These are conscious decisions to address later, not bugs:

- **PROTECT bucket structure** — currently 3 products grouped (PROTECT, PROTECT DUSTPROOF, RAINPROOF). Dulux brands them as `DN WS PROTECT RAINPROOF`, suggesting RAINPROOF is part of the PROTECT product line. Operator preference was to lump RAINPROOF under PROTECT tab for now and review the bucket later. Open questions:
  - Should RAINPROOF be its own tab on the WS family?
  - Should PROTECT and PROTECT DUSTPROOF be separate tabs or one with variant rows?
  - Are there other PROTECT variants in the catalog not yet surfaced?
- **TEXTURE family (RUSTIC + MATT)** — pulled out of WS scope for now. Address as a separate family later.
- **MAX family** — to be retired and consumed by the new WS family. Migration also defers section reassignment until taxonomy redesign session.

---

# Decision points for Stage E session

When Stage E runs, these locks need re-verification or new design decisions:

1. **Is `subVariant` per-family-locked?** Should each family have its own subVariant vocabulary, or is there a global vocabulary? (Stage B implied per-family.)
2. **FLOOR PLUS family pivot** — move from AQUATECH to EXTERIORS as flagged in May 11 session-end?
3. **Search keyword pipeline (`mo_product_keywords`)** — needs new keyword rows pointing to new bucket names (PREP, BASECOAT, TOPCOAT, ADDITIVES, METAL, CEMENT, etc.). Mail order parser currently still works because legacy `mo_sku_lookup` (not v2) drives enrichment. Stage F will need to align this.
4. **GLOSS top-15 ranking** — baked in for now, demand re-rank cycle TBD.

---

*Path A change log · keep appending as families get processed · feeds Stage E migration design*
