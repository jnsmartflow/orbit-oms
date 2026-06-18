# Code Update — Promise Pack/Search Cleanup + Enamel Fold-in

**Date:** 2026-06-03
**Commits:**
- `fix(catalog): clean Promise pack pollution + fix search ranking`
- `feat(catalog): fold Promise Enamel into PROMISE family + reorder tabs + tile move`

**Status:** Live and verified on both /order (mobile) and /place-order (desktop).

Two related follow-ups to the Promise consolidation (same day). Part A fixed pack pollution and search ranking; Part B folded Promise Enamel into the Promise family.

---

## PART A — Pack pollution + search ranking

### The problem (live)
After the consolidation, Promise bases showed junk packs and the wrong search order:
- **Duplicate pack columns** (two "1L", two "20L" on some bases).
- **Alien pack sizes** — 925ML / 3.7L / 9.25L / 18.5L on 93 BASE.
- **Stray 22L** on a few bases.
- **Search inversion** — "promise int" / "promise ext" ranked Promise SmartChoice *above* Promise Interior/Exterior.

### Root causes (diagnosed, not guessed)
1. **Duplicate columns = unit-string mismatch.** Some rows stored unit `L`, some `LT`. The route deduped packs on raw `packCode|unit`, so `1|L` and `1|LT` rendered as two "1L" columns.
2. **Alien sizes = raw SAP fill volumes.** 93 BASE carried its true fills (0.925 / 3.7 / 9.25 / 18.5 L) instead of nominal pack sizes. The build-from-CSV alternates were innocent (they copied the on-screen "1L/4L" labels).
3. **Stray 22L = mis-keyed packCode** (22 where the SKU is a 20L) plus an umbrella `-PROMISE` dupe that escaped the consolidation's removal.
4. **Search inversion = a scorer bonus, not sortOrder.** A `+50` multi-token base bonus fired when a query word was a **substring** of `baseColour`. SmartChoice's baseColour is literally "Interior", so "int" matched and SmartChoice scored 240 vs Promise Interior's 190. sortOrder was only a tiebreak, so it never got a say.

### Fixes shipped
**Data / seed (`v2-sku-seed-from-legacy.ts`), applied by reseed:**
- Normalize unit **`LT` → `L`** at insert (catalog-wide, 1000 rows; display identical — `formatPack`/`packToMl` treat them the same).
- Normalize **fractional litre packCodes → nominal** (0.925→1, 3.7→4, 9.25→10, 18.5→20) for Promise litre rows, via the CSV "Pack (on screen)" mapping. The DB row now stores the nominal value (14 rows; 93 BASE across all 4 emulsion tabs).
- **22 → 20 as a RULE** for Promise litre rows (replaced the original hand-list of materials — caught 5883496, 5883497, *and* 5882951 which the list missed). Kg "22KG" distemper untouched.
- **Drop the umbrella `-PROMISE` stock dupes** entirely (185 rows). Promise is one family now and doesn't need cross-list dupes.

**Routes (`app/api/place-order/data/route.ts`, `app/api/order/data/route.ts`) — guard-rail:**
- Pack-hydration dedup key changed from `packCode|unit` to the **rendered display size** (`formatPack(packCode, unit)`), so a future L/LT slip can't double a column. (Desktop isPrimary filtering left as-is per §22.)

**Search (`mobile-search.ts`, `queries.ts`) — option B, surgical:**
- **Exempt variant-qualifier tabs** (SmartChoice, Primer) from the colour-base bonus, via the existing `isVariantQualifierTab` helper. Their baseColour is a product/variant label ("Interior", "Int Primer"…), not a colour, so it must not earn a colour match. *No catalog-wide change* — every other family's base scoring is untouched. This fixes both the fragment case ("promise int") and the full-word case ("promise interior"); the emulsions tie at 190 and win on the (already-correct) lower sortOrder.

### Reseed / verify
- Stock **1712 → 1527** (185 umbrella dropped). A follow-up stock reseed stayed 1527→1527 (just 22→20 on the stray).
- 93 BASE now 1/4/10/20 across all 4 emulsion tabs; no 22L anywhere in Promise litre; units all "L"; focus bases render exactly {1L, 4L, 10L, 20L}.
- Other families steady (GLOSS 177, PU ENAMEL 30, Satin 47/24, WS 62/62).
- Search verified: "promise int/ext" *and* "promise interior/exterior" lead with the emulsion; "smart"/"smartchoice" unchanged; "max accent" / "gloss white" byte-identical.

**Backups:** `mo_sku_lookup_v2_bak_20260603_promise_packfix` (1712), `mo_order_form_index_v2_bak_20260603_promise_packfix` (400).

---

## PART B — Promise Enamel fold-in

### What changed
Promise Enamel (previously its own family in the ENAMELS section, with its own tile) was **folded into the PROMISE family as the first tab, "Enamels."** The product/material key **stays `PROMISE ENAMEL`** (so nothing downstream — mail parser, reports — breaks); only its *family* changed to `PROMISE` and the tab label shows "Enamels."

### Final structure — 7 tabs, reordered + short labels
| order | tab label | product (join key) | sortOrder |
|---|---|---|---|
| 1 | Enamels | PROMISE ENAMEL | 2400 |
| 2 | Int | PROMISE INTERIOR | 2420 |
| 3 | Ext | PROMISE EXTERIOR | 2440 |
| 4 | Sheen Int | PROMISE SHEEN INTERIOR | 2460 |
| 5 | Sheen Ext | PROMISE SHEEN EXTERIOR | 2480 |
| 6 | SmartChoice | PROMISE SMARTCHOICE | 2500 |
| 7 | Primer | PROMISE PRIMER | 2520 |

- Tab labels shortened (Interior→Int, Exterior→Ext, Sheen Interior→Sheen Int, Sheen Exterior→Sheen Ext). **Display names in search stay full** ("Promise Enamel — Golden Brown", "Promise Interior — 90 Base").
- All 7 tabs **renumbered** because SmartChoice (2500) had collided with the old standalone Enamel block (2500–2599).
- Emulsion sortOrders stay below SmartChoice/Primer → the Part-A search fix still holds.
- Enamel behaves like an emulsion/colour tab (real colours, NOT a variant-qualifier) — it earns the colour bonus and is unaffected by the SmartChoice search exemption. Its tab renders its own **500ML** column; the desktop grid computes pack columns per active tab, so no cross-contamination.

### Speed-dial
`quick-tiles-config.ts` — final dial:
`1 Gloss · 2 Satin · 3 Promise · 4 WS · 5 VT Glo · 6 Woodcare · 7 Stainer · 8 Primer · 9 Aquatech`
- Promise (family tile) moved **slot 6 → slot 3**.
- **Woodcare restored to slot 6** (it was pulled off-dial in the consolidation).
- Standalone Promise Enamel tile **removed** (Enamel now reached via the Promise card's first tab).

### Reseed / verify — MENU ONLY
- **Stock NOT touched** — Enamel stock product key was already `PROMISE ENAMEL`, which matches the new tab's join key. (Stock category kept as `PROMISE ENAMEL` too — preserves the "still an enamel in the DB" identity.)
- Menu reseed **400 → 400** (10 Enamel rows re-tagged from family `PROMISE ENAMEL` → `PROMISE`, not added/removed).
- Verified: PROMISE = 7 tabs in target order, Enamels first with 500ML; no menu rows left with family `PROMISE ENAMEL`; other families steady.

**Backup:** `mo_order_form_index_v2_bak_20260603_enamelfold` (400).

### Files touched (Part B)
`docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json` (re-tag + renumber + delete old block) · `scripts/v2-catalog-seed-from-preview.ts` (PROMISE_TABS, PROMISE_TAB_LABEL short labels, CONFIRMED_SUBPRODUCT_MAP) · `lib/mail-orders/taxonomy-mapping.ts` (SUB_PRODUCT_ORDER) · `lib/place-order/quick-tiles-config.ts` (tile swap).

---

## Reusable patterns / learnings

- **Diagnose the real behaviour, don't reason about it.** The "search is already correct" claim was disproved by actually running the ranker — there was a scorer overriding sortOrder. Always run the function against live data when behaviour contradicts the model.
- **Variant-qualifier tabs are not colours.** SmartChoice/Primer carry use-case labels in `baseColour`; the scorer must exempt them (`isVariantQualifierTab`) from any colour-match bonus. Surgical exemption beats a catalog-wide whole-word change (zero blast radius on other families).
- **Unit normalization belongs at seed insert** (`LT`→`L`), and **pack dedup should key on the rendered display size**, not raw `packCode|unit` — both prevent duplicate columns class-wide.
- **22→20 (and fractional→nominal) as a RULE, not a material list.** A hand-list missed an un-sampled base (5882951). Scan all distinct packCodes before reseeding, then fix the class.
- **Absorbing a sibling family as a tab is menu-only** when the stock product key is unchanged: re-tag rows in the preview JSON to the new family, add the tab to `PROMISE_TABS` / `PROMISE_TAB_LABEL` / `CONFIRMED_SUBPRODUCT_MAP`, renumber sortOrders, dissolve the old family block. No stock reseed needed.
- **Keep the product key stable across regroupings** — change family/label only, so downstream consumers (parser, reports) don't break.

---

## Open follow-ups

1. **Pre-existing, non-Promise (flagged during the menu reseed, not introduced here):**
   - AQUATECH / Topcoat final-set collision — 3 roof-coat rows with null baseColour.
   - A 2in1 Int-Ext primer (non-Promise family) with a missing `uiGroup` tab label.
   Both predate this work and don't block; worth a glance at a future cleanup.
2. **Fold both Parts into canonical files** at next consolidation: `CLAUDE_PLACE_ORDER.md` (7-tab Promise family, speed-dial, fold-in mechanism) and `CLAUDE_UI.md` (pack dedup, single-base display, search scorer exemption). Then archive.
