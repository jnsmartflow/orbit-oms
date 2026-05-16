# Stage A — Pass 5 raw findings — Parser → SKU matching path

Generated: 2026-05-07

---

## Summary

- Ingest contract documented: yes (`IngestRequest` interface at `app/api/mail-orders/ingest/route.ts:36-63`)
- `mo_product_keywords` reads in `enrich.ts`: 4 sites
- Cross-references between `KW.product` and `SKU.product`: 2 (one composite-key build at line 639, one Map lookup at line 580; plus a string-equality guard at line 360)
- Implicit FK constraints discovered: 1 (`mo_product_keywords.product` is treated as a string FK to `mo_sku_lookup.product`; not enforced by schema, not enforced in code)
- Out-of-scope files confirmed clean: 6 (`customer-match.ts`, `delivery-match.ts`, `utils.ts`, `types.ts`, `api.ts`, `email-template.ts`)

---

## Step 1 — Ingest endpoint contract

File: `app/api/mail-orders/ingest/route.ts`
Type: `IngestRequest` interface at lines 36–63.

### Fields received from parser (Outlook → ingest endpoint)

**Order-level**

| Field | Type | Required | Purpose |
|---|---|---|---|
| `emailEntryId` | `string` | required | Dedup key. Form: `<EntryID>__Bill{N}` / `__Sec{N}` for split emails. |
| `soName` | `string` | required | Sales officer name (sender). |
| `soEmail` | `string` | optional | Sender email. |
| `receivedAt` | `string` | required | ISO timestamp. |
| `subject` | `string` | required | Email subject line. |
| `deliveryRemarks` | `string` | optional | Free text. |
| `remarks` | `string` | optional | Free text. |
| `billRemarks` | `string` | optional | Free text. |
| `dispatchStatus` | `string` | optional | "Dispatch" / "Hold". |
| `dispatchPriority` | `string` | optional | "Normal" / "Urgent". |
| `shipToOverride` | `boolean` | optional | Hint flag. |
| `slotToOverride` | `boolean` | optional | Hint flag. |
| `bodyCustomerName` | `string` | optional | Body-extracted customer name (fallback when subject match weak). |
| `bodyCustomerCode` | `string` | optional | Body-extracted customer code. |
| `lines` | `Array<...>` | required | Product lines. |
| `remarkLines` | `Array<...>` | optional | Per-line remark items. |

**Per-line (inside `lines[]`)**

| Field | Type | Required | Purpose |
|---|---|---|---|
| `rawText` | `string` | required | Raw segment text from email (parser-normalised). |
| `packCode` | `string` | required | Pack token (`"1"`, `"4"`, `"500"`, etc., bare numeric). |
| `quantity` | `number` | required | Numeric quantity. |
| `isCarton` | `boolean` | optional | Carton flag — when true, server multiplies qty × `piecesPerCarton`. |
| `carryProduct` | `string \| null` | optional | v6.5 hint — last line's dominant product when current line is colour-only. Server retries enrichment with `carryProduct` prepended to `rawText`. |

**Per-remark (inside `remarkLines[]`)**

| Field | Type | Required | Purpose |
|---|---|---|---|
| `rawText` | `string` | required | Remark line text. |
| `remarkType` | `string` | required | `billing\|delivery\|contact\|instruction\|cross\|customer\|area\|unknown\|noise`. |
| `detectedBy` | `string` | required | `pattern\|keyword\|unknown\|subject`. |

### Fields computed server-side (NOT received from parser)

These are derived in the ingest handler from the in-memory enrichment maps:

| Field | Computed by | Source |
|---|---|---|
| `productName` | `enrichLine(...)` → `EnrichResult.productName` | `mo_sku_lookup.product` via skuByCombo lookup, OR `mo_product_keywords.product` via keyword match → carried through |
| `baseColour` | `enrichLine(...)` → `EnrichResult.baseColour` | `mo_sku_lookup.baseColour` (or `mo_base_keywords.baseColour` for partial) |
| `skuCode` | `enrichLine(...)` → `EnrichResult.skuCode` | `mo_sku_lookup.material` |
| `skuDescription` | `enrichLine(...)` → `EnrichResult.skuDescription` | `mo_sku_lookup.description` |
| `refSkuCode` | `enrichLine(...)` → `EnrichResult.refSkuCode` | `mo_sku_lookup.refMaterial` |
| `paintType` | `enrichLine(...)` → `EnrichResult.paintType` | `mo_sku_lookup.paintType` |
| `materialType` | `enrichLine(...)` → `EnrichResult.materialType` | `mo_sku_lookup.materialType` |
| `matchStatus` | `enrichLine(...)` → `EnrichResult.matchStatus` | computed: `matched\|partial\|unmatched` |
| `cartonCount` / final `quantity` | server arithmetic at `ingest/route.ts:373-382` | `matchedSku.piecesPerCarton` |
| `customerCode` / `customerName` / `customerMatchStatus` / `customerCandidates` | `matchCustomer(...)` + `matchByKeywords(...)` | `mo_customer_keywords` + `mo_learned_customers` |
| `customerCode` (ship-to override) | `matchDeliveryCustomer(...)` | `delivery_point_master` |

The parser sends NO pre-classified product hints other than `carryProduct` (the v6.5 colour-only fallback). Enrichment runs entirely server-side.

---

## Step 2 — `mo_product_keywords` reads in `enrich.ts`

The enrichment engine never queries `mo_product_keywords` directly. Route handlers (`ingest`, `re-enrich`, `backfill-enrich`, `debug-enrich`) call `prisma.mo_product_keywords.findMany()`, project rows to `ProductKeyword[]` (selecting `keyword`, `category`, `product`), sort length-DESC, then pass the array as a parameter into enrich.ts functions.

`ProductKeyword` type at `lib/mail-orders/enrich.ts:22-26`:

```
22: export interface ProductKeyword {
23:   keyword: string; // already UPPERCASED
24:   category: string;
25:   product: string;
26: }
```

### `buildKeywordRegexes(productKeywords, baseKeywords)` at line 249

Purpose: produces `{ prodRegexMap: Map<string, RegExp>; baseRegexMap: Map<string, RegExp> }` — pre-compiled word-boundary regexes keyed by keyword text.

Fields read from each `ProductKeyword` row:
- `pk.keyword` — used as Map key AND as the regex source (line 254–256)

`pk.product` and `pk.category` are NOT read here.

```
253:   const prodRegexMap = new Map<string, RegExp>();
254:   for (const pk of productKeywords) {
255:     if (!prodRegexMap.has(pk.keyword)) {
256:       prodRegexMap.set(pk.keyword, new RegExp(`\\b${escapeRegex(pk.keyword)}\\b`));
257:     }
258:   }
```

### `buildProductProfiles(skus, productKeywords, baseKeywords)` at line 290

Purpose: produces `Map<string, ProductProfile>` keyed by **SKU product name** (`s.product`). Each profile holds `{ bases, packs, strategy, isBaseProduct }`.

Fields read from `skus` (`SkuEntry[]`): `s.product`, `s.baseColour`, `s.packCode`.

Fields read from `productKeywords`: `pk.keyword`, `pk.product` (only inside the isBaseProduct cross-check at lines 359–368).

Cross-reference site (line 360):

```
357:       if (theBase && allBaseColours.has(theBase)) {
358:         // Check if any product keyword for this product matches a base keyword
359:         for (const pk of productKeywords) {
360:           if (pk.product !== prodName) continue;
361:           for (const bk of baseKeywords) {
362:             if (pk.keyword === bk.keyword) {
363:               profile.isBaseProduct = true;
```

`prodName` here came from `profiles.entries()` (line 322), and `profiles` was populated by `profiles.set(s.product, p)` at line 307. So `prodName === s.product` from a SkuEntry, and the `if (pk.product !== prodName) continue` is a string-equality guard between `mo_product_keywords.product` and `mo_sku_lookup.product`.

### Matching loop in `enrichLineCore` at lines 518–529

Iterates `productKeywords` and tests each `pk.keyword` regex against the (uppercased) raw text. On hit, builds a `ProductMatch` carrying `keyword`, `product`, `len`:

```
517:   // ── Step 3: Find ALL product keywords in FULL text ───────
518:   for (const pk of productKeywords) {
519:     const re = prodRegexMap.get(pk.keyword);
520:     if (!re || !re.test(text)) continue;
521:     const dedup = `${pk.product}|${pk.keyword}`;
522:     if (seenProdKw.has(dedup)) continue;
523:     seenProdKw.add(dedup);
524:     prodMatches.push({
525:       keyword: pk.keyword,
526:       product: pk.product,
527:       len: pk.keyword.length,
528:     });
529:   }
```

For each matching `pk`:
- `pk.keyword` — used for: regex lookup (line 519), dedup key (line 521), `ProductMatch.keyword` (line 525), `len` (line 527)
- `pk.product` — used for: dedup key (line 521), `ProductMatch.product` (line 526) — the value flows downstream into `productProfiles.get(...)` (line 580) and into the composite SKU lookup key (line 639)
- `pk.category` — NOT read in `enrich.ts` (only used by route handlers when projecting raw rows; effectively dead in the matching path)

The fuzzy fallback at lines 538–549 repeats the same pattern with the same field usage.

---

## Step 3 — Cross-reference: KW.product → SKU.product

### Chain 1: composite SKU lookup

Source: `mo_product_keywords.product` (column type: `string`)

Path:
1. `pk.product` at `lib/mail-orders/enrich.ts:526` — copied into `ProductMatch.product`
2. `pm.product` at `lib/mail-orders/enrich.ts:580` — used to look up `productProfiles.get(pm.product)`
3. `pm.product` at `lib/mail-orders/enrich.ts:639` — used to build composite key `\`${pm.product}|${base}|${pack}\``
4. `skuByCombo.get(key)` at `lib/mail-orders/enrich.ts:640` — Map was built at line 276–278 with key `\`${s.product}|${s.baseColour}|${s.packCode}\`` from `mo_sku_lookup` rows
5. `top.sku` returned: the `EnrichResult` then carries `top.sku.product` (= `mo_sku_lookup.product`) back into `productName`

Implication: `mo_product_keywords.product` strings MUST match `mo_sku_lookup.product` strings exactly (same casing, same spacing) for `skuByCombo.get(key)` to find a row. A mismatch silently fails — the candidate is filtered out at line 641 (`if (!sku) continue`) and the line either falls through to a different product or returns `partial`/`unmatched`.

Evidence:

```
276:     const key = `${s.product}|${s.baseColour}|${s.packCode}`;
```

```
524:     prodMatches.push({
525:       keyword: pk.keyword,
526:       product: pk.product,
527:       len: pk.keyword.length,
528:     });
```

```
638:       for (const pack of packsToTry) {
639:         const key = `${pm.product}|${base}|${pack}`;
640:         const sku = skuByCombo.get(key);
641:         if (!sku) continue;
```

### Chain 2: profile lookup

Same source (`mo_product_keywords.product`), shorter path:

1. `pk.product` → `pm.product` (line 526)
2. `productProfiles?.get(pm.product)` at `lib/mail-orders/enrich.ts:580`

`productProfiles` was built at line 307 with `profiles.set(s.product, p)` from `mo_sku_lookup` rows. Same equality contract: KW.product must equal SKU.product.

Evidence:

```
298:   for (const s of skus) {
299:     let p = profiles.get(s.product);
300:     if (!p) {
301:       p = { ... };
307:       profiles.set(s.product, p);
```

```
579:   for (const pm of prodMatches) {
580:     const profile = productProfiles?.get(pm.product);
581:     if (!profile) continue;
```

### Chain 3: isBaseProduct cross-check

`pk.product !== prodName` at `lib/mail-orders/enrich.ts:360` (already shown in Step 2). Same equality contract — `prodName` here is a SKU product name (from `profiles.entries()` populated with `s.product`).

### Implicit FK constraint

The codebase treats `mo_product_keywords.product` as a string reference to `mo_sku_lookup.product`, but:

- **No foreign-key constraint exists in the schema.** Pass 1 confirmed that `prisma/schema.prisma` defines `model mo_sku_lookup` at line 1113 standalone; there is no `@relation` from `mo_product_keywords.product` to any column of `mo_sku_lookup`.
- **No runtime validation guard exists.** No code asserts `pk.product` is a known SKU product before adding to the productKeywords pipeline. A keyword pointing to a nonexistent SKU product silently produces no candidates.
- **Where the constraint is documented:** `docs/CLAUDE_MAIL_ORDERS.md` describes the enrichment data model in §2 (the table list documents both `mo_product_keywords.product` and `mo_sku_lookup.product` but does not call out the cross-reference). §17 (Pending items) records a few related concerns: `VT Velvetino — not in mo_sku_lookup` (line 511), `PU PRIME WHITE SEALER keyword maps to nonexistent product` (line 517) — both are symptoms of the unenforced constraint.
- **Where the constraint is enforced in code:** nowhere. The match loop at `enrich.ts:518–529` accepts any `pk` whose keyword matches text; the lookup loop at lines 638–640 silently drops candidates whose `${pm.product}|${base}|${pack}` key is missing from `skuByCombo`.

---

## Step 4 — Out-of-scope files (confirmed clean or noted)

### `lib/mail-orders/customer-match.ts`

- `mo_sku_lookup` references: 0
- `.product` references: 0
- Status: **out of scope, clean**

### `lib/mail-orders/delivery-match.ts`

- `mo_sku_lookup` references: 0
- `.product` references: 0
- Status: **out of scope, clean**

### Other `lib/mail-orders/*.ts` files

| File | `mo_sku_lookup` hits | `.product` hits | Status |
|---|---|---|---|
| `utils.ts` | 1 (comment, Pass 1 line 32) | 0 | comment-only mention; in-scope but no runtime references |
| `types.ts` | 0 | 0 | clean |
| `api.ts` | 0 | 0 | clean (client fetch helpers only) |
| `email-template.ts` | 0 | 0 | clean (uses `productName` strings from `mo_order_lines`, not `.product` from any SKU/KW shape) |
| `enrich-v2.ts` | dead code — excluded per Pass 2 | — | excluded |

All non-enrich, non-taxonomy-mapping `lib/mail-orders/*.ts` files are confirmed free of SKU-shape `.product` references.

---

## Step 5 — Parser contract (documentation only)

Parser location: `C:\Users\HP\OneDrive\VS Code\mail-orders\Parse-MailOrders-v6_5.ps1` (outside git repo, NOT scanned).

Parser → ingest endpoint contract (inferred entirely from the ingest endpoint's `IngestRequest` type and from `docs/CLAUDE_MAIL_ORDERS.md §3`):

- **Sends:** order-level metadata (`emailEntryId`, `soName`, `soEmail`, `receivedAt`, `subject`, `deliveryRemarks`, `remarks`, `billRemarks`, `dispatchStatus`, `dispatchPriority`, `shipToOverride`, `slotToOverride`, `bodyCustomerName`, `bodyCustomerCode`); per-line raw extracts (`rawText`, `packCode`, `quantity`, `isCarton`, `carryProduct`); per-remark records (`rawText`, `remarkType`, `detectedBy`).
- **Does not send:** `productName`, `baseColour`, `skuCode`, `skuDescription`, `refSkuCode`, `paintType`, `materialType`, `matchStatus`, `cartonCount` (final), customer fields. All computed server-side.
- **Direct DB access:** none. Parser fetches keyword data only via `GET /api/mail-orders/keywords` (public endpoint) at startup; ingest is HMAC-signed POST.

Parser's relationship to `mo_sku_lookup`: indirect only. The parser:
- Knows the keyword tables (`mo_product_keywords`, `mo_base_keywords`) via the public `/keywords` endpoint, used for `Test-KeywordWB` matching to detect product/base text in lines and for the `carryProduct` carry-forward decision.
- Does NOT know `mo_sku_lookup`. It cannot translate text into a SKU code on its own; it just emits raw segments and lets server-side `enrichLine` perform the SKU match.
- Sends the `carryProduct` hint when a line is detected as colour-only (per parser v6.5 Item 6, `docs/CLAUDE_MAIL_ORDERS.md §4`).

---

## Open questions for Stage B

Surfaced by Pass 5; NOT answered here.

1. **Is the implicit `mo_product_keywords.product` ↔ `mo_sku_lookup.product` string-equality contract reliable?** Currently relies on data discipline (operators adding keywords pointing to the right product string). No schema FK, no runtime validator. A typo or a SKU rename silently breaks every keyword pointing to it. CLAUDE_MAIL_ORDERS.md §17 already records two known symptoms (VT Velvetino, PU PRIME WHITE SEALER) of this drift.

2. **If `mo_sku_lookup.product` is split into `product + subVariant`, what happens to `mo_product_keywords.product`?** Does the keyword table also gain a `subVariant`? Or does the keyword's `product` string become a coarser key that maps to multiple `(product, subVariant)` rows? The answer affects the `skuByCombo` key shape (Pass 3 §catalogue) and the `productProfiles` Map key (lines 299, 307, 580).

3. **What about `taxonomy-mapping.ts`?** That file's 99 literal-string dispatch (Pass 4 Step 6) operates on legacy `mo_sku_lookup.product` values. If `product` is split, every literal needs re-evaluation: which dispatch rules are about `product`, which are about `subVariant`, and how do the new compound values affect the rules.

4. **Is `pk.category` actually unused?** Pass 5 Step 2 found `pk.category` is read by route handlers when projecting rows but never used in `enrich.ts`. Could be a candidate for removal, or could be reserved for future use — Stage B should decide whether to preserve, repurpose, or drop it.

5. **What's the resolve-time path?** `app/api/mail-orders/lines/[lineId]/resolve/route.ts:52` looks up by `material` only — it sets `productName: sku.product` (line 63) directly from the chosen SKU. If `product` is split, the resolved line's `productName` field on `mo_order_lines` carries which value? The compound legacy string, just `product`, or `${product} ${subVariant}`?

6. **What's the `/api/mail-orders/skus` typeahead behaviour?** That endpoint (`app/api/mail-orders/skus/route.ts:24-46`) ORs `material`/`description`/`product`/`baseColour` `contains` filters per word. If `product` splits, do operator searches for "PU MATT" still hit rows where the new `product='2K PU'` and `subVariant='MATT'`?

---

## End of Pass 5
