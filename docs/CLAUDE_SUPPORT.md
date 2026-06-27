# CLAUDE_SUPPORT.md — Support Module
# v1.0 · Schema v27.7 · June 2026
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md

---

## 1. What Support is

Support is the **gatekeeper** between the import pipeline and downstream dispatch/warehouse work. Every OBD that enters the system arrives in `workflowStage = "pending_support"`. Support decides which slot it belongs to, whether to dispatch or hold it, and gates it forward to `closed` (for now) once the decision is made.

**The operator's actual workload is only the un-enriched orders.** OBDs where enrichment already set a `dispatchStatus = "dispatch"` auto-complete on import (auto-done — see §4 §9). The operator only handles the leftovers that need a manual decision.

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

All nine pieces below are live in production. Listed in build order.

### §4.1 Header dispatched-counter — today fence [LIVE]
**Route/file:** `app/api/support/slots/route.ts` — today-path `dispatchedCount`
**Rule:** Dispatched tile is fenced on `obdEmailDate ∈ ISTrange(today)`. No `workflowStage` fence (closed-today still counts). **Pending and tinting tiles stay unfenced** — carry-over is intentional; a Monday order still pending on Tuesday is real workload and must match the list.

### §4.2 Done group + collapse [LIVE]
**Route/file:** `app/api/support/orders/route.ts` (today path, section=slot); `components/support/support-orders-table.tsx`
**Rule:** The list query uses an `OR` — (a) non-closed stages with no date fence (carry-over preserved) OR (b) `workflowStage = "closed"` fenced to today's `obdEmailDate` range. Done rows render collapsed under a green "N done ▸" bar; `T` key toggles all done groups; done rows are read-only (DONE badge, no checkbox/dropdown/popover) except for the undo button. Excluded from Select All + bulk.

### §4.3 Undo-dispatch route [LIVE]
**Route/file:** `app/api/support/orders/[id]/undo-dispatch/route.ts` (POST)
**Rule:** Guard — only if `workflowStage === "closed"` (else 409). Full clean reset: each non-cancelled split `dispatchStatus → null` + log; order `workflowStage → "pending_support"`, `dispatchStatus → null` + log (`fromStage: "closed"`, `toStage: "pending_support"`). Hard-coded target `pending_support` — no log-read, simpler, harmless even for ex-tint orders (splits untouched). Not available on history rows.

### §4.4 Mail-received time [LIVE]
**Route/file:** `components/support/support-orders-table.tsx`
**Rule:** OBD/DATE column and Age pill read `orderDateTime ?? obdEmailDate`. `orderDateTime` is overwritten by enrichment to equal `mo_orders.receivedAt`. If no mail match, falls back to SAP import time (never blank).

### §4.5 mailMatched flag + envelope [LIVE]
**Schema:** `orders.mailMatched Boolean @default(false)` (added v27.6 + backfilled 3,488 rows)
**Route/file:** `app/api/import/obd/route.ts` — `applyMailOrderEnrichment` sets `mailMatched: true` on match. Shared by all 3 import paths.
**Rule:** Envelope icon in the table gates on `order.mailMatched`. Cannot gate on `orderDateTime` (it is never null — set to SAP time at import). SAP-only rows show no envelope.

### §4.6 Earliest-first sort within each slot [LIVE]
**Route/file:** `components/support/support-page-content.tsx`
**Rule:** Frontend comparator: `(orderDateTime ?? obdEmailDate)` ASC, `obdNumber` ASC tiebreaker, null-times sink to bottom. Applied to both active and done slices independently; `[...active, ...done]` grouping preserved. Backend `ORDER_BY` (`priorityLevel ASC → obdEmailDate ASC → obdNumber ASC`) left as-is (priority is irrelevant at Support; Planning owns it). Carry-overs (older `obdEmailDate`) float to top — correct.

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

`isDone` is widened to: `workflowStage in ["closed", "dispatched"] OR dispatchStatus = "hold"` — held orders land in the done group on both live and history boards.

### §4.10 Release + dispatch-target [LIVE]
**Route/file:** `app/api/support/orders/[id]/release/route.ts` (single-order release only; no bulk-release API)
**Rule:** Requires `dispatchTargetDate` (YYYY-MM-DD string) + `dispatchWindowId` (Int) in the body. Date parsed with `Date.UTC(y, m-1, d)` to avoid IST/UTC day-shift. Closes the order (`workflowStage → "closed"`, `dispatchStatus → "dispatch"`) and stores the target date/window for the dispatch footprint.

**Dispatch windows:** `GET /api/support/dispatch-windows` returns active rows from `dispatch_slot_master` (4 seeded windows: 10:30 / 12:30 / 16:00 / 18:00). These are **dispatch** windows — separate from arrival slots in `slot_master` (Morning/Afternoon/Evening/Late Evening/Night). They will later drive auto-slot-assignment and downstream planning.

**Dispatch Slot picker:** `components/support/dispatch-slot-picker.tsx` — horizontal date-rail (upcoming days, today pre-selected) + calendar icon for far dates + 4 window pills. Portal-rendered popover (createPortal to body + getBoundingClientRect) to escape table overflow clipping. Value shape: `{ date: "YYYY-MM-DD", dispatchWindowId, windowTime }`. **Reusable** — built to drop onto any OBD; "Assign date+slot to any order" is the general feature this enables (Hold release is its first consumer).

**Hold tab slot-tab guard:** when in Hold view, slot tabs are greyed (`opacity-40 pointer-events-none`) and clicks are no-ops (`if (mainTab === "hold") return` in `onSegmentChange`). Prevents pending orders leaking into the hold list.

### §4.11 History — fully actionable [LIVE]
**Route/file:** `app/api/support/orders/route.ts` (history branch); `components/support/support-page-content.tsx`, `support-orders-table.tsx`
**Rule:** History shows ALL orders for the selected day. Slot grouping uses `arrivalSlotId` (not `slotId`). "All" view is date-fenced to `obdEmailDate = selected day` (no cross-day leakage). Past-day pending AND done rows are actionable — `isReadOnly = isDoneRow` only (not `isHistoryView || isDoneRow`). Done rows on history: undo is enabled; pending rows: dispatch / hold / cancel / slot / priority / bulk all work. Server routes were already date-agnostic; this was a client-only unlock.

**Two-footprint history query:** The history WHERE is a 3-arm OR for a viewed date D:
1. `obdEmailDate ∈ ISTrange(D)` → arrival footprint
2. `heldAt ∈ ISTrange(D)` → hold footprint (amber Hold on the order's arrival day)
3. `dispatchTargetDate ∈ DATErange(D)` AND `workflowStage = "closed"` → dispatch footprint (green Dispatch on the target day)

`footprintType` is computed server-side per row, priority **dispatch > hold > arrival**. Same OBD can appear on two days (its arrival day as amber Hold; its target day as green Dispatch). `dispatchTargetDate` is a `@db.Date` — compared with `Date.UTC(y,m-1,d)..+1`, same expression both sides, no day-shift.

**Dispatch pill in done group** shows the real action: green Dispatch / amber Hold / grey Done (was a generic "DONE" label before 06-27).

**Header (today view only):** `{X}% done · {N} OBDs`, green pill. History header keeps pending/done/tinting/OBDs counts.

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
If an order is held AND released on the **same calendar day**, it shows ONCE as green Dispatch (dispatch wins). Priority: **dispatch > hold > arrival**. Computed server-side via `footprintType`.

---

## 6. Key learnings / principles

- **Carry-over is passive — no cron.** Yesterday's pending orders carry forward naturally. Header pending/tinting tiles are unfenced (live workload); only "dispatched/done today" counters get an IST fence on `obdEmailDate`.
- **`closed` = parking stage during incremental build.** Each new downstream screen gets fed by flipping the prior screen's done output forward once ready. Test orders never leak.
- **Auto-done guard = `pending_support` stage ONLY.** Non-negotiable. Enrichment can run before tinting completes. The guard prevents closing un-tinted / mid-tint orders. Without it, a tint OBD with `dispatchStatus="dispatch"` set by enrichment would auto-close, skipping paint mixing entirely.
- **Priority is NOT a Support concern.** It was dropped from the Support sort. Planning owns priority. Support sorts earliest → latest (received time).
- **`orderDateTime` is never null.** Do not use it as a "came from mail" signal. Use `mailMatched`.
- **dispatchStatus is canonical lowercase on the orders side.** Translate once at enrichment. No `.toLowerCase()` anywhere else.
- **heldAt = arrival date.** Not wall-clock. Board placement depends on it.
- **When an action has multiple entry points, ALL must be updated together.** Bulk and import paths have each been missed once during this build. Check single / bulk / enrichment whenever adding any new per-order stamping.
- **Normal orders are approximate in history.** History shows the CURRENT dispatchStatus on the arrival day — not a frozen snapshot. Only held orders are historically precise (via `heldAt`/`dispatchTargetDate`). Frozen snapshots would require full log-replay — not built.
- **`dispatchStatus` sticky-note root cause is unresolved.** dispatchStatus is not cleared when `workflowStage` advances to `closed`/`dispatched` — contradictory state persists. Three workaround patches applied so far. Real fix: clear/normalize dispatchStatus at the dispatch transition. Has its own ROADMAP entry.

---

## 7. Open items + NEXT discovery agenda

### Bugs / cleanup [NEXT]
- **dispatchStatus sticky-note root cause** [NEXT] — dispatchStatus not cleared at the dispatch transition. State says `"dispatch"/"hold"` while stage says `"closed"`. Has been patched 3 times (double-count, pill logic, footprint logic). Needs a deliberate fix (ROADMAP). Do not patch again.
- **Picker cosmetics** [DEFERRED] — date pills feel heavy; calendar icon gets cut off on narrow screens. Reduce to ~5 visible dates, lighten pills.
- **Sree Milap test row (9107904128)** [DEFERRED] — `heldAt = null` from before the fix; shows wrong pill on its hold day. Test artifact — do not SQL-repair.
- **"0 line items" panel display bug for split OBDs** [DEFERRED] — detail panel shows 0 line items though data exists (1 raw, 2 split lines). Data is fine; fetch/display is wrong. Low priority.

### Support view build [NEXT]
- **Board-slot rule (06-24 design, LOCKED but NOT BUILT)** [NEXT] — 5-slot structure (add Late-Evening), cutoff fix (≤ vs <), carry-over slot logic (same-day → received time; carried-over → punch time), dual-date card (OBD date bold + "⚠ rec. {date} · {N}d" flag). See `docs/prompts/drafts/code-update-2026-06-24-support-board-slot-rule.md` for the full locked spec.
- **Hold auto-route** [NEXT] — enriched holds currently appear in the pending list AND the Hold tab (Hold is an overlay, doesn't remove from pending). Goal: enriched holds auto-route to the Hold tab with zero human touch, mirroring auto-done but for hold. Separate build.
- **Mail indicator placement polish** [DEFERRED] — ship a clearer indicator than the current trailing gray envelope. Leading gray envelope (Option A) is the recommended safe choice. Teal options ruled out (collision with row-selection teal edge). Mockups: `docs/mockups/support/mail-time-symbol.html`, `docs/mockups/support/mail-indicator-placement.html`, `docs/mockups/support/mail-indicator-options-EFGH.html`.
- **Mail punched time (Piece 2)** [DEFERRED] — store `mo_orders.punchedAt` on the order (new column), decide display placement (detail panel vs tooltip vs separate column). Piece 1 (received time) is live; Piece 2 needs new column + enrichment copy + display.

### Dispatch / downstream [DEFERRED]
- **"Assign date+slot to any order"** [DEFERRED] — the general feature for which the Dispatch Slot picker was built. Hold-release is the first consumer; normal orders will reuse the same picker + `dispatchTargetDate`/`dispatchWindowId` fields.
- **Auto-slot-assignment off dispatch windows** [DEFERRED] — `dispatch_slot_master` will later drive auto-assignment and downstream picking/planning.
- **Lock done-row edits on history** [DEFERRED] — currently both pending and done are editable on past days (intentional for testing + downstream creation). One-line gate when ready.

### Warehouse phase [DEFERRED]
- **`support_done` gate** — build when Warehouse goes live. Repoint Support Done from `closed` → `support_done`.
- **Ghost-stage counters in `operations/summary`** — warehouse-unassigned (references dead stage) + closedSlot alert (references dead stages). Deferred to Warehouse go-live.

### Not yet click-tested
- Cancelled / tinting / physically-dispatched rows on past-day history are non-interactive per logic (guards independent of `isHistoryView`) but not click-verified. Verify when convenient.

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

CORE `orders` schema block (§7.3) does not yet list these columns — update CORE in a dedicated consolidation pass.

---

## 10. Key files index

| File | Role |
|---|---|
| `app/api/support/orders/route.ts` | Main list + history: today-OR clause, two-footprint history WHERE, footprintType, ORDER_INCLUDE |
| `app/api/support/slots/route.ts` | Header counters: dispatchedCount fence, doneCount OR-arms, pendingCount hold-exclusion |
| `app/api/support/orders/[id]/dispatch/route.ts` | Manual dispatch → `closed` |
| `app/api/support/orders/[id]/hold/route.ts` | Hold: stamps `heldAt = obdEmailDate` |
| `app/api/support/orders/[id]/release/route.ts` | Hold release: requires `dispatchTargetDate` + `dispatchWindowId` |
| `app/api/support/orders/[id]/undo-dispatch/route.ts` | Undo: guard on `closed`, resets to `pending_support` |
| `app/api/support/orders/[id]/route.ts` | PATCH (slot/priority/ship override) — has `$transaction` landmine |
| `app/api/support/splits/[id]/route.ts` | PATCH split — has `$transaction` landmine |
| `app/api/support/bulk/route.ts` | Bulk dispatch / hold / cancel; bulk hold stamps `heldAt` |
| `app/api/support/dispatch-windows/route.ts` | Returns active `dispatch_slot_master` windows |
| `app/api/import/obd/route.ts` | `applyMailOrderEnrichment`: mailMatched, dispatchStatus.toLowerCase(), auto-done block, enrichment-hold heldAt stamp |
| `components/support/support-page-content.tsx` | Active/done split, earliest-first sort, hold-tab picker wiring, slot-tab guard, history unlock |
| `components/support/support-orders-table.tsx` | Done group render, undo button, mail-time read, envelope (mailMatched), footprintType pill, isDone widen |
| `components/support/dispatch-slot-picker.tsx` | Reusable date-rail + window-pills picker (Hold tab + future general use) |
| `lib/dates.ts` | `getISTDayRange()` — IST midnight-to-midnight UTC intervals |
| `docs/mockups/support/v9.html` | Support board mockup v9 |
| `docs/mockups/support/done-group.html` | Done-group approved mockup (Option A) |

---

*CLAUDE_SUPPORT.md v1.0 · Support Module · June 2026*
