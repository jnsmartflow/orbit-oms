# Code update — Acrylic Primer Int/Ext swap fix

**Date:** 2026-06-09
**Commit:** `f217a1f7` (direct to `main`, pushed). Menu reseed live (stock untouched).
**Status:** Live, verified.

## Symptom
Desktop `/place-order` order email printed Primer lines with Interior/Exterior **swapped** vs the cart labels — Int card → "EXTERIOR ACRYLIC PRIMER", Ext card → "INTERIOR ACRYLIC PRIMER".

## Root cause (data, not code)
The two PRIMER menu rows in `mo_order_form_index_v2` (ids 12569/12570, was 12131/12132 pre-reseed) had **`subProduct` swapped relative to `displayName`**. Introduced in the 2026-06-08 Primer rebuild.
- Cart renders `displayName` → looked correct.
- Email (`email.ts:119`) and the **pack-join** (`api/place-order/data/route.ts:164`) both read `product ?? subProduct`; `product` is null → they fell back to the swapped `subProduct`.
- So the bug was **not just the email word** — the Int card was joining the **Exterior** stock (and vice versa). Invisible only because both primers share 1L/4L/10L/20L. `email.ts` was correct throughout.

## Fix
Seed-side swap on the two rows in `taxonomy-preview.json` (then menu reseed):
- `subProduct`: Int → "INTERIOR ACRYLIC PRIMER", Ext → "EXTERIOR ACRYLIC PRIMER" (verified byte-for-byte against `mo_sku_lookup_v2.product` so the join holds).
- `searchTokens` brand fragments: DUWEL → Int, WS PRIME COAT / PRIME COAT → Ext (shared "ACRYLIC PRIMER" left on both).

Live result: Int card → interior SAPs (IN323168xx, DUWEL) + email "INTERIOR ACRYLIC PRIMER"; Ext card → exterior SAPs (IN324000xx, WS Prime Coat) + email "EXTERIOR ACRYLIC PRIMER"; search "duwel"→Int, "prime coat"→Ext. Menu steady 438; SUPERCOVER/SUPERCLEAN unchanged.

## ⚠️ Operational follow-up
Primer orders placed via `/place-order` between the **2026-06-08 rebuild** and this fix may have billed the **opposite SAP** (Int order → exterior code, and vice versa). Worth auditing recent Primer orders / dispatches for that window.

## Learning
When a menu row's `product` is null, `email.ts`, the pack-join, **and** search all fall back to `subProduct`. A `subProduct` that doesn't match `displayName` therefore silently mis-bills and mis-searches while the cart still looks right. **Rule:** for any family joining via `subProduct` fallback, `subProduct` must equal the stock `product` for the intended side — verify cart label ↔ subProduct ↔ stock.product alignment whenever a multi-product family (Int/Ext, variants) is built or rebuilt.

## Consolidation target
- **CLAUDE_PLACE_ORDER.md** — Primer section: note the subProduct↔displayName alignment rule + the `product ?? subProduct` fallback chain (email + join + search).
