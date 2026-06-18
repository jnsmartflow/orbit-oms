# Code update — 2026-06-08 — Primer flat-list, Wood Primer rename, TOOLS family

Session covered three pieces of catalog work, all shipped live. Save to
`docs/prompts/drafts/code-update-2026-06-08-primer-wood-tools.md`. Consolidate into the
canonical context files at the next pass.

Backups taken today (keep):
`mo_sku_lookup_v2_bak_20260608_primer`, `mo_order_form_index_v2_bak_20260608_primer`,
`mo_sku_lookup_v2_bak_20260608_tools`, `mo_order_form_index_v2_bak_20260608_tools`.

Final live totals after all work: **stock 1560 · menu 438** (was 1535 / 413).

---

## 1. PRIMER — flat-list rebuild (commit `6e6cf637`)

PRIMER is now a **single flat list** (one `uiGroup = "Primers"`, no tabs), **10 products / 11 menu rows**, sorted per the review CSV.

- **Flat-list mechanism:** a family with exactly one uiGroup auto-hides the tab bar.
  `family-nav-with-tabs.tsx`: `showTabs = subProductNames.length > 1`. No grid change needed for flat families.
- **Acrylic display swap (DISPLAY-ONLY, join keys unchanged):** product `EXTERIOR ACRYLIC PRIMER` shows **"Acrylic Primer - Int"**; product `INTERIOR ACRYLIC PRIMER` shows **"Acrylic Primer - Ext"**. (Owner-confirmed; contradicts SAP desc on purpose.)
- **Red Oxide merge (no stock deletion):** the "duplicate" was a *menu* product-split, not a stock dup (`material` is UNIQUE). Fix = re-key the 5 ROM materials (`IN34210071/072/073/081/082`) from product `QUICK DRYING PRIMER` → `RED OXIDE METAL PRIMER` via `sku-name-overrides.json`. That empties QUICK DRYING PRIMER → its menu row retired. RED OXIDE METAL PRIMER now hydrates 7 (5 ex-ROM primary + 2 IP Duwel `IN34010071/082` hidden).
  - **Lesson:** a "DELETE" row in a review CSV can mean *re-key/merge*, not stock deletion — always confirm the root cause; deleting would have destroyed real SKUs.
- **Farco split out:** `IN34125071/072/081/082` re-keyed product `WOOD PRIMER` → `FARCO WHITE PRIMER` (own visible product, base `""`); new menu row added.
- **Epoxy:** displayName → **"Epoxy 1K Primer"**, stays in PRIMER family.
- **1L-twin flip:** visible 1L = DN/Dulux tins (`IN32600072` Alkali, `IN32076823` Cement-WB); IP Duwel siblings (`IN32600023`, `IN32076872`) hidden. (Seed `SET_FALSE` reconciled to the CSV hidden set; both twins in a pair must not be hidden or there's no visible 1L.)

---

## 2. Wood Primer — base rename + colour in name (commit bundled with primer/its own)

Goal: distinguish White vs Pink on **both** desktop flat list and mobile, and shorten the base word.

- Base `"BRILLIANT WHITE"` → `"White"` on the 5 White materials (`IN34030071/072/073/081/082`) via `sku-name-overrides.json`. **Base is the menu↔stock JOIN KEY — changed in BOTH v2 tables identically.** Pink untouched.
- displayName baked the colour in: **"Wood Primer — White"** / **"Wood Primer — Pink"**.
  - Desktop flat-list rows show `displayName` only → baking the colour in is the only way to tell the two rows apart.
  - Mobile `productLabel()` won't double-append because the base string ("White"/"Pink") is now a substring of displayName.

---

## 3. TOOLS — new family (rollers & brushes) — the big one

Commits: `2e9ade49` (family + enabling code), `559f1c57` (/order box-step), `8ad226d7` (/po mobile support).
Source of truth CSV (committed, read by the seed): `docs/SKU/review/tools-catalog-source.csv`.

### What shipped
- **New family `TOOLS`**, section **UTILITY**, subgroup **"Tools & accessories"**. **Search-only** (no speed-dial tile — the 9-tile grid is full). Search promotion in `keyword-family-map.ts`: `tools` / `roller` / `brush` → `TOOLS`.
- **25 new SKUs** (12 rollers, 13 brushes), all `category="TOOLS"`, `baseColour=""`, `isPrimary=true`.
- **Display:** desktop `/place-order` shows **Rollers / Brushes tabs** (two uiGroups), one box column per tab; mobile (`/order` + `/po`) is **flat search** (uiGroup is data-only on mobile, no tabs). Sort = **inch ascending** (rollers 4/6/9, brushes 3/4/5).
- **4-inch brushes:** 3 regional variants per tier (Delhi NCR / UP Punjab / South) shown as **separate rows**, region in a **grey line** (its own field — NOT in the name, NOT in baseColour). 7 rows carry a region; 18 blank.

### New mechanics (all ADDITIVE — paint untouched)
- **New-SKU injection:** brand-new SKUs (not in legacy/SAP) are CSV-injected. Added `loadToolsMap()` + a **"2g" build loop** in `v2-sku-seed-from-legacy.ts`, mirroring the Sadolin "2f" Hydro-PU pattern. Guarded by `seenMaterials`; expect-total bumped 1535 → 1560.
- **Piece/box pack (no per-piece pack existed before):**
  - `unit = "PC"`; `packCode = "25"` (rollers) / `"12"` (brushes) → distinct lookup keys `25PC` / `12PC`.
  - New **disjoint buckets** `25PC` / `12PC` in `pack-buckets.ts` (identity-mapped: lookupKey == bucket, no stray hint). `formatPack` PC → **"1 pc"**. `PACK_CONTAINER_MAP`: `25PC` → "box of 25", `12PC` → "box of 12".
  - Distinct keys are what let two carton sizes coexist (the old `PACK_STEP_MAP` is global-by-label and couldn't carry both). The schema's `piecesPerCarton` column stays unused.
- **Box-step (new helper):** `packStepForPack(packCode, unit)` in `pack.ts` with `PIECE_BOX_STEP { "25PC":25, "12PC":12 }`; **delegates to the old label-keyed `packStep` for every non-PC pack** (paint byte-identical). Used by desktop `variant-grid.tsx` AND both mobile renderers. Label-keyed `packStep` retained for everything else.
- **Region column:** new `region text` column on `mo_order_form_index_v2` (added via Supabase SQL `ALTER TABLE … ADD COLUMN`, then `region String?` hand-edited into `schema.prisma` + `npx prisma generate` — never `db push/pull`). Selected in **BOTH** `/api/order/data` and `/api/place-order/data`. Rendered as an optional grey line (guarded; null on every paint row) on desktop grid, `/order`, and `/po`.

### ⚠️ Key lesson — there are TWO mobile order pages
This cost a full extra fix cycle. **Any mobile order-entry change must be applied to BOTH renderers (and desktop).**

| Page | File | Audience | Pack render | Tabs? |
|---|---|---|---|---|
| `/order` | `app/order/page.tsx` | public mobile, no login | straight from `/api/order/data`, no bucket filter | no (flat) |
| `/po` | `app/po/po-page.tsx` | depot mobile (Orbit bar, multi-bill) | its OWN `PackRows`, straight from `/api/order/data`, no bucket filter | no (flat) |
| `/place-order` | `variant-grid.tsx` | depot desktop | bucket columns (`bucketColumnsForTab` → `packToBucket`) | yes (uiGroup) |

- Mobile pages **do not use buckets** — they render packs straight from the API, so a PC pack shows once `formatPack` handles PC. The bucket wiring only matters for the **desktop** grid columns.
- Each mobile page has its **own** `PackRows` and its own step call sites — the box-step fix had to be repeated on `/order` (`559f1c57`) and `/po` (`8ad226d7`).
- **Open item / contradiction to resolve:** project notes elsewhere call `/order` a "frozen backup" and `/po` the going-forward page, but `CLAUDE_PLACE_ORDER.md §15` calls `/order` the public mobile page ("~99% of orders"). Both currently look live (different audiences). Confirm which is authoritative and whether the `/order` tools edits should stay (they're harmless/beneficial if `/order` is live).

### New-family checklist (confirmed this session)
1. Stock injection — `loadXMap()` + build loop in `v2-sku-seed-from-legacy.ts` + bump expect-total.
2. Menu rows — add to `taxonomy-preview.json`.
3. `FAMILY_TO_SECTION[…]` **and** `FAMILY_TO_SUBGROUP[…]` — **HARD GATE**, missing either throws at validation. Use an existing section.
4. uiGroup assign loop — tabs (per-row uiGroup) vs flat (single uiGroup).
5. `EXPECTED_TOTAL_NEW_ROWS` bump.
6. `keyword-family-map.ts` — search promotion.
7. Speed-dial (`quick-tiles-config.ts`) — locked at 9; swap a tile or skip (we skipped → search-only).
8. If non-paint pack type: `pack.ts` (`formatPack`, `packStepForPack`/`PIECE_BOX_STEP`) + `pack-buckets.ts` (disjoint buckets) + `PACK_CONTAINER_MAP`.
9. `category` hard-hidden in parser (`taxonomy-mapping.ts HIDDEN_BY_CATEGORY.TOOLS`) — fine for CSV-injected families; revisit only if the family ever arrives via SAP.

---

## Follow-ups
- Confirm `/order` vs `/po` authoritative status; decide if `/order` tools edits stay or revert.
- `lib/place-order/sub-product-descriptors.ts` STAINER entries were already committed earlier (`3f37feb3`) — no-op this session.
- Tools regional 4" brushes with blank box-qty (`IN34…` — Signature Delhi NCR `6457582`, Signature South `6457591`, Smart Delhi NCR `6457603`) are shown (owner-approved); revisit if any should be hidden.
