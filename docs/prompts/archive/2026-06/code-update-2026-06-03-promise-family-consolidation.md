# Code Update — Promise Family Consolidation

**Date:** 2026-06-03
**Commit:** `feat(catalog): consolidate Promise into one PROMISE family — 6 tabs, dedicated section, 85 SKUs built, single-base second-line display, speed-dial #6 (Woodcare off-dial)`
**Scope:** Largest catalog restructure in the v2 series. Consolidated all Promise products (except Promise Enamel) from a scattered, cross-listed state across 3 sections into one self-contained PROMISE family.
**Status:** Live and verified.

---

## What changed (summary)

Promise products previously lived across **INTERIORS / EXTERIORS / UTILITY** as 4+ separate families (PROMISE INTERIOR, PROMISE EXTERIOR, the umbrella PROMISE, plus Promise rows mixed inside PRIMER / DISTEMPER). Now they are **one family head `PROMISE` in its own dedicated `PROMISE` section**, with **6 sub-product tabs**. No more cross-section scattering — this is the final canonical structure for these SKUs.

Promise Enamel was **excluded** (stays its own family in ENAMELS with its own speed-dial tile).

---

## Final structure

**Family head:** `PROMISE` · own section `PROMISE` · surfaced by speed-dial tile (slot 6).

**6 sub-product tabs (Map To Product / uiGroup):**

| Tab | Base column holds | Notes |
|---|---|---|
| PROMISE INTERIOR | colour base (BrWhite/90/92/94/96/97) | emulsion |
| PROMISE SHEEN INTERIOR | colour base | emulsion |
| PROMISE EXTERIOR | colour base | emulsion |
| PROMISE SHEEN EXTERIOR | colour base | emulsion |
| PROMISE PRIMER | **variant** (single white base) | Promise Primer · 2in1 Primer · Freedom 2in1 Primer |
| PROMISE SMARTCHOICE | **variant** (single white base) | Interior · Exterior · Int Primer · Ext Primer · Acrylic Distemper |

**Single-base tabs (Primer, SmartChoice):** no colour range, so the **variant goes in the `baseColour` slot** instead of a colour. The actual base / capability is shown subtly (see Display).

---

## Display rules

**Emulsion tabs** (Interior / Sheen Int / Exterior / Sheen Ext): unchanged —
`Promise {Tab} — {base} · {alias}` on line 1 (e.g. "Promise Interior — 90 Base · White"). Aliases: 90 White, 92 Intermediate, 94 Accent, 96 YOX, 97 ROX.

**Single-base tabs (SmartChoice, Primer):** the per-variant qualifier moves to the **light second line**, headline stays clean.

- SmartChoice — line 1 `Promise SmartChoice — {Interior/Exterior/Int Primer/Ext Primer/Acrylic Distemper}`; line 2 `SmartChoice · {qualifier}`.
  - Interior / Exterior → qualifier "Br White / White Base"
  - Int Primer / Ext Primer → "Br White" if the description carries it, else none
  - **Acrylic Distemper → no qualifier** (line 2 = just "SmartChoice")
- Primer — line 1 = the variant's **own name** (`Promise Primer`, `Promise 2in1 Primer`, `Promise Freedom 2in1 Primer`) — **no "Promise Primer —" prefix** (avoids double "Primer"); line 2 `Promise Primer · {qualifier}`.
  - 2in1 + Freedom → qualifier "Int & Ext"
  - plain Promise Primer → none

**Mechanism (frontend):**
- `lib/place-order/sub-product-descriptors.ts` — added tab descriptors (`PROMISE SMARTCHOICE` → "SmartChoice", `PROMISE PRIMER` → "Promise Primer"); new `isVariantQualifierTab()` (flags those two tabs) + `getSecondLine(family, subProduct, qualifier)` (folds into `{descriptor} · {qualifier}`, omits qualifier when null).
- The per-variant qualifier lives in `base-aliases.ts` (keyed `product|baseColour`). For the two variant tabs the **line-1 alias suffix is suppressed** and the value renders on the second line instead. Emulsion alias-on-line-1 unchanged.
- Applied on mobile (`app/order/page.tsx`) + desktop (`big-search-bar.tsx`, `variant-grid.tsx`). `sub-product-direct.tsx` header left as-is (tab title is correct).

---

## Data work

- **85 new SKUs built-from-CSV** (the new `IN843xx` Promise Interior/Exterior range) as **hidden, `isPrimary=false` alternates** — sibling-copy pattern (same as WS/Gloss alternates). This was the bulk of the build.
- **140 live SKUs re-keyed** to their canonical Promise home.
- **24 dual-homed SKUs collapsed** to one canonical home (SmartChoice Int/Ext primers from PRIMER; SmartChoice Acrylic Distemper from DISTEMPER; Freedom/2in1 from PROMISE INTERIOR; 5 mis-filed Promise Primer `IN84500…` from PROMISE INTERIOR / umbrella). Old home recorded in CSV Notes.
- **3 removed** — REMOVE ×2 (`5883561`, `5838876`), DELETE ×1 (`IN86309472`).
- **Menu umbrella fully removed**; old PROMISE INTERIOR / PROMISE EXTERIOR families dissolved.

**Distemper rule (important):**
- The **Promise distemper** is named in full `PROMISE SMARTCHOICE ACRYLIC DISTEMPER` → lives under **PROMISE SMARTCHOICE** (3 SKUs, packs 5/10/20 **Kg**, blank carton).
- A plain `ACRYLIC DISTEMPER` **without** the "Promise SmartChoice" prefix is a **different, non-Promise product** → excluded.

**Two distinct primers (confirmed via SAP screenshots):**
- `Promise 2in1 Primer` = `5994750–5994753`
- `Promise Freedom 2in1 Primer` = `9055675–9055678`

---

## Cross-section family mechanism (reusable, mirrors WS)

A brand family that spans sections is modeled as **one family with its own section**, surfaced by a speed-dial tile independent of section browse:
- `FAMILY_TO_SECTION["PROMISE"] = "PROMISE"` (new dedicated section) + `FAMILY_TO_SUBGROUP["PROMISE"]`.
- §7.7 6-tab `uiGroup` branch in `v2-catalog-seed-from-preview.ts` (mirror SATIN/WS).
- `CONFIRMED_SUBPRODUCT_MAP` entries per tab → gives each tab a `product` join-key, which **unlocks base aliases + §7.8 auto-baking of alias words into searchTokens**.
- Speed-dial tile `type:"family"` surfaces the family directly; section is only the browse-all bucket.

---

## Speed-dial change

`lib/place-order/quick-tiles-config.ts` — slot 6 swapped:
- **from** `{ position:6, type:"section", label:"WOODCARE", sectionName:"WOODCARE" }`
- **to** `{ position:6, type:"family", label:"PROMISE", parentLabel:"PROMISE", familyName:"PROMISE" }`

Woodcare **not deleted** — just off the dial, still reachable via browse-all / search.

New dial order: `1 Gloss · 2 Satin · 3 Promise Enamel · 4 WS · 5 VT Glo · 6 Promise · 7 Stainer · 8 Primer · 9 Aquatech`.

---

## Kg packs

`pack.ts` already handles Kg cleanly: `formatPack` → "5KG/10KG/20KG"; `packToMl` returns 0 for KG (kept out of litre total, sorts last); `PACK_CONTAINER_MAP` has no 5/10/20KG → `packContainerLabel` returns null → carton/box label blank, as desired. No change needed.

---

## Files touched

**Data / seed**
- `scripts/data/sku-name-overrides.json` — re-keys (incl. 24 collapses + 5 mis-filed IN84500)
- `scripts/v2-sku-seed-from-legacy.ts` — 85 build-from-CSV alternates; 3 excluded; primer names
- `scripts/v2-catalog-seed-from-preview.ts` — PROMISE section + FAMILY_TO_SECTION/SUBGROUP + §7.7 6-tab branch + CONFIRMED_SUBPRODUCT_MAP + EXPECTED_TOTAL_NEW_ROWS; dropped old Promise section/subgroup entries
- `docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json` — PROMISE family rows (6 tabs); removed old families + umbrella; updated totalNewRows
- `lib/place-order/base-aliases.ts` — emulsion alias blocks + SmartChoice/Primer variant qualifiers
- `lib/mail-orders/taxonomy-mapping.ts` — SEARCH_TOKENS / DISPLAY_LABEL / FAMILY_BASE / SUB_PRODUCT_ORDER for PROMISE tabs

**Frontend**
- `lib/place-order/sub-product-descriptors.ts` — tab descriptors + `isVariantQualifierTab()` + `getSecondLine()`
- `app/order/page.tsx` — second-line qualifier (mobile), aliasSuffix suppressed for variant tabs
- `app/(place-order)/place-order/components/big-search-bar.tsx` — second-line qualifier (desktop)
- `app/(place-order)/place-order/components/variant-grid.tsx` — per-variant qualifier on light second line

**Speed-dial**
- `lib/place-order/quick-tiles-config.ts` — slot 6 Woodcare → Promise

---

## Backups & reseed

**Backups (Supabase, 2026-06-03):**
- `mo_sku_lookup_v2_bak_20260603_promise` — 1630 rows
- `mo_order_form_index_v2_bak_20260603_promise` — 400 rows

**Live reseed (stock first, then menu):**
- Stock `mo_sku_lookup_v2`: **1630 → 1712** (+85 built, −3 removed)
- Menu `mo_order_form_index_v2`: **400 → 400** (PROMISE = 34 rows + PROMISE ENAMEL = 10; 29 families produced)

**Verify — all PASS:**
- Stock totals: PROMISE INTERIOR 84 · SHEEN INTERIOR 48 · EXTERIOR 121 · SHEEN EXTERIOR 43 · PRIMER 13 · SMARTCHOICE 21
- All 6 menu tabs hydrate, **0 rows with no matching stock** (the 8 transient zeros resolved on the two-table reseed)
- Old PROMISE INTERIOR / PROMISE EXTERIOR families + umbrella gone from menu
- Other families steady: GLOSS 177 · PU ENAMEL 30 · Satin 47/24 · WS Dustproof 62 · WS Max 62 · Promise Enamel 10
- 3 SmartChoice Acrylic Distemper rows → Kg packs, carton blank

---

## Key learnings / patterns

- **Single-base tab pattern:** when a tab has only white, put the *variant* in `baseColour` and show the real base/capability subtly on the **second line** (not a line-1 alias suffix). `getSecondLine()` + `isVariantQualifierTab()` keep the headline clean.
- **No double-noun headline:** when a variant name already contains the tab word ("Primer"), drop the tab prefix — show the variant's own name as the headline.
- **Cross-section brand family = its own section + family tile** (WS pattern). The tile is the real entry; the section is just the browse bucket.
- **Verification reports must stay lean.** A CSV-gen run earlier in this work rabbit-holed ~53 min on a cosmetic distemper-report regex (descriptions abbreviate "SmartChoice" → "SmartC") while the CSV itself was already correct. Prompts now carry an explicit "keep reports lean, time-box, STOP and report" guard.

---

## Open follow-ups

1. **Slim stock umbrella dupes (optional cleanup):** stock still carries the pre-existing umbrella `-PROMISE` cross-list duplicate rows. They are hidden and collapse in the route's packMap dedup (hydration-harmless) and the menu umbrella is fully removed — so no user-facing cross-listing. A small slim pass would make the "no cross-listing" truly clean at the data level.
2. **Fold this doc** into `CLAUDE_PLACE_ORDER.md` (family/section/tab + speed-dial) and `CLAUDE_UI.md` (single-base second-line display) at next consolidation, then archive.
