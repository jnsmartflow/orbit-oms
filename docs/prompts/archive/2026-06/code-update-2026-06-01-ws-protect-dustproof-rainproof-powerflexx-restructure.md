# code-update · 2026-06-01 · WS Protect / Dustproof / Rainproof / Powerflexx restructure

**Repo destination:** `docs/prompts/drafts/code-update-2026-06-01-ws-protect-restructure.md`
**Fold into:** `CLAUDE_PLACE_ORDER.md` (new sections noted below) at next consolidation.
**Status:** Live in production. Product #2 of the per-product WS rollout (after WS Max).

---

## Goal

Replace the broken WS "Protect" structure with the correct 4 sub-products, drive the new SKU set from the reviewer's CSVs, extend the base-alias system, and add custom search ranking.

**Before:** WS family had 5 sub-products — Max, Powerflexx, **Protect (wrong)**, Dustproof, Rainproof.
**After:** 4 sub-products — **Max · Powerflexx · Protect Dustproof · Protect Rainproof.** The standalone "WS PROTECT" was a mis-mapped duplicate and was eliminated.

---

## 1. New durable mechanism — CSV-as-source SKU converter

The 3 reviewer CSVs (`docs/SKU/review/ws-Protect_Dustproof-review.csv`, `ws-Protect_Rainproof-review.csv`, `ws-PowerFlexx-review.csv`) are now the **single editable source** for those three products' SKUs. `scripts/v2-sku-seed-from-legacy.ts` reads them each reseed, layered on the legacy→v2 translation.

Converter rules:
- **Key on `material`** (unique). `baseColour / packCode / unit / description / category` come from legacy (authoritative) — this auto-collapses multi-base collision listings and makes CSV base typos (e.g. "Brillant White") irrelevant.
- **isPrimary** = Yes if the material is marked KEEP anywhere in its CSV, else No.
- **Build-from-CSV** for KEEP materials with no legacy source: the row is constructed from CSV fields (packCode/unit/category copied from a same-product/same-pack sibling). HIDE-no-legacy materials stay absent.
- Touches only the 3 target products (+ the WS PROTECT removal + explicit exclusions). All other products untouched.

This pattern is the template for every future WS product: edit the CSV → rehearse → reseed.

---

## 2. SKU changes (`mo_sku_lookup_v2`, total 1631 → 1625)

- **Wrong "WS PROTECT" (32 rows) eliminated:** 13 folded into Dustproof as HIDE; **10 named colours re-homed** to Dustproof as KEEP (Electric Blue Plus, PO Red, Signal Red, Sunrise, Teracotta — 1L+4L each); **9 base/oxide leftovers dropped**.
- **IN76109271** (stray Powerflexx SKU not in CSV) dropped.
- **4 new KEEP SKUs built from CSV** (no legacy source): Dustproof 99 Base 1L+4L, Dustproof 95 Base 1L, Powerflexx 93 Base 4L.
- **4 misfiled 93 Base SKUs rescued:** 5880417/5880390/5880393/5880392 were filed in the CSV as HIDE under 94-98 but are really Dustproof **93 Base** (0.9/3.6/9/18L → 1L/4L/10L/20L) — flipped to KEEP/primary at 93.
- **WS PROTECT CLEAR** (1 row) left untouched (out of scope).

Final per-product (primary visible): Dustproof 62 (48 primary), Rainproof 40 (32), Powerflexx 62 (36).

---

## 3. Menu changes (`mo_order_form_index_v2`, 400 → 392)

- **Dropped** the wrong plain "WS PROTECT" sub-product (was 18 menu rows hydrating to 0 packs).
- **Renamed — two independent fields:**
  - mobile label = `displayName` (taxonomy-preview.json), "Dulux" dropped: "WS Protect Dustproof", "WS Rainproof", "WS Powerflexx".
  - desktop tab = `uiGroup` (seed step 7.7 rename map): "Max", "Powerflexx", "Protect Dustproof", "Protect Rainproof".
- **Added Dustproof rows** so stock renders: 90, 96, Brilliant White (gap-fill), 99 Base, 93 Base, and the 5 colour rows. Dustproof now has **15 bases**: 90,92,93,94,95,96,97,98,99 + Brilliant White + 5 colours.
- **Coverage rule learned:** the menu base list must cover every PRIMARY stock base, or stock rows render nowhere. Rainproof/Powerflexx were already complete; only Dustproof had gaps.

> Tab list/order comes from menu rows + `sortOrder` (NOT `WITHIN_SECTION_ORDER` — that constant/file doesn't exist; the doc reference is stale). Tab label = `uiGroup ?? subProduct` in `family-nav-with-tabs.tsx`.

---

## 4. Base aliases (extended)

`lib/place-order/base-aliases.ts` now covers WS PROTECT DUSTPROOF / RAINPROOF / POWERFLEXX with the same map as WS Max **plus 99 → Vibrant Red**:

`90 White · 92 Intermediate · 94 Accent · 95 Deep · 96 YOX · 97 ROX · 98 Vibrant Yellow · 99 Vibrant Red` (93, Brilliant White, named colours = no alias).

Seed **step 7.8** gate generalised from `product === "WS MAX"` to **any product in `BASE_ALIASES`** — so alias search words bake into `searchTokens` for all of them. Display lights up automatically (frontend reads the constant). Email + baseColour untouched throughout.

---

## 5. Search ranking (new)

`lib/place-order/mobile-search.ts` (**NEW**) — `rankProductsForQuery`: the same AND-substring filter as before (so result SETS are unchanged) **plus scoring** (prefix 100 / word-boundary 20 / inner 5 / +50 multi-token) + sub-product-prefix boost + token-start signal + a small WS-Dustproof tiebreak, with a stable secondary sort by catalog index. Mobile `getProductSuggestions` and desktop `searchProducts` (`queries.ts`) both use the scoring.

Live behaviour:
- **"protect"** → Dustproof, then Rainproof, then Damp Protect (falls out naturally: DP/RP tokens *start* with "protect" = high; "Damp Protect" has it mid-name = lower). No token surgery; Rainproof keeps its `PROTECT RAINPROOF` token.
- **"rainproof" / "protect rainproof"** → Rainproof first, then Dustproof (weak `RAINPROOF` token added to Dustproof; sub-product-prefix boost keeps Rainproof on top).
- **"ws"** → all WS, Dustproof boosted first.
- **HISHEEN** had a junk "protect" token — removed.

---

## 6. Deploy lesson (important)

Commits were made **but not pushed** for several steps — Vercel builds from `origin/main`, so the runtime code (the ranker + alias display) wasn't live even though the **DB reseeds were** (they write straight to Supabase). Symptom: search looked like catalog order, aliases didn't display. Fixed by `git push origin main`.

**Rule going forward:** every code commit must be **`git push origin main`** to deploy. "Commit to main" ≠ deployed. DB reseeds are independent of deploy.

---

## 7. Backups (restore points retained)

- SKU: `mo_sku_lookup_v2_bak_20260601c` (1631, pre-restructure) · `mo_sku_lookup_v2_bak_20260601_93` (1625)
- Menu: `..._bak_20260601d` (400) · `..._e` (388) · `..._93` (391) · `..._search` (392) · `..._sort` (98/99 fix)

---

## 8. Commits

- SKU converter: `81cfae0c` (+ `8b507d2a` tracked the Rainproof/Powerflexx CSVs — required for clean-checkout reseed)
- Menu structure (drop Protect, rename 4): `bcb154f9`
- Base gaps + aliases: `05c5a6c3`
- 93 Base rescue: `e9ea640a`
- Search rules + mobile ranker: `606c6667`
- (98-before-99 sort fix + the deploy push: final commit of this session)

---

## 9. Suggested CLAUDE_PLACE_ORDER.md edits (at consolidation)

- New section **"CSV-as-source SKU seed"** documenting the converter rules + the 3 CSVs as the editable source for those products.
- New section **"Search ranking"** documenting `mobile-search.ts` (`rankProductsForQuery`), the scoring weights, and the protect/rainproof/ws behaviour.
- Update the menu section: tab order is `sortOrder`-driven; tab label = `uiGroup`; mobile label = `displayName`. **Remove the stale `WITHIN_SECTION_ORDER` reference** and the stale "/order uses legacy table" landmine (both confirmed false — `/order` reads v2 since the 2026-05-29 cutover).
- Note the **menu-covers-stock rule** (every primary stock base needs a menu row).

---

## 10. Open / optional

- **Search refinements floated but not built** (user said current ranking is fine): "rainproof → Rainproof only" (drop the weak Dustproof link), and "ws → WS-family-first" (rank the WS family above the unrelated "Dulux WS Hi-Sheen/Metallic" products that merely contain "WS"). Pick up if wanted.
- Two single-pack gaps left unchased (95 Base 1L was built; 93 Powerflexx 4L built) — none outstanding.

---

## 11. Next-product loop (template)

1. Reviewer marks the product's CSV (KEEP/HIDE).
2. Diagnose CSV vs live (deltas, collisions, missing-from-legacy, leftovers).
3. Build via the CSV-as-source converter → DRY_RUN rehearse → reseed SKU.
4. Menu: rename/add rows so the menu covers all primary stock bases → reseed menu.
5. Add `BASE_ALIASES` entries (display + search) → reseed menu.
6. Commit **and push** all code → verify live.
