# code-update-2026-09-08 — Floor tint lock on Hold and Cancel

**Status:** SHIPPED · commits `56db79b8` then `4af18cc8` on `main` · 2026-09-08
**Routes to:** `CLAUDE_FLOOR.md` (§4.1, §4.6, §4.7, §10) · a landmine line in `CLAUDE_CORE.md §13` · one ROADMAP item
**Files changed:** `components/floor/rail-card.tsx`, `components/floor/detail-panel.tsx`
**Schema:** untouched. No API field added, no query changed.

---

## 1. Why — three live incidents in one week

Floor Control's ✕ (cancel) and Hold write to the `orders` row only. Neither looks at the tint
side, so a bill can be cancelled out from under a tint operator who is standing at the machine.

| # | Date | OBD | What happened |
|---|---|---|---|
| 1 | 2026-09-02 | 9109265718 | Cancelled from the rail while `tint_assigned` to Deepak Vasava. Restore put it back at `pending_support`; Release then pushed it to `pending_picking`; a test picker then assigned and "picked" it. The bill jumped over the whole tint stage and vanished from Tint Manager. |
| 2 | 2026-09-08 | 9109367531 | Cancelled at 11:06 IST, **nine minutes after the operator pressed Start**. Order → `cancelled`; `tint_assignments` #1076 stayed at `tinting_in_progress`. Because the order was cancelled the job left his queue, so he could not finish it either — and the operator start-guard then blocked *every* new job with "You already have a job in progress. Complete it first." An invisible job blocking the machine. |
| 3 | 2026-09-02 | (4 more) | A reference query found 5 orders carrying an OPEN `tint_assignments` row while sitting at `cancelled` / `dispatched` / `pick_done` — the same class, already accumulated. |

Both named bills were repaired by hand in SQL (§4 below).

## 2. What shipped

A rail bill with an **open tint job** can no longer be held or cancelled from Floor Control.
Two surfaces closed together, because the panel opens straight off a card and would have been
the same hole one click away:

- **Rail card** (`rail-card.tsx`) — Hold and ✕.
- **Detail panel** (`detail-panel.tsx`) — the rail-sourced Hold/Cancel pair in the ⋯ menu.

Both stay **visible and greyed, never hidden**, reusing the slot picker's own disabled fragment
`opacity-40 cursor-not-allowed` (`dispatch-slot-picker.tsx:235`). The reason sits on a
`<span title=…>` wrapper — a disabled button shows no title of its own in Chrome. The ✕ and the
panel's Cancel drop their red while locked: a blocked action on the rail is a "not yet", not an
error (FLOOR §8).

Copy:
- `waiting` → "Tint order not yet assigned — cancel from Tint Manager"
- `assigned` → "Assigned to a tint operator — cancel from Tint Manager"
- `mixing` → "Tinting in progress — cancel from Tint Manager"

### The predicate — tint state, deliberately NOT `!releasable`

Card:

```ts
const tintLocked =
  card.tint !== null &&
  (card.tint.stage === "waiting" ||
   card.tint.stage === "assigned" ||
   card.tint.stage === "mixing");
```

Panel (same answer, same underlying column):

```ts
const tintLocked =
  source === "rail" && d.isTint &&
  (d.workflowStage === "pending_tint_assignment" ||
   d.workflowStage === "tint_assigned" ||
   d.workflowStage === "tinting_in_progress");
```

`TintState.stage` is derived in `lib/floor/queries.ts:531-535` from `orders.workflowStage`, and
`FloorDetail` already carried `workflowStage` + `isTint` — so card and panel cannot disagree, and
no new API field was needed.

All three open `tint_assignments` statuses are covered. **`paused` folds into
`mixing`/`tinting_in_progress`**: pause and resume write the assignment row only and leave
`orders.workflowStage` alone (TINT §5).

**`!releasable` (`card.workflowStage === "pending_support"`) was rejected.** It is a stage-rank
test, not a tint test: it would have swept in `pending_tint_assignment` (nobody holding paint —
Hold there is exactly the legitimate thing to do) and every non-tint bill before
`pending_support`. The header comment at `rail-card.tsx:30-33` states the intent as tint, but the
code dims by stage rank — worth remembering as a "comment ≠ code" case.

### Deliberately left unlocked

- `ready` (`pending_support`) only — tinting is finished, and the floor must be able to hold,
  cancel or release. **Do not widen past this.**

### `waiting` was left unlocked in `56db79b8`, and that was wrong — corrected in `4af18cc8`

The first commit left `waiting` (`pending_tint_assignment`) live, reasoning that with no operator
attached and no paint committed, a cancel there is harmless. Hand-checking on `/floor` showed the
buttons still live on a real waiting card (OBD 9109367418) and the reasoning fell apart on
inspection: **the damage does not come from the attached operator, it comes from Restore.**
Restore always writes `pending_support`, so a tint bill cancelled at `waiting` still comes back
past the tint stage and still disappears from Tint Manager — incident 1 (OBD 9109265718) is
exactly that path. The lock now covers every tint bill whose tinting is not finished.

Lesson worth keeping: the rationale for an exclusion has to name the actual failure mode. "No
operator attached" described the symptom of the incidents, not their cause.

## 3. Known gaps — still open after this fix

1. **No server-side guard.** `POST /api/floor/actions` reads `orders` only (`route.ts:91-94`) and
   never touches `tint_assignments`. Cancel is explicitly not stage-gated (comment at
   `route.ts:138`). Decided and deferred this session: there is currently **no legitimate route to
   cancel a genuinely cancelled tint OBD once assigned** — Tint Manager's Remove OBD returns 409
   after assignment (TINT §8). Guarding the server before that escape route exists would trade a
   rare mistake for a regular dead end. Needs its own session, together with the escape route.
2. **Restore is lossy.** `POST /api/floor/actions` restore always writes `pending_support`
   (FLOOR §4.1) — it does not return a bill to the stage it was cancelled from, even though the
   cancel log records that stage in `fromStage`. This is what turned incident 1 from a one-click
   mistake into a stage-skip. Candidate fix: read the cancel log's `fromStage` and restore to it.
3. **Cancel strands the tint assignment.** Nothing on the cancel path closes an open
   `tint_assignments` row, which is what produced incident 2's invisible blocker. Whatever the
   server guard decides, cancel should either refuse or close the job — never leave it running.

## 4. Manual repairs made (for the record — not a runbook)

- **OBD 9109265718** (order 14373): stage forced back to `tint_assigned`; `dispatchStatus`,
  `dispatchTargetDate`, `dispatchWindowId`, `dispatchSlotSource`, `dispatchSlotRuleId`,
  `isPicked`/`pickedAt`/`pickedById` cleared; audit row written. A stray `pick_assignments` row
  (#3153, test picker 44, notes "test") was surfaced for deletion — **confirmation that it was
  removed was never received; verify before trusting that order.**
- **OBD 9109367531** (order 15234): stage restored to `tinting_in_progress` (per the cancel log's
  `fromStage`); assignment #1076 left running so the operator could finish. The job clock was NOT
  reset, so its recorded tinting time includes ~1.5 h during which the order sat cancelled —
  minor pollution in the Tint Summary report for that day.

Both used `changedById: 1` on the audit row, following the precedent in TINT §2's parent
auto-advance.

## 5. Verification

`npx tsc --noEmit` exits 0 on both commits. Pushed to `main`. The rendered screen was **not**
verified by Claude Code (no login) — hand-check on `/floor`:

1. Tint rail card at waiting / assigned / mixing → Hold and ✕ greyed, tooltip readable, correct
   one of the three reasons.
2. That card's detail panel ⋯ → Hold and Cancel greyed, same reason.
3. An all-shades-ready tint card → still fully live.
4. Any non-tint card → unchanged.

Partial hand-check done 2026-09-08 after `56db79b8`: the `mixing`/`assigned` lock and the greyed
picker rendered correctly, and non-tint cards were untouched. The `waiting` case is what
`4af18cc8` added and still needs an eyeball.
