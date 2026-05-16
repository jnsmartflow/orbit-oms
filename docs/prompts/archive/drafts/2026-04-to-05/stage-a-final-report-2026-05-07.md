# Stage A — Final consolidated audit report
# Read paths from `mo_sku_lookup.product` in OrbitOMS

Generated: 2026-05-07
Audit method: 6 read-only passes (no DB writes, no code changes)

---

## 1. Executive summary

- **Blast radius is contained.** All runtime reads of `mo_sku_lookup` live in 8 files, all under `lib/mail-orders/`, `app/api/mail-orders/`, `app/api/order/data/`, or `lib/fini-resolver.ts`. Non-mail-orders pipelines (OBD import, admin, dispatch, warehouse, tint, planning, support, operations, cron) are confirmed zero-touch.
- **Runtime treats `product` as opaque key.** Outside one isolated file (`lib/mail-orders/taxonomy-mapping.ts` — used only by Phase 1 reseed scripts), no production runtime code does `.includes`/`.startsWith`/`=== "literal"` on the `product` field. Production code only uses `product` to build composite Map keys and to compare against `mo_product_keywords.product` for equality.
- **One implicit FK exists.** `mo_product_keywords.product` is a de facto string foreign key to `mo_sku_lookup.product`. Not enforced by schema, not validated in code. Stage B must address keyword-side migration coordinately.
- **One cross-table join exists.** `app/api/order/data/route.ts` joins `mo_sku_lookup.product`+`baseColour` to `mo_order_form_index.subProduct`+`baseColour` via an in-memory `packMap`. This is the single non-Map cross-table dependency.
- **Pattern dispatch is centralised.** All string-content matching against `product` (99 literals + 22 regexes) is confined to one migration helper file (`taxonomy-mapping.ts`). Stage B can re-evaluate that file in isolation.

---

## 2. Files in scope (master list)

| File | P1 | P2 | P3 | P4 | P5 | P6 | Role |
|---|---|---|---|---|---|---|---|
| `lib/mail-orders/enrich.ts` |  | ✓ | ✓ | ✓ | ✓ |  | central enrichment engine — Maps, scoring, `SkuEntry` type, KW→SKU bridge (HIGH-TOUCH) |
| `lib/mail-orders/taxonomy-mapping.ts` | ✓ |  |  | ✓ |  |  | migration translator — 99 literals + 22 regexes; not on production hot path (scripts only) (HIGH-TOUCH) |
| `app/api/mail-orders/ingest/route.ts` | ✓ | ✓ | ✓ |  | ✓ |  | parser → DB ingest, runs `enrichLine` per line; defines `IngestRequest` contract (HIGH-TOUCH) |
| `app/api/mail-orders/re-enrich/route.ts` | ✓ | ✓ | ✓ |  |  |  | re-enriches last 2 days; same mapping pattern as ingest |
| `app/api/mail-orders/backfill-enrich/route.ts` | ✓ | ✓ |  |  |  |  | one-time backfill of all unmatched lines; HMAC-protected |
| `app/api/mail-orders/debug-enrich/route.ts` | ✓ | ✓ |  |  |  |  | debug endpoint that returns enrichment trace |
| `app/api/mail-orders/lines/[lineId]/resolve/route.ts` | ✓ | ✓ |  |  |  |  | manual resolve — `findUnique` on `material`, propagates to siblings |
| `app/api/mail-orders/skus/route.ts` | ✓ | ✓ | ✓ |  |  |  | typeahead SKU search — multi-field `where` |
| `app/api/order/data/route.ts` | ✓ | ✓ | ✓ |  |  |  | place-order page data — only cross-table join site (HIGH-TOUCH) |
| `lib/fini-resolver.ts` | ✓ | ✓ |  |  |  |  | Generic↔Fini code resolver; `material`/`refMaterial`/`description` only |
| `lib/mail-orders/utils.ts` | ✓ |  |  |  | ✓ |  | comment mention only; no runtime read |
| `lib/place-order/pack.ts` | ✓ |  |  |  |  |  | comment mention only |
| `app/order/page.tsx` | ✓ |  |  |  |  |  | comment mention only |
| `prisma/schema.prisma` | ✓ |  |  |  |  |  | model declaration |
| `app/api/import/obd/route.ts` |  |  |  |  |  | ✓ | defines `applyMailOrderEnrichment`; no `mo_sku_lookup` read |
| `lib/import-upsert/effects.ts` |  |  |  |  |  | ✓ | comment-only ref to `applyMailOrderEnrichment` |
| `lib/import-upsert.ts` |  |  |  |  |  | ✓ | comment-only ref |
| `scripts/preview-new-taxonomy.ts` | ✓ |  |  |  |  | ✓ | DB-backed taxonomy preview |
| `scripts/preview-new-taxonomy-from-csv.ts` | ✓ |  |  |  |  | ✓ | CSV-backed taxonomy preview |
| `scripts/phase1-restore-from-backup.ts` | ✓ |  |  |  |  | ✓ | restore script (comment refs) |
| `scripts/phase1-seed-mo-order-form-index.ts` | ✓ |  |  |  |  | ✓ | reseed script (comment refs) |

**HIGH-TOUCH files (3+ passes):** `lib/mail-orders/enrich.ts`, `app/api/mail-orders/ingest/route.ts`, `app/api/mail-orders/re-enrich/route.ts`, `app/api/mail-orders/skus/route.ts`, `app/api/order/data/route.ts`. Plus `lib/mail-orders/taxonomy-mapping.ts` (separate axis — string-content matching).

---

## 3. Composite keys catalogue (from Pass 3)

| Key | Build site | Read sites | Notes |
|---|---|---|---|
| `${product}\|${baseColour}\|${packCode}` | `lib/mail-orders/enrich.ts:276` (from `s.product`/`s.baseColour`/`s.packCode` of `SkuEntry`) | `lib/mail-orders/enrich.ts:640` (`pm.product`+`base`+`pack`), `app/api/mail-orders/re-enrich/route.ts:110` (`result.productName`+`result.baseColour`+`result.packCode`), `app/api/mail-orders/ingest/route.ts:375` (same) | Backs `byCombo` AND `byComboAlt` Maps |
| `material` (single field) | `lib/mail-orders/enrich.ts:282` | `lib/mail-orders/enrich.ts:459` | `byMaterial` Map; not composite, listed for completeness |
| `${product}\|\|\|${baseColour}` | `app/api/order/data/route.ts:93` (from `r.product`/`r.baseColour` of SKU row) | `app/api/order/data/route.ts:111` via `packKey` | `packMap` build (SKU side) |
| bare `product` | `app/api/order/data/route.ts:91` | `app/api/order/data/route.ts:111` via `packKey` (when `row.baseColour` null) | `packMap` build (SKU side, single-field key) |
| `${subProduct}\|\|\|${baseColour}` | `app/api/order/data/route.ts:101` (from `row.subProduct`/`row.baseColour` of `mo_order_form_index`) | `app/api/order/data/route.ts:111` | `packMap` read (form-index side — cross-table) |

---

## 4. The cross-table join (from Pass 3)

Single occurrence: `app/api/order/data/route.ts` (GET handler).

- **SKU side (line 61):** `prisma.mo_sku_lookup.findMany({ select: { product, baseColour, packCode } })` → `skuRows`.
- **Form-index side (line 46):** `prisma.mo_order_form_index.findMany({ where: { isActive: true }, select: { family, subProduct, baseColour, displayName, searchTokens, tinterType, productType, sortOrder } })` → `indexRows`.
- **Build (lines 88–95):** for each SKU row, populate `packMap` with bare `product` AND, if baseColour present, `${product}|||${baseColour}`. Both keys map to the SET of pack codes seen.
- **Read (lines 99–113):** for each index row, build `packKey = baseColour ? \`${subProduct}|||${baseColour}\` : subProduct` and look up `packMap.get(packKey)` to attach the SET of available packs.

**Implicit join condition:** `mo_sku_lookup.product === mo_order_form_index.subProduct` AND (`mo_sku_lookup.baseColour === mo_order_form_index.baseColour` OR `mo_order_form_index.baseColour IS NULL` → match any base of the same product).

The dual-key build means: index rows with NULL `baseColour` collect every pack across all colours; index rows with a specific `baseColour` collect only the packs of that specific colour variant.

---

## 5. String-content matching (from Pass 4)

Confined to ONE file: `lib/mail-orders/taxonomy-mapping.ts`.

Counts:
- 5 string-method calls on `legacy.product` / `prod` (`.toUpperCase()`, `.trim()`, `.includes()`)
- ~98 `prod === "LITERAL"` equality tests, gated by outer `cat === "..."` branches
- 0 `switch` statements
- 1 `find()` callback against `pm.product` (in `enrich.ts`, KW-shape, not LEGACY-MAP)
- 22 regex tests against `prod` (`/^PU\s+PRIME\b/`, `/THINNER/`, `/^[A-Z]{2}[0-9]$/`, etc.)

Distinct literal strings tested against `mo_sku_lookup.product`: **99**. Plus **22** regex patterns. Full deduplicated catalogue in `stage-a-pass4-raw.md`.

This file is invoked only from the Phase 1 preview scripts (`scripts/preview-new-taxonomy*.ts`) and `scripts/phase1-seed-mo-order-form-index.ts`. It is NOT on the production runtime path. Production runtime never inspects the content of `product` strings — it only uses them as opaque Map keys.

Outside `taxonomy-mapping.ts`, only 3 hits exist on any `.product` field in the broader codebase, and ALL three are inside `enrich.ts` doing variable-to-variable equality against `mo_product_keywords.product` derivatives (no string literals).

---

## 6. Implicit FK constraint (from Pass 5)

**Constraint:** `mo_product_keywords.product` strings must equal `mo_sku_lookup.product` strings character-for-character.

**Evidence chain (lib/mail-orders/enrich.ts):**
1. Line 276: `byCombo` Map built with key `${s.product}|...` from `mo_sku_lookup` rows
2. Line 307: `productProfiles` Map built with key `s.product` from `mo_sku_lookup` rows
3. Line 526: `pk.product` (from `mo_product_keywords`) copied into `ProductMatch.product`
4. Line 580: `productProfiles.get(pm.product)` — KW.product used as Map key built from SKU.product
5. Line 639: `${pm.product}|${base}|${pack}` — KW.product used in composite key
6. Line 640: `skuByCombo.get(key)` — silent miss when KW.product doesn't match SKU.product
7. Line 360: `if (pk.product !== prodName) continue;` — explicit string equality between KW.product and (a value originating from) SKU.product

**Schema enforcement:** none. `prisma/schema.prisma` declares `mo_sku_lookup` and `mo_product_keywords` as standalone models with no `@relation`.

**Code enforcement:** none. No validator. No assertion. No warning logged when a keyword's `product` value has no matching SKU.

**Documented symptoms (CLAUDE_MAIL_ORDERS.md §17):**
- "VT Velvetino — not in mo_sku_lookup" (keyword exists, SKU rows missing)
- "PU PRIME WHITE SEALER keyword maps to nonexistent product"

Both entries are recorded as "Pending" — they describe the same kind of drift the unenforced constraint allows.

---

## 7. Runtime data flow (from Pass 5)

**Pipeline:** rawText → keyword regex match → `ProductMatch.product` → composite Map key → SKU → `EnrichResult` → DB.

Step-by-step with line numbers (`lib/mail-orders/enrich.ts` unless noted):

1. **Parser POSTs raw line** to `app/api/mail-orders/ingest/route.ts:36-63` (`IngestRequest`). Sends `rawText`, `packCode`, `quantity`, `isCarton`, `carryProduct`. No SKU info.
2. **Route handler loads keyword + SKU data** (`ingest/route.ts:102-128`): `mo_product_keywords`, `mo_base_keywords`, `mo_sku_lookup` → `productKeywords[]`, `baseKeywords[]`, `skuEntries[]`.
3. **Maps built** (`enrich.ts:270-374`):
   - `buildSkuMaps(skuEntries)` → `byCombo`/`byComboAlt`/`byMaterial` Maps keyed by SKU fields.
   - `buildProductProfiles(skuEntries, productKeywords, baseKeywords)` → `Map<string, ProductProfile>` keyed by `s.product` (from SKU); reads `pk.product` and `pk.keyword` only inside an `isBaseProduct` cross-check.
   - `buildKeywordRegexes(productKeywords, baseKeywords)` → pre-compiled `\b...\b` regexes keyed by `pk.keyword`.
4. **enrichLine called per parser line** (`ingest/route.ts:355-367`).
5. **Material-code fast path** (`enrich.ts:457-477`): if rawText is a `(IN)?\d{5,10}` code, `skuByMaterial.get(noWs)` returns the `SkuEntry` directly — `product` field is read but not pattern-matched.
6. **Keyword regex pass** (`enrich.ts:518-529`): for each `pk` in `productKeywords`, test `pk.keyword` regex against rawText. Matches go into `prodMatches[]` carrying `pk.product` (KW string) into `ProductMatch.product`.
7. **Profile lookup** (`enrich.ts:580`): `productProfiles.get(pm.product)` — KW.product used as Map key built from SKU.product. Silent skip on miss.
8. **Candidate generation** (`enrich.ts:586-704`): for each (product, base, pack) triple, build composite key `${pm.product}|${base}|${pack}` (line 639) and `skuByCombo.get(key)` (line 640). Returns a `SkuEntry`. Score, store as `ScoredCandidate` with `sku: SkuEntry` reference.
9. **Ranking + winner selection** (`enrich.ts:706-768`).
10. **Result assembly** (`enrich.ts:797-808`): `EnrichResult` carries `top.sku.product`, `top.sku.material`, etc. — these are the SKU side, not the keyword side.
11. **Carton multiplication** (`ingest/route.ts:373-382`): `matchedKey = ${result.productName}|${result.baseColour}|${result.packCode}`, `skuByCombo.get(matchedKey)` again to retrieve `piecesPerCarton`. Uses the SKU-side strings the enrich result returned.
12. **DB write** (`ingest/route.ts:386-405`): persists `productName` (= `top.sku.product`), `skuCode` (= `top.sku.material`), etc. into `mo_order_lines`.

The pipeline reads `product` as a string from `mo_product_keywords` exactly twice (steps 7 and 8 — both as a Map key). Otherwise the field is opaque.

---

## 8. External consumers (from Pass 6)

Confirmed clean — zero `mo_sku_lookup` runtime references:

- OBD import path (`app/api/import/obd/route.ts`, `lib/import-upsert*`) — uses `sku_master`, applies `mo_orders` enrichment only
- Admin endpoints (51 routes under `app/api/admin/`)
- Admin pages (`app/(admin)/`)
- Dispatch/planning pipeline (`app/api/planning/`)
- Support pipeline (`app/api/support/`)
- Warehouse pipeline (`app/api/warehouse/`)
- Tint pipeline (`app/api/tint/`)
- Operations view (`app/api/operations/`)
- Cron / scheduled — no `vercel.json` exists; the only external scheduler is the depot PC's `Auto-Import.ps1` (POSTs to `/api/import/obd`, no SKU exposure)
- `sku_master` codepath — 11 files, zero overlap with the 8 `mo_sku_lookup` reader files

Surprises: none.

---

## 9. High-touch files for Stage B

In priority order:

1. **`lib/mail-orders/enrich.ts`** — the central matching engine. Owns `SkuEntry` type, `byCombo` Map shape, `productProfiles` Map shape, and the KW→SKU bridge (lines 526, 580, 639, 640). Any change to `product`'s shape ripples through this file first.
2. **`lib/mail-orders/taxonomy-mapping.ts`** — 99 literals + 22 regexes against legacy `mo_sku_lookup.product`. Stage B must re-evaluate every dispatch case if `product` content semantics change. Used only by scripts/preview/seed, so production blast radius is limited, but the migration's correctness depends on this file.
3. **`app/api/mail-orders/ingest/route.ts`** — defines parser contract (`IngestRequest`), loads SKU data, runs the per-line enrichment loop, performs carton multiplication using `matchedKey`. The "live" runtime path most tightly bound to current SKU shape.
4. **`app/api/mail-orders/re-enrich/route.ts`** — same pattern as ingest, applied to historical lines. Must stay aligned with ingest.
5. **`app/api/order/data/route.ts`** — the single cross-table join. The `(product, baseColour)` ↔ `(subProduct, baseColour)` contract is a Stage B design pivot.
6. **`app/api/mail-orders/skus/route.ts`** — typeahead `where` filters on `product`/`baseColour` plus `material`/`description`. UX impact if the field shape changes.
7. **`app/api/mail-orders/lines/[lineId]/resolve/route.ts`** — looks up by `material` only, but writes back `productName: sku.product` to `mo_order_lines`. Decides what value lands in the historical record.
8. **`lib/mail-orders/enrich.ts: buildSkuMaps`** — touched by `backfill-enrich` and `debug-enrich` route handlers as well; same Map shape applies.

Plus the implicit constraint: any Stage B SKU-side schema change must be paired with a `mo_product_keywords` schema/data migration. The two tables are coupled through the runtime even though no FK exists.

---

## 10. Out-of-scope confirmations

Files explicitly confirmed clean across passes 1–6:

- `lib/mail-orders/customer-match.ts` — 0 SKU references
- `lib/mail-orders/delivery-match.ts` — 0 SKU references
- `lib/mail-orders/utils.ts` — comment-only mention, no runtime SKU read
- `lib/mail-orders/types.ts` — 0 references
- `lib/mail-orders/api.ts` — 0 references (client fetch helpers only)
- `lib/mail-orders/email-template.ts` — 0 references (uses `mo_order_lines.productName` strings)
- `lib/mail-orders/enrich-v2.ts` — dead code, duplicate `SkuEntry`, not imported anywhere (cleanup item, not Stage B)
- All non-mail-orders pipeline routes (Pass 6 §4–7)
- `sku_master` codepath (Pass 6 §6)

---

## 11. Open questions for Stage B

Numbered consolidation across passes. These drive Stage B's design conversation; Stage A does NOT answer them.

1. **(Pass 5)** Is the implicit `mo_product_keywords.product` ↔ `mo_sku_lookup.product` string-equality contract reliable? If not, where else might silent drift have accumulated besides the two known cases (VT Velvetino, PU PRIME WHITE SEALER)?
2. **(Pass 5)** If `mo_sku_lookup.product` splits into `product + subVariant`, what happens to `mo_product_keywords.product`? Coarser key with multiple subVariants per keyword? Or does the keyword table also gain a `subVariant` column?
3. **(Pass 5)** What's the resolve-time path? `mo_order_lines.productName` written at `lines/[lineId]/resolve/route.ts:63` carries `sku.product` directly. After the split, what value lands there? Compound legacy string? `product` only? Concatenated `${product} ${subVariant}`?
4. **(Pass 5)** What's the `/api/mail-orders/skus` typeahead behaviour after the split? Does an operator's search for "PU MATT" still hit rows where the new shape is `product='2K PU'`/`subVariant='MATT'`? Does the `where` need a recompose against the concatenation?
5. **(Pass 5)** Is `pk.category` actually unused? Pass 5 §2 found `pk.category` is read by route handlers when projecting rows but never used in `enrich.ts`. Stage B should decide: preserve, repurpose for the new shape, or drop.
6. **(Pass 4)** Each of the 99 literal strings + 22 regex patterns in `taxonomy-mapping.ts` must be re-evaluated: which of them encode `product` semantics, which encode `subVariant`, and how does the dispatch table reorganise after the split? See `stage-a-pass4-raw.md` Step 6 for the full inventory.
7. **(Pass 3)** The `byCombo` key shape `${product}|${baseColour}|${packCode}` — does it become `${product}|${subVariant}|${baseColour}|${packCode}` (4-part), or stay 3-part with `product` redefined as the combined catalog name? Affects 4 build/read sites.
8. **(Pass 3)** The `app/api/order/data/route.ts` cross-table join — currently `mo_sku_lookup.product` ↔ `mo_order_form_index.subProduct`. Does `mo_order_form_index.subProduct` align with the new `mo_sku_lookup.subVariant`, or with `mo_sku_lookup.product`? The two columns currently happen to share a string namespace; that may stop being true after the split.
9. **(Pass 2)** `EnrichResult` interface: `productName`, `baseColour`, `packCode` are returned to callers. After the split, does `EnrichResult` carry `subVariant` as a new field, or does `productName` continue carrying the compound? Affects every caller's persistence and display.
10. **(Pass 2)** Does the parser's `carryProduct` hint need to be split as well? Currently a single string passed from PowerShell; semantically refers to `mo_sku_lookup.product`. If the catalog meaning changes, the v6.5 carry-forward heuristic may need to be re-tuned.
11. **(Pass 6)** Confirmed `sku_master` and `mo_sku_lookup` are separate. Does the Stage B subVariant concept eventually want to align with `sku_master.subSku` (the SAP normalised side)? Or stay independent?

---

## 12. Out-of-scope items (NOT for Stage A)

Stage A recorded these but they are explicitly Stage B+'s problem:

- The `taxonomy-mapping.ts` dispatch table redesign
- The `mo_product_keywords` schema/data migration shape
- The `app/api/order/data/` join pivot decision
- All schema design decisions (whether to add `subVariant`, what type, what default, what unique constraint)
- Stage B writes (Phase 2 catalog migration, Phase 2 T3 rebadge cleanup) — already deferred per `docs/CLAUDE_MAIL_ORDERS.md §17`

---

## 13. Cleanup notes (housekeeping, not Stage B)

- `lib/mail-orders/enrich-v2.ts` is dead code (orphan duplicate `SkuEntry` interface; verified via `from.*enrich-v2` grep returns no importers in Pass 2). Safe to remove independently of Stage B.
- `mo_product_keywords.category` is read by route handlers when projecting `productKeywordsRaw` rows (`re-enrich:31`, `backfill-enrich:48`, `ingest:109`, `debug-enrich:38`) but never read inside `lib/mail-orders/enrich.ts`. Effectively dead in the matching path.
- Two phantom Phase 1 temp files: `scripts/phase1-spotcheck-tmp.ts`, `scripts/phase1-rollback-verify-tmp.ts`. Already noted in `docs/prompts/drafts/session-end-2026-05-06-taxonomy-phase1-summary.md`.
- `CATEGORY_KEYWORDS` dead-code comment in `enrich.ts:115-119` — already flagged in `docs/CLAUDE_MAIL_ORDERS.md §17`.

---

## 14. Audit method documentation

Method: 6 read-only Claude Code passes over `lib/`, `app/`, `scripts/`, and `prisma/schema.prisma`. Each pass produces a raw-findings file under `docs/prompts/drafts/stage-a-passN-raw.md`; this final report consolidates them.

| Pass | Question answered |
|---|---|
| 1 | Where is `mo_sku_lookup` queried directly? (raw `prisma.mo_sku_lookup.*` and SQL `from mo_sku_lookup`) |
| 2 | What fields of the result objects are read, including across function-call boundaries and through TypeScript types? |
| 3 | What composite keys (Map keys, `where` clauses, cross-table joins) include `mo_sku_lookup.product`? |
| 4 | Where does code pattern-match the literal string content of `product` (regex / `.includes` / `===`)? |
| 5 | What's the data flow from raw email text into SKU match, and what implicit constraints exist between `mo_product_keywords.product` and `mo_sku_lookup.product`? |
| 6 | Are there external consumers (OBD import, admin, dispatch/warehouse/tint, scripts, cron) that touch `mo_sku_lookup`? |

Operational rules:
- No DB writes. No code edits. No `npm`/`prisma`/`node`/`tsc` runs.
- Tools used: `Grep`, `Glob`, `Read`, `Write` only.
- Each pass writes exactly one raw-findings file at the end; no intermediate files.
- Method preserves production stability throughout.

Approximate cost: 15–20 minutes per pass in Claude Code (one model turn each, with parallel grep batches). Total Stage A: ~2 hours of model time.

---

*Stage A complete. Stage B begins with new prompt in next session.*
