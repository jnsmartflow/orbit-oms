-- 04_post_import_backfill.sql
-- Generated: 2026-05-27
-- Source: REVIEW pile consolidation v3 (Option D-clean)
-- Purpose: link sampling_usage_log rows to their parent recipes via (samplingNo, skuCodeRaw, packCode).
-- Run AFTER 01-03 succeed. Idempotent: only updates rows where recipeId IS NULL.
-- SKU match logic: exact + 'IN' prepended + 'I' stripped + 'N' → 'I' prefix swap.
-- Mirrors smart_lookup logic in scripts/_generate-review-import-sql.ts.
-- Previous version (simple UPPER+TRIM equality) missed prefix-fix recipes — patched after dry-run.


-- Backfill recipeId on usage_log rows just inserted.
-- Matches usage_log.skuCodeRaw to sampling_recipes.skuCode under any of the
-- four prefix-fix transformations the smart_lookup resolver may have applied.
-- Handles null pack: both sides NULL → match.
UPDATE "sampling_usage_log" ul
SET "recipeId" = r.id
FROM "sampling_recipes" r
WHERE ul."recipeId" IS NULL
  AND ul."samplingNo" = r."samplingNo"
  AND (
    -- Branch 1: exact match (covers stock-exact, master-exact, stock-ci, master-ci)
    UPPER(TRIM(ul."skuCodeRaw")) = UPPER(TRIM(r."skuCode"))
    -- Branch 2: raw lacked 'IN' prefix; resolver prepended it (stock-+IN)
    OR 'IN' || UPPER(TRIM(ul."skuCodeRaw")) = UPPER(TRIM(r."skuCode"))
    -- Branch 3: defensive inverse — raw had leading 'I' that resolver stripped
    OR (UPPER(TRIM(ul."skuCodeRaw")) LIKE 'I%'
        AND SUBSTRING(UPPER(TRIM(ul."skuCodeRaw")) FROM 2) = UPPER(TRIM(r."skuCode")))
    -- Branch 4: raw starts with 'N' (not 'IN'); resolver prepended 'I' (stock-N→I / master-N→I)
    OR (UPPER(TRIM(ul."skuCodeRaw")) LIKE 'N%'
        AND UPPER(TRIM(ul."skuCodeRaw")) NOT LIKE 'IN%'
        AND 'I' || UPPER(TRIM(ul."skuCodeRaw")) = UPPER(TRIM(r."skuCode")))
  )
  AND (
    (ul."packCode" IS NULL AND r."packCode" IS NULL)
    OR ul."packCode" = r."packCode"
  );

-- Verification queries

-- Orphaned usage_log rows still missing recipeId after backfill (should be small)
SELECT count(*) AS orphaned_usage_log FROM "sampling_usage_log" WHERE "recipeId" IS NULL;

-- Final sanity counts
SELECT count(*) AS total_parents_after   FROM "sampling_register";
SELECT count(*) AS total_recipes_after   FROM "sampling_recipes";
SELECT count(*) AS total_usage_log_after FROM "sampling_usage_log";
SELECT count(*) AS recipes_null_pack     FROM "sampling_recipes" WHERE "packCode" IS NULL;
