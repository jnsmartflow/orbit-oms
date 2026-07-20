# Picking Board Redesign — Date Zones + Tab Restructure

**Type:** web design draft (design-locked, pre-build)
**Date:** 2026-07-20
**Module:** Picking (`CLAUDE_PICKING.md`)
**Status:** DESIGN LOCKED — discovery next, then build

---

## 1. Problem being solved

Two separate defects in the current mobile supervisor board, fixed in one commit:

**Defect A — date scope hides live work.**
`getPickingQueue(dateParam)` scopes the WHOLE queue to a single dispatch-target date
(empty → today). All three tabs inherit that scope. Consequences:
- A `pending_picking` bill from an earlier day drops off today's board — supervisor
  would have to change the date to find it (a 10th–12th-std floor user won't).
- Worse: an assigned-but-not-finished bill (`pick_assigned`) also drops off at
  midnight — work already started vanishes.
- A never-picked bill whose date passes falls off EVERY tab, parked nowhere, no
  overdue warning — that's how a pick gets forgotten.
- No age signal anywhere, so even a visible bill gives no "waiting 4 days" cue.

**Defect B — wrong dividing line between tabs → meaningless badge counts.**
Today: `Assign=[pending] · Check=[pick_assigned + pick_done] · Completed=[pick_checked]`.
The Check tab merges two unlike states — "still being picked" and "done, needs your
check" — so its badge number is a mixed count that tells the supervisor nothing
actionable.

---

## 2. Mental model (the target)

Supervisor thinks in exactly three jobs, mirroring the Tint supervisor board:
**waiting to assign → work happening now → finished (today).**
Only "finished" cares about dates; the first two are status-only, date-free.

Four physical bill states must map onto three tabs:
1. Waiting — `pending_picking`
2. Picking — `pick_assigned`
3. On floor / needs check — `pick_done`
4. Checked — `pick_checked`

---

## 3. Locked design — Supervisor board

| Tab | Holds (states) | Date scope | Badge counts |
|---|---|---|---|
| **Assign** | Waiting `[1]` | all dates, split into two zones ↓ | bills to assign (Zone 1 only) |
| **Picking** | Picker fetching `[2]` | all dates | bills out on floor |
| **Done** | Needs-check `[3]` + Checked `[4]` | needs-check = all dates; checked = today + filter | **only needs-check** |

**Dividing line moves one state right:** `pick_done` leaves Check and joins Done.
Rationale: once material is physically on the dispatch floor, the picker's job is
finished — it belongs in "Done." The supervisor's check is a quality gate layered on
top, not a separate place.

### Assign tab — two zones (by dispatch date)

- **Zone 1 · Due now** — dispatch date **≤ today** (today + overdue spillover).
  The flat working list he assigns from. Age badge: 1d / 2d / 4d, amber when stale.
- **Zone 2 · Upcoming** — dispatch date **> today**. Support can set a dispatch date
  2 days ahead; those bills sit here. **Visible but LOCKED:**
  - Supervisor CAN open the bill and read full detail/line items.
  - Supervisor CANNOT assign — Assign button greyed with 🔒 + hint ("for Wed").
  - Badge here is neutral ("for Wed" / "in 2d"), not amber — a heads-up, not an alarm.

### Zone 2 lock — how it opens (V1, kept simple)

- **Automatic:** lock opens at **midnight of the dispatch date** (date ≤ today ⇒ bill
  graduates from Zone 2 into Zone 1). Simple formula, no per-window maths in V1.
  *(Early-afternoon-of-day-before opening was discussed and PARKED — adjust this
  condition later, not in this commit.)*
- **Manual early-release:** supervisor taps 🔒 → confirm ("release early?") → bill
  jumps to Zone 1. WHO is allowed to do this = **DEFERRED, decide later.**

### Done tab — two bands (the collapse)

- **Check now** (top, active, amber) — `pick_done`, **all dates**, never scoped, so
  nothing unchecked is ever lost.
- **Checked ✓** (below, collapsed, quiet green) — `pick_checked`, **today + optional
  date filter**. Approving a bill drops it from the top band into this settled pile,
  same tab.

---

## 4. Locked design — Picker board

Unchanged in shape (Pending / Done), one scope fix:
- **Pending** — his assigned-not-done bills, **all dates** (spillover from an
  unfinished shift must still show next morning).
- **Done** — today (his receipt).

---

## 5. One-line summary of the change

> Today all tabs are frozen to one date, and the Check tab mixes two states.
> New model: **only "Checked" keeps a date; Pending / Picking / Needs-check are
> status-only; future-dated work waits LOCKED in Zone 2; `pick_done` moves into the
> Done tab so every badge counts one clean thing.**

---

## 6. Known landmines to fold into this commit

- **Count over-count** (`CLAUDE_PICKING.md §7`): `windows[].count` / `totalCount` in
  `lib/picking/queue.ts` don't exclude `isDone` / `isChecked`. Re-cutting badges is
  the moment to fix both (`&& !r.isDone && !r.isChecked`).
- **Shared query blast radius:** `getPickingQueue()` feeds desktop table + mobile
  supervisor + picker board. Any date-scope change touches all three — every
  `isAssigned`/`isDone`/`isChecked` consumer must be grepped (standing rule, §7).
- **`pick_assignments.status` CHECK constraint** (`chk_pick_assignments_status`,
  `'assigned'|'picked'` only) — this redesign adds NO new status value (pure
  re-bucketing of existing stages), so the constraint is not touched. Confirm in
  discovery.
- **Access gap:** `floor_supervisor` + `picker` still have no `picking` permission
  rows. Whoever gets manual early-release, grants must exist first.

---

## 7. Open items (decide before/at build, not blocking design)

1. Pending-tab sort order inside Zone 1 — current spine (window-first, age as badge)
   vs oldest-first vs hybrid. **Parked until design locked — revisit at build.**
2. Manual early-release permission — who can open a Zone 2 lock. **Deferred.**
3. Zone 2 auto-open timing — midnight (V1) vs afternoon-before (later tune).
4. Tab-2 label — "Picking" vs "In progress" (floor-readability call).

---

*Design draft · carry into the discovery + build session.*
