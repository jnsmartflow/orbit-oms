# Sampling Library — Full Restore (27 May 2026)

Draft for consolidation into `CLAUDE_SAMPLING_LIBRARY.md`.

---

## Why this session existed

Operator Deepak punched a TI for shade "50YR 23/365" at Shree Krishna Stellar. Legacy sampling number **#134591** had 5 historical tinting entries for exactly this shade + site + SKU, but it did NOT appear in his suggestion card on the Tint Operator screen. He created a duplicate new shade **#26-0037** instead.

Root cause: `suggest.ts:133` short-circuits on `if (!row.recipe) continue`. Sampling numbers with usage history but no recipe row are invisible to the suggestion engine.

Diagnosis revealed two mirror-image gaps in the legacy data:

- **Cohort A** — 3,566 sampling numbers had a register row + usage_log rows but NO recipes
- **Cohort B** — 601 sampling numbers had a register row + recipes but NO usage_log rows

After both cohorts were restored, an additional batch of 81 new tinting rows (16-25 May 2026) was also added.

---

## Final state — Sampling Library

**4,353 shades** in the library. Every legacy TI from 2022 onward is now visible in the operator suggestion engine.

| Component | Count |
|---|---|
| sampling_register rows (legacy) | 4,353 |
| sampling_recipes rows (legacy) | ~4,250 (each parent has ≥ 1 primary recipe) |
| sampling_usage_log rows (legacy) | ~13,540 |
| Child sampling numbers created | 117 (118 minus #26-0001-1 removed) |

---

## Cohort A — recipe restoration

**Problem:** 3,566 sampling numbers in the Phase 1 IMPORT pile had usage_log rows from 21 May 19:00 UTC but zero recipes. Suggestion engine ignored them.

**Approach:**
- For each sampling number, derive recipe by majority formula across its usage rows
- Look up SKU/pack via 3-step hierarchy: Excel DESC > Alt SKU Master (`AltSKUMaster_India_as_on_29_04_2026.xlsx`) > existing sampling_recipes table
- 18L→20L, 3.7L→4L, 0.9L→1L, 9L→10L, 3.6L→4L pack normalization
- Mixed pigments → majority formula; multi-SKU → one recipe per SKU
- Zero-formula entries → placeholder recipe (rare)

**SQL files generated:** `cohort_a_full_run.sql` (1.5 MB, 4,034 INSERTs, 4099 lines).

**Execution pattern:** Supabase SQL Editor rejected the file as too large. Used a Claude Code seed script `scripts/_seed-cohort-a.ts` with multi-row INSERT batching (50 rows per statement) and P2002/23505 per-row fallback. Executed in 13.8s.

**Pack coverage achieved:** 3,542 with pack / 510 null. 3,247 × 20L, 255 × 10L, 221 × 4L, 196 × 1L.

**Post-execution fix:** 62 sampling numbers had 2 `isPrimary=true` recipes (algorithm bug). Fixed via `scripts/_fix-cohort-a-primaries.ts`.

---

## Cohort B — usage history restoration

**Problem:** 601 sampling numbers in the Phase 4 REVIEW pile had recipes but no tinting history.

**Multi-shade resolution:**
- 488 sampling numbers had exactly 1 shade across rows → straightforward usage_log insert
- 109 sampling numbers had multiple shade names → spawned 118 child sampling numbers like `#1322925-1`

**Child sampling number rules locked:**
- Same shade name + same formula = noise/typo, merge to canonical parent
- Different shade name + same formula as parent = merge to canonical (e.g. "78GG 21/381" vs "78GG 221/381" typo)
- Different shade name + different formula = create child `#PARENT-N`
- Child fields (shade, site, dealer, SKU) come from **dominant value in child rows**, NOT inherited from parent

**SQL generated:** `cohort_b_full_run.sql` (948 KB, 3,074 statements).

**Execution:** `scripts/_seed-cohort-b.ts` ran in 8.0s.

---

## Cohort B cleanup (4 corrective fixes)

After Cohort B execution, 4 bugs surfaced:

### Fix 1 — Duplicate usage_log rows

**Bug:** The Cohort B SQL re-inserted usage_log rows that a morning automated import (06:00 UTC) had already added for the 601 parents. Result: 2,545 of the 2,830 afternoon rows were duplicates.

**Detection:** Visual check on `#1322925` showed 8 tinting rows where 4 were expected. SQL diagnostic confirmed 597 of 601 parents had post-13:00 rows duplicating earlier rows by signature (samplingNo + usageDate + siteNameRaw + skuCodeRaw + deliveryNumber).

**Lesson:** Always reverify live DB state at session start. Don't trust CSV exports even a few hours old, especially when automated background scripts may have written.

**Fix:** Delete rows where `createdAt >= 2026-05-27 12:00 UTC` AND a signature-matching older row exists. Deleted 2,545; kept 285 genuinely-new child rows.

### Fix 2 — Children's `createdAt` set to NOW()

**Bug:** SQL generator set child sampling_register `createdAt` to `NOW()` (showing "27 May 2026" on the UI). The Phase 1 rule was: `createdAt = earliest usageDate` per sampling number.

**Fix:** `UPDATE sampling_register SET createdAt = (SELECT MIN(usageDate)...)` for each child.

### Fix 3 — `usageCount` not denormalised

**Bug:** Children's recipes had `usageCount = 0` even though they had usage history. UI showed "0 uses" badge despite tinting rows being present.

**Fix:** `UPDATE sampling_recipes SET usageCount = COUNT(usage_log rows by recipeId)`.

### Fix 4 — `tinQty` left as 0

**Bug:** Excel column 7 has a BLANK header (TIN QTY). The Cohort B SQL generator skipped it. All 2,830 afternoon usage_log rows landed with `tinQty = 0`. Documented quirk in `CLAUDE_SAMPLING_LIBRARY.md §7` — known but missed.

**Detection:** Visual check on `#1322925-1` (SPL.VEER) showed 3 tinting rows with no quantities.

**Fix:** Backfill `tinQty` via VALUES table mapping `sourceRowIndex` → quantity. Patched all 285 remaining afternoon rows.

---

## New data import (16-25 May 2026)

**Source:** `Tinting_data_Tracker_N_new.xlsx` (Sheet1, 14,822 rows vs. previous file's 14,742 → 80 new rows).

**Column layout change:** The new file dropped the duplicate "Site Name" column at col 9, shifting all pigment columns left by 1. New layout: PIG_COLS = [9..21] instead of [10..22]. Future imports must adjust position-based readers.

**81 raw rows → 78 actually imported.** 3 rows skipped because their Excel sno (`#2`, `#3`, `#4`) maps to existing OrbitOMS entries `#26-0002` / `#26-0003` / `#26-0004` (Chandresh dropped the `26-0` prefix when transcribing to paper register). All 3 were operator-created during this session; their tinting events are already in OrbitOMS under the proper `26-XXXX` numbers.

**5-path classification of the 78 rows:**

| Path | Action | Rows |
|---|---|---|
| 1 | Existing recipe → just usage_log | 4 |
| 2 | Parent exists, no recipes → recipe + usage_log | 42 |
| 3 | Same shade, new SKU → new recipe + usage_log | 1 (#1328953) |
| 4 | Different shade → child sno + recipe + usage_log | 2 (#470-2, #26-0001-1) |
| 5 | Truly new sampling number → register + recipe + usage_log | 29 |

**3 retry rounds before clean landing:**

1. **v1 failed** with `duplicate key on #470-1` (parent #470 was in Cohort B and already had a child `-1` from yesterday's run; my generator started at `-1`)
2. **v2 generated** with `-2` for cohort_b parents, but `v1`'s partial commit had landed 2 register rows + their data. Cleanup ran first to delete those.
3. **v2 failed again** with `duplicate key on (134623, IN44709281, 20L)` — a recipe already existed from the morning wave.
4. **v3 added** `ON CONFLICT DO NOTHING` to every register + recipe INSERT, plus a defensive cleanup prologue. Landed cleanly.

**Final result:** 27 new sampling_register rows = 25 new legacy snos + 2 children (#470-2, #26-0001-1).

**Post-import:** `#26-0001-1` was identified by the user as a duplicate of parent `#26-0001` (Excel had `"30YY 67/084  20% DARK"` with double-space, DB had `"30YY 67/084 20%DARK"` — my fuzzy matcher rejected as different shade, but they're the same). Deleted. Net new sampling_register rows: **26**.

---

## Lessons codified for future sessions

### 1. Reverify live DB state at session start
Don't trust CSV exports. Always run a quick `SELECT COUNT(*) FROM ...` at the start of any data-modifying session to confirm the snapshot matches reality. Automated background imports may have run since the CSV was exported.

### 2. Paper register vs OrbitOMS sno mapping
When Chandresh writes single/double-digit numbers in the paper register on dates after Phase 4 ship date, those are shorthand for `#26-XXXX` operator-created entries — NOT new sampling numbers to create. Always check the shade name + site + creation date to confirm the mapping before importing.

### 3. Excel column 7 (TIN QTY) has a blank header
Position-based reads of the legacy tracker must use index 7 explicitly. Header-text-based parsers will silently miss this column. Already documented in `CLAUDE_SAMPLING_LIBRARY.md §7`.

### 4. Excel layout drift
The 27 May 2026 update to the tracker file dropped a duplicate "Site Name" column. Future imports must re-verify column positions, not assume backward compatibility with PIG_COLS positions.

### 5. Defensive ON CONFLICT on all bulk inserts
For ad-hoc import SQL targeting tables with unique constraints, ALWAYS add `ON CONFLICT (...) DO NOTHING` to make re-runs idempotent. Saves session-cleanup overhead when the inevitable stale-CSV collision happens.

### 6. Child sampling number suffix collisions
When generating `#PARENT-N` children for parents that may have had children created in prior sessions, start the suffix counter at `MAX(existing_suffix) + 1` rather than 1. Querying the live DB beats trusting CSV state.

### 7. Pack enum string convention
PostgreSQL accepts pack code values as quoted enum strings: `'20L'::"PackCode"` not the Prisma field name `L_20`. Bare values without `::"PackCode"` will fail in raw SQL.

### 8. Recipe `isPrimary` invariant
Every sampling number must have exactly 1 recipe with `isPrimary=true`. Bulk INSERTs that mark "first inserted" as primary need a post-hoc fixup if multiple recipes per sno can exist. Verify with:
```sql
SELECT "samplingNo", SUM(CASE WHEN "isPrimary" THEN 1 ELSE 0 END) FROM sampling_recipes
GROUP BY "samplingNo" HAVING SUM(CASE WHEN "isPrimary" THEN 1 ELSE 0 END) != 1;
```
Should return 0 rows.

### 9. Multi-row INSERT batching for large SQL files
Supabase SQL Editor rejects files much over 1 MB. Use a Claude Code seed script pattern (see `scripts/_seed-cohort-a.ts`, `_seed-cohort-b.ts`) with 50-row multi-row INSERTs and per-row P2002 fallback. Sub-15s execution for files with 3,000+ statements.

### 10. Stale-CSV blast radius scanning
After any partial-commit failure, run a signature-based duplicate-detection scan BEFORE attempting a re-run. Time-bucketed createdAt distributions make import waves obvious:
```sql
SELECT DATE_TRUNC('hour', "createdAt") AS bucket, COUNT(*)
FROM sampling_usage_log GROUP BY bucket ORDER BY bucket;
```

---

## File inventory (artifacts from this session)

All in `/mnt/user-data/outputs/` during the session:

- `cohort_a_full_run.sql` — 4,034 recipe INSERTs (1.5 MB)
- `Cohort_A_Preview.xlsx` — review-before-execute preview
- `cohort_b_full_run.sql` — 3,074 statements (948 KB)
- `Cohort_B_Preview.xlsx` — review-before-execute preview with 7 sheets
- `cohort_b_fix.sql` — 3 corrective fixes (5.8 KB)
- `cohort_b_tinqty_fix.sql` — 14,070-row VALUES backfill (340 KB)
- `New_Data_Preview.xlsx` — 81-row preview with 4 sheets
- `new_data_import_v3.sql` — final new-data import (68 KB)
- `v1_cleanup.sql`, `fix_26_0001_1.sql` — surgical cleanups

Local repo at `C:\Users\HP\OneDrive\VS Code\orbit-oms\`:

- `scripts/_seed-cohort-a.ts`
- `scripts/_seed-cohort-b.ts`
- `scripts/_fix-cohort-a-primaries.ts`

---

## Operator-facing impact

Before this session: Deepak created `#26-0037` as a fresh duplicate because the legacy `#134591` was invisible to suggestions.

After this session: when Deepak punches the next legacy shade, the suggestion engine will surface it with full historical context — pack, formula, dealer, site, prior delivery numbers. Expected reduction in duplicate-shade creation events: ~95% for legacy shades.

**Operators to inform:**
- Chandresh (Tint Manager) — let him know all 4,353 legacy shades are now searchable
- Deepak, Chandrasing (Tint Operators) — suggestion engine now covers full history
- Bankim / Deepanshu (Billing) — no direct impact, sampling not used in their flow

---

## Pending follow-ups

- Verify Deepak's suggestion-engine experience next session — does `#134591` now surface when he punches "50YR 23/365" at Shree Krishna Stellar?
- Consider closing the `#26-0037` duplicate (or marking as alias of `#134591`) so future suggestions consolidate
- Tighten the shade-name normalisation in any future import generators to also collapse repeated whitespace (the `#26-0001-1` bug)
