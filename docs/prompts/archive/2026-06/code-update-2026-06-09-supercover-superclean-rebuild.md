# Code update — Super Cover + Super Clean catalog rebuild

**Date:** 2026-06-09
**Commits:** `b68de08d` (Super Cover) · `6e364f2c` (Super Clean) — both direct to `main`, pushed, Vercel deployed.
**Status:** Live in production, smoke-tested on `/po`, `/order`, `/place-order`.

Two existing INTERIORS / "Mass-market emulsion" families restructured via the CSV-as-source drill (same pattern as Sadolin / Tools / SuperCover loader). Each has two sub-products rendered as two desktop tabs; mobile is flat.

---

## 1. Super Cover (commit `b68de08d`)

Sub-products → tabs: **SuperCover** + **SuperCover Sheen** (8 + 4 bases).

### What shipped
- **Stock 1560 → 1616 (+56 built-from-CSV: 19 visible / 37 hidden).** 34 existing re-keyed. Source: `docs/SKU/review/supercover-final.csv` via new `loadSuperCoverMap()` (CSV authoritative — category/product/baseColour/isPrimary/pack from CSV).
- **YELLOW BASE → 96 BASE merge:** `IN27309672` (1L) + `IN27309671` (4L) re-homed to 96 BASE and demoted; DPP `5853028`/`5853027` stay the 96 primaries.
- **92 BASE 1L primary swap:** `5853018` primary; `5853033` + `IN27309223` hidden.
- **Stray Sheen `IN27909223`** (92 BASE 1L) demoted; `IN27909272` is the primary. Added to the CSV as an explicit hidden row.
- **250ML testers** (90/92/94/95/96/97) render with **no enable**: mobile shows its own 250ML button; desktop tucks it in the 500ML bucket column with a "250ML" hint (owner-approved "leave it").
- **Menu (12 rows):** product join-keys made non-null (`CONFIRMED_SUBPRODUCT_MAP` identity keys → unlocks aliases + bakes alias search words); added **93 BASE** row; removed YELLOW BASE row + a duplicate 92 BASE source row; base aliases 90 White / 92 Intermediate / 94 Accent / 95 Deep / 96 Yellow / 97 Red (BW & 93 none); clean tab labels via §7.7 uiGroup; `supercover` / `super cover` keyword promotion. `EXPECTED_TOTAL_NEW_ROWS` 506 → 505; menu table steady 438.

### Backups (pre-reseed)
- `mo_sku_lookup_v2_bak_20260609_supercover` = 1560
- `mo_order_form_index_v2_bak_20260609_supercover` = 438

---

## 2. Super Clean (commit `6e364f2c`)

Sub-products → tabs: **SuperClean** + **SuperClean 3in1** (8 + 10 bases; 3in1 adds **Pastel** + **Pro**).

### What shipped
- **Stock 1616 → 1647 (+31 built-from-CSV: 3 visible / 28 hidden).** 81 existing re-keyed. Source: `docs/SKU/review/superclean-final.csv` via new `loadSuperCleanMap()`.
- **3 KEEP injects land primary:** `5906725` (95 BASE 1L), `5832493` (94 BASE 10L), `5832500` (94 BASE 20L).
- **Stray `IN23809482`** (94 BASE 10L 3in1) demoted; `5832493` is the primary. Added to the CSV as an explicit hidden row.
- **PASTEL BASE + PRO BASE** (3in1 only) — already `isPrimary=true` in live; kept visible. New **non-standard** aliases: Pastel, Pro.
- No 250ML — all packs 1L/4L/10L/20L (no pack-type work).
- **Menu (18 rows):** product join-keys non-null; base aliases (90 White … 97 Red + Pastel + Pro); 2 clean tabs; **31 duplicate source rows cleaned to 18**; **PASTEL/PRO sortOrder collision fixed** (both were 2019 → 2018/2019); `superclean` / `super clean` / `3in1` keyword promotion. `EXPECTED_TOTAL_NEW_ROWS` 505 → 492 (the 13 collapsed dups); menu table steady 438.

### Backups (pre-reseed)
- `mo_sku_lookup_v2_bak_20260609_superclean` = 1616
- `mo_order_form_index_v2_bak_20260609_superclean` = 438

---

## Files changed (both commits)
- `scripts/v2-sku-seed-from-legacy.ts` — `loadSuperCoverMap()`, `loadSuperCleanMap()`, build-from-CSV loops, stray-demote, DRY_RUN TARGETS, stock expect-total 1560 → 1647.
- `scripts/v2-catalog-seed-from-preview.ts` — `CONFIRMED_SUBPRODUCT_MAP` identity keys, §7.7 uiGroup tab-label branches, `EXPECTED_TOTAL_NEW_ROWS` 506 → 492.
- `lib/place-order/base-aliases.ts` — SUPERCOVER, SUPERCOVER SHEEN, SUPERCLEAN, SUPERCLEAN 3IN1 blocks (incl. Pastel/Pro).
- `lib/place-order/keyword-family-map.ts` — supercover/superclean/3in1 promotion.
- `docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json` — SuperCover + SuperClean family rows cleaned/added.
- `docs/SKU/review/supercover-final.csv`, `docs/SKU/review/superclean-final.csv` — decision-record sources.

---

## Learnings / patterns reinforced
- **CSV-authoritative `loadXMap()` pattern** now covers SuperCover + SuperClean (mirrors Sadolin/Tools): CSV wins on category/product/baseColour/isPrimary/pack; absent KEEP+HIDE materials built from CSV.
- **Cross-list trap is per-family, not guaranteed.** SuperCover had it (`5766355–58` listed under 93 *and* 94–97 → kept under 93 only, 10 phantom rows dropped — `material` is UNIQUE). SuperClean had zero. Always run the explicit "same SAP under >1 base" check before seeding.
- **Stray-demote safety net** ("any family stock row not in CSV → isPrimary=false") catches leftover live primaries (`IN27909223`, `IN23809482`). Best practice: also add the stray to the CSV as an explicit hidden row so the file fully matches live.
- **Aliases need a non-null product join-key** → `CONFIRMED_SUBPRODUCT_MAP` identity key (stock product already byte-matches subProduct, so the pack join is unchanged; this is display/search only).
- **`EXPECTED_TOTAL_NEW_ROWS` counts SOURCE rows (pre-dedup); the live menu table is the deduped count (~438).** They are different numbers — do not conflate. Cleaning duplicate source rows drops the counter (505→492) without changing the live table.
- **Menu dry-run joins LIVE stock:** a brand-new base (SuperCover 93) shows expected ZERO until the stock-first reseed; re-keyed bases (all SuperClean) hydrate immediately. Reseed order is always stock → menu.
- **Build hygiene on the depot PC:** OneDrive can corrupt `.next` (`EINVAL readlink`) → clear `.next` and rebuild. A parallel uncommitted WIP (desktop multi-bill `cart-panel.tsx`) can fail `npm run build`; explicit file staging keeps it out, and a build failure in a non-staged file is not a blocker for our commit.

---

## Open items / follow-ups
- **Desktop 250ML** (SuperCover) sits in the 500ML column with a hint (owner-approved). Revisit only if a dedicated 250ML bucket column is wanted.
- **Stray-demote is now active** for SUPERCOVER + SUPERCLEAN — any future unknown SAP under these families auto-hides until added to the CSV.
- **Backups to retire** after a stable period: 4 tables (`_supercover` + `_superclean`, stock + menu).
- **Parallel desktop multi-bill WIP** (`cart-panel.tsx`, new `docs/mockups/place-order/*.html`) remains uncommitted — separate work, untouched here.
- Pre-existing unrelated zero: `DISTEMPER / INTERIOR DISTEMPER` (Acrylic Distemper missing packCode — already on ROADMAP).

---

## Consolidation target
- **CLAUDE_PLACE_ORDER.md** — SuperCover + SuperClean family specs (sub-products, tabs, aliases incl. Pastel/Pro), the `loadXMap` CSV-authoritative loader, the cross-list trap + stray-demote rules, and the `EXPECTED_TOTAL_NEW_ROWS` (source) vs menu-table (deduped) distinction.
- **CLAUDE_CORE.md** — schema note: stock 1647; SUPERCOVER / SUPERCLEAN categories.
- **ROADMAP.md** — close out SuperCover + SuperClean catalog lines; carry remaining pending families.
