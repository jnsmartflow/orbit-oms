# code-update · 2026-06-02 · Satin family — Satin Finish display, search & sort

**Repo destination:** `docs/prompts/drafts/code-update-2026-06-02-satin-finish-display-search.md`
**Fold into:** `CLAUDE_PLACE_ORDER.md` + `CLAUDE_UI.md` at next consolidation.
**Status:** Live in production. Commit `af783299` (11 files, 236 ins / 82 del), pushed to `origin/main`.

---

## Goal

Restructure the SATIN family's **display, search, and sort** (the SKUs were already in place — only a couple needed re-homing):
- Rename the headline "Super Satin" → **"Satin Finish"**.
- Two-line result display: clean primary + a light descriptor underneath.
- Show base aliases ("· White" etc.).
- Clean the search keyword engine.
- Sort bases in series, colours most-packs-first.
- Fix two SKUs mis-mapped to the wrong sub-product.

---

## The family

SATIN family, ENAMELS section, two sub-products, **oil first**:
1. **Satin Finish** (oil) — was "Super Satin (Oil Satin / Satin Finish)".
2. **Satin Stay Bright** (water-based).

---

## Locked design

**Display (search result + product header), both mobile and desktop:**
- Satin Finish: primary `Satin Finish — <base> · <alias>`, light descriptor `Super Satin · Oil Base`.
- Satin Stay Bright: primary `Satin Stay Bright — <base> · <alias>`, light descriptor `Satin · Water Base` (note: NOT "Satin Finish" — only the oil one is the Satin Finish).

**Tabs (desktop):** "Satin Finish", then "Satin Stay Bright" (oil first).

**Base aliases** (both sub-products): 90 White, 92 Intermediate, 94 Accent, 96 YOX, 97 ROX.

**Search keywords:**
- `satin` → both (oil first).
- `satin finish` / `super satin` / `oil satin` / `oil base` → **Satin Finish (oil) only**.
- `satin stay bright` / `stay bright` / `wb satin` / `water satin` / `water base` → **Satin Stay Bright (water) only**.
- Dropped junk leftovers: "PU SATIN", "SUPER SB PU SATIN", "WB PU SATIN", "STAY BRIGHT WB PU SATIN".

**Sort (per sub-product):** bases in series (Brilliant White, 90, 92, 93, 94, 96, 97), then colours most-packs-first (tiebreak alphabetical).

**Two SKU re-keys:** `IN28809772` (97 Base) and `5867120` (93 Base) moved Satin Stay Bright → **Super Satin (oil)** per the owner. No collision (landed on packs Super Satin didn't have) — both stay primary.

---

## How it was built

**Base-alias unlock (the key mechanism):** base aliases only render for menu rows with a **non-null `product` join-key** — `getBaseAliasDisplay` and the §7.8 token-baking are both gated on `product`. Satin's sub-products had `product=NULL` (join via subProduct). Gave them an **identity join-key** via `CONFIRMED_SUBPRODUCT_MAP` ("SUPER SATIN" / "SATIN STAY BRIGHT"); stock product already equals these, so the pack join is unchanged. This unlocks both the "· White" display and auto-bakes the alias words into searchTokens. (WS pattern.)

**Descriptor line:** no subtitle field existed on the menu rows. Added a static frontend map `lib/place-order/sub-product-descriptors.ts` (family|subProduct → descriptor) — no schema/seed/DB change for two fixed strings — and rendered a muted secondary `<p>` at each render site.

**Files changed (commit `af783299`):**

Data / seed:
- `docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json` — SATIN displayNames → "Satin Finish" / "Satin Stay Bright"; searchTokens (drop PU-SATIN, add OIL BASE / WATER BASE / WATER SATIN); sortOrder recomputed (oil 900–913, wb 920–927); removed the orphaned Stay Bright 97 Base row; totalNewRows 531→530.
- `scripts/v2-catalog-seed-from-preview.ts` — SATIN_UI tab labels → "Satin Finish" / "Satin Stay Bright"; CONFIRMED_SUBPRODUCT_MAP += identity keys; EXPECTED_TOTAL_NEW_ROWS 531→530.
- `lib/place-order/base-aliases.ts` — "SUPER SATIN" + "SATIN STAY BRIGHT" alias blocks.
- `lib/mail-orders/taxonomy-mapping.ts` — SATIN SEARCH_TOKENS + DISPLAY_LABEL updated.
- `scripts/data/sku-name-overrides.json` — IN28809772 + 5867120 → SUPER SATIN.
- `scripts/v2-sku-seed-from-legacy.ts` — scoped re-key collision guard; SATIN rehearsal TARGETS.

Frontend render:
- `lib/place-order/sub-product-descriptors.ts` (new) — the descriptor map.
- `app/order/page.tsx` (mobile) — descriptor line at the active header + the 3 list sites (search-result / selected / picked). Cart skipped (BillLine carries no family).
- `app/(place-order)/place-order/components/big-search-bar.tsx` + `sub-product-direct.tsx` (desktop) — descriptor line under the result label / sub-product title.

---

## Reseed (live, verified)

**Backups:** `mo_sku_lookup_v2_bak_20260602_satin` (1630), `mo_order_form_index_v2_bak_20260602_satin` (401).
**Stock:** 1630 → 1630 (re-keys, no add). Super Satin 45→47, Satin Stay Bright 26→24.
**Menu:** 401 → 400 (orphan row removed).

**Verification — all PASS:** displayNames/tabs renamed; product join-keys set; bases-in-series then colours-most-packs; oil first (913 < 920); aliases bake; tokens clean (OIL/WATER BASE in, PU SATIN out); both re-keys primary; Stay Bright 97 Base gone (0 stock / 0 menu); all 21 Satin rows hydrate; Gloss/PU Enamel/WS steady.

---

## Learnings

- **Base aliases need a non-null `product` join-key.** `getBaseAliasDisplay` + §7.8 token-baking are gated on it. Families that join via `subProduct` (product=NULL: Gloss, PU Enamel) can't show aliases until given an identity join-key through `CONFIRMED_SUBPRODUCT_MAP`. Doing so is safe when stock `product` already matches the key (pack join unchanged).
- **The result name is composed:** `productLabel = "{displayName} — {baseColour}" + " · {alias}"`. Renaming the headline = change `displayName`. There was **no descriptor/subtitle field** — a secondary line is a frontend static map + a muted `<p>` at each render site (mobile: search/selected/picked/active; desktop: search + sub-product header). Cart has no family, so no descriptor there.
- **Search scoping is token-driven, ordering is sortOrder-driven.** The engine AND-matches words against searchTokens + displayName + baseColour, then stable-sorts by sortOrder. Scoping a phrase to one sub-product = put the token only on that sub-product; "oil first" = lower sortOrder. No scorer code change needed.
- **Re-keying a SKU between sub-products can orphan a base.** If the moved SKU was the only stock for a base in its old sub-product, that base's menu row hydrates 0 packs forever — remove it. Always check for orphaned base rows after a re-key.
- **Sort convention (refined):** bases in series; colours most-packs-first. (Gloss happened to match series for bases already.)

---

## Suggested canonical edits (at consolidation)

`CLAUDE_PLACE_ORDER.md`:
- ENAMELS families: Gloss, **Satin** (Satin Finish + Satin Stay Bright), Promise Enamel, PU Enamel.
- Document the **product-join-key requirement** for base-alias display + token baking (the `CONFIRMED_SUBPRODUCT_MAP` identity-key trick).
- Sort convention: bases-in-series, colours-most-packs-first.

`CLAUDE_UI.md`:
- The **two-line result display** pattern (primary + light descriptor) and the `sub-product-descriptors.ts` map; the render sites (mobile 3 list sites + active header; desktop search + sub-product header).

---

## Notes

- The `5867118 / 5867119 / 5867121` cross-listings (Super Satin 93 Base annotated under 94/96/97) were harmless reviewer notes; live = Super Satin 93 Base primary. No action.
