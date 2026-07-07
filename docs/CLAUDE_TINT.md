# CLAUDE_TINT.md — Tint Module
# v1.6 · Schema v27.9 · July 2026
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Covers Tint Manager, Tint Operator (incl. skip, pause/resume, partial done, sampling reuse + pack scaling), Manual Tint Entry, Delivery Challans (incl. void), Shade Master (legacy), TI Report, Tint Summary report, Remove OBD.

Users: Chandresh Kolgha (tint_manager), Deepak Vasava + Chandrasing Valvi (tint_operator).

Sampling Library is a SEPARATE module — see `CLAUDE_SAMPLING_LIBRARY.md`.

---

## 1. Tint Manager — /tint/manager

Primary user: Chandresh.

**Key files:**
- `components/tint/tint-manager-content.tsx`
- `components/tint/tint-table-view.tsx`
- `components/tint/PauseHistoryModal.tsx`
- `components/tint/SkipHistoryModal.tsx`
- `components/tint/RemoveObdModal.tsx`
- `app/api/tint/manager/orders/route.ts`
- `app/api/tint/manager/missing-customers/route.ts`
- `app/api/tint/manager/reorder/route.ts`
- `app/api/tint/manager/assign/route.ts`
- `app/api/tint/manager/orders/[id]/remove/route.ts`
- `app/api/tint/manager/orders/[id]/pause-history/route.ts`
- `app/api/tint/manager/orders/[id]/skip-history/route.ts`

### 1.1 Header (UniversalHeader, two-row)

**Row 1:** Title "Tint Manager" · stats · clock · shortcuts · search.

**Row 2:** Operator workload pills (leftExtra) · missing-customer badge (rightExtra) · View toggle · Filter dropdown.

**No slot segments, no date stepper.** Always live view.

### 1.2 Operator workload pills

- "Unassigned · N" pill: count of orders in Pending column
- One pill per operator from `/api/tint/manager/operators`: count = assigned + in-progress combined
- Tap to filter all 4 columns; tap again to deselect

### 1.3 Missing customer badge (rightExtra)

Amber pill "N missing" when count > 0. Both tint and non-tint orders for SMU = "Retail Offtake" / "Decorative Projects".

Click opens `CustomerMissingSheet`. Re-fetches on resolve.

Endpoint: `GET /api/tint/manager/missing-customers`.

### 1.4 Delivery type filter

Values must match DB exact casing: `Local`, `Upcountry`, `IGT`, `Cross Depot`.

### 1.5 Kanban 4 columns

Pending | Assigned | In Progress | Completed.

Column pills: all neutral `bg-gray-100`. No semantic colours on column headers.

### 1.6 Card / row content

Every card:
- OBD (mono) · orderDateTime
- Age badge when 1+ days old
- Customer / Site name
- SMU, Priority, Articles, Volume
- Operator avatar (22×22px)
- Re-assign action (Assigned rows)
- Dispatch status badge inline next to site name
- **Paused pill (stage-agnostic):** amber `⏸ Paused (N/3)`
- **Skipped pill (pending stage):** gray `↩ Skipped {N}×`

Card sort: `sequenceOrder ASC → priorityLevel ASC → date ASC`.

### 1.7 Table view

`<table>` with `table-layout: fixed` per `CLAUDE_UI.md §33`. 9 columns, widths 4/13/10/18/7/9/6/15/10/8%.

First column `#`: 1-based serial counter per section. "Customer" renamed to "Site Name". Slot column removed. Re-assign action in Assigned rows. Roomy spacing (10px vertical, 14px horizontal padding).

Pause + Skip pills + kebab items same as kanban cards.

### 1.8 Sequence order — single source

Operator reads `sequenceOrder` (NOT `operatorSequence`).

**Per-operator reorder:** Move up/down only swaps within same operator. API: `/api/tint/manager/reorder` finds target order's operator, filters list, swaps.

**New assignments** get `sequenceOrder = MAX + 1` (FIFO).

### 1.9 Customer missing flow

`customerMissing` boolean on `orders`. Badge in header Row 2 rightExtra for SMU = "Retail Offtake" / "Decorative Projects". Click opens `CustomerMissingSheet`.

### 1.10 API data

`GET /api/tint/manager/orders` returns slot/deliveryType, slotSummary, orderDateTime on all payloads. Also: `pauseCount`, `lastPausedAt`, `currentProgress` (from `tint_assignments`).

---

## 2. Slot assignment for tint orders

See `CLAUDE_CORE.md §9` (⚠ CORE §9 has a pending update from this section — see the flag at the end of this section).

- At import: `orderType === "tint"` → `slotId = null`, `originalSlotId = null`
- **`arrivalSlotId` — now stamped at import for tint orders too (2026-06-29) [LIVE].** Previously tint orders got `arrivalSlotId = null` at import (the `orderType !== "tint"` guard). That guard was removed from both import paths (`handleManualSapConfirm` and the auto-import confirm path in `app/api/import/obd/route.ts`) — tint orders now get `arrivalSlotId = resolveArrivalSlotId(emailDateTime)` (the 5-slot ruler), exactly like non-tint orders. This is separate from `slotId`/`originalSlotId`, which remain null until completion (unchanged, see below). No backfill was run — applies to NEW orders only. See CLAUDE_IMPORT.md §12 for the import-side detail.
- At completion (whole order, `/api/tint/operator/done`): sets `slotId` + `originalSlotId` on order using `resolveSlot()` thresholds on current IST time
- **Completion now branches on a pre-set dispatch slot (2026-06-29) [LIVE].** If `order.dispatchWindowId != null && order.dispatchTargetDate != null` (an operator pre-set a slot on the Support board while the order was still tinting — see `CLAUDE_SUPPORT.md §4.16`), completion additionally writes `workflowStage: "closed"`, `dispatchStatus: "dispatch"` — the order auto-flips to Dispatch and leaves the pending list, made actionable/visible on Support as a done row instead of landing back in `pending_support`. If no slot was pre-set, behaviour is unchanged: `workflowStage: "pending_support"`.
- At split completion (`/api/tint/operator/split/done`): sets slot on **parent** order. Latest completion wins. The same pre-set/auto-flip branch applies to the parent-bubble update (runs after the `$transaction`, not inside it — no new landmine interaction).
- **Parent auto-advance (2026-06-25 fix):** after setting the slot, the route checks whether all non-cancelled splits are now `tinting_done`. If yes AND parent is still `tinting_in_progress`, it advances the parent to `workflowStage = "pending_support"` and writes an `order_status_logs` entry (`changedById: 1`, note `"Auto-advanced: all splits tinting_done"`). Guard is idempotent (`workflowStage === "tinting_in_progress"`). **Cancelled splits are excluded from the count — non-negotiable for correctness.**
- No buffer before cutoff
- `applyMailOrderEnrichment()` skips recalculation of **`slotId`/`originalSlotId` only** for tint orders. It does **not** skip `arrivalSlotId` — that field is stamped for every mail-matched order regardless of `orderType` (not tint-guarded), and always has been.

⚠ **FLAG FOR CORE PASS (step 6):** CORE §9 needs one sentence added: *"`arrivalSlotId` is set at import for ALL orders (tint and non-tint) via `resolveArrivalSlotId(emailDateTime)`. `slotId` stays null for tint until completion."* Not applied here — CORE is out of scope for this pass.

---

## 3. Tint Operator — /tint/operator

Primary users: Deepak, Chandrasing.

**Key files:**
- `components/tint/tint-operator-content.tsx`
- `components/tint/PauseJobModal.tsx`
- `components/tint/SkipJobModal.tsx`
- `components/tint/MarkDoneConfirmModal.tsx`
- `components/tint/ResumeBlockedTooltip.tsx`
- `app/api/tint/operator/my-orders/route.ts`
- `app/api/tint/operator/done/route.ts`
- `app/api/tint/operator/start/route.ts`
- `app/api/tint/operator/pause/route.ts`
- `app/api/tint/operator/resume/route.ts`
- `app/api/tint/operator/skip/route.ts`

Visual spec: `CLAUDE_UI.md §34-38`.

### 3.1 Layout

- Row 1: UniversalHeader title "My Jobs", stats (queue/active/done/paused)
- Row 2: Job filter as teal-600 segment pill (leftExtra). Click opens 400px dropdown with **3 sections: CURRENT / PAUSED / UP NEXT**. Progress bar (rightExtra)
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

Both operator card (1s tick) and table view (60s tick) delegate to this helper. `TintAssignmentInfo` TS interface gained `accumulatedMinutes`.

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

> ⚠️ Superseded (do not reintroduce): the earlier flat list that auto-scaled every row to the line pack with ✓ (exact) / ×N (scaled) markers + the `scalingEnabled` prop. Replaced by the pack-filter list above.

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
| GET | `/api/tint/manager/orders/[id]/skip-history` | TM/Admin | Full skip history modal |

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
| GET | `/api/tint/manager/orders/[id]/pause-history` | TM/Admin | Chronological list, oldest first |

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

**Schema:**
```
manual_tint_entries
  id, orderId (FK → orders), lineIds (JSON array),
  reason TEXT, createdBy (FK → users), createdAt
```

**Behaviour:** Additive only — does not modify auto-classification at import. Adds OBD to tint workflow with chosen lines flagged.

---

## 8. Remove OBD (TM soft-delete)

Soft-delete OBD with audit trail. Voids linked challan.

### Locked behaviour

- Soft delete only (no hard delete)
- Removable by: users with TM-delete-right OR Admin
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
| POST | `/api/tint/manager/orders/[id]/remove` | TM-delete or Admin | Soft-remove + void challan |
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
- `lib/slot-cascade.ts`, `lib/day-boundary.ts` — disabled per landmines
- Challan list/detail uses `OR: [{ isRemoved: false }, { isRemoved: true, challan: { isVoided: true } }]` so voided-challan rows on removed orders surface for audit

### UI

- TM Kanban card → 3-dot menu → "Remove OBD" → `RemoveObdModal`
- TM Table view → same 3-dot menu in row (primary use)
- Modal: reason radios + mandatory remark + warning about challan void
- Voided challan: diagonal red watermark + disabled Print/PDF + red banner with reason/remark/who/when
- `/admin/removed-orders` — table with Restore action

### Schema

`orders` v27.3: `isRemoved BOOLEAN DEFAULT false`, `removalReason TEXT`, `removalRemark TEXT`, `removedAt TIMESTAMPTZ`, `removedById INT`, `restoredAt`, `restoredById`.

`delivery_challans` v27.3: `isVoided BOOLEAN DEFAULT false`, `voidReason TEXT`, `voidRemark TEXT`, `voidedAt TIMESTAMPTZ`.

---

## 9. Delivery Challan — /tint/manager/challans

TM screen.

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

- 320px left panel: compact 3-line rows. Selected: `bg-teal-50 + border-l-teal-600`
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

- 2-row UniversalHeader
- IosToggle, type filter (TINTER/ACOTONE), pack filter, pagination
- Columns: # | Shade Name | Customer ID | Type | SKU Code | Pack | Status | Active | Added By | Added At

---

## 11. TI Report — /reports?r=ti-report

**Folded into the Reports hub** (2026-06-17). No longer a standalone sidebar item — old URLs `/tint/manager/ti-report` and `/ti-report` redirect to `/reports?r=ti-report`; the `ti_report` permission gates the hub. Hub layout + the new Tint Summary report: `CLAUDE_UI.md §56` + §12 below. Report content itself unchanged:

- `DateRangePicker` with presets (leftExtra)
- Inline shade expand
- Download Excel button
- Filter: operator + type
- Columns: chevron | Date | OBD No. | Dealer | Site | Base | Pack | Tins | Operator | Time

**Acotone shade columns** in the report + inline shade-expand + XLSX export follow the locked register order (§3.5), driven from a single `ACOTONE_SHADES` array in `ti-report-content.tsx`: `WH1, NO1, NO2, YE1, YE2, XY1, RE1, RE2, XR1, MA1, OR1, GR1, BU1, BU2`. Pre-change printed/exported reports won't match the new on-screen order — accepted, no migration.

---

## 12. Tint Summary report — /reports/tint-summary

Read-only daily MIS report (no DB writes). Data source-of-truth: `lib/reports/tint-summary-data.ts` (`getTintSummaryData(params)`), used by both the JSON API (`GET /api/reports/tint-summary`, auth tint_manager/admin/operations) and the page. Print document visual spec + Reports hub: `CLAUDE_UI.md §56`.

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

Three TM page keys in `lib/permissions.ts`:
- `delivery_challans`
- `shade_master`
- `ti_report`

`sampling_library` page key is shared with operators — see `CLAUDE_SAMPLING_LIBRARY.md`.

`removed_orders` page key is admin-only.

`role_permissions` SQL:
```sql
INSERT INTO role_permissions ("roleSlug", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
VALUES
  ('tint_manager', 'delivery_challans', true, false, false, true, false),
  ('tint_manager', 'shade_master',      true, false, false, true, false),
  ('tint_manager', 'ti_report',         true, false, true,  false, false)
ON CONFLICT ("roleSlug", "pageKey") DO NOTHING;
```

Layout uses `buildNavItems()` only.

---

## 14. Landmines

- **Split/done parent auto-advance — RESOLVED 2026-06-25.** `app/api/tint/operator/split/done` previously never advanced the parent OBD after all splits finished — it marked the split done and walked away. Fixed: bubble block added (after the split update, outside any transaction, sequential awaits). Live OBD id=6478 (Pramukh Yogiwood · Silvassa) was the only stuck instance; repaired manually via SQL. **Distinct from the usage-log gap below.**
- **Split-done sampling-usage-log gap — STILL OPEN.** `split/done` does not write a `sampling_usage_log` row. Split-completed tints remain absent from Sampling Library usage history and same-site suggestions. ROADMAP item (also in CORE §13).
- **Schema confirmations from 06-25 session:** `order_status_logs` uses `fromStage`/`toStage` columns (NOT `previousStage`/`newStage`). `order_splits` has `totalQty` (not `skuCode`). `orders` has no `isTinting` column — tinting is determined by `orderType`.
- **TM reorder API** (~line 429) uses `prisma.$transaction` — violates CORE §3, left as-is for simple two-update swap.
- **`operatorSequence` field** on `tint_assignments`/`order_splits` — unused. Sort by `sequenceOrder` only.
- **`SlotSummaryItem` interface** in `tint-manager-content.tsx` — defined but unused.
- **CustomerMissingSheet** styling doesn't match admin customer split-view (cosmetic).
- **Shade Master `isActive` filter** — unverified in production.
- **Challan lazy creation** — `[orderId]` detail API may still auto-create on click. Verify.
- **Challan print CSS** — old class names (`ch-header`, `tint-yes`) may persist in `@media print`.
- **`lib/slot-cascade.ts`** — disabled. If re-enabled, must skip tint orders.
- **Customer master gaps:** Bill-To customers missing contacts → challan S5 CUSTOMER blanks.
- **SKU master gap:** unknown SKUs (e.g. `5888558` DP M900 Gloss Enamel BW 20L) land but enrichment is null. Add via SKU master.
- **Splits never get pause/resume.** Server rejects `splitId !== null` with 400. Acceptable for v1. Revisit if depot reality changes.
- **Pause kebab on Table is pending-stage only.** In Progress and Completed Today sections have no kebab columns. Pause **badge** works everywhere; kebab entry is pending-only. Four other entry points cover the gap.
- **Static `title=` tooltip on Resume (mobile).** `components/ui/tooltip.tsx` uses hover events. Touch devices won't fire (non-issue today — depot is desktop). If mobile app ever built, touch fallback needed.
- **Partial-qty done not surfaced anywhere.** `currentProgress` is stored on done but no TM screen reads it. "Short by N tins" badge not built. Decision: deferred. Open question: does challan auto-fill from assigned qty? If yes, partial-done could print wrong qty. Needs verification before partial-done is considered production-safe.
- **`shade_master` deprecated 2026-05-25.** Sampling Library Phase 4 shipped. Operator screen no longer reads `shade_master`. Table still exists with historical data, scheduled for deletion after retention window. Do not write to it.
- **Challan PATCH `prisma.$transaction` landmine** — `app/api/tint/manager/challans/[orderId]/route.ts:527`. The formula-save path is wrapped in `$transaction`. Do not extend this block — add new logic outside it or refactor to sequential awaits as a separate task. Pre-existing.
- **Challan cell-clear UX bug** — `components/tint/challan-content.tsx:211-213` filters empty strings out of PATCH body. Server has no delete branch. Clearing a cell in the UI does NOT clear the DB row, so a TM can't "unlock" a manually-overridden formula by clearing it. Mitigation if unlock is ever needed: build a proper "Reset to auto" button. (CORE §13 also lists this.)
- **Tint sampling siteId bug — FIXED 2026-06-01** (commit `df7e61e9`). Mark-Done was writing `sampling_usage_log.siteId = null` since Phase 4 ship. Fixed by passing `orders.customerId` (= ship-to FK) into the writer. Backfill applied via OBD→order link (preferred over name match). Lesson: `orders.customerId` IS the resolved ship-to site FK, NOT the bill-to dealer. The suggestion engine matches on `usage_log.siteId` STRICTLY — null rows are invisible to same-site suggestions.
- **Pre-existing $transaction in admin customer routes** (lines 133 + 186) — left untouched in multi-SO commit. Refactor when convenient (CORE §13).
- **Edit-path modal gate (open).** The "Update TI Entry" path (editing an already-saved line) does NOT run the formula-match gate and does not resolve/mint a sampling for a typed-fresh shade — it can save with a null `samplingNo` and no modal. The gate lives only in Save-TI / `handleSubmitTI`. Needs the same gate on the edit/update path.
- **Cross-type rows in reuse list (low pri).** A TINTER line's reuse list still shows ACOTONE shades from the same site (rendered plain, never scaled). Consider filtering to the line's tinter type. Deferred.
- **Scratch-file tsc noise.** Untracked `scripts/_*` scratch files (sampling/report seed helpers) throw ~24 `tsc --noEmit` errors; never committed. Exclude `scripts/_*` from tsconfig or delete so the tsc gate stays clean.

---

*Tint v1.6 · Schema v27.9*
