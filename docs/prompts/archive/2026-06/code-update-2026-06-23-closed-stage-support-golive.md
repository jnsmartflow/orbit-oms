# Session Summary — `closed` Stage + Support Go-Live Cleanup
**Date:** 2026-06-23
**Type:** code- (Claude Code execution session)
**Status:** Shipped to `main`, live on Vercel. One header fix deferred to next session.

---

## Goal of this session

Make **Support** the next live workflow page (one stage at a time), after cleaning out 2 months of accumulated test/junk data sitting in the never-used post-tint prototype stages (Support → Planning → Warehouse → Dispatch). Preserve all real tinting + challan history. No batching of stages — Support first, prove it, then Warehouse later.

---

## Key decisions locked

1. **`closed` is the real, permanent final workflow stage** — not a trash drawer. It is the genuine finish line of the pipeline. (Name may be renamed later; it is a plain String value, trivial to change.)

2. **During this test phase, Support "Done" sends orders straight to `closed`**, skipping the future `support_done` parking gate. This is deliberate — so test orders never leak into the Warehouse screen when it is built later.

3. **`support_done` gate is NOT built — by design.** When Warehouse is built later, the Support "Done" action will be repointed from `closed` → `support_done`, and Warehouse will read `support_done` as its input. Until Smart Flow says go, nothing flows past Support.

4. **Cutoff for the backlog sweep = "now" (2026-06-23 00:00 IST).** Everything created before today's sweep → `closed`. Only orders arriving after go-live flow into the live Support queue.

5. **Option A sweep** chosen — swept both `pending_support` AND `dispatch_confirmation` (the full old backlog).

---

## What was built / changed

### Phase 1 — Code (commit `c823b35b`)
Message: `feat(workflow): add 'closed' final stage — hide from boards + repoint Support done`

- **Added `'closed'` to every board's `notIn` exclusion filter** so closed orders disappear from all live screens (same pattern as `dispatched`/`cancelled`):
  - `app/api/support/orders/route.ts` (slot section + hold section)
  - `app/api/support/slots/route.ts`
  - `app/api/tint/manager/missing-customers/route.ts`
  - `app/api/admin/fix-slots/route.ts`
  - `app/api/admin/fix-challans/route.ts`
- **Repointed Support "Done" action** from `workflowStage = "dispatch_confirmation"` → `"closed"` in:
  - `app/api/support/orders/[id]/dispatch/route.ts`
  - `app/api/support/orders/[id]/release/route.ts`
  - `app/api/support/bulk/route.ts` (dispatch branch)
- All other side-effects (dispatchStatus writes, order_splits updates, split_status_logs + order_status_logs inserts) left **unchanged** — audit trail preserved.
- `workflowStage` is a **plain String column** (NOT a Postgres enum) — so adding `closed`/`support_done` needs **zero migration**.

> ⚠️ Note: commit `c823b35b` also accidentally included a 291-line refactor of `Auto-Import-v2.ps1` (the multi-day recovery / `Invoke-RecoveryDayPass` work from the Jun 21 session that was sitting uncommitted). Confirmed coherent, deliberate prior work — left as-is. **Open item:** verify the repo copy matches the live copy on the depot PC at `F:\VS Code\OBD-Import Tool v2\Auto-Import-v2.ps1` (check file's Date Modified — if newer than Jun 22 21:50, they diverged).

### Phase 2 — Backlog sweep (Supabase SQL, manual)
One `UPDATE` run in Supabase SQL Editor:
- Swept **5,245 orders** (4,882 `pending_support` + 363 `dispatch_confirmation`, created before cutoff) → `workflowStage = 'closed'`.
- **Nothing deleted.** Fully reversible relabel. All challans + tint history intact.
- Result confirmed: Support queue emptied; active tint orders survived (`tint_assigned` 10, `pending_tint_assignment` 4, `tinting_in_progress` 1).

### Phase 3 — Access confirmed (no code needed)
Discovery confirmed the **Operations role id** (`operations@orbitoms.com`, "Operations User") can fully drive the Support workflow end-to-end via **`/operations/support`** (NOT `/support` — that route is blocked for operations; it needs the `support_queue` DB permission row which operations lacks).
- `/operations/support` renders the **same** `SupportPageContent` component and calls the **same** `app/api/support/*` routes as `/support` — so testing here exercises the real code.
- The Operations id is a **near-omnipotent supervisor**: full transactional rights across Tinting Manager (assign/reassign/cancel/splits/reorder), Tint Operator (start/done/TI/splits), Dispatch/Planning (full), Warehouse (full).
- **Only blocked actions:** Tint Manager Remove-OBD + manual-entry (pull/lookup/revert) [tint_manager + admin only], and Operator pause/resume [needs tint_operator DB row].

### Header counter fix #1 (commit `bd9b3178`)
Message: `fix(operations): exclude closed orders from summary header counters`
File: `app/api/operations/summary/route.ts`
- `dispatched` counter → fenced to today IST only (was all-time, counted the 363).
- `onHold` → added `workflowStage notIn ["closed","dispatched","cancelled"]`.
- `overdueOrders` → added `workflowStage notIn ["dispatched","closed","cancelled"]`.

---

## Final workflow pipeline (current state)

**Non-tint OBD:**
```
Import → pending_support → [Support Done] → closed
```

**Tint OBD (whole):**
```
Import → pending_tint_assignment → tint_assigned → tinting_in_progress → pending_support → [Support Done] → closed
```

**Tint OBD (split):**
```
Import → pending_tint_assignment → tinting_in_progress → pending_support → [Support Done] → closed
(split path skips tint_assigned — existing behaviour, unchanged)
```

**Later (when Warehouse built):** insert Warehouse/Dispatch stages before `closed`; repoint Support Done → `support_done`.

---

## Open / deferred items (carry to next session)

1. **Support Queue header still shows "363 dispatched"** — this is a SECOND, separate header from the one fixed in `bd9b3178`. Source: `app/api/support/slots/route.ts:130-135` `dispatchedCount` query has **no workflowStage filter and no date fence** — counts every `dispatchStatus:"dispatch"` order forever. Client sums it at `support-page-content.tsx:351`. **Fix not yet applied** — pending a decision on whether to fence by `obdEmailDate` (sometimes null) or `createdAt` (never null). To be done in the new Support-view session.

2. **1 stuck split order** at `tinting_in_progress` with all splits `tinting_done` — never advanced to `pending_support`. The "split-done usage-log gap" (CORE §13 landmine). Diagnose + fix later.

3. **2 ghost-stage counters** in `operations/summary` still reference dead stages (`submitted`, `tinting`, `tint_done`, `ready`):
   - warehouse-unassigned count (line ~73) — should be `dispatch_confirmation`
   - closedSlot alert (line ~118) — should be `["pending_support","dispatch_confirmation"]`
   Deferred to Warehouse go-live (those stages aren't live yet anyway).

4. **`support_done` gate** — build when Warehouse goes live. Repoint Support Done from `closed` → `support_done` at that time.

5. **Auto-Import-v2.ps1 repo vs depot-PC copy** — verify they match (see Phase 1 note above).

---

## What's next

- **1-week Support test** on `/operations/support` using the Operations id: confirm new OBDs land in queue, open → Done → moves to `closed` → leaves queue.
- **New session:** full Support-view discovery (data sourcing, auto-patch behaviour, slot assignment/override, read/history view, carry-over of yesterday's pending into today's slot) → then modify/build Support while testing.
