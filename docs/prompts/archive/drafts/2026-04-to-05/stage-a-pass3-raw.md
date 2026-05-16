# Stage A — Pass 3 raw findings — Composite-key joins involving mo_sku_lookup.product

Generated: 2026-05-07

---

## Summary

- Composite-key string concatenations involving `.product` from a SKU-shaped object: 5 distinct call sites across 4 files
  - 4 sites use SKU-shaped objects (`s`, `pm`, `r`, `result.productName`) directly
  - 1 site uses the form-index counterpart `subProduct` (consumes a SKU-built Map)
  - +2 ancillary sites use `pk.product` from `mo_product_keywords` (not a SKU object — listed separately)
- Maps keyed on SKU-composite strings: 4 (`byCombo`, `byComboAlt`, `byMaterial`, `packMap`)
  - 3 use `Map<string, SkuEntry>` with composite keys; `byMaterial` is single-field; `packMap` is `Map<string, Set<string>>` cross-table
- Prisma `where` clauses with multi-field filters on `mo_sku_lookup`: 1 (`app/api/mail-orders/skus/route.ts:24-34`)
- Cross-table joins on product string match: 1 (`mo_sku_lookup.product` + `.baseColour` ↔ `mo_order_form_index.subProduct` + `.baseColour`, in `app/api/order/data/route.ts`)

---

## Step 1 — Concatenation patterns

### lib/mail-orders/enrich.ts

**Line 276** — composite key

Fields combined: `s.product` + `s.baseColour` + `s.packCode`
Separator: `|`
Stored in: `key`
Variable holding SKU: `s` (iterated from `skus: SkuEntry[]` parameter of `buildSkuMaps`)

```
273:   const byMaterial = new Map<string, SkuEntry>();
274:
275:   for (const s of skus) {
276:     const key = `${s.product}|${s.baseColour}|${s.packCode}`;
277:     if (!byCombo.has(key)) {
278:       byCombo.set(key, s);
279:     } else if (!byComboAlt.has(key)) {
```

**Line 639** — composite key (read side)

Fields combined: `pm.product` + `base` + `pack`
Separator: `|`
Stored in: `key`
Variable holding "SKU-product token": `pm` is a `ProductMatch` `{ keyword, product, len }` — `pm.product` is the string product name. `base` and `pack` are loop variables iterating per-product candidates.

```
636:     // Try each base × pack against SKU table
637:     for (const base of basesToTry) {
638:       for (const pack of packsToTry) {
639:         const key = `${pm.product}|${base}|${pack}`;
640:         const sku = skuByCombo.get(key);
641:         if (!sku) continue;
642:
```

**Lines 521 and 541** — ancillary (NOT SKU-shape; ProductKeyword dedup key)

Fields combined: `pk.product` + `pk.keyword` (both from `mo_product_keywords`)
Separator: `|`
Stored in: `dedup`
Variable: `pk` is a `ProductKeyword` row, not a SKU. Listed for completeness because the key uses `.product`.

```
518:   for (const pk of productKeywords) {
519:     const re = prodRegexMap.get(pk.keyword);
520:     if (!re || !re.test(text)) continue;
521:     const dedup = `${pk.product}|${pk.keyword}`;
522:     if (seenProdKw.has(dedup)) continue;
523:     seenProdKw.add(dedup);
524:     prodMatches.push({
```

```
538:       for (const pk of productKeywords) {
539:         const re = prodRegexMap.get(pk.keyword);
540:         if (!re || !re.test(correctedText)) continue;
541:         const dedup = `${pk.product}|${pk.keyword}`;
542:         if (seenProdKw.has(dedup)) continue;
543:         seenProdKw.add(dedup);
544:         prodMatches.push({
```

---

### app/api/mail-orders/re-enrich/route.ts

**Line 109** — composite key (read side)

Fields combined: `result.productName` + `result.baseColour` + `result.packCode`
Separator: `|`
Stored in: `matchedKey`
Variable holding fields: `result` is `EnrichResult` from `enrichLine(...)` — productName/baseColour/packCode mirror SKU `product`/`baseColour`/`packCode`. Used to look up a SKU via `skuByCombo.get(matchedKey)`.

```
106:     let cartonCount: number | null = line.cartonCount;
107:
108:     if (line.isCarton && result.matchStatus === "matched" && result.skuCode) {
109:       const matchedKey = `${result.productName}|${result.baseColour}|${result.packCode}`;
110:       const matchedSku = skuByCombo.get(matchedKey);
111:       const originalCartonQty = line.cartonCount ?? line.quantity;
112:       if (matchedSku?.piecesPerCarton) {
```

---

### app/api/mail-orders/ingest/route.ts

**Line 374** — composite key (read side)

Fields combined: `result.productName` + `result.baseColour` + `result.packCode`
Separator: `|`
Stored in: `matchedKey`
Variable holding fields: `result` is `EnrichResult` from `enrichLine(...)`. Same shape as re-enrich. Used to look up a SKU via `skuByCombo.get(matchedKey)`.

```
371:       let cartonCount: number | null = null;
372:
373:       if (isCarton && result.matchStatus === "matched" && result.skuCode) {
374:         const matchedKey = `${result.productName}|${result.baseColour}|${result.packCode}`;
375:         const matchedSku = skuByCombo.get(matchedKey);
376:         if (matchedSku?.piecesPerCarton) {
377:           cartonCount = line.quantity;
```

---

### app/api/order/data/route.ts

**Line 93** — composite key (build side, SKU)

Fields combined: `r.product` + `r.baseColour`
Separator: `|||`
Stored in: ad-hoc string passed to `addToPackMap(...)`
Variable holding SKU: `r` (iterated from `skuRows` — direct DB result of `prisma.mo_sku_lookup.findMany`)

```
90:       const pack = String(r.packCode);
91:       addToPackMap(r.product, pack);
92:       if (r.baseColour) {
93:         addToPackMap(`${r.product}|||${r.baseColour}`, pack);
94:       }
95:     }
96:
```

Note: line 91 is also a "key" — single-field bare `r.product` — uses the same `packMap` but with non-composite key (product alone).

**Line 101** — composite key (read side, form-index)

Fields combined: `row.subProduct` + `row.baseColour`
Separator: `|||`
Stored in: `packKey`
Variable holding row: `row` (iterated from `indexRows` — `prisma.mo_order_form_index.findMany`). NOT a SKU object; this is the cross-table read side that consumes the SKU-built `packMap`.

```
98:     //    (product, baseColour) when baseColour is set, else product alone.
99:     const products = indexRows.map((row) => {
100:       const packKey = row.baseColour
101:         ? `${row.subProduct}|||${row.baseColour}`
102:         : row.subProduct;
103:       return {
104:         family:       row.family,
```

---

## Step 2 — Map key constructions

### Map: `byCombo` in `lib/mail-orders/enrich.ts`

Type: `Map<string, SkuEntry>`
Declared: line 271
Key shape: `${product}|${baseColour}|${packCode}` (`s.product`, `s.baseColour`, `s.packCode`)
Returned from `buildSkuMaps(skus)` — passed by callers to `enrichLine`/`enrichLineCore` as the `skuByCombo` parameter.

Populated at:
- `lib/mail-orders/enrich.ts:278` — `byCombo.set(key, s)` (inside `buildSkuMaps`, key from line 276)

Read at:
- `lib/mail-orders/enrich.ts:640` — `const sku = skuByCombo.get(key)` (key from line 639: `${pm.product}|${base}|${pack}`)
- `app/api/mail-orders/re-enrich/route.ts:110` — `const matchedSku = skuByCombo.get(matchedKey)` (matchedKey from line 109)
- `app/api/mail-orders/ingest/route.ts:375` — `const matchedSku = skuByCombo.get(matchedKey)` (matchedKey from line 374)
- `lib/mail-orders/enrich.ts:277, 279` — `byCombo.has(key)`

```
271:   const byCombo = new Map<string, SkuEntry>();
272:   const byComboAlt = new Map<string, SkuEntry>(); // alternate SKU for same combo
273:   const byMaterial = new Map<string, SkuEntry>();
```

---

### Map: `byComboAlt` in `lib/mail-orders/enrich.ts`

Type: `Map<string, SkuEntry>`
Declared: line 272
Key shape: identical to `byCombo` — `${product}|${baseColour}|${packCode}`
Returned from `buildSkuMaps(skus)` — passed by callers to `enrichLine`/`enrichLineCore` as `skuByComboAlt`.

Populated at:
- `lib/mail-orders/enrich.ts:280` — `byComboAlt.set(key, s)` (only when `byCombo` already has same key — captures duplicate combos)

Read at:
- `lib/mail-orders/enrich.ts:689` — `const altSku = skuByComboAlt?.get(key) ?? null`

```
277:     if (!byCombo.has(key)) {
278:       byCombo.set(key, s);
279:     } else if (!byComboAlt.has(key)) {
280:       byComboAlt.set(key, s);
281:     }
282:     byMaterial.set(s.material, s);
```

---

### Map: `byMaterial` in `lib/mail-orders/enrich.ts`

Type: `Map<string, SkuEntry>`
Declared: line 273
Key shape: bare `s.material` — SINGLE-FIELD, not composite. Listed for completeness because of SKU-shape value type.

Populated at:
- `lib/mail-orders/enrich.ts:282` — `byMaterial.set(s.material, s)`

Read at:
- `lib/mail-orders/enrich.ts:459` — `const sku = skuByMaterial.get(noWs)` (where `noWs` is the trimmed raw text matching `/^(IN)?\d{5,10}$/`)

---

### Map: `packMap` in `app/api/order/data/route.ts`

Type: `Map<string, Set<string>>`
Declared: line 79
Key shape: dual-keyed — bare `r.product` (line 91) OR `${r.product}|||${r.baseColour}` (line 93)
Value: a `Set<string>` of pack codes
Local to this route (not exported).

Populated at:
- `app/api/order/data/route.ts:80-87` — `addToPackMap(key, pack)` helper that lazily creates Set buckets
- `app/api/order/data/route.ts:91` — `addToPackMap(r.product, pack)` (key = product alone)
- `app/api/order/data/route.ts:93` — `addToPackMap(\`${r.product}|||${r.baseColour}\`, pack)` (composite)

Read at:
- `app/api/order/data/route.ts:111` — `packMap.get(packKey) ?? new Set()` (packKey from line 100-102: composite if `row.baseColour`, else bare `row.subProduct`)

```
79:     const packMap = new Map<string, Set<string>>();
80:     const addToPackMap = (key: string, pack: string): void => {
81:       let bucket = packMap.get(key);
82:       if (!bucket) {
83:         bucket = new Set();
84:         packMap.set(key, bucket);
85:       }
86:       bucket.add(pack);
87:     };
```

```
108:       searchTokens: row.searchTokens,
109:       tinterType:   row.tinterType ?? null,
110:       productType:  row.productType ?? "PLAIN",
111:       packs:        sortPacks(packMap.get(packKey) ?? new Set()),
112:       };
113:     });
```

---

## Step 3 — Prisma multi-field where clauses

### app/api/mail-orders/skus/route.ts

**Line 24** — `findMany` with composite where (dynamic `AND` of `OR`-groups, multi-field)

Operation: `findMany`
Fields filtered: `material`, `description`, `product`, `baseColour` — all four searched per word, words AND'd together
Notes: This is a typeahead search — for each whitespace-separated word in the query, the row must match the word in at least one of those four fields.

```
22:   const words = q.trim().toUpperCase().split(/\s+/).filter((w) => w.length > 0);
23:
24:   const skus = await prisma.mo_sku_lookup.findMany({
25:     where: {
26:       AND: words.map((word) => ({
27:         OR: [
28:           { material: { contains: word, mode: "insensitive" as const } },
29:           { description: { contains: word, mode: "insensitive" as const } },
30:           { product: { contains: word, mode: "insensitive" as const } },
31:           { baseColour: { contains: word, mode: "insensitive" as const } },
32:         ],
33:       })),
34:     },
35:     orderBy: { description: "asc" },
36:     take: limit,
```

No other `mo_sku_lookup` query in the in-scope files filters on more than one field. All others are unfiltered (`findMany()`), single-field (`findUnique` by `material`, `findMany` by `refMaterial`), or do not use `where`.

---

## Step 4 — Cross-table joins

### Join: `mo_sku_lookup.product` + `.baseColour` ↔ `mo_order_form_index.subProduct` + `.baseColour`

Location: `app/api/order/data/route.ts`, GET handler.
Match type: exact string equality, dual-keyed (product-only OR product+baseColour).

**SKU-side query — line 61, selects 3 fields**

```
61:     const skuRows = await prisma.mo_sku_lookup.findMany({
62:       select: { product: true, baseColour: true, packCode: true },
63:     });
```

**Form-index-side query — line 46, selects 8 fields**

```
46:     const indexRows = await prisma.mo_order_form_index.findMany({
47:       where:   { isActive: true },
48:       select: {
49:         family:       true,
50:         subProduct:   true,
51:         baseColour:   true,
52:         displayName:  true,
53:         searchTokens: true,
54:         tinterType:   true,
55:         productType:  true,
56:         sortOrder:    true,
57:       },
58:       orderBy: [{ family: "asc" }, { sortOrder: "asc" }],
59:     });
```

**Build side (SKU) — lines 88–95**

```
88:     for (const r of skuRows) {
89:       if (!r.product || !r.packCode) continue;
90:       const pack = String(r.packCode);
91:       addToPackMap(r.product, pack);
92:       if (r.baseColour) {
93:         addToPackMap(`${r.product}|||${r.baseColour}`, pack);
94:       }
95:     }
```

**Read side (form-index) — lines 99–113**

```
99:     const products = indexRows.map((row) => {
100:       const packKey = row.baseColour
101:         ? `${row.subProduct}|||${row.baseColour}`
102:         : row.subProduct;
103:       return {
104:         family:       row.family,
105:         subProduct:   row.subProduct,
106:         baseColour:   row.baseColour ?? null,
107:         displayName:  row.displayName,
108:         searchTokens: row.searchTokens,
109:         tinterType:   row.tinterType ?? null,
110:         productType:  row.productType ?? "PLAIN",
111:         packs:        sortPacks(packMap.get(packKey) ?? new Set()),
112:       };
113:     });
```

The join condition is implicit: `mo_sku_lookup.product === mo_order_form_index.subProduct` AND (`mo_sku_lookup.baseColour === mo_order_form_index.baseColour` OR `mo_order_form_index.baseColour IS NULL`). Implemented entirely in JS via the `packMap`.

**Other tables/files that perform the same kind of `mo_sku_lookup ↔ mo_order_form_index` join:** none found in `lib/`, `app/`. Scripts under `scripts/` operate on `mo_order_form_index` for backup/restore/seed/spotcheck but do not join it back to `mo_sku_lookup` at runtime.

**Other places that handle `subProduct` (form-index field) but DO NOT join to mo_sku_lookup:**
- `lib/place-order/email.ts:25,82,83` — uses `subProduct` from product line records (already-joined catalog), not from a mo_sku_lookup row.
- `lib/mail-orders/taxonomy-mapping.ts` — pure mapping function transforming legacy SKU triples into new form-index rows; not a runtime join.
- `app/order/page.tsx`, `app/(place-order)/place-order/...` — UI consumers of `/api/order/data` JSON. Reuse `subProduct|||baseColour` separator to dedup/identify lines client-side, but don't query mo_sku_lookup themselves.
- `scripts/preview-new-taxonomy.ts:60` — `${t.category}|||${t.product}|||${t.baseColour}` triple key over legacy SKU triples (in-script tuple identity, not a Map join to a SKU value type).
- `scripts/preview-new-taxonomy-from-csv.ts:263`, `scripts/phase1-seed-mo-order-form-index.ts:180` — keys built from `subProduct`/`baseColour` for dedup during reseed; operate purely on form-index payload.

---

## Composite key shape catalogue

| Key shape | Used in | Files |
|---|---|---|
| `${product}\|${baseColour}\|${packCode}` | `byCombo`, `byComboAlt` | `lib/mail-orders/enrich.ts:276` (build, from `s.product`); read sites: `enrich.ts:639` (`pm.product`), `app/api/mail-orders/re-enrich/route.ts:109` (`result.productName`), `app/api/mail-orders/ingest/route.ts:374` (`result.productName`) |
| `${product}\|\|\|${baseColour}` | `packMap` (SKU-side build) | `app/api/order/data/route.ts:93` (`r.product`) |
| `${subProduct}\|\|\|${baseColour}` | `packMap` (form-index read) | `app/api/order/data/route.ts:101` (`row.subProduct`) |
| bare `product` | `packMap` (single-field build); `packMap` (single-field read when `baseColour` is null) | `app/api/order/data/route.ts:91` (write); `app/api/order/data/route.ts:102` (read) |
| bare `material` | `byMaterial` | `lib/mail-orders/enrich.ts:282` (write), `enrich.ts:459` (read) |
| `${pk.product}\|${pk.keyword}` | `seenProdKw` dedup Set (ProductKeyword, NOT SKU-shape) | `lib/mail-orders/enrich.ts:521, 541` |

---

## End of Pass 3
