-- dry_04_sample_backfill_and_verify.sql
-- Generated: 2026-05-27
-- Purpose: backfill recipeId on the 10 sample parents' usage_log rows,
-- then run 4 verification queries scoped to the same 10 samplingNos.
-- Idempotent: only updates rows where recipeId IS NULL.

-- 1) Backfill recipeId on usage_log rows just inserted.
UPDATE "sampling_usage_log" ul
SET "recipeId" = r.id
FROM "sampling_recipes" r
WHERE ul."recipeId" IS NULL
  AND ul."samplingNo" IN (
    '7',
    '23',
    '51',
    '234',
    '247',
    '266',
    '341',
    '456',
    '132458',
    '133255'
  )
  AND ul."samplingNo" = r."samplingNo"
  AND UPPER(TRIM(ul."skuCodeRaw")) = UPPER(TRIM(r."skuCode"))
  AND (
    (ul."packCode" IS NULL AND r."packCode" IS NULL)
    OR ul."packCode" = r."packCode"
  );

-- 2) Each parent has at least 1 recipe (sanity check).
SELECT sr."samplingNo", sr."shadeName", count(re.id) AS recipe_count
FROM "sampling_register" sr
LEFT JOIN "sampling_recipes" re ON re."samplingNo" = sr."samplingNo"
WHERE sr."samplingNo" IN (
  '7',
    '23',
    '51',
    '234',
    '247',
    '266',
    '341',
    '456',
    '132458',
    '133255'
)
GROUP BY sr."samplingNo", sr."shadeName"
ORDER BY sr."samplingNo";

-- 3) Each parent has at least 1 usage_log row.
SELECT sr."samplingNo", sr."shadeName", count(ul.id) AS usage_count
FROM "sampling_register" sr
LEFT JOIN "sampling_usage_log" ul ON ul."samplingNo" = sr."samplingNo"
WHERE sr."samplingNo" IN (
  '7',
    '23',
    '51',
    '234',
    '247',
    '266',
    '341',
    '456',
    '132458',
    '133255'
)
GROUP BY sr."samplingNo", sr."shadeName"
ORDER BY sr."samplingNo";

-- 4) Every usage_log row for these samples must have recipeId backfilled.
--    Expected: 0
SELECT count(*) AS orphaned
FROM "sampling_usage_log"
WHERE "samplingNo" IN (
  '7',
    '23',
    '51',
    '234',
    '247',
    '266',
    '341',
    '456',
    '132458',
    '133255'
)
  AND "recipeId" IS NULL;

-- 5) usageCount on each recipe must match actual usage_log row count.
--    Expected: empty result set (no mismatches).
SELECT re."samplingNo", re."skuCode", re."usageCount" AS recipe_says,
       count(ul.id) AS actual_usage_log
FROM "sampling_recipes" re
LEFT JOIN "sampling_usage_log" ul ON ul."recipeId" = re.id
WHERE re."samplingNo" IN (
  '7',
    '23',
    '51',
    '234',
    '247',
    '266',
    '341',
    '456',
    '132458',
    '133255'
)
GROUP BY re."samplingNo", re."skuCode", re."usageCount"
HAVING re."usageCount" != count(ul.id);
