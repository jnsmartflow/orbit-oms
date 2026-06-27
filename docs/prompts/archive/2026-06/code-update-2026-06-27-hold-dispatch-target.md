# Code Update — Hold & Dispatch-Target System + History Actionable

**Date:** 2026-06-27
**Scope:** Support board — major new architecture (hold lifecycle, dispatch windows, two-footprint history) + history unlock.
**Status:** Built, tsc-clean, smoke-tested on local, pushed to main.
**Consolidation target:** CLAUDE_CORE (schema + rules), CLAUDE_UI (picker), and a Support-board module file if/when one is split out.

---

## 1. What this session shipped

### 1a. Support history fixes (early session)
- **Blank-on-past-dates fixed.** History was excluding dispatched/closed orders, so a fully-processed past day showed empty. Now history shows ALL orders for that day; done ones collapse into a "done" group (Mail Orders pattern).
- **Slot grouping in history** uses `arrivalSlotId`.
- **"All" view** (no slot selected = single-click toggle off a slot) shows every slot's pending + full done pile. Today's board is date-fenced to `obdEmailDate = today` (arrivals only — no week-old carry-over leaking in).
- **Dispatch pill shows the real action** in the done group: green Dispatch / amber Hold / grey Done (was a generic "DONE").
- **Header slimmed** (today view only) to `{X}% done · {N} OBDs`, green pill matching Mail Orders' "% punched". History header keeps pending/done/tinting/OBDs.
- **Two count bugs fixed:** (a) a date-leak where today's "All" view pulled pending orders from every past date; (b) a double-count where dispatched orders were counted in both `dispatchedCount` (dispatchStatus="dispatch") and `doneCount` (workflowStage="dispatched"). Fixed by fencing today counts to `obdEmailDate=today` and making `dispatchedCount` exclude already-dispatched/closed.

### 1b. Hold & Dispatch-Target system (core of the session)
The big build. See section 2 for the design.

### 1c. History made fully actionable (end of session)
- Removed the "Read Only" lock on past-day views. History now behaves like Mail Orders — pending AND done orders on any past day are actionable (dispatch, hold, cancel, undo, slot, priority, bulk).
- All server action routes were already date-agnostic; this was a **client-only unlock** (removed `isHistoryView` gates).
- `isReadOnly` changed from `(isHistoryView || isDoneRow)` to just `(isDoneRow)` — done rows stay read-only (their only action is undo, now enabled on history too); past-day pending rows become interactive.
- Removed the "Viewing {date}" banner (redundant; date shows in the picker).

---

## 2. Hold & Dispatch-Target — the locked design

### The mental model
- An order **lives on its arrival day's board** and stays there (like Mail Orders). It shows its current decision.
- **One decision = one footprint.** A normal order (even acted on late) has one entry on its arrival day.
- A **held order = two decisions = two footprints:**
  - **Hold footprint** — amber Hold, on the order's arrival day (anchored by `heldAt`, which now equals the arrival date — see below).
  - **Dispatch footprint** — green Dispatch, on `dispatchTargetDate` (the day chosen at release).
  - Same OBD visible on two days, each showing what was true that day.
- **"Done" group = decision taken** (dispatch OR hold OR closed). Held orders sit in the done group with amber Hold (read-only there; release via the Hold tab).
- **Header "% done" = decisions taken** (holds count as decided).

### Key rule: heldAt = arrival date (NOT wall-clock now)
`heldAt` is stamped as the order's `obdEmailDate` (arrival date), not the moment of clicking. This anchors the hold footprint to the order's arrival day, so:
- Holding an order from a past-day view keeps the Hold footprint on that past day (no cross-day jump to "today").
- Board is clean and tally-able per arrival day.
- The **audit log still records the real wall-clock moment** (`order_status_logs.createdAt`), so the true timeline is preserved for audit — just not used for board placement.

### Same-day collapse
If an order is held AND released on the same day, it shows ONCE as green Dispatch (dispatch wins). Priority: **dispatch > hold > arrival.**

### Normal orders stay approximate (accepted)
A never-held order shows its CURRENT dispatchStatus on its arrival day. If it arrived on the 20th but was dispatched on the 25th, looking back at the 20th shows it as Dispatch (not "pending as of the 20th"). This is the Mail Orders behaviour — history is NOT a frozen snapshot for normal orders. Only HELD orders are historically precise (via heldAt/dispatchTargetDate). Frozen snapshots would need full log-replay — deliberately NOT built.

---

## 3. Schema additions (v27.7-ish)

All nullable, no backfill, no `@map`. Added via Supabase SQL Editor + hand-edited schema.prisma + `npx prisma generate`.

**On `orders`:**
- `heldAt` — `DateTime? @db.Timestamptz(6)` — anchors the hold footprint (= arrival date when set).
- `dispatchTargetDate` — `DateTime? @db.Date` — the chosen dispatch day. Date-only (no time; the window carries the time).
- `dispatchWindowId` — `Int?` — FK to `dispatch_slot_master.id`. (Originally added wrongly as `dispatchTargetSlotId` → slot_master; renamed + re-pointed.)
- `dispatchWindow` relation → `dispatch_slot_master` (`@relation("OrderDispatchWindow")`).

**New table `dispatch_slot_master`** (dispatch windows — SEPARATE from arrival slots in `slot_master`):
- `id` (PK), `windowTime` (text, e.g. "10:30"), `label` (text?), `sortOrder` (int), `isActive` (bool), `createdAt`, `updatedAt`.
- Seeded 4 windows: **10:30, 12:30, 16:00, 18:00**.
- These dispatch windows are distinct from arrival slots (Morning/Afternoon/Evening/Late Evening/Night in slot_master). They will later drive auto-slot-assignment + downstream picking/planning.

---

## 4. The three hold write-paths (all consistent now)

Any code that sets `dispatchStatus = "hold"` must ALSO stamp `heldAt = order.obdEmailDate ?? new Date()`. Three paths:
1. **Single-order:** `app/api/support/orders/[id]/hold/route.ts`
2. **Bulk:** `app/api/support/bulk/route.ts` (per-order in the loop)
3. **Auto-import enrichment:** `app/api/import/obd/route.ts` (`applyMailOrderEnrichment` — uses a per-order loop after the updateMany, since updateMany can't set per-row obdEmailDate)

**Lesson:** when an action has multiple entry points (single / bulk / import), ALL must be updated together. The bulk and import paths were each missed once and caused wrong-pill bugs.

### Release route
`app/api/support/orders/[id]/release/route.ts` now requires `dispatchTargetDate` (YYYY-MM-DD) + `dispatchWindowId` in the body. Parses the date with `Date.UTC(y, m-1, d)` to avoid IST/UTC day-shift (matches how it's stored and compared). Still closes the order + sets dispatchStatus="dispatch". Log note stays human-readable (no machine-parsing of notes).

---

## 5. Two-footprint history query (the heart)

In `app/api/support/orders/route.ts` history branch, the WHERE is a 3-arm OR for a viewed date D:
- `obdEmailDate ∈ ISTrange(D)` → arrival footprint
- `heldAt ∈ ISTrange(D)` → hold footprint
- `dispatchTargetDate ∈ DATErange(D)` AND `workflowStage="closed"` → dispatch footprint

**`footprintType`** is computed server-side per row, priority **dispatch > hold > arrival**, and returned to the client. The pill branches on `footprintType` first, then falls back to `currentDs`.

Date compares: IST ranges via `getISTDayRange`; `dispatchTargetDate` (a `@db.Date`) compared with `Date.UTC(y,m-1,d)..+1` — same expression both sides, no day-shift.

`ORDER_INCLUDE` gained `dispatchWindow { windowTime, label }` so the dispatch footprint shows its window time in the slot column.

Counts (`slots/route.ts`): history `doneCount` OR's arrival-done + dispatch-target arms (count() dedups by row, no double-count). History `pendingCount` excludes `dispatchStatus="hold"` (held orders are now "done"). Today `doneCount` includes `dispatchStatus="hold"`.

`isDone` widened to: `workflowStage in [closed, dispatched] OR dispatchStatus="hold"` — so held orders land in the done group on both live and history boards.

---

## 6. The Dispatch Slot picker (reusable component)

`components/support/dispatch-slot-picker.tsx` — world-class date-rail + window-pills pattern (like Amazon/DoorDash delivery slots).
- Horizontal **date rail** (upcoming days, today pre-selected) + a **calendar icon** for far dates.
- Below: the **4 window pills** (10:30/12:30/16:00/18:00) for the selected date, pulled from `dispatch_slot_master` via `GET /api/support/dispatch-windows`.
- Portal-rendered popover (`createPortal` to body + `getBoundingClientRect`) to escape table overflow clipping.
- Value shape: `{ date: "YYYY-MM-DD", dispatchWindowId, windowTime }`. Selected state shows `DD-MM · HH:MM` with × to clear.
- **Reusable** — designed to drop onto any OBD later (the general "assign date+slot to any order" feature reuses this).

Wired into the **Hold tab**: each held row has a Dispatch Slot column + an Action column (Release · Cancel). Release is disabled until a slot is picked. Bulk bar = one shared picker applied to all selected (loops the single release route per order — there is no bulk-release API action).

**Hold tab slot-tab guard:** when in Hold view, the slot tabs are greyed (`opacity-40 pointer-events-none`) + clicks are no-ops (`if (mainTab === "hold") return` in `onSegmentChange`). This fixed a bug where clicking a slot in hold mode leaked pending orders into the hold list.

---

## 7. Engineering notes / gotchas reaffirmed this session
- Schema changes: Supabase SQL Editor → hand-edit schema.prisma → `npx prisma generate`. Never `prisma db push/pull`. No `BEGIN/COMMIT` wrappers in SQL Editor.
- Dispatch window `dispatchTargetDate` is date-only to avoid timezone day-boundary bugs; `Date.UTC(y,m-1,d)` parse, no day-shift.
- All commits direct to main; tsc --noEmit clean before each; explicit `git add` of named files.
- `obdEmailDate` is THE arrival-day anchor for board membership (both routes fence on it). `heldAt` now copies it.

---

## 8. OPEN ITEMS (resume here)

### Bugs / cleanup
- **dispatchStatus "sticky note" root cause (UNRESOLVED — now 3 patches deep).** dispatchStatus is not cleared when an order's workflowStage advances to dispatched/closed, leaving contradictory state (status says "dispatch/hold" while stage says "closed"). We've patched AROUND it three times (count double-count, pill logic, footprint logic). The real fix is to clear/normalize dispatchStatus at the dispatch transition. Should be done properly, not patched again. **→ needs its own ROADMAP entry + a deliberate fix.**
- **Picker cosmetics (deferred):** date pills still feel heavy; calendar icon gets cut off. Reduce to ~5 visible dates and lighten the pills.
- **Sree Milap test row (9107904128):** has `heldAt = null` from before the fix → shows wrong pill on its hold day. Test artifact, ignore (don't manually SQL-repair).

### Not-yet-tested
- Cancelled / tinting / physically-dispatched rows still non-interactive on past days — logic says yes (guards independent of isHistoryView), but not click-tested. Verify when convenient.
- Full tomorrow-footprint lifecycle was verified via held-then-released test (Paragon Traders held on 26 Jun stayed on 26 Jun amber Hold ✓; same-day Jayesh release showed green Dispatch ✓).

### Future features (designed, not built)
- **"Assign date+slot to ANY order"** — the general feature the Dispatch Slot picker was built for. Hold-release is the first consumer; normal orders will reuse the same picker + `dispatchTargetDate`/`dispatchWindowId` fields.
- **Auto-slot-assignment** off the dispatch window (downstream picking/planning will key off `dispatch_slot_master`).
- **Lock "done" edits on history** later — currently both pending and done are editable on past days (intentional, for testing + downstream creation). Locking done = likely a one-line gate when ready.

---

## 9. Files touched this session (Support hold/dispatch-target + history)
- `app/api/support/orders/route.ts` — history WHERE (3-arm OR), footprintType, ORDER_INCLUDE dispatchWindow, today date-fence.
- `app/api/support/slots/route.ts` — history + today count fixes (doneCount OR, pendingCount hold-exclusion, double-count fix, date fences).
- `app/api/support/orders/[id]/hold/route.ts` — heldAt = obdEmailDate.
- `app/api/support/orders/[id]/release/route.ts` — accepts + stores dispatchTargetDate + dispatchWindowId.
- `app/api/support/bulk/route.ts` — bulk hold stamps heldAt = obdEmailDate.
- `app/api/import/obd/route.ts` — enrichment hold stamps heldAt = obdEmailDate (per-order loop).
- `app/api/support/dispatch-windows/route.ts` — NEW; returns active dispatch_slot_master windows.
- `components/support/dispatch-slot-picker.tsx` — NEW reusable picker.
- `components/support/support-page-content.tsx` — hold tab picker wiring, slot-tab guard in hold mode, history unlock gates, banner removal.
- `components/support/support-orders-table.tsx` — footprintType pill logic, isDone widen, doneOrders dispatch bypass, isReadOnly change, history action unlock, undo guard.
- `components/universal-header.tsx` — segmentsDisabled prop (greys slot tabs in hold mode).
- `prisma/schema.prisma` — heldAt, dispatchTargetDate, dispatchWindowId + dispatchWindow relation; new dispatch_slot_master model.
- DB (Supabase): 3 columns on orders + new dispatch_slot_master table (4 seeded windows).
