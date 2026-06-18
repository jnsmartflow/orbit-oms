# code-update 2026-05-30 — /order product-list dedup (isPrimary + mobileFamily)

Two related cleanups shipped to `/order` this session. Consolidate into
`CLAUDE_PLACE_ORDER.md` (and the schema note in `CLAUDE_CORE.md`).

---

## 1. SKU pack dedup — `mo_sku_lookup_v2.isPrimary`

**New column:** `isPrimary Boolean @default(true)`

**Why:** litre packs were doubling on `/order` (1L/4L/10L/20L each shown twice)
because the same logical pack existed under multiple SAP material codes
(L vs LT unit spellings, old vs new codes).

**How "primary" was chosen:** from the AltSKU master (depot **Q53D** rows only).
For each code, the alternate at the **highest priority number** is the current
live SKU. (NOT always priority 3 — chain depth varies 1–5.)

**Result:** 130 confirmed duplicate twins set `isPrimary = false`; 1,512 stay
`true`. **No rows deleted** — reversible with one UPDATE.

**Code:** `/api/order/data` route — `where: { isPrimary: true }` added to the
`mo_sku_lookup_v2.findMany` (~line 58). `/api/place-order/data` (desktop) left
unfiltered — out of scope.

**Commit:** `e4731423`

---

## 2. Promise product dedup — `mo_order_form_index_v2.mobileFamily`

**New column:** `mobileFamily String?`

**Why:** the source taxonomy had a "PROMISE umbrella" family that mirrored every
specific Promise product (Interior/Exterior/Enamel), so each showed twice on
`/order` (once as PROMISE, once as PROMISE INTERIOR/etc.).

**Fix is in the seed:** `scripts/v2-catalog-seed-from-preview.ts`
- **Path fix:** `PREVIEW_PATH` moved to
  `docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json`
  (old path was deleted — seed would crash otherwise).
- **mobileFamily rule:** `"PROMISE"` if family ∈ {PROMISE, PROMISE INTERIOR,
  PROMISE EXTERIOR, PROMISE ENAMEL} **OR** subProduct starts with "PROMISE" /
  contains "SMARTCHOICE"; otherwise `mobileFamily = family`.
- **Umbrella collapse:** drop the 45 PROMISE-umbrella rows that mirror a specific
  sibling; merge their `searchTokens` into the kept (richer) specific row.
- **SmartChoice primer merge:** `SMARTCHOICE EXT/INT PRIMER` folded into
  `PROMISE SMARTCHOICE EXT/INT PRIMER` (same SAP code — confirmed: 5769950-series
  / 5760016-series). Full name kept.
- **Promise mobile de-dupe:** `PROMISE PRIMER` kept under PRIMER family;
  the stray PROMISE INTERIOR copy dropped.

**Result:** 512 source rows → **409**. `mobileFamily = PROMISE` = 43.
0 within-PROMISE duplicates, 0 collisions.

**Live reseed:** wipe-and-reseed (461 → 409). Backup table:
`mo_order_form_index_v2_bak_20260530`.

**Decision — labels NOT flattened:** we did NOT switch the `/order` page to label
by `mobileFamily`. Once the duplicate rows were gone, the specific family labels
(Interior/Exterior/Enamel) are useful, so the page still labels by `family`. The
`mobileFamily` column exists and is populated, ready if a single-PROMISE label is
ever wanted.

**Desktop `/place-order`:** the umbrella / MULTI-USE Promise listing is gone —
Promise now appears only in the 3 section tiles (Enamel/Exterior/Interior).
SmartChoice paints + primers sit in the Exterior/Interior tiles; SmartChoice
Acrylic Distemper in the Interior tile; plain Promise Primer in the PRIMER tile.

---

## Key engineering facts confirmed this session

- **`/order` is name-based end to end.** The order/email carries the product
  NAME, not a SAP material code. So the fake `-PROMISE` / `-PROMISE_EXTERIOR`
  suffix codes in `mo_sku_lookup_v2` are dead metadata — they never reach an order.
- **The form-index list is generated** by `v2-catalog-seed-from-preview.ts`
  (wipe-and-reseed) from `taxonomy-preview.json`. Anything not fixed in the source
  JSON or the seed transform is resurrected on the next reseed.
- **Search on `/order` is substring match on `searchTokens`** (the keyword string
  stored per form-index row). Which products match a query is purely a function of
  those stored keywords.

---

## Parked / TODO

1. **searchTokens keyword fix (data edit).** "smartchoice" should return all
   SmartChoice incl. SmartChoice Distemper; "distemper" should return generic
   Acrylic + SmartChoice Distemper. Currently the generic Acrylic Distemper wrongly
   carries the "smartchoice" keyword.
2. **Remove fake suffix SKU codes** (`-PROMISE`, `-PROMISE_EXTERIOR/INTERIOR`)
   from `mo_sku_lookup_v2` — the broader suffix cleanup (~91 rows).
3. **SKU dedup leftovers** (from part 1): 56 taxonomy-mess buckets (different
   products sharing one bucket — kept all, need rename), 59 edge buckets (live code
   not in table — kept all, recheck post-test).
4. **`/place-order` desktop** — add the `isPrimary` pack filter if pack-level
   consistency with mobile is wanted.
