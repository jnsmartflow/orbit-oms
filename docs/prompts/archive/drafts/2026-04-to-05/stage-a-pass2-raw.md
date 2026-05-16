# Stage A — Pass 2 raw findings — Indirect reads through mo_sku_lookup result objects

Generated: 2026-05-07

---

## Summary

- SKU result variables found: 14 (across 8 files)
  - 8 direct DB result variables (`rows`, `skus`, `sku`, `skuRows`, `skuEntriesRaw` ×4)
  - 4 mapped `SkuEntry[]` variables (`skuEntries` ×4)
  - 2 derived from `skuByCombo.get(...)` (`matchedSku` ×2)
- Functions that receive SKU results as parameters: 4
  - `buildSkuMaps`, `buildProductProfiles`, `enrichLine`/`enrichLineCore`, `resolvedPackCode` (all in `lib/mail-orders/enrich.ts`)
- TypeScript types describing SKU shape: 2
  - `SkuEntry` (active) in `lib/mail-orders/enrich.ts:34`
  - `SkuEntry` (duplicate, not imported anywhere) in `lib/mail-orders/enrich-v2.ts:26`
- Total property-access hits on SKU-shaped objects: 117
- Distinct fields accessed: material, description, category, product, baseColour, packCode, unit, refMaterial, paintType, materialType, piecesPerCarton

---

## SKU result variables (from Step 1)

### lib/fini-resolver.ts

- Line 28: `const rows = await prisma.mo_sku_lookup.findMany({ where: { refMaterial: { in: deduped } }, select: { material, description, refMaterial }, orderBy })`
- Passed into: consumed in same file (iterated as `row` in `for (const row of rows)`)

### app/api/mail-orders/skus/route.ts

- Line 24: `const skus = await prisma.mo_sku_lookup.findMany({ where: ..., select: {material, description, category, product, baseColour, packCode, unit, refMaterial} })`
- Passed into: consumed in same file (iterated as `s` via `skus.map(...)`)

### app/api/mail-orders/re-enrich/route.ts

- Line 27: `prisma.mo_sku_lookup.findMany()` → destructured as `skuEntriesRaw`
- Line 38: mapped (`skuEntriesRaw.map((r) => ({...}))`) → `const skuEntries: SkuEntry[]`
- Passed into: `buildSkuMaps(skuEntries)` (line 53), `buildProductProfiles(skuEntries, productKeywords, baseKeywords)` (line 54)
- Derived: `matchedSku = skuByCombo.get(matchedKey)` at line 110 (consumed in same file)

### app/api/mail-orders/backfill-enrich/route.ts

- Line 44: `prisma.mo_sku_lookup.findMany()` → destructured as `skuEntriesRaw`
- Line 55: mapped (`skuEntriesRaw.map((r) => ({...}))`) → `const skuEntries: SkuEntry[]`
- Passed into: `buildSkuMaps(skuEntries)` (line 69)

### app/api/mail-orders/lines/[lineId]/resolve/route.ts

- Line 52: `const sku = await prisma.mo_sku_lookup.findUnique({ where: { material: body.skuCode } })`
- Passed into: consumed in same file

### app/api/mail-orders/ingest/route.ts

- Line 105: `prisma.mo_sku_lookup.findMany()` → destructured as `skuEntriesRaw`
- Line 116: mapped (`skuEntriesRaw.map((r) => ({...}))`) → `const skuEntries: SkuEntry[]`
- Passed into: `buildSkuMaps(skuEntries)` (line 130), `buildProductProfiles(skuEntries, productKeywords, baseKeywords)` (line 131)
- Derived: `matchedSku = skuByCombo.get(matchedKey)` at line 375 (consumed in same file)

### app/api/mail-orders/debug-enrich/route.ts

- Line 34: `prisma.mo_sku_lookup.findMany()` → destructured as `skuEntriesRaw`
- Line 45: mapped (`skuEntriesRaw.map((r) => ({...}))`) → `const skuEntries: SkuEntry[]`
- Passed into: `buildSkuMaps(skuEntries)` (line 59), `buildProductProfiles(skuEntries, productKeywords, baseKeywords)` (line 60)

### app/api/order/data/route.ts

- Line 61: `const skuRows = await prisma.mo_sku_lookup.findMany({ select: { product, baseColour, packCode } })`
- Passed into: consumed in same file (iterated as `r` in `for (const r of skuRows)`)

---

## Property accesses (Steps 2 + 3)

### lib/fini-resolver.ts

**Variable: `row` (from `rows`)**

**Lines 36–38** — accesses `.refMaterial` (×3), `.material`, `.description` (merged window)

```
33:
34:   const map = new Map<string, FiniPair>();
35:   for (const row of rows) {
36:     if (row.refMaterial == null) continue;
37:     if (map.has(row.refMaterial)) continue;
38:     map.set(row.refMaterial, { material: row.material, description: row.description });
39:   }
40:   return map;
41: }
```

---

### app/api/mail-orders/skus/route.ts

**Variable: `s` (from `skus`)**

**Lines 51–61** — accesses `.material`, `.description`, `.category`, `.product`, `.baseColour`, `.packCode` (×2), `.unit`, `.refMaterial` (merged window)

```
48:
49:   const pack = searchParams.get("pack") ?? "";
50:
51:   const results = skus.map((s) => ({
52:     material: s.material,
53:     description: s.description,
54:     category: s.category ?? "",
55:     product: s.product,
56:     baseColour: s.baseColour,
57:     packCode: s.packCode,
58:     unit: s.unit ?? "",
59:     refMaterial: s.refMaterial ?? "",
60:     packMatch: pack ? s.packCode === pack : true,
61:   }));
```

**Variable: `a`/`b` (projected from `skus`, retains `description`)**

**Line 66** — accesses `.description` (×2)

```
63:   // Sort: pack matches first, then alphabetical within each group
64:   results.sort((a, b) => {
65:     if (a.packMatch !== b.packMatch) return a.packMatch ? -1 : 1;
66:     return a.description.localeCompare(b.description);
67:   });
68:
69:   return NextResponse.json({ skus: results });
```

---

### app/api/mail-orders/re-enrich/route.ts

**Variable: `r` (from `skuEntriesRaw`)**

**Lines 38–50** — accesses `.material`, `.description`, `.category`, `.product`, `.baseColour`, `.packCode`, `.unit`, `.refMaterial`, `.paintType`, `.materialType`, `.piecesPerCarton` (merged window)

```
35:     .map((r) => ({ keyword: r.keyword, category: r.category, baseColour: r.baseColour }))
36:     .sort((a, b) => b.keyword.length - a.keyword.length);
37:
38:   const skuEntries: SkuEntry[] = skuEntriesRaw.map((r) => ({
39:     material: r.material,
40:     description: r.description,
41:     category: r.category,
42:     product: r.product,
43:     baseColour: r.baseColour,
44:     packCode: r.packCode,
45:     unit: r.unit,
46:     refMaterial: r.refMaterial,
47:     paintType: r.paintType,
48:     materialType: r.materialType,
49:     piecesPerCarton: r.piecesPerCarton ?? null,
50:   }));
```

**Variable: `matchedSku` (from `skuByCombo.get(matchedKey)`)**

**Lines 110–114** — accesses `.piecesPerCarton` (×2)

```
107:
108:     if (line.isCarton && result.matchStatus === "matched" && result.skuCode) {
109:       const matchedKey = `${result.productName}|${result.baseColour}|${result.packCode}`;
110:       const matchedSku = skuByCombo.get(matchedKey);
111:       const originalCartonQty = line.cartonCount ?? line.quantity;
112:       if (matchedSku?.piecesPerCarton) {
113:         cartonCount = originalCartonQty;
114:         finalQty = originalCartonQty * matchedSku.piecesPerCarton;
```

---

### app/api/mail-orders/backfill-enrich/route.ts

**Variable: `r` (from `skuEntriesRaw`)**

**Lines 55–67** — accesses `.material`, `.description`, `.category`, `.product`, `.baseColour`, `.packCode`, `.unit`, `.refMaterial`, `.paintType`, `.materialType`, `.piecesPerCarton` (merged window)

```
52:     .map((r) => ({ keyword: r.keyword, category: r.category, baseColour: r.baseColour }))
53:     .sort((a, b) => b.keyword.length - a.keyword.length);
54:
55:   const skuEntries: SkuEntry[] = skuEntriesRaw.map((r) => ({
56:     material: r.material,
57:     description: r.description,
58:     category: r.category,
59:     product: r.product,
60:     baseColour: r.baseColour,
61:     packCode: r.packCode,
62:     unit: r.unit,
63:     refMaterial: r.refMaterial,
64:     paintType: r.paintType,
65:     materialType: r.materialType,
66:     piecesPerCarton: r.piecesPerCarton ?? null,
67:   }));
```

---

### app/api/mail-orders/lines/[lineId]/resolve/route.ts

**Variable: `sku`**

**Lines 60–72** — accesses `.product`, `.baseColour`, `.material`, `.description`, `.refMaterial`, `.paintType`, `.materialType` (first usage block)

```
60:   await prisma.mo_order_lines.update({
61:     where: { id: lineId },
62:     data: {
63:       productName: sku.product,
64:       baseColour: sku.baseColour,
65:       skuCode: sku.material,
66:       skuDescription: sku.description,
67:       refSkuCode: sku.refMaterial || null,
68:       paintType: sku.paintType || null,
69:       materialType: sku.materialType || null,
70:       matchStatus: "matched",
71:     },
72:   });
```

**Lines 88–100** — accesses `.material`, `.description`, `.product`, `.baseColour`, `.refMaterial`, `.paintType`, `.materialType` (second usage block — propagation to siblings)

```
85:   let propagated = 0;
86:   if (siblings.length > 0) {
87:     const siblingIds = siblings.map(s => s.id);
88:     await prisma.mo_order_lines.updateMany({
89:       where: { id: { in: siblingIds } },
90:       data: {
91:         skuCode: sku.material,
92:         skuDescription: sku.description,
93:         productName: sku.product,
94:         baseColour: sku.baseColour,
95:         refSkuCode: sku.refMaterial ?? null,
96:         paintType: sku.paintType ?? null,
97:         materialType: sku.materialType ?? null,
98:         matchStatus: "matched",
99:       },
100:     });
```

---

### app/api/mail-orders/ingest/route.ts

**Variable: `r` (from `skuEntriesRaw`)**

**Lines 116–128** — accesses `.material`, `.description`, `.category`, `.product`, `.baseColour`, `.packCode`, `.unit`, `.refMaterial`, `.paintType`, `.materialType`, `.piecesPerCarton` (merged window)

```
113:     .map((r) => ({ keyword: r.keyword, category: r.category, baseColour: r.baseColour }))
114:     .sort((a, b) => b.keyword.length - a.keyword.length);
115:
116:     const skuEntries: SkuEntry[] = skuEntriesRaw.map((r) => ({
117:       material: r.material,
118:       description: r.description,
119:       category: r.category,
120:       product: r.product,
121:       baseColour: r.baseColour,
122:       packCode: r.packCode,
123:       unit: r.unit,
124:       refMaterial: r.refMaterial,
125:       paintType: r.paintType,
126:       materialType: r.materialType,
127:       piecesPerCarton: r.piecesPerCarton ?? null,
128:     }));
```

**Variable: `matchedSku` (from `skuByCombo.get(matchedKey)`)**

**Lines 375–378** — accesses `.piecesPerCarton` (×2)

```
372:
373:       if (isCarton && result.matchStatus === "matched" && result.skuCode) {
374:         const matchedKey = `${result.productName}|${result.baseColour}|${result.packCode}`;
375:         const matchedSku = skuByCombo.get(matchedKey);
376:         if (matchedSku?.piecesPerCarton) {
377:           cartonCount = line.quantity;
378:           finalQty = line.quantity * matchedSku.piecesPerCarton;
```

---

### app/api/mail-orders/debug-enrich/route.ts

**Variable: `r` (from `skuEntriesRaw`)**

**Lines 45–57** — accesses `.material`, `.description`, `.category`, `.product`, `.baseColour`, `.packCode`, `.unit`, `.refMaterial`, `.paintType`, `.materialType`, `.piecesPerCarton` (merged window)

```
42:     .map((r) => ({ keyword: r.keyword, category: r.category, baseColour: r.baseColour }))
43:     .sort((a, b) => b.keyword.length - a.keyword.length);
44:
45:   const skuEntries: SkuEntry[] = skuEntriesRaw.map((r) => ({
46:     material: r.material,
47:     description: r.description,
48:     category: r.category,
49:     product: r.product,
50:     baseColour: r.baseColour,
51:     packCode: r.packCode,
52:     unit: r.unit,
53:     refMaterial: r.refMaterial,
54:     paintType: r.paintType,
55:     materialType: r.materialType,
56:     piecesPerCarton: r.piecesPerCarton ?? null,
57:   }));
```

---

### app/api/order/data/route.ts

**Variable: `r` (from `skuRows`)**

**Lines 88–95** — accesses `.product` (×3), `.packCode` (×2), `.baseColour` (×2) (merged window)

```
85:       }
86:       bucket.add(pack);
87:     };
88:     for (const r of skuRows) {
89:       if (!r.product || !r.packCode) continue;
90:       const pack = String(r.packCode);
91:       addToPackMap(r.product, pack);
92:       if (r.baseColour) {
93:         addToPackMap(`${r.product}|||${r.baseColour}`, pack);
94:       }
95:     }
```

---

## Functions receiving SKU results (Step 3 traces)

### `buildSkuMaps(skus: SkuEntry[])` in `lib/mail-orders/enrich.ts`

Parameter name: `skus` (iterated as `s`)

Receives: skuEntries from re-enrich/route.ts:53, backfill-enrich/route.ts:69, ingest/route.ts:130, debug-enrich/route.ts:59.

**Lines 275–283** — accesses `.product`, `.baseColour`, `.packCode`, `.material` (merged window)

```
272:   const byComboAlt = new Map<string, SkuEntry>(); // alternate SKU for same combo
273:   const byMaterial = new Map<string, SkuEntry>();
274:
275:   for (const s of skus) {
276:     const key = `${s.product}|${s.baseColour}|${s.packCode}`;
277:     if (!byCombo.has(key)) {
278:       byCombo.set(key, s);
279:     } else if (!byComboAlt.has(key)) {
280:       byComboAlt.set(key, s);
281:     }
282:     byMaterial.set(s.material, s);
283:   }
```

---

### `buildProductProfiles(skus: SkuEntry[], ...)` in `lib/mail-orders/enrich.ts`

Parameter name: `skus` (iterated as `s`)

Receives: skuEntries from re-enrich/route.ts:54, ingest/route.ts:131, debug-enrich/route.ts:60.

**Lines 298–311** — accesses `.product` (×2), `.baseColour`, `.packCode` (merged window)

```
295:   const profiles = new Map<string, ProductProfile>();
296:
297:   // Collect bases and packs per product
298:   for (const s of skus) {
299:     let p = profiles.get(s.product);
300:     if (!p) {
301:       p = {
302:         bases: new Set<string>(),
303:         packs: new Set<string>(),
304:         strategy: "DIRECT",
305:         isBaseProduct: false,
306:       };
307:       profiles.set(s.product, p);
308:     }
309:     p.bases.add(s.baseColour ?? "");
310:     p.packs.add(s.packCode);
311:   }
```

---

### `resolvedPackCode(sku: SkuEntry)` in `lib/mail-orders/enrich.ts`

Parameter name: `sku`

Called by `enrichLineCore` at lines 469, 790, 806.

**Lines 62–66** — accesses `.unit`, `.packCode` (×2)

```
60: /* ── Helpers ───────────────────────────────────────────────── */
61:
62: function resolvedPackCode(sku: SkuEntry): string {
63:   const unit = (sku.unit ?? "").toUpperCase().trim();
64:   if (unit === "ML") return `${sku.packCode}ML`;
65:   return sku.packCode;
66: }
```

---

### `enrichLineCore(...)` in `lib/mail-orders/enrich.ts`

Parameter names: `skuByCombo: Map<string, SkuEntry>`, `skuByMaterial: Map<string, SkuEntry>`, `skuByComboAlt?: Map<string, SkuEntry>`. Single-SKU values extracted via `.get(...)` and stored in local `sku`, then later in `top.sku` / `second.sku` (where `top` is a `ScoredCandidate`).

Receives Maps from re-enrich/route.ts:91-101, ingest/route.ts:355-367, debug-enrich/route.ts:63-75. Indirectly receives Maps from backfill-enrich/route.ts:91-98 (skuByCombo, skuByMaterial only).

**Variable: `sku` (from `skuByMaterial.get(noWs)`)**

**Lines 459–470** — accesses `.product`, `.baseColour`, `.material`, `.description`, `.refMaterial`, `.paintType`, `.materialType`, then passes `sku` to `resolvedPackCode(sku)` (merged window)

```
456:   // ── Step 1: Direct material code lookup (unchanged) ──────
457:   const noWs = text.replace(/\s+/g, "");
458:   if (/^(IN)?\d{5,10}$/.test(noWs)) {
459:     const sku = skuByMaterial.get(noWs);
460:     if (sku) {
461:       return {
462:         productName: sku.product,
463:         baseColour: sku.baseColour,
464:         skuCode: sku.material,
465:         skuDescription: sku.description,
466:         refSkuCode: sku.refMaterial ?? "",
467:         paintType: sku.paintType ?? "",
468:         materialType: sku.materialType ?? "",
469:         packCode: resolvedPackCode(sku),
470:         matchStatus: "matched",
```

**Variable: `sku` (from `skuByCombo.get(key)`, used in candidate scoring loop)**

**Line 640** — assignment, then continues into ScoredCandidate at line 691-701 where `sku` is stored on the candidate

```
637:     for (const base of basesToTry) {
638:       for (const pack of packsToTry) {
639:         const key = `${pm.product}|${base}|${pack}`;
640:         const sku = skuByCombo.get(key);
641:         if (!sku) continue;
642:
643:         // ── SCORING ──
```

**Variable: `top.sku` / `second.sku` (from ScoredCandidate selected by sort)**

**Lines 753–755** — accesses `.material` on `second.sku` and `top.sku`

```
750:     second.score === top.score &&
751:     second.product === top.product &&
752:     second.isPrimaryPack === top.isPrimaryPack &&
753:     (!!second.base) === (!!top.base) &&
754:     second.sku.material !== top.sku.material
755:   ) {
756:     // Tie → partial, let Deepanshu resolve
757:     return {
```

**Lines 781–793** — accesses `.product`, `.baseColour`, `.paintType`, `.materialType` on `top.sku`, then passes to `resolvedPackCode(top.sku)` (merged window)

```
778:         remaining = remaining.replace(new RegExp(`\\b${escapeRegex(db.keyword)}\\b`, 'g'), '').trim();
779:       }
780:       const unrecognizedWords = remaining.replace(/[^A-Z\s]/g, '').trim();
781:       if (unrecognizedWords.length >= 3) {
782:         return {
783:           productName: top.sku.product,
784:           baseColour: top.sku.baseColour,
785:           skuCode: "",
786:           skuDescription: `Unrecognized base: ${unrecognizedWords}`,
787:           refSkuCode: "",
788:           paintType: top.sku.paintType ?? "",
789:           materialType: top.sku.materialType ?? "",
790:           packCode: resolvedPackCode(top.sku),
791:           matchStatus: "partial",
792:         };
793:       }
```

**Lines 797–807** — accesses `.product`, `.baseColour`, `.material`, `.description`, `.refMaterial`, `.paintType`, `.materialType` on `top.sku`, then passes to `resolvedPackCode(top.sku)` (merged window — clear-winner branch)

```
794:     }
795:   }
796:
797:   // Clear winner
798:   return {
799:     productName: top.sku.product,
800:     baseColour: top.sku.baseColour,
801:     skuCode: top.sku.material,
802:     skuDescription: top.sku.description,
803:     refSkuCode: top.sku.refMaterial ?? "",
804:     paintType: top.sku.paintType ?? "",
805:     materialType: top.sku.materialType ?? "",
806:     packCode: resolvedPackCode(top.sku),
807:     matchStatus: "matched",
```

---

## TypeScript types describing SKU shape (Step 4)

### `SkuEntry` in `lib/mail-orders/enrich.ts`

**Lines 34–46** — interface definition

```
31:   baseColour: string;
32: }
33:
34: export interface SkuEntry {
35:   material: string;
36:   description: string;
37:   category: string;
38:   product: string;
39:   baseColour: string;
40:   packCode: string;
41:   unit: string | null;
42:   refMaterial: string | null;
43:   paintType: string | null;
44:   materialType: string | null;
45:   piecesPerCarton: number | null;
46: }
```

Field set:
- `material`: string
- `description`: string
- `category`: string
- `product`: string
- `baseColour`: string
- `packCode`: string
- `unit`: string | null
- `refMaterial`: string | null
- `paintType`: string | null
- `materialType`: string | null
- `piecesPerCarton`: number | null

Used by:
- `skuEntries: SkuEntry[]` in `app/api/mail-orders/re-enrich/route.ts:38`
- `skuEntries: SkuEntry[]` in `app/api/mail-orders/backfill-enrich/route.ts:55`
- `skuEntries: SkuEntry[]` in `app/api/mail-orders/ingest/route.ts:116`
- `skuEntries: SkuEntry[]` in `app/api/mail-orders/debug-enrich/route.ts:45`
- Param `skus: SkuEntry[]` in `buildSkuMaps` (`lib/mail-orders/enrich.ts:270`)
- Param `skus: SkuEntry[]` in `buildProductProfiles` (`lib/mail-orders/enrich.ts:291`)
- Param `sku: SkuEntry` in `resolvedPackCode` (`lib/mail-orders/enrich.ts:62`)
- `byCombo: Map<string, SkuEntry>` (`lib/mail-orders/enrich.ts:271`)
- `byComboAlt: Map<string, SkuEntry>` (`lib/mail-orders/enrich.ts:272`)
- `byMaterial: Map<string, SkuEntry>` (`lib/mail-orders/enrich.ts:273`)
- `sku: SkuEntry`, `altSku: SkuEntry | null` on `ScoredCandidate` (`lib/mail-orders/enrich.ts:84-85`)
- Map params `skuByCombo`, `skuByMaterial`, `skuByComboAlt` in `enrichLine`/`enrichLineCore` (`lib/mail-orders/enrich.ts:383-386, 433-435`)

### `SkuEntry` in `lib/mail-orders/enrich-v2.ts`

**Lines 26–38** — duplicate interface definition (file is not imported anywhere — verified by grep `from.*enrich-v2`).

Field set: identical to active `SkuEntry` above.

Used by: nothing — orphan file.

### `SkuDisplayMode` in `lib/hooks/use-sku-display-mode.ts:5`

Excluded — `"fini" | "generic"` UI string union, not a SKU row shape.

---

## Field-access frequency table

| Field | Hits | Files |
|---|---|---|
| product | 17 | skus/route.ts, lines/[lineId]/resolve/route.ts, order/data/route.ts, re-enrich/route.ts, backfill-enrich/route.ts, ingest/route.ts, debug-enrich/route.ts, lib/mail-orders/enrich.ts |
| baseColour | 14 | skus/route.ts, lines/[lineId]/resolve/route.ts, order/data/route.ts, re-enrich/route.ts, backfill-enrich/route.ts, ingest/route.ts, debug-enrich/route.ts, lib/mail-orders/enrich.ts |
| material | 13 | lib/fini-resolver.ts, skus/route.ts, lines/[lineId]/resolve/route.ts, re-enrich/route.ts, backfill-enrich/route.ts, ingest/route.ts, debug-enrich/route.ts, lib/mail-orders/enrich.ts |
| description | 12 | lib/fini-resolver.ts, skus/route.ts, lines/[lineId]/resolve/route.ts, re-enrich/route.ts, backfill-enrich/route.ts, ingest/route.ts, debug-enrich/route.ts, lib/mail-orders/enrich.ts |
| packCode | 12 | skus/route.ts, order/data/route.ts, re-enrich/route.ts, backfill-enrich/route.ts, ingest/route.ts, debug-enrich/route.ts, lib/mail-orders/enrich.ts |
| refMaterial | 12 | lib/fini-resolver.ts, skus/route.ts, lines/[lineId]/resolve/route.ts, re-enrich/route.ts, backfill-enrich/route.ts, ingest/route.ts, debug-enrich/route.ts, lib/mail-orders/enrich.ts |
| paintType | 9 | lines/[lineId]/resolve/route.ts, re-enrich/route.ts, backfill-enrich/route.ts, ingest/route.ts, debug-enrich/route.ts, lib/mail-orders/enrich.ts |
| materialType | 9 | lines/[lineId]/resolve/route.ts, re-enrich/route.ts, backfill-enrich/route.ts, ingest/route.ts, debug-enrich/route.ts, lib/mail-orders/enrich.ts |
| piecesPerCarton | 8 | re-enrich/route.ts, backfill-enrich/route.ts, ingest/route.ts, debug-enrich/route.ts |
| unit | 6 | skus/route.ts, re-enrich/route.ts, backfill-enrich/route.ts, ingest/route.ts, debug-enrich/route.ts, lib/mail-orders/enrich.ts |
| category | 5 | skus/route.ts, re-enrich/route.ts, backfill-enrich/route.ts, ingest/route.ts, debug-enrich/route.ts |

Total: 117 hits across 11 distinct fields.

---

## End of Pass 2
