# Stage A — Pass 1 raw findings — Direct reads of mo_sku_lookup

Generated: 2026-05-07
Scope: lib/, app/, scripts/, prisma/
Patterns:
- moSkuLookup
- mo_sku_lookup
- from/FROM mo_sku_lookup (raw SQL)

---

## Total hits

- Pattern 1 (moSkuLookup): 0 matches across 0 files
- Pattern 2 (mo_sku_lookup): 30 matches across 17 files
- Pattern 3 (raw SQL): 1 match across 1 file

## File-by-file findings

### lib/fini-resolver.ts

**Lines 6–7** — pattern: mo_sku_lookup (merged window)

```
 3: /**
 4:  * Resolves Fini SKU mapping for a list of Generic codes.
 5:  *
 6:  * Generic code = what SAP sends on OBDs (mo_sku_lookup.refMaterial)
 7:  * Fini code = actual shipping SKU (mo_sku_lookup.material)
 8:  *
 9:  * Used by TM, Operator, and Delivery Challan API routes to support
10:  * Fini-default display with Generic toggle fallback.
```

**Line 28** — pattern: mo_sku_lookup

```
25:
26:   // One Generic can theoretically map to multiple Finis (material is UNIQUE,
27:   // refMaterial is not). Deterministic pick: first by material asc.
28:   const rows = await prisma.mo_sku_lookup.findMany({
29:     where:   { refMaterial: { in: deduped } },
30:     select:  { material: true, description: true, refMaterial: true },
31:     orderBy: { material: "asc" },
```

---

### lib/place-order/pack.ts

**Line 7** — pattern: mo_sku_lookup

```
 4: //   (a) the email body the desktop page produces is parser-compatible
 5: //   (b) carton multiples (1L=6, 4L=4, 100ML=12) stay consistent across both
 6: //
 7: // packCode in mo_sku_lookup is a bare numeric string. Conventions:
 8: //   - >= 50      → millilitres ("50" → "50ML",   "200" → "200ML")
 9: //   - < 1        → also millilitres ("0.5" → "500ML")
10: //   - 1 .. 40    → litres        ("1" → "1L",   "4" → "4L")
```

---

### lib/mail-orders/utils.ts

**Line 32** — pattern: mo_sku_lookup

```
29:   if (!packCode) return 0;
30:   const raw = packCode.trim();
31:
32:   // 1. Direct lookup (covers mo_sku_lookup numeric values)
33:   if (PACK_VOLUME_LITERS[raw] !== undefined) return PACK_VOLUME_LITERS[raw];
34:
35:   // 2. Handle suffixed values from mo_order_lines (e.g. "500ml", "200ml", "25kg")
```

---

### lib/mail-orders/taxonomy-mapping.ts

**Line 1** — pattern: mo_sku_lookup

```
 1: // Phase 1 taxonomy mapping — translates legacy (mo_sku_lookup.category,
 2: // product, baseColour, description) tuples into new mo_order_form_index
 3: // rows per the locked master taxonomy:
 4: //   docs/prompts/drafts/web-update-2026-05-06-master-taxonomy-redesign.md
```

**Line 472** — pattern: mo_sku_lookup

```
469:
470:   // ── WOODCARE (Round 1) — pattern-based SADOLIN dispatch ──────────────
471:   //
472:   // Real `mo_sku_lookup.product` strings have prefix/suffix variation that
473:   // the original exact-match dispatch missed (e.g. `EXT CLR 2K PU GLOSS`,
474:   // `INT CLR MELAMINE GLOSS`, `PU PRIME WHITE SEALER`, `NC NECOL CLEAR`).
475:   // Phase 1 Prompt 1.6 reworked the dispatch as ordered pattern matching:
```

**Line 579** — pattern: mo_sku_lookup

```
576:     if (prod === "SMOOTHOVER")   return [row("SMOOTHOVER", "SMOOTHOVER", bc)];
577:     // 2-row data drift — DULUX/SUPERCOVER stragglers belong under
578:     // SUPERCOVER family (Phase 2 cleanup: re-categorise from DULUX to
579:     // SUPERCOVER in mo_sku_lookup).
580:     if (prod === "SUPERCOVER")   return [row("SUPERCOVER", "SUPERCOVER", bc)];
581:     return null;
582:   }
```

**Line 623** — pattern: mo_sku_lookup

```
620:   }
621:
622:   // TEXTURE category — 2 rows of `VT VELVETINO` mis-categorised from VT.
623:   // Phase 2 cleanup: re-categorise from TEXTURE to VT in mo_sku_lookup.
624:   if (cat === "TEXTURE" && prod === "VT VELVETINO") {
625:     return [row("VT SPECIALTY", "VELVETINO", bc || legacy.product)];
626:   }
```

---

### app/order/page.tsx

**Line 66** — pattern: mo_sku_lookup

```
63:
64: // ── Pack label helpers ──────────────────────────────────────────────────
65: //
66: // packCode in mo_sku_lookup is a bare numeric string. Conventions:
67: // - Values ≥ 50  → millilitres (e.g. "50"   → "50ML",  "200"   → "200ML")
68: // - Values < 1   → also millilitres, decimalised litres (e.g. "0.5" → "500ML")
69: // - Values 1..40 → litres                              (e.g. "1"   → "1L",   "4" → "4L")
```

---

### app/api/mail-orders/skus/route.ts

**Line 24** — pattern: mo_sku_lookup

```
21:
22:   const words = q.trim().toUpperCase().split(/\s+/).filter((w) => w.length > 0);
23:
24:   const skus = await prisma.mo_sku_lookup.findMany({
25:     where: {
26:       AND: words.map((word) => ({
27:         OR: [
```

---

### app/api/mail-orders/re-enrich/route.ts

**Line 27** — pattern: mo_sku_lookup

```
24:   const [productKeywordsRaw, baseKeywordsRaw, skuEntriesRaw] = await Promise.all([
25:     prisma.mo_product_keywords.findMany(),
26:     prisma.mo_base_keywords.findMany(),
27:     prisma.mo_sku_lookup.findMany(),
28:   ]);
29:
30:   const productKeywords: ProductKeyword[] = productKeywordsRaw
```

---

### app/api/mail-orders/backfill-enrich/route.ts

**Line 44** — pattern: mo_sku_lookup

```
41:   const [productKeywordsRaw, baseKeywordsRaw, skuEntriesRaw] = await Promise.all([
42:     prisma.mo_product_keywords.findMany(),
43:     prisma.mo_base_keywords.findMany(),
44:     prisma.mo_sku_lookup.findMany(),
45:   ]);
46:
47:   const productKeywords: ProductKeyword[] = productKeywordsRaw
```

---

### app/api/mail-orders/lines/[lineId]/resolve/route.ts

**Line 52** — pattern: mo_sku_lookup

```
49:   }
50:
51:   // Look up SKU
52:   const sku = await prisma.mo_sku_lookup.findUnique({
53:     where: { material: body.skuCode },
54:   });
55:   if (!sku) {
```

---

### app/api/mail-orders/ingest/route.ts

**Line 105** — pattern: mo_sku_lookup

```
102:     const [productKeywordsRaw, baseKeywordsRaw, skuEntriesRaw] = await Promise.all([
103:       prisma.mo_product_keywords.findMany(),
104:       prisma.mo_base_keywords.findMany(),
105:       prisma.mo_sku_lookup.findMany(),
106:     ]);
107:
108:     const productKeywords: ProductKeyword[] = productKeywordsRaw
```

---

### app/api/mail-orders/debug-enrich/route.ts

**Line 34** — pattern: mo_sku_lookup

```
31:   const [productKeywordsRaw, baseKeywordsRaw, skuEntriesRaw] = await Promise.all([
32:     prisma.mo_product_keywords.findMany(),
33:     prisma.mo_base_keywords.findMany(),
34:     prisma.mo_sku_lookup.findMany(),
35:   ]);
36:
37:   const productKeywords: ProductKeyword[] = productKeywordsRaw
```

---

### app/api/order/data/route.ts

**Lines 13, 19** — patterns: mo_sku_lookup (line 13 also matches pattern 3 raw SQL)  (merged window)

```
10: // Each index row is one searchable entry; numbered-base variants (e.g.
11: // "WS Max — 92") and colour variants (e.g. "Gloss — Golden Brown") are
12: // flat rows with their own baseColour and searchTokens. Pack sizes
13: // joined in from mo_sku_lookup via a (product, baseColour) composite
14: // key (or product-only when the row's baseColour is null).
15:
16: export const dynamic = "force-dynamic";
17:
18: // Canonical pack-size order, smallest to largest. packCode values in
19: // mo_sku_lookup are bare numeric strings ("1", "4", "10", "20", "0.9"…)
20: // without unit suffix. Anything outside this list sorts to the end
21: // alphabetically.
22: const PACK_ORDER: ReadonlyArray<string> = [
```

**Line 61** — pattern: mo_sku_lookup

```
58:       orderBy: [{ family: "asc" }, { sortOrder: "asc" }],
59:     });
60:
61:     const skuRows = await prisma.mo_sku_lookup.findMany({
62:       select: { product: true, baseColour: true, packCode: true },
63:     });
64:
```

---

### scripts/preview-new-taxonomy.ts

**Lines 3, 8** — pattern: mo_sku_lookup (merged window)

```
 1: // Phase 1 dry-run preview generator.
 2: //
 3: // Reads mo_sku_lookup, runs every distinct (category, product, baseColour,
 4: // description) tuple through the taxonomy mapping function, aggregates
 5: // results by family, and writes a JSON preview to:
 6: //   docs/prompts/drafts/taxonomy-preview.json
 7: //
 8: // Read-only — NO writes to mo_sku_lookup, mo_order_form_index, or any
 9: // other table. The preview is the deliverable. Phase 1 Prompt 2 will
10: // reseed mo_order_form_index from this preview after the unique-constraint
11: // SQL migration is applied in Supabase.
```

**Lines 64, 68** — pattern: mo_sku_lookup (merged window)

```
61: }
62:
63: async function main(): Promise<void> {
64:   // Pull every row of mo_sku_lookup and dedupe to distinct
65:   // (category, product, baseColour) triples. We retain one description per
66:   // triple so the mapping function has it available for description-based
67:   // splits (TEXTURE / PROTECT / SATIN per planning doc §6.7 / §3 / §2).
68:   const rows = await prisma.mo_sku_lookup.findMany({
69:     select: { category: true, product: true, baseColour: true, description: true },
70:   });
71:
```

---

### scripts/phase1-restore-from-backup.ts

**Lines 7, 10** — pattern: mo_sku_lookup (merged window)

```
 4: // every row from the backup JSON written by phase1-backup-current-index.ts.
 5: //
 6: // Why: the new taxonomy's `subProduct` values were abstracted away from
 7: // the legacy `mo_sku_lookup.product` strings (e.g. LUXURIO/MATT vs
 8: // LUXURIO PU MATT, 2K PU/MATT vs INT CLR 2K PU MATT). The /api/order/data
 9: // route joins the two via `mo_order_form_index.subProduct ===
10: // mo_sku_lookup.product`, so the new rows render with empty pack lists
11: // for the ~70% of families whose names were abstracted. Phase 2 catalog
12: // migration (or a translation layer) is required before the new taxonomy
13: // can ship; rolling back to the legacy 481-row state unblocks operators
```

---

### scripts/preview-new-taxonomy-from-csv.ts

**Line 5** — pattern: mo_sku_lookup

```
 2: //
 3: // The DB-backed scripts/preview-new-taxonomy.ts couldn't run from the
 4: // dev sandbox (Supabase unreachable). This variant reads the same input
 5: // from a static CSV snapshot of mo_sku_lookup distinct triples and runs
 6: // the identical mapping pipeline. Output JSON is canonical per Phase 1
 7: // Prompt 2's expected shape:
 8: //   { summary{ totalLegacyTriples, totalNewRows, crossListedExtraRows,
```

**Line 25** — pattern: mo_sku_lookup

```
22:   type NewRow,
23: } from "../lib/mail-orders/taxonomy-mapping";
24:
25: const IN_PATH  = path.join("docs", "prompts", "drafts", "mo_sku_lookup-triples-2026-05-06.csv");
26: const OUT_PATH = path.join("docs", "prompts", "drafts", "taxonomy-preview.json");
27:
28: type CsvRow = {
```

---

### scripts/phase1-seed-mo-order-form-index.ts

**Line 162** — pattern: mo_sku_lookup

```
159:
160:   // ── B.2.5 dedupe by (family, subProduct, baseColour) ─────────────────
161:   // The new unique constraint is (family, subProduct, baseColour). Multiple
162:   // legacy mo_sku_lookup triples can converge to the same canonical row:
163:   //   - WS/MAX + WEATHERCOAT/MAX (T3 rebadge — same product, two SAP gens)
164:   //   - DULUX/SUPERCLEAN + SUPERCLEAN/SUPERCLEAN (likewise)
165:   //   - DULUX/PU ENAMEL + PU/PU ENAMEL → both fold into GLOSS/GLOSS
```

**Line 174** — pattern: mo_sku_lookup

```
171:   //
172:   // Phase 2 T3 rebadge cleanup (web-update-2026-04-28-gloss-bw-generic-
173:   // cleanup.md) will eventually flip losing-generation SKUs to
174:   // isActive=false in mo_sku_lookup. After that runs, this dedup pass
175:   // will be a no-op.
176:   const seen = new Set<string>();
177:   const deduped: PreviewRow[] = [];
```

---

### prisma/schema.prisma

**Line 1113** — pattern: mo_sku_lookup

```
1110:   createdAt  DateTime @default(now())
1111: }
1112:
1113: model mo_sku_lookup {
1114:   id              Int      @id @default(autoincrement())
1115:   material        String   @unique
1116:   description     String
```

---

## Files with matches across multiple patterns

- app/api/order/data/route.ts: pattern 2 + pattern 3

## End of Pass 1
