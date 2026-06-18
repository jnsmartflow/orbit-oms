# Code Update — Distemper Restructure + Multi Purpose Thinner Fix

**Date:** 2026-06-09
**Commits:** `34101c66` (Distemper), `70bd6369` (Thinner)
**Branch:** main (pushed; Vercel auto-deploy)

---

## 1. Distemper restructure — `34101c66` (10 files)

### What changed
Distemper folded into the desktop **"Primer and Distemper"** tile (tile 8) as a second tab. It stays its **own family** in data/section/search — the two-tab grouping is UI/nav only. Rendered flat with 3 clean rows in **KG**:

- **Duwell - Acrylic Distemper** — 5 / 10 / 20 KG
- **Magik - 90 Base** — 1 / 2 / 5 / 10 / 20 KG
- **Magik - Brilliant White** — 1 / 2 / 5 / 10 / 20 KG

### Dropped (physically removed, not hidden)
- 11KG `IN87109011`, 22KG `IN87109022` (odd Magik BW sizes)
- Interior Distemper `5862521`

### Counts
| Table | Before → After |
|---|---|
| Stock (mo_sku_lookup_v2) | 1647 → 1644 |
| DISTEMPER stock | 16 → 13 |
| Menu (mo_order_form_index_v2) | 438 → 437 |
| DISTEMPER menu rows | 4 → 3 |
| EXPECTED_TOTAL_NEW_ROWS | 492 → 491 |

### Files (10)
- `scripts/v2-sku-seed-from-legacy.ts` — `loadDistemperMap()` + category-scoped **allowlist DROP**
- `scripts/v2-catalog-seed-from-preview.ts` — §7.7 `uiGroup="Distemper"` branch + EXPECTED 491
- `docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json` — 3 relabels, Interior row deleted, searchTokens
- `lib/place-order/keyword-family-map.ts` — distemper/magik/duwel → DISTEMPER
- `docs/SKU/review/distemper-final.csv` — new 13-row allowlist
- `lib/place-order/quick-tiles-config.ts` — tile 8 group (familyNames)
- `app/(place-order)/place-order/components/active-product-panel.tsx` — family-set filter
- `app/(place-order)/place-order/components/family-nav-with-tabs.tsx` — headerLabel
- `app/(place-order)/place-order/place-order-page.tsx` — 3 filter sites + has-lines dot
- `lib/place-order/pack-buckets.ts` — DISTEMPER KG columns

### Backups
`mo_sku_lookup_v2_bak_20260609_distemper` (1647), `mo_order_form_index_v2_bak_20260609_distemper` (438)

### Key learnings (reusable)

**1. Allowlist-DROP pattern (new — different from SuperCover/SuperClean).**
The CSV is the *complete* allowlist for the family; any family row **not** in the CSV is **dropped** (not stray-demote-hidden). Loader shape: `category === "DISTEMPER" && !allowlist.has(material) → continue`. Use this when a family should physically lose SKUs on reseed (vs. hiding them).

**2. Multi-family nav tile (new, reusable).**
A tile can carry an optional `familyNames: string[]`. The 3 desktop filter sites resolve with `tile.familyNames ?? [tile.familyName]` and flat-map the filter; `familyName` stays for the highlight. The two tabs come for free from the existing **uiGroup-tab engine** across the combined product set ("Primers" + "Distemper") — no new tab/grid code. `headerLabel` shows the combined name. **Mobile (`/po`, `/order`) is search-first and untouched.** Pattern is ready for any future grouped tile.

**3. Family-scoped pack-buckets (important blast-radius lesson).**
1/2/5/10/20 KG are also carried by AQUATECH, PUTTY, SADOLIN, VT SPECIALTY, PROMISE — all of which **deliberately fold KG → litre** columns. A global KG→KG remap would have broken every one of their grids. Fix was scoped to DISTEMPER via `FAMILY_BUCKET_OVERRIDES` (checked before the global `PACK_TO_BUCKET`). The desktop grid is **derived-from-present-packs** (`STANDARD_COLUMNS.filter(present)`), so columns never appear empty — the KG columns surface for Distemper only.

---

## 2. Multi Purpose Thinner fix — `70bd6369` (3 files)

### What changed
Stock SKUs `5826259` (1L) / `5826260` (5L) / `5826261` (20L) were mislabelled product **"PU PRIME THINNER"**. Corrected to **"MULTI PURPOSE THINNER"** across product, displayName, searchTokens, and description. Clean rename — only these 3, no merge.

### Root cause — regression
The `sadolin-review-final-20260604.csv` (lines 123-125) carried the wrong name. **Earlier** Sadolin/woodcare CSVs had "Multi Purpose Thinner" correct; the `-final` CSV flipped it. The menu JSON (5479-5490) carried the same wrong name. The legacy mapper (`taxonomy-mapping.ts`) actually had the *right* name but was overridden by the CSV.

### Files (3)
- `docs/SKU/review/sadolin-review-final-20260604.csv` — lines 123-125 (col 5/7/8/10)
- `docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json` — lines 5479-5490
- `scripts/v2-sku-seed-from-legacy.ts` — line 656, description path

### Counts
Rename only — stock 1644 steady, menu 437 steady, SADOLIN category 154 unchanged.

### Key learnings

**1. Description source for CSV-re-keyed rows (the wrinkle).**
For rows the Sadolin CSV re-keys, the main loop previously set `description: legacy.description` — the CSV col-10 was **only** used for build-from-CSV *new* SKUs. So editing the CSV alone did **not** change the stored description. Fixed via **Path B**: line 656 now `description: sad ? sad.description : legacy.description`. Verified a **no-op for the other 151 Sadolin rows** (their col-10 already equalled legacy). The Sadolin CSV is now the single source for product/base/pack/isPrimary/**description** — removes legacy-description drift.

**2. Lockstep rename.** Stock `product` and menu `subProduct` are the join key — they must change together or packs stop resolving.

### Operational follow-up
Any thinner orders placed via `/place-order` or `/order` between the Sadolin `-final` rebuild and this fix may have shown/emailed **"PU Prime Thinner"**. Worth a quick audit if any went out to customers.

---

## 3. Backup policy (agreed this session)

- **One backup at session start** as a catastrophe fallback. Skip per-change backups.
- **Skip per-change backups** for changes that are dry-run-verified **and** fully reproducible from the committed seed/CSV — the real recovery is *re-running the seed* (git is source of truth), not restoring a snapshot.
- **Keep a backup only** for non-reproducible / risky ops (schema changes, anything not seed-driven).
- Rationale: an early snapshot can't cleanly undo *one* later change (restoring it rolls back everything since); git/seed reproducibility is the true safety net.

Applied: the thinner fix proceeded without a new backup.

---

## 4. Open / pending

- Distemper smoke-test result not explicitly confirmed by owner (taken as good).
- Backlog (from family ledger): 8 untouched families (VT Specialty, Floor Plus, Lustre, Texture, Putty, Metallic, Smoothover, Tile) + **PU Enamel dormant alias** (joins via subProduct; needs a product join-key to light up its aliases).
- Primer Int/Ext audit (from earlier `f217a1f7` fix) — orders billed opposite between the 2026-06-08 rebuild and that fix.
- Thinner audit (above).
