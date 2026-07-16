# CLAUDE_SUPPORT.md — Support Module
# v1.6 · Schema v27.9 · July 2026 · updated 2026-07-11
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md

---

## 1. What Support is

Support is the **gatekeeper** between the import pipeline and downstream dispatch/warehouse work. Every OBD that enters the system arrives in `workflowStage = "pending_support"`. Support decides the **Status** (Dispatch / Hold / Cancel) and, for Dispatch, a **date + window slot**. Auto-enriched dispatches auto-close on import (auto-done — see §4.8). The operator only handles the leftovers that need a manual decision.

### Routes

| Route | Who | Notes |
|---|---|---|
| `/support` | `support`, `admin`, `operations` | Needs `support_queue` DB permission row. The named support role (Rahul, Priya) uses this. |
| `/operations/support` | `operations` | Operations id lacks `support_queue` but hits the same `SupportPageContent` component and the same `app/api/support/*` routes. This is the real test driver. |

**Operations id blocked actions (on Support and everywhere):** Tint Manager Remove-OBD + manual-entry; Operator pause/resume. All Support actions are available to Operations.

---

## 2. Workflow pipeline — current + future

`workflowStage` is a **plain `String` column** (NOT a Postgres enum). Adding stages = zero migration.

**Non-tint OBD** [LIVE]:
```
Import → pending_support → [Support Done] → closed
```

**Tint OBD (whole)** [LIVE]:
```
Import → pending_tint_assignment → tint_assigned → tinting_in_progress → pending_support → [Support Done] → closed
```

**Tint OBD (split)** [LIVE]:
```
Import → pending_tint_assignment → tinting_in_progress → pending_support → [Support Done] → closed
(split path skips tint_assigned — existing behaviour)
```

**Future (when Warehouse built)** [DEFERRED]:
```
… → pending_support → [Support Done] → support_done → Warehouse/Planning → closed
```
When Warehouse goes live: introduce the forward stage (likely `support_done`), flip Support Done from writing `closed` → `support_done`, and Warehouse reads `support_done`.

---

## 3. The `closed` parking-stage strategy

`closed` is the **real permanent final workflow stage** — not a trash drawer. It is the genuine finish line of the current pipeline. (The name may be renamed; it is a plain string, trivial to change.)

**During the current test/incremental phase, Support Done writes `closed` directly**, skipping the future `support_done` gate. This is deliberate: test orders never leak into unbuilt Planning or Warehouse screens.

**Build-one-screen-then-flip-forward pattern:** Build a screen → prove it works → flip the previous screen's "done" output forward to feed the new screen → test → flip again. Until Smart Flow says go, nothing flows past Support.

**`support_done` gate is NOT built — by design** [DEFERRED]. When Warehouse is built: repoint Support Done from `closed` → `support_done`; Warehouse reads `support_done` as its input. Ghost-stage counters and delivery-challan stage handling get addressed then.

**`closed` exclusion:** The closed-exclusion filter on the live Support query is **Support-only and inline** — not a shared helper. Planning uses an allowlist `["dispatch_confirmation"]`; Warehouse uses `= "dispatch_confirmation"` — neither can surface `closed`. Loosening Support's closed filter is safe; it cannot leak into other boards.

---

## 4. What's built — the gatekeeper pieces [LIVE]

All pieces below are live in production. Listed in build order.

### §4.1 Header tile fencing — today fence [LIVE]
**Route/file:** `app/api/support/slots/route.ts` — today-path `dispatchedCount`, `pendingCount`, `tintingCount`
**Rule:** ALL THREE live tiles — `dispatchedCount`, `pendingCount`, `tintingCount` — are fenced on `obdEmailDate ∈ ISTrange(today)`, each hard-requiring `arrivalSlotId = slot.id`. `doneCount` has no `arrivalSlotId` requirement but is still IST-today fenced.

**CORRECTION (2026-06-29):** this section previously claimed "pending and tinting tiles stay unfenced — carry-over is intentional." **That was never true in the code.** Both the today list query (`orders/route.ts`) and every per-slot count (`slots/route.ts`) have always been IST-date-fenced to today's arrivals only — there is no carry-over arm. The only genuinely unfenced pieces are `holdCount` (global, all dates) and the `section === "hold"` orders list — both intentionally cross-date overlays. Carry-over workload (yesterday's still-pending orders) is now surfaced as a deliberate, SEPARATE mechanism — see §4.17 "Pending from earlier" — not as an implicit unfenced tile.

**IST carried-over-badge fix (commit `3c0cd366`, 2026-07-11) [LIVE]:** `app/api/support/orders/route.ts` (~line 200) computed the "carried over" badge's day via `order.obdEmailDate?.toISOString().slice(0, 10)` — a **UTC** slice. Any order timed 00:00–05:29 IST reads one calendar day earlier in UTC, so it wrongly showed a "carried over" badge + inflated the overdue count. Fixed to `order.obdEmailDate.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })`, matching the board's own IST-day convention (`getISTDayRange()`, §5); the `?? dateStr` fallback was preserved. Landed alongside an unrelated Import-side fix to the same `obdEmailDate` field (`CLAUDE_IMPORT.md §12.1`) — same root theme (an IST/UTC or merged-vs-raw date mismatch), two different files, two different bugs.

**Header vs export count — verified consistent, not a bug (2026-06-29).** A suspected 12-order gap between the header tile sum and the "All" slot-view CSV export was investigated and confirmed to be a **ghost** — stale local-only test data (old orders with `arrivalSlotId = null` from before tint orders got stamped at import, which never reached main), not a live production issue. Explanation: the header total is a **sum of per-slot tiles**, each hard-requiring `arrivalSlotId = slot.id`; the export lists all of today's orders with no slot filter, so any order without a slot bucket would appear in the export but fall through the header sum. On live, every OBD now gets a real `arrivalSlotId` at import (tint included, per CLAUDE_IMPORT.md §12) so the two totals match. **No code fix was made for this specific gap** — it was closed by verification, not a patch. (Note in passing, not a fix: the header still sums per-slot buckets rather than counting the board directly, so it would silently under-count again if a future stage ever fell outside every bucket.)

### §4.2 Done group + collapse [LIVE]
**Route/file:** `app/api/support/orders/route.ts` (today path, section=slot); `components/support/support-orders-table.tsx`
**Rule:** The list query uses an `OR` — (a) non-closed stages with no date fence (carry-over preserved) OR (b) `workflowStage = "closed"` fenced to today's `obdEmailDate` range. Done rows render collapsed under a "N done ▸" bar; `T` key toggles all done groups; done rows are read-only except for undo buttons. Excluded from Select All + bulk.

**`isDone` definition (widened 2026-06-27):** `workflowStage in ["closed", "dispatched", "cancelled"] OR dispatchStatus = "hold"`. Cancelled rows land in the done group (never the active list). The done-group pill colour is driven by `footprintType` — green Dispatch / amber Hold / red Cancelled / grey Done (uncategorized fallback only).

### §4.3 Undo-dispatch route [LIVE]
**Route/file:** `app/api/support/orders/[id]/undo-dispatch/route.ts` (POST)
**Rule:** Guard — only if `workflowStage === "closed"` (else 409). Full clean reset: each non-cancelled split `dispatchStatus → null` + log; order `workflowStage → "pending_support"`, `dispatchStatus → null` + log (`fromStage: "closed"`, `toStage: "pending_support"`). Hard-coded target `pending_support` — no log-read, simpler, harmless even for ex-tint orders (splits untouched). Not available on history rows.

**Button guard:** The undo-dispatch button also checks `order.footprintType !== "cancel"` — without it, a cancelled row (`dispatchStatus null`, `!== "hold"` is true) would render the undo-DISPATCH button and fire a 409.

### §4.4 Mail-received time [LIVE]
**Route/file:** `components/support/support-orders-table.tsx`
**Rule:** OBD/DATE column and Age pill read `orderDateTime ?? obdEmailDate`. `orderDateTime` is overwritten by enrichment to equal `mo_orders.receivedAt`. If no mail match, falls back to SAP import time (never blank).

### §4.5 mailMatched flag + envelope [LIVE]
**Schema:** `orders.mailMatched Boolean @default(false)` (added v27.6 + backfilled 3,488 rows)
**Route/file:** `app/api/import/obd/route.ts` — `applyMailOrderEnrichment` sets `mailMatched: true` on match. Shared by all 3 import paths.
**Rule:** Envelope icon in the table gates on `order.mailMatched`. Cannot gate on `orderDateTime` (it is never null — set to SAP time at import). SAP-only rows show no envelope.

### §4.6 Earliest-first sort within each slot [LIVE]
**Route/file:** `components/support/support-page-content.tsx`
**Rule:** Frontend comparator: `(orderDateTime ?? obdEmailDate)` ASC, `obdNumber` ASC tiebreaker, null-times sink to bottom. Applied to both active and done slices independently; `[...active, ...done]` grouping preserved. Backend `ORDER_BY` (`priorityLevel ASC → obdEmailDate ASC → obdNumber ASC`) left as-is as a tie-break only — **this is NOT evidence Priority is Planning-exclusive; see the §6 correction.** Carry-overs (older `obdEmailDate`) float to top — correct.

### §4.7 dispatchStatus casing — normalized system-wide [LIVE]
**Route/file:** `app/api/import/obd/route.ts` — `applyMailOrderEnrichment`
**Rule:** `updateData.dispatchStatus = mailOrder.dispatchStatus.toLowerCase()` — one translation point at the crossing from mail-orders pipeline to orders table. Mail-orders pipeline stays capital (`"Dispatch"`, `"Hold"`). Orders table is canonical lowercase (`"dispatch"`, `"hold"`) everywhere. **Do not add `.toLowerCase()` calls anywhere else** — the crossing point is already handled.

### §4.8 Auto-done gatekeeper [LIVE]
**Route/file:** `app/api/import/obd/route.ts` — `applyMailOrderEnrichment`, after `updateMany`
**Rule:** If `updateData.dispatchStatus === "dispatch"`: fetch `pending_support` + `isRemoved:false` orders for that soNumber (with non-cancelled splits); per order — set splits `dispatchStatus: "dispatch"` + split log; order `workflowStage: "closed"`, `dispatchStatus: "dispatch"` + order log (`pending_support → closed`). Log actor: `changedById: 1` + note `"Auto-dispatched by enrichment"`.
**Critical guard:** Only fires on `workflowStage === "pending_support"`. Non-negotiable — prevents closing un-tinted or mid-tint orders (enrichment can run before tinting completes). Inherently excludes already-closed, cancelled, and removed (no double-log on re-enrichment).
**`"hold"` does NOT auto-done** — Hold is not a "done" decision in this sense; enriched holds show in the Hold tab and remain in pending. Hold auto-routing is a separate deferred build.

### §4.9 Hold lifecycle [LIVE]
**Route/files:**
- `app/api/support/orders/[id]/hold/route.ts` — single-order hold
- `app/api/support/bulk/route.ts` — bulk hold (per-order in the loop)
- `app/api/import/obd/route.ts` — enrichment hold (per-order loop after updateMany, since updateMany can't set per-row `obdEmailDate`)

**Rule:** Any code path that sets `dispatchStatus = "hold"` MUST ALSO stamp `heldAt = order.obdEmailDate ?? new Date()`. `heldAt` is the arrival date (not wall-clock) — anchors the hold footprint to the order's arrival day. When an action has multiple entry points, ALL must be updated together. Each of these three paths was missed once; the lesson is structural.

`isDone` is widened to: `workflowStage in ["closed", "dispatched", "cancelled"] OR dispatchStatus = "hold"` — held orders land in the done group on both live and history boards.

**Tint-stage guard (2026-06-29) [LIVE]:** `app/api/support/orders/[id]/hold/route.ts` now rejects (409) a hold on a tint order (`orderType === "tint"`) at `workflowStage in ["tint_assigned", "tinting_in_progress"]` — mid-mixing. All other cases pass: non-tint at any stage; tint at `pending_tint_assignment`, `tinting_done`, or `pending_support`. Effect: Support can only hold a tint order before mixing starts or after it finishes. Tint Manager's own hold route (`orders/[id]/status/route.ts`) was NOT touched this build — cross-screen sync deferred (see §7).

### §4.10 Release + dispatch-target [LIVE]
**Route/file:** `app/api/support/orders/[id]/release/route.ts` (single-order release only; no bulk-release API)
**Rule:** Requires `dispatchTargetDate` (YYYY-MM-DD string) + `dispatchWindowId` (Int) in the body. Date parsed with `Date.UTC(y, m-1, d)` to avoid IST/UTC day-shift. Closes the order (`workflowStage → "closed"`, `dispatchStatus → "dispatch"`) and stores the target date/window for the dispatch footprint.

**Dispatch windows:** `GET /api/support/dispatch-windows` returns active rows from `dispatch_slot_master` (4 seeded windows: 10:30 / 12:30 / 16:00 / 18:00). These are **dispatch** windows — separate from arrival slots in `slot_master` (Morning/Afternoon/Evening/Late Evening/Night). They will later drive auto-slot-assignment and downstream planning.

**Dispatch Slot picker:** `components/support/dispatch-slot-picker.tsx` — horizontal date-rail (upcoming days, today pre-selected) + calendar icon for far dates + 4 window pills. Portal-rendered popover (createPortal to body + getBoundingClientRect) to escape table overflow clipping. Value shape: `{ date: "YYYY-MM-DD", dispatchWindowId, windowTime }`. Reusable — serves hold release, single manual dispatch, and bulk dispatch. `forceOpenGen` number prop enables programmatic open from the Status menu (see §4.13).

**Hold tab slot-tab guard:** when in Hold view, slot tabs are greyed (`opacity-40 pointer-events-none`) and clicks are no-ops (`if (mainTab === "hold") return` in `onSegmentChange`). Prevents pending orders leaking into the hold list.

### §4.11 History — fully actionable [LIVE]
**Route/file:** `app/api/support/orders/route.ts` (history branch); `components/support/support-page-content.tsx`, `support-orders-table.tsx`
**Rule:** History shows ALL orders for the selected day. Slot grouping uses `arrivalSlotId` (not `slotId`). "All" view is date-fenced to `obdEmailDate = selected day` (no cross-day leakage). Past-day pending AND done rows are actionable — `isReadOnly = isDoneRow` only (not `isHistoryView || isDoneRow`). Done rows on history: undo is enabled; pending rows: dispatch / hold / cancel / slot / priority / bulk all work. Server routes were already date-agnostic; this was a client-only unlock.

**Two-footprint history query:** The history WHERE is a 3-arm OR for a viewed date D:
1. `obdEmailDate ∈ ISTrange(D)` → arrival footprint
2. `heldAt ∈ ISTrange(D)` → hold footprint (amber Hold on the order's arrival day)
3. `dispatchTargetDate ∈ DATErange(D)` AND `workflowStage = "closed"` → dispatch footprint (green Dispatch on the target day)

**`footprintType`** is computed server-side per row on **both today and history boards** (was history-only before 2026-06-27 — see §4.13 bug-fix note). Priority: **cancel > dispatch > hold > arrival**. The cancel arm sits at the TOP so a held-then-cancelled order shows ONCE as red Cancelled on its arrival day. Same OBD can appear on two days (arrival day as amber Hold; target day as green Dispatch). `dispatchTargetDate` is a `@db.Date` — compared with `Date.UTC(y,m-1,d)..+1`, same expression both sides, no day-shift.

**Done group pill colours** read `footprintType`: green "Dispatch" / amber "Hold" / red "Cancelled" / grey "Done" (uncategorized fallback — must NOT be painted green, see §4.13 landmine note).

**Header (today view only):** `{X}% done · {N} OBDs`, green pill. History header keeps pending/done/tinting/OBDs counts.

### §4.12 Cancel lifecycle [LIVE]
**Design (LOCKED 2026-06-27):** Cancel is the **third done-group colour** beside green Dispatch and amber Hold. A cancelled order is a decision taken, so it behaves like the other done actions — but is **terminal** (never flows downstream).

**Routes/files:**
- `app/api/support/orders/[id]/cancel/route.ts` — existing single-cancel (unchanged in this rework)
- `app/api/support/orders/[id]/undo-cancel/route.ts` — NEW, mirrors undo-dispatch
- `app/api/support/orders/route.ts` — list + history query arms + footprintType + isDone
- `app/api/support/slots/route.ts` — doneCount arms (today + history)
- `components/support/support-orders-table.tsx` — red pill + undo-cancel button

**Rules:**

1. **Footprint = arrival day.** A cancelled order shows in the done group on its `obdEmailDate`. Cancel has no target date — one day, one red pill.

2. **footprintType priority is `cancel > dispatch > hold > arrival`.** The `"cancel"` arm sits at the TOP of the footprintType check on BOTH today and history views. A held-then-cancelled order shows ONCE as red Cancelled on its arrival day — it does NOT show stale amber Hold and does NOT vanish.

3. **Counts toward % done.** Cancelled joins `doneCount` because "% done" = a decision was taken, not "successfully dispatched". `pendingCount` / `tintingCount` / `dispatchedCount` are untouched — cancel clears `dispatchStatus` to null and sits at `workflowStage="cancelled"`.

4. **`isDone` widened** to include `workflowStage="cancelled"` — cancelled rows land in the done group, never the active list.

5. **Undo-cancel** (`app/api/support/orders/[id]/undo-cancel/route.ts`):
   - Guard: only if `workflowStage === "cancelled"` (else 409) — mirrors undo-dispatch's `=== "closed"` guard.
   - Resets: each `status="cancelled"` split → `status="tinting_done"`, `dispatchStatus=null` + split log; order → `workflowStage="pending_support"`, `dispatchStatus=null` + order log.
   - Available on today AND history rows.
   - Sequential awaits, no `$transaction`, `force-dynamic` present.

6. **Split-restore value = `"tinting_done"`.** That is the only status a tint split carries when its parent reaches `pending_support`. Non-tint orders have ZERO splits (split creation is gated to `tint/manager/splits/create` only), so the restore loop is a no-op for them.

7. **Red pill styling**: `bg-red-50 border-red-200 text-red-600`, dot `bg-red-500`, label `"Cancelled"`. Reads `footprintType === "cancel"` only — NOT `currentDs` (cancel clears `dispatchStatus`, so `currentDs` is empty for cancelled rows).

8. **Button isolation.** Undo-dispatch button condition gained `&& order.footprintType !== "cancel"`. Undo-cancel button renders only on `footprintType === "cancel"` rows. Without the guard, a cancelled row (dispatchStatus null) would render the undo-DISPATCH button and fire a 409.

**Tint-stage guard (2026-06-29) [LIVE]:** `app/api/support/orders/[id]/cancel/route.ts` now rejects (409) a cancel on a tint order at `workflowStage in ["tint_assigned", "tinting_in_progress"]`, same condition as the hold guard above. Prevents Support from cancelling (and cascading split cancellation to) an order that's actively being mixed. Tint Manager's Remove-OBD (already hard-gated to `pending_tint_assignment`) was not touched — this is a Support-side-only addition.

**Still DEFERRED from cancel work:**
- **Structured reason column** [DEFERRED] — the cancel-dialog reasons are stored only in the log note string, not a queryable column. "Show me all credit-hold cancels" is still a raw DB query.
- **Bulk cancel** [DEFERRED] — `bulk/route.ts` still accepts `dispatch | hold` only. Cancel remains single-order with mandatory confirm dialog.
- **`heldAt` not cleared on cancel** [DEFERRED, cosmetic] — stale column on a held-then-cancelled order. No bug (board anchors cancel to arrival day via `obdEmailDate`, not `heldAt`), but a future restore-to-hold path would need to handle it.

### §4.13 Dispatch-slot decision — uniform single + bulk [LIVE]

**The model:** Two separate slot concepts, never competing.
- **Arrival slot** (Morning/Afternoon/Evening/Late Evening/Night) = WHEN the order arrived. Drives slot tabs + history grouping. Auto-assigned at import. The per-row arrival-slot dropdown was **REMOVED** from the table row (tab shows arrival; no manual re-slot — confirmed not a workflow).
- **Dispatch slot** (date + window, e.g. "29 Jun · 10:30") = the DECISION of when to ship. Writes `dispatchTargetDate` + `dispatchWindowId`. Mandatory for every manual dispatch (single + bulk) — no bare "dispatch now".

**Support row columns (today board):** `Status` (the decision pill) · `Dispatch Slot` (date+time) · `Priority`.

**Status column behaviour:**
- Pending rows: Status chooser → Dispatch / Hold / Cancel.
- Done rows: `footprintType` pill — green "Dispatch" / amber "Hold" / red "Cancelled" / grey "Done".
- Hold and Cancel → Dispatch Slot cell shows "—" (NOT a greyed/half-active picker).

**`dispatch/route.ts` updated:** Now requires + persists `dispatchTargetDate` + `dispatchWindowId` in the body (same fields as `release/route.ts`). Both routes write the same shape.

**`footprintType` bug fix (2026-06-27):** Before this build, `footprintType="dispatch"` and `"hold"` were computed only inside `else if (isHistoryView)` — on the today board they defaulted to `"arrival"` → grey "Done" pill. Fix: added a today-arm that reads `dispatchStatus` directly (`"dispatch"→dispatch`, `"hold"→hold`, else `arrival`). History arm + cancel check untouched. **footprintType is now computed on BOTH boards.**

### Single-row dispatch flow (the "2-action" model)
1. Click **Dispatch** in the Status menu → green "Dispatch" intent badge shows immediately + slot picker opens in the Dispatch Slot column.
2. The row **STAYS IN PENDING** (green badge, slot empty) until a slot is picked. Picking the slot is the commit.
3. On pick: optimistic "DD Mon · HH:MM" + small spinner in the Dispatch Slot cell; Status badge stays green throughout the save; row settles into done.
4. Choosing Hold / Cancel / Unset clears the green intent.
5. Click-away without picking: badge stays green, row stays pending; clicking Dispatch again reopens the picker (gen counter). No dead-end.
6. Refresh before committing: intent is client-only (`dispatchIntentIds` Set), resets to "—" (no DB half-state).

**Key engineering decisions:**
- **Dispatch intent is client-only** (`dispatchIntentIds`). A server stamp would leave orphaned `dispatchStatus="dispatch"` with no slot if the user walks away. Client-only = no DB half-state. The badge also reads `savingSlot` so it stays green through the save even after the intent is cleared.
- **`isDone` never reads `dispatchStatus="dispatch"`** — a green-intent pending row provably stays in pending. Only `workflowStage` closed/dispatched/cancelled or `dispatchStatus="hold"` moves to done.
- **No double-fire:** `handleSingleDispatch` synchronously removes the row from `selected`, clears `dispatchPickerTrigger`, and clears `dispatchIntentIds` BEFORE the API call. A row cannot be both immediately-dispatched and bulk-queued.
- **Grey "Done" fallback left grey.** It fires for genuinely-uncategorized done rows (auto-dispatched-at-arrival, ex-tint, other closed). Must NOT be painted green — that would mislabel auto-enriched orders.
- **`forceOpenGen` on DispatchSlotPicker:** clicking Dispatch in the Status menu increments a per-row gen counter → the column's ONE picker opens programmatically. Gen handles re-clicks after dismissal.

### Bulk bar (the "ghost row")
The sticky bottom bar appears when ≥1 row is selected. It mirrors a row: `[set status ▾]` + `[pick slot]` + Clear + Submit. Both popovers open upward.

- Status chooser: **Dispatch · Hold only** — NO bulk Cancel (stays single-row with reason dialog).
- Choose Dispatch → all selected rows **preview** green "Dispatch" (render-time derivation, not stored in `localEdits`); slot picker active; Submit DISABLED until a slot is picked.
- Choose Hold → all selected rows preview amber "Hold"; slot shows "—"; Submit ENABLED immediately.
- **Submit is the commit checkpoint** (unlike single-row which fires on pick) — bulk = higher stakes = one deliberate confirm. Fires existing `onBulkDispatch` (date+window) or `onBulkHold` for all selected IDs.
- **No per-row vs bulk contradiction:** choosing a `bulkStatus` clears each selected row's per-row `localEdits.ds`, preserving `pri` and `slot` edits. `bulkStatus` threads into `OrderRow` as an optional prop; `currentDs` reads `bulkStatus` when `isSelected && bulkStatus` (render-time only).
- After Submit: selection + bar reset.

**Bulk bar styling (Option A / Linear-Stripe look):**
- Elevation: hairline `1px rgba(17,24,39,0.06)` top border + shadow `0 -1px 1px rgba(17,24,39,0.04), 0 -8px 24px rgba(17,24,39,0.06)`. No teal top line.
- Bar `left-[72px]` — matches the content area's fixed `marginLeft: 72px` (nav expansion is overlay-only; 72px is safe in both collapsed/expanded states).
- Bar inner `minHeight: 56px` + 1px top border = 57px total, matching the nav bottom profile row height.
- Both idle triggers `border-gray-200` (#e5e7eb). Picked slot pill: `bg-green-50 border-green-200 text-green-700`, format "DD Mon · HH:MM", × clear.
- "STATUS" / "DISPATCH SLOT" text labels removed (triggers are self-describing).

**On the horizon — Task 2 (NOT built):**
Auto-assign dispatch slot at enrichment ("the brain") [NEXT]: auto-dispatched OBDs currently get no `dispatchTargetDate`/`dispatchWindowId`. Task 2 will assign a date+window automatically. Smart Flow noted multiple conditions may require one or more prep changes before the auto-assign logic is wired. This is interim-safe (no break, just inconsistent labels until built). **Distinct from §4.16 below** — §4.16 is a human pre-set on an individual tint row, not the automatic enrichment-time assignment described here.

### §4.14 Tint orders visible on Support board [LIVE]
**Shipped:** 2026-06-29 (commit `c901d6`).
**Route/file:** `app/api/support/orders/route.ts` (today + history `notIn` exclusions); `components/support/support-orders-table.tsx` (`getRowType`)

**Rule:** `pending_tint_assignment` was removed from the today-list and history `notIn` exclusions — tint orders now show on the Support board from the moment they arrive (arrival-slot stamped at import, same as any other order — see §4.1/CLAUDE_IMPORT.md §12), instead of only becoming visible at `pending_support`.

`getRowType()` now returns `"tinting"` for **all three** tint stages — `pending_tint_assignment`, `tint_assigned`, `tinting_in_progress` (previously only the latter two). Rows in any of these three stages are **read-only**: no checkbox, no Status menu, no Priority — only the Dispatch Slot column is live on them (see §4.16).

**Locked status pill labels** (purple, non-interactive), per stage:
| `workflowStage` | Pill label |
|---|---|
| `pending_tint_assignment` | "Tint · Pending" |
| `tint_assigned` | "Tint · Assigned" |
| `tinting_in_progress` | "Tint · Mixing" |

`slots/route.ts` today `tintingCount` now also includes `pending_tint_assignment` in its `workflowStage in [...]` filter, so the slot-tab badge counts these rows too.

### §4.15 Hold/cancel gating for tint orders [LIVE]
See §4.9 (hold) and §4.12 (cancel) for the exact guard condition. Summary: Support can hold or cancel a tint order only **before mixing starts** (`pending_tint_assignment`) or **after it finishes** (`tinting_done` / `pending_support`) — never mid-mix (`tint_assigned`, `tinting_in_progress`). Tint Manager's own hold/cancel-equivalent routes were not touched this build; cross-screen sync (TM hold/cancel reflecting on Support, and TM's missing `heldAt` stamp — see CLAUDE_TINT.md discovery) is deferred, see §7.

### §4.16 Pre-set dispatch slot on tint rows [LIVE]
**Shipped:** 2026-06-29 (commit `c901d6`).
**New route:** `app/api/support/orders/[id]/preset-slot/route.ts` (POST) — writes **only** `dispatchTargetDate` + `dispatchWindowId`; does **not** change `workflowStage` or `dispatchStatus` (the order stays in its current tint stage). Guarded to `orderType === "tint"` at the three tint stages (`pending_tint_assignment`, `tint_assigned`, `tinting_in_progress`). Accepts `null` for both fields to clear a pre-set slot. Sequential awaits (no `$transaction` — CORE §3 compliant).

**Why a new route, not the existing PATCH:** every existing route that writes `dispatchTargetDate`/`dispatchWindowId` (`dispatch/route.ts`, `release/route.ts`, `bulk/route.ts`) also unconditionally writes `workflowStage: "closed"` — inseparably coupled to closing. The generic PATCH route (`orders/[id]/route.ts`) has the `$transaction` landmine (§8) and no schema field for these columns. A standalone route was the only clean path.

**Table changes:** the Dispatch Slot column's `isPhysicallyDispatched || isTinting` hide-gate was narrowed — the picker now renders on tinting rows too (checkbox + Priority columns still hidden on tint rows, per §4.14). Its `onChange` calls a **new `onPresetSlot` handler**, NOT `onSingleDispatch` (which would fire the dispatch close-couple). **Display fix:** the pending-row picker previously had `value={null}` hardcoded, so a saved slot never displayed once an order reached `pending_support` — now derives its value from `order.dispatchTargetDate`/`dispatchWindowId`, mirroring the tinting-row picker.

**Auto-flip on completion:** `app/api/tint/operator/done/route.ts` and `split/done/route.ts` now branch on `hasPresetSlot = order.dispatchWindowId != null && order.dispatchTargetDate != null` at completion time:
- **TRUE** → completion writes `workflowStage: "closed"`, `dispatchStatus: "dispatch"` (+ `slotId`/`originalSlotId` as before). The order auto-flips to Dispatch using the pre-set slot and leaves the pending list entirely.
- **FALSE** → unchanged fallback: `workflowStage: "pending_support"` (operator decides the slot later, as today).

The whole-order fetch in `done/route.ts` is a no-`select` `findFirst`, so `dispatchWindowId`/`dispatchTargetDate` are already present on `order` — no query change needed. Same for the `split/done/route.ts` parent-bubble fetch.

**Landmine (split/done):** the parent-bubble advance (the step that flips the parent to `pending_support`/now `closed+dispatch`) runs **outside** the existing `$transaction` at line ~50, as it always has — the pre-set conditional was added there, consistent with the existing structure. If the parent-bubble update throws after the transaction commits: parent gets stuck at `tinting_in_progress` while all splits show `tinting_done`. **This is re-runnable, not a bug** — the bubble's entry condition re-triggers on the next completion attempt.

**Interactions:**
- The "dispatch intent is client-only" principle (§4.13) does NOT apply here — there is no `dispatchIntentIds` pending-intent state for a tint pre-set. It's a direct pick, saved immediately (deliberate: the order stays in its tint stage regardless of what's pre-set, so there's no "half-committed" state to protect against).
- **Cancel does not clear pre-set slot fields.** If an operator pre-sets a slot and the order is later cancelled, `cancel/route.ts` clears `dispatchStatus` but leaves `dispatchTargetDate`/`dispatchWindowId` untouched — stale but harmless (cancelled rows show the red pill, not the slot). See §8 landmine.
- `pending_tint_assignment` rows: the picker only needs to work on `tint_assigned` and `tinting_in_progress` (the stages visible in Support's today list per §4.14).

### §4.17 "Pending from earlier" badge + flat list [LIVE]
**Shipped:** 2026-06-29 (commit `c901d6`). Approved mockup: `docs/mockups/support/earlier-toggle.html`.

**Purpose:** surfaces unhandled pending orders from **past** days in a flat list, since the today board (§4.1) has always been strictly IST-today-fenced with no carry-over arm.

- **`slots/route.ts`:** new `earlierPendingCount` — `obdEmailDate < today IST start`, `workflowStage in ["pending_support", "tinting_done"]`, `dispatchStatus = null`, `isRemoved = false`, same hide-exclusion as other tiles. Strictly non-overlapping with the today tiles (today = `>= todayStart`) — **not** added to `todayTotal`, so no double-count.
- **`orders/route.ts`:** new `section === "earlier"` arm — same WHERE, oldest-arrival-first. Purely additive; no existing section changed.
- **`support-page-content.tsx`:** header badge "⚠ N pending from earlier", shown only when count > 0.
- **Toggle behaviour:** the badge is the **only** toggle — tap in → earlier list; tap again → back to today (lands on Morning). While in earlier view, slot tabs grey out AND are unclickable (reuses the existing Hold-tab disable pattern — `segmentsDisabled` + early-return in `onSegmentChange`). Banner stays the same soft cream in both states; only the right-side hint text flips ("tap to view" ⇄ "← back to today"). A solid loud-orange fill was tried and rejected.
- **Sort (currently undecided — see §7):** the earlier-pending list currently sorts priority-then-age (module-level `ORDER_BY`), not pure oldest-first arrival order. Pending a call on whether to force pure oldest-first.

### §4.18 Ship-to override — now editable via inline picker (2026-07-07) [LIVE]
**Shipped:** commits through `714251ef`. Discovery: `docs/prompts/drafts/code-discovery-2026-07-07-shipto-override.md`. Mirrors the existing `dispatchStatus` enrichment-copy pattern (§4.7).

**Before this build, ship-to on Support was display-only** — the board showed `order.customer?.customerName ?? order.shipToCustomerName` (resolved match, falling back to the raw SAP name when unmatched) with no write path anywhere under `app/api/support/orders/**`. Support staff can now **redirect an order's ship-to to a different real customer** from `delivery_point_master`, in addition to the existing automatic path from mail-order enrichment.

**Storage decision: id only** — a resolved FK (`orders.shipToOverrideCustomerId`, now in `CLAUDE_CORE.md` §7.3, schema v27.9; the orphaned-modal landmine is tracked in `CLAUDE_CORE.md` §13 and this file's §8), NOT a free-text or name/code snapshot. When the master customer's name is later corrected, the override reflects it automatically (the id is a live pointer; name/code are read through it). No denormalized copy to go stale.

**New route:** `GET /api/support/ship-to-search?q=...` — auth-gated (support/admin/operations), `force-dynamic`. Short-circuits to `[]` when `q` is missing or under 2 characters. Queries `delivery_point_master`: `contains` + `mode: "insensitive"` on `customerName`, `isActive: true`, `take: 8`, ordered by name. Returns `[{ id, customerName, area }]` — read-only, no writes.

**New component:** `components/support/ship-to-override-cell.tsx` — inline searchable picker, three states (visual spec: `CLAUDE_UI.md §58`):
- **Empty** (no override set) — faint "Set ship-to" affordance, click enters editing.
- **Editing** — autofocused input, ~250ms-debounced search (skipped under 2 chars), dropdown of ≤8 results (customer name + area). Click a result saves; Esc/blur-with-delay cancels without saving.
- **Set** — compact teal pill showing **customer name only** (no area, per approved refinement) + × to clear.

**PATCH extended:** `app/api/support/orders/[id]/route.ts` `patchSchema` gains `shipToOverrideCustomerId: z.number().int().positive().nullable().optional()` (number = set, `null` = clear, omitted = no change). New diff block mirrors the existing `dispatchStatus` block exactly — compares against current, sets `updateData.shipToOverrideCustomerId`, ALSO sets `updateData.shipToOverride = (value !== null)` to keep the legacy boolean flag in sync, and pushes an `order_status_logs` entry. No new `delivery_point_master` lookup on this route (the DB FK enforces validity). Rides the route's EXISTING `$transaction` (pre-existing landmine, §8 — not newly introduced).

**Board payload:** `ORDER_INCLUDE` in `orders/route.ts` now includes `shipToOverrideCustomer: { select: { id, customerName, area: { select: { name } } } }`, matching the existing `customer` include style. `handleShipToOverride` in `support-page-content.tsx` is structurally identical to `handleDispatch`, hitting the generic PATCH route with `{ shipToOverrideCustomerId }`.

**Important caveat — flag can be `true` with no id.** `shipToOverride = true` can still fire from mail-order enrichment with NO resolved id (free-text redirects like "as per challan", "Delivery on Challan copy" — see `CLAUDE_MAIL_ORDERS.md §6`). "Flag true" does NOT guarantee "id present." Any Support screen displaying the override must handle both: id set (show the resolved customer) vs flag-only (no clean id to show).

**Deferred/parked (not built this session):**
- Ship-to override on other screens (Planning, Warehouse, challan, etc.) — one screen at a time, later.
- Backfill of historical overrides — old `mo_orders` rows only carry the redirect as `[→ Name (Code)]` text in `deliveryRemarks`; recovering the id needs a parse-then-resolve one-off script. Not needed to proceed.
- 2b live test: confirming a real post-deploy mail order with a resolved redirect actually flows `mo_orders.shipToOverrideCustomerId → orders.shipToOverrideCustomerId` via enrichment — see `CLAUDE_MAIL_ORDERS.md §6`.

### §4.19 Column set — new columns (2026-07-07) + full rework (2026-07-09) [LIVE]

**CORRECTION:** this section previously claimed the board went 9→11 columns and listed no AGE column at all. That was stale/wrong — AGE has always been a column; the old "11" count simply omitted it. Real timeline:

- **2026-07-07:** Ship-To Override (§4.18), Material Type, and Article added as 3 new display columns → board went **9 → 12 columns** (including the pre-existing AGE column the old doc silently dropped). MATERIAL TYPE ← `orders.materialType` (`String?`, e.g. `"FG"`), written at import (`summary.materialType` in `app/api/import/obd/route.ts`); was already riding down via `include`, just not typed on `SupportOrder` until this build. ARTICLE ← `orders.querySnapshot.articleTag` (via the 1:1 `import_obd_query_summary` relation), the human-readable pack-breakdown tag chosen over the numeric `totalArticle` count.
- **2026-07-09 (this rework):** reordered + renamed + folded Material Type into the Vol cell → board is now **11 columns + checkbox** (net -1: Material Type stopped being its own column; nothing else removed).

**Locked column sequence (11 + checkbox), current:**

| # | Column | Header label | Note |
|---|---|---|---|
| 1 | checkbox | — | |
| 2 | OBD | `OBD` | shortened from "OBD / DATE" |
| 3 | CUSTOMER | `CUSTOMER` | |
| 4 | SHIP-TO | `SHIP-TO` | shortened from "SHIP-TO OVERRIDE" (§4.18) |
| 5 | AGE | `AGE` | **moved up** from position 9 |
| 6 | ROUTE | `ROUTE` | shortened from "ROUTE / TYPE"; stays merged, not split |
| 7 | VOL | `VOL` | shortened from "VOL (L)"; **`materialType` now renders as a muted sub-line inside this cell** |
| 8 | ARTICLE | `ARTICLE` | |
| 9 | STATUS | `STATUS` | |
| 10 | SLOT | `SLOT` | shortened from "DISPATCH SLOT" |
| 11 | PRIORITY | `PRIORITY` | |

MATERIAL TYPE is no longer its own column — folded into the Vol cell (rule below). Nothing was removed from the board; nothing was renamed at the data level. Header labels are display strings only.

**Vol cell rule:** renders `orders.materialType` **raw**, whatever the value — no mapping, no per-value styling, no hardcoded "what counts as paint" list. `null` → `—`. Gift items (typically 500/1000 volume) carry a real volume that is **excluded from load calculation** downstream — the Vol cell stacks volume over material type so the two can never be read apart. This does **not** mean the exclusion is actually enforced everywhere yet — see §7 parked item. `materialType` nulls are expected on genuinely-typeless orders, not a bug.

**Alignment (main board):** checkbox centre · AGE centre (it's a pill) · VOL right — both stacked lines + the header label (Support's Vol is a bare number compared across rows for load planning, digits must stack by place value; this deliberately differs from Tint Manager, which left-aligns its `"60 L"`-style volume strings) · everything else left.

### Column sizing — the percentage-GRID rule (reusable — read before touching table widths again)

**Structural fact:** the Support tables are CSS Grid, not `<table>` — the header and every body row are **separate, independent grid instances**, each applying the same shared constant via `style={GRID}`. There is no shared column model between them (a real `<table>` gives that for free; Grid does not).

Four sizing schemes were tried on this board; three failed:

| Scheme | Result | Why |
|---|---|---|
| `fr` everywhere | **Failed** | `fr` distributes *leftover* space, which depends on content. A long customer name widened that row's tracks and shifted every column right, in that row only. |
| `minmax(0, Nfr)` | Partial | Stops one long value inflating its own track. Does not fix pooled surplus — the gap just moves. |
| `max-content` | **Failed hard** | Sizes each track to its OWN instance's content. Two rows with different Slot content ("pick slot" vs a filled pill) landed that column 66.6px apart; Priority drifted 30.2px. Structurally impossible with per-row grids. |
| Fixed `px` | Worked, ugly | Content-blind so alignment held, but values were guessed and left dead channels at wide viewports. |
| **Percentages** | **Correct** | Content-blind AND self-balancing — resolves against the container width, never cell content, so header and every row (same container width) land identical pixel widths. |

This is the same mechanism Tint Manager gets natively via `<table>` + `table-layout:fixed` + `<colgroup>` percentages (`CLAUDE_UI.md` §27/§33) — the browser's table algorithm synchronises columns for free. Support can't get that guarantee without the `<table>` rewrite already rejected as scope creep (§7) — **but doesn't need it**; percentages give the same content-blindness on Grid.

**Locked GRID constants** (both live in `components/support/shared/table-cells.tsx` so header and body can't drift apart):

```
SUPPORT_GRID_COLUMNS       "3% 9% 19% 11% 5% 9% 5% 9% 9% 13% 8%"     (main board, sums to 100)
SUPPORT_HOLD_GRID_COLUMNS  "3% 9% 20% 11% 6% 9% 5% 9% 13% 7% 8%"     (hold tab, sums to 100)
```

**Rules:** each GRID is ONE shared constant, header and body both read it — change once. Any future column change must keep the percentages summing to 100. Do NOT reintroduce `fr`, `max-content`, or `auto`. Inter-column spacing comes from **per-cell padding** (`CLAUDE_UI.md` §27, 14px L/R), not the grid `gap` (gap is `0`).

### Article pack abbreviation (render-time only)

`articleTag` (from `import_obd_query_summary`, via `orders.querySnapshot`) is a comma-separated list of `"{integer} {word}"` groups, abbreviated **at render time only** — stored data and the import pipeline are untouched.

**Discovery (live DB, 1,553 non-null rows):** Drum 991 · Carton 743 · Tin 368 · **Bag 34**. A hardcoded three-word map would have rendered blank on the 34 Bag rows, silently — always discover the real word set before hardcoding a map.

**Map:** `Drum→D` · `Carton→C` · `Tin→T` · `Bag→B`. **Join:** `" · "` (matches the Slot separator). **Order:** preserved from the stored string, never sorted. Max 4 groups on one row; longest observed `"23 Drum, 20 Bag, 5 Carton, 8 Tin"` (32 chars).

**Fallbacks — all three non-negotiable:**
1. A word not in the map renders its **full original word** — never blank, never a guessed letter.
2. A group not matching `/^(\d+)\s+(\S.*)$/` → returns the **raw stored string verbatim**, never a partially-formatted value.
3. `articleTag === null` → `"—"` (pre-existing, unchanged).

`title` tooltip carries the full original string. Helper `formatArticleTag`, shared module (`components/support/shared/table-cells.tsx`) — pure, total, no throws.

### §4.20 Hold tab — rebuilt as its own component (2026-07-09) [LIVE]

**Sibling, not reuse — and why.** Hold is now its own component, `components/support/support-hold-table.tsx`, extracted from `support-page-content.tsx` (previously inline JSX). **Deliberately NOT merged** into `support-orders-table.tsx`. The dispatch-slot picker has a genuinely different contract on each board: on the **main board**, picking a slot **commits immediately** (`onSingleDispatch`); on **Hold**, picking a slot **stages** into a local `holdSlots` Map and only writes on an explicit **Release** click. Sharing one component around two contracts is how a held order gets silently auto-dispatched the instant a slot is picked — a behavioural regression, not a visual one. (Forcing Hold through the main `OrderRow` would need ~7 guard branches, including two full cell-content swaps and a different `onChange` contract on the Slot cell, layered onto a component already carrying five pieces of main-board-only state.)

**Hold columns (11 + checkbox):** `OBD · CUSTOMER · SHIP-TO · HOLD SINCE · ROUTE · VOL · ARTICLE · SLOT · PRIORITY · ACTION`. Swaps vs the main board:
- **STATUS dropped** — every Hold row's status is `hold`; a column where every cell is identical carries zero information.
- **AGE → HOLD SINCE** — `AGE` counts from arrival, `HOLD SINCE` counts from `heldAt`. The release decision is driven by time-since-held, not time-since-arrival; showing both invites reading the wrong one.
- **ACTION moved to last** — actions belong at the row's trailing edge, after the data that informs them.
- **SHIP-TO, VOL, ARTICLE, PRIORITY present** — these are the inputs that shape a release decision; an order can sit on hold for days while its delivery point changes.

Nine of eleven columns sit in the same position/meaning as the main board — muscle memory preserved.

**⚠️ Behaviour change — VOL metric corrected, not just restyled.** Hold's VOL column now reads **`orders.importVolume` (LITRES)**. It previously read `querySnapshot.totalUnitQty` (a unit **COUNT**) — a different metric entirely. The number on screen has changed meaning for anyone used to the old column.

**Alignment (Hold):** checkbox centre · HOLD SINCE centre (pill) · VOL right (both lines + header) · ACTION right (trailing buttons anchor to the row's trailing edge) · everything else left.

**Other Hold changes:**
- **`Overdue Nd` badge removed** from Hold's OBD cell (duplicated HOLD SINCE with a slightly different number). Main board **keeps** its badge — it has no Hold Since column.
- **Group by SMU / Route added**, mirroring the main board.
- **Bulk bar offset fixed:** `left-14` → `left-[72px]` (the sidebar is 72px; the bar was tucking 16px underneath it — a real bug, not cosmetic).
- **`heldAt` null fallback added:** `null → "—"`, grey pill — necessary for legacy rows with no `heldAt` stamp (the Sree Milap test row, §7).
- **Customer badges suppressed on Hold** (`showBadges={false}`) — Hold has no wired Missing-resolution dialog to back a click; `onMissing` is a real no-op.

**Held tint orders — "Hold means hold."** A held tint order renders as an **ordinary held row**: no purple pill, no locked cells, no `getRowType()` call anywhere in the Hold table. Release works on it normally. Rationale: §4.9 already forbids holding a mid-mix order (`tint_assigned`, `tinting_in_progress` rejected 409) — so anything sitting on Hold is either pre-mix or post-mix, and safe to release.

**No backend work needed.** `ORDER_INCLUDE` in `app/api/support/orders/route.ts` is one shared const used by the single `findMany` regardless of section; `section === "hold"` only narrows the `where` clause. Every field the new layout needs was already in the hold arm's payload. **Double-edged:** because `ORDER_INCLUDE` has no section-specific carve-out, any future narrowing of it for a main-board reason silently changes Hold's payload too.

**Shared module** — `components/support/shared/table-cells.tsx` (new), imported by BOTH boards so they can't drift: `SUPPORT_GRID_COLUMNS`/`SUPPORT_HOLD_GRID_COLUMNS`, `ARTICLE_WORD_ABBR` + `formatArticleTag`, `getPriLabel`, `VolCell`, `CustomerCell` (`showBadges` prop), `groupOrders`/`getSmuGroup`/`GroupBy`/`OrderGroup`. **Deliberately NOT extracted:** the group-header bar JSX — duplicated in the Hold table on top of the shared `groupOrders`, so the grouping *behaviour* can't drift even though the markup is written twice (refactoring the heavily-tested main-board version was out of scope). `ShipToOverrideCell` and `DispatchSlotPicker` were already standalone; both boards import them directly, neither modified.

**Known parity quirk (not a Hold regression):** the group-header row is a plain flex row, not a grid row, so its checkbox doesn't land on the same x as a data row's checkbox (96px vs 106px). Copied verbatim from the main board's existing behaviour — exact parity with an intentional existing design. Changing it means changing both boards.

**Landmine — inherited, not fixed:** Hold's new SHIP-TO column writes through `app/api/support/orders/[id]/route.ts`, which rides the existing `prisma.$transaction` (§8 landmine). Pre-existing; a second UI surface now hits the same fragile route.

### §4.21 Filter rework + merged search (2026-07-09) [LIVE]

*(Numbering note: this content was originally drafted under "§4.18" — that number is already Ship-To Override, §4.18 above. §4.21 is the next genuinely free number as of this consolidation.)*

**What the Filter was doing before this build (kept for the record):** defined in `support-page-content.tsx:484-488`, rendered by `UniversalHeader`.

| Group | Options offered | Reality |
|---|---|---|
| View | Hold Only | Worked — flipped `mainTab`, real re-fetch with `section=hold`. |
| Status | Pending / Dispatch / Dispatched | Worked for a single selection only; 2+ silently collapsed to "all". |
| Delivery Type | Local / UPC / IGT | **Dead** — wrote to `headerFilters.deliveryType`, nothing ever read it. |
| Priority | — | **Ghost** — state key existed, no UI ever offered it. |

All filtering was client-side over the already-loaded list; `fetchOrders` only ever sent `date`/`section`/`slotId`. **The bug that killed trust:** the date-change effect force-reset `mainTab` from `hold`→`all` on a history date but never cleared `headerFilters.view` — the Filter pill kept showing "Hold Only · 1" while the board silently rendered everything.

**What the Filter is now — four groups, real multi-select:**
1. **View** — single toggle: Hold Only. Still the **only route to the Hold tab** (the tabs row shows arrival slots, not Hold) — do not remove it.
2. **SMU** — multi-select, options derived **live from the loaded orders** (distinct, sorted) — never hardcode this list.
3. **Delivery Type** — multi-select: Local / UPC / IGT. Now actually wired.
4. **Priority** — multi-select, labels from `getPriLabel`. Now has UI.

**Status group deleted** — Status is already a visible column with three values; the slot tabs + Hold tab already do the real splitting.

Semantics: groups **AND** together, options within a group **OR** together. Filter pill badge = total selected across all four groups. "Clear all" inside the popover, visible only when badge > 0. SMU / Delivery Type / Priority also narrow the **Hold tab** and the **"N pending from earlier"** carry-over list (§4.17). Filtering runs at the **page level, before `groupOrders`**, so group-header counts always match visible rows. **State still resets on navigation — deliberate, do not add URL/localStorage persistence.**

**Desync bug fixed:** the date-change effect now does `setMainTab("all")` AND `setHeaderFilters(prev => ({...prev, view: []}))` in the same beat — one source of truth.

**Search — one box, wider reach.** There were two search boxes (header, with `/` shortcut; a toolbar box beside Export) — NOT true duplicates (the toolbar one matched route name, the header one didn't; the header one didn't apply to Hold at all). **The toolbar search box is deleted.** The header search is now a strict superset, matching (case-insensitive, substring, trimmed, null-guarded): `obdNumber`, `customer.customerName`, `shipToCustomerName`, `shipToCustomerId` (the code visible on screen), `customer.customerCode` (the customer-master code, NOT shown on screen), `customer.area.primaryRoute.name`.

**The two-code trap.** The board displays `shipToCustomerId` (a scalar on `orders`); the customer master has its own separate `customerCode` on `delivery_point_master`. Usually the same value, sometimes not — that divergence is the entire reason ship-to override exists (§4.18). Search matches BOTH, so a code copied off the screen and a code copied out of SAP both land. Placeholder: `Search OBD, customer, code, route...`. `/` shortcut kept. Header search now applies to the **Hold tab** too (`SupportHoldTable` receives `displayOrders`, not raw `orders`).

Toolbar after the change: **Select All** (left) · **Group by + Export** (right) — nothing else. Every consumer of the old toolbar search state now reads the page-level filtered+searched list: Select All/`selectableIds`, Group by→`groups`, Export CSV rows, the Done section, and the bulk bar's `selectedOrders`/qty/customer-count. **Export exports exactly what is visible.**

**API change (the only one):** `app/api/support/orders/route.ts` — one additive line: `customerCode: true` added to `ORDER_INCLUDE.customer.select`. Strictly additive — no query params, where-clause arms, or response semantics changed. Filtering remains 100% client-side; the field simply now reaches the client so the search matcher can see it.

**Type correction (same session):** `orders.shipToCustomerId` is `String?` in the schema — the `SupportOrder` interface in `support-orders-table.tsx` had typed it non-null; widened, render made null-safe. `orders.smu` is also `String?` (matches the existing `order.smu || "Unknown SMU"` fallback in `getSmuGroup()`).

**Things not to undo:**
- The percentage GRID sizing model (§4.19) was not touched this session and must not be.
- Filtering stays client-side — server-side filtering is an API contract change needing explicit go-ahead.
- `ship-to-override-cell.tsx` and `dispatch-slot-picker.tsx` untouched.
- The **View → Hold Only** filter group is load-bearing — removing it strands the Hold tab.
- SMU options are derived at runtime — never hardcode.

**Open:** whether the Hold tab's previously-absent search was deliberate or an oversight is unknown — it searches now either way. Whether a Priority filter was ever wired and stripped, or never built, is unconfirmed (vestigial state suggests the former).

---

## 5. Data sourcing + access

### IST fences
**`getISTDayRange(dateStr?)`** in `lib/dates.ts` — IST midnight-to-midnight as UTC half-open interval. Used by: dispatched-counter in `slots/route.ts`, today-closed OR-arm in `orders/route.ts`, history arrival-footprint arm, today "All" view fence. Mirrors the private helper in `app/api/mail-orders/route.ts` (which fences on `receivedAt`).

### mailMatched vs orderDateTime
`orderDateTime` is **never null** — set to SAP import time at import, only *overwritten* (not cleared) by enrichment on a match. Cannot use truthiness to detect source. Always gate the envelope on `order.mailMatched` (the dedicated boolean).

### dispatchStatus crossing-point
Capital (`"Dispatch"`, `"Hold"`) lives in `mo_orders` (mail-orders pipeline). Lowercase (`"dispatch"`, `"hold"`) is canonical in `orders`. The single translation: `enrichment.dispatchStatus.toLowerCase()` in `app/api/import/obd/route.ts`. Backfill of 3,136 rows (2,980 + 156) done 2026-06-23. Distribution after: `dispatch` 3,380, `null` 1,864, `hold` 161, zero capital.

### heldAt semantics
`heldAt` is stamped as `order.obdEmailDate ?? new Date()`. It is the **arrival date**, not the wall-clock moment of clicking Hold. The audit log (`order_status_logs.createdAt`) still records real wall-clock time for the true timeline. The board uses `heldAt` only for footprint placement.

### system-action log convention
`changedById: 1` + descriptive note. Matches `lib/day-boundary.ts`, `lib/slot-cascade.ts`. No system-user row in the DB; `changedById: 1` (admin id) is the established convention.

### closed-exclusion filter
Inline in `app/api/support/orders/route.ts` — not a shared helper. Planning and Warehouse use allowlist patterns that can never surface `closed`. Safe to widen the Support filter without cross-module leakage.

### arrivalSlotId
`orders.arrivalSlotId Int?` — added alongside `slotId`. History slot-grouping uses `arrivalSlotId`. `slotId` stays as the current/working slot. `ORDER_INCLUDE` in `orders/route.ts` includes `arrivalSlot { name }` for history.

### Same-day collapse rule
If an order is held AND released on the **same calendar day**, it shows ONCE as green Dispatch (dispatch wins). Priority: **cancel > dispatch > hold > arrival**. Computed server-side via `footprintType`.

---

## 6. Key learnings / principles

- **Carry-over is NOT passive — correction (2026-06-29).** Every today-path query (list + all per-slot counts) is IST-date-fenced with no carry-over arm; this was true even before the tint-in-Support build, but §4.1/§6 previously documented the opposite. Yesterday's still-pending orders do NOT appear on today's board by default — they surface only through the dedicated "pending from earlier" badge + flat list (§4.17), a deliberate separate mechanism, not an implicit unfenced tile.
- **Local DB and live DB are separate.** A slot pre-set on a LOCAL dev DB while the operator marks the order Done on the LIVE app will look like a broken auto-dispatch (completion reads live's DB, finds no slot, drops to `pending_support`) but is actually two different databases. A set-slot and its mark-done must happen on the SAME app/DB.
- **Reasoning about runtime ≠ runtime.** Two static code-reads can both conclude a route "should work"; only an instrumented log + a clean same-DB test proves it. When DB state and code logic seem to contradict, instrument and run — don't keep re-reading.
- **Prisma P2024 pool timeout risk on local** (`connection_limit:1`) — slow local→Supabase queries can stack and starve the single connection (observed on `slots/route.ts` counts). Local-only infra symptom, not a code bug; parked for a separate look.
- **`closed` = parking stage during incremental build.** Each new downstream screen gets fed by flipping the prior screen's done output forward once ready. Test orders never leak.
- **Auto-done guard = `pending_support` stage ONLY.** Non-negotiable. Enrichment can run before tinting completes. The guard prevents closing un-tinted / mid-tint orders. Without it, a tint OBD with `dispatchStatus="dispatch"` set by enrichment would auto-close, skipping paint mixing entirely.
- **CORRECTED 2026-07-09 — Priority IS a Support concern.** The earlier claim here ("Priority is NOT a Support concern — Planning owns it") was wrong; Smart Flow confirmed Priority stays on the board and now has a real multi-select filter group (§4.21). The backend `ORDER_BY` tie-break (§4.6) is unrelated — it's a stable-sort detail, not evidence Priority is Planning-only. Support's primary sort is still earliest → latest (received time); Priority is a filter/display concern layered on top, not a sort override.
- **`orderDateTime` is never null.** Do not use it as a "came from mail" signal. Use `mailMatched`.
- **dispatchStatus is canonical lowercase on the orders side.** Translate once at enrichment. No `.toLowerCase()` anywhere else.
- **heldAt = arrival date.** Not wall-clock. Board placement depends on it.
- **When an action has multiple entry points, ALL must be updated together.** Bulk and import paths have each been missed once during this build. Check single / bulk / enrichment whenever adding any new per-order stamping.
- **Normal orders are approximate in history.** History shows the CURRENT dispatchStatus on the arrival day — not a frozen snapshot. Only held orders are historically precise (via `heldAt`/`dispatchTargetDate`). Frozen snapshots would require full log-replay — not built.
- **`dispatchStatus` sticky-note root cause is unresolved.** dispatchStatus is not cleared when `workflowStage` advances to `closed`/`dispatched` — contradictory state persists. Three workaround patches applied so far. Real fix: clear/normalize dispatchStatus at the dispatch transition. Has its own ROADMAP entry.
- **Dispatch intent is client-only.** Never stamp the server with `dispatchStatus="dispatch"` without a slot. Client-only intent = no DB half-state if user walks away.
- **`isDone` never reads `dispatchStatus="dispatch"`.** A green-intent pending row stays in pending. Only `workflowStage` or `dispatchStatus="hold"` drives isDone.
- **footprintType priority = cancel > dispatch > hold > arrival.** Computed on BOTH boards. A held-then-cancelled order shows ONCE as red, on its arrival day. Grey "Done" fallback must stay grey — it covers auto-enriched/uncategorized done rows.
- **No double-fire on bulk.** Clear `selected`, `dispatchPickerTrigger`, and `dispatchIntentIds` synchronously before the API call. A row cannot be both immediately-dispatched and bulk-queued.

---

## 7. Open items + NEXT discovery agenda

### Bugs / cleanup [NEXT]
- **dispatchStatus sticky-note root cause** [NEXT] — dispatchStatus not cleared at the dispatch transition. State says `"dispatch"/"hold"` while stage says `"closed"`. Has been patched 3 times (double-count, pill logic, footprint logic). Needs a deliberate fix (ROADMAP). Do not patch again.
- **`$transaction` in 2 Support PATCH routes** [NEXT] — `app/api/support/orders/[id]/route.ts:173` and `app/api/support/splits/[id]/route.ts:100`. Violates CORE §3 (pooler-timeout risk). Refactor in a dedicated session.
- **Picker cosmetics** [DEFERRED] — date pills feel heavy; calendar icon gets cut off on narrow screens. Reduce to ~5 visible dates, lighten pills.
- **Sree Milap test row (9107904128)** [DEFERRED] — `heldAt = null` from before the fix; shows wrong pill on its hold day. Test artifact — do not SQL-repair.
- **"0 line items" panel display bug for split OBDs** [DEFERRED] — detail panel shows 0 line items though data exists (1 raw, 2 split lines). Data is fine; fetch/display is wrong. Low priority.

### Support view build [NEXT]
- **Board-slot rule (06-24 design) — PARTIALLY SUPERSEDED (2026-06-29)** — the carry-over/dual-date portion of this locked spec (dual-date card, "⚠ rec. {date} · {N}d" flag) was superseded by a different design: the "pending from earlier" badge + flat list (§4.17), not a dual-date card on each row. The 5-slot structure (incl. Late Evening) and the `≤` vs `<` cutoff fix described in this spec are unrelated to carry-over and already exist in code (`lib/slots/slot-ruler.ts` — confirmed by discovery, not built as part of this item). See `docs/prompts/drafts/code-update-2026-06-24-support-board-slot-rule.md` for the original full spec (kept for history; carry-over section is stale).
- **Hold auto-route** [NEXT] — enriched holds currently appear in the pending list AND the Hold tab (Hold is an overlay, doesn't remove from pending). Goal: enriched holds auto-route to the Hold tab with zero human touch, mirroring auto-done but for hold. Separate build.
- **Auto-assign dispatch slot at enrichment ("the brain")** [NEXT] — Task 2 of the dispatch-slot work. Auto-dispatched OBDs get no `dispatchTargetDate`/`dispatchWindowId` today. Multiple conditions; may need prep changes first. See §4.13 "On the horizon" (distinct from the tint-row pre-set at §4.16, which is a human action).
- **CSS Grid → `<table>` §27 cleanup** [DEFERRED] — the Support table uses CSS Grid, not `<table>`. Agent proposed a full rewrite (UI §27); REJECTED as scope creep. Own session when ready.
- **Mail indicator placement polish** [DEFERRED] — ship a clearer indicator than the current trailing gray envelope. Leading gray envelope (Option A) is the recommended safe choice. Teal options ruled out (collision with row-selection teal edge). Mockups: `docs/mockups/support/mail-time-symbol.html`, `docs/mockups/support/mail-indicator-placement.html`, `docs/mockups/support/mail-indicator-options-EFGH.html`.
- **Mail punched time (Piece 2)** [DEFERRED] — store `mo_orders.punchedAt` on the order (new column), decide display placement (detail panel vs tooltip vs separate column). Piece 1 (received time) is live; Piece 2 needs new column + enrichment copy + display.

### Tint-in-Support follow-ups [NEXT / DEFERRED] (from the 2026-06-29 build)
- **Tint Manager cross-screen sync** [NEXT] — TM's own hold/cancel-equivalent actions don't reflect the new Support-side tint gating (§4.15), and TM's hold route never stamps `heldAt` (history hold-footprint silently fails for TM-held orders). Agreed sequence: build after Support is confirmed solid.
- **Split tint deeper edge cases** [DEFERRED] — the parent-bubble pre-set/auto-flip conditional (§4.16) covers the common path; deeper split-specific edge cases were not explored this session.
- **"Pending from earlier" sort order (A7, open decision)** — currently priority-then-age, not pure oldest-first arrival. Needs a call, not yet decided either way — see §4.17.

### Cancel [DEFERRED]
- **Structured reason column** [DEFERRED] — cancel-dialog reasons stored only in log note string, not a queryable column. "Show me all credit-hold cancels" = raw DB query. Reason column parked.
- **Bulk cancel** [DEFERRED] — `bulk/route.ts` accepts `dispatch | hold` only. Cancel remains single-order with mandatory confirm dialog.
- **`heldAt` not cleared on cancel** [DEFERRED, cosmetic] — stale column on held-then-cancelled order. No bug (board anchors cancel to arrival day via `obdEmailDate`), but a future restore-to-hold path would need to handle it.

### Column/Hold rework follow-ups [DEFERRED] (from the 2026-07-09 build)
- **Gift-item volume exclusion is documented (§4.19) but not enforced downstream** [DEFERRED] — if `querySnapshot.totalVolume`, the header tiles, or a CSV export sum ALL volume regardless of `materialType`, that's a real number problem, not a display one. Deliberately parked — "streamline when we build." Needs its own session.
- **`lib/dispatch/dispatch-engine.ts` was dirty/uncommitted throughout this build** [NOTE] — unrelated in-progress auto-assign work, never staged, still uncommitted as of this session.
- **Ship-To at 11% and Status at 9% (main board GRID) hold small content, cosmetically generous** [NOTE] — left alone; widths have been changed enough this cycle.

### Dispatch / downstream
- **"Assign date+slot to any order"** [LIVE — manual case, §4.13] — manual dispatch (single + bulk) now requires and stores `dispatchTargetDate` + `dispatchWindowId`. Auto-dispatch at enrichment (the "brain") is [NEXT] above.
- **Lock done-row edits on history** [DEFERRED] — currently both pending and done are editable on past days (intentional for testing + downstream creation). One-line gate when ready.

### Warehouse phase [DEFERRED]
- **`support_done` gate** — build when Warehouse goes live. Repoint Support Done from `closed` → `support_done`.
- **Ghost-stage counters in `operations/summary`** — warehouse-unassigned (references dead stage) + closedSlot alert (references dead stages). Deferred to Warehouse go-live.

### Not yet click-tested
- Cancelled / tinting / physically-dispatched rows on past-day history are non-interactive per logic (guards independent of `isHistoryView`) but not click-verified. Verify when convenient.
- Auto-enriched orders on the today board: `footprintType` is now `"dispatch"` (was `"arrival"` before the bug fix). Verify green Dispatch pill shows correctly; verify grey "Done" fallback still fires for genuinely-uncategorized rows.

---

## 8. Landmines [LANDMINE]

Existing in code — do NOT "fix" without explicit instruction.

- **`prisma.$transaction` in 2 Support PATCH routes** [LANDMINE] — `app/api/support/orders/[id]/route.ts:173` and `app/api/support/splits/[id]/route.ts:100`. Violates CORE §3 (pooler-timeout risk on Vercel + Supabase). Low traffic, but refactor needed in a dedicated session.
- **`dispatch_change_queue` only written by inline PATCH** [LANDMINE] — the Hold button and bulk-hold do NOT write to `dispatch_change_queue`. Most holds are unlogged in that queue. Pre-existing gap.
- **Hold tab silently switches off in history mode** [LANDMINE] — no message shown to the user when Hold tab is unavailable in history view.
- **Next Day Morning slot (isNextDay)** [LANDMINE] — counts in header tiles but is not clickable as a segment. CORE §10: depot-wide boards show 4 slots, filtering out Next Day Morning. Do not wire it as clickable without explicit instruction.
- **`dispatchStatus` sticky-note root cause** [LANDMINE] — dispatchStatus persists its last value even after `workflowStage` reaches `closed`/`dispatched`. Three patches have worked around this; the contradictory state is still in the DB for many orders. See §6 and §7 open items.
- **`lib/slot-cascade.ts`, `lib/day-boundary.ts`** [LANDMINE] — exist but are not called. If re-enabled, must skip tint orders (CORE §13).
- **Split-done usage-log gap** [LANDMINE] — `app/api/tint/operator/split/done/route.ts` never writes a `sampling_usage_log` row. Split-completed tints don't appear in Sampling Library usage history. CORE §13 pre-existing item.
- **Grey "Done" fallback must stay grey** [LANDMINE] — the grey pill fires for auto-enriched/uncategorized done rows (auto-dispatched-on-arrival, ex-tint, other closed). Do NOT paint it green or re-derive it from `dispatchStatus` — that would mislabel enriched-auto rows as "Dispatch" when they carried no `dispatchTargetDate`.
- **Pre-set slot fields not cleared on cancel** [LANDMINE] — if a tint row has a pre-set `dispatchTargetDate`/`dispatchWindowId` (§4.16) and the order is then cancelled, `cancel/route.ts` clears `dispatchStatus` but leaves the slot fields untouched. Not a display bug today (cancelled rows show the red pill, not the slot), but stale data remains on the row.
- **Orphaned `components/support/ship-to-override-modal.tsx`** [LANDMINE] — predates the §4.18 inline-picker build: no button opens it (no trigger wired in `OrderRow`), its form is free-text (not the search picker), and its `onSave` is a no-op (never calls fetch). Left untouched this session (never delete files unless instructed). The live ship-to override is the inline cell (§4.18), fully independent of this dead file. Also tracked in `CLAUDE_CORE.md §13` (flagged for the CORE consolidation pass).
- **`shipToOverride` flag can be true with no id** [LANDMINE] — see §4.18. Mail-order enrichment can set the boolean flag from a free-text redirect that never resolved to a `delivery_point_master` row. Any screen reading the override must handle "flag true, id null" as a valid state, not an error.

---

## 9. Schema additions beyond CORE v27.6

All added via Supabase SQL Editor + hand-edit `prisma/schema.prisma` + `npx prisma generate`. No `prisma db push`.

**On `orders`:**
| Column | Type | Purpose |
|---|---|---|
| `mailMatched` | `Boolean @default(false)` | True when enrichment matched a mail order; drives envelope display |
| `heldAt` | `DateTime? @db.Timestamptz(6)` | Anchors hold footprint = `obdEmailDate` (not wall-clock) |
| `dispatchTargetDate` | `DateTime? @db.Date` | Chosen dispatch day (date-only, no time) |
| `dispatchWindowId` | `Int?` | FK → `dispatch_slot_master.id` |
| `arrivalSlotId` | `Int?` | FK → `slot_master.id` (arrival-day slot; used for history grouping) |

**New table `dispatch_slot_master`:**
`id`, `windowTime` (text, e.g. `"10:30"`), `label` (text?), `sortOrder`, `isActive`, `createdAt`, `updatedAt`. Seeded 4 windows: **10:30, 12:30, 16:00, 18:00**. Distinct from arrival slots in `slot_master`.

✅ **Now in CORE:** CORE `orders` schema block (§7.3) lists these columns; `dispatch_slot_master` is documented in CORE §7.4 (schema v27.9).

---

## 10. Key files index

| File | Role |
|---|---|
| `app/api/support/orders/route.ts` | Main list + history: today-OR clause, two-footprint history WHERE, footprintType (both boards), doneCount cancelled arm, ORDER_INCLUDE |
| `app/api/support/slots/route.ts` | Header counters: dispatchedCount fence, doneCount OR-arms (incl. cancelled), pendingCount hold-exclusion |
| `app/api/support/orders/[id]/dispatch/route.ts` | Manual dispatch → `closed`; REQUIRES + persists `dispatchTargetDate` + `dispatchWindowId` |
| `app/api/support/orders/[id]/hold/route.ts` | Hold: stamps `heldAt = obdEmailDate` |
| `app/api/support/orders/[id]/release/route.ts` | Hold release: requires `dispatchTargetDate` + `dispatchWindowId` |
| `app/api/support/orders/[id]/cancel/route.ts` | Single-order cancel with reason dialog |
| `app/api/support/orders/[id]/undo-dispatch/route.ts` | Undo dispatch: guard on `closed` + `footprintType !== "cancel"`, resets to `pending_support` |
| `app/api/support/orders/[id]/undo-cancel/route.ts` | Undo cancel: guard on `cancelled`, resets to `pending_support` + un-cancels splits |
| `app/api/support/orders/[id]/route.ts` | PATCH (priority/ship override; arrival-slot field may be unused from UI) — has `$transaction` landmine |
| `app/api/support/orders/[id]/preset-slot/route.ts` | Pre-set `dispatchTargetDate`/`dispatchWindowId` on a tint row without closing it (§4.16); sequential awaits |
| `app/api/support/ship-to-search/route.ts` | Read-only customer search for the ship-to override picker (§4.18); auth-gated, `take: 8` |
| `components/support/ship-to-override-cell.tsx` | Inline searchable ship-to override picker — empty/editing/set states (§4.18) |
| `app/api/support/splits/[id]/route.ts` | PATCH split — has `$transaction` landmine |
| `app/api/support/bulk/route.ts` | Bulk dispatch (date+window required) / hold; bulk hold stamps `heldAt`; no bulk cancel |
| `app/api/support/dispatch-windows/route.ts` | Returns active `dispatch_slot_master` windows |
| `app/api/import/obd/route.ts` | `applyMailOrderEnrichment`: mailMatched, dispatchStatus.toLowerCase(), auto-done block, enrichment-hold heldAt stamp |
| `components/support/support-page-content.tsx` | Active/done split, earliest-first sort, hold-tab picker wiring, slot-tab guard, history unlock, onBulkDispatch/onBulkHold + dispatchWindows wired into table |
| `components/support/support-orders-table.tsx` | Done group, footprintType pills (Dispatch/Hold/Cancelled/Done), Status + Dispatch-Slot columns, dispatch intent (`dispatchIntentIds`), `savingSlot` optimistic state, bulk bar (status+slot+preview+Submit), undo buttons, elevation/polish/nav-alignment |
| `components/support/support-hold-table.tsx` | Hold tab, own component (§4.20) — staged `holdSlots` Map, own column set, VOL reads `importVolume` |
| `components/support/shared/table-cells.tsx` | Shared by main + Hold boards (§4.19/§4.20) — `SUPPORT_GRID_COLUMNS`/`SUPPORT_HOLD_GRID_COLUMNS`, `formatArticleTag`, `getPriLabel`, `VolCell`, `CustomerCell`, `groupOrders`/`getSmuGroup` |
| `components/support/dispatch-slot-picker.tsx` | Reusable date-rail + window-pills picker; `forceOpenGen` prop for programmatic open from Status menu; portal-rendered popover |
| `lib/dates.ts` | `getISTDayRange()` — IST midnight-to-midnight UTC intervals |
| `docs/mockups/support/v9.html` | Support board mockup v9 |
| `docs/mockups/support/done-group.html` | Done-group approved mockup (Option A) |
| `docs/mockups/support/support-bulk-bar.html` | Bulk bar ghost-row mockup (states 1–4) |

---

*CLAUDE_SUPPORT.md v1.6 · Support Module · July 2026*
