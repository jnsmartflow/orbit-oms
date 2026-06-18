# Code Update — Velvet Touch base aliases + PU Enamel (aliases + tile 2 fold)

**Date:** 2026-06-09
**Commits:** `5e7178da` (VT base aliases) · PU Enamel (tile 2 "Satin & PU" + aliases)
**Branch:** main (pushed)

---

## What changed

### 1. Velvet Touch base aliases (6 ranges)
Lit up the friendly base names on Pearl, Platinum, Diamond, Eterna, Eterna Matt, Eterna Hi-Sheen — they now read "92 BASE · Intermediate" etc. instead of bare base codes.

- product was NULL on all 39 rows → aliases dormant. Added 6 identity keys to CONFIRMED_SUBPRODUCT_MAP (PEARL GLO / PLATINUM GLO / DIAMOND GLO / ETERNA / ETERNA MATT / ETERNA HI-SHEEN → self) so product = subProduct (non-null).
- Added 6 blocks to base-aliases.ts (only the numeric bases each range carries): 90 White · 92 Intermediate · 94 Accent · 95 Deep · 96 Yellow · 97 Red. No alias for 93 / Brilliant White / named bases (Pastel, Rare Pearl Copper/Green, Basecoat).
- Menu-only reseed, count steady (432).

### 2. PU Enamel — aliases + folded into tile 2
- Same dormant-alias fix: added identity key PU ENAMEL → self. Its alias block already had 90/92/94 → White/Intermediate/Accent — just lit up.
- §7.7 uiGroup changed from a GLOSS-style base/colour split to a single "PU Enamel" tab.
- Folded into tile 2: familyNames ["SATIN","PU ENAMEL"], label "Satin & PU". PU Enamel is now a third tab (Satin Finish | Satin Stay Bright | PU Enamel) — reachable from the speed dial, not just search. Both are ENAMELS section, so no mismatch. No KG columns (all litre/ml).

### Files
- `scripts/v2-catalog-seed-from-preview.ts` — 7 identity keys total + PU ENAMEL §7.7 uiGroup
- `lib/place-order/base-aliases.ts` — 6 VT blocks (+ PU Enamel comment refresh)
- `lib/place-order/quick-tiles-config.ts` — tile 2 "Satin & PU"

---

## Key learnings

**1. The dormant-alias recipe (reusable for any NULL-product family).**
Aliases only fire when a menu row's `product` is non-null (`getBaseAliasDisplay` guards `if (!product) return null`). Fix = add an identity key (`PRODUCT → self`) to CONFIRMED_SUBPRODUCT_MAP so product = subProduct, ensure the base-aliases.ts block exists, then menu reseed. Join is unchanged (product == subProduct = same key string), so packs still resolve and the count is steady.

**2. Free search bonus.** Setting product also triggers the §7.8 token-bake — the alias words ("intermediate", "accent", "deep") get appended to searchTokens, so they become searchable. (108 rows baked across the VT + PU work.)

**3. Canonical base→name map** (the standard to reuse):
90 White · 92 Intermediate · 94 Accent · 95 Deep · 96 Yellow/YOX · 97 Red/ROX · 98 Vibrant Yellow · 99 Vibrant Red. 93 / Brilliant White / named shades → no alias.

**4. 96/97 naming is inconsistent in the codebase** — WS and Satin use "YOX/ROX" (oxide names); SuperCover and now the VT ranges use plain "Yellow/Red". Worth standardising in the final consistency/section pass.

**5. ENAMELS clubs cleanly.** PU Enamel under the Satin tile is a same-section fold (unlike Texture-under-Putty, which needed a deferred section move). Lustre (also ENAMELS) is the natural next fold for this tile group.

---

## Pending
- Remaining families: **Tile + Metallic** (next, → tile 4 WS) · **Lustre** (→ Enamels) · **Smoothover** (→ tile 8) · **Floor Plus**.
- Two billing audits still open (Primer Int/Ext, Thinner).
- Deferred: section relabels + the 96/97 YOX-vs-Yellow standardisation, in the final CORE pass.
