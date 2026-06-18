# Session: Sampling Library Orphan Diagnosis (Phase 4.5 Considered, Not Shipped)

**Date:** 2026-05-26
**Outcome:** No code shipped. Diagnosis complete. Fix deferred indefinitely.
**Production HEAD at session start and end:** `ed2d1af5` (drop sampling number from challan formula format)

---

## The reported issue

Operator types new shade → hits Save TI → system creates `sampling_register` + `sampling_recipes` rows immediately. Operator then realises shade already exists in library → picks existing samplingNo via SuggestionCard → hits Update TI Entry. Result: originally-created `sampling_register` row is left orphaned in DB with `usageCount=0`, visible in Sampling Library browse page.

## What the diagnosis confirmed (read-only)

Code path verified via grep + file reads:

1. **Save TI new shade** → `app/api/tint/operator/_lib/sampling-resolution.ts:162-178` → creates parent + recipe, both committed via sequential awaits, no rollback.
2. **Update TI Entry switch (old samplingNo → new)** → `app/api/tint/operator/tinter-issue/[id]/route.ts:178-206` → only rewrites `tinter_issue_entries.samplingNo`. Does NOT touch orphaned `sampling_register` row. No cleanup logic anywhere in codebase.
3. **Mark Done** → `usage-log-writer.ts:79-83` is null-safe (skips + warns) but does not retroactively allocate. Orphan persists with `usageCount=0` forever.

**No cleanup cron, no constraint, no manual cleanup endpoint in current code.**

Two orphan paths exist:
- Save → switch (via SuggestionCard)
- Save → clear via X button on linked-sampling chip (`tint-operator-content.tsx:1902`)

Both produce the same DB damage.

## Proposed fix (designed, not implemented)

**Option D — defer allocation to Mark Done** (chosen after evaluating A, B, C):

- Save TI for new shade: write `tinter_issue_entries` with `samplingNo=null`, `shadeName=<typed>`. Do NOT call `next_sampling_no()`. Do NOT write to `sampling_register` or `sampling_recipes`. Return `previewSamplingNo` (MAX+1 hint, not reserved) in response.
- Save TI existing samplingNo: unchanged.
- Update TI Entry switch: just rewrite `tinter_issue_entries.samplingNo`. No orphan to clean because none was created.
- Update TI Entry clear-to-null: set samplingNo=null, keep shadeName from form.
- Mark Done existing samplingNo: unchanged.
- Mark Done null-samplingNo (new shade pending): **Phase 5** — allocate via `next_sampling_no()`, create register + recipe, update TI row, write usage_log + recipe bump.

**Phase 4.5 = defer-only.** **Phase 5 = Done-time allocation.** Spec locked at 14 points in conversation.

## Why we did not ship

Real production data from 2 days of operation (sampling library went live 2026-05-24):

- **28 sampling numbers created** in 48 hours by 3 operators
- **1 orphan** (`26-0017`, `spl 30yy 69/048` by Deepak id=22)
- **27 used successfully** in completed jobs (real usage_log + recipe bumps)
- **Orphan rate: ~15/month at current volume**

The single orphan was a **training/UX issue, not a code defect**:
- Operator typed new shade without checking suggestion card first
- After saving, realised the shade already existed as `#580` in library
- Switched to #580 to continue the job
- 26-0017 left orphaned

**Operator behaviour will improve with system familiarity.** With more weeks of use, orphan rate will trend down, not up.

**Cost-benefit:**
- Fix surface area: 6-10 hours engineering + smoke test + regression risk on hottest depot code path (Save TI + Update TI + Mark Done)
- Manual cleanup: 30 seconds per orphan via TM screen → 8 minutes/month max at current rate
- Trade is unfavourable. Don't ship.

## What was implemented and then reverted

Phase 4.5 code WAS implemented and tested on staging during the session:

- 5 files edited: `sampling-resolution.ts`, `tinter-issue/route.ts` (+b), `tinter-issue/[id]/route.ts` (+b)
- 1 file touched for type compat: `save-sampling-popup.tsx`
- 1 file received only a comment: `usage-log-writer.ts`
- Smoke tested on `localhost:3000` against real DB
- Test 3 (save→switch on Sai Residency, real OBD `9106997896`) **passed**: baseline `sampling_register` count 3586 stayed at 3586 after save→switch→done cycle
- Found 26-0018 was allocated at Done time for a TI row that pre-dated Phase 4.5 (line had real samplingNo from old-code Save) — confirmed not a Phase 5 leak, just normal usage_log path on a pre-fix TI row

After staging tests passed, Smart Flow paused before commit to query production for actual orphan rate. Real data (1 orphan in 2 days) → decision not to ship.

Phase 4.5 code stashed (`stash@{0}: phase-4.5-orphan-fix-WIP-2026-05-26`), then dropped permanently via `git stash drop` after decision. No commit reached main. No deploy.

## Manual cleanup done

```sql
UPDATE sampling_register 
SET "isActive" = false, "needsReview" = true 
WHERE "samplingNo" = '26-0017';
```

26-0017 deactivated. Library clean.

## Team action

Briefing for Deepak (id=22) and Chandrasing (id=23):

> Before typing a new shade name, check the suggestion card and library first. If the shade already exists, use that number. Today's 26-0017 (`spl 30yy 69/048`) was actually already in the library as `#580` — creating a new number for an existing shade clutters the library.

## When to revisit

Set a monthly check. Run this query end of each month:

```sql
SELECT 
  COUNT(*) AS total_created_this_month,
  COUNT(*) FILTER (
    WHERE NOT EXISTS (SELECT 1 FROM sampling_usage_log WHERE "samplingNo" = sr."samplingNo")
      AND NOT EXISTS (SELECT 1 FROM tinter_issue_entries WHERE "samplingNo" = sr."samplingNo")
      AND NOT EXISTS (SELECT 1 FROM tinter_issue_entries_b WHERE "samplingNo" = sr."samplingNo")
  ) AS orphan_count
FROM sampling_register sr
WHERE sr."createdAt" >= date_trunc('month', NOW());
```

**Decision triggers:**
- Orphan count < 20/month → keep deferring, manual cleanup
- Orphan count 20-50/month → schedule Phase 4.5 + 5 within 2-4 weeks
- Orphan count > 50/month → urgent, ship Phase 4.5 + 5 immediately

If/when shipping becomes necessary: the design spec (14 points), file-level change map (5 production files + 1 popup), and smoke test plan (5 tests) are all in this session's conversation history. Re-implementation should take 1 session (4-6 hours) with all the diagnosis pre-done.

## Files touched in conversation context (no production impact)

Diagnosis reports were generated by Claude Code as report-only output (posted to chat, not written to disk). Phase 4.5 code went to local working directory → stash → dropped. The two non-source files that show `git diff` against origin/main are unrelated to this session:

- `.claude/settings.local.json` — Claude Code permission cache, local-only
- `docs/plans/sampling-register/Tinting_data_Tracker_N_FINAL_REVIEW.xlsx` — Excel timestamp change

Neither needs to be committed.

## Lessons banked

1. **Diagnosis prompts pay for themselves.** Read-only file maps + scenario traces caught the exact code path without a single line of code changed. Cheap insurance.
2. **Always check real production data before fixing a "known" bug.** The bug was real on paper. The bug was rare in practice. Without the SQL check, would have shipped 6-10 hours of fix for an 8-minute/month problem.
3. **Workflow/training bugs often look like code bugs.** First impulse is to fix the code. Better impulse: ask "why did the operator do that?"
4. **Skepticism stops over-engineering.** Smart Flow's pause before commit ("I'm getting skeptic") was the right reflex. Diagnosis showed the fix wasn't needed yet.

## Roadmap note

Update `ROADMAP.md` next time it gets manually attached:

- **Deferred:** Sampling Library orphan fix (Phase 4.5 + Phase 5). Design spec complete in session 2026-05-26. Revisit if monthly orphan count exceeds 20.
- **Active:** Suggestion card prominence (Option 1 from session) — make exact-match cards visually louder to nudge operators away from typing duplicates. Cheap UX fix, 2-4 hours, lower risk than Phase 4.5 + 5.
