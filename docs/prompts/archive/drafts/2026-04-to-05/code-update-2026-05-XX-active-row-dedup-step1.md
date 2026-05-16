# Code update — Active-row duplicate cleanup — Step 1 (diagnosis)

**Session goal (this prompt only):** Diagnose the duplicate active rows in
`import_raw_line_items`. **No SQL writes. No code changes.** Output a
written diagnosis report covering scope, root cause, merge strategy, and
risks. Cleanup SQL gets drafted in a separate prompt after this one.

Run with **Sonnet** — pure reading + SQL inspection, no logic to write.

---

## ─── BACKGROUND ─────────────────────────────────────────────────────────────

Surfaced 2026-05-04 during back-to-back SAP imports
(`BATCH-20260504-012` and `BATCH-20260504-013`) on production.

Two passes of the same SAP file showed non-deterministic patch counts:
pass 1 patched 7 OBDs, pass 2 patched a *different* 3 OBDs. Investigation
revealed `import_raw_line_items` has 521 rows across 260
`(obdNumber, skuCodeRaw)` groups where `lineStatus = 'active'` and
`COUNT(*) > 1` — i.e., legitimate (not phantom) duplicates of active line
data.

The `upsertObd` brain (May 1 architecture) matches by `skuCodeRaw`. When
multiple active rows share the same SKU on the same OBD, the brain picks
"the first one it finds" (no `ORDER BY` — Postgres-determined). Each pass
may match a different duplicate, producing the non-deterministic patches.

This is **distinct from the phantom-row cleanup** completed May 1 — that
cleanup only addressed `lineStatus = 'removed_by_import'` ghost rows
(currently confirmed at 0). The new finding is duplicate `active` rows.

Worst case observed: OBD `9106693439`, SKU `IN68010872` — two active rows
with **different qty values** (9 and 12). This makes naive "keep first row
per group" deletion unsafe — picking the wrong row could lose authoritative
qty data.

---

## ─── READ FIRST ─────────────────────────────────────────────────────────────

Read these files fully and silently before any output:

1. `CLAUDE.md` (repo root)
2. `docs/CLAUDE_CORE.md`
3. `docs/prompts/drafts/web-update-2026-05-01-sap-import-architecture.md`
4. `docs/prompts/drafts/web-update-2026-05-04-import-to-header.md` — Section 11 of this file is the entry point that brought us here
5. `lib/import-upsert/lines.ts` — line matching logic
6. `lib/import-upsert/index.ts` — `upsertObd` entry, where lines.ts is called
7. `lib/import-upsert/state.ts` — `loadExistingObd`, where the existing-side rows are queried (the "first row" determinism issue lives here)

After reading say only:

```
Files read: [list]
Schema v26.5 · 260 dup groups · 521 dup rows · 261 rows to remove
Ready to diagnose.
```

Then wait for me to say "go".

---

## ─── DIAGNOSIS TASKS ────────────────────────────────────────────────────────

Read each task in order and produce a written report. **Do not write any
SQL that mutates data.** SELECT queries for inspection are fine.

### Task 1 — Quantify the corruption

Run these SELECTs in sequence and report results:

**1.1 — Total scope:**
```sql
SELECT
  COUNT(*) AS total_dup_groups,
  SUM(dup_count) AS total_dup_rows,
  SUM(dup_count - 1) AS rows_to_remove
FROM (
  SELECT COUNT(*) AS dup_count
  FROM import_raw_line_items
  WHERE "lineStatus" = 'active'
  GROUP BY "obdNumber", "skuCodeRaw"
  HAVING COUNT(*) > 1
) t;
```

**1.2 — Distribution of duplicate group sizes:**
```sql
SELECT dup_count, COUNT(*) AS group_count
FROM (
  SELECT COUNT(*) AS dup_count
  FROM import_raw_line_items
  WHERE "lineStatus" = 'active'
  GROUP BY "obdNumber", "skuCodeRaw"
  HAVING COUNT(*) > 1
) t
GROUP BY dup_count
ORDER BY dup_count DESC;
```

**1.3 — How many duplicates have qty-value disagreement (the dangerous case):**
```sql
SELECT COUNT(*) AS qty_mismatched_groups
FROM (
  SELECT "obdNumber", "skuCodeRaw",
    COUNT(DISTINCT "unitQty") AS distinct_qty,
    COUNT(DISTINCT "volumeLine") AS distinct_vol
  FROM import_raw_line_items
  WHERE "lineStatus" = 'active'
  GROUP BY "obdNumber", "skuCodeRaw"
  HAVING COUNT(*) > 1
    AND (COUNT(DISTINCT "unitQty") > 1 OR COUNT(DISTINCT "volumeLine") > 1)
) t;
```

**1.4 — Sample 10 worst qty-mismatched duplicates:**
```sql
SELECT "obdNumber", "skuCodeRaw",
  COUNT(*) AS dup_count,
  array_agg(DISTINCT "unitQty") AS unit_qtys,
  array_agg(DISTINCT "volumeLine") AS volume_lines
FROM import_raw_line_items
WHERE "lineStatus" = 'active'
GROUP BY "obdNumber", "skuCodeRaw"
HAVING COUNT(*) > 1
  AND (COUNT(DISTINCT "unitQty") > 1 OR COUNT(DISTINCT "volumeLine") > 1)
ORDER BY dup_count DESC
LIMIT 10;
```

Report: total scope, distribution (how many 2-copy groups vs 3-copy etc.),
number of qty-mismatched groups (the unsafe ones), and the 10 sample rows.

### Task 2 — Root cause analysis

Read `lib/import-upsert/state.ts` and `lib/import-upsert/lines.ts`.

Answer these questions in writing:

1. **Where is the existing-side query that loads `import_raw_line_items` for an OBD?** Quote the Prisma query. Does it have `ORDER BY` / `orderBy`? If not, that's the root cause of non-determinism.

2. **What does the "match by skuCodeRaw" code look like?** Quote the matching loop. When multiple existing rows have the same SKU, which one wins? Is there a `findFirst` vs `findMany` decision happening?

3. **What does the duplicate-SKU guard do?** The architecture doc Section 3 says: "if either incoming or existing has the same SKU twice, prefer the first occurrence and log a warning." Find this code. Does it actually log a warning? If yes, where do warnings surface? Are they in `import_batches` somewhere, in the audit log, in stdout?

4. **Could this corruption come from the brain itself, or only from legacy data?** Trace the line-write path. When manual-sap upserts a line, can it ever insert a duplicate `(obdNumber, skuCodeRaw, lineStatus='active')` row? Or are duplicates only possible from data that pre-dates the May 1 fix?

5. **Why didn't the May 1 phantom-row cleanup catch these?** The phantom-row SQL only deleted `lineStatus = 'removed_by_import'` rows. These duplicates are `lineStatus = 'active'`. Were these duplicates already in the DB on May 1, or did they accumulate after May 1?

Report findings with quoted code and reasoning.

### Task 3 — Merge strategy options

For each duplicate group, we need a deterministic rule for "which row stays
and which gets soft-removed (or hard-deleted)." The unsafe case is groups
with mismatched qty values — picking the wrong row loses real data.

Propose **3 candidate strategies** in order of safety. For each:

1. **Strategy name** (e.g., "keep highest unitQty", "keep most recent createdAt", "keep first by id")
2. **Selection rule** (the SQL window function logic)
3. **What it gets right** for clean duplicates (identical rows)
4. **What it gets wrong / risks** for qty-mismatched duplicates
5. **Reversibility** — does it soft-remove (so we can restore) or hard-delete?

Then **recommend one** with justification.

Don't write the cleanup SQL yet. Just propose the strategies in writing.

### Task 4 — Risk assessment

Answer:

1. **What downstream tables hold copies of these line items?** The architecture doc mentions `pick_list_items`, `tinter_issue_entries`, `tinter_issue_entries_b` — find them. If we soft-remove a duplicate, do these downstream tables still reference the removed `id`? Is there an FK?

2. **What happens to OBDs that have already been picked / tinted / dispatched?** If a duplicate's line was used to generate a tinter issue, removing the duplicate might orphan the tinter issue. Sample the data: of the 260 dup groups, how many have downstream activity?

3. **What's the rollback plan if cleanup goes wrong?** Soft-remove is reversible (set `lineStatus` back to `active`). Hard-delete with a backup table is also reversible. What about the qty-mismatched cases — can we restore the original rows if we picked the wrong one to keep?

4. **What's the impact of leaving the duplicates in place?** The brain's non-deterministic patching is the visible symptom. Are there other downstream effects — wrong totals in `import_obd_query_summary`, wrong qty in delivery challans, wrong tinter issue quantities, wrong dispatch weight calculations?

Run inspection SQL where useful. Report findings.

### Task 5 — Open questions

List anything that came up during diagnosis that needs Smart Flow's input
before cleanup SQL gets drafted. Examples:
- For qty-mismatched duplicates, does the SAP file know the right value? If we can re-import a fresh file, we don't need to pick — the file is authoritative.
- Are there any OBDs that should be left alone (e.g., already dispatched, financially settled)?
- What's the acceptable downtime / locking strategy for the cleanup?

---

## ─── CONSTRAINTS ────────────────────────────────────────────────────────────

- Do NOT write any UPDATE / DELETE / INSERT SQL in this session
- Do NOT propose cleanup SQL — Step 2 will draft that, after this report is reviewed
- Do NOT modify any code
- SELECT queries against production are fine — read-only
- If any inspection SQL takes longer than ~5 seconds, flag it (we don't want to lock the table during prod reads)
- Keep the report scannable — same numbered sub-sections as the tasks above
- End with an "Open questions" section

---

## ─── OUTPUT FORMAT ──────────────────────────────────────────────────────────

Single markdown report:

```
# Diagnosis report — Active-row duplicate cleanup

## Task 1 — Quantify the corruption
1.1 Total scope: [numbers]
1.2 Distribution: [table]
1.3 Qty-mismatched groups: [number]
1.4 Sample worst cases: [table]

## Task 2 — Root cause
1. Existing-side query: [quote + ORDER BY analysis]
2. Match loop: [quote + winning rule]
...

## Task 3 — Merge strategies
Strategy A: [name] — [rule] — pros/cons — reversibility
Strategy B: ...
Strategy C: ...
Recommendation: [chosen] — because [reasoning]

## Task 4 — Risk
1. Downstream tables: ...
...

## Open questions
- [NEEDS SMART FLOW INPUT] ...
```

---

## ─── EXECUTION ORDER ───────────────────────────────────────────────────────

1. Read all 7 files
2. Say "Files read … Ready to diagnose."
3. Wait for "go"
4. Execute Tasks 1–5 in order
5. Output single markdown report
6. Stop. Do not draft cleanup SQL.

End state: a written diagnosis I can read in 5 minutes that tells me exactly
how bad this is, why it happened, and what the safest path forward is.
After review I'll commission Step 2 (cleanup SQL drafting) as a separate
prompt.
