# code-update-2026-07-16 — Carton overrides, PLACE_ORDER §9 corrections, SKU data fixes

**Target canonical file:** `CLAUDE_PLACE_ORDER.md` §9 (pack step map), §schema (mo_sku_lookup_v2), landmine list
**Session type:** discovery + code change (shipped) + SQL data fixes

---

## 1. CORRECTION — §9 pack step values are WRONG in the doc

§9 currently states:

> - 1L → step 12 (box of 12)
> - 4L → step 6 (box of 6)

**Both wrong.** Live code (`lib/place-order/pack.ts:113-114`) is `"1L": 6`, `"4L": 4`. The screen ("1 L · box 6") and mobile ("per 6") were correct all along — only the doc was stale. Fix the doc text.

### Full `PACK_STEP_MAP` (pack.ts:108-123) — verified 2026-07-16

| Pack | Step |
|---|---|
| 50ML | 12 |
| 100ML | 24 |
| 200ML | 12 |
| 500ML | 12 |
| **1L** | **6** |
| **4L** | **4** |
| 10L | 1 |
| 20L | 1 |
| 30L | 1 |
| 40KG | 1 |
| 25KG | 1 |
| 30KG | 1 |
| 5KG | 1 |
| "1 pc" | 1 |

Unlisted label → `?? 1` default (pack.ts:154).

### Full `PACK_CONTAINER_MAP` (pack.ts:183-200)

`50ML`→"box 12", `100ML`→"box 24", `200ML`→"box 12", `500ML`→"box 12", `1L`→"box 6", `4L`→"box 4", `10L`/`20L`/`30L`→"drum", `40KG`/`25KG`/`30KG`→"bag", `25PC`→"box of 25", `12PC`→"box of 12", `500PC`→"pack of 500", `400ML`→"can".

### `PIECE_BOX_STEP` (pack.ts:162-166)

`25PC`:25, `12PC`:12, `500PC`:500. Unlisted PC code → `?? 1`.

**Note:** step and container label are **deliberately decoupled** (comment at pack.ts:175-179). `5KG` has step 1 but no `PACK_CONTAINER_MAP` key → no header suffix. The KG columns (1/2/5/10/15/20 KG) likewise have no container entries.

---

## 2. CORRECTION — carton is no longer "pack-label only"

§9 currently states:

> **Carton/box size is a SHARED per-pack constant** (`PACK_STEP_MAP` + `PACK_CONTAINER_MAP`), keyed by pack LABEL — NOT per-SKU.

**Outdated since 2026-06-11.** `PRODUCT_CARTON_OVERRIDES` (pack.ts:139-141) is a **product-scoped** override, checked via `cartonOverride()` (pack.ts:146-149) **before** the global maps, inside **both** `packStep` (152-153) and `packContainerLabel` (203-204) — one table drives both so they can't drift (comment pack.ts:130-131). Explicitly mirrors the `FAMILY_BUCKET_OVERRIDES` precedent (comment pack.ts:125-126).

Keyed by `product ?? subProduct`. Prior to this session the only entry was `"UNIVERSAL STAINER": { "50ML": 20, "100ML": 20, "200ML": 10 }` (uses `subProduct` because its `product` is null).

### Signatures (already scope-aware)

```ts
packStep(packLabel: string, productKey?: string | null): number              // pack.ts:151
packStepForPack(packCode, unit?, productKey?): number                        // pack.ts:168
packContainerLabel(packLabel: string, productKey?: string | null): string|null // pack.ts:202
formatPack(packCode, unit?): string                                          // pack.ts:20 — no productKey, doesn't need one
```

**`product ?? subProduct` is ALREADY threaded at every call site** — no plumbing needed to add a new override:

| Surface | File:line |
|---|---|
| Desktop grid cell | `variant-grid.tsx:296` |
| Desktop header | `variant-grid.tsx:71, 232-243` |
| Desktop cart chip | `cart-panel.tsx:340` |
| /po PackRows | `po-page.tsx:494` |
| /po stepPack (2 closures) | `po-page.tsx:621, 1708` |
| /po stepMultiPack | `po-page.tsx:1471` |
| /po cart chips | `po-page.tsx:2059` |
| /order (frozen) | `app/order/page.tsx:621, 1911` |

---

## 3. LANDMINE — override key shape diverges between step and header

**`packStepForPack` receives the RAW pack label** — it calls `packStep(formatPack(packCode, unit), ...)`, so a 1KG SKU yields `"1KG"`.

**`packContainerLabel` at the desktop header receives the BUCKET label** — called as `packContainerLabel(bucket, activeProductKey)` (`variant-grid.tsx:233`).

For most families these coincide (1L pack → 1L bucket). **For AQUATECH they do not:** KG/GM packs fold into litre buckets via the global `PACK_TO_BUCKET` (§24) — `400GM`/`500GM`→`500ML`, `1KG`→`1L`, `5KG`→`4L`. A bucket-keyed override lookup (`"1L"`) therefore **misses** a raw-keyed override (`"1KG"`) and silently falls through to the global map.

**Rule: `PRODUCT_CARTON_OVERRIDES` keys must be RAW pack labels (`formatPack` output), never bucket labels.**

This is why the Crack Filler header read "1 L · box 6" over 1KG bags whose real carton is 4 — the header described the *column*, the +/- described the *bag*, and they disagreed.

---

## 4. SHIPPED — loose ordering + true cartons (committed to main)

**Files touched:** `lib/place-order/pack.ts`, `app/(place-order)/place-order/components/variant-grid.tsx`. Mobile unchanged. `/order` untouched (frozen). `npx next build` clean.

### 4a. New `PRODUCT_CARTON_OVERRIDES` entries

```ts
"MACHINE TINTER":   { "1L": 1 },
"ACOTONE":          { "1L": 1 },
"GVA":              { "1L": 1 },
"CRACKFILLER 5MM":  { "1KG": 6, "400GM": 12 },
"CRACKFILLER 10MM": { "1KG": 4, "500GM": 12 },
"CRACKFILLER 20MM": { "1KG": 4 },
```

Tab `GVA / PU` stores `product = 'GVA'`. All six keys are real non-null `product` values.

### 4b. `packContainerLabel`: override of 1 → `null`

The override branch previously always synthesised `` `box ${override}` ``, so an override of 1 would render the nonsense **"box 1"**. Now a resolved override of **1 returns null** (no suffix) — a single tin is not a box. No existing override value is 1, so Universal Stainer (20/20/10) is unaffected.

### 4c. Desktop header: per-column agreement

Header previously took its label from `products[0]` alone via the bucket-keyed lookup. Now it computes each present row's container label **from that row's own raw selected pack**, and:

- all rows agree → render the suffix (Gloss `1 L · box 6` byte-identical)
- any disagree, or any null → render the bucket label alone (`1 L`, no suffix)

The carton moved **per-row** onto the existing grey pack hint under each cell (the one already showing `1KG`/`400GM`/`5KG`): format `{rawPack} · box {n}`, suffix omitted when step is 1. No new UI elements; existing element and classes reused.

### 4d. Cart chips — no change needed

All three chip paths already gate on `step > 1`:
- `cart-panel.tsx:341` — `const isClean = step > 1 && units > 0 && units % step === 0;`
- `po-page.tsx:497, 2060` — same shape

So the `· N box` suffix disappears **automatically** at step 1. No separate flag added.

### 4e. Result

| Case | Step | Desktop header | Mobile /po |
|---|---|---|---|
| MACHINE TINTER / ACOTONE / GVA 1L | 6 → **1** | "1 L · box 6" → **"1 L"** | "per 6" → none |
| CRACKFILLER 5MM 1KG | 1 → **6** | tab header "1 L" (rows disagree) | "per 6", hint `1KG · box 6` |
| CRACKFILLER 10MM 1KG | 1 → **4** | "1 L" | "per 4", hint `1KG · box 4` |
| CRACKFILLER 20MM 1KG | 1 → **4** | "1 L" | "per 4", hint `1KG · box 4` |
| CRACKFILLER 5MM 400GM | 1 → **12** | "500 ML · box 12" (agrees) | "per 12" |
| CRACKFILLER 10MM 500GM | 1 → **12** | "500 ML · box 12" | "per 12" (was blank) |

Regression-verified unchanged: **GLOSS 1L** step 6 + "1 L · box 6"; **UNIVERSAL STAINER 50ML** step 20; **10L** step 1 + "drum".

### 4f. Business rule captured

**Machine Tinter / Acotone / GVA are sold LOOSE** (single tins). The real factory carton **is** 6 — `piecesPerCarton` deliberately **not** changed. This is a UI ordering-granularity decision, not a data correction. Do not "fix" the data to 1.

---

## 5. `piecesPerCarton` — current state ("Option B" still parked)

Of 1,743 `isPrimary` rows: **703 populated, 1,040 blank.** Distinct values: 4 (267 rows), 6 (301), 12 (82), 20 (30), 24 (11), 9 (12).

Still **read by no route** — §9's "dead weight" note stands. The parked "Option B" (prefer `piecesPerCarton`, global map as fallback) was **considered and rejected for this cut**: the column already said `6` for Machine Tinter 1L (correct — that IS the carton), so reading it would have changed nothing without also falsifying the data. `PRODUCT_CARTON_OVERRIDES` was the right mechanism because loose-selling is a UI concern, not a data correction.

Option B remains viable if cartons ever diverge *factually* for the same pack label.

---

## 6. Desktop `isPrimary` gap — STILL OPEN, with a new detail

CORE §7.7 / §13 already flag that `/api/place-order/data` doesn't filter `isPrimary`. Confirmed still true (`route.ts:92-97`, no `where` at all).

**New detail worth adding to the landmine list:** `route.ts:137-140` `addToPackMap` dedupes on `` `${key}|||${formatPack(pack.packCode, pack.unit)}` `` — **first one in wins, rest silently dropped** — and the `skuRows` query has **no `orderBy`**, so the winner is unspecified (in practice insertion/id order, i.e. usually the **older** row).

Consequence: on desktop, adding a new SKU alongside an old duplicate may leave the **old** material code showing and silently hide the new one. Setting `isPrimary = false` on the old row does **not** help, because desktop never reads the flag.

**Adding `where: { isPrimary: true }` to that query fixes both problems at once** (old rows stop being fetched → can't win the dedupe). Mirrors `app/api/order/data/route.ts:59-60`. Per §13, edit both routes in step.

---

## 7. CORRECTION — `mo_sku_lookup_v2.packCode` is TEXT, not an enum

Schema docs describe `packCode  PackCode  — enum`. **Live column is `text`** (`information_schema`, verified). Values are bare numbers as text: `"1"`, `"4"`, `"10"`, `"20"`, `"500"`, `"400"`, `"12"`, `"25"`. `unit` is separate (`"L"`, `"ML"`, `"KG"`, `"GM"`, `"PC"`).

Other verified facts:
- `isPrimary` boolean, db default **true**
- `createdAt` has db default `now()`
- **No `updatedAt` column** (unlike `delivery_point_master` — see the sibling draft; do not carry the `updatedAt = now()` habit here)
- `id` `nextval('mo_sku_lookup_v2_id_seq')`
- NOT NULL: `material`, `description`, `category`, `product`, `baseColour`, `packCode`, `isPrimary`, `createdAt`. Nullable: `unit`, `paintType`, `materialType`, `piecesPerCarton`, `refMaterial`, `refDescription`.

---

## 8. SKU data fixes shipped

### 8a. Added — DN GLOSS DA GREY 10LT

`IN28010582`, product `GLOSS`, baseColour `DA GREY`, packCode `"10"`, unit `L`, paintType `oil`, materialType `enamel`, isPrimary true. Menu row already existed (Gloss DA GREY) so **no `mo_order_form_index_v2` work was needed** — the pack simply attached.

### 8b. Fixed — WS Powerflexx 90 BASE showing only 1L

Three SKUs were filed under `baseColour = 'BRILLIANT WHITE'` but are **90 BASE**:

| material | was | now | description |
|---|---|---|---|
| 5771986 | BRILLIANT WHITE | **90 BASE** | DN WS POWERFLEXX **WHITE BASE** 4L |
| 5771987 | BRILLIANT WHITE | **90 BASE** | DN WS POWERFLEXX **WHITE BASE** 10L |
| 5771988 | BRILLIANT WHITE | **90 BASE** | DN WS POWERFLEXX **WHITE BASE** 20L |

Evidence: consecutive SAP block `5771985/86/87/88` = one family (85 is `90 BASE 1L`); Brilliant White has its own complete set `5771981/82/83/84` (`WHITE 1L/4L/10L/20L`).

Fixed **two** bugs at once: 90 BASE showed only 1L; Brilliant White showed **duplicate** 4L/10L/20L.

**Pattern to watch: `"WHITE BASE"` in a description does NOT mean Brilliant White.** This is the WHITE vs WHITE BASE mismatch from the SKU audit list — other products likely carry the same misfiling.

**Cosmetic leftover:** the three moved rows still *say* "WHITE BASE 4L/10L/20L" in `description`. Harmless (join is on `baseColour`, not description) but confusing to read. Not renamed.

---

## 9. ROADMAP items opened this session

- **Brush/roller 645xxxx → 647xxxx series swap** — SAP re-coded the entire TOOLS range. Full mapping verified (18 clean 1-to-1 swaps, 2 region merges → "All India", 9 brand-new types incl. Refill/Combo/2-inch, 3 Signature 4" discontinued with no replacement). Execution briefing prepared, **not started**. Blocked on: **6472101 "Smart Unifiber Int. Roller 9\" NUT New" appears to be a second new code for the same product as 6474083** — is NUT a distinct sellable variant or a duplicate? Ask JSW. Also: the source file contains 2 gift items (Casio watch 6473320, Philips fan 6473743) to skip, and `STICKERS` 6028563 in v2 is not brush/roller — do not touch.
- **Desktop `isPrimary` filter** — one-line fix, prerequisite for any SKU retirement (see §6). Ships with the brush/roller swap.
- **`CRACKFILLER 5MM 300G`** — null `packCode` → renders nowhere on any surface. Needs its own look.
- **WHITE vs WHITE BASE sweep** — the Powerflexx fix (§8b) is likely not isolated. Worth a catalog-wide query for `description ILIKE '%WHITE BASE%'` rows sitting under `baseColour = 'BRILLIANT WHITE'`.
- **Powerflexx description cleanup** — 5771986/87/88 descriptions still read "WHITE BASE" (cosmetic).
