# CLAUDE_TINT.md — Tint Module
# v2.2 · Schema v27.24 · September 2026 · updated 2026-09-19
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Covers Tint Manager (BOARD REBUILT 2026-09-05/06 — §1), the "Base — No Tint" bypass (§1.12), Tint Operator (incl. History, skip, pause/resume, partial done, sampling reuse + pack scaling), Manual Tint Entry, Delivery Challans (incl. void), Shade Master (legacy), TI Report, Tint Summary report, Remove OBD.

Users: Chandresh Kolgha (tint_manager), Deepak Vasava + Chandrasing Valvi (tint_operator). Prakash (operation_manager, id 32) also LANDS on `/tint/manager` at login (`lib/rbac.ts`; role confirmed real 2026-08-04 — `CLAUDE_CORE.md §5`).

Sampling Library is a SEPARATE module — see `CLAUDE_SAMPLING_LIBRARY.md`.

---

## 1. Tint Manager — /tint/manager

Primary user: Chandresh.

**REBUILT 2026-09-05/06** (seven commits, `a0f9378b` → `082eb92e`, all pushed). The four-column
Kanban and its card/table view toggle are **gone**. What replaced them is below; `§1.11` records
what went with them.

**Key files:**
- `components/tint/tint-manager-content.tsx` — composition root: state, every write, the ONE
  window-level Esc owner
- `components/tint/manager/` — `types.ts` · `rows.ts` (pure shaping) · `board-rail.tsx` ·
  `board-table.tsx` · `board-detail-panel.tsx` · `board-assign-bar.tsx` · `board-bits.tsx` ·
  `use-tint-manager-sync.ts` · `base-ti-panel.tsx` (§1.12) · `tint-manager-access-provider.tsx` (§1.2)
- `lib/tint/assignment-status.ts` — **the status vocabulary owner (§1.4)**
- `lib/tint/base-operator.ts` — the "Base — No Tint" placeholder worker's identity (§1.12)
- `app/api/tint/manager/`: `orders/` · `assign/` · `reorder/` · **`marker/` (new)** ·
  `cancel-assignment/` · `splits/reassign/` · `splits/cancel/` · `missing-customers/` ·
  `operators/` · `orders/[id]/{remove,pause-history,skip-history}` ·
  `base-bypass/` · `base-bypass/undo/` · `base-pending/` (§1.12)

**RETIRED, NOT DELETED** (CORE §3 forbids deleting): `components/tint/tint-table-view.tsx`,
`components/shared/order-detail-panel.tsx` (this screen was its only live importer), and
`components/tint/split-builder-modal.tsx`. All three still type-check; they lost their import
only (still on disk, zero importers — grep 2026-09-19). ⚠ `tint-table-view.tsx` still imports `TintOrder`/`SplitCard`/`CompletedAssignment` from
`tint-manager-content.tsx`, which re-exports them from `manager/types.ts` — **do not remove those
re-exports**, and any new field on those payload types must also be added to that file's synthetic
`assignmentAsOrder()` object or `tsc` breaks.

**Second mount — `/admin/tint-manager`** (`app/(admin)/admin/tint-manager/page.tsx`, superuser-only
via the admin layout's `requireSuperuser`; URL-only, off the admin sidebar per
`components/admin/admin-sidebar.tsx:62`). It renders `<TintManagerContent />` **outside** the manager
layout, so no `TintManagerAccessProvider` wraps it and the context default (all false,
`tint-manager-access-provider.tsx:48-53`) applies: **every panel tab and the Reports pill are hidden
there, even for the superuser.** Use `/tint/manager`.

### 1.1 Header — still `<UniversalHeader />`

**This screen did NOT become a second header exception.** `/floor` remains the only one
(`CLAUDE_UI.md §6`), and the wiring table there OWNS the header composition — not restated here.

The only prop dropped in the rebuild: the **operator-workload segment pills**
(`segments` / `activeSegment` / `onSegmentChange`). The table's per-operator sections replace them
and show the work instead of counting it. Everything else is wired as before — Import modal +
`showImport`, the three filter groups (Delivery Type / Priority / Type), "Add to Tint" (`M`), the
Reports link, the shortcuts panel, and the missing-customer badge in `rightExtra`.

The **Reports** pill is drawn only when the viewer holds `canView` on any report key —
`canReports` from `TintManagerAccessProvider` (§1.2), resolved by `canViewAnyReport` in the manager
layout (`tint-manager-content.tsx:893` `{canReports && (`; `0fbcd4be`, `6f628b05`).

### 1.2 The shell — rail + one grouped table

Same **structural pattern** as Floor Control (a composition root owning state and every write,
dumb children, pure shaping in a separate module) — but a different header and no shared
components.

- **Left rail, 344px — "Needs assignment".** Cards, one per bill, **oldest first**. Strictly
  `workflowStage === "pending_tint_assignment"`. Assign happens here, and it is the ONLY place
  Remove OBD is offered (the rail card, and the detail panel opened on a rail bill —
  `board-rail.tsx:163`, `board-detail-panel.tsx:149`) — matching the server rule that removal is
  blocked once assigned (`§8`, 409 outside that stage).
- **Rail, second list — "Tinter Issue pending".** Below the pending cards: the bills a "Base — No
  Tint" bypass sent out that still owe their TI (`board-rail.tsx:255-317`, fed by `GET
  /api/tint/manager/base-pending`). Clicking a card swaps the rail to that bill's lines (covered /
  pending, "← Back to queue"); clicking a line opens `base-ti-panel.tsx` on the right. Each card
  carries an **Undo** (`onUndoBase`). Detail: `§1.12`.
- **Right pane — ONE flat table.** No tabs, no operator filter chip.
- **Detail panel, 480px** — Items / Details / Activity tabs, Prev/Next walking rail cards first
  then table rows without closing. Supersedes both old panels (see the retired list above).
  **Each tab is its own per-user tick** — `tint_panel_items` / `tint_panel_details` /
  `tint_panel_activity`, `canView` only (`0fbcd4be`). `app/(tint)/tint/manager/layout.tsx` reads
  them off the same `allPerms` map it builds the nav from and hands them down through
  `TintManagerAccessProvider` (`components/tint/manager/tint-manager-access-provider.tsx`), whose
  default is all-false. **A tab without its tick is never drawn and never mounted**, so its content
  never fetches (`board-detail-panel.tsx` `visibleTabs`); with no tick at all the panel has no tab.
  The routes re-check: `/api/orders/[id]/audit-history` needs `tint_panel_details`
  (`route.ts:33`); `pause-history` and `skip-history` need `tint_manager` canView **AND**
  `tint_panel_activity` canView (`pause-history/route.ts:20,26`, `skip-history/route.ts:21,27`).
  The Items tab has no route of its own — hiding it is UI-only. Live holders of all three:
  Chandresh Kolgha (#21), Deepanshu Thakur (#25), Prakash (#32) (live 2026-09-18, Q03b).

### 1.3 Table — grouping, columns, sequence

**Grouped one section per operator**, header = the operator's name and nothing else. Within a
section rows are ordered:

> **In Progress → their Assigned queue → Paused → completed today**

Paused sits *after* the queue deliberately: a paused job is not "next" — only its own operator can
resume it — so it must not head the list the manager reads to decide what to hand out. The
grouping is a **sort, not a filter**; nothing is hidden by it.

**Done is TODAY ONLY.** A finished job leaves the tint stages entirely (`done/route.ts` writes
`pending_picking`, or `pending_support` when the bill is held — `§2`), so Completed rows come from
`tint_assignments.completedAt >= start of today`, not from a stage. The full history is the Tint
Summary report (`§12`) — the board says so in a subtitle and a tooltip.

**Columns, in order** (fixed table per `CLAUDE_UI.md §27`; widths
`4 · 4 · 13 · 5 · 17 · 20 · 9 · 6 · 9 · 13` = 100):

| # | Column | Source | Note |
|---|---|---|---|
| 1 | ☐ | — | Blank on non-selectable rows. No lock icon — it read "forbidden" on 3 of the 4 statuses. |
| 2 | **#** | computed | See the rank rule below. |
| 3 | OBD | `obdNumber` | Split rows carry a "Split" tag in the warn tokens, `bg-warn-bg text-warn-text` (`board-table.tsx:263`, `b585240f`). |
| 4 | **SMU** | `import_raw_summary.smuCode` | The SHORT code, full name on hover. 926/926 live coverage: **74** Decorative Projects · **77** Retail Offtake · **70** Deco Retail. ⚠ `smuNumber` on the same table is NOT it — 0/926, always null. |
| 5 | **Bill To** | `import_raw_summary.billToCustomerName` | The ORDERING DEALER. Same source Floor uses (`billToByObd`). Differs from Ship To on **873 of 926** live tint OBDs, which is why both columns exist. |
| 6 | **Ship To** | `orders.customer.customerName` | The SITE. Carries ★ key-customer and ⚡ urgent. |
| 7 | Route | `customer.area.primaryRoute.name` | ⚠ The **AREA** path, matching `FLOOR_DEALER_SELECT`. Never `delivery_point_master.primaryRoute` — that resolves for 21/926 (2%). |
| 8 | Vol | `querySnapshot.totalVolume` | Right-aligned, tabular-nums. |
| 9 | Art. | rolled up from active line tags | NULL means UNKNOWN, never zero — only 366/926 OBDs carry any tag at all. Render an em dash. |
| 10 | Status | derived | `§1.4`. |

**SO No. and Operator were removed** — SO by owner decision, Operator because the group header
already names them.

**🔴 THE `#` IS A COMPUTED RANK, NOT `sequenceOrder`.** The stored column is a sparse `MAX+1` value
(`assign/route.ts`) and is frequently still at its `0` default — it orders correctly but does not
count. `rows.ts` ranks 1..N per operator using the same `[sequenceOrder, createdAt]` sort the
reorder route's list query uses, so the rank shown and the index the server swaps on cannot
disagree. Only `assigned` rows get a number; everything else shows a dash.

**🔴 ORDERS AND SPLITS ARE TWO SEPARATE SEQUENCES.** This surprised the build and is worth stating
plainly: `reorder/route.ts`'s order branch queries `prisma.orders`, its split branch queries
`prisma.order_splits` — two tables, two `sequenceOrder` columns, two disjoint swap domains. **An
order can never swap with a split.** So the `#` is ranked per operator **AND per row type**:
someone holding 2 orders and 1 split sees the orders as 1–2 and the split as its own 1, not a
merged 1–3. A merged rank would draw arrows that cannot do what they promise.

**Typography and status-pill colours are Floor's**, copied from
`components/floor/floor-table.tsx` and `components/floor/status-pill.tsx`. ⚠ Floor OWNS those
values (`CLAUDE_FLOOR.md §1`). Three of the four washes are hex, not exported as tokens, so this is
a deliberate copy with the source named in `board-bits.tsx`; the fourth (`tinting_in_progress` ↔
Floor's `withPicker`) is the **tint token pair `bg-tint-bg text-tint-700`** on both boards
(`board-bits.tsx:95`, `status-pill.tsx:181`; `73a762e8`). **If Floor's washes change, these must be
re-copied** — nothing enforces it.

### 1.4 Status vocabulary — ONE owner

**`lib/tint/assignment-status.ts` is canon for which literal to write in code.** Import from it;
never retype a status string.

```
TINT_ASSIGNMENT_ACTIVE_STATUSES = assigned | tinting_in_progress | paused
TINT_ASSIGNMENT_DEAD_STATUSES   = tinting_done | cancelled | skipped
TINT_STATUS_DONE = "tinting_done"      TINT_STATUS_CANCELLED = "cancelled"
```

`CORE §7.3` remains the authority on what the **column** may hold (a schema fact); this file names
the **code constant to import** (an engineering rule). Different facts, one owner each.

`skipped` is DEAD, not active: a skip clears the operator FK, nulls `sequenceOrder` and resets the
stage, and the next Assign creates a brand-new row rather than reviving it. A skipped row still
carries `assignedToId` for someone who no longer owns the job.

🔴 **`"done"` has never existed.** Four live routes filtered on `status: { not: "done" }` — a
predicate matching every row ever written. Fixed 2026-09-05/06 in `reorder` (×2), `orders`,
`assign` and `cancel-assignment`. Of the 48 orders carrying more than one assignment row, the old
predicate resolved to a DEAD row on **all 48** — which is how one OBD could sit in two operators'
reorder queues at once. The `cancel-assignment` copy was the worst: it drove an `updateMany` that
overwrote `skipped` rows to `cancelled`, destroying the assignment-side record of the skip.

**Board statuses map onto Floor's four washes** so a colour means the same on both boards:
`assigned` → grey (waiting) · `tinting_in_progress` → tint/sky token (with picker) · `paused` → amber
(needs check) · `tinting_done` → green (done).

### 1.5 Assign — and the customer-missing interceptor

Single-operator only, from the rail card's popover or the panel.

The Assign menu lists the active operators and then **a third kind of choice, "Base — No Tint"**
("No tinting needed — close this bill without an operator"), passed to `OperatorMenu` as its
`extraAction` on both pending surfaces (`board-rail.tsx:243-245`, `board-detail-panel.tsx:169-171`).
It is not an assignment — it is the bypass in `§1.12`.

**The interceptor is preserved and must stay.** A `customerMissing` order never reaches the assign
call: it opens `CustomerMissingSheet` with an amber warning, and the intent is remembered so the
assign **re-fires by itself** once the flag flips false. It now remembers the OPERATOR too, so the
interrupted assign completes rather than re-opening a picker. `assign/route.ts` refuses it
server-side as well (400), so the UI is the affordance, not the rule. "Base — No Tint" goes through
the same interceptor (`handleBaseBypass` in `tint-manager-content.tsx`, `99175a99`), and
`base-bypass/route.ts` refuses a `customerMissing` bill with the same 400.

The rail's Assign menu and the panel's operator picker are **portalled to `document.body`** with
fixed positioning measured from the trigger, preferring to open downward
(`pickMenuDirection()` in `board-bits.tsx`). ⚠ The earlier in-card `absolute` + `z-index` version
was clipped by the rail's `overflow-hidden` / `overflow-y-auto`: **z-index does not escape an
overflow clip.** Do not move it back inside the scroller.

### 1.6 Re-assign — `assigned` ONLY, server-enforced

**Both single and bulk re-assign are restricted to `status === "assigned"`.** This is NOT merely
hidden in the UI: `assign/route.ts` **rejects anything outside `pending_tint_assignment` /
`tint_assigned` with a 400** carrying a message written to be shown verbatim.

Why a hard reject: the route's upsert keys on `status: "assigned"`, so a tinting or paused job
MISSES that lookup and falls through to `create()` — minting a SECOND `tint_assignments` row while
`workflowStage` resets to `tint_assigned`, orphaning the original's `startedAt`,
`accumulatedMinutes`, `pauseCount`, `lastPausedAt` and `currentProgress`. None of that is
recoverable from the UI. It also makes `§5`'s rule — a paused job belongs to its operator until
resume or done — a **server** rule for the first time.

**Splits re-assign through their own endpoint**, `POST /api/tint/manager/splits/reassign`, never
the whole-order one.

**Bulk re-assign** = N **sequential awaits** over the single-assign route (no bulk API exists; no
`Promise.all`, no `$transaction` — CORE §3, the pooler). Partial-failure contract copied from
Floor (`CLAUDE_FLOOR.md §4.1/§4.2`): a `failed[]` list, the 422 case when nothing was written,
named failures when some were. A `customerMissing` row lands in `failed[]` with a reason rather
than silently skipping or killing the batch.

### 1.7 Re-sequence — and the route's silent no-op

`PATCH /api/tint/manager/reorder`, body `{ type: "order" | "split", id, direction: "up" | "down" }`.
Same-operator confinement is structural (§1.3). Hover an `assigned` row for the ▲▼.

✅ **The `$transaction` landmine is FIXED here** (2026-09-05, `a0f9378b`). Both branches use
sequential awaits now; the swap arithmetic and the tied-`sequenceOrder` tie-break are
byte-identical. Partial failure leaves two rows sharing a `sequenceOrder` — the same state a fresh
queue is already in, since the column defaults to 0 — and the next move resolves it. No repair
path needed.

⚠ **A boundary move returns `200 { success: true }` having written NOTHING.** A 2xx alone does not
mean anything moved. The client captures the queue signature before the call and compares after
the refetch, announcing only a real change (`queueSignature()` in `rows.ts`).

### 1.8 Send back to Pending [NEW]

Panel action on `assigned` rows: cancel the assignment, return the bill to the rail.

| Row type | Endpoint | Body |
|---|---|---|
| whole order | `POST /api/tint/manager/cancel-assignment` | `{ orderId }` |
| split | `POST /api/tint/manager/splits/cancel` | `{ splitId }` |

`assigned`-only is the **routes'** rule, not a UI preference: cancel-assignment requires
`workflowStage === "tint_assigned"` (400 otherwise); splits/cancel rejects `tinting_in_progress` /
`tinting_done` (409).

Two-stage inline confirm (`CLAUDE_UI.md §13`'s pattern, as Mark Done and Remove OBD use) — the old
Kanban's equivalent had **no** confirmation and never read the response, so a rejected cancel
logged to console and looked like success. The response is now read.

⚠ **Both cancel routes still run on `prisma.$transaction`** — deliberately deferred per `§14`'s
"pre-existing `$transaction` is a separate task" rule. ROADMAP.

### 1.9 Live sync [NEW]

`GET /api/tint/manager/marker` → `{ count, latest }` over `MAX(orders.updatedAt)`, mirroring
`/api/floor/marker` exactly in shape. Polled every **15s** by `use-tint-manager-sync.ts` through
`use-picking-marker`'s `url` param, plus a 60s fallback refetch. Paused while the detail panel is
open or a selection is up (never move the ground under a hand). **READ-ONLY — never add a write**;
every board's live-sync keys on `MAX(orders.updatedAt)`.

**ONE mechanism where Floor has two.** Floor splits rail (30s refetch) from board (15s marker)
because those are two independent sources; here the rail and the table both render from the SAME
`/api/tint/manager/orders` response, so one refetch updates both, and the marker's first arm covers
`pending_tint_assignment` so a new import still appears on its own.

⚠ **The marker is a UNION APPROXIMATION of the board's six feeds**, because unlike Floor there is
no single shared `orders` WHERE to lend — the board renders six separate queries. Its three arms:
the open stages · whole-OBD completions today · split completions today. Arms 2 and 3 exclude the
"Base — No Tint" placeholder's rows, mirroring Set E (`marker/route.ts:109,124`; `§1.12`). **If any feed gains or
loses a stage this predicate must move with it**, or the board stops refreshing on a change it
displays. `startOfToday` is copied from the board's expression verbatim (server-local, not IST —
pre-existing; fix both together or neither).

### 1.10 Payload

`GET /api/tint/manager/orders` returns four arrays — `orders`, `activeSplits`, `completedSplits`,
`completedAssignments` — plus `slotSummary` (⚠ still returned, still read by nothing). All four
carry the board columns as flat fields: `soNumber`, `billToName`, `route`, `articleTag`,
`isKeyCustomer`, `smu`, `smuCode`, alongside `pauseSummary` / `skipSummary`.

### 1.11 Dropped in the rebuild — do NOT re-discover these as bugs

The **Create Split UI is dropped from this screen by scope decision** — no fallback link, and
`split-builder-modal.tsx` is retired (not deleted). Consequence to own: `POST
/api/tint/manager/splits/create` now has **no caller anywhere**, so new splits cannot be created.
Existing splits are unaffected — they still display, still re-assign via their own endpoint, and
are still reorderable within their own per-type sequence (§1.3).

Eight further Kanban capabilities have no home in the new design. They are **open questions, not
settled decisions** — see ROADMAP § "Tint Manager board rebuild". The significant one is the
per-row **StatusPopover** (set priority Urgent/Normal and dispatch status), whose removal leaves
`/api/tint/manager/orders/[id]/status` and `/splits/[id]/status` with no caller.

### 1.12 "Base — No Tint" bypass [LIVE, 2026-09-06, `c9ef1c31` → `e12ce9e9`]

A bill import classified `orderType="tint"` that is entirely base/stock colour leaves the tint rail
with **no operator and no TI**: the bypass writes a completed assignment attributed to a
placeholder worker, then moves the bill exactly as a finished job moves (`§2`).

**`POST /api/tint/manager/base-bypass`** `{ orderId }` — `tint_manager` canEdit (`route.ts:70`).
Refuses with a 400 written to be shown verbatim when the bill is `customerMissing` (`:120`) or is
not at `pending_tint_assignment` (`:130`) — narrower than Assign, which also accepts
`tint_assigned`, on purpose: a second, already-finished assignment must never sit beside an
operator's live one. A missing placeholder row is a 500 (`:147-154`), never a fall-back to a real
person. Sequential awaits, each step with its own catch and message:
1. a `tint_assignments` row — `assignedToId` = the placeholder, `assignedById` = the manager,
   `status: "tinting_done"`, `startedAt = completedAt = now`, `accumulatedMinutes` left at 0
   (`:195-203`);
2. the same single `orders.update` the done route writes — `pending_picking` + `dispatch` + the
   completion slot, or `pending_support` when held (`:219-236`; `§2`);
3. `tint_logs.action = "base_no_tint_bypass"` (`:254`) and an `order_status_logs` row
   ("Base — No Tint (no tinting required)").

No TI rows and no `sampling_usage_log` rows are written.

**The placeholder worker — `lib/tint/base-operator.ts`.** `BASE_OPERATOR_EMAIL =
"base-notint@system.invalid"` is the only place that string exists; `getBaseOperatorId()` looks it
up **by email, never by id**, uncached, and deliberately without an `isActive` filter. The row is
`isActive=false` so it stays out of the Assign dropdown and every roster of people, while remaining
a valid `assignedToId` (the file header records the live row's shape, SELECT-verified 2026-09-06).
Do not retype the email anywhere else.

**Where it is excluded:** board Set E (`orders/route.ts:460`) — so a bypass never appears in the
table as an operator section — marker arms 2 and 3 (`marker/route.ts:109,124`, `§1.9`), and the
Tint Summary's trend query and `realCompletedObds` (`lib/reports/tint-summary-data.ts:264`, `:460`;
`e12ce9e9`) — see `§12`.

**Where it is admitted:** `tinter-issue` POST (`route.ts:126-127`) and `tinter-issue-b` POST
(`route.ts:114-115`) accept `assignedToId: { in: [userId, baseOperatorId] }`, so a manager can write
the TI a bypass still owes. The `[id]` PATCH routes do not. Picking reads the split too —
`lib/picking/colour-work-query.ts:112` (→ `CLAUDE_PICKING.md §5.6`).

**`GET /api/tint/manager/base-pending`** — `tint_manager` canView (`route.ts:88`), read-only. One
entry per placeholder-owned `tinting_done` assignment whose active tinting lines are not all
covered by a TI row, newest first, no date fence. Coverage is keyed on `tintAssignmentId`, not
`orderId`. It feeds the rail's "Tinter Issue pending" list (`§1.2`).

**`components/tint/manager/base-ti-panel.tsx`** — the operator screen's TI-saving core for ONE line
of ONE bypassed bill: suggest / operator-search / formula-match / the save POST. It deliberately has
no Start, Pause, Resume, Skip, Mark Done, timer, queue, or `andStart`. Saving the last owed line
drops the bill out of base-pending.

**`POST /api/tint/manager/base-bypass/undo`** `{ orderId }` — `tint_manager` canEdit
(`undo/route.ts:63`). Refusals, in order, each `{ ok: false, errorCode, message }`:
`NOT_A_BYPASS` 404 (no placeholder-owned `tinting_done` row) · `TI_ALREADY_RECORDED` 400 (any TI row
on the assignment — deleting it would cascade them away) · `ALREADY_PICKED` 400 (any
`pick_assignments` row) · `ALREADY_ON_FLOOR` 400 (`orders.dispatchSlotSource !== null`). On success:
stage back to `pending_tint_assignment`, `slotId`/`originalSlotId` null, `dispatchStatus` cleared only
if it reads `"dispatch"`; the assignment row is deleted; `order_status_logs` + `tint_logs`
`"base_no_tint_undone"` are written.

🔴 **Undo refuses most bypasses since 2026-09-11.** `resolveCompletionSlot` returns
`dispatchSlotSource: "auto"` (`lib/dispatch/completion-slot.ts`), which the bypass writes on every
un-held bill the engine slots — and Guard 4 refuses any non-null `dispatchSlotSource`
(`undo/route.ts:140-149`). So Undo succeeds only where the engine declined the slot, or the bill was
held — and in both cases only if nothing else had set a slot source. The undo also leaves `dispatchTargetDate`/`dispatchWindowId` in place. The route's header
comment still describes the bypass as writing `pending_support`; it predates `b3dfe5b8`.

---

## 2. Slot assignment for tint orders

See `CLAUDE_CORE.md §9` (⚠ CORE §9 has a pending update from this section — see the flag at the end of this section).

- At import: `orderType === "tint"` → `slotId = null`, `originalSlotId = null`
- **`arrivalSlotId` — now stamped at import for tint orders too (2026-06-29) [LIVE].** Previously tint orders got `arrivalSlotId = null` at import (the `orderType !== "tint"` guard). That guard was removed from both import paths (`handleManualSapConfirm` and the auto-import confirm path in `app/api/import/obd/route.ts`) — tint orders now get `arrivalSlotId = resolveArrivalSlotId(emailDateTime)` (the 5-slot ruler), exactly like non-tint orders. This is separate from `slotId`/`originalSlotId`, which remain null until completion (unchanged, see below). No backfill was run — applies to NEW orders only. See CLAUDE_IMPORT.md §12 for the import-side detail.
- At completion (whole order, `/api/tint/operator/done`): sets `slotId` + `originalSlotId` on order from an inline IST cut-off ladder — before 10:30 → 1, before 12:30 → 2, before 15:30 → 3, else 4 (`done/route.ts:171-182`; `resolveSlot()` is not imported by either done route)
- **Completion releases the bill straight to picking [LIVE, `b3dfe5b8`, 2026-09-11].** ONE `orders.update` (`done/route.ts:214-230`), three outcomes:
  - **Held** (`order.dispatchStatus === "hold"`, `:196`) → `workflowStage: "pending_support"`, `dispatchStatus` untouched. **This is the only case that writes `pending_support`.** A completion never releases a held bill.
  - **Pre-set slot** (`dispatchWindowId != null && dispatchTargetDate != null` — set at the desk while the bill was still tinting, today via Floor's **change-slot**, `CLAUDE_FLOOR.md §4.1`) → **`workflowStage: SUPPORT_DONE_OUTPUT` (= `"pending_picking"`)** + `dispatchStatus: "dispatch"`, slot kept.
  - **Otherwise** → the same `pending_picking` + `"dispatch"`, plus the slot from **`resolveCompletionSlot(orderId, now)`** (`lib/dispatch/completion-slot.ts`) spread into the same update: `dispatchTargetDate`, `dispatchWindowId`, `dispatchSlotRuleId`, `dispatchSlotSource: "auto"`. The engine runs on the **completion** time, not arrival. If it declines, it returns null, the slot stays NULL and the bill still goes. `resolveCompletionSlot` returns data and never writes — the caller folds it into its one update (the markers key on `MAX(orders.updatedAt)`).
  - The `order_status_logs` note names which outcome happened (`done/route.ts:250-256`). The same three-way rule runs in the split/done parent bubble (`split/done/route.ts:197-213`) and in the Base bypass (`§1.12`) — `resolveCompletionSlot` is the one owner of all three.
  - The import side of the same decision (every non-tint bill released on import): `CLAUDE_IMPORT.md §2.1`. Nothing writes `closed` (`CLAUDE_PICKING.md §2`). ⚠ The code comment at `split/done/route.ts:173-177` still says an un-preset bill "lands in pending_support" — stale since `b3dfe5b8`; do not quote it.
- At split completion (`/api/tint/operator/split/done`): sets `slotId`/`originalSlotId` on the **parent** order inside the split's `$transaction` (`split/done/route.ts:133-151`). Latest completion wins. The release rule above applies to the parent-bubble update, which runs after the `$transaction`, not inside it.
- **Parent auto-advance (2026-06-25 fix):** after the split commits, the route checks whether all non-cancelled splits are now `tinting_done`. If yes AND parent is still `tinting_in_progress`, it releases the parent per the rule above (`pending_picking`, or `pending_support` when held) and writes an `order_status_logs` entry (`changedById: 1`, note naming the outcome). Guard is idempotent (`workflowStage === "tinting_in_progress"`). **Cancelled splits are excluded from the count — non-negotiable for correctness.**
- No buffer before cutoff
- `applyMailOrderEnrichment()` skips recalculation of **`slotId`/`originalSlotId` only** for tint orders. It does **not** skip `arrivalSlotId` — that field is stamped for every mail-matched order regardless of `orderType` (not tint-guarded), and always has been.

~~⚠ FLAG FOR CORE PASS: CORE §9 needs one sentence added~~ — **RESOLVED**: CORE §9 carries the `arrivalSlotId`-for-all-orders sentence (verified against CORE v91, 2026-08-04).

### 2.1 Tint-side facts for the Floor rail suggestion (2026-08-03) — read-only for this module

`CLAUDE_FLOOR.md §8` owns the suggestion layer (DORMANT since the rail retired); these are the TINT-side facts it depends on:

- **`tint_assignments.completedAt` is the suggestion anchor** for a finished FULL tint OBD. Written
  by `done/route.ts:164` (whole-OBD) and `split/done/route.ts:105` (per split, `status:
  "tinting_done"`). It replaces both arrival clocks in the suggestion — arrival says when the paper
  landed; completion is the first moment the bill could physically go on a vehicle.
- **Completion writes the dispatch slot itself** — `resolveCompletionSlot` on the same completion
  moment (`§2`).
  Was: completion wrote no slot and left an un-preset bill at `pending_support` on the Floor rail for a confirm step until 2026-09-11; now every un-held completion goes to `pending_picking` with a completion slot (`b3dfe5b8`). Do not revert.
- **On the Floor card payload, `tint.completedAt` is an ISO UTC STRING, not a Date** (re-typed
  2026-08-03, commit `7e466776` — a JSON payload cannot carry a Date). Convert to IST at render
  time. This module's own uses (`§12`'s date axes) read the DB column server-side as a real Date —
  the string shape exists only on Floor's client payload.

---

## 3. Tint Operator — /tint/operator

Primary users: Deepak, Chandrasing.

**Key files:**
- `components/tint/tint-operator-content.tsx`
- `components/tint/PauseJobModal.tsx`
- `components/tint/SkipJobModal.tsx`
- `components/tint/MarkDoneConfirmModal.tsx`
- `app/api/tint/operator/my-orders/route.ts`
- `app/api/tint/operator/done/route.ts`
- `app/api/tint/operator/start/route.ts`
- `app/api/tint/operator/pause/route.ts`
- `app/api/tint/operator/resume/route.ts`
- `app/api/tint/operator/skip/route.ts`
- `app/api/tint/operator/history/route.ts` + `components/tint/operator/history-panel.tsx` (§3.13)

Visual spec: `CLAUDE_UI.md §34-38`.

**Second mount — `/operations/tint-operator`** (`app/(operations)/operations/tint-operator/page.tsx`)
renders the same `TintOperatorContent`, gated by job title: the operations layout admits roles
containing `operations`/`admin` (`app/(operations)/operations/layout.tsx:25`) and the page requires the
primary role to be one of them.

### 3.1 Layout

- Row 1: UniversalHeader title is a **Jobs / History toggle** (the words "My Jobs" are gone — `tint-operator-content.tsx:1595-1607`), stats (queue/active/done/paused)
- Row 2: Job filter as a `bg-brand-600` segment pill (leftExtra, `tint-operator-content.tsx:1649`). Click opens 400px dropdown with **3 sections: CURRENT / PAUSED / UP NEXT**. Progress bar (rightExtra). On the History face a date stepper and the day's job/tin totals replace the pill (§3.13)
- Below Row 2: Bill To / Ship To equal-width cards (`grid-cols-2`)
- Main: 320px SKU left panel + flex TI form right

### 3.2 Job queue sequence

TM controls sequence. Operator CANNOT start a future job — only "Save TI" available for non-current jobs.

- **Current job** = first assigned in queue (no other job in_progress) OR the job that is `tinting_in_progress`
- **Future jobs:** show "Save TI" only. After TI saved: "TI saved — waiting in queue".

### 3.3 CTA button rules

- Save (Save TI, Update TI Entry): `bg-gray-900 text-white`
- Workflow (Save TI & Start, Start Job, Mark as Done): `bg-green-600 text-white`
- **Pause: `bg-amber-600 text-white`**
- **Skip: passive ghost `bg-gray-100 text-gray-700`**
- No teal on any CTA. Buttons use natural width, `whitespace-nowrap`, `flex-shrink-0`.

### 3.4 Left panel card states

- Selected: `bg-gray-100 border-l-[3px] border-l-gray-900`
- Unselected: `bg-white border-gray-200 hover:bg-gray-50`

### 3.5 Pigment shade cells

Visual spec `CLAUDE_UI.md §35`. Tinted bg + 3px top border in pigment colour. Filled cells get deeper bg + darker border.

**Acotone column order is locked to the operator's physical paper register** (2026-06-15): `WH1, NO1, NO2, YE1, YE2, XY1, RE1, RE2, XR1, MA1, OR1, GR1, BU1, BU2`. Same order across operator input grid, TI report, and XLSX export (§11). **Invariant:** in `tint-operator-content.tsx`, `ACOTONE_SHADES` (grid, object array — colours/styles keyed per code, so reordering moves whole objects) and `ACOTONE_COLS` (TI load mapping) must stay **code-for-code aligned**; if they drift, saved values load into the wrong cells — any future Acotone column change edits both together. (TINTER pigment order was NOT reviewed against a register — open question whether it needs the same treatment.)

### 3.6 Post-save form behaviour

After Save TI or Update TI Entry:
- Do NOT reset `tiEntries`
- `fetchOrders` → `loadExistingTIEntries` → `selectedLineIdx` effect repopulates form
- `existingTIEntries` must create NEW Map reference on update (not mutate)
- `selectedLineIdx` effect depends on: `selectedLineIdx`, `selectedJob?.id`, `existingTIEntries`
- After NEW entry save: auto-advance to next uncovered line

### 3.7 Auto-load existing TI entry

When operator clicks a line:
- Line HAS entry → form populated, "ACTIVE SHADE VALUES" mode, `editingEntryId` set, `tinterType` set
- Line has NO entry → fresh empty form, `editingEntryId` null

### 3.8 Timer (shared helper)

Helper: `lib/tint/elapsed-time.ts` → `computeElapsedMs({ status, startedAt, accumulatedMinutes, nowMs })`.

Three branches:
- `running` → `accumulated × 60000 + (now − startedAt)`
- `paused` → `accumulated × 60000` (frozen)
- otherwise → null

The operator card (1s tick) delegates to this helper; the retired `tint-table-view.tsx` still imports it but is mounted nowhere (§1). `TintAssignmentInfo` TS interface gained `accumulatedMinutes`.

Bug pattern to remember: after resume, server resets `startedAt = now`, so a UI that reads `startedAt` alone drops elapsed back to 0. Always use the helper.

### 3.9 Multi-line Save TI + Start

Current job ALWAYS shows `[Save TI]` + `[Save TI & Start]` regardless of how many lines covered.

- "Save TI" — saves current line, auto-advances to next uncovered
- "Save TI & Start" — saves current line AND starts job timer

### 3.10 Removed elements

- Old 240px left panel job queue cards
- Old bottom sheet queue overlay
- "+ Add Another Entry" button
- Base SKU dropdown for first entry
- Entry header when single entry
- Purple TINT badge from TI header

### 3.11 API data

`GET /api/tint/operator/my-orders` returns per order/split: `billToCustomerId`, `billToCustomerName`, `areaName`, `routeName`, `deliveryTypeName`. Top-level: `totalAssignedToday`, `totalDoneToday`. Per assignment: `pauseCount`, `lastPausedAt`, `currentProgress`, `accumulatedMinutes`.

⚠ **Known defect — "today" is UTC midnight.** `my-orders/route.ts:27-28` builds `startOfToday` with `setUTCHours(0, 0, 0, 0)` = 05:30 IST, and the completed-today queries (`:146`, `:164`) and so `totalDoneToday` / `totalAssignedToday` (`:344-345`) count from there. A job finished between 00:00 and 05:30 IST lands in the wrong day. The History route names it and does not copy it (§3.13).

### 3.12 Sampling reuse — search-first flow + pack scaling

The TI form's shade area is **search-first, one flat list** (the old exact/reference two-section split + caps are gone). UI spec: `CLAUDE_UI.md §34`. Suggestion-engine + pack-scaling model: `CLAUDE_SAMPLING_LIBRARY.md`.

**Per-entry view mode `browse | confirm | newshade`** (collapse-on-pick, so the TI form never sits under a long list):
- **Repeat site** → full this-site shade list, **no cap**, recent-first, exact match pinned top.
- **New site** → no list; the new-shade form auto-renders with the search retained for cross-site reuse (grey reuse zone).
- **Pick** → `confirm` (applied-shade bar + active-values grid + "Show all"). **Add shade** → `newshade`.

**Exact match** = a sampling with a variant matching the current line's `skuCode` AND `packCode` (multiple possible — one per shade tinted on that base+pack). **Pick = reuse, no allocation:** attaches the EXISTING `samplingNo`; a cross-site pick records the current site as another usage (the duplicate problem was *findability*, not the save path — `sampling-resolution.ts` was already correct).

**Type-aware apply:** Apply reads pigment columns from the card's OWN `tinterType` (not the toggle), auto-flips the toggle to match, and a toggle change refetches suggestions. Cards carry `tinterType` and a TINTER/ACOTONE tag.

**Pack filter + scaling-on-Use (TINTER only):**
- The reuse list is a **pack FILTER**, not an auto-scaler — rows show **raw stored** values. Dropdown defaults to the line's pack bucket, four nominal buckets only (1/4/10/20 via `packDoseLitres`); resets to line default on job/line/SKU change. PACK pill green = same bucket as the line (exact fit), grey = different bucket. (UI §34.)
- **Scaling happens ON USE only:** `applySuggestionToEntry` scales a grey (different-bucket) TINTER shade to the line pack at the moment of Use. **ACOTONE is never scaled** — the gate is per-**row** (`row.tinterType === 'TINTER'`).
- Using a scaled row **creates a NEW pack variant under the SAME sampling number** (no new number); each variant keeps its own usage. Existing variants stay immutable.
- **formula-match** (`/api/sampling-library/formula-match`) is **per-litre for TINTER** (2-dp tolerance — catches a typed-fresh 4 L formula matching an existing 20 L recipe of the same shade) and **exact 27-value for ACOTONE**; active/zero pre-filter both.
- **Reuse / "Same shade found" modal:** Cancel / Esc / backdrop aborts the save with **no** new number; only **Use** (reuse, scaled) and **Create new** mint/save.

**Other packs of the same shade — "+N packs".** A reuse row carries `otherVariants`, every other pack/SKU variant of that shade (`c5b2e783`). The PACK cell shows a collapsed "+N packs" disclosure; opened, it lists each variant's nominal pack and its recipe's own `lastUsedAt`. **View-only** — no pigments and no Use: applying goes through the representative row so pack scaling still runs (`components/tint/operator/flat-suggestion-list.tsx:169`, `:245-296`). The payload side: `CLAUDE_SAMPLING_LIBRARY.md`.

> ⚠️ Superseded (do not reintroduce): the earlier flat list that auto-scaled every row to the line pack with ✓ (exact) / ×N (scaled) markers + the `scalingEnabled` prop. Replaced by the pack-filter list above.

### 3.13 History face [LIVE, `dfd9b669` · `b2e7c78a` · `5ce8d8ec`, 2026-08-11]

The header's Jobs / History toggle (§3.1) swaps the screen to **one IST day of completed jobs**,
rendered by `components/tint/operator/history-panel.tsx`; the Bill To / Ship To cards and the SKU
toggle are Jobs-only.

`GET /api/tint/operator/history?date=YYYY-MM-DD` — `tint_operator` canView (`history/route.ts:116`),
read-only.
- **Window: today + the 6 days before it** (`HISTORY_DAYS = 7`, route and client both). A malformed
  date is a 400; an out-of-window date is **clamped**, not rejected, and the response's `date` is
  the effective day. Default today.
- **IST day bounds** via `istDayBounds()` (`T00:00:00+05:30`), copied from
  `lib/reports/tint-summary-data.ts` — not the `setUTCHours` form in `my-orders` (§3.11).
- **Grouped by JOB** (a whole-OBD `tint_assignments` row or one `order_splits` row), only jobs at
  `tinting_done` whose `completedAt` falls in the day, each carrying the TI lines on it.
- **"My" means `tinter_issue_entries.submittedById`** — the person who typed the TI — not
  `assignedToId`.
- Split TI rows carry `tintAssignmentId = null`, so the job filter is an OR across both relations;
  do not collapse it to one.
- Removed and hidden orders are excluded (`isRemoved: false` + `getHideExclusion()`).

---

## 4. Operator Skip Job

Soft-removes a top assigned job from operator's queue back into TM pool.

### Locked behaviour

- Available **only on top/first job** in queue
- Skipped → back to TM pool as fresh pending assignment
- 4 reasons: `TINTER_FINISHED`, `MACHINE_BREAKDOWN`, `MATERIAL_SHORTAGE`, `OTHER`
- "Tinter finished" requires: manual tinter-type pick + multi-select of out-of-stock colours
- Free-text remark always **optional**
- No daily skip limit
- TM can reassign to **same operator** who skipped
- TM card shows **full skip history**
- Full audit log

### API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/tint/operator/skip` | Operator (owner) | Skip top assigned job |
| GET | `/api/tint/manager/orders/[id]/skip-history` | `tint_manager` canView AND `tint_panel_activity` canView (`route.ts:21,27`) | Full skip history modal |

**Skip logic (sequential awaits):**
1. Assert ownership + top-of-queue + status='assigned'
2. If TINTER_FINISHED → assert tinterType + colours[] non-empty
3. Insert `tint_skip_events` row
4. Update assignment: status='skipped', skippedAt, skipEventId
5. Insert `order_status_logs` `OPERATOR_SKIP`
6. Re-queue: clear operator FK, set sequenceOrder=null → returns to TM pool

### Schema

`tint_skip_events` (v27.3) + `tint_assignments` gets `skippedAt`, `skipEventId` (BIGINT FK).

---

## 5. Operator Pause / Resume

Pauses an in-progress job mid-tinting with per-SKU progress snapshot.

### Locked behaviour

- **Whole-OBD only.** Splits rejected with 400.
- **Concurrent cap:** 1 in-progress + max 3 paused per operator
- **Per-job cap:** max 3 pauses on the same job
- **Resume blocked** if operator has another job in-progress (server + client both enforce)
- Paused jobs persist overnight (no expiry)
- TM cannot reassign a paused job (operator owns until resume/done)
- 5 reasons: `lunch_break`, `shift_end`, `machine_breakdown`, `material_shortage`, `urgent_priority` (no "Other")
- Remark optional, 500-char counter
- Per-SKU progress: whole int, `0 ≤ doneQty ≤ assignedQty`, every SKU present

### API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/tint/operator/pause` | Operator (owner) | Pause in-progress whole-OBD |
| POST | `/api/tint/operator/resume` | Operator (owner) | Resume paused job |
| GET | `/api/tint/manager/orders/[id]/pause-history` | `tint_manager` canView AND `tint_panel_activity` canView (`route.ts:20,26`) | Chronological list, oldest first. Opened from the detail panel's Activity tab ("View full pause history →", `board-detail-panel.tsx:430`) |

**Pause logic:**
1. Assert ownership + status='tinting_in_progress' + startedAt non-null
2. Reject splitId !== null (400)
3. Enforce per-job cap (≤3) + concurrent cap (≤4 total paused for operator)
4. Validate per-SKU coverage + range
5. Compute `elapsedMinutesAtPause` = floor((now - startedAt) / 60000) + accumulatedMinutes
6. Insert `tint_pause_events` row
7. Update assignment: status='paused', accumulatedMinutes=elapsedMinutesAtPause, pauseCount++, lastPausedAt=now, currentProgress=snapshot
8. Audit log `OPERATOR_PAUSE`

**Resume logic:**
1. Assert ownership + status='paused' + operator has 0 in-progress (server-side double-check)
2. Find latest open `tint_pause_events` row → set resumedAt, resumedById, resumeRemark
3. Update assignment: status='tinting_in_progress', **startedAt = now** (canonical fact: server resets this)
4. Audit log `OPERATOR_RESUME`

**Pause history DTO** translates internal field names: `pauseReason` → `reason`, `operator` → `pausedBy`, etc.

### Schema

`tint_pause_events` (v27.3) + `tint_assignments` gets `pauseCount`, `lastPausedAt`, `currentProgress JSONB`, `accumulatedMinutes INT`.

### Rounding behaviour

`accumulatedMinutes` is `Int @default(0)`. Sub-minute precision is lost across pause boundaries. Worst case ~30 sec per pause × 3 max pauses = ~90 sec drift. Depot-acceptable.

### Coexistence with Skip

A card skipped 1× then paused renders amber-500 left border, both pills inline in a status-pill row, two stacked summary blocks, two kebab items. No conflicts.

### UP NEXT rows are clickable

Mockup spec said locked previews. Implementation kept them clickable to preserve the "prep TI for upcoming jobs" workflow. Visually styled per spec (compact, muted, no buttons).

---

## 6. Mark Done refactor (partial qty support)

`POST /api/tint/operator/done` body now accepts:

```ts
{ progress: [{ skuId, doneQty }] }
```

- Validates coverage + range (`0 ≤ doneQty ≤ unitQty`)
- Folds final run delta into `accumulatedMinutes` (canonical "total tinting time" on done)
- Writes `currentProgress` snapshot

### MarkDoneConfirmModal (visual: `CLAUDE_UI.md §38`)

- Per-SKU steppers pre-filled with `assignedQty`
- "Total tinting time" summary line
- Two-stage confirm: `[Cancel] [Confirm Done]` → if any SKU short → amber banner "Short by N tins. Continue?" → `[Back] [Yes, mark done]`

### accumulatedMinutes semantics

Schema comment: *"On done, this field is finalised as the total tinting minutes including all paused intervals."*

Pause route increments per pause. Done route folds final delta. Always exposed on `my-orders` payload for the modal.

### TI-completion gate preserved

Client-side preflight using `existingTIEntries` shows per-line warning before modal opens. Server still re-checks defensively.

### Splits keep the legacy path

Mark Done on splits branches to `/api/tint/operator/split/done`. The new partial-qty validation only applies to whole-OBD orders. The split/done route was updated 2026-06-25 to add the parent auto-advance block — see §2 for details.

---

## 7. Manual Tint Entry

Chandresh's manual override when auto-classification misses a tint requirement.

**Use cases:**
1. Sample requests / custom shades where SKU description doesn't trigger any tint keyword
2. Late additions — dealer calls after import and asks for custom shade on stock-colour order

**UI:** Modal on Tint Manager. Operator types OBD number, picks lines, submits with reason.

🔴 **THERE IS NO BUTTON LABELLED "MANUAL ENTRY", AND THERE HAS NOT BEEN ONE SINCE THE BOARD REBUILD.**
The modal is `components/tint/manual-tint-entry-modal.tsx`, opened from
`tint-manager-content.tsx` in **two** places, neither of which says "Manual Entry":

| Entry point | Where | Reads |
|---|---|---|
| The **"Add to Tint"** pill, a `+` icon in the board header | `tint-manager-content.tsx:907` | `title="Add OBD to Tint (M)"` |
| The **`M`** keyboard shortcut | `tint-manager-content.tsx:345-347` | listed in the header's `shortcuts` strip as *"Add OBD to Tint"* |

Both set the same `pullModalOpen` state (`:131`, `:1099`). **Looking for "Manual Entry" on the
screen and concluding the modal is unreachable is the expected mistake** — the owner made it on
2026-09-06 and the flow went unverified for that reason. Derived from the tree 2026-09-06; the
naming is the rebuild's, not this section's, and §7's own prose is the only place the words "Manual
Tint Entry" still appear to a reader. Note the API routes keep the old name (`manager/manual-entry`,
`manager/manual-entry/lookup`, `manager/manual-entry/revert`), so a grep for either name finds only
half the flow.

**Schema:**
```
manual_tint_entries
  id, orderId (FK → orders), lineIds (JSON array),
  reason TEXT, createdBy (FK → users), createdAt
```

**Behaviour:** Additive only — does not modify auto-classification at import. Adds OBD to tint workflow with chosen lines flagged.

**Which bills can be pulled:** only those at `MANUAL_TINT_PULLABLE_STAGES = ["pending_support", "pending_picking"]` (`lib/workflow-stages.ts:84`, `b3dfe5b8`), tested by both `manual-entry/lookup` (`route.ts:87`) and `manual-entry` POST (`route.ts:151`) off the one constant. Anything past a picker's hands (`pick_assigned` onward), `cancelled` or legacy `closed` is refused.

---

## 8. Remove OBD (TM soft-delete)

Soft-delete OBD with audit trail. Voids linked challan.

### Locked behaviour

- Soft delete only (no hard delete)
- Removable by: holders of `tint_manager` canEdit (`orders/[id]/remove/route.ts:39`). ⚠ The button itself is drawn by a job-title check — primary role `admin`, or `tint_manager` among the roles (`canRemoveObd`, `tint-manager-content.tsx:93-98`) — so a `tint_manager` canEdit holder without that job title (e.g. Prakash, `operation_manager`) is allowed by the server but shown no button
- Removable **only at `pending_tint_assignment` stage** — blocked after assignment (returns 409)
- 2 predefined reasons: `CUSTOMER_CANCELLED`, `WRONG_ORDER`
- Free-text remark **mandatory**
- Linked challan **voided** (number kept, marked cancelled, print/PDF disabled, watermark shown)
- Re-import of removed OBD: **skipped silently** (no auto-restore) — returns `skipped: previously_removed` in preview UI
- Admin can **restore** via `/admin/removed-orders` page
- Removed OBDs **hidden everywhere** in normal screens (per CORE §3 soft-delete reads rule)

### API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/tint/manager/orders/[id]/remove` | `tint_manager` canEdit | Soft-remove + void challan |
| POST | `/api/admin/removed-orders/[id]/restore` | Admin | Restore OBD, unvoid challan |
| GET | `/api/admin/removed-orders` | Admin | List all removed (paginated) |

**Remove logic (sequential awaits):**
1. Load order → assert exists, `isRemoved=false`
2. Assert `workflowStage === 'pending_tint_assignment'` → else 409
3. Update order with removal fields (`isRemoved=true`, `removalReason`, `removalRemark`, `removedAt`, `removedById`)
4. Find linked challan → update with void fields
5. Insert `order_status_logs` entry `OBD_REMOVED`

### Read-API rule (CORE §3)

Every list endpoint adds `where: { isRemoved: false }` default. Every challan read adds `where: { isVoided: false }` default.

**Exceptions** (must include voided/removed):
- Challan sequence-numbering — would collide with previously-issued (now voided) numbers
- Admin `/removed-orders` list — explicitly filters `isRemoved: true`
- Admin restore endpoint — must see soft-removed to restore them
- `lib/import-upsert/state.ts` — internal to import flow
- `lib/slot-cascade.ts`, `lib/day-boundary.ts` — **archived 2026-07-28** (`archive/2026-07-planning-board/lib/`); they had been disabled long before that. If either is ever restored, it must skip tint orders.
- Challan list/detail uses `OR: [{ isRemoved: false }, { isRemoved: true, challan: { isVoided: true } }]` so voided-challan rows on removed orders surface for audit

### UI

- Rail card (and the detail panel opened on a rail bill) → "Remove OBD" → `RemoveObdModal` (`§1.2`). The Kanban and `tint-table-view.tsx` that used to offer it were retired 2026-09-05/06 (`§1`).
- Modal: reason radios + mandatory remark + warning about challan void
- Voided challan: diagonal red watermark + disabled Print/PDF + red banner with reason/remark/who/when
- `/admin/removed-orders` — table with Restore action

### Schema

`orders` v27.3: `isRemoved BOOLEAN DEFAULT false`, `removalReason TEXT`, `removalRemark TEXT`, `removedAt TIMESTAMPTZ`, `removedById INT`, `restoredAt`, `restoredById`.

`delivery_challans` v27.3: `isVoided BOOLEAN DEFAULT false`, `voidReason TEXT`, `voidRemark TEXT`, `voidedAt TIMESTAMPTZ`.

---

## 9. Delivery Challan — /tint/manager/challan

TM screen. The live page is `app/(tint)/tint/manager/challan/page.tsx` (singular — the sidebar row
`delivery_challans` points at `/tint/manager/challan`, `lib/permissions.ts:103`), gated by the
manager layout's `tint_manager` canView plus `requireRole([TINT_MANAGER, ADMIN,
OPERATION_MANAGER])`. A second, narrower mount of the same `ChallanContent` sits at **`/challan`**
(`app/(tint)/challan/page.tsx`, `requireRole([TINT_MANAGER, ADMIN])`).

**Key files:**
- `components/tint/challan-content.tsx`
- `components/tint/challan-document.tsx`
- `app/api/tint/manager/challans/route.ts`
- `app/api/tint/manager/challans/[orderId]/route.ts`

### 9.1 Auto-creation

At import time (not lazily on click) for orders with SMU = "Retail Offtake" or "Decorative Projects". Sequence based on `orderDateTime`. Number format: `CHN-{YEAR}-{5-digit seq}`. Created regardless of customer master status.

### 9.2 SMU filter

Only "Retail Offtake" and "Decorative Projects". Other SMU values excluded.

Sort: `orderBy: { orderDateTime: "asc" }`.

### 9.3 Layout — split view

See `CLAUDE_UI.md §31`.

- 320px left panel: compact 3-line rows. Selected: brand violet — inline `borderLeft: 3px solid #7C3AED` + `background: #F5F3FF` (`challan-content.tsx:386-387`)
- Right panel: action bar + challan document on `#f9fafb` bg
- UniversalHeader: no segments. Filter groups: SMU + Route. Date stepper. Search.

### 9.4 Voided challan rendering

When `delivery_challans.isVoided === true`:
- Diagonal red `VOIDED` watermark across document body
- Print + PDF actions disabled
- Red banner: `VOIDED · {voidReason} · {voidRemark} · by {name} on {DD MMM YYYY HH:MM}`
- Document still rendered (audit trail)

### 9.5 Document — B&W print

See `CLAUDE_UI.md §32`.

- Grayscale only. NO teal. NO blue.
- Logo `/jsw-dulux-logo.png` 34px. Web: full colour. Print: grayscale filter via `@media print`.
- Header: Logo · "DELIVERY CHALLAN" · Challan number + OBD date right column (`minWidth: 165`)
- Right column: bold mono challan number stacked over light `DD MMM YYYY`. Labels removed.
- Address bar (#374151) only dark section
- Bill To includes address (lookup via `billToCustomerId`)
- Footer entity: `JSW Dulux Limited (formerly Akzo Nobel India Limited)`

### 9.6 S5 contact resolution (4-source cascade)

Three columns: CUSTOMER (Bill To) / SALES OFFICER / SITE-RECEIVER (Ship To). Each uses a cascade.

**Bill-To (CUSTOMER):**
1. `isPrimary === true` AND `contactRole.name ≠ "Sales Officer"`
2. `contactRole.name ∈ OWNER_ROLES` (Owner, Manager, Proprietor, Partner, Director)
3. First contact in array
4. null

**Ship-To site (SITE/RECEIVER):**
1. `isPrimary === true AND contactRole.name ≠ "Sales Officer"`
2. `contactRole.name ∈ SITE_ROLES` (Site Engineer, Contractor, Supervisor)
3. First contact with role ≠ "Sales Officer"
4. null

**Sales Officer (4-source cascade, v27.5 multi-SO aware):**
1. **Primary SO** via `customer_sales_officers WHERE role = 'PRIMARY'` → `sales_officer_master`
2. **SO Group fallback** — `delivery_point_master.salesOfficerGroupId → sales_officer_group.salesOfficer` (still used for customers not yet migrated to multi-SO)
3. **Ship-to SO contact fallback** — first contact on Ship-To where `contactRole.name === "Sales Officer"`
4. null

Constants `OWNER_ROLES`, `SITE_ROLES` arrays in `challans/[orderId]/route.ts`.

The Primary SO source is the new authoritative one. SO Group + Ship-to contact remain as safety nets for legacy data not yet migrated; once Phase 8 backfill is run (see ROADMAP), the cascade simplifies to source 1 only.

### 9.7 S5 phone rendering

Name line 1 (11px #374151). Phone line 2 (10px #6b7280, SF Mono). Fallback `<div height:20>` preserves row height. Blank columns are valid output.

### 9.8 Print CSS

`@page` rules MUST be top-level in `globals.css`. Use `visibility: hidden` on body + `visibility: visible` on print area.

### 9.9 Fini display

Challan document is **Fini-always**. No toggle. See `CLAUDE_MAIL_ORDERS.md §16`.

### 9.10 Formula / Shade auto-fill (shipped 2026-05-26)

The **Formula / Shade column** on delivery challans now auto-fills from the Tint Operator's TI submission. Before this, Chandresh typed every shade name manually into each challan. Now the shade flows automatically from TO → challan the moment TI is submitted.

**Trigger:** Auto-fill runs on every TI submit (POST `/api/tint/operator/tinter-issue`). The sync helper is called after the per-entry create loop, wrapped in try-catch — sync failure does not break TI submit. Result returned in response as `formulaSync` for debugging.

**Format:** Shade name only (e.g. `spl 30yy 69/048`). Sampling number is saved in `tinter_issue_entries.samplingNo` but NOT shown on the challan.

**Latest TI wins:** TI is insert-only. The sync helper picks the row with the latest `createdAt` per `rawLineItemId` across BOTH TI tables (`tinter_issue_entries` TINTER and `tinter_issue_entries_b` ACOTONE).

**Per-row lock:** When TM saves a formula manually via the PATCH route, that row is stamped `isManuallyOverridden = true` and future TI submissions skip it silently. No warning, no badge. Lock is scoped to `(challanId, rawLineItemId)` — a future OBD for the same site/SKU is a fresh formula row → auto-fills normally → can be overridden again if needed.

**Skip rules** (sync helper silently skips):
- TI rows with `rawLineItemId IS NULL` (legacy or split-level rows that can't map to a specific line)
- Lines where `isTinting = false` (non-tint lines on a tint OBD)
- Formula rows where `isManuallyOverridden = true`
- Voided challans (`isVoided = true` → whole order skipped)
- TI rows where `shadeName` is null/empty (sampling-only TI no longer auto-fills)

**No backfill.** Auto-fill applies only to TI submissions after the feature shipped. Existing challans stay as-is.

**Sync helper:** `lib/tint/sync-challan-formulas.ts`. Signature:
```ts
export async function syncChallanFormulasFromTi(
  orderId: number,
): Promise<SyncChallanFormulasResult>
```

Result counters: `totalLatestTiRows`, `upserted`, `skippedNullRawLineItem`, `skippedNonTinting`, `skippedManualOverride`, `skippedNoText`, plus `reason: "no-challan" | "voided" | "ok"`.

**Algorithm:**
1. Find challan for `orderId`. Bail early if missing or voided.
2. Query both TI tables for that orderId, filter `rawLineItemId IS NOT NULL`.
3. Group by `rawLineItemId`, take latest `createdAt` per group across both tables.
4. Load `import_raw_line_items` by id-set (NOT by `orderId` — that table is keyed by `obdNumber`).
5. Load existing formula rows to check `isManuallyOverridden`.
6. Per-line sequential upsert (no `prisma.$transaction`): skip non-tint, skip manually-overridden, skip empty text, upsert with `formula`, `autoFilledAt = now`, `sourceTiEntryId = TI row id`.
7. Return result.

**Manual override stamping:** PATCH route `app/api/tint/manager/challans/[orderId]/route.ts` upsert now sets `isManuallyOverridden = true`, `autoFilledAt = null`, `sourceTiEntryId = null` on every manual save. Audit columns described in CORE §7.5.

**Schema columns** added to `delivery_challan_formulas` (v27.5):
- `isManuallyOverridden BOOLEAN NOT NULL DEFAULT false`
- `autoFilledAt TIMESTAMPTZ?`
- `sourceTiEntryId INTEGER?` (cross-table pointer, no FK)

SQL file: `sql/2026-05-26-add-formula-override-tracking.sql`.

---

## 10. Shade Master — /tint/manager/shades

DEPRECATED. Sampling Library Phase 4 shipped 2026-05-25 — operator screen no longer reads `shade_master`. Page still exists for now (historical data viewing); table scheduled for deletion after retention window. All new shade saves write to `sampling_register` + `sampling_recipes` + `sampling_usage_log` (`CLAUDE_SAMPLING_LIBRARY.md`).

- Second mount: **`/tint/shades`** (`app/(tint)/tint/shades/page.tsx`, `requireRole([ADMIN, TINT_MANAGER, TINT_OPERATOR])`) — the operator sidebar always adds a "Shade Master" row pointing here (`app/(tint)/tint/operator/layout.tsx:35`). Both mounts render `ShadeMasterContent`, which reads and writes through `/api/admin/shades` (`shade-master-content.tsx:167,191`).
- 2-row UniversalHeader
- IosToggle, type filter (TINTER/ACOTONE), pack filter, pagination
- Columns: # | Shade Name | Customer ID | Type | SKU Code | Pack | Status | Active | Added By | Added At

---

## 11. TI Report — /reports?r=ti-report

**Folded into the Reports hub** (2026-06-17). No longer a standalone sidebar item — old URLs `/tint/manager/ti-report` and `/ti-report` redirect to `/reports?r=ti-report` (`next.config.mjs:33-34`). Hub layout + the new Tint Summary report: `CLAUDE_UI.md §56` + §12 below.

**Gates — one tick per report (`6f628b05`, 2026-09-17).** `REPORT_PAGE_KEYS = ["reports_tint_summary", "reports_ti_report"]` (`lib/permissions.ts:156`). The hub `/reports` opens for `canView` on ANY of them — `canViewAnyReport` (`app/reports/page.tsx:42`) — and its rail shows only the reports the viewer holds (`:45`). The same predicate draws the sidebar's "Reports" row and the Tint Manager's Reports pill (`§1.1`).
- **TI report:** `reports_ti_report` canView — the rail item, and `GET /api/tint/manager/ti-report` (`route.ts:24`). **`canExport` on the same key draws Download Excel** (`app/reports/page.tsx:44` → `TIReportContent canExport` → `showDownload={canExport}`, `ti-report-content.tsx:479`). `GET /api/tint/manager/operators` (the operator filter) admits `tint_manager` canView OR `reports_ti_report` canView (`operators/route.ts:22-23`).
- **`ti_report` gates nothing.** Its `PAGE_NAV_MAP` row survives only as the sidebar row's identity, and the admin label reads "Reports (legacy — no effect)" (`PAGE_LABEL_OVERRIDES`, `lib/permissions.ts:542`).
- Live holders of `reports_ti_report` canView: Chandresh Kolgha (#21), Deepanshu Thakur (#25), Prakash (#32); canExport on all 3 rows (live 2026-09-18, Q03a/Q03b).

Report content itself unchanged:

- `DateRangePicker` with presets (leftExtra)
- Inline shade expand
- Download Excel button (`reports_ti_report` canExport only)
- Filter: operator + type
- Columns: chevron | Date | OBD No. | Dealer | Site | Base | Pack | Tins | Operator | Time

**Acotone shade columns** in the report + inline shade-expand + XLSX export follow the locked register order (§3.5), driven from a single `ACOTONE_SHADES` array in `ti-report-content.tsx`: `WH1, NO1, NO2, YE1, YE2, XY1, RE1, RE2, XR1, MA1, OR1, GR1, BU1, BU2`. Pre-change printed/exported reports won't match the new on-screen order — accepted, no migration.

---

## 12. Tint Summary report — /reports/tint-summary

Read-only daily MIS report (no DB writes). Data source-of-truth: `lib/reports/tint-summary-data.ts` (`getTintSummaryData(params)`), used by both the JSON API (`GET /api/reports/tint-summary`) and the page. Print document visual spec + Reports hub: `CLAUDE_UI.md §56`.

**Gate:** `reports_tint_summary` canView — the API (`app/api/reports/tint-summary/route.ts:37`), the standalone page (`app/reports/tint-summary/page.tsx:59`) and the hub's rail item (`§11`). ⚠ **Live oddity:** `reports_tint_summary` canView is held by **Operations User (#20) only** — 3 rows, 1 true (live 2026-09-18, Q03a/Q03b). Chandresh Kolgha, Deepanshu Thakur and Prakash hold `reports_ti_report` but not this, so they see the TI report and **not** Tint Summary.

**Base — No Tint bills (`e12ce9e9`, `§1.12`):** the KPIs, pace and trend use `realCompletedObds` (Base excluded, `tint-summary-data.ts:460`), while the operator cards and the Completed register still list "Base / No Tint" by name (`isBase`, `:407`). The two can legitimately disagree — by design.

**Date axes (today boundaries, all IST):**
- Intake / aging / open-age / top-customers / SMU / Area → `orders.orderDateTime` (OBD date).
- Completed / pace / operator output → `tint_assignments.completedAt` (+ `order_splits.completedAt`).

**Litres:** whole-OBD = `orders.querySnapshot.totalVolume` (SAP, already litres); split = Σ split `lineItems.rawLineItem.volumeLine`. No pack→litre maths.

**Completed set:** `tint_assignments` (status `tinting_done`, `completedAt` today) + split-level `order_splits.completedAt` today. A split OBD counts once; OBD-level completion ts = MAX(split completedAt).

**SMU / Area / Top-customers pool** = open/pending OBDs ∪ completed-today OBDs (keyed by `orderId`, mutually exclusive by stage). Board total = open + completed (does NOT shrink as jobs finish; larger than "Remaining" by design). `smu[]`/`area[]` return `{ name, count, litres, completedCount, completedLitres }`; `topCustomers` rank by total litres over the same pool.

**Resolution / edge rules:**
- **Hold:** `lower(dispatchStatus) = 'hold'` (mail-order enrichment can write capital "Hold"). `flags.holdCount` ignores `includeHold` so holds always surface.
- **Area:** customer → `delivery_point_master` → `area_master` → `delivery_type_master`; missing → "Unknown". **SMU** null → fall back to `import_raw_summary.smu`.
- **Hide:** `getHideExclusion()` AND-merged into every base query — report respects admin hide rules, never bypassed.
- **Opening balance** = closing(live pending) + completed − intake (best-effort). Closing/open is LIVE-now, not date-scoped → past-date reports have accurate completions but approximate opening/closing.
- **Operators filter** scopes operator-centric outputs only (operators[], registers); aggregate balances ignore it. A split OBD across two operators contributes two jobs.
- Completion pace = cumulative **litres** (a 20 L job ≠ a 500 L job). Operator card = Jobs + Volume only (tinting time + utilisation deferred).

**Params** (all optional): `date` (default today IST), `operators` (csv ids), `includeHold` (default true), `smu` (csv), `area` (csv), `trendDays` (default 7).

**Pending:** remove temp dev preview `app/reports/tint-summary/preview/page.tsx`; switch intake/aging "today" axis from OBD date → import time once import-time reliability is fixed; add operator tinting-time/utilisation later.

---

## 13. Permissions

> ## 🔴 THE MODEL CHANGED ON 2026-09-04, AND TINT CONVERTED ON 2026-09-06
>
> **Access comes from `user_page_access`, one row per (user, page key)** — not from a job title and
> not from `role_permissions`. `CLAUDE_CORE.md §5` owns the model and the `ACCESS_SOURCE` panic
> switch; §7.14/§7.15 own the schema. **Live value: `user`** (SELECT-verified again 2026-09-06,
> 1,053 rows; still `user`, live 2026-09-18, Q02).
>
> The `role_permissions` INSERT further down is **the FALLBACK, not the access model.** It is what a
> job title *would* grant, it is what `/admin/access` compares a person against, and it is what the
> app reads if `ACCESS_SOURCE` is flipped back to `role`. It is reproduced here because a rollback
> still reads it — **do not delete it, and do not read it as "who can do what today".** To answer
> that, read the person's `user_page_access` rows or open `/admin/access`.

### 13.1 Page keys

TM page keys in the `PageKey` union, `lib/permissions.ts`:
- `delivery_challans`
- `shade_master`
- `ti_report` — **gates nothing** since `6f628b05` (`§11`)
- `tint_panel_items` · `tint_panel_details` · `tint_panel_activity` (`:237-239`) — the detail panel's tabs, canView only (`§1.2`)
- `reports_tint_summary` · `reports_ti_report` (`:316-317`) — `REPORT_PAGE_KEYS` (`§11`, `§12`)

`sampling_library` is shared with operators — see `CLAUDE_SAMPLING_LIBRARY.md`.
`removed_orders` is superuser-only.

⚠ **The two keys most API routes gate on are `tint_manager` and `tint_operator`** (§13.2),
neither of which is in the list above. `delivery_challans` only decides whether the sidebar row
shows — the challan screen is gated by the manager layout's `tint_manager` canView
(`app/(tint)/tint/manager/layout.tsx:26`) plus a `requireRole` (`§9`), and the challan APIs gate on
`tint_manager`. The TI-report API gates on `reports_ti_report` (`§11`). Live holders of the panel
and report keys: `§1.2`, `§11`, `§12` (live 2026-09-18). Live holders of the older keys,
SELECT-verified 2026-09-06:

| Key | `canView` | `canEdit` |
|---|---|---|
| `tint_manager` | Harsh · Chandresh Kolgha · Prakash | the same three |
| `tint_operator` | Harsh · Chandresh Kolgha · Deepak Vasava · Chandrasing Valvi | the same four |
| `delivery_challans` | Harsh · Chandresh Kolgha · Prakash | the same three |
| `shade_master` | Harsh · Chandresh Kolgha | the same two |
| `ti_report` *(gates nothing since `6f628b05`)* | Harsh · Chandresh Kolgha · Prakash | Harsh |

🔴 **`canView` and `canEdit` are the same set on both tint keys — by accident of how the ticks were
seeded, not by rule.** Since 2026-09-04 an admin sets the two independently, per person, from a
screen. Every "harmless today" claim about a `canView`-gated write in this module rested on that
coincidence, which is why the three that existed were closed on 2026-09-06 (§13.3).

### 13.2 The API gates — derived from the tree 2026-09-19, not quoted

`app/api/tint/**` holds **40 route files and 44 exported handlers.** **40 of the 44 gate on a
per-user tick** (`checkAnyPermission`), across 37 files (counted 2026-09-19: `find app/api/tint -name
route.ts`, exported GET/POST/PATCH/PUT/DELETE per file, and the key each handler's gate names):

| Key (the handler's primary gate) | canView | canEdit | Total |
|---|---|---|---|
| `tint_manager` | 11 | 14 | **25** |
| `reports_ti_report` | 1 | — | **1** |
| `tint_operator` | 4 | 10 | **14** |
| **All** | **16** | **24** | **40** |

Since 2026-09-06: `base-pending` adds a `tint_manager` canView, `base-bypass` and
`base-bypass/undo` add two `tint_manager` canEdit (`§1.12`), and `ti-report` moved off
`tint_manager` onto `reports_ti_report` (`6f628b05`). Three handlers carry a second tick:
`pause-history` and `skip-history` also require `tint_panel_activity` canView (AND), and `operators`
admits `tint_manager` canView OR `reports_ti_report` canView (`§11`). ⚠ `app/api/tint/manager/splits/[id]/status/route (1).ts`
is **not a route** — a 3-line `export {}` stub ("duplicate artifact … kept to satisfy TypeScript
compilation"); Next.js serves only `route.ts`.

**The four that do not, and why:**

| Handler | Gate today | Why it is not a tick |
|---|---|---|
| `operator/shades` **GET** | `hasRole([TINT_OPERATOR, TINT_MANAGER, ADMIN])` | ⛔ **Deliberately excluded** — see below |
| `operator/shades` **POST** | same | ⛔ **Deliberately excluded** |
| `operator/shades/[id]` **PUT** | same | ⛔ **Deliberately excluded** |
| `operator/skip` **POST** | none — session, then `asg.assignedToId !== userId → 403 "Not your job"` | **Ownership, not permission.** Nothing to convert. Listed so a session that finds no `requireRole` here does not conclude it was missed. |

⛔ **The two shades WRITES were excluded on purpose, and they are retirement candidates rather than
conversion candidates.** Both write **`shade_master`, deprecated since 2026-05-25** with a standing
"do not write to it" (§14, `CLAUDE_CORE.md §13`). Wiring a modern tick — or the audit call the fifth
tint route in the audit gap still needs — into a route that writes a table scheduled for deletion is
work thrown away if the answer is "retire".
⚠ If they are ever converted, **the key choice is not cosmetic**: `shade_master`/`canEdit` is held
by Harsh and Chandresh only, so it would revoke shade writes from **Deepak Vasava and Chandrasing
Valvi — the two active operators whose screen it is**; `tint_operator`/`canEdit` keeps them. The
prior question — **does anything still call these routes?** — has an in-app answer: **nothing in
the tree calls `/api/tint/operator/shades*`** (grep 2026-09-19, by path and by the `operator/shades`
fragment: the only hit outside the route files is the comment at `tint-operator-content.tsx:886`
saying the legacy preload is gone; the Shade Master screen uses `/api/admin/shades`). An external
caller is not ruled out — that needs the Vercel logs. ROADMAP owns the decision. Their siblings `/api/admin/shades` GET and `/api/admin/shades/[id]` PATCH sit on the same
`requireRole([ADMIN, TINT_MANAGER, TINT_OPERATOR])` array and belong to the same decision.

**What moved on 2026-09-06.** Before that day **24 mutating handlers** here decided access from a
job title — a `requireRole`/`hasRole` array, or an inline `role === "admin"` bypass standing in
front of the flag. **22 converted** (the two shades writes are the exception above), in `64f897a9`
(19) and `74c51869` (3). Reads followed the same day: **13 GET handlers** moved to ticks across
`64f897a9` (2), `2b25a48f` (1) and `fbbe30bd` (10). There is now **no job-title gate left anywhere
under `app/api/tint/`** except the two shades files.

**Who that moved — verified against live rows, not inferred:**

- 🔴 **LOST: Operations User**, on 15 of the 22 writes and 10 of the 13 reads. He holds **no tick on
  either tint key**, and no `role_permissions` row has ever granted him one — he was admitted purely
  by the spelling of `operations` inside a role array. **Both tint layouts already redirected him**
  at `/tint/manager` and `/tint/operator`, so this closed a gap that was open rather than opening
  one; what he lost was reachable only by calling the endpoints directly. Intended.
- **GAINED: Prakash** (`operation_manager`), on `manual-entry` and `manual-entry/revert`. Those two
  carried the narrow `[TINT_MANAGER, ADMIN]` where every other manager route also named
  `OPERATION_MANAGER`. Owner-approved.
- **GAINED: Harsh** (the superuser), on `start` / `done` / `split/start` / `split/done`.
  🔴 **`requireRole` has no admin arm** (`lib/rbac.ts`), so those four were redirecting the owner to
  `/unauthorized`; `checkAnyPermission` carries both superuser arms and admits him. That gap is not
  tint-specific — an admin-only account is excluded from **any** gate whose array does not spell
  `admin` (`CLAUDE_CORE.md §13`).

⚠ **The lookup that shipped broken, and the shape of the failure.** `64f897a9` widened
`manual-entry` POST and did not touch `manual-entry/lookup` GET, which kept the narrow two-role
array. The modal calls the lookup first (`manual-tint-entry-modal.tsx:150`, then `:188`), so Prakash
held the write and was refused the read — **manual tint entry was broken for him for part of that
day**, fixed in `2b25a48f`. It failed **invisibly**: `requireRole` calls `redirect()`, a 307 that
`fetch` follows to `/unauthorized`; the HTML comes back 200 so `res.ok` is true, `res.json()` then
throws, and the modal's own catch swallows it into a `console.error` and an empty box. **A companion
GET must never be narrower than the write it feeds** — the route now says so in a comment. The
general form of this failure is the silent-403 pattern in `CLAUDE_CORE.md §13`.

### 13.3 `canView` is not write authority — corrected 2026-09-06

`operator/pause`, `operator/resume` and `manager/orders/[id]/remove` gated on **`canView`** while
writing three rows each. All three now gate on **`canEdit`** (`74c51869`). They changed **nobody** on
the day — the two holder sets are identical (§13.1) — and that is exactly why they were worth
closing: one view-only tick would otherwise have handed a bystander the ability to pause a live tint
job, or to remove an OBD from the board and void its challan.

🔴 **Two code comments asserted the retired model in so many words**, and were corrected in place
rather than deleted: `remove:26-27` — *"Page access = full action authority on that page (OrbitOMS
locked model)"* — and the same claim shorter at `pause:48-49`. **That model is retired.** A tick
answers one action on one page, never a page.

### 13.4 🔴 `canSeeAllOperatorRows` is a FACE branch. It must NEVER become a tick.

```ts
const canSeeAllOperatorRows = ["operations", "admin"].includes(session!.user.role ?? "");
...
where: { orderId, ...(canSeeAllOperatorRows ? {} : { assignedToId: userId }), ... }
```

It does **not** decide whether the caller may act — the tick above it already did that. It decides
**whose rows the query is allowed to touch**: an operator is scoped to his own assignments, a
supervisor sees everyone's. **Nine handlers:** `operator/start` · `done` · `split/start` ·
`split/done` · `tinter-issue` POST · `tinter-issue/[id]` PATCH · `tinter-issue-b` POST ·
`tinter-issue-b/[id]` PATCH · `operator/my-orders` GET.

**What breaks if it is converted.** Replace it with `tint_operator`/`canEdit` and every holder of
that tick — today Chandresh, Deepak and Chandrasing — takes the wide arm and can **start, finish or
edit any other operator's job.** The one-job-at-a-time rule and the "Assignment not found or not
assigned to you" 404s all hang off this branch. **It fails OPEN**, not closed — the opposite of how a
permission mistake usually presents, and the reason it would never surface as a denial anyone
reports.

🔴 **THE NEAR-MISS THIS IS NAMED AFTER.** It was called **`isOpsOrAdmin`** until `cd0ed055`, and it
sat in the same eight functions as **`isAdminOrOps`** — *one letter apart, opposite meanings*:

| Variable | Reads | Decides | Convert? |
|---|---|---|---|
| `canSeeAllOperatorRows` *(was `isOpsOrAdmin`)* | the **singular** `session.user.role` | **whose rows** the query may touch | 🔴 **NEVER** |
| `isAdminOrOps` | the **merged** role set | only whether to run the permission check | ✅ a plain bypass — converted 2026-09-06 |

The rename got **its own commit, ahead of the conversion, precisely so the distinction would survive
the edit** — the conversion changes the lines immediately above and below the FACE one in eight
files. Do not undo the name for being long. ⚠ It still reads the *singular* primary role while the
gate above it reads the merged set; that is a separate latent inconsistency, recorded and not fixed.

### 13.5 `role_permissions` SQL — THE FALLBACK, kept for rollback only

Read the red block at the top of §13 before using this. Live access is `user_page_access`.

```sql
-- FALLBACK ONLY. This is what a job title WOULD grant if ACCESS_SOURCE were
-- flipped back to 'role'. It is NOT what the app enforces (live value: 'user').
INSERT INTO role_permissions ("roleSlug", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
VALUES
  ('tint_manager', 'delivery_challans', true, false, false, true, false),
  ('tint_manager', 'shade_master',      true, false, false, true, false),
  ('tint_manager', 'ti_report',         true, false, true,  false, false)
ON CONFLICT ("roleSlug", "pageKey") DO NOTHING;
```

🔴 **Neither tint key has ever had an `operations` row** — not in `role_permissions`, not in the
ticks. The role that 15 of the 24 converted handlers named by hand was never granted tint access by
either access system; only the role arrays granted it. That is the whole of why the 2026-09-06
conversion moved exactly one person.

⚠ **`tint_manager` holds no `tint_operator` grant in the fallback, yet the 2026-09-06 holder table
(§13.1) lists Chandresh Kolgha on `tint_operator`.** That came from the 2026-09-04 fill, which
reproduced the OR-merge across all of a person's roles while he still carried `tint_operator` as a
secondary role. **That secondary role is gone:** his primary role and his only `user_roles` row are
both `tint_manager` (live 2026-09-18, Q08; removed 2026-09-06 when "Base — No Tint" replaced his
self-assign workaround — `docs/prompts/archive/2026-09/code-update-2026-09-06-tint-base-no-tint.md`). In user
mode `checkAnyPermission` reads the person's own `user_page_access` row, not their roles
(`lib/permissions.ts:801-806`), so the removal did not by itself change his `tint_operator` ticks —
and a rollback to `ACCESS_SOURCE = role` would no
longer grant him `tint_operator` at all.

Layout uses `buildNavItems()` only.

---

## 14. Landmines

- **Split/done parent auto-advance — RESOLVED 2026-06-25.** `app/api/tint/operator/split/done` previously never advanced the parent OBD after all splits finished — it marked the split done and walked away. Fixed: bubble block added (after the split update, outside any transaction, sequential awaits). Live OBD id=6478 (Pramukh Yogiwood · Silvassa) was the only stuck instance; repaired manually via SQL. **Distinct from the usage-log gap below.**
- **Split-done sampling-usage-log gap — STILL OPEN.** `split/done` does not write a `sampling_usage_log` row. Split-completed tints remain absent from Sampling Library usage history and same-site suggestions. ROADMAP item (also in CORE §13).
- **Base-bill sampling-usage-log gap — OPEN (the second one).** TIs saved on a "Base — No Tint" bill through `base-ti-panel.tsx` (`§1.12`) write no `sampling_usage_log` rows: `writeUsageLogsForAssignment` has exactly one caller, `done/route.ts:265`, and neither `tinter-issue` route writes usage. Base-bill shades are invisible to same-site suggestions, like split-done ones.
- **Schema confirmations from 06-25 session:** `order_status_logs` uses `fromStage`/`toStage` columns (NOT `previousStage`/`newStage`). `order_splits` has `totalQty` (not `skuCode`). `orders` has no `isTinting` column — tinting is determined by `orderType`.
- **~~TM reorder API uses `prisma.$transaction`~~ — ✅ FIXED 2026-09-05** (`a0f9378b`). Both
  branches are sequential awaits; arithmetic and tie-break unchanged. Detail: `§1.7`.
- **⚠ STILL OPEN — every live `prisma.$transaction` under `app/api/tint/` (grep 2026-09-19), six:**
  - `operator/split/done/route.ts:56` — the split update, logs and parent slot (`§2`)
  - `manager/splits/reassign/route.ts:50` — called by the board (`tint-manager-content.tsx:614`)
  - `manager/splits/create/route.ts:150` — no caller (`§1.11`)
  - `manager/cancel-assignment/route.ts:28`
  - `manager/splits/cancel/route.ts:43`
  - `manager/challans/[orderId]/route.ts:551` — the challan PATCH (entry below)

  The two cancel routes wrap their whole sequence in an interactive `prisma.$transaction`. Deferred on purpose —
  converting trades a pooler-timeout risk for a partial-state one (a bill reverted to Pending with
  its assignment still live, or reverted with no audit line), which is an owner decision, not a
  drive-by. Same rule as the challan PATCH entry below. ROADMAP.
- **`operatorSequence` field** on `tint_assignments`/`order_splits` — unused. Sort by `sequenceOrder` only.
  ⚠ And `sequenceOrder` is a sparse `MAX+1` value, NOT a 1..N rank — the board computes the rank it
  displays (`§1.3`).
- **~~`SlotSummaryItem` interface — defined but unused~~ — superseded 2026-09-05.** The interface
  went with the Kanban rewrite, but the underlying gap grew: `slotSummary` is still BUILT and
  RETURNED by `/api/tint/manager/orders` and is now read by nothing at all (`§1.10`). A payload
  field with no reader is the `orders.mailMatched` shape CORE §7.3 flags.
- **Four routes filtered on the non-existent status `"done"`** — fixed 2026-09-05/06. Full account
  in `§1.4`; the vocabulary now has one owner, `lib/tint/assignment-status.ts`. ⚠ The lesson
  generalises: these are plain `String` columns with no CHECK, so a wrong literal is never
  rejected — it silently matches nothing.
- **CustomerMissingSheet** styling doesn't match admin customer split-view (cosmetic).
- **Shade Master `isActive` filter** — unverified in production.
- **~~Challan lazy creation~~ — VERIFIED 2026-08-04: the `[orderId]` detail API does NOT auto-create** (no `create` call in the route; it reads the existing challan). Creation happens at import only (§9.1).
- **Challan print CSS** — old class names (`ch-header`, `tint-yes`) may persist in `@media print`.
- **`lib/slot-cascade.ts`** — no longer in the live tree: archived 2026-07-28 with the Planning board (`archive/2026-07-planning-board/lib/`), after a long period disabled. **If it is ever restored, it must skip tint orders** — that condition outlives the archive.
- **Customer master gaps:** Bill-To customers missing contacts → challan S5 CUSTOMER blanks.
- **SKU master gap:** unknown SKUs (e.g. `5888558` DP M900 Gloss Enamel BW 20L) land but enrichment is null. Add via SKU master.
- **Splits never get pause/resume.** Server rejects `splitId !== null` with 400. Acceptable for v1. Revisit if depot reality changes.
- **Pause history opens from the detail panel only** — the Activity tab's "View full pause history →" (`board-detail-panel.tsx:430`), shown when the order has pauses and the viewer holds `tint_panel_activity` (`§1.2`). The Table view whose kebab this entry used to describe was retired 2026-09-05/06 (`§1`).
- **Static `title=` tooltip on Resume (mobile).** `components/ui/tooltip.tsx` uses hover events. Touch devices won't fire (non-issue today — depot is desktop). If mobile app ever built, touch fallback needed.
- **Partial-qty done not surfaced anywhere.** `currentProgress` is stored on done but no TM screen reads it. "Short by N tins" badge not built. Decision: deferred. Open question: does challan auto-fill from assigned qty? If yes, partial-done could print wrong qty. Needs verification before partial-done is considered production-safe.
- **`shade_master` deprecated 2026-05-25.** Sampling Library Phase 4 shipped. Operator screen no longer reads `shade_master`. Table still exists with historical data, scheduled for deletion after retention window. Do not write to it. ⚠ **Two routes still write it** — `operator/shades` POST and `operator/shades/[id]` PUT — and they are the *only* job-title gates left under `app/api/tint/**` after the 2026-09-06 conversion. Held out deliberately: retire-or-convert is an owner decision, and the key choice is not cosmetic. `§13.2`.
- 🔴 **`canSeeAllOperatorRows` is a FACE branch and must never become a tick — `§13.4`.** It was `isOpsOrAdmin` until `cd0ed055`, one letter from `isAdminOrOps`, which means the opposite and *did* convert. Converting the FACE one lets any `tint_operator`/`canEdit` holder finish another operator's job, and it **fails open**, so nobody would report it.
- **Challan PATCH `prisma.$transaction` landmine** — `app/api/tint/manager/challans/[orderId]/route.ts:551`. The formula-save path is wrapped in `$transaction`. Do not extend this block — add new logic outside it or refactor to sequential awaits as a separate task. Pre-existing.
- **Challan cell-clear UX bug** — `components/tint/challan-content.tsx:211-213` filters empty strings out of PATCH body. Server has no delete branch. Clearing a cell in the UI does NOT clear the DB row, so a TM can't "unlock" a manually-overridden formula by clearing it. Mitigation if unlock is ever needed: build a proper "Reset to auto" button. (CORE §13 also lists this.)
- **Tint sampling siteId bug — FIXED 2026-06-01** (commit `df7e61e9`). Mark-Done was writing `sampling_usage_log.siteId = null` since Phase 4 ship. Fixed by passing `orders.customerId` (= ship-to FK) into the writer. Backfill applied via OBD→order link (preferred over name match). Lesson: `orders.customerId` IS the resolved ship-to site FK, NOT the bill-to dealer. The suggestion engine matches on `usage_log.siteId` STRICTLY — null rows are invisible to same-site suggestions.
- **Pre-existing $transaction in admin customer routes** (lines 133 + 186) — left untouched in multi-SO commit. Refactor when convenient (CORE §13).
- **Edit-path modal gate (open).** The "Update TI Entry" path (editing an already-saved line) does NOT run the formula-match gate and does not resolve/mint a sampling for a typed-fresh shade — it can save with a null `samplingNo` and no modal. The gate lives only in Save-TI / `handleSubmitTI`. Needs the same gate on the edit/update path.
- **Cross-type rows in reuse list (low pri).** A TINTER line's reuse list still shows ACOTONE shades from the same site (rendered plain, never scaled). Consider filtering to the line's tinter type. Deferred.
- **Scratch-file tsc noise.** Untracked `scripts/_*` scratch files (sampling/report seed helpers) throw ~24 `tsc --noEmit` errors; never committed. Exclude `scripts/_*` from tsconfig or delete so the tsc gate stays clean.

---

## Change log — v2.2 (2026-09-19 canon sweep, batch B2)

Evidence: code at HEAD `915f46f2` read at the call sites; live CSV `sql-2026-09-18-canon-sweep-live-results.csv` (Q02, Q03a/b, Q08); commits `b3dfe5b8`, `c9ef1c31` → `e12ce9e9`, `0fbcd4be`, `6f628b05`, `dfd9b669`, `c5b2e783`, `73a762e8`, `b585240f`.

- §2 / §2.1 / §1.3 (REVERSAL): a finished tint bill goes to `pending_picking` + `dispatch` + `resolveCompletionSlot`; `pending_support` only when held — done, split/done bubble and base-bypass. §2.1's no-slot reasoning replaced by one "Was … Do not revert." line; inline IST ladder named in place of `resolveSlot()`; upstream → `CLAUDE_IMPORT.md §2.1`.
- NEW §1.12 "Base — No Tint" bypass: bypass / undo / base-pending routes, placeholder worker, exclusions and admissions, `base-ti-panel.tsx`, and the Undo-vs-`dispatchSlotSource: "auto"` defect. §1 key files, §1.2 (second rail list, panel-tab ticks), §1.5 (third Assign choice), §1.9 (marker arms) follow.
- §1.1 / §1.2 / §4 / §5 / §11 / §12 / §13.1: panel-tab and report ticks; `ti_report` gates nothing; Tint Summary live oddity (Operations User only).
- §13.2 recounted (40 files / 44 handlers / 40 ticked); `route (1).ts` stub; shades callers answered. §13.5: Chandresh's secondary role gone (Q08).
- §14: all six live `$transaction`s listed; Base usage-log gap; Table-kebab entry replaced.
- §3 / §3.1 / §3.8 / §3.11 / NEW §3.13: operator History face, `my-orders` UTC-midnight defect, "+N packs"; §7 anchors + `MANUAL_TINT_PULLABLE_STAGES`; §8 Remove OBD surfaces + gate; §9 `/tint/manager/challan` + `/challan`; §10 `/tint/shades`; second mounts `/admin/tint-manager`, `/operations/tint-operator`; colours (tint token, warn Split tag, violet challan selection).
- §3 key files: `components/tint/ResumeBlockedTooltip.tsx` dropped — `git log --all` has no history for it; it never existed.
- Schema stamp v27.13 → v27.24 (read against CORE v27.24; no tint table changed).

## Change log — v1.9 (2026-08-04 reconciliation pass, method v1.1)

Evidence: done/split routes + challan routes + globals.css read at the call sites; CORE v91 / FLOOR v1.4 / UI v5.17 anchors; git (`7e466776`). Claim IDs from the session report.

- TNT-1 (§2): the pre-set-slot completion branch writes **`SUPPORT_DONE_OUTPUT` ("pending_picking")**, NOT `"closed"` — corrected against both done routes; the stale "closed+dispatch" CODE COMMENT at `split/done/route.ts:169` flagged (not edited).
- TNT-2 (NEW §2.1): tint-side facts for the Floor rail suggestion — `completedAt` as the anchor (write sites named), the deliberate no-preset-at-completion decision (the `hasPresetSlot` trap from the tint side), and the Floor-payload `completedAt` ISO-string re-type (`7e466776`).
- TNT-3 (§2): the standing "FLAG FOR CORE PASS — CORE §9 needs one sentence" resolved — CORE v91 §9 already carries it.
- TNT-4 (header): Prakash / operation_manager lands on `/tint/manager` — access line updated per CORE v91 §5.
- TNT-5 (§14): challan lazy-creation landmine VERIFIED closed (the `[orderId]` route has no create call); `@page` top-level + the PATCH `$transaction` at `:527` re-confirmed as documented.
- Hygiene: Support @112 (one-line history) and the `/order`/`/operations` hits (route-path + role-list overmatches) all verified legitimate — none changed.

- Schema stamp -> v27.13 (final-pass 12b, 2026-08-05).

---

*Tint v2.2 · Schema v27.24 · OrbitOMS · updated 2026-09-19 — **reconciled to code + live (canon sweep B2).** A finished tint bill now goes straight to `pending_picking` with a completion slot (`b3dfe5b8`) — `pending_support` only when held; the "Base — No Tint" bypass gets its first canon (§1.12); panel-tab and report ticks documented; §13.2 recounted; operator History added. Full list: the v2.2 change-log entry. Prior, v2.1 (2026-09-06): **§13 rewritten end to end for the user-based access conversion** (`cd0ed055` → `fbbe30bd`, all pushed). The old §13 was nine lines that listed three page keys and reproduced a `role_permissions` INSERT **as if it were the access model**; under `ACCESS_SOURCE = 'user'` (live since 2026-09-04) that table is the FALLBACK a rollback reads, and it is now framed as one and kept, not deleted. What replaced it is derived from the tree rather than quoted: `app/api/tint/**` holds **37 route files and 41 handlers**, and **37 of the 41 gate on a `tint_manager`/`tint_operator` tick** — 23 manager (11 canView + 12 canEdit) and 14 operator (4 + 10). The four that do not are the **three `operator/shades` handlers**, excluded by owner decision because they write the deprecated `shade_master` and are retirement candidates, and **`operator/skip`**, which is ownership-scoped and has nothing to convert. §13.2 names who moved — Operations User lost 15 writes and 10 reads and held no tint tick under either access system; Prakash gained manual-entry; the superuser gained the four operator writes `requireRole`'s missing admin arm had been redirecting him out of — and records the lookup that shipped broken for half a day and **failed silently**, because a 307 into an HTML page is a 200 that `res.json()` throws on. §13.3 records the three `canView`-on-a-write routes moved to `canEdit`, and that **two code comments asserting "page access = full action authority" were corrected in place**. 🔴 §13.4 is new and is the one to read before touching an operator route: **`canSeeAllOperatorRows` is a FACE branch that must NEVER become a tick** — it decides whose rows may be touched, not whether the caller may act, and it fails **open**; it was `isOpsOrAdmin` until `cd0ed055` renamed it, one letter from `isAdminOrOps`, which means the opposite and did convert. §7 gains the answer to the question that left manual tint entry unverified: **there is no button labelled "Manual Entry"** — it is the **"Add to Tint"** pill at `tint-manager-content.tsx:715` and the **`M`** shortcut at `:322`. §14 gains two cross-references. Schema stamp UNCHANGED at v27.13 — the access conversion minted no schema version and touched no column. Prior, v2.0 (2026-09-06): **§1 rewritten end to end for the board rebuild** (`a0f9378b` → `082eb92e`, all pushed): the 4-column Kanban and its card/table view toggle are gone, replaced by a 344px pending-only rail + ONE operator-grouped table + a 480px detail panel. New subsections cover the 10 columns (SMU short code, Bill To vs Ship To as two real parties), the computed `#` rank and the fact that ORDERS AND SPLITS CARRY SEPARATE SEQUENCES, `lib/tint/assignment-status.ts` as the status-vocabulary owner, the `assigned`-only re-assign rule now enforced server-side with a 400, Send back to Pending, and the new 15s marker. §1.1 states plainly that this screen did NOT become a second UniversalHeader exception — only the operator segment pills were dropped — and points at `CLAUDE_UI.md §6` rather than restating the wiring. §14: the reorder `` landmine is CLOSED, and the two cancel routes are recorded as where that debt now sits; the `SlotSummaryItem` entry is superseded by a larger gap (`slotSummary` is returned and read by nothing). Schema stamp UNCHANGED at v27.13 — the rebuild minted no schema version, and every new payload field reads a column that already existed. Prior, v1.9 (2026-08-04 reconciliation pass, method v1.1) — change log below.*
