# Picking Stage 2 — Shipped

**Date:** 2026-07-18
**Type:** code-update draft (NOT a consolidation — fold into canonical files in a later Claude Code session)
**Scope:** The full picker + supervisor check cycle on `/picking`.
**Discovery it builds on:** `docs/prompts/drafts/code-discovery-2026-07-17-picking-stage2.md`

> This doc was written from the planning chat, not reconstructed from git — it carries the *decisions and their reasoning*, which the code alone does not show. The depot PC restarted several times mid-build, so the Claude Code session lost this context; this file is the record.

---

## What shipped — the whole cycle

A bill now runs end to end: **assign → pick → done → check → approved**, every state visible and traceable.

| Piece | Where | Commit(s) |
|---|---|---|
| Foundation — 2 columns, 2 stages, rank move | `schema.prisma`, `workflow-stages.ts` | `626ff763` |
| Picker face (My Picks, Pending/Done) | `picker-my-picks-board.tsx`, `page.tsx`, `queue.ts`, `types.ts`, new `picker-roster.ts` | `a114cff9` |
| Test hook opened to operations | `page.tsx` | `0aaaa48f` |
| Assign-sheet nav-clearance fix + `SHEET_GEOMETRY` | `picking-board-mobile.tsx` | `83ec125e` |
| Mark done button + `/api/picking/done` + isDone leak fix | new route, `picker-my-picks-board.tsx`, board filters | `013586ce` |
| CTA nav-clearance fix + `MOBILE_NAV_CLEARANCE` centralised | `mobile-shell.tsx`, `picking-board-mobile.tsx` | `bc4a293c` |
| Check tab split (Needs check / Still picking) + picker Done-time | `picking-board-mobile.tsx`, `picker-my-picks-board.tsx`, `queue.ts` | `f16ffd6b` |
| Tick screen + `/api/picking/approve` | new route, `picking-board-mobile.tsx` | `7827e11c` |
| Checked tab (3rd tab) + all leak fixes | `page.tsx`, both boards, `queue.ts`, `types.ts`, `CLAUDE_PICKING.md` | `bae3d182` |

---

## Stage ladder — final

```
pending_picking   60   Support may edit
pick_assigned     70   locked
pick_done         80   locked   NEW — picker tapped Done
pick_checked      90   locked   NEW — supervisor ticked every line + Approve
dispatched       100   locked   MOVED from 90
```

- `supportMayEdit: false` on both new stages, **set by hand** — it does not inherit from rank (the file's own design). Getting it wrong would re-open Support's hold/cancel routes on a bill physically on the floor.
- Rank renumber was safe: discovery confirmed nothing anywhere reads a raw rank number (only derived stage-name arrays), and `dispatched` had never once been reached in production.
- Both new stages join `SUPPORT_DONE_STAGE_NAMES` (rank ≥ 60) automatically — correct, same treatment `pick_assigned` already gets.

---

## Schema

`pick_assignments` gained:
- `checkedAt DateTime? @map("checked_at")`
- `checkedById Int? @map("checked_by_id")` + relation `checkedBy` (`"PickAssignmentCheckedBy"` — the THIRD named relation to `users` on this table)
- `pickedAt` (already existed since Stage 1) is now actually written, by Mark done.

**Key decision — `status` was NOT extended.** The live DB has a CHECK constraint `chk_pick_assignments_status` allowing only `'assigned'` / `'picked'` — invisible in `schema.prisma`. `'picked'` was already legal (free for Mark done). A third `'checked'` value would have needed a SQL ALTER. Instead, "checked" is carried by the `checkedAt`/`checkedById` timestamp columns. `status` stays `'picked'` on a checked bill. **Do not be tempted to add `'checked'` to the status string.**

This table uses `@map` snake_case on every column — it predates the camelCase-no-`@map` rule and is exempt. New columns match the table, not the newer rule.

**The stage is the source of truth.** `workflowStage` is what every board/filter/gate reads. `status` is a mirror for one legacy Operations tile only — never a gate, never a filter.

---

## New API routes

Both copy the shape of `assign/route.ts` exactly — same auth, same error style, same audit write.

**POST `/api/picking/done`** — picker's Mark done
- Guard: order must be at `pick_assigned` → else 409 (this is what makes a double-tap safe)
- Ownership guard: assignment's `pickerId` must match — a picker can't mark another's bill done
- Two sequential writes, hand rollback on failure (NO `$transaction`): `status='picked'` + `pickedAt=now()`, then `workflowStage=pick_done`

**POST `/api/picking/approve`** — supervisor's Approve
- Guard: order must be at `pick_done` → else 409
- Two sequential writes, hand rollback: `checkedAt=now()` + `checkedById`, then `workflowStage=pick_checked`
- `checkedById` is ALWAYS the real session user — never client-supplied. The supervisor who ticked is the fact being recorded.

Both write an audit-log row and use `export const dynamic = 'force-dynamic'`.

---

## UI

- **Picker face** — "My Picks", two tabs (Pending / Done). Three-line card, no clock/avatar/footer. Done tab shows the pick time (his receipt). Reached only via `?view=picker&as=<id>`, admin/operations only.
- **Check tab split** — "Needs check" (pick_done, on top) / "Still picking" (pick_assigned, muted, below). Identical cards in both sections, **no green accent** (decided at mockup review — the section header carries the distinction, not the card). Picker name folds into the grey line: "Adajan · Ramesh K." One filter state across both sections.
- **Tick screen** — a 4th column of tick boxes in the QTY gutter the card already reserved. Ticks are **ephemeral** — plain component state, nothing saved, reset on close and between bills. Approve disabled until **every** line ticked (checks the full line array, not the filtered/visible one — a pack-chip filter can't sneak an unticked line past). No Undo, no qty field, no remarks — all deliberate.
- **Checked tab** — 3rd tab, today only (scoped on `dispatchTargetDate`, shared with desktop, not a separate JS "today"). Card shows "checked 4:22 PM" + "✓ Checked by {full name}" **on its own line** (relocated after truncation testing — the checker is the point of the tab and must never be clipped). Read-only detail. Keeps both picker and checker names — who-fetched vs who-checked are two different facts for tracing a bad pick.

---

## Design decisions worth keeping (the "why", in case a future session re-opens them)

- **No `pickedById` column.** Considered (mirror the Tint Operator "assigned-by / done-by" pattern) and **rejected**. In this design the picker only ever sees his own bills and there's one assignment row per order (real DB constraint), so "done by" could only ever equal "picker" — a column that copies its neighbour. Tinting stamps both because tinting genuinely has splits/reassignments; picking has none of that yet. If a shared-terminal model ever arrives, add it then, with a real reason. "Who tapped Done" lives in the audit log meanwhile.
- **`checkedById` DOES earn its column** — three supervisors, any can approve any bill, the checker's name is nowhere else on the row and routinely differs from the assigner.
- **Ephemeral ticks, not persisted.** The tick is a forcing function so the supervisor's eyes land on every line — not an audit trail. Median bill is 2 lines (72% ≤ 3), so the worst case of a phone-lock mid-check is re-scanning 2 lines. Persisting would cost a table + route + sync logic for a benefit that only matters on the long tail. Revisit only if the floor proves phone-locks are a real nuisance.
- **No confirm sheet on Mark done.** Fire-and-forget + toast, matching the existing assign/unassign pattern. The Done tab is the safety net — he can go look and see it landed.
- **No Undo on a picked/checked bill.** A wrong pick is fixed by the picker fetching the remaining goods, then the supervisor approves. Building an exception path now would mean guessing what the exception looks like before anyone has used the screen. Note: `/api/picking/unassign` still guards on `PICK_ASSIGNED`, so Undo only works on "Still picking" bills — this is intentional.

---

## Landmines recorded this session

1. **The shared queue payload leaks new stages into "unassigned" filters.** Happened with `pick_done`, then again with `pick_checked`. Both boards (mobile + desktop) have multiple filters shaped `!isAssigned && !isDone`, and a new stage is false on both, so it lands in "waiting". **Every new picking stage must grep all `isAssigned`/`isDone`/`isChecked` consumers on BOTH boards before shipping.** Call sites that needed `&& !isChecked` this round: mobile `waitingRows` + detail "Assign to picker" CTA; desktop `unassignedRows` + `availableRoutes` + `selectableIdsInTab`; and `page.tsx` picker split (the nastiest — an approved bill fell into the picker's Pending with a live Mark-done CTA).
2. **`windows[].count` and `totalCount` (desktop header) don't exclude done/checked rows.** Pre-existing for `isDone`, `isChecked` compounds it. Not fixed (fixing = desktop behaviour change, out of scope). Recorded in `CLAUDE_PICKING.md §7`. Fix all the derived counts together someday.
3. **`MOBILE_NAV_CLEARANCE`** (76px + safe-area) now lives in `mobile-shell.tsx`, exported alongside the `<nav>` it measures. This number was missed **4 times** (FilterBottomSheet, assign sheet, both detail CTAs) before it was centralised. `SHEET_GEOMETRY` and every bottom-pinned element now read from it. Fixing the assign sheet also fixed the live board's "Assign to picker" CTA — a bug that had been in production unnoticed.

---

## Access — still open, deliberately

`picker` and `floor_supervisor` have NO `role_permissions` grant for `/picking`. The entire build was tested on admin/operations via the `?view=picker&as=<id>` hook. The ownership guard in `/api/picking/done` is already load-bearing and becomes correct for free the day a real picker login exists.

Granting real picker access is a **separate future task**: the grant SQL (only `floor_supervisor` was ever drafted — `picker` needs its own INSERT) + a real picker start page (not the test-hook query param) + narrowing/removing the operations test hook.

---

## Deliberately deferred to Stage 3

- Supervisor recording **what he actually found** — qty short (e.g. 8 of 10), remarks, and a message the billing operator sees so he can fix it in SAP. This needs a findings table (a typed number is data, can't be ephemeral). The tick screen and the qty screen are the same screen, so this bolts on once the plain version has been used on the floor. Nothing else in the system changes — it's a note, not an edit to the order.
- Known data gaps that hurt a picker staring at the screen, both flagged, neither fixed: ~44% of legacy numeric SAP codes missing from `sku_master` (blank pack tiles), ~17% of live picking bills with no `articleTag`.
