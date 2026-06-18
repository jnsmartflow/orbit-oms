# Next Session Prompt — Sampling Library data quality refinement

**Drafted:** 2026-05-27
**Run in:** Claude Code on depot PC
**Predecessor:** `web-update-2026-05-27-sampling-review-import-complete.md`

---

## Why this session

The REVIEW pile import (2026-05-27) landed 601 sampling numbers using a "majority shadeName wins" rule. But during that import, when source SKUs were missing/blank and the consolidation couldn't pick a clear winner, the depot's earlier paper register sometimes had the **exact shade formula recorded under a NEW sampling number** rather than reusing the original.

Net effect: the live database now has multiple sampling numbers that point to the same real-world shade, just because the original entry was incomplete (no formula) when a fresh shade was tinted later.

The source `Tinting_data_Tracker_N_FINAL_REVIEW.xlsx` Excel has the actual formula (pigment values) on the new entry's rows. So we can fix this by:

1. Detecting these duplicate-shade pairs in the live DB
2. Picking which sampling number is the canonical one (the one with the formula)
3. Merging or deactivating the duplicate
4. Going forward, preventing this from happening again

---

## Read before drafting

Read these files fully first:
- `CLAUDE.md` (repo root)
- `docs/CLAUDE_CORE.md`
- `docs/CLAUDE_SAMPLING_LIBRARY.md`
- `docs/CLAUDE_TINT.md`
- `prisma/schema.prisma` (sampling_register, sampling_recipes, sampling_usage_log)
- `docs/plans/sampling-register/Tinting_data_Tracker_N_FINAL_REVIEW.xlsx` (source — full read)
- `scripts/_generate-review-import-sql.ts` (the generator that produced the recent import — for context on rules applied)
- The previous session summary: `docs/prompts/drafts/web-update-2026-05-27-sampling-review-import-complete.md`

Confirm "All files read" before proceeding.

---

## Session goals

Three goals, in priority order:

### Goal 1 — Find duplicate sampling numbers that should be one

Identify pairs/groups of sampling numbers in `sampling_register` where:
- shadeName is the same (or one is a typo/variant of the other)
- AND at least one has empty/null pigment recipe values (the "shell" one created when formula was unknown)
- AND another has actual pigment values (the "real" one created when the formula was recorded)
- AND both are likely the same real-world shade per the source Excel

### Goal 2 — Refine partial-import data

For each duplicate group:
- Identify the canonical sampling number (the one with real pigment values — usually the newer one with formula)
- Identify the shell sampling number (older, lower number, no formula)
- Decide the merge strategy:
  - Option A: Mark shell as inactive (`isActive=false`) and leave it for history
  - Option B: Migrate usage_log rows from shell → canonical, then delete shell
  - Option C: Update shell's recipe with the formula from canonical, deactivate canonical

### Goal 3 — Improve data quality + remove duplicates

After merge decisions:
- Generate Excel preview showing every merge decision
- User reviews
- Generate SQL files to apply merges
- Run in Supabase with verification queries

---

## Pre-work — investigate the duplicate pattern

Before writing any merge SQL, the diagnostic step has to answer these questions:

1. **How big is the duplicate problem?**
   - How many sampling_register rows have completely-zero pigment values on all their recipes?
   - How many of those zero-pigment sampling numbers have a shadeName that ALSO appears on another sampling number with non-zero pigments?
   - Show distribution: pairs (2 sampling numbers for same shade), triples, 4+

2. **What's the typical pattern?**
   - Is it always: older samplingNo (lower number) = shell, newer = real?
   - Or sometimes the other way around?
   - Are there cases where both are partial — one has 1 SKU, the other has different SKUs?

3. **How does source Excel inform this?**
   - For each candidate duplicate group, walk through the source Excel rows
   - Identify which sampling number has the formula recorded
   - Identify any inconsistencies (e.g. source says formula X for samplingNo A, but DB has zero values)

4. **Are SPL prefix variants in this set?**
   - Some duplicates might actually be SPL vs non-SPL (real product distinction, don't merge)
   - Some might be true duplicates with no SPL involvement
   - Separate these clearly before merging

---

## Constraints — read CORE §3 before proceeding

- No `prisma.$transaction`. Sequential awaits only.
- No `prisma db push`. Schema changes via Supabase SQL Editor → hand-edit `schema.prisma` → `npx prisma generate`.
- DB columns camelCase, no @map. DOUBLE-QUOTED in raw SQL.
- `samplingNo` is TEXT, not numeric.
- All API routes need `export const dynamic = 'force-dynamic'`.
- `tsc --noEmit` must pass before any commit.
- All commits to main only.
- Generator scripts go to `scripts/` (prefix with `_` for one-shot scripts).
- Excel previews go to `docs/plans/sampling-register/`.

---

## Workflow shape — phased like the last session

**Phase 1 — Diagnosis only (NO database writes)**
- Read source Excel + DB
- Identify duplicate groups
- Categorise (true duplicate / SPL distinction / partial overlap / different shades same name)
- Produce diagnostic report

User confirms diagnosis is accurate before proceeding.

**Phase 2 — Preview Excel (NO database writes)**
- For each duplicate group, propose merge action with reasoning
- Excel with sheets:
  - `Confirmed_Duplicates` — clean merge candidates with high confidence
  - `Review_Required` — ambiguous cases needing human decision
  - `False_Positives` — pairs that LOOK like duplicates but aren't (e.g. SPL vs non-SPL)
  - `Summary`

User reviews Excel, approves/rejects per group.

**Phase 3 — Generate merge SQL**
- For approved groups: SQL files to migrate usage_log + deactivate/delete duplicate
- Backfill script if pigment values need to be copied from canonical to shell

**Phase 4 — Dry-run on 5-10 sample merges**

**Phase 5 — Full run + verification**

**Phase 6 — Prevention**
- Update the operator workflow so future "shade with no formula" entries don't create new sampling numbers when an existing one already has the shade
- Or: update sampling library detail page to surface "this shade has no formula yet" hint when a recipe with zero pigments is opened

---

## Key questions to answer before drafting

In the diagnosis phase, surface these for user decision:

1. **Merge or deactivate?**
   - Hard delete the shell after migrating its usage_log → ALL historical data attributed to canonical
   - Soft deactivate (isActive=false) → keep audit trail of "this samplingNo existed once"

2. **What about usage_log on the shell?**
   - Migrate to canonical (operator filter by samplingNo will work seamlessly)
   - Leave on shell but mark `samplingNo` as deprecated (some history visibility loss)

3. **TI references and FK chains?**
   - `tinter_issue_entries.samplingNo` references `sampling_register.samplingNo`. Need to update those FK references if we delete a shell.
   - `sampling_recipes` has CASCADE on samplingNo — deleting the shell parent cascades to its recipes (fine since they're zero-value anyway).

4. **Prevention strategy?**
   - When operator saves a new TI with a shadeName that exactly matches an existing sampling_register entry, prompt: "Use existing samplingNo X (already has formula Y)?"
   - When operator saves a shade with all-zero pigments AND an existing samplingNo has the same name with real pigments, warn: "Are you sure this is a different shade?"

---

## Specific data-quality items to also catch

While doing the duplicate-merge pass, surface these too (could be Phase 7 or fold into prevention):

1. **Sampling numbers with usageCount > 1 but isPrimary recipe has all-zero pigments** — definitely shells with formula recorded elsewhere
2. **Sampling numbers with shadeName starting with "SPL " that have a non-SPL twin with same suffix** — SPL prefix conflicts that were SKIPPED in the previous import. Now's the chance to revisit them with the user.
3. **Sampling numbers in the same shadeName "family" (e.g. "SPL X" + "X" + "SPL X 20%LT")** — should one be parent and others variants?
4. **Sampling numbers with packCode=null on every recipe** — the 438 from this import that need pack identification. Some could be fixed via SKU master rerun if the master gets refreshed.

---

## Constraints specific to this session

- **NEVER delete a parent that has any tinter_issue_entries pointing to it without first updating those FK references.** This would break the live TI workflow.
- **NEVER overwrite pigment values on a recipe that has usageCount > 0** unless the user has explicitly confirmed in the preview review step.
- **ALWAYS create a `Dropped_Rows_Log` style audit trail Excel sheet** showing exactly what was deleted and from where, so we can reverse-engineer the state later if needed.
- **ALWAYS dry-run on 5-10 sample merges before the full run** — same pattern as last session.

---

## Starting prompt for the next session

(Paste this — or a refined version — at the start of the next Claude Code session)

```
Read CLAUDE.md at repo root before doing anything else. Then read docs/CLAUDE_CORE.md, docs/CLAUDE_TINT.md, and docs/CLAUDE_SAMPLING_LIBRARY.md fully and silently.

Also read the previous session's outcome: docs/prompts/drafts/web-update-2026-05-27-sampling-review-import-complete.md

After reading say only "All files read. Ready." Then wait.

GOAL OF THIS SESSION
Data quality refinement on the sampling library, with a focus on resolving duplicate sampling numbers.

CONTEXT
The previous session imported 601 legacy REVIEW sampling numbers. Some of those (and some pre-existing entries) are duplicates of each other — same shade name, but one has zero pigment values (created when formula was unknown) and another has the real formula recorded later under a new samplingNo. We need to detect these duplicates, decide a merge strategy, and clean up the library.

The source Excel (Tinting_data_Tracker_N_FINAL_REVIEW.xlsx) often has the real formula on the newer entry's rows even when the older shell has none.

PHASE 1 — DIAGNOSIS ONLY (no DB writes)
Identify all candidate duplicate groups in sampling_register. For each, report:
- Both sampling numbers
- The shadeName(s) — exact match or near-match
- Pigment values on both sides (highlight zero-pigment "shell" vs non-zero "real")
- Source Excel rows that informed each
- Recommended merge action with confidence (HIGH / MEDIUM / LOW)

Categorise:
- TRUE_DUPLICATE — same shade, one is empty shell, one has formula
- SPL_DISTINCTION — looks like a duplicate but the SPL prefix is real
- PARTIAL_OVERLAP — different SKUs under same shade, may need to merge as variants
- FALSE_POSITIVE — names match but they're genuinely different shades

CONSTRAINTS — read CORE §3
- No prisma.$transaction
- No prisma db push
- DB columns camelCase
- samplingNo is TEXT
- All commits to main only
- tsc --noEmit must pass

DO NOT write any code yet. DO NOT touch the database. Phase 1 is diagnosis only.

End Phase 1 with a count summary + sample of first 20 candidate groups. Then await user direction.
```

---

## Files to share at the start of the next session

- `Tinting_data_Tracker_N_FINAL_REVIEW.xlsx` (the source data — same one as last session)
- The current `sampling_register` state (Claude Code can query it directly)
- The previous session summary (this file's companion `web-update-2026-05-27-sampling-review-import-complete.md`)

---

## Anticipated outcomes

After this session:
- ~50-200 duplicate sampling numbers consolidated (estimate — actual could be more)
- Pigment values backfilled on shell parents from canonical formulas
- A prevention rule in the operator/TM screens to flag future near-duplicates
- Cleaner Sampling Library where each real-world shade has exactly one samplingNo

Phase 5 (fuzzy site matching) remains a separate session — don't combine.
