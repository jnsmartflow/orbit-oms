# code-update · 2026-06-15 · Email names + cart fix · Spray Paint family · M900 Gloss

**Repo destination:** `docs/prompts/drafts/code-update-2026-06-15-emailnames-cart-spraypaint-m900.md`
**Fold into:** `CLAUDE_PLACE_ORDER.md` (catalog + email/cart sections) at next consolidation.
**Status:** All live. Commits `5fe4f696` → `3c6f3b4d` → `a788aa9a` → `53f1a212`.
**Live totals after all work:** stock **1680** · menu **454** (was 1657 / 431).

Four pieces this session: (1) two email-line name fixes + an email-builder consolidation, (2) a desktop cart blank-name fix, (3) the Spray Paint family (new, via legacy un-hide), (4) M900 Gloss (folded into GLOSS as a 3rd tab, via legacy un-hide). 3 + 4 surfaced the **map-vs-inject** rule that now governs any "add SKUs" request.

---

## 1. Email-line names — Duwel + Interior WBC (commit `5fe4f696`)

### A. Duwel — de-double (email-only)
Email read `ACRYLIC DISTEMPER DUWEL ACRYLIC DISTEMPER 5KG*1`. Cause: `baseColour` itself carries the full product name (`DUWEL ACRYLIC DISTEMPER`, a Path-A repurpose) and `subProduct` repeats `ACRYLIC DISTEMPER`, so `emailLineLabel` printed `name + " " + baseColour`. A product rename can't fix it (the base still doubles). Fix = a **general de-double** in `emailLineLabel`:

```
let name = product ?? subProduct;
if (baseColour && name && baseColour.toUpperCase().includes(name.toUpperCase())) return baseColour;
```

(kept the existing PROMISE PRIMER special-case ahead of it). Result: `DUWEL ACRYLIC DISTEMPER`. Dry-run proved exactly **one** other line moves under the rule (Duwel) — nothing else.

### B. Interior WBC — product rename (+ pack-join repair)
Email read `INTERIOR BASECOAT` where the grid reads "Interior WBC" — `INTERIOR BASECOAT` was the stored product/subProduct, "Interior WBC" the displayName. Fix = **rename product `INTERIOR BASECOAT` → `INTERIOR WBC`** (the real SAP name; grid labels by displayName so it's grid-safe):
- stock seed `AQUATECH_PRODUCT_RENAME { "INTERIOR BASECOAT": "INTERIOR WBC" }`, gated `category === "AQUATECH"`.
- menu `CONFIRMED_SUBPRODUCT_MAP["INTERIOR BASECOAT"] = "INTERIOR WBC"` + a scoped loop aligning the menu `baseColour → ""` to match stock.
- **Bonus:** menu product was `null` → packs didn't join (a §19 no-packs oddball). Setting product on both sides + aligning baseColour repaired the join — 4 packs (1/4/10/20L) now hydrate.

### Consolidation — the real root cause
There are **THREE** email builders, not one: `lib/place-order/email.ts` (desktop, calls `emailLineLabel`), `app/po/po-page.tsx` (inline), `app/order/page.tsx` (inline). Only desktop called the helper, so a name fix could silently diverge. Routed `/po`'s name through `emailLineLabel(product ?? null, baseColour, subProduct)` (pack suffix untouched); `/order` already did. **All three now single-source the name.** Dry-run confirmed byte-parity across the three for every sampled product.

---

## 2. Desktop cart — blank-name fix (commit `3c6f3b4d`)

After Interior WBC's `baseColour` was set to `""` (for the join), the **desktop** cart (`app/(place-order)/place-order/components/cart-panel.tsx`) rendered a blank line — it labels by `baseColour`, and `"" ?? …` returns `""` (empty string isn't nullish). Fix:

```
name = baseColour (if non-empty) else emailLineLabel(product ?? null, baseColour, subProduct)
```

**Blast radius was a bonus fix:** 31 cart rows that were *already* silently blank now show their name — **25 Tools** (rollers/brushes), **3 VT Specialty** (Concrete Finish / Marble / Clear Coat), **2 Putty** (Polyputty / Acrylic Putty), **1 Interior WBC**. Plus one cosmetic: **Smoothover** (the only null-base row) flips `Smoothover` → `SMOOTHOVER` (now matches its email line). The **/po cart was never affected** — it labels by `displayName`, so it never blanked.

> Note: `cart-panel.tsx` was clean (no multi-bill WIP in it after all — that WIP lives elsewhere; locate via `git status` when needed).

---

## 3. Spray Paint — new search-only family (commit `a788aa9a`)

11 SKUs (`5695743`–`5695754`, no `5695753`), single 400 ml aerosol can. Stock 1657→1668, menu 431→442.

### Map, not inject — the pre-check fork
The mandatory pre-check found all 11 already in **legacy** (category `SPRAY PAINT`, product `SR SPRAY PAINT`, packCode `400`/ML), **hidden** by `HIDDEN_BY_CATEGORY`. So this is the **MAP** branch (un-hide + translate), not a hand-written CSV injection (which would have duplicated data and drifted, e.g. `White` vs the real base `BRILLIANT WHITE`).

### Mechanism
- `taxonomy-mapping.ts` — removed `SPRAY PAINT` from `HIDDEN_BY_CATEGORY` + added `cat === "SPRAY PAINT"` branch in `mapLegacyToNew` → `row("SPRAY PAINT","SPRAY PAINT", bc)`. Un-hiding **alone** falls through to `null` — the branch is required.
- Stock writes `product = newRow.subProduct` (@799) and `category = newRow.family` (@789) → **product re-key `SR SPRAY PAINT → SPRAY PAINT` is automatic**; legacy bases kept (BRILLIANT WHITE, BLACK, PHIROZA, GOLDEN YELLOW, SIGNAL RED, DEEP ORANGE, GOLDEN BROWN, DARK BROWN, GOLD, SILVER, BUS GREEN). No `sku-name-overrides.json`.
- Menu — 11 rows hand-added to `newRowsByFamily["SPRAY PAINT"]` in `taxonomy-preview.json`; `FAMILY_TO_SECTION = UTILITY`, `FAMILY_TO_SUBGROUP = "Spray paints"`, flat uiGroup, displayName "Spray Paint - {Colour}", searchTokens `spray, spray paint, aerosol, 400ml, {colour}`; `CONFIRMED_SUBPRODUCT_MAP` identity.
- **New pack 400 ml:** `pack-buckets.ts` disjoint `400ML` bucket (`PACK_TO_BUCKET["400ML"]="400ML"`, identity → no stray hint) + `bucketDisplayLabel "400 ml"`; `pack.ts` `formatPack(400,ML)→"400 ml"` + `PACK_CONTAINER_MAP["400ML"]="can"`; **step falls out as 1** (not in `PACK_STEP_MAP` → default). No `packStepForPack` edit.
- Search-only (no tile; grid locked at 9): `keyword-family-map.ts` `spray / spray paint / aerosol → SPRAY PAINT`. Colours (`phiroza`, `signal red`) resolve via the token ranker, not family promotion.
- 7 files.

### Parser
`HIDDEN_BY_CATEGORY` is consumed **only by seed-time scripts**, NOT the live v1 PowerShell parser. So un-hiding gets Spray Paint into the **order form + outgoing email** only; the v1 parser still emits `SR SPRAY PAINT` for inbound dealer emails. The legacy `mo_sku_lookup` re-key is a **separate DB task**, deferred to the parser→v2 move. /order + /po (≈99% path) are unaffected.

> Mobile shows the pack as `400 ml` (no `· can` sub-label — desktop-only, buckets are desktop). Small render follow-up if wanted (the two-mobile-pages pattern).

---

## 4. M900 Gloss — flat 3rd tab folded into GLOSS (commit `53f1a212`)

12 SKUs, 20L only — **4 bases** (Brilliant White, 90, 92, 94) + **8 colours** (Black, Golden Yellow, Golden Brown, Dark Brown, Bus Green, Smoke Grey, Phiroza Blue, PO Red). Stock 1668→1680, menu 442→454.

**Structure:** the GLOSS family carries two products — regular **Gloss** (UI-split into BASE + COLOUR tabs because of many variants) and **M900 Gloss** (a single flat tab). So GLOSS now shows **3 tabs: BASE · COLOUR · M900**. Same family-of-products shape as WS (Max/Powerflexx/Protect).

### Same map pattern (fold into existing family)
Pre-check: `M900` is in `HIDDEN_BY_CATEGORY` (category string `"M900"`), **exactly 12** legacy rows (product `M900`, packCode `20`/LT), no other packs/colours/twins. Un-hide surfaces exactly those 12.

- `taxonomy-mapping.ts` — remove `M900` from `HIDDEN_BY_CATEGORY` + `cat === "M900"` branch → `row("GLOSS","M900 GLOSS", bc)`. Stock writes **family GLOSS** (not legacy "M900") + **product `M900 GLOSS`**.
- Menu — 12 rows into the **GLOSS** block (`newRowsByFamily["GLOSS"]`), subProduct `M900 GLOSS`, displayName "M900 Gloss - {Colour}", searchTokens `m900`. A **new sub-case in the §7.7 GLOSS uiGroup branch**: `if (subProduct === "M900 GLOSS") uiGroup = "M900"` (before the BASE/COLOUR split) → single flat tab, no sub-split. sortOrder `860-871` (> COLOUR's max 852 ⇒ M900 is the 3rd tab), in order BW·90·92·94·then the 8 colours. `CONFIRMED_SUBPRODUCT_MAP["M900 GLOSS"]` identity → menu joins stock on product+baseColour.
- **No section/subgroup, no new pack** — GLOSS already mapped; 20L reuses the existing bucket (`20/LT → 20L`, container "drum"). **5 files** (vs Spray Paint's 7).
- **No collision:** `(GLOSS, M900 GLOSS, BLACK)` ≠ `(GLOSS, GLOSS, BLACK)` — the product/subProduct key separates same-named bases. Regular GLOSS (product=null, subProduct "GLOSS", BASE/COLOUR) untouched.
- Search `m900 / m900 gloss → GLOSS` (promotes the family carrying the M900 tab) + `m900` in each row's tokens.
- Parser: same deferral as Spray Paint. `HIDDEN_BY_CATEGORY` now `{AUTO, DUCO, TOOLS}`.

---

## Key learnings / patterns

- **MAP-vs-INJECT pre-check is mandatory before adding any SKUs.** If the materials exist in legacy (even hidden) → **MAP** (un-hide + `mapLegacyToNew` branch); never hand-write a CSV (duplicates SAP data and drifts, e.g. `White` vs `BRILLIANT WHITE`). Only if genuinely absent from legacy → inject (the Tools pattern). Spray Paint and M900 were both already-hidden-in-legacy, caught by the pre-check.
- **`mapLegacyToNew` branch is the un-hide hook:** `cat === "X" → row(family, subProduct, baseColour)`. Stock writes `category = family` (@789) and `product = subProduct` (@799), so the branch sets the v2 family + does the product re-key for free, keeping the legacy base. Removing from `HIDDEN_BY_CATEGORY` **without** the branch falls through to `null` (same lesson twice).
- **`HIDDEN_BY_CATEGORY` is seed-only.** It's imported only by seed/preview scripts — NOT the live v1 PowerShell parser. Un-hiding affects the v2 catalog + outgoing email, not parser matching. Making the parser agree = a separate legacy `mo_sku_lookup` re-key (DB write), which rides along with the parser→v2 migration.
- **New family vs fold-into-existing:** new family (Spray Paint) needs `FAMILY_TO_SECTION` + `FAMILY_TO_SUBGROUP` (hard gate) and any new pack bucket → 7 files. Folding a sub-product into an existing family (M900 into GLOSS) skips both → 5 files; the tab comes from a `subProduct → uiGroup` sub-case in the family's §7.7 branch, placed by sortOrder.
- **One product key separates same-named variants in a family.** M900 GLOSS vs GLOSS both have a "Black"/"Brilliant White"; the product/subProduct in the join key keeps them distinct with zero collision.
- **The email name is now single-source.** Three builders existed (`email.ts`, `/po`, `/order`); all three route the name through `emailLineLabel`. Future email-name fixes happen once. The **general de-double** (`baseColour` ⊇ name → return base) is the structural fix for product-name-in-base doubling.
- **Desktop cart labels by `baseColour`; empty string blanks it** (not nullish). Fallback to `emailLineLabel`. /po cart labels by `displayName` and never blanks — different surfaces, different name source.
- **New pack step defaults to 1** when the pack label isn't in `PACK_STEP_MAP` — no `packStepForPack` edit needed for per-unit packs (400 ml can).

---

## Suggested CLAUDE_PLACE_ORDER.md edits (at consolidation)

- Document the **MAP-vs-INJECT pre-check** as the first step of any "add SKUs" task, and the `mapLegacyToNew` un-hide-branch mechanism (`cat→row(family,subProduct,base)`; stock product=subProduct, category=family).
- Note **`HIDDEN_BY_CATEGORY` is seed-only**; current contents `{AUTO, DUCO, TOOLS}`; parser re-key is a separate legacy-DB task.
- New family **SPRAY PAINT** · UTILITY · "Spray paints" · search-only · 11 colours · 400 ml can (new `400ML` bucket, container "can").
- GLOSS family now carries **two products** (Gloss + M900 Gloss) → **3 tabs: BASE · COLOUR · M900**. M900 GLOSS = 12 SKUs, 20L, flat tab.
- The **email name single-source** (`emailLineLabel` across all 3 builders) + the **general de-double** rule.
- Desktop cart empty-`baseColour` → `emailLineLabel` fallback.

## Parked
- Mobile "· can" sub-label for Spray Paint (desktop-only today).
- Legacy `mo_sku_lookup` re-key for SPRAY PAINT + M900 (parser consistency) — folds into parser→v2.
