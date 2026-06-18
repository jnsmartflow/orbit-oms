# Code Update — Desktop Pack-Bucket Fix (Aquatech KG/GM packs) + Family Override

- **Date:** 2026-06-04
- **Commit:** on `main`, follow-on to `d50db83c`
- **Status:** Shipped & verified live (desktop)
- **Scope:** desktop `/place-order` display only — no DB, no pack-data, no reseed
- **Save to:** `docs/prompts/drafts/code-update-2026-06-04-desktop-pack-buckets-aquatech.md`

---

## Summary

Several Aquatech KG/GM packs weren't showing on the **desktop** variant grid (Crackfiller 5mm 400GM, Waterblock 2K 3KG + 15KG), and PU Coat's 25KG sat in a lonely dedicated column. Mobile `/order` showed them fine. Fixed by adding the missing pack keys to the shared bucket table and adding a new **family-scoped override** so Aquatech's 25KG lands in the 20L column without disturbing other families.

---

## How the desktop columns actually work (the mechanism)

`lib/place-order/pack-buckets.ts` drives **all** desktop family/tab columns (the route only sorts/dedups raw packs; bucketing is entirely frontend; mobile `/order` does not import this file — it renders each pack via `formatPack`, which is why mobile never had this problem).

- `STANDARD_COLUMNS` — the fixed, ordered column set (`50ML … 20L, 25KG, 30KG, 40KG`).
- `PACK_TO_BUCKET` — a **global** map from a pack key (`packCode + normalisedUnit`, e.g. `"400GM"`, `"3KG"`) to one of the standard columns.
- `packToBucket(pack)` returns the bucket, or **`null` if the key isn't in the map**.
- `bucketColumnsForTab(packs)` returns only the standard columns that ≥1 pack maps to.
- `variant-grid.tsx` builds the columns from this and fills each cell with the product's pack that maps to that bucket.

**Key behaviour:** a pack whose key isn't in `PACK_TO_BUCKET` returns `null` → it creates no column and fills no cell → it is **silently dropped on desktop** (no warning). That's exactly why 400GM / 3KG / 15KG vanished.

---

## The fix

**1. Global additions to `PACK_TO_BUCKET`** (these sizes belong only to the products noted, so global is safe):

| Pack key | → Bucket column | Used by |
|---|---|---|
| `400GM` | `500ML` | AQUATECH / Crackfiller 5mm only |
| `3KG` | `4L` | AQUATECH / Waterblock 2K only |
| `15KG` | `20L` | AQUATECH / Waterblock 2K **and** VT SPECIALTY / VT Concrete Finish |

**2. New family-scoped override mechanism** — `FAMILY_BUCKET_OVERRIDES` in `pack-buckets.ts`:

```
FAMILY_BUCKET_OVERRIDES = { "AQUATECH": { "25KG": "20L" } }
```

- `packToBucket(pack, family?)` and `bucketColumnsForTab(packs, family?)` now take an optional family and check the override **first**, else fall back to the global `PACK_TO_BUCKET`.
- `variant-grid.tsx` passes `products[0]?.family` (the grid renders one family per tab, so all products share it) into both calls, and added it to the two `useMemo` dep arrays.
- The global `"25KG" -> "25KG"` entry is **left unchanged**, so every other family keeps its 25KG column.

---

## Why the 25KG move had to be Aquatech-scoped (not global)

**VT Concrete Finish carries both 15KG and 25KG.** A fully-global `25KG -> 20L` (alongside the new `15KG -> 20L`) would send both of its packs to the same 20L column → collision → the grid shows only one pack per bucket, **silently hiding the other**. That violates the "nothing vanishes" rule.

Scoping `25KG -> 20L` to AQUATECH only means:
- Aquatech PU Coat: 5KG (4L) + 25KG (20L), no lonely 25KG column. ✓
- VT Concrete Finish: 15KG now shows (20L) **and** 25KG stays in its own 25KG column — both visible, no collision. ✓

---

## Net effects (verified live, desktop)

- **Aquatech / Ext-Int Coat:** PU Coat shows 5KG (4L col) + 25KG (20L col); the separate 25KG·bag column is gone.
- **Aquatech / Crack Filler:** Crackfiller 5mm shows 400GM (500ML col) + 1KG (1L col); columns still 500ML / 1L / 4L (no new column).
- **Aquatech / Additives:** Waterblock 2K shows 3KG (4L) + 15KG (20L) — was a blank row before.
- **Bonus:** VT Concrete Finish's 15KG (previously hidden everywhere on desktop) now shows under 20L.
- **Unchanged:** Texture/Rustic 25KG own column; litre-only families (Gloss/Promise); mobile `/order`; route; DB; pack data.
- `tsc --noEmit` clean; `npm run build` green.

---

## Learnings

- **Desktop columns are a fixed bucket set, not the pack union.** Any pack whose `packCode+unit` key is missing from `PACK_TO_BUCKET` is *silently dropped on desktop only* — mobile renders every pack, so a missing bucket key looks like "works on phone, blank on desktop."
- **`PACK_TO_BUCKET` is global by pack key.** Before adding a key, check the blast radius (which other families carry that exact pack). For placement that should differ by family, use **`FAMILY_BUCKET_OVERRIDES`** rather than changing the global map.
- **Two packs on one product that map to the same bucket collide** — one is hidden. Watch for any product carrying two sizes that land in one column (this is what forced the 25KG scoping for VT Concrete Finish).

---

## Flagged, NOT done (separate data issue)

- **Crackfiller 5mm `300G` (5964276)** has an **empty `packCode`** in `mo_sku_lookup_v2`, so the route drops it before bucketing ever runs — it's hidden **everywhere, including mobile**. This is a data fix (set `packCode=300`, `unit=GM`), not a bucket-map fix. *Note:* if 300G is added and mapped to `500ML`, it would collide with 400GM on 5mm (both → 500ML) — they'd need different buckets. Only pursue if 300G is a real, stocked pack.

---

## Suggested canonical doc edits (at next consolidation)

- `CLAUDE_PLACE_ORDER.md` §7-§9 / `CLAUDE_UI.md` §27: document `pack-buckets.ts` (`STANDARD_COLUMNS`, `PACK_TO_BUCKET`, `packToBucket`, `bucketColumnsForTab`) as the desktop column source, the silent-drop behaviour for unmapped keys, and the new `FAMILY_BUCKET_OVERRIDES` family-scoped placement mechanism.
