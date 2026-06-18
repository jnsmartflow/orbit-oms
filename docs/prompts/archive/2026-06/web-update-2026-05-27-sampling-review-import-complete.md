# Sampling Library — REVIEW pile import complete

**Session date:** 2026-05-27
**Author:** Smart Flow (planned in Claude.ai, executed in Claude Code)
**Outcome:** 601 legacy REVIEW sampling numbers imported. 827 recipes + 2,549 usage_log rows added. Schema relaxed to allow null packCode. Site backfill recovered 230 parents.

---

## TL;DR

- Imported the 4-year legacy REVIEW pile from `Tinting_data_Tracker_N_FINAL_REVIEW.xlsx` into the live Sampling Library.
- Applied majority-shadeName consolidation rule per user direction: biggest shadeName group wins, minority outlier rows dropped entirely (no recipe, no usage_log).
- Hit 4 schema/code blockers along the way — all fixed forward, none deferred.
- 91% of imported parents still siteless after master-match — fuzzy-match deferred to Phase 5.

---

## Final counts

| Table | Baseline before | Delta | After |
|---|---|---|---|
| `sampling_register` | 3,599 | +601 | 4,200 |
| `sampling_recipes` | 29 (mostly empty pre-import) | +827 | 856 |
| `sampling_usage_log` | 10,653 | +2,549 | 13,204 |

Notes:
- 4 orphan parents (samplingNos 674, 675, 1328576, 1328674) deleted post-import because their only source rows were SKU=0 garbage.
- 3 parents had `createdAt` shifted via UPDATE because their original earliest-date row was dropped by the bad-row filter (133459, 133460, 134712).
- 4 newly-promoted sampling numbers (506, 622, 133854, 1328578 — previously in Skipped_Tie) were NOT imported; their bad-row filter resolved the tie but they fell outside the deployed file 01.

---

## Pipeline summary

702 REVIEW samplingNos in source Excel:

| Outcome | Count | Path |
|---|---|---|
| Importable (clear majority) | 372 | Auto-import |
| Single_Row (only 1 source row) | 233 | Auto-import |
| Skipped — SPL prefix conflict | 24 | Deferred to Chandresh |
| Skipped — 2v2 tie | 69 (was 73, 4 promoted out) | Deferred to manual review |

Of the 605 importable, 4 became orphans → **601 actually landed in DB.**

Sub-stats:
- 827 recipes inserted (831 minus 4 orphans' 4 recipes)
- 389 recipes got a packCode resolved from stock/master lookup (47%)
- 438 recipes have packCode=null (operators identify by SKU code) (53%)
- 14 bad source rows dropped during consolidation (blank SKU, SKU="0", blank shade)
- 284 minority-outlier source rows dropped per majority rule

---

## Schema changes applied

### `sampling_recipes.packCode` — relaxed to nullable

Before:
```
packCode    PackCode
```

After:
```
packCode    PackCode?
```

Also recreated the composite unique constraint with `NULLS NOT DISTINCT` so duplicate null-pack rows on re-import are blocked:

```sql
ALTER TABLE "sampling_recipes" DROP CONSTRAINT IF EXISTS "sampling_recipes_samplingNo_skuCode_packCode_key";
CREATE UNIQUE INDEX "sampling_recipes_samplingNo_skuCode_packCode_key"
  ON "sampling_recipes" ("samplingNo", "skuCode", "packCode") NULLS NOT DISTINCT;
```

### Why nullable

Legacy paper register data has 4 years of entries where pack size wasn't recorded in the source. Default-to-18L would lie about data quality. Skipping would lose 388 sampling numbers (64% of the pile). Nullable lets the data land truthfully and operators identify by SKU code instead.

---

## Code changes applied (commit `0a05f5ad`)

Fixes for null-safe pack handling:

1. `components/sampling-library/sampling-library-detail-pane.tsx` — `packCodeToLabel` accepts `string | null | undefined`, returns `—` for null. `Variant.packCode` widened to `string | null`. Map key + PackGroup cascade widenings.
2. `components/tint/operator/suggestion-card.tsx` — same `packCodeToLabel` null guard.
3. `app/api/sampling-library/_lib/suggest.ts` — `SuggestExactMatch.packCode`, `SuggestReferenceItem.packCode`, `VariantAcc.packCode` widened to `PackCode | null`.
4. `app/api/sampling-library/_lib/detail.ts` — `primaryRecipe.packCode` widened to `PackCode | null`.
5. `prisma/schema.prisma` — `packCode PackCode?` on `sampling_recipes`.

Deferred fix (not blocking): operator Scenario 3 mid-edit at `app/api/tint/operator/_lib/sampling-resolution.ts:82` — `findUnique` on composite key can't find legacy null-pack recipes; falls through to create-new-variant. Real-world impact: only if operator submits TI for a SKU that has a legacy null-pack recipe. Worth fixing later.

---

## Smart lookup logic — SKU resolution

The generator tries each strategy in order:
1. Exact match in `stock_21_05_2026.xlsx` (current SAP inventory)
2. Exact match in `sku-master.xlsx` (9-sheet legacy master)
3. Case-insensitive (uppercase) match in stock then master
4. Prefix fix: SKU starting with `N` (not `IN`) → try with `I` prepended in stock then master
5. Prefix fix: SKU not starting with `I` or `N` → try with `IN` prepended in stock

If found, sets `skuCode` = resolved form, `productName` = description, extracts `packCode` from description tail.

If unknown, keeps raw SKU as-is, `productName` = null, `packCode` = null. **Recipe still gets imported.**

### Pack code regex

Patterns recognised (case-insensitive, tolerates "20L" / "20 L" / "20LT" / "20 LT" / "20Ltr"):

| Pattern matched | Mapped to enum value |
|---|---|
| `500ML`, `200ML`, `5KG`, `1KG`, `26L` | NULL (no enum slot) |
| `20L` | `L_20` |
| `19L` | `L_18` (treat as 18L family per user) |
| `18.5L` | `L_18_5` |
| `18L` | `L_18` |
| `10L` | `L_10` |
| `4L` | `L_4` |
| `3.7L` | `L_3_7` |
| `3.6L` | `L_4` (treat as 4L family per user) |
| `1L` | `L_1` |

---

## Bad-row filter (added mid-session after file 02 crashed)

Drops source rows where ANY of:
- `skuCode` is null/empty/whitespace
- Trimmed `skuCode` equals `"0"`
- `shadeName` is null/empty/whitespace

Affected 14 rows across 14 sampling numbers. Drop is pre-consolidation — these rows form no recipe, no usage_log, and contribute no date to the parent's `createdAt`.

---

## Site backfill applied

Two case-insensitive UPDATE statements ran post-import:

```sql
UPDATE "sampling_register" sr
SET "siteId" = dpm.id
FROM "delivery_point_master" dpm
WHERE sr."siteId" IS NULL
  AND sr."siteNameRaw" IS NOT NULL
  AND LOWER(TRIM(sr."siteNameRaw")) = LOWER(TRIM(dpm."customerName"));

UPDATE "sampling_usage_log" ul
SET "siteId" = dpm.id
FROM "delivery_point_master" dpm
WHERE ul."siteId" IS NULL
  AND ul."siteNameRaw" IS NOT NULL
  AND LOWER(TRIM(ul."siteNameRaw")) = LOWER(TRIM(dpm."customerName"));
```

Impact:
- `sampling_register.siteId` populated: 1,554 → 1,784 (+230 across our 601 AND Phase-1 leftovers)
- `sampling_usage_log.siteId` populated: ~3,800 → ~10,200 (+~6,400 history rows)
- Remaining siteless parents: 2,411 (needs Phase 5 fuzzy match)

---

## Suggestion visibility — IMPORTANT for next session

`app/api/sampling-library/_lib/suggest.ts` matches "past tinting at same site" on `sampling_usage_log.siteId` ONLY. There is no `siteNameRaw` fallback in the suggest pipeline.

After our site backfill:
- 230 of our 601 sampling numbers will surface in operator suggestions (the ones with exact case-insensitive site name match in delivery_point_master).
- The other ~371 are invisible to suggestions until siteId is populated.

This is the same blind spot Phase 1 had (2,041 leftovers). Phase 5 fuzzy site match would benefit both cohorts.

---

## Files generated this session (all in `docs/plans/sampling-register/`)

- `REVIEW_CONSOLIDATED_PREVIEW.xlsx` — 6-sheet preview Excel (Importable, Single_Row, Skipped_SPL_Prefix, Skipped_Tie, Dropped_Rows_Log, Summary)
- `sql/00_pre_import_verification.sql`
- `sql/01_sampling_register.sql` — 605 parent INSERTs
- `sql/02_sampling_recipes.sql` — 827 recipe INSERTs (final version)
- `sql/03_sampling_usage_log.sql` — 2,549 usage_log INSERTs (final version)
- `sql/04_post_import_backfill.sql` — recipeId backfill with prefix-tolerant matching
- `sql/dry-run/` — 4 dry-run files + README

Generator scripts (preserved, not deleted):
- `scripts/_generate-review-preview.ts` (v1)
- `scripts/_generate-review-preview-v2.ts` (v2 with majority rule)
- `scripts/_generate-review-import-sql.ts` (final, with bad-row filter)
- `scripts/_generate-review-dry-run-sql.ts`
- `scripts/_diagnose-final-review.ts`
- `scripts/_diagnose-site-matching.ts` (one-shot SELECT)

---

## Skipped / deferred for next session

| Item | Why | Where to find |
|---|---|---|
| 24 SPL prefix conflicts | SPL vs non-SPL is a real product distinction, not a typo | `Skipped_SPL_Prefix` sheet in preview |
| 69 2v2 ties | No majority winner | `Skipped_Tie` sheet in preview |
| 4 newly-promoted from ties | Excluded from this import to avoid FK chaos | Listed in Step 5c report |
| Fuzzy site match (~2,411 siteless parents) | Out of scope for this session | Phase 5 ROADMAP item |
| Operator Scenario 3 null-pack edge case | Tiny corner case, no blocker | `sampling-resolution.ts:82` |
| Data quality cleanup (duplicate sampling numbers, manual shade-value refinement) | User-requested next session | See companion prompt |

---

## Lessons learned

1. **Trust schema verification gates.** Claude Code's Phase-3a audit caught 3 crash sites + 4 type lies BEFORE we ran SQL that would have white-screened the production app. The "verify before fix" pattern paid off massively.

2. **Dry-run is not optional.** Sampling 266's prefix-fix backfill bug only surfaced in the 10-sample dry-run. Catching it on 1 sampling number was infinitely cheaper than catching it on 605.

3. **Bad data hides until you parse it.** Sampling 133459's blank-SKU row didn't show up in the preview Excel (it became a phantom null-SKU recipe in file 02), only surfaced as a Postgres NOT NULL violation mid-batch. Future imports should pre-validate against schema constraints in the generator.

4. **Schema relaxations have ripple effects.** Making one column nullable cascaded into 6 code edits + a unique-index recreation with `NULLS NOT DISTINCT`. Worth budgeting that.

5. **Re-running risk on usage_log.** File 03 has no ON CONFLICT clause (no natural unique constraint). Discipline: run exactly once. Future usage_log generators should consider including a sourceRowIndex-based ON CONFLICT.

6. **Site visibility is silent.** Imports landed cleanly but were invisible to operator suggestions until the second UPDATE on usage_log. Easy to miss this and declare success too early.

---

## Commits

- `0a05f5ad` — feat(sampling-library): make packCode nullable to support legacy REVIEW import (Phase 1-4 of Step 3a-fix)
- (pending) SQL files + generator scripts — to be committed after Phase 5 design

---

## Stakeholder communication

For Chandresh / Prakashbhai briefing:

> Imported 601 legacy REVIEW sampling numbers from the 4-year paper register backup. Sampling Library now covers ~4,200 entries (up from 3,599). About half the new recipes have packs identified; the other half are tagged by SKU code only — operators will still find them when looking up past tinting by SKU.
>
> 230 of the new entries are linked to customer sites and will surface as suggestions on the operator screen during new tints at the same location. The remaining new entries (and ~2,000 older ones) are visible in Sampling Library search but won't auto-suggest until we do a separate site-name fuzzy-match pass.
>
> 97 entries (SPL-prefix conflicts + 2v2 ties) were intentionally skipped — they need Chandresh's eye to decide between alternatives.
