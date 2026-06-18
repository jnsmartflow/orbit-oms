# Code Update — Velvet Touch: Family Merge + "VT" Search Fix

**Date:** 2026-06-03
**Status:** Both live and verified.
**Save to:** `docs/prompts/drafts/code-update-2026-06-03-velvet-touch-merge-and-search.md`

Two related changes in one session. Part 2 was *caused* by Part 1 (dropping the "VT " prefix from display names removed Velvet Touch's search-prefix match), so they are documented together.

---

## PART 1 — Merge VT Glo + VT Eterna into one VELVET TOUCH family

**Commit:** `feat(catalog): merge VT Glo + VT Eterna into one VELVET TOUCH family — 6 tabs (Pearl/Platinum/Diamond/Eterna/Eterna Matt/Eterna Hi-Sheen); desktop tab labels drop "Glo", search keeps full names; speed-dial #5 renamed VT GLO -> VELVET TOUCH; menu-only reseed, stock untouched`

### What changed

Two families — `VT GLO` (27 rows: PEARL GLO, PLATINUM GLO, DIAMOND GLO) and `VT ETERNA` (12 rows: ETERNA, ETERNA MATT, ETERNA HI-SHEEN), both INTERIORS / subgroup `VT (Dulux Velvet Touch)` — merged into **one family `VELVET TOUCH`** (39 rows), same section + subgroup, **6 sub-product tabs**.

**Menu-only. No SKU changes.** `subProduct` (the stock join key) is unchanged on every row; `product` stays NULL (join via the `product ?? subProduct` fallback); `sortOrder` unchanged. Bases/packs came along automatically.

### Final structure (6 tabs)

| Desktop tab (`uiGroup`) | Search label (`displayName`) | Join key (`subProduct`, kept) | rows |
|---|---|---|---|
| Pearl | Pearl Glo | PEARL GLO | 11 |
| Platinum | Platinum Glo | PLATINUM GLO | 8 |
| Diamond | Diamond Glo | DIAMOND GLO | 8 |
| Eterna | Eterna | ETERNA | 5 |
| Eterna Matt | Eterna Matt | ETERNA MATT | 3 |
| Eterna Hi-Sheen | Eterna Hi-Sheen | ETERNA HI-SHEEN | 4 |

`ETERNA BASECOAT` kept in the §7.7 branch + mapping for completeness (0 rows → renders no tab).

### Display / search split (the key design point)

- **Desktop tab label** = `uiGroup` → "Pearl" / "Platinum" / "Diamond" (dropped "GLO"); Eterna trio kept as-is.
- **Search result label** = `displayName` → "Pearl Glo" etc. (dropped the old "VT " prefix, since the family already reads Velvet Touch).
- **`searchTokens`** kept all originals + appended `VELVET TOUCH` / `VT` to all 6 → still findable by "pearl", "pearl glo", "pearl glow", "velvet touch", "vt".

### Speed dial

`lib/place-order/quick-tiles-config.ts` slot 5:
`{ position:5, type:"family", label:"VELVET TOUCH", parentLabel:"INTERIORS", familyName:"VELVET TOUCH" }` (was VT GLO).

### Mechanism

- New §7.7 `uiGroup` branch for `r.family === "VELVET TOUCH"` mapping `subProduct → uiGroup`.
- `FAMILY_TO_SECTION` / `FAMILY_TO_SUBGROUP`: removed VT GLO + VT ETERNA, added `VELVET TOUCH → INTERIORS` / `"VT (Dulux Velvet Touch)"`.
- `mobileFamily` resolves to "VELVET TOUCH" (non-Promise → `mobileFamily = family`; no code change needed).

### Files touched

- `docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json` — 39 rows relabeled to VELVET TOUCH, `displayName` de-prefixed, `searchTokens` +VELVET TOUCH/VT (subProduct / baseColour / sortOrder untouched).
- `scripts/v2-catalog-seed-from-preview.ts` — FAMILY_TO_SECTION / FAMILY_TO_SUBGROUP merged; new §7.7 VELVET_TOUCH uiGroup branch.
- `lib/place-order/quick-tiles-config.ts` — slot 5 → VELVET TOUCH.
- `lib/mail-orders/taxonomy-mapping.ts` — FAMILY_BASE, SUB_PRODUCT_ORDER, ALIASES (re-keyed), DISPLAY_LABEL, mapLegacyToNew all merged to VELVET TOUCH.

### Backups & reseed

- Backup: `mo_order_form_index_v2_bak_20260603_velvettouch` — 400 rows.
- Menu wipe-reseed: 400 → 400 (unchanged). **Stock untouched** (no SKU change).
- **Verify — all PASS:** VELVET TOUCH = 39 rows / 6 tabs; `VT GLO` + `VT ETERNA` = 0 rows; total menu rows 400; family count 28 → 27 (−1); stock joins intact (PEARL GLO 42 · PLATINUM 23 · DIAMOND 29 · ETERNA 21 · ETERNA MATT 9 · ETERNA HI-SHEEN 16), 0 tabs with no stock; other families steady (GLOSS 38 · PROMISE 44).
- Live UI confirmed: tile 5 = VELVET TOUCH, all 6 tabs render, packs present.

---

## PART 2 — "VT" search fix (Pearl Glo on top; mobile == desktop)

**Commit:** `fix(search): "VT"/"VELVET TOUCH" promote the Velvet Touch family (Pearl Glo first) on both mobile + desktop via a shared keyword-family map; promote-only (Specialty still listed below); add sortOrder to both search payloads`

### Problem

Typing **"VT"** on `/order` (and `/place-order`) ranked **VT SPECIALTY** products (VT Clear Coat, VT Marble, VT Fin, VT Metallics) on top — not Velvet Touch / Pearl Glo. "VELVET TOUCH" already worked.

### Root cause

- `rankProductsForQuery` haystack = `searchTokens + displayName + baseColour`. Scoring: prefix-of-haystack **100**, word-boundary **20**, substring **5**; bonuses SUBPRODUCT_PREFIX **+30**, TOKEN_START **+40**, MULTI **+50**.
- VT SPECIALTY names literally start with "VT" → prefix 100 + subProduct-prefix 30 + TOKEN_START 40 ≈ **170**.
- VELVET TOUCH / Pearl Glo: `displayName` is "Pearl Glo" (no "VT"); "vt" only sits mid-haystack via tokens → word 20 + TOKEN_START 40 ≈ **60**.
- So Specialty won 170 vs 60. **Dropping "VT" from `displayName` in Part 1 is exactly what removed Velvet Touch's prefix match.**
- `family` was **not** in the haystack and there was **no family-default concept**. "velvet touch" only worked by accident (Specialty lacks those tokens → AND-filtered out).
- Mobile (`mobile-search.ts`) and desktop (`queries.ts`) are **two separate ranking implementations** with the same structural flaw.

### Fix — shared keyword → family-default map (a §19 precursor)

- **NEW `lib/place-order/keyword-family-map.ts`** (pure TS, no React — mirrors `base-aliases.ts`): `KEYWORD_FAMILY` map (`"vt"` / `"velvet touch"` / `"velvettouch"` → `"VELVET TOUCH"`) + `getFamilyDefaultForQuery(query)` which normalizes (trim → lowercase → collapse spaces) and returns the family **only on a whole-query match** (so "vt pearl" / "vt clear coat" fall through to normal ranking), else null.
- Both rankers call it after normal ranking. On a family hit F: result = **[F-rows sorted by `sortOrder` asc] ++ [all other matches in normal order]**, sliced to limit. **Promote-only — nothing dropped.** Null → ranking unchanged.
- One shared module imported by both surfaces → **guarantees mobile == desktop**.

### Payload change

Both search payloads (`api/order/data`, `api/place-order/data`) and both `Product` types lacked `sortOrder` (the index queries already selected it for `orderBy` but never exposed it). Added `sortOrder` to both payloads + both `Product` types so the ranker can order the promoted family by tab order.

### Files touched

- **NEW** `lib/place-order/keyword-family-map.ts`
- `lib/place-order/mobile-search.ts` (hook)
- `lib/place-order/queries.ts` (hook; tracks min `sortOrder` per aggregation entry for the F-group order)
- `api/order/data/route.ts` (+ sortOrder)
- `api/place-order/data/route.ts` (+ sortOrder)
- `Product` type(s) (+ sortOrder)

### Behaviour decision (signed off)

Bare **"VT"** = **Velvet Touch first, Specialty below** (promote-only, not hidden).

### Verify — all PASS, mobile == desktop on "VT"

| Query | Result |
|---|---|
| VT | Pearl Glo rank 1; VELVET TOUCH ranks 1–39; VT SPECIALTY from rank 40; same sequence both surfaces, nothing hidden |
| VELVET TOUCH | Velvet Touch first (reinforced) |
| VT PEARL | keyword default NOT triggered; normal ranking (Pearl results) |
| PEARL | unchanged |
| CLEAR COAT | VT Specialty Clear Coat still rank 1 (reachable) |

`tsc --noEmit` clean.

---

## Key learnings / patterns

- **JSON family-keys ≠ post-transform DB families.** The seed JSON shows 31 family keys but the live DB shows fewer because the §7.7 grouping collapses the 5 WS families (MAX / POWERFLEXX / PROTECT / RAINPROOF / HISHEEN → WS) at insert time. Use the post-transform count (28 → 27 = −1) as the real check, not the JSON key count.
- **`taxonomy-preview.json` is hand-maintained** (no in-repo generator) — edit it directly, but keep `taxonomy-mapping.ts` in step (the two must agree on the rows) so a future regen can't reintroduce drift.
- **A new family name MUST be in BOTH `FAMILY_TO_SECTION` and `FAMILY_TO_SUBGROUP`** or the LIVE insert crashes mid-seed — and the dry-run does NOT catch it (§18). Treat "present in both maps" as a hard pre-check.
- **Display changes can silently change search** — `displayName` is in the search haystack, so dropping a brand prefix demoted that product. Watch search ranking after any display rename.
- **Two parallel search impls must share one pure-TS module** (`keyword-family-map.ts`, like `base-aliases.ts`) for any cross-surface behaviour, or they drift.
- **Keyword → family-default map** is the clean promote-only lever for brand acronyms; whole-query match keeps it from hijacking compound queries. It is the first brick of the §19 universal keyword layer (same map will later teach "WS", "promise", etc., and feed the parser).
- **Stale doc reference:** §17 file map lists `lib/place-order/search.ts` which DOES NOT EXIST — only `mobile-search.ts`.

---

## Open follow-ups

1. **Rare Pearl Copper/Green sortOrder quirk** — under "VT", the two "Rare Pearl Copper/Green" Pearl-Glo variants sort after Diamond (their `sortOrder` ~2150 > Platinum 2110 / Diamond 2120). Pre-existing data artifact, not from these changes. Optional: fix those rows' `sortOrder` in `taxonomy-preview.json` so they group with the rest of Pearl Glo.
2. **Stale `familiesProduced = 34`** field in the `taxonomy-preview.json` summary — pre-existing, not asserted, harmless. Optional cleanup.
3. **§17 file-map correction** — remove `lib/place-order/search.ts` (does not exist).
4. **VT Specialty fold (parked)** — adding Specialty as a 7th Velvet Touch tab. Review CSV generated: `docs/SKU/review/velvet-touch-specialty-review-20260603.csv` (9 sub-products / 15 menu rows / 29 SKUs, all plain no-base products, 1 orphan). Awaiting markup + help.
5. **Fold this doc** into `CLAUDE_PLACE_ORDER.md` (family/section/tab + speed-dial + keyword-family map §19) and `CLAUDE_UI.md` (Velvet Touch 6-tab card) at next consolidation, then archive.
