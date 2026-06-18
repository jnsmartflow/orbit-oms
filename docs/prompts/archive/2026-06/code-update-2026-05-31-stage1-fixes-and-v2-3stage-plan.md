# Session 2026-05-31 — /order + /place-order fixes, and the v2 single-source 3-stage plan

**Scope:** OrbitOMS `/order` (mobile, ~99% of orders) and `/place-order` (desktop, ~1%), both reading the v2 tables `mo_order_form_index_v2` (menu) + `mo_sku_lookup_v2` (stock).
**Status of live system at session end:** fixed and stable. All three fixes below are on `main` and reseeded to production.

---

## 1. What shipped this session (live on production)

### 1.1 `/order` search keyword fix — distemper / smartchoice
- **Problem:** typing "smartchoice" wrongly returned the generic Acrylic Distemper rows.
- **Cause (data, not code):** the two generic `family=DISTEMPER / ACRYLIC DISTEMPER` rows carried a stray search keyword `PROMISE SMARTCHOICE ACRYLIC DISTEMPER`. `/order` search is a substring match on `searchTokens`, so "smartchoice" matched inside that token.
- **Fix:** removed only that trailing token from the two rows in the source JSON (`taxonomy-preview.json` lines ~5322, ~5334). The real SmartChoice Distemper row was left untouched.
- **Result:** "smartchoice" → only SmartChoice products; "distemper" → both generic + SmartChoice. Verified live.
- **Commit:** `67e270dc`.

### 1.2 Phase 1 — fill the `product` join-key for broken catalogue rows
- **Problem:** 105 of 409 active rows showed **no pack buttons** (e.g. Machine Tinter OXR, PU Stainer GVA Yellow Oxide).
- **Cause (data):** `/order` resolves packs by `(form_index.product ?? subProduct) + "|||" + baseColour` matched to `mo_sku_lookup_v2.product` (isPrimary rows). `product` was NULL on all rows, so it fell back to `subProduct` (a UI name) which diverges from the SAP-clean stock `product` name. The intended bridge column `product` was simply never filled.
- **Fix:** filled `product` on the broken rows via the seed, using:
  - 7 confirmed family→stock-name locks: MAX→WS MAX, POWERFLEXX→WS POWERFLEXX, RAINPROOF→WS PROTECT RAINPROOF, PROTECT→WS PROTECT, PROTECT DUSTPROOF→WS PROTECT DUSTPROOF, PU STAINER→GVA, MACHINE TINTER→MACHINE STAINER.
  - 17 high-confidence auto-matches (inlined as `HIGH_PRODUCT_MAP`).
- **Result:** ~84 products that showed nothing now show packs. 92 rows got `product`; 0 regressions.
- **Commits:** `df6a1da2` (fill), `4db69d5d` (refactor — inlined the 17 mappings, removed the draft-CSV runtime dependency so the seed is self-contained).

### 1.3 `/place-order` grouping recovery — restored durably
- **Problem:** the desktop grouping was gone — WS card empty; Gloss, Aquatech, Primer ungrouped.
- **Cause:** the grouping (family="WS" with 5 sub-products, Gloss Base/Colour, Aquatech Prep/Basecoat/Topcoat/Additives, Primer buckets, Stainer/Satin uiGroups, Floor Plus extraction) was built on **May 13 as manual Supabase SQL against the live DB only** — it was never written into the seed/JSON. The **May 30 wipe-and-reseed** (`d64fd41f`, Promise dedup, 461→409) rebuilt from the flat JSON and erased it. **Today's work did not cause this** (proven: data identical across all of today's snapshots; Phase 1 only touched `product`).
- **Recovery source:** backup table `mo_order_form_index_v2_bak_20260530` (461 rows) held the complete grouped state, plus the May-13 session-end doc held the intent/rules.
- **Fix:** lifted the grouping out of the backup, matched it onto today's clean (deduped + fixed) menu, and **baked it into the seed** so it survives every future reseed. Deduped 4 redundant Aquatech "Floor Plus" rows (Floor Plus back to 13). Added family "WS" to the seed's section/subgroup maps (EXTERIORS / "WS (Weather Shield)").
- **Result (live, 405 rows):** WS shows Max/Protect/Dustproof/Rainproof/Powerflexx; Gloss → Base/Colour; Aquatech → Prep/Basecoat/Topcoat/Additives; Primer → Wood/Metal/Cement/Acrylic/Alkali/Promise; Stainer + Satin grouped. `/order` mobile unaffected (0 pack regressions, search intact).
- **Commit:** `755c3d8f`.

---

## 2. Key learnings & rules established

- **The data-only trap (most important):** any structural/taxonomy change made directly in the live DB will be **wiped by the next wipe-and-reseed**, because the seed rebuilds from the JSON. **RULE: all taxonomy/grouping/key changes must go into the seed (the durable source), never DB-only.** This is exactly what cost the May-13 grouping work.
- **Pack join mechanism:** `/order` + `/place-order` packs come from `(product ?? subProduct)|||baseColour` matched to `mo_sku_lookup_v2.product` (isPrimary). Keep `product` filled with the SAP-clean stock name.
- **`/place-order` rendering is uiGroup-aware:** sub-product tabs render from `uiGroup ?? subProduct` (`family-nav-with-tabs.tsx`); the family card is selected by `family === tile.familyName`. So grouping is **data-only** — no rendering code change needed. A speed-dial tile pointing at a family that doesn't exist in the data renders an empty card (this is why the WS tile was blank after the flatten).
- **Dry-run limitation discovered:** the seed's dry-run returns **before** the DB insert, so it cannot catch insert-time failures. The first live grouping run failed partway because the new family "WS" was missing from `FAMILY_TO_SECTION` / `FAMILY_TO_SUBGROUP`. **RULE: when introducing a NEW family, also add it to the section/subgroup maps in the seed.**
- **Always: backup → dry-run → live** for any reseed. Never `prisma db push`/`db pull`; schema via Supabase SQL Editor then `npx prisma generate`.

### Backups taken this session (restore points)
- `mo_order_form_index_v2_bak_20260530` — 461 rows, **grouped** (the recovery source). Keep.
- `mo_order_form_index_v2_bak_20260531` — 409, session-start (pre-distemper).
- `mo_order_form_index_v2_bak_prefill_20260531` — 409, pre-Phase-1.
- `mo_order_form_index_v2_bak_pregroup_20260531` — 409, pre-grouping (post-Phase-1).

---

## 3. STILL OPEN — Stage 1 touch-ups (do NEXT SESSION, before Stage 2)

Stage 1 is functionally live, but a small set of SKU/product items still need review and fixing before we start Stage 2.

- **~13 oddball rows still showing no packs** (left with `product` NULL on purpose; some are now grouped but still need pack/SKU review):
  - AQUATECH: PU Coat, Interior WBC, Roof Coat (BW/Grey/Teracotta), Crackfiller (5/10/20mm), Flexible Coat (Advance/Neo), IBC Advance
  - DISTEMPER: Acrylic Distemper / Interior Distemper
  - PRIMER: 2in1 Interior-Exterior Primer
  - STAINER: HP Colorant
- **8 "mapped-but-base-unstocked" rows** — `product` set correctly but that base colour has no SKU in `mo_sku_lookup_v2`. Likely genuine stock gaps to add:
  - **WS Protect Brilliant White** (flagged — plain WS Protect has no Brilliant White SKU though its Dustproof/Max cousins do; probably a missing SKU)
  - WS Max Yellow Base; WS Protect 90/93/96/97 Base; WS Protect Dustproof Yellow Base / ROX
- **Stock-side gap:** the Acrylic Distemper / Interior Distemper SKU is missing its `packCode` in `mo_sku_lookup_v2` — needs the pack added on the stock side.
- **Optional cosmetic:** WS rows carry `mobileFamily = MAX/POWERFLEXX/PROTECT/RAINPROOF` (computed pre-grouping). Harmless on `/order` (it labels by family = "WS"); normalise to "WS" only if desired.

**Plan:** review and fix these (mostly SKU/stock-side touch-ups) in the next session → then move to Stage 2.

---

## 4. The plan — v2 as single source of truth (3 stages)

**Goal:** make the v2 menu + stock the **single source of truth for both humans and the parser**, so an email order can be looked up reliably and the desktop/mobile pages stay clean.

**Architecture (plain English):**
- **The barcode (stable key, backend only):** every product+variant links menu→stock by a stable key, not by matching human names. The SAP `material` is the per-pack code; the key sits one level up. Never shown on the frontend.
- **Friendly names + search on top:** `displayName` for people; `searchTokens` for the search box.
- **One universal keyword brain:** a single curated word→product + word→colour layer, used by BOTH the search box and the parser — so a word is taught once and both stay in step (no drift, which is what caused the distemper bug).
- **Two doors, one catalogue:** `/order` orders arrive already clean (skip the parser); messy emails go through the keyword brain to be tidied; both then use the same catalogue → SAP code. The more `/order` is used, the less work the parser ever does.

### Stage 1 — urgent fix (production-safe) — DONE except touch-ups
Make `/order` packs work + restore `/place-order` grouping. **Remaining:** the Section 3 SKU/stock touch-ups (next session).

### Stage 2 — make v2 parser-ready (frontend lives on v2; legacy parser still runs untouched ~90%)
Build everything the parser will eventually need, without switching it over:
1. Fill the canonical key (`product`) on all remaining rows (full hygiene).
2. Build the one universal keyword layer in v2 (word→product + word→colour), seeded from the legacy keyword tables (`mo_product_keywords`, `mo_base_keywords`).
3. Point `/order` + `/place-order` search at the shared layer.
4. Readiness check — confirm v2 carries everything the parser needs (packs, colour strategies DIRECT/FIXED/NUMBERED/COLOUR, carton multiply, no-match handling).
5. Verify search + readiness.

### Stage 3 — migrate the parser to v2 (only on explicit go-ahead)
1. Switch parser resolution to read v2 + the shared keyword layer instead of the legacy tables.
2. Carry over the no-match / zero-skip rule + the operator "fix-it" resolve loop + the `mo_line_status` audit surface.
3. Test on real sample emails.
4. Run old (legacy) and new (v2) side by side, confirm they agree, then cut over — retire legacy tables last.

**Note on the parser today (for context):** the legacy parser resolves an email product name via scored keyword matching (`mo_product_keywords` longest-first + `mo_base_keywords` + Levenshtein fuzzy fallback), then looks up `product|base|pack` in `mo_sku_lookup` → `material`. It enforces zero-skip (every email line is inserted even if unmatched). Stage 3 must preserve all of this on v2.

---

## 5. Quick reference — commits this session
- `67e270dc` — distemper/smartchoice search-token fix
- `df6a1da2` — Phase 1 product fill
- `4db69d5d` — inline Phase-1 HIGH map, drop CSV runtime dependency
- `755c3d8f` — restore durable family grouping + Floor Plus dedup
