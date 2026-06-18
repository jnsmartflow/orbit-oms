# code-update · 2026-06-02 · PU Enamel split out of Gloss + Gloss cleanup

**Repo destination:** `docs/prompts/drafts/code-update-2026-06-02-gloss-pu-enamel-split.md`
**Fold into:** `CLAUDE_PLACE_ORDER.md` at next consolidation.
**Status:** Live in production. Commit `230d5bdf` (8 files, 466 ins / 48 del), pushed to `origin/main`.

---

## Goal

Two outcomes in one pass on the GLOSS family:
1. **Clean GLOSS** — 30 "DN PU Enamel" SKUs were mis-filed under family/product GLOSS. Move them out.
2. **Create PU ENAMEL** — a brand-new standalone product (it had no home before; existed only as the 30 mis-mapped rows).

Plus three GLOSS tidy-ups: Green Base reclassification, a pack-completeness sort, and a carton-size correction.

---

## Locked decisions

- **PU ENAMEL = its own standalone family in the ENAMELS section** (peer to Gloss / Satin / Promise Enamel). NOT clubbed under a parent. Rationale: the ENAMELS *section* is already the grouping for all enamel products; enamels are distinct products, not finish-grades of one line (unlike WS, where Max/Dustproof/etc. nest under one WS family). No new nesting level.
- **No speed-dial tile** for PU Enamel — reachable by search only (desktop + mobile). The 9 quick tiles (`QUICK_TILES_V1`) are a curated list and stay unchanged.
- **Subgroup = "PU ENAMEL"** (the product's own branding — the tin reads "PU ENAMEL"). Note GLOSS itself uses a *descriptive* subgroup label "Enamel finish (gloss)"; PU Enamel deliberately uses its product name instead. Owner's call. The subgroup field is mandatory (step-5 validation has no fallback).
- **Green Base → COLOUR** — GREEN BASE was sitting in the GLOSS BASE sub-product; moved to COLOUR.
- **Carton/box size by pack (global):** 100ML=24, 200ML=12, 500ML=12, 1L=6, 4L=4, 10L=1 (drum), 20L=1 (drum). Only delta from before was **100ML 12 → 24**.
- **Sort = most-packs-first** per sub-product: primary key = number of packs (desc); tiebreak = BASE: Brilliant White → numbered bases ascending; COLOUR: alphabetical.
- **PU Enamel search keywords:** PU ENAMEL, POLYURETHANE ENAMEL, PU ENML, DN PU ENAMEL, PU.

---

## What shipped

**PU ENAMEL family (new):** 9 menu rows in ENAMELS — bases Brilliant White / 90 / 92 / 94; colours Black / Dark Brown / Golden Brown / Phiroza / Smoke Grey. 30 stock SKUs (all 30 primary). displayName "PU Enamel".

**GLOSS after:** 177 stock rows (171 primary / 6 hidden); 38 menu rows (BASE 5, COLOUR 33). Green Base now under COLOUR. Resorted most-packs-first.

**Edge cases handled:**
- **5 alternate Brilliant White SKUs** (`IN28401073/072/071/082/081`) had no SAP/legacy source → built-from-CSV (copying packCode/unit/category from the primary `IN28301…` BW sibling), `isPrimary=false`. Same path WS used for no-legacy KEEP alternates.
- **`IN28009081`** reclassified GLOSS / 90 BASE / non-primary (was mislabeled Brilliant White).
- **`5802250`** (PU Enamel White Base 1L) was hidden *only because* it duplicated the Gloss BW 1L while inside Gloss; after the split it's the sole White Base 1L in PU Enamel → un-hidden, primary.

---

## Files changed (commit 230d5bdf)

- `lib/place-order/pack.ts` — `PACK_STEP_MAP["100ML"]` 12→24, `PACK_CONTAINER_MAP["100ML"]` "box 12"→"box 24". **Global** (also changes Stainer ×10 + Wood Stain ×1, which carry 100ML).
- `lib/place-order/base-aliases.ts` — added "PU ENAMEL" block (90→White, 92→Intermediate, 94→Accent). **Dormant** today (see learnings).
- `lib/mail-orders/taxonomy-mapping.ts` — FAMILY_BASE += PU ENAMEL:850; SUB_PRODUCT_ORDER, SEARCH_TOKENS, DISPLAY_LABEL += PU ENAMEL. No new `mapLegacyToNew` branch (split is override-driven).
- `scripts/v2-catalog-seed-from-preview.ts` — EXPECTED_TOTAL_NEW_ROWS 522→531; FAMILY_TO_SECTION += PU ENAMEL:ENAMELS; FAMILY_TO_SUBGROUP += PU ENAMEL:"PU ENAMEL"; §7.7 PU ENAMEL uiGroup BASE/COLOUR branch + GREEN BASE→COLOUR exception in the GLOSS branch.
- `scripts/v2-sku-seed-from-legacy.ts` — SET_FALSE += IN28009081; built the 5 BW alternates; DRY_RUN TARGETS += GLOSS, PU ENAMEL.
- `scripts/data/sku-name-overrides.json` — 30 PU materials → product/category "PU ENAMEL"; IN28009081 → GLOSS / 90 BASE.
- `docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json` — new PU ENAMEL family (9 rows) + recomputed GLOSS sortOrder; summary.totalNewRows +9.
- `docs/SKU/review/gloss-pu-enamel-review.csv` — the marked-up review (decision record).

---

## Reseed (live, verified)

**Backups (before any write):**
- `mo_sku_lookup_v2_bak_20260602_glosspu` — 1625 rows
- `mo_order_form_index_v2_bak_20260602_glosspu` — 392 rows

**Stock:** 1625 → 1630 (+5 built alternates). PU ENAMEL 0→30 (30 primary). GLOSS 202→177 (171 pri / 6 hid). WS families steady.
**Menu:** 392 → 401 (+9 PU rows). Families 29 → 30.

**Verification — all PASS:** PU Enamel 9 rows hydrate (no ZERO-packs); section/subgroup/displayName/searchTokens correct; not in any tile; GLOSS BASE order BrWhite→90→92→93→94; COLOUR order Black→Dark Brown→Golden Brown→Smoke Grey… (packs-desc→alpha); Green Base under COLOUR; 5 alternates + IN28009081 correct; 0 of the 30 still under GLOSS.

---

## Learnings

- **Carton/box size is a SHARED per-pack constant** (`pack.ts` PACK_STEP_MAP + PACK_CONTAINER_MAP), keyed by pack label — NOT per-SKU. Changing one label ripples to every product with that pack. Always check the blast radius before editing it.
- **`piecesPerCarton` exists on `mo_sku_lookup_v2` but is dead weight** — neither data route selects it and the grid never reads it. If product cartons ever diverge for the same pack, the fix is to make the grid/routes prefer `piecesPerCarton` with the constant as fallback (parked — "Option B").
- **Enamels are each their own family** in the ENAMELS section; the section is the grouping. Only WS uses the nested-sub-product pattern (one branded line with finish grades).
- **A product mis-filed inside another** (PU Enamel inside Gloss) = same shape as the WS PROTECT mess. When the mis-mapped SKUs share the same legacy (category, product) key as the genuine ones, the taxonomy mapper **cannot** split them by rule — the split must be **per-material NAME_OVERRIDES** keyed on SAP codes (the review CSV's "Map To" column). Override-driven, like Hi-Sheen.
- **New standalone family creation checklist:** preview-JSON family rows + FAMILY_TO_SECTION + FAMILY_TO_SUBGROUP (mandatory) + §7.7 uiGroup branch + base-aliases + taxonomy-mapping consistency.
- **`sortOrder` is hand-assigned in `taxonomy-preview.json`**; a pack-completeness sort = recompute those numbers (the seed just sorts by them).
- **base-aliases is dormant for product=null families** (Gloss, PU Enamel). Both §7.8 token-baking and `getBaseAliasDisplay` are keyed on a non-null `product`; these families join stock via `subProduct`, so the alias block documents intent but doesn't render. Harmless.

---

## Suggested CLAUDE_PLACE_ORDER.md edits (at consolidation)

- ENAMELS section families are now **4**: Gloss, Satin, Promise Enamel, **PU Enamel**.
- Document carton/box size as a **shared `pack.ts` constant** (not per-SKU), and note the dormant `piecesPerCarton` column + Option B.
- Note PU Enamel is **search-only** (no speed-dial; `QUICK_TILES_V1` is a curated 9).
- Note the **most-packs-first sort** convention for BASE/COLOUR sub-products.

## Parked

- **Per-SKU carton (Option B):** make grid/routes read `piecesPerCarton` with map fallback — only if cartons ever diverge by product for the same pack.
- **base-aliases PU ENAMEL block** stays dormant until/unless PU Enamel gets a non-null product join-key.
