# REVIEW import — dry-run (10 sample samplingNos)

This subdirectory holds a scoped dry-run of the Step 3b REVIEW import. Before running all 605 parents in Supabase, we exercise 10 carefully-chosen samplingNos end-to-end to verify the SQL works: parents land → recipes land → usage_log lands → backfill links `recipeId` correctly.

## The 10 sample samplingNos

| samplingNo | category | shadeName | recipes | usage_log | dropped |
|---|---|---|---|---|---|
| `7` | CLEAN | 30BB 45/015 | 1 | 2 | 1 |
| `23` | SINGLE_ROW_UNKNOWN | 5309 | 1 | 1 | 0 |
| `51` | SINGLE_ROW_RESOLVED | 8432 | 1 | 1 | 0 |
| `234` | CLEAN_MULTI_ROW | SPL 8473 | 1 | 7 | 2 |
| `247` | CASE_FIX_SKU | SPL 0T 2731 | 2 | 2 | 0 |
| `266` | PREFIX_FIX_SKU | 00NN 37/000 | 1 | 1 | 0 |
| `341` | MULTI_SKU_MIXED | OJ32 | 3 | 4 | 0 |
| `456` | MULTI_SKU_ALL_RESOLVED | SPL LIGHT | 2 | 2 | 1 |
| `132458` | TYPO_SHADE | 6126 | 1 | 4 | 1 |
| `133255` | HIGH_DROP_COUNT | SPL 30YY 59/082 | 2 | 19 | 17 |

## Run order

Run the 4 SQL files in Supabase SQL Editor in this exact order. After each, eyeball the result count before proceeding.

1. **`dry_01_sample_register.sql`** — 10 parent INSERTs. ON CONFLICT DO NOTHING so re-runs are safe.
   - Expected: `INSERT 0 10` (10 new rows). Re-run reports `INSERT 0 0`.
2. **`dry_02_sample_recipes.sql`** — recipe INSERTs for those 10 parents.
   - Expected: `INSERT 0 N` where N = total recipes across the 10 plans. Re-run reports `INSERT 0 0` (NULLS NOT DISTINCT dedup).
3. **`dry_03_sample_usage_log.sql`** — usage_log INSERTs for those 10 parents.
   - Expected: `INSERT 0 M` where M = total winning rows across the 10 plans. **WARNING: no ON CONFLICT — running twice duplicates rows. Run exactly once.**
4. **`dry_04_sample_backfill_and_verify.sql`** — UPDATE backfill + 4 verification SELECTs.
   - Expected output of each verification query is documented inline in the file.

## How to undo (if anything goes wrong)

Run in this order — usage_log first, then recipes, then register (CASCADE doesn't apply, you must respect FK order):

```sql
DELETE FROM "sampling_usage_log" WHERE "samplingNo" IN ('7', '23', '51', '234', '247', '266', '341', '456', '132458', '133255');
DELETE FROM "sampling_recipes"   WHERE "samplingNo" IN ('7', '23', '51', '234', '247', '266', '341', '456', '132458', '133255');
DELETE FROM "sampling_register"  WHERE "samplingNo" IN ('7', '23', '51', '234', '247', '266', '341', '456', '132458', '133255');
```

## After the dry-run passes

1. Run the full 5 files: `../00_pre_import_verification.sql` → `../01_sampling_register.sql` → `../02_sampling_recipes.sql` → `../03_sampling_usage_log.sql` → `../04_post_import_backfill.sql`.
2. Final state: **605 new parents, 834 new recipes, 2556 new usage_log rows** (counts may shift by a few based on ON CONFLICT skips).
3. (Optional) Clean up this `dry-run/` subdirectory once everything is confirmed live.

## What each category exercises

- **CLEAN** — 1 SKU, pack resolved, 1-2 winning rows. Baseline happy path.
- **CLEAN_MULTI_ROW** — 1 SKU, pack resolved, 5+ winning rows. Tests recipe `usageCount` and the `firstUsedAt`/`lastUsedAt` aggregation.
- **SINGLE_ROW_RESOLVED** — 1 source row, SKU master-matched. Tests Path-A-like flow with a resolved pack.
- **SINGLE_ROW_UNKNOWN** — 1 source row, SKU not in master. Tests `packCode = NULL` + `productName = NULL` write path.
- **MULTI_SKU_ALL_RESOLVED** — 2-3 SKUs, all packs resolved. Tests multi-recipe `isPrimary` selection.
- **MULTI_SKU_MIXED** — 2-3 SKUs, mixed resolution. Tests NULL pack alongside resolved packs on the same parent.
- **TYPO_SHADE** — known typo case from Step 1 diagnosis (e.g. `70YY 20/239` (11 winners) vs `70YR 20/239` (2 droppers)). Tests that minority rows are dropped and don't become usage_log entries.
- **HIGH_DROP_COUNT** — parent with many dropped minority rows. Tests the count of dropped rows is correct (drop count visible in the table above).
- **PREFIX_FIX_SKU** — recipe where smart_lookup needed prefix-fix (`stock-N→I` or `stock-+IN`). Tests the fix produces the right resolved SKU.
- **CASE_FIX_SKU** — recipe where smart_lookup matched case-insensitively. Tests case-insensitive lookup.
