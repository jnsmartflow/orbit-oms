# Sadolin / Woodcare Catalog Rebuild — 2026-06-04

**Status:** Shipped to live. Repo synced to live (verified 0 mismatches).
**Commits:** `311b2875` (rebuild) → `31c767a6` (base-shorten sync + pagination).
**Tables touched (live):** `mo_sku_lookup_v2` (stock), `mo_order_form_index_v2` (menu).
**Backups taken:** `mo_sku_lookup_v2_bak_20260604_sadolin`, `mo_order_form_index_v2_bak_20260604_sadolin` (pre-rebuild snapshot, 1527 / 400).

---

## Summary (plain English)

The old **WOODCARE** tile held 7 separate brand sub-families whose products were badly
wired — generic finish labels (GLOSS/MATT/SEALER) were pooled across brands and some
Gloss rows cross-linked into the Dulux enamel family. We rebuilt the whole range as a
single **SADOLIN** family with **6 finish tabs**, gave every product a brand-scoped name
so nothing pools or cross-links, added the water-based **Hydro PU** line (8 brand-new
SKUs), cleaned the labels, and fixed a handful of data bugs.

---

## What changed

### 1. Umbrella: WOODCARE → SADOLIN
- Tile slot 6 flipped from `type:"section"` (WOODCARE, 7 cards) to `type:"family"`,
  `familyName:"SADOLIN"`, label "SADOLIN" — opens straight into the family with 6 tabs.
- Search aliases added in `lib/place-order/keyword-family-map.ts`: `"sadolin"` → SADOLIN
  and `"woodcare"` → SADOLIN (both jump to the family).
- `FAMILY_TO_SECTION["SADOLIN"]="WOODCARE"`, `FAMILY_TO_SUBGROUP["SADOLIN"]="Sadolin"`.
  (Browse-view section header still reads "WOODCARE" — see Open Items.)

### 2. Brand-scoped products (the core fix)
Every product is now a distinct brand×finish join key (e.g. `2K PU GLOSS`, `LUXURIO MATT`,
`PU PRIME SEALER`, `HYDRO PU GLOSS`). This stops the old pooling and the enamel-GLOSS
cross-link. **31 distinct products, 154 SKUs.**

### 3. The 6 finish tabs (sequence + brand order)
Tabs: **Gloss · Matt · Sealer · Thinner · Lacquer / Varnish · Filler / Stain**
(row counts 44 / 44 / 30 / 14 / 13 / 8 by base-rows; 18 / 17 / 10 / 5 / 6 / 7 by product).
Brand order within each tab: **1K PU > 2K PU > Hydro PU > PU Prime > Luxurio > Melamine
> NC > Synthetic**; Filler before Stain.
- NC grab-bag split: pulled **1K PU Gloss** (3) and **Synthetic Varnish** (4) out of NC
  into their own product lines.

### 4. New product: Hydro PU (water-based) — 8 NEW SKUs inserted
Inserted into `mo_sku_lookup_v2` (0 pre-existing, confirmed absent from legacy + live):
- 5746640/641 — Hydro PU Sealer (Clear) 1L/4L
- 5746642/643 — Hydro PU Gloss (G80) 1L/4L
- 5746644/645 — Hydro PU Dead Matt (G10) 1L/4L
- 5746708/709 — Hydro PU Matt (G20) 1L/4L
All Interior Clear except the Clear sealer. Placed after 2K PU in the brand order.

### 5. Base values & display names
- **Base values are short:** `Int Clear` / `Ext Clear` (NOT "Interior/Exterior Clear").
  This is the actual stored `baseColour` value in **both** v2 tables.
- **Display names** are brand-leading with correct casing and gloss codes, e.g.
  `2K PU Gloss - Int Clear`, `PU Prime Gloss - 90 Base`, `Hydro PU Gloss (G80) - Int Clear`.
  (Earlier a casing artifact rendered "2K Pu" / "Pu Prime" — corrected to "2K PU" / "PU Prime".)
- **Search tokens keep BOTH forms** ("INT CLEAR" + "INTERIOR CLEAR", etc.) so typing
  either short or long still finds the row.

### 6. Grid / tile / search code
- `variant-grid.tsx`: when a tab (uiGroup) has **more than one distinct product**, the
  row label uses `displayName` (so stacked brands read "2K PU Gloss - 90 Base"). Single-
  product tabs (Promise, WS) keep the bare base label. `multiProductTab` computed over the
  **full** tab in `family-nav-with-tabs.tsx` (not the paginated slice).
- Aquatech (already multi-product, baseColour null) unchanged — it already fell back to displayName.

### 7. Pagination
- `variant-grid.tsx`: `VARIANT_GRID_PAGE_SIZE` 15 → **20**;
  `VARIANT_GRID_PAGINATION_THRESHOLD` 17 → **22** (page-size + 2 buffer so an 18-row tab
  isn't paginated and there are no 1-row trailing pages). GLOSS (38) still paginates.

---

## Data fixes applied (from the review CSV `note` column)
- `IN20109673`, `IN20109173`: unit L → ML (now 500ML).
- `IN35203203`: pack 1L → 1KG (Wood Filler Walnut).
- White 1KG duplicate: `IN35202003` kept primary, `IN35203003` set not-primary.
- 3L thinner (`IN35521429`) kept as a real 3L pack.
- **PU Prime 90-Base twin fix:** two SKUs (`5841327`, `5841500`) whose description read
  "BAS 90 WHT" (spaced) defaulted to base "Clear" and collided with the real Clear rows.
  Fix: when description-parse yields "Clear" but the DB `currentBaseColour` holds a real
  base, use the DB base → both corrected to "90 Base".

---

## Key technical learnings (durable)

### Mobile label gotcha — `app/order/page.tsx` `productLabel()`
Mobile builds each row as: show `displayName`, and **append `baseColour` only if the
uppercased displayName does NOT already contain the uppercased baseColour.**
```
if (!p.baseColour) return p.displayName;
if (p.displayName.toUpperCase().includes(p.baseColour.toUpperCase())) return p.displayName;
return `${p.displayName} — ${p.baseColour}`;
```
**Consequence:** if a displayName's base text differs from the stored `baseColour`
(e.g. displayName "…Ext Clear" but base "Exterior Clear"), mobile appends the long base →
visible duplicate "…Ext Clear — Exterior Clear". **Rule: keep the base text in displayName
byte-identical to `baseColour`.** Desktop never appends (multi-product tab shows displayName
only), so this bug is mobile-only and easy to miss on desktop.

### `baseColour` is the menu↔stock join key
Menu joins stock on `(product/subProduct, baseColour)`. Any change to a base **value**
must be applied to **both** `mo_sku_lookup_v2` and `mo_order_form_index_v2` together — if
only one side changes, the menu row hydrates 0 packs (dead row). The mail parser and
`taxonomy-mapping.ts` do **not** depend on these v2 base strings (parser reads legacy).

### Order emails carry the raw base value
The order-email builder writes the raw `baseColour` into the email body (mobile ~line 833
+ desktop equivalent). After shortening to "Int Clear"/"Ext Clear", emails read e.g.
"…2K PU GLOSS Int Clear". These feed the legacy mail parser (v2→email→legacy, Stage 3 not
cut over). **PENDING spot-check** (see Open Items).

### Seed mechanism (CSV-as-source, CLAUDE_PLACE_ORDER §14)
- Stock: `scripts/v2-sku-seed-from-legacy.ts` reads `docs/SKU/review/sadolin-review-final-20260604.csv`
  via `loadSadolinMap` (quote-aware CSV parse). CSV wins over NAME_OVERRIDES; sets
  `category="SADOLIN"`, `product=proposedProduct`, `baseColour=proposedBase`, `isPrimary`,
  pack/unit from the CSV display pack. New SKUs (the 8 Hydro) built in the Step-2f block.
- Menu: `scripts/_gen-sadolin-menu.ts` regenerates the SADOLIN rows in
  `taxonomy-preview.json` from the same CSV; `scripts/v2-catalog-seed-from-preview.ts`
  seeds the menu (one row per distinct product+base; `product=null` so the join falls back
  to the brand-scoped `subProduct`).
- **The CSV is the durable source.** Direct live SQL edits must be mirrored into the CSV
  (and JSON regenerated) or the next reseed reverts them.

---

## Execution notes
- Display-name and base-value changes were applied to **live via targeted SQL** (no
  catalog blink), then the repo (CSV + JSON + seed literal) was transformed to match and
  verified equal to live (0 mismatches) before commit — so a future reseed reproduces live.
- OneDrive can lock the CSV during writes (write landed on 3rd retry) — expected on the depot PC.

---

## Open items / follow-ups
1. **Email-parser spot-check (PENDING):** confirm the legacy parser reads an order email
   containing a 2K PU Int/Ext-Clear item now that the base text is short.
2. **"1K" search shows Epoxy Primer:** "Epoxy Primer (Sadolin)" is a separate PRIMER-family
   product (Sadolin Epoxy Insulator) that contains "1K" in its data, so the 2-char query
   "1K" matches it too. Not a rebuild regression. Optional: tighten short-query scoring.
3. **Browse-view section header** still reads "WOODCARE" (SADOLIN family sits inside it).
   Optional: rename the section to "SADOLIN" in `FAMILY_TO_SECTION` if a full umbrella
   rename is wanted.
4. **Epoxy Insulator** (Sadolin) is not folded into the SADOLIN family — it lives in PRIMER.
   Decide later whether to bring it in.
5. **Helper scripts** left untracked: `scripts/_analyze-sadolin-menu.ts`,
   `_gen-sadolin-menu.ts` (committed), `_transform-sadolin-csv.ts` (untracked).
6. **Working-tree dirt** (unrelated to this work): several modified `CLAUDE_*.md`, ROADMAP,
   xlsx deletions, older scripts — worth a separate cleanup pass.

---

## Consolidation target
- CLAUDE_PLACE_ORDER.md — SADOLIN family spec, the 6 tabs, brand-scoped products, the
  multi-product grid-label rule, pagination constants, the mobile `productLabel` gotcha.
- CLAUDE_CORE.md — schema note (SADOLIN category/family; short Int/Ext base values).
- ROADMAP.md — close out the Sadolin/Woodcare restructure line; carry the open items.
