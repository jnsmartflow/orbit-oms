# Stage B — Schema migration design (locked decisions)
# OrbitOMS taxonomy migration · Phase 2 prep
# Generated: 2026-05-08

**Stage:** B (schema design — read-only, no DB writes, no code changes)
**Predecessor:** Stage A audit (`stage-a-final-report-2026-05-07.md`)
**Successors:** Stage C (data migration design) → Stage D (parser/enrichment update) → Stage E (live SKU migration) → Stage F (re-apply taxonomy redesign) → Stage G (Phase 2 hygiene)

---

## 1. Executive summary

Stage B locks the schema-design decisions for adding `subVariant` to the mail-orders SKU pipeline. Three new columns across three tables, no other schema changes, no dropped columns, no new FK constraints. The 11 open questions from Stage A §11 are resolved below; the migration's blast radius stays inside the mail-orders module.

**Primary justification for the migration:** structural fix for the May 2026 taxonomy redesign failure. The 33-family redesign on `mo_order_form_index` failed because the cross-table join to `mo_sku_lookup` was a string-equality match on compound product names. Splitting `product` into `product + subVariant` and mirroring the split on the catalog side decouples display strings from the join, making future redesigns safe.

**Operator-facing impact:** none on `/order` (search behaviour preserved). `/place-order` becomes browsable by 33 families when Stage F ships. Tile granularity stays at today's level (Luxurio PU Matt — 90, etc.).

---

## 2. Column shape lock (Q8.5)

Three new columns added across three tables. Each is `TEXT` and nullable (some products have no variant axis: THINNER, BRUSH, etc.).

| Table | Column | Type | Nullable | Default |
|---|---|---|---|---|
| `mo_sku_lookup` | `subVariant` | TEXT | YES | NULL |
| `mo_product_keywords` | `subVariant` | TEXT | YES | NULL |
| `mo_order_form_index` | `variant` | TEXT | YES | NULL |

**Naming:**
- SKU and keyword tables use `subVariant` (matches the mail-orders semantic vocabulary)
- Form-index uses `variant` (matches the existing `subProduct` naming on that table)
- Different names, same concept. Each name fits its table's existing convention.

**Unique constraint impact:**
- `mo_sku_lookup` — current unique index likely on `(product, baseColour, packCode)`. After: `(product, subVariant, baseColour, packCode)`. Verify exact constraint shape before Stage E.
- `mo_product_keywords` — current unique index likely on `(keyword, product)`. After: `(keyword, product, subVariant)`. Verify before Stage E.
- `mo_order_form_index` — current unique constraint is `(family, subProduct, baseColour)` (widened earlier in 2026). After: `(family, subProduct, variant, baseColour)`.

**No dropped columns. No FK constraints added.** Implicit string-FK between `mo_product_keywords.product` and `mo_sku_lookup.product` stays unenforced (Q1 lock).

---

## 3. Locked answers — the 11 open questions

### Q1 — Implicit FK reliability

**Answer:** FK is reliable in practice. The 2026-05-07 LEFT JOIN audit found 1 forward-drift case (`product='VT'`, single keyword). No design change required for Stage B.

**Action:**
- Single VT row → Stage G cleanup. Confirm with Chandresh before deleting.
- No hard FK added in Stage E.
- No pre-migration validator script needed.

**Out of scope (logged for later):** 20 reverse-drift products (SKU-with-no-keyword) found by the audit. Two flagged for Stage G enrichment-coverage review:
- AUTO STAR (58 SKU rows, no keyword) and 5IN1 (26 SKU rows, no keyword) — likely real keyword gaps costing operator time
- Five WS-prefixed products (PRIMA E900, PROJECT, TR E2000, FLASH, ULTRACLEAN) — may indicate fragile WS keyword regex

### Q2 — Keyword table after the split

**Answer:** Add `subVariant TEXT NULL` to `mo_product_keywords`, mirroring the SKU side. Keyword rows that encode subVariant info today (e.g. "LUXURIO MATT") get migrated to `(product='LUXURIO PU', subVariant='MATT')`. Rows without a variant axis stay `subVariant=NULL`.

**Match logic:** keyword's `(product, subVariant)` must equal SKU's `(product, subVariant)`. NULL on either side counts as a wildcard for that field — same convention as `baseColour` today.

### Q3 — `mo_order_lines.productName` after the split

**Answer:** `productName` continues to carry the compound string `${product} ${subVariant}` (single space separator) when subVariant is non-null, or just `product` when NULL. No new column on `mo_order_lines`.

**Implementation:** one-line change at `lines/[lineId]/resolve/route.ts:63` and any other SKU→line write site. Email template, operator UI, SAP punching, and reports remain unchanged.

**Reversibility guard (Stage C requirement):** every legacy SKU row's `product` string must equal `${new.product} ${new.subVariant}` exactly (NULL-safe). Any row that fails goes to a manual review queue.

### Q4 — Typeahead search after the split

**Answer:** Add `subVariant` to the field list in `app/api/mail-orders/skus/route.ts` `where` clause. Each search token must hit at least one of `{ product, subVariant, baseColour, material, description }` (case-insensitive `contains`).

**One-line change.** No new query patterns, no concatenation logic, no computed columns.

**Stage D verification:** manual operator test. Search "matt 90" returns the same tiles after as before.

### Q5 — `mo_product_keywords.category`

**Answer:** Out of scope for the SKU migration. Selected by 4 route handlers, never read by the matching engine. Treat as dead but **do not drop, repurpose, or modify** during Stages B–F.

**Stage G candidate:** consider dropping after a separate non-Next.js audit (PowerShell scripts, ad-hoc SQL).

### Q6 — `taxonomy-mapping.ts` rewrite

**Answer:** Rewritten in **Stage F** against the post-split SKU shape. Mechanical translation:
- Every literal `prod === "X Y"` becomes `prod === "X" && sub === "Y"`
- Most regexes collapse to exact equality (the reason regexes existed — trailing variant words — is the reason the split exists)
- Estimated 15–18 of 22 regexes simplify to exact equality

**Stage F protocol:**
1. Rewrite `taxonomy-mapping.ts` against new shape
2. Run `scripts/preview-new-taxonomy.ts` against post-split SKU data
3. Diff output against the 2026-05-06 preview baseline (`docs/prompts/drafts/taxonomy-preview.json`)
4. Only proceed to seed if preview matches

The rewrite uses Stage C's `(product, subVariant)` split as its source of truth. **Single mapping, two consumers.**

### Q7 — Composite key shape

**Answer:** Key becomes 4-part: `${product}|${subVariant ?? ""}|${baseColour ?? ""}|${packCode}`. NULL fields encode as empty segments.

**Applies to both `byCombo` and `byComboAlt` Maps** in `enrich.ts`, plus the rebuild sites in `ingest.ts:375` and `re-enrich.ts:110`.

**Stage C parser guard:** reject any split where either `product` or `subVariant` contains a literal pipe (`|`). One-line check, prevents lifetime of weird bugs.

**Stage D detail flagged:** `productProfiles` Map at `enrich.ts:307` — currently keyed by `s.product` only. Decision needed in Stage D: stay keyed by `s.product` (coarser, my recommendation) or extend to `${s.product}|${s.subVariant}` (finer). Coarser keeps the per-product cache shared across variants. Stage D detail, not a Stage B lock.

### Q8 — The cross-table join (the central design pivot)

**Answer:** Form-index gets a new `variant` column. The cross-table join in `app/api/order/data/route.ts` becomes a 3-field exact match:
- `mo_order_form_index.(subProduct, variant, baseColour)` ↔ `mo_sku_lookup.(product, subVariant, baseColour)`

**Tile granularity preserved.** Operators continue seeing fully-disambiguated tiles:
- "Luxurio PU Matt — 90" stays as a distinct tile (does NOT collapse into a "Luxurio PU" tile)
- "WS Max — BW", "WS Max — 90", "WS Max — 92" stay as distinct tiles
- "Stainer Blue", "Stainer Red" etc. stay distinct (no variant axis there anyway)

**`displayName` is fully decoupled from the join.** The catalog can rename display labels freely without breaking pack-panel rendering. This is the structural fix for the May 2026 failure.

**`displayName` shape — defer to Stage F.** Decision depends on how the pack panel renders. Likely `${subProduct} ${variant} — ${baseColour}` for variant-bearing products, `${subProduct} — ${baseColour}` otherwise. Confirmed at Stage F.

**Stage F seed protocol:** seed script generates one form-index row per `(product, subVariant, baseColour)` combination present in `mo_sku_lookup`. Row count stays roughly at today's ~481 (possibly higher after the 33-family redesign — not lower).

### Q9 — `EnrichResult` shape after the split

**Answer:** `EnrichResult` carries `subVariant` as a separate nullable field. The `productName` field (recommend renaming to `product` to match the DB column name) holds only the product half. Callers compose the compound string when persisting to `mo_order_lines.productName` per Q3.

**Field rename (`productName` → `product`):** recommended for long-term clarity. Stage D mechanical update across 8 caller files. Optional — if minimised diff is preferred, keep the existing name with redefined meaning.

**Composition pattern:**
```ts
const persistedProductName = result.subVariant
  ? `${result.product} ${result.subVariant}`
  : result.product;
```

### Q10 — Parser `carryProduct` hint

**Answer:** `carryProduct` stays as a single string in `IngestRequest`. The PowerShell parser is **unchanged** by this migration.

The matcher splits `carryProduct` server-side on entry to `enrichLine`, using the same `splitLegacyProduct` helper that Stage C builds for the SKU data migration.

**One split helper, three callers:**
1. Stage C — bulk migration of 1,599 legacy SKU rows
2. Q9 — `EnrichResult` composition (the inverse, on output)
3. Q10 — `carryProduct` handling on input

**Future v6.6 parser:** if PowerShell parser ever gets a major refactor, the split could move client-side at that time. Not now.

### Q11 — Alignment with `sku_master.subSku`

**Answer:** Stay independent. **Forever, not just for now.**

- `mo_sku_lookup.subVariant` and `sku_master.subSku` are decoupled
- No FK, no naming alignment, no data-sync between them
- The two tables serve different pipelines (mail-orders vs OBD/SAP) and should evolve independently

**Future "unify SKU tables" project:** out of scope for this migration. If it happens, it's a separate workstream scoped on its own merits.

---

## 4. Rollback plan

If Stage E's live SKU migration must be reverted, the rollback path is:

**Reversibility precondition (locked):** Stage C's parser must produce a split where `legacy.product === ${new.product} ${new.subVariant ?? ""}`.trim()` for every row. Any row that fails this guard goes to a manual review queue and **is not migrated** until manually resolved.

**Rollback procedure (if Stage E goes live and needs reversion):**

1. **Stage E backup (mandatory):**
   - Before any DDL: full dump of `mo_sku_lookup`, `mo_product_keywords`, `mo_order_form_index`
   - Save to `docs/prompts/drafts/stage-e-pre-migration-backup-{YYYY-MM-DD}.json`
   - Same approach as the 2026-05-06 form-index backup

2. **Reversal SQL (drafted in Stage E, not run unless needed):**
   ```sql
   -- Restore mo_sku_lookup.product to compound form
   UPDATE mo_sku_lookup
   SET product = TRIM(product || ' ' || COALESCE(subVariant, ''))
   WHERE subVariant IS NOT NULL;

   ALTER TABLE mo_sku_lookup DROP COLUMN subVariant;
   -- Same pattern for mo_product_keywords and mo_order_form_index
   ```

3. **Code rollback:** revert the deployment commit. All `EnrichResult` callers, composite-key build sites, and join logic snap back to the pre-migration shape.

**Rollback stays viable as long as the reversibility precondition holds.** Once any new mail order is written with the post-split shape (e.g. an `EnrichResult` returns subVariant separately and gets persisted), full rollback requires rebuilding compound strings in `mo_order_lines.productName` — but per Q3, `productName` already carries the compound, so this is automatic.

**Stage E adds a smoke test:** after migration, run a query that re-composes every SKU's compound and compares against a pre-migration dump. Any mismatch halts the migration.

---

## 5. Stage C scoping note

Stage C designs the data migration: parse 1,599 `mo_sku_lookup.product` strings into `(product, subVariant)` pairs. Generate a review JSON before any DB writes. Same review-then-apply pattern Stage F's seed script uses.

**Stage C deliverables:**
- A `splitLegacyProduct(legacy: string): { product: string, subVariant: string | null }` helper (TypeScript, in `lib/mail-orders/`)
- A preview script that reads all 1,599 legacy rows, runs the splitter, writes `docs/prompts/drafts/sku-split-preview.json` with row-by-row output
- A reversibility check: every row's split must satisfy `legacy === ${new.product} ${new.subVariant ?? ""}`.trim()
- A manual-review queue for rows that fail the reversibility check
- Same approach extended to `mo_product_keywords.product` (additional preview file)

**Inputs Stage C needs:**
- The 99 literal rules + 22 regexes from `taxonomy-mapping.ts` (already on disk) — they tell us which trailing words are variants
- A sample of legacy `product` strings grouped by category (informs the splitter's heuristics)
- The 33-family redesign master doc (`docs/prompts/drafts/web-update-2026-05-06-master-taxonomy-redesign.md`) — confirms which variants are real categories

**Stage C outputs (consumed by D, E, F):**
- `splitLegacyProduct` helper — used at runtime by Q9/Q10 callers AND by the Stage E migration script
- `sku-split-preview.json` — Smart Flow's review-and-approve gate before Stage E
- Manual-review queue — drift cases needing human decision

**Estimated session shape:** one Claude session for Stage C scoping + preview-script draft. Smart Flow runs preview locally, reviews JSON, approves before Stage D begins.

**Risk note:** Stage C is where the migration's hardest call lands. The split helper has to handle every product family in the catalog. Edge cases (THINNER with no variant, INT CLR 2K PU MATT with category prefix to drop, base colour codes that look like variants) need careful design. Stage C should be its own session, not bolted onto Stage D.

---

## 6. Cleanup items surfaced (housekeeping, not Stage B)

These are independent of the migration, can be addressed any time:

- `lib/mail-orders/enrich-v2.ts` — dead code, orphan duplicate `SkuEntry` interface, no importers. Safe to delete.
- `mo_product_keywords.category` — Q5 deferred to Stage G after non-Next.js audit
- `scripts/phase1-spotcheck-tmp.ts`, `scripts/phase1-rollback-verify-tmp.ts` — phantom temp files
- `CATEGORY_KEYWORDS` dead-code comment at `enrich.ts:115-119` — already flagged in CLAUDE_MAIL_ORDERS.md §17
- Single VT keyword row (Q1 forward drift) — confirm with Chandresh before deleting

**Stage G enrichment-coverage review (new):**
- AUTO STAR, 5IN1 keyword gaps (Q1 reverse drift)
- Five WS-prefixed orphan products (Q1 reverse drift)

---

## 7. Engineering rules respected

- No `prisma db push`. Schema changes will go via Supabase SQL Editor + `npx prisma generate` (Stage E).
- No `prisma.$transaction`. Sequential awaits everywhere.
- Stage B is design-only — zero DB writes, zero code changes, zero schema changes this session.
- All new schema changes use camelCase column names (no `@map`).
- All affected API routes will retain `export const dynamic = 'force-dynamic'` (Stage D doesn't change route exports).
- Stage E will run `tsc --noEmit` clean before any deployment.

---

## 8. Multi-stage workstream — current position

- ✅ **Stage A — Read-only audit** (2026-05-07)
- ✅ **Stage B — Schema design** (2026-05-08, this document)
- ⏳ **Stage C — Data migration design** (next session)
- ⏳ **Stage D — Update parser/enrichment**
- ⏳ **Stage E — Apply SKU migration to live DB**
- ⏳ **Stage F — Re-apply taxonomy redesign**
- ⏳ **Stage G — Phase 2 hygiene**

---

## 9. Decision log (audit trail)

For future-Smart-Flow: every Q1–Q11 lock above was reached by walking through proposed-answer + trade-offs in a Stage B planning session, with explicit "ok" approval per question.

The Q8 answer was specifically revised mid-session after Smart Flow corrected an early misreading: tile granularity must be preserved (operators need disambiguated tiles like "Luxurio PU Matt — 90", not collapsed "Luxurio PU" tiles). The locked Option C — split form-index columns with three-field join — is the structural fix that preserves operator UX while preventing the May 2026 failure mode.

---

*Stage B complete. Stage C begins with a fresh prompt in the next session.*
