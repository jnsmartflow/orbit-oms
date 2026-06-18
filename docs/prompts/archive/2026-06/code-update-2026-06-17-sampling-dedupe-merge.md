# Context Update v1 — Sampling Library duplicate-merge runbook + first 3 groups merged
Session date: 2026-06-17
Target files: CLAUDE_SAMPLING_LIBRARY.md (new "Duplicate Merge" section), CLAUDE_CORE.md §14 checklist (minor)

## SCHEMA CHANGES
None. Schema unchanged (v27.5). All work was **data-only** via Supabase SQL Editor (UPDATE / DELETE / row re-point), plus temporary backup tables.

Temporary backup tables created this session (safe to DROP after live smoke test confirmed):
```
_bak_merge0196_register, _bak_merge0196_recipes, _bak_merge0196_usage, _bak_merge0196_ti
_bak_w25w5_register, _bak_w25w5_recipes, _bak_w25w5_usage, _bak_w25w5_ti
```

## NEW/MODIFIED FILES
None in the repo. Working review files only (not code, not committed):
| File | Purpose |
|---|---|
| `docs/plans/Sampling No Review/sampling-merge-review.csv` | WHT=20/25/5 review sheet (superseded by per-slice files going forward) |
| `docs/plans/Sampling No Review/review-2026-06-17-wht25.csv` | per-slice review (new-file-per-slice rule) |
| `docs/plans/Sampling No Review/review-2026-06-17-wht5.csv` | per-slice review |

## WORK DONE THIS SESSION
Three exact-formula duplicate groups merged into one canonical number each. Sources marked inactive (never deleted). All SKUs, usage logs, and TI history re-pointed to the master.

| Group (formula) | Master | Sources folded in | Final SKUs on master |
|---|---|---|---|
| WHT=20 (white-only) | 26-0196 | 26-0197, 26-0198, 26-0279, 26-0281, 26-0282 | 7 |
| WHT=25 (white-only) | 26-0106 | 22 numbers | 22 |
| WHT=5 (white-only) | 26-0094 | 9 numbers | 9 |

## BUSINESS RULES ADDED (Sampling Library — duplicate merge)
- **Duplicates are defined by EXACT full formula, never by shade name.** Same `shadeName` with different pigment values is NOT a duplicate (e.g. four "30YY 69/048" entries; only the two with identical YOX/BLK/OXR are dupes).
- **`packCode` is stored RAW (e.g. `20L`, `10L`, `4L`, `1L`), not the display label `L_20`/`20 LT`.** SQL must use the raw enum value. Safer still: in merge SQL, match a recipe row by `(samplingNo, skuCode)` only — within one sampling number a SKU appears once — which sidesteps the pack-label trap entirely.
- **SKU+pack clash on merge → combine, don't duplicate.** The unique key `(samplingNo, skuCode, packCode)` (NULLS NOT DISTINCT) blocks two identical variants under the master. Rule: keep one recipe row, `usageCount = SUM`, `lastUsedAt = MAX`, re-point the dropped row's `sampling_usage_log.recipeId` to the survivor, then DELETE the dropped recipe.
- **`isPrimary` invariant (§10) survives the merge.** After folding, the master must have exactly 1 `isPrimary=true`. Rule applied: master keeps its OWN primary; clear `isPrimary` on all re-pointed rows.
- **TI history re-points in place — no dedupe.** `tinter_issue_entries.samplingNo` is updated to the master; the unique OBD/delivery number guarantees no duplicate TI rows. Never delete TI rows.
- **Never delete `sampling_register` rows.** Source numbers are inactivated: `isActive=false`. The merged-away number simply stops appearing in the active list and stops matching new entries.
- **Sampling Library is operator-created runtime data, NOT CSV-seeded.** Merges go live the moment the SQL runs; no commit, push, or Vercel deploy; and unlike catalog edits, they are NOT wiped on a reseed. No seed mirror-back needed.

## REFERENCE GRAPH (every place a samplingNo lives — verified this session)
| table.column | merge action |
|---|---|
| `sampling_register.samplingNo` (PK) | source rows → `isActive=false` (keep) |
| `sampling_recipes.samplingNo` (FK CASCADE) | re-point to master; resolve clashes first |
| `sampling_usage_log.samplingNo` (FK CASCADE) | re-point to master |
| `sampling_usage_log.recipeId` (FK SET NULL) | re-point dropped-clash rows to survivor recipe |
| `tinter_issue_entries.samplingNo` (FK SetNull) | re-point in place (never delete) |
| `tinter_issue_entries_b.samplingNo` | empty in practice — confirm 0, no action |
| `delivery_challan_formulas.sourceTiEntryId` | points at TI **id**, not samplingNo → untouched; do NOT delete TI rows |
| JSON / free-text columns | none hold a samplingNo (probed: tint_assignments, tint_pause_events, manual_tint_entries, sampling_register.notes) |

## REUSABLE MERGE RECIPE (per duplicate group)
Run order. SQL in Supabase SQL Editor — **no `BEGIN`/`COMMIT`**, sequential, stop on any error.

**Step 1 — Find the group.** Exact-formula match (see PENDING: exact-dupe-finder tool). Output a NEW dated review CSV (one file per slice; never append — Excel/OneDrive locks the shared file).

**Step 2 — Human review.** Owner sets `mergeInto` (the master) per group. Default master pick: prefer 26-series, else highest usage, tie-break oldest createdAt. Owner has final say.

**Step 3 — Clash detection (one grid).**
```sql
WITH grp AS (
  SELECT "samplingNo","skuCode","packCode","usageCount","lastUsedAt"
  FROM sampling_recipes WHERE "samplingNo" IN ({ALL_GROUP_NUMBERS})
)
SELECT "skuCode", COALESCE("packCode"::text,'NULL') AS pack,
       COUNT(*) AS rows_clashing,
       STRING_AGG("samplingNo", ', ' ORDER BY "samplingNo") AS numbers,
       SUM("usageCount") AS combined_usage, MAX("lastUsedAt") AS keep_lastused
FROM grp
GROUP BY "skuCode", COALESCE("packCode"::text,'NULL')
HAVING COUNT(*) > 1
ORDER BY "skuCode";
```

**Step 4 — Merge SQL.**
```sql
-- 0. BACKUP (drop after smoke test)
CREATE TABLE _bak_{master}_register AS SELECT * FROM sampling_register WHERE "samplingNo" IN ({ALL});
CREATE TABLE _bak_{master}_recipes  AS SELECT * FROM sampling_recipes  WHERE "samplingNo" IN ({ALL});
CREATE TABLE _bak_{master}_usage    AS SELECT * FROM sampling_usage_log WHERE "samplingNo" IN ({ALL});
CREATE TABLE _bak_{master}_ti       AS SELECT * FROM tinter_issue_entries WHERE "samplingNo" IN ({ALL});

-- 1. Per clash (from Step 3): keep one, fold the other in, drop dup
UPDATE sampling_usage_log SET "recipeId"=(SELECT id FROM sampling_recipes WHERE "samplingNo"='{KEEP}' AND "skuCode"='{SKU}')
  WHERE "recipeId"=(SELECT id FROM sampling_recipes WHERE "samplingNo"='{DROP}' AND "skuCode"='{SKU}');
UPDATE sampling_recipes SET "usageCount"={COMBINED}, "lastUsedAt"='{MAXDATE}' WHERE "samplingNo"='{KEEP}' AND "skuCode"='{SKU}';
DELETE FROM sampling_recipes WHERE "samplingNo"='{DROP}' AND "skuCode"='{SKU}';

-- 2. Re-point all sources → master
UPDATE sampling_recipes     SET "samplingNo"='{MASTER}' WHERE "samplingNo" IN ({SOURCES});
UPDATE sampling_usage_log   SET "samplingNo"='{MASTER}' WHERE "samplingNo" IN ({SOURCES});
UPDATE tinter_issue_entries SET "samplingNo"='{MASTER}' WHERE "samplingNo" IN ({SOURCES});

-- 3. Primary invariant — master keeps its own
UPDATE sampling_recipes SET "isPrimary"=false WHERE "samplingNo"='{MASTER}' AND "skuCode"<>'{MASTER_PRIMARY_SKU}';
UPDATE sampling_recipes SET "isPrimary"=true  WHERE "samplingNo"='{MASTER}' AND "skuCode"='{MASTER_PRIMARY_SKU}';

-- 4. Inactivate sources (never delete)
UPDATE sampling_register SET "isActive"=false, "updatedAt"=now() WHERE "samplingNo" IN ({SOURCES});
```

**Step 5 — Verify (one grid).** Expect: master recipe_count = (total distinct SKUs after clash-combine); primary_count = 1; sources_active = 0; leftover_children = 0.

**Step 6 — Live smoke test** on orbitoms.in: master shows merged SKUs + combined uses + full TI history + one PRIMARY pill; sources gone from active list; new-entry match finds only the master.

**Step 7 — Drop the backup tables** once smoke test passes.

## PENDING ITEMS
- **Exact-dupe-finder tool (Claude Code)** — given a seed sampling number, find all active samplings whose PRIMARY recipe formula matches it exactly (all pigment columns + tinterType), output a dated review CSV. *Being built next.*
- **~380 duplicate groups remaining** in the library (full-library exact-formula scan returned 385 two-number groups in early diagnosis; many more multi-number groups exist). Process per the runbook above, group by group.
- **Drop backup tables** (`_bak_merge0196_*`, `_bak_w25w5_*`) after smoke tests confirmed.
- **Null-pack variant** `5848214|NULL` now lives under 26-0094 — confirm it renders correctly in the variant tabs.
- **Batch automation (deferred):** owner chose manual SQL over a Claude Code merge script for now. If volume becomes painful, revisit a dry-run-first reusable script (one group at a time, no `$transaction`).

## CHECKLIST UPDATES (CLAUDE_CORE.md §14)
- When merging sampling duplicates: dedupe by EXACT formula not name; use RAW packCode; never delete register rows (inactivate); preserve the §10 single-primary invariant.

## CONSOLIDATION NOTES
- CLAUDE_SAMPLING_LIBRARY.md — add a "Duplicate Merge" section: the reference graph table + the reusable runbook (Steps 1–7) + the four business rules above.
- CLAUDE_SAMPLING_LIBRARY.md §schema — add a note that `packCode` display label (`L_20`) ≠ stored value (`20L`); SQL uses raw.
- CLAUDE_CORE.md §13 — cross-link: GEN-SKU delete-list SKUs may still appear as historical sampling variants; merging does not auto-strip them (owner chose to keep on the merges done this session).
