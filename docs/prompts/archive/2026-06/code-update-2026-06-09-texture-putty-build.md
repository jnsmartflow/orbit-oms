# Code Update — Texture & Putty on tile 8 "Putty & Primer"

**Date:** 2026-06-09
**Commits:** `5310176e` (main build) · base-label fix · `0231c906` (Texture-first order)
**Branch:** main (pushed; Vercel auto-deploy)

---

## What changed

Putty + Texture folded into desktop tile 8, renamed **"Putty & Primer"**, as a third tab. Tile 8 now: **Primers | Distemper | Texture & Putty**. Both stay their own families in data — the tab is UI/nav grouping (familyNames precedent).

**Texture & Putty tab — 6 rows, in this order:**
1. Texture - 90 BASE (25 + 30 KG)
2. Texture - 94 BASE (25 KG)
3. Texture 2MM - 94 BASE (30 KG)
4. Texture 3MM - 92 BASE (30 KG)
5. Poly Putty (40 KG)
6. Acrylic Putty (1 / 5 / 20 KG)

Desktop KG columns: 1KG · 5KG · 20KG · 25KG·bag · 30KG·bag · 40KG·bag.

### Decisions baked in
- **Polyputty 40KG** had three duplicate primaries → kept **DN POLYPUTTY 40KG** (5578774) as the billing primary; demoted IP Duwel + DN Non-DTS to `isPrimary=false` (kept in DB).
- **Matt** (3 SKUs incl. the Stentex Black) → hidden: `isPrimary=false` **and no menu row**, so it's off the order form *and* off search, but stays in the DB.
- **Grain** → Texture 2MM and Texture 3MM are **separate products** (Texture / Texture 2MM / Texture 3MM), not grain-variants of one. "Rustic" dropped from the display, kept only as a search word.
- **3 new 30KG SKUs created** (5857610 / 5857611 / 5857612) via build-from-CSV — they didn't exist in legacy.

### Counts
Stock 1644 → 1647 (+3 new Texture). Menu 437 → 436. EXPECTED_TOTAL_NEW_ROWS 491 → 490.

### Files
- `scripts/v2-sku-seed-from-legacy.ts` — `loadTexturePuttyMap()`: CSV-authoritative re-key + dedup + Matt demote + build-from-CSV for the 3 new
- `docs/SKU/review/texture-putty-review.csv` — new, authoritative
- `docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json` — 6 tab rows, Matt menu rows deleted, product set, base baked into Texture displayNames
- `scripts/v2-catalog-seed-from-preview.ts` — CONFIRMED_SUBPRODUCT_MAP identity keys + §7.7 `uiGroup="Texture & Putty"` (PUTTY|TEXTURE) + EXPECTED 490
- `lib/place-order/keyword-family-map.ts` — putty/texture/rustic promotions; texture decoupled from WS
- `lib/place-order/quick-tiles-config.ts` — tile 8 "Putty & Primer", familyNames `["PRIMER","DISTEMPER","TEXTURE","PUTTY"]`
- `lib/place-order/pack-buckets.ts` — PUTTY/TEXTURE KG overrides + `bucketColumnsForRows`
- `app/(place-order)/place-order/components/variant-grid.tsx` — per-row-family bucket + cell placement

---

## Key learnings (reusable — several apply directly to VT Specialty next)

**1. Multi-family tab needed a per-row-family bucket resolver.**
The desktop grid assumed one family per tab (`activeFamily = products[0].family`), so a tab mixing two families mis-bucketed the second family's KG packs. Fix: added `bucketColumnsForRows(rows {packs, family})` that buckets each row by its OWN family and unions the columns; cell placement now uses `product.family`, not a single tab-family. Single-family tabs are byte-identical. **Any future mixed tab now works** (VT Specialty's 9 products will lean on this).

**2. Cross-family row order = `familyNames` sequence, NOT menu sortOrder.**
A combined tab builds rows via `families.flatMap(f => products.filter(p => p.family === f))`. So row order across families follows the tile's `familyNames` list; menu `sortOrder` only orders *within* a family. To put Texture before Putty, reorder `familyNames` (`TEXTURE` before `PUTTY`) — sortOrder can't do it.

**3. Desktop grid shows `displayName` only — bake the base in.**
The row label is the `displayName`; the base is not auto-appended on desktop (mobile shows `product — base`). So flat-list rows must carry the base in the displayName ("Texture - 90 BASE"), same as Distemper's "Magik - 90 Base". Two rows with the same displayName look identical otherwise.

**4. Grain-as-separate-product avoids the product+base collision.**
Two rows with the same product + same base collide (both grab both packs). Making each grain its own product (Texture 2MM / Texture 3MM) keeps them as distinct, non-colliding rows while displaying the grain.

**5. Hiding a product cleanly = demote stock + drop its menu rows.**
Matt: `isPrimary=false` (stock stays for SAP) **and** delete its menu rows (off the form and off search). Demote alone isn't enough — a menu row with searchTokens is still searchable.

**6. Waking the alias block = set `product = subProduct`.**
All the pending families had `product = NULL` on menu rows (aliases dormant). Adding identity keys to CONFIRMED_SUBPRODUCT_MAP sets product explicitly so the join is explicit and base-aliases can fire later. Do this as each family is touched.

**7. Build-from-CSV creates net-new SKUs.** The loader's create path adds SKUs absent from legacy straight from the CSV (product/base/pack/desc/isPrimary) — used for the 3 new 30KG Texture rows.

---

## Pending families (after this)

Done now: **Putty, Texture**. Remaining 6: **VT Specialty** (next), **Tile + Metallic**, **Lustre**, **Smoothover**, **Floor Plus**, plus the **PU Enamel alias** quick task.

Recommended next: **VT Specialty → tile 5 Velvet Touch** (9 products → per-product tabs + KG columns — directly reuses learnings 1, 3, 6).

## Deferred (final CORE pass)
Section relabels — Texture → UTILITY, plus the broader UTILITY/INTERIORS/EXTERIORS rationalisation — all done together at the end, not piecemeal.
