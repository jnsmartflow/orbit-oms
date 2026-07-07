# Discovery: Tint orders in Support — slot stamping + board visibility
# 2026-06-27 · Read-only (Prompt 1 of 2)

This file maps the CURRENT system state for import slot stamping, today-board exclusions,
tint status display, and tint-completion auto-dispatch. Prompt 2 will append areas E (schema
changes) and F (implementation plan) below the sentinel at the end.

Files read:
- `docs/CLAUDE_CORE.md` (v77)
- `docs/CLAUDE_SUPPORT.md` (v1.1)
- `docs/CLAUDE_TINT.md` (v1.5)
- `docs/CLAUDE_IMPORT.md` (v1.1)
- `app/api/import/obd/route.ts`
- `app/api/support/orders/route.ts`
- `app/api/support/slots/route.ts`
- `app/api/tint/operator/done/route.ts`
- `app/api/tint/operator/split/done/route.ts`
- `components/support/support-orders-table.tsx`
- `lib/slots/slot-ruler.ts`

---

## Area A — Import arrival stamp

### A1. Where a NON-tint order gets `arrivalSlotId`

**File:** `app/api/import/obd/route.ts` — `handleManualSapConfirm`, line 1021

```typescript
// Line 1017-1021:
// Tint orders: slot assigned at tinting completion, not import
const { dispatchSlot, slotId } = orderType === "tint"
  ? { dispatchSlot: null as string | null, slotId: null as number | null }
  : resolveSlot(summary.obdEmailTime);
const arrivalSlotId = orderType !== "tint" && emailDateTime ? resolveArrivalSlotId(emailDateTime) : null;
```

`emailDateTime = mergeEmailDateTime(summary.obdEmailDate, summary.obdEmailTime)` — a full UTC
datetime built from the SAP OBD email date + time columns.

`resolveArrivalSlotId` is imported from `lib/slots/slot-ruler.ts` (see cutoffs below).

The same pattern appears in the auto-import path at **line 2822** (identical expression, same result).

**Cutoffs (from `lib/slots/slot-ruler.ts` lines 13-18):**

```typescript
export const DEFAULT_SLOT_CUTOFFS: SlotCutoffs = {
  morning:     630,   // ≤ 10:30 → slot 1 (Morning)
  afternoon:   750,   // ≤ 12:30 → slot 2 (Afternoon)
  evening:     1020,  // ≤ 17:00 → slot 3 (Evening)
  lateEvening: 1200,  // ≤ 20:00 → slot 7 (Late Evening — id=7, not sequential)
  // > 20:00   → slot 4 (Night)
};
```

Note: **inclusive boundaries** (`≤`, not `<`). Five slots including Late Evening (id=7). Distinct
from the old inline `resolveSlot()` function in the same route (which uses 4 slots and exclusive `<`).

The old `resolveSlot()` (lines 134-?) only sets `slotId` / `dispatchSlot` labels. `arrivalSlotId`
always uses the new `resolveArrivalSlotId` from `slot-ruler.ts`.

**Plain note:** A non-tint order at import always gets `arrivalSlotId` stamped from the OBD email
datetime via the 5-slot ruler. A tint order gets `null` (by the `orderType !== "tint"` ternary).

---

### A2. SAP import vs enrichment — when each sets `arrivalSlotId`

**SAP import (create path):** `arrivalSlotId` is set in the `orderData` object passed to
`prisma.orders.createMany` (line 1052):

```typescript
// Lines 1041-1052:
orderData: {
  ...
  slotId,
  originalSlotId: slotId,
  arrivalSlotId,       // ← set here for non-tint; null for tint
  ...
}
```

**Enrichment (`applyMailOrderEnrichment`):** `arrivalSlotId` is ALSO written at enrichment for every
order that has a matching `soNumber` in `mo_orders`. Lines 286-295:

```typescript
// Lines 286-295 (inside applyMailOrderEnrichment for-loop, per matching mail order):
// arrivalSlotId: received-vs-punch same-IST-day rule.
// Same day → slot from receivedAt (order arrived and was punched today).
// Different day (carried over) → slot from punchedAt.
// punchedAt null → fall back to receivedAt.
const receivedIST = mailOrder.receivedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const punchedIST  = mailOrder.punchedAt?.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) ?? null;
const arrivalBase = (punchedIST === null || receivedIST === punchedIST)
  ? mailOrder.receivedAt
  : mailOrder.punchedAt!;
updateData.arrivalSlotId = resolveArrivalSlotId(arrivalBase);
```

**CRITICAL:** The `orderType !== "tint"` guard (lines 272-284) only protects `slotId` /
`originalSlotId`. It does NOT guard `arrivalSlotId`. So:

- Tint orders WITH a matching mail order → `arrivalSlotId` IS set by enrichment (overwrite of null).
- Tint orders WITHOUT a matching mail order → `arrivalSlotId` stays null.

**Plain note:** Non-tint orders get `arrivalSlotId` at import. Tint orders get it only if they
happen to have a `soNumber` match in `mo_orders` (typically Retail Offtake / Decorative Projects
with a mail order). Tint orders without a mail match permanently have `arrivalSlotId = null`.

---

### A3. Tint order `arrivalSlotId` at import

Confirmed null. Same line 1021:

```typescript
const arrivalSlotId = orderType !== "tint" && emailDateTime ? resolveArrivalSlotId(emailDateTime) : null;
//                    ^^^^^^^^^^^^^^^^^^^^^^^^ false for tint → short-circuit → null
```

The `orderInterims[i].orderData.arrivalSlotId` is `null`. When passed to `createMany`, the DB row
has `arrivalSlotId = NULL`.

---

### A4. Does enrichment ever write or overwrite `arrivalSlotId`?

**Yes — always writes for matched orders regardless of `orderType`.** Lines 286-295 (quoted in A2).

There is NO `if (orderType !== "tint")` guard around the `arrivalSlotId` write in enrichment.
This is in contrast to `slotId`/`originalSlotId` which ARE tint-guarded (lines 276-284).

The `updateData.arrivalSlotId` line sits outside the tint-guard block:

```typescript
// Lines 272-296 (simplified):
const matchingOrder = await prisma.orders.findFirst({ where: { soNumber: soNum }, select: { orderType: true } });
if (matchingOrder?.orderType !== "tint") {          // ← ONLY guards slotId
  updateData.slotId = slotId;
  updateData.originalSlotId = slotId;
}

// arrivalSlotId: no tint-guard — runs for ALL order types
const arrivalBase = (punchedIST === null || receivedIST === punchedIST)
  ? mailOrder.receivedAt : mailOrder.punchedAt!;
updateData.arrivalSlotId = resolveArrivalSlotId(arrivalBase);
```

**Plain note:** `applyMailOrderEnrichment` already sets `arrivalSlotId` for tint orders that have
a mail match. The "tint slot gap" only affects tint OBDs without a mail order match (e.g. orders
that come in without a prior mail order, or from non-qualifying SMUs).

---

## Area B — Today-board hide-list

### B1. `orders/route.ts` today stage exclusion

**File:** `app/api/support/orders/route.ts` lines 84-88

```typescript
// Lines 80-88 (today path, section=slot):
if (!isHistoryView) {
  if (slotIdStr) where.arrivalSlotId = parseInt(slotIdStr, 10);
  where.OR = [
    { workflowStage: { notIn: ["dispatched", "cancelled", "closed", "order_created", "pending_tint_assignment"] },
      obdEmailDate: { gte: istStart, lt: istEnd } },
    { workflowStage: { in: ["closed", "dispatched", "cancelled"] },
      obdEmailDate: { gte: istStart, lt: istEnd } },
  ];
}
```

**Hidden (notIn):** `dispatched`, `cancelled`, `closed`, `order_created`, `pending_tint_assignment`

**Shown:** everything else, which today includes: `pending_support`, `tinting_done`,
`tinting_in_progress`, `tint_assigned`.

So mid-tint orders (`tinting_in_progress`, `tint_assigned`) APPEAR in the unfiltered Support list
(they show with the purple TINTING pill). Only the very first tint stage (`pending_tint_assignment`)
is deliberately hidden from Support.

The second OR arm `{ workflowStage: { in: ["closed", "dispatched", "cancelled"] }, ... }` adds
today's done rows. Combined with the first arm, today-active orders (non-closed) appear
carry-over style with no date fence; today-done rows are date-fenced to today.

---

### B2. `slots/route.ts` — per-slot counts stage filters (today path)

**File:** `app/api/support/slots/route.ts` lines 150-178

**`pendingCount` (today):**
```typescript
// Lines 151-159:
const pendingCount = await prisma.orders.count({
  where: {
    arrivalSlotId: slot.id,                                // ← hard equality, null excluded
    workflowStage: { in: ["pending_support", "tinting_done"] },
    dispatchStatus: null,
    isRemoved: false,
    obdEmailDate: { gte: todayStart, lt: todayEnd },
  },
});
```

**`tintingCount` (today):**
```typescript
// Lines 171-178:
const tintingCount = await prisma.orders.count({
  where: {
    arrivalSlotId: slot.id,                                // ← hard equality, null excluded
    workflowStage: { in: ["tinting_in_progress", "tint_assigned"] },
    isRemoved: false,
    obdEmailDate: { gte: todayStart, lt: todayEnd },
  },
});
```

Both use `arrivalSlotId: slot.id` — a Prisma hard equality that generates `WHERE "arrivalSlotId" = N`.
A NULL `arrivalSlotId` never matches any slot `N`. Tint orders without a mail-match stay null →
excluded from every slot's badge count.

**History path per-slot counts** (lines 76-109) have a fallback:
```typescript
OR: [
  { arrivalSlotId: slot.id },
  { arrivalSlotId: null, originalSlotId: slot.id },   // ← null fallback via originalSlotId
]
```

Today has no such fallback. History does. This is the asymmetry.

**`doneCount` (today, lines 132-147):** No `arrivalSlotId` filter — it's global, not per-slot.
```typescript
doneCount = await prisma.orders.count({
  where: {
    AND: [{
      obdEmailDate: { gte: todayStart, lt: todayEnd },
      isRemoved: false,
      OR: [
        { workflowStage: { in: ["dispatched", "closed"] } },
        { dispatchStatus: "hold" },
        { workflowStage: "cancelled" },
      ],
    }, hideExclusion],
  },
});
```
Tint orders DO count in `doneCount` once they're closed/held (no slot filter). But per-slot
`pendingCount`/`tintingCount` exclude null-slot tint orders.

---

### B3. Every stage-exclusion or slot-filter point across both files

**`app/api/support/orders/route.ts`:**

| Location | Condition | Scope |
|---|---|---|
| Line 84 | `where.arrivalSlotId = parseInt(slotIdStr, 10)` | Today list, slot-tab active |
| Line 86 | `notIn: ["dispatched","cancelled","closed","order_created","pending_tint_assignment"]` | Today list, non-done arm |
| Lines 94-107 | History slot-filtered: `notIn: ["dispatched","closed","cancelled","order_created","pending_tint_assignment"]` | History list, slot-tab active |
| Lines 112-116 | History all-slot: `notIn: ["order_created","pending_tint_assignment"]` on arrival arm | History list, no slot |
| Lines 112-116 | History all-slot: `notIn: ["cancelled","order_created","pending_tint_assignment"]` on hold arm | History list, no slot |
| Lines 105 | History slot-filtered pending arm: `OR [arrivalSlotId, arrivalSlotId=null AND originalSlotId]` | Null-fallback |

**`app/api/support/slots/route.ts`:**

| Location | Condition | Scope |
|---|---|---|
| Line 152 | `arrivalSlotId: slot.id` | Today `pendingCount` per slot |
| Line 153 | `workflowStage: { in: ["pending_support","tinting_done"] }` | Today `pendingCount` |
| Lines 161-168 | `arrivalSlotId: slot.id` | Today `dispatchedCount` per slot |
| Lines 171-178 | `arrivalSlotId: slot.id` | Today `tintingCount` per slot |
| Lines 172 | `workflowStage: { in: ["tinting_in_progress","tint_assigned"] }` | Today `tintingCount` |
| Lines 80-108 | History `pendingCount`: `OR [arrivalSlotId, arrivalSlotId=null AND originalSlotId]` | Null-fallback |
| Lines 94-109 | History `tintingCount`: same OR fallback | Null-fallback |

---

## Area C — Tint status display

### C1. Where the status/pill renders in `support-orders-table.tsx`

**File:** `components/support/support-orders-table.tsx` lines 1124-1218

```tsx
{/* ── Status badge (col 7) ───────────────────────────────────────── */}
<div className="relative" data-popover>
  {isPhysicallyDispatched ? (
    <span ...>Dispatched</span>
  ) : isTinting ? (
    <span className="...bg-purple-100 text-purple-700 border-purple-200">
      <span className="...bg-purple-500" />
      TINTING
    </span>
  ) : isDoneRow ? (
    <span className={cn(
      "...",
      order.footprintType === "cancel"   ? "...text-red-600" :
      order.footprintType === "dispatch" ? "...text-green-700" :
      order.footprintType === "hold"     ? "...text-amber-700" :
                                           "...text-gray-400",
    )}>
      {order.footprintType === "cancel"   ? "Cancelled" :
       order.footprintType === "dispatch" ? "Dispatch" :
       order.footprintType === "hold"     ? "Hold" : "Done"}
    </span>
  ) : (
    // Pending interactive badge — reads currentDs
    <span className={cn(..., currentDs === "dispatch" ? "...emerald" : currentDs === "hold" ? "...amber" : "...gray")}>
      {currentDs === "dispatch" ? "Dispatch" : currentDs === "hold" ? "Hold" : "—"}
    </span>
  )}
</div>
```

**Decision data:** The rendering reads from:
1. `workflowStage` → `getRowType()` → `isPhysicallyDispatched` / `isTinting`
2. `isDoneRow` prop (boolean, set by parent for done-section rows)
3. `order.footprintType` (server-computed, for done rows)
4. `currentDs` (for pending rows) — derived from `editDs ?? (bulkStatus preview) ?? (intent) ?? order.dispatchStatus ?? ""`

---

### C2. Does the pill auto-reflect `workflowStage`?

Yes. The `isTinting` check uses:

```typescript
// Lines 104-109:
function getRowType(order: SupportOrder): RowType {
  if (order.workflowStage === "dispatched") return "physically_dispatched";
  if (["tinting_in_progress", "tint_assigned"].includes(order.workflowStage)) return "tinting";
  if (order.dispatchStatus === "dispatch") return "resolved";
  return "pending";
}

// Line 986-988:
const rt = getRowType(order);
const isPhysicallyDispatched = rt === "physically_dispatched";
const isTinting = rt === "tinting";
```

`isTinting` is true for `tinting_in_progress` and `tint_assigned`. It evaluates at render time from
the order object — no extra prop or flag needed. If `workflowStage` changes, the pill changes on
next fetch. No wiring needed.

`pending_tint_assignment` is currently hidden from the list entirely (excluded by `notIn` in
`orders/route.ts`), so there is no existing pill for it.

---

### C3. Where the human-readable status labels live

**All status label strings are hardcoded inline in the JSX** at lines 1127-1218. There is no
central label registry or constants object.

| Stage / state | Label string | Line |
|---|---|---|
| `workflowStage === "dispatched"` | `"Dispatched"` | ~1127 |
| `["tinting_in_progress","tint_assigned"]` | `"TINTING"` | 1134 |
| `footprintType === "cancel"` (done) | `"Cancelled"` | 1153 |
| `footprintType === "dispatch"` (done) | `"Dispatch"` | 1154 |
| `footprintType === "hold"` (done) | `"Hold"` | 1155 |
| default done | `"Done"` | 1155 |
| pending `dispatchStatus === "dispatch"` | `"Dispatch"` | 1177 |
| pending `dispatchStatus === "hold"` | `"Hold"` | 1177 |
| pending empty | `"—"` | 1177 |

CORE §13 landmine: "Tint badges are NOT centralized (hardcoded across 3 components, `getAgeBadge`
duplicated) — gating them needs a shared badge registry first (the deferred 'hard part')."

For the new "Tint · <stage>" pill, the strings and the `getRowType` expansion will be the edit
points. There is currently no label for `pending_tint_assignment` because that stage is hidden.

---

## Area D — Tint completion → auto-dispatch

### D1. What `done/route.ts` writes on completion

**File:** `app/api/tint/operator/done/route.ts` lines 178-185

```typescript
await prisma.orders.update({
  where: { id: orderId },
  data: {
    workflowStage: "pending_support",
    slotId: completionSlotId,
    originalSlotId: completionSlotId,
    // arrivalSlotId is NOT here
    // dispatchStatus is NOT here
    // dispatchTargetDate is NOT here
    // dispatchWindowId is NOT here
  },
})
```

`completionSlotId` is computed inline (lines 165-176) using the old 4-slot exclusive-boundary
logic (`< "10:30" → 1`, `< "12:30" → 2`, `< "15:30" → 3`, `else → 4`). It does NOT call
`resolveArrivalSlotId` from `slot-ruler.ts`. It does NOT produce slot id 7 (Late Evening).

**`workflowStage` set:** `"pending_support"` — order enters the Support queue.

**Split done (`split/done/route.ts` lines 127-145, inside `$transaction`):**

```typescript
const completionSlotId = (() => {
  const istStr = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const ist = new Date(istStr);
  const h = ist.getHours(); const m = ist.getMinutes();
  const t = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  if (t < "10:30") return 1;
  if (t < "12:30") return 2;
  if (t < "15:30") return 3;
  return 4;
})();

await tx.orders.update({
  where: { id: split.orderId },
  data: {
    slotId: completionSlotId,
    originalSlotId: completionSlotId,
    // arrivalSlotId NOT set
    // workflowStage NOT set here (set separately in parent-bubble logic)
  },
});
```

---

### D2. Are any dispatch fields set at completion?

**No.** Neither `done/route.ts` nor `split/done/route.ts` writes `dispatchStatus`,
`dispatchTargetDate`, or `dispatchWindowId` at completion. The order enters `pending_support`
with all dispatch fields at whatever value they had before (typically null for unmatched orders,
or the enrichment value for matched orders — including the sticky dispatchStatus issue).

**Confirmed absent.** Both completion routes' `orders.update` blocks contain ONLY:
- `done/route.ts`: `workflowStage`, `slotId`, `originalSlotId`
- `split/done/route.ts`: `slotId`, `originalSlotId` (workflowStage in parent-bubble, not here)

---

### D3. Is there a pre-set window field on a tint order during mixing?

**Yes, schema-wise.** The `orders` table has:
- `dispatchTargetDate DateTime? @db.Date`
- `dispatchWindowId Int? FK → dispatch_slot_master.id`
- `dispatchWindow` Prisma relation on `dispatchWindowId`

Both columns are nullable and available from the first moment an order is created. Nothing in the
import path, tint assignment path, tinting path, or completion path SETS these fields for tint
orders today. They remain null throughout the tinting lifecycle unless enrichment wrote
`dispatchStatus = "dispatch"` (the sticky note, but not the date/window).

`dispatch_slot_master` has 4 seeded rows: `id 1-4`, `windowTime` = `10:30 / 12:30 / 16:00 / 18:00`.

**Plain note:** The columns to pre-set a window on a tint order EXIST. They are just never written.
A future "tint brain" (SUPPORT §7 Task 2) could write `dispatchTargetDate` + `dispatchWindowId` to
a tint order at assignment time or mid-tinting. Completion could then read these fields and
conditionally auto-dispatch.

---

### D4. Can completion skip auto-dispatch cleanly if no window exists?

**Yes.** The auto-dispatch (if built) can gate on `order.dispatchWindowId !== null`. Today's
dispatch routes confirm they REQUIRE both fields:

From SUPPORT §4.10: `release/route.ts` — "Requires `dispatchTargetDate` (YYYY-MM-DD string) +
`dispatchWindowId` (Int) in the body."

From SUPPORT §4.13: "`dispatch/route.ts` updated: Now requires + persists `dispatchTargetDate` +
`dispatchWindowId` in the body (same fields as `release/route.ts`)."

Completion can do:

```typescript
// pseudo-code for the planned auto-dispatch gate
const order = await prisma.orders.findUnique({ where: { id: orderId },
  select: { dispatchTargetDate: true, dispatchWindowId: true } });
if (order.dispatchWindowId !== null && order.dispatchTargetDate !== null) {
  // auto-dispatch: workflowStage → "closed", dispatchStatus → "dispatch"
} else {
  // no window pre-set: just release to pending_support (current behaviour)
}
```

This is a clean conditional. No risk of violating the "dispatch needs a window" rule.

---

## Area G — Landmines

### G1. `prisma.$transaction` calls in touched files

| File | Line | Context |
|---|---|---|
| `app/api/tint/operator/split/done/route.ts` | **line 50** | `await prisma.$transaction(async (tx) => { ... });` — covers the ENTIRE per-split update (split status, split logs, tint_logs, AND the `orders.update` that writes `slotId`/`originalSlotId`). Any new field written at split-done (e.g. `arrivalSlotId`) MUST go inside this same transaction block — but the whole transaction violates CORE §3 (Supabase pooler timeout risk). **Do not add another transaction; the existing one is a pre-existing landmine.** |
| `app/api/tint/operator/done/route.ts` | None | Uses sequential awaits throughout. CORE §3 compliant. |
| `app/api/support/orders/route.ts` | None | GET only; no write transactions. |
| `app/api/support/slots/route.ts` | None | GET only; no write transactions. |

CORE §13 also flags `$transaction` in `orders/[id]/route.ts` (line 173) and `splits/[id]/route.ts`
(line 100) — not in scope for this discovery.

**split/done specific concern:** If `arrivalSlotId` is to be set at split completion, the write
must go into the EXISTING `$transaction` block (line 50) alongside the `orders.update` at lines
139-145. Adding it outside the transaction would create a partial-update risk (slot updates, but
arrival slot doesn't, on rollback). The pre-existing `$transaction` violation is not fixable in
this session — add the new column inside it and document the debt.

---

### G2. `dispatchStatus` sticky-note in paths we will touch

**SUPPORT §8 landmine:** "`dispatchStatus` persists its last value even after `workflowStage`
reaches `closed`/`dispatched`. Three patches have worked around this; the contradictory state is
still in the DB for many orders."

**Interaction with tint completion:** If enrichment set `dispatchStatus = "dispatch"` on a tint
order before tinting completed (auto-done guard blocks it for `pending_support` but the status
might still be set on the order row while it's at `pending_tint_assignment`), then when tinting
completes, the order enters `pending_support` with `dispatchStatus = "dispatch"` still set.

The auto-done guard in `applyMailOrderEnrichment` (SUPPORT §4.8) only fires on
`workflowStage === "pending_support"`, so it won't close the order while it's in tinting. But the
`dispatchStatus` field itself is not cleared by the completion routes. This means a tint order
that arrives AFTER its matching mail order was enriched could enter `pending_support` already
carrying `dispatchStatus = "dispatch"` — and then get auto-closed by the next enrichment run.

**Impact on the planned changes:** When we add `arrivalSlotId` to the tint completion update,
we don't need to touch `dispatchStatus`. But be aware that the sticky note exists.

---

### G3. CORE rule that will change

**Current (CORE §9, line 497):**

> **Tint orders (`orderType === "tint"`):** `slotId = null` at import. Slot assigned at tinting
> completion based on IST time. Splits: parent slot set when last split completes.

This rule has two parts, only one of which changes:

- **`slotId = null` at import** → stays the same (slotId still set at completion)
- **Slot assigned at tinting completion** → `slotId` / `originalSlotId` still assigned at
  completion; what changes is that `arrivalSlotId` will NOW be set at IMPORT (not completion)

**Also from CLAUDE_TINT.md §2, line 109-110:**

> At import: `orderType === "tint"` → `slotId = null`, `originalSlotId = null`
> At completion (whole order): sets `slotId` + `originalSlotId` on order using `resolveSlot()`
> thresholds on current IST time

**Must update in consolidation pass:**
1. CORE §9 — add a sentence: "arrivalSlotId is set at import for ALL orders (tint and non-tint)
   via `resolveArrivalSlotId(emailDateTime)`. slotId stays null for tint until completion."
2. CLAUDE_TINT.md §2 — same update.
3. CLAUDE_IMPORT.md §12 — currently says "Tint orders: slotId = null at import" — clarify that
   arrivalSlotId is set.

Flag: **DO NOT update CORE/TINT/IMPORT in this session.** Wait until the code changes are live
and confirmed working. Update all three docs in a single consolidation pass.

---

<!-- Prompt 2 (areas E, F) appends below -->

---

## Area E — Hold/Cancel + Sync

### E1. Support hold route — stage guard today?

**File:** `app/api/support/orders/[id]/hold/route.ts` (full file, 73 lines)

```typescript
// Lines 33-35:
if (order.workflowStage === "cancelled") {
  return NextResponse.json({ error: "Order is cancelled" }, { status: 400 });
}
```

**That is the only guard.** No tint-stage check, no `pending_tint_assignment` / `tint_assigned` /
`tinting_in_progress` guard. The route will hold any non-cancelled order regardless of stage.

**What it writes:**
```typescript
// Lines 41-53 (splits, sequential):
await prisma.order_splits.update({ where: { id: split.id }, data: { dispatchStatus: "hold" } });

// Lines 57-60 (order):
await prisma.orders.update({
  where: { id: orderId },
  data: { dispatchStatus: "hold", heldAt: order.obdEmailDate ?? new Date() },
});
```

**Stages currently allowed by this route:** everything except `"cancelled"`. Includes
`"pending_tint_assignment"`, `"tint_assigned"`, `"tinting_in_progress"`, `"tinting_done"`,
`"pending_support"`, `"closed"`. A hold on `"tinting_in_progress"` would write
`dispatchStatus = "hold"` while the order is still being mixed, causing it to appear in
Support's done group (`isDone` in orders/route.ts checks `dispatchStatus === "hold"`) while
the operator still sees it in their queue.

---

### E2. Support cancel route — stage guard? Splits?

**File:** `app/api/support/orders/[id]/cancel/route.ts` (84 lines)

```typescript
// Lines 46-48:
if (order.workflowStage === "cancelled") {
  return NextResponse.json({ error: "Order is already cancelled" }, { status: 400 });
}
```

**That is the only guard.** Same situation as hold — no tint-stage guard.

**What it writes:**
```typescript
// Lines 52-55 (splits, sequential):
await prisma.order_splits.update({
  where: { id: split.id },
  data: { status: "cancelled", dispatchStatus: null },
});

// Lines 68-71 (order):
await prisma.orders.update({
  where: { id: orderId },
  data: { workflowStage: "cancelled", dispatchStatus: null },
});
```

**Splits: YES.** Every non-cancelled split gets `status = "cancelled"`. This means Support can
cancel a `"tinting_in_progress"` order — all active splits get cancelled, the operator's job
disappears from their queue. There is NO confirmation that the order is safe to cancel (no check
for `workflowStage NOT IN ["tinting_in_progress", "tint_assigned"]`).

**Undo-cancel** (`undo-cancel/route.ts`) restores to `"pending_support"` and splits to
`"tinting_done"` — but that is NOT the original stage. An undo-cancel on a mid-tint order would
revert it to `"pending_support"` (skipping tinting entirely), which is wrong.

---

### E3. Tint Manager side — hold and cancel/remove routes

Three relevant Tint Manager routes:

**A. `orders/[id]/status/route.ts` (PATCH) — the TM "hold":**
```typescript
// Lines 29-36:
if (dispatchStatus !== null) {
  const VALID_DISPATCH = ["dispatch", "hold", "waiting_for_confirmation"];
  if (!VALID_DISPATCH.includes(dispatchStatus)) {
    return NextResponse.json({ error: "Invalid dispatchStatus" }, { status: 400 });
  }
}
updateData.dispatchStatus = dispatchStatus;

// Lines 56-59:
await prisma.orders.update({
  where: { id: orderId },
  data:  updateData,
});
```
**NO stage guard.** Sets `dispatchStatus = "hold"` (or "dispatch" or "waiting_for_confirmation"
or null) on ANY non-removed order. Does **NOT** stamp `heldAt` — only the `dispatchStatus`
column is written. Does NOT cascade to splits. Does log to `order_status_logs` (line 61).

**B. `cancel-assignment/route.ts` (POST) — NOT a cancel, a REVERT:**
```typescript
// Lines 30-31:
if (order.workflowStage !== "tint_assigned") {
  throw new Error("Order is not in assigned stage");
}

// Lines 41-44 (inside $transaction):
await tx.orders.update({
  where: { id: orderId },
  data:  { workflowStage: "pending_tint_assignment", sequenceOrder: 0 },
});
```
Stage guard: MUST be at `"tint_assigned"`. Reverts to `"pending_tint_assignment"`. Cancels
active `tint_assignments` rows. Does NOT cancel the order — it returns the order to the unassigned
queue. Has `$transaction` (CORE §3 violation, pre-existing).

**C. `orders/[id]/remove/route.ts` (POST) — the TM "cancel":**
```typescript
// Lines 84-89:
if (order.workflowStage !== "pending_tint_assignment") {
  return NextResponse.json(
    { ok: false, error: "Cannot remove after assignment", stage: order.workflowStage },
    { status: 409 },
  );
}

// Lines 96-105:
await prisma.orders.update({
  where: { id: orderId },
  data: {
    isRemoved:     true,
    removalReason: reason,
    removalRemark: remarkTrimmed,
    removedAt:     now,
    removedById:   userId,
  },
});
```
**HARD stage guard: must be at `"pending_tint_assignment"`.** 409 if the order has been assigned
or further. Soft-delete (`isRemoved = true`), not `workflowStage = "cancelled"`. Voids linked
challan if present. Requires `reason` (enum: `"CUSTOMER_CANCELLED"` or `"WRONG_ORDER"`) + freetext
`remark`. Writes audit log with `toStage = "OBD_REMOVED"` (marker, not a real stage).

**Summary of TM write fields:**

| Route | `workflowStage` written | `dispatchStatus` written | `isRemoved` written | `heldAt` written |
|---|---|---|---|---|
| `status/route.ts` (hold) | NO | YES (`"hold"`) | NO | NO |
| `cancel-assignment/route.ts` | YES (`"pending_tint_assignment"`) | NO | NO | NO |
| `remove/route.ts` | NO | NO | YES (`true`) | NO |

---

### E4. SYNC — shared fields, passive model

**Support hold writes:** `orders.dispatchStatus = "hold"`, `orders.heldAt = obdEmailDate`
**TM status route reads:** `dispatchStatus` — shown as dispatch-status badge inline on cards (per TINT §1.6)
→ TM WILL see the held badge on next fetch. **Passive sync via shared DB column.**

**TM status route writes:** `orders.dispatchStatus = "hold"` (no `heldAt`)
**Support reads:** `isDone = ... || order.dispatchStatus === "hold"` (orders/route.ts line 189)
→ Support WILL show the order in the done group. **But `heldAt` is null** → history hold footprint
missing. Hold tab (`section === "hold"`) ALSO shows it (no date fence, `dispatchStatus = "hold"`
passes the filter). So TM-held orders appear on Support in BOTH the active slot list (via `isDone` 
misclassification at early tint stages) AND in the Hold tab. Confusing state.

**Support cancel writes:** `orders.workflowStage = "cancelled"`, `orders.dispatchStatus = null`
**TM reads:** Kanban columns filter by stage (`pending_tint_assignment`, `tint_assigned`,
`tinting_in_progress`, `tinting_done`). `"cancelled"` matches none → order vanishes from TM board.
→ **Passive sync — TM sees the disappearance on next fetch.**

**TM remove-OBD writes:** `orders.isRemoved = true`
**Support reads:** `where: { isRemoved: false }` on every query → order vanishes from Support.
→ **Passive sync via `isRemoved`.**

**Sync model verdict: SHARED-FIELD PASSIVE SYNC.** There is no event bus, webhook, or explicit
notification between Support and TM. Both screens read the same `orders` row. Changes from either
side are immediately visible to the other on the next poll/fetch. This model is sufficient for
the locked design (the two actions — hold and cancel — write to `workflowStage`/`dispatchStatus`/
`isRemoved`, all of which both screens filter on).

**Key divergence — TM hold missing `heldAt`:** When TM sets `dispatchStatus = "hold"`, `heldAt`
stays null. The history board's hold-footprint arm (`heldAt: { gte: histStart, lt: histEnd }`)
will never fire for TM-held orders. These orders won't appear as "amber Hold" on their hold day
in history — they appear on their ARRIVAL day only (arrival footprint). This is a bug to fix when
the build adds the stage guard to TM's status route.

---

### E5. Exact stage string for "pending tint assignment"

```typescript
// From app/api/tint/manager/orders/[id]/remove/route.ts line 84:
if (order.workflowStage !== "pending_tint_assignment") {

// From app/api/tint/manager/cancel-assignment/route.ts line 43 (revert target):
data: { workflowStage: "pending_tint_assignment", sequenceOrder: 0 },

// From app/api/support/orders/route.ts line 86 (today notIn exclusion):
{ workflowStage: { notIn: [..., "pending_tint_assignment"] }, ... }
```

The exact string is **`"pending_tint_assignment"`** — no spaces, snake_case, all lowercase.
This is the stage where:
1. TM's Remove-OBD HARD gate fires (only stage allowed)
2. Support's today list EXCLUDES the order (it's in the notIn)
3. TM's cancel-assignment WRITES this as the revert target

Build gate must use `=== "pending_tint_assignment"` exactly.

---

### E6. Gap statement + size read (plain English)

**What's needed to gate both screens to `pending_tint_assignment` for hold/cancel AND keep them
in sync:**

1. **Support hold route:** Add 1 guard: `if (!["pending_tint_assignment", "pending_support", "tinting_done"].includes(order.workflowStage)) return 409("Cannot hold at this stage")`. Rejects hold at `tint_assigned` and `tinting_in_progress`. ~2 lines.

2. **Support cancel route:** Add 1 guard: same logic. Rejects cancel at `tint_assigned` and `tinting_in_progress`. ~2 lines.

3. **TM status route — stamp `heldAt`:** When `updateData.dispatchStatus === "hold"`, add `updateData.heldAt = order.obdEmailDate ?? new Date()`. The `order` object IS already fetched at line 51 (`findFirst`), so `obdEmailDate` is available. ~3 lines.

4. **No new sync mechanism.** The passive shared-DB model is sufficient. Both screens already read `workflowStage`, `dispatchStatus`, and `isRemoved`. Changes propagate on next fetch.

5. **Undo-cancel on mid-tint orders:** Currently undo-cancel reverts to `"pending_support"` with
splits set to `"tinting_done"`. If a tint order at `tint_assigned` were cancelled (before the
guard is added) and then undo-cancelled, it would land in `pending_support` skipping tinting
entirely. After the guard is added this scenario can't happen — but for any EXISTING bad-cancelled
orders, the undo would land them in `pending_support` (wrong). Pre-existing edge case, not new.

**Size: SMALL.** 3 surgical edits (two guard additions + one stamp fix), ~7 total new lines across
3 files. No new routes. No new DB columns. No sync mechanism to build. The passive model already
works.

---

## Area F — Carry-over → Arrival-anchored

### F1. Today board list — the full WHERE/OR and carry-over arm

**File:** `app/api/support/orders/route.ts` lines 80-88 (today path, `section === "slot"`)

```typescript
if (!isHistoryView) {
  if (slotIdStr) where.arrivalSlotId = parseInt(slotIdStr, 10);
  where.OR = [
    { workflowStage: { notIn: ["dispatched", "cancelled", "closed", "order_created", "pending_tint_assignment"] }, obdEmailDate: { gte: istStart, lt: istEnd } },
    { workflowStage: { in: ["closed", "dispatched", "cancelled"] }, obdEmailDate: { gte: istStart, lt: istEnd } },
  ];
}
```

**BOTH arms have `obdEmailDate: { gte: istStart, lt: istEnd }`.** There is NO unfenced arm.
`istStart` and `istEnd` come from `getISTDayRange(dateStr)` = IST midnight-to-midnight for the
selected day.

**Verdict: the today list is ALREADY date-fenced to today's arrivals only.** Yesterday's pending
orders do NOT appear in the today slot board via this query.

**Hold section (section === "hold", lines 120-123):**
```typescript
where.dispatchStatus = "hold";
where.workflowStage = { notIn: ["dispatched", "cancelled", "closed"] };
```
NO `obdEmailDate` fence. The Hold tab is UNFENCED — shows held orders from all dates. This is
intentional and should remain unfenced.

**`isCarriedOver` flag (lines 183-188):**
```typescript
const obdDate = order.obdEmailDate?.toISOString().slice(0, 10) ?? dateStr;
const isCarriedOver = obdDate < dateStr;
const daysOverdue = isCarriedOver
  ? Math.floor((new Date(dateStr).getTime() - new Date(obdDate).getTime()) / 86400000)
  : 0;
```
This flag exists and is returned in every order response. But since the list query is date-fenced,
`isCarriedOver` is effectively always `false` for today's slot view. It is live in the response
but DISPLAY-DEAD — the "⚠ rec. {date} · {N}d" card (from the 06-24 locked spec) is NOT yet
built. This field is waiting for the dual-date card build.

**DOC vs CODE discrepancy:** `CLAUDE_SUPPORT.md §4.1` says "Pending and tinting tiles stay
unfenced — carry-over is intentional." And §6 says "Yesterday's pending orders carry forward
naturally. Header pending/tinting tiles are unfenced." **The code contradicts this.** Both list
arms have `obdEmailDate` fences. The doc describes an earlier design state that no longer matches
the code. Do NOT trust the doc for carry-over behavior — trust the code.

---

### F2. Header tiles + per-slot counts — date-fenced vs unfenced

**File:** `app/api/support/slots/route.ts` today path

```typescript
// Lines 21-23 — BOTH functions are DISABLED (commented out):
// DISABLED: slot cascade removed — slots are fixed by obdEmailTime
// await runDailyCleanupIfNeeded();
// await runSlotCascadeIfNeeded(todayStr);
```

**`doneCount` (lines 133-147): FENCED**
```typescript
doneCount = await prisma.orders.count({
  where: {
    AND: [
      {
        obdEmailDate: { gte: todayStart, lt: todayEnd },  // ← IST today fence
        ...
      },
      hideExclusion,
    ],
  },
});
```

**`pendingCount` per slot (lines 151-158): FENCED**
```typescript
const pendingCount = await prisma.orders.count({
  where: {
    arrivalSlotId: slot.id,
    workflowStage: { in: ["pending_support", "tinting_done"] },
    dispatchStatus: null,
    isRemoved: false,
    obdEmailDate: { gte: todayStart, lt: todayEnd },  // ← IST today fence
  },
});
```

**`dispatchedCount` per slot (lines 161-168): FENCED**
```typescript
obdEmailDate: { gte: todayStart, lt: todayEnd },  // ← line 166
```

**`tintingCount` per slot (lines 171-178): FENCED**
```typescript
const tintingCount = await prisma.orders.count({
  where: {
    arrivalSlotId: slot.id,
    workflowStage: { in: ["tinting_in_progress", "tint_assigned"] },
    isRemoved: false,
    obdEmailDate: { gte: todayStart, lt: todayEnd },  // ← IST today fence
  },
});
```

**`holdCount` (lines 199-202): UNFENCED (global)**
```typescript
const holdCount = await prisma.orders.count({
  where: { dispatchStatus: "hold", isRemoved: false },
  // no obdEmailDate fence — ALL held orders across all days
});
```

**Summary:**

| Tile | Date-fenced? | Confirmed |
|---|---|---|
| `doneCount` | YES (today IST) | line 135 |
| `pendingCount` per slot | YES (today IST) | line 157 |
| `dispatchedCount` per slot | YES (today IST) | line 166 |
| `tintingCount` per slot | YES (today IST) | line 176 |
| `holdCount` (global tab) | NO (all dates) | lines 199-202 |

`CLAUDE_SUPPORT.md §4.1` says "Pending and tinting tiles stay unfenced." **The code contradicts
this.** Both `pendingCount` and `tintingCount` are IST-today-fenced. The doc is WRONG for the
current code state.

---

### F3. What must change for "today = today's arrivals only"

**Answer: NOTHING in orders/route.ts or slots/route.ts today path.** Both list queries and all
per-slot counts are already IST-today-fenced.

The ONLY unfenced parts today are:
- `holdCount` — intentionally global (the Hold tab shows all held orders across all dates by design)
- `section === "hold"` orders list — intentionally global (hold is a cross-date overlay)

Neither should be fenced. The hold tab IS the carry-over mechanism for held orders.

What IS still needed (not yet built):
1. **"N pending from earlier" count query** — counts past-pending orders (`obdEmailDate < todayStart`, `workflowStage IN ["pending_support", "tinting_done"]`, `dispatchStatus null`). New work.
2. **Header badge** surfacing that count — new UI in `support-page-content.tsx`.
3. **"Pending from earlier" flat list** — new section or route. New work.

---

### F4. "Pending from earlier" flat list — can it reuse history query machinery?

**History query (orders/route.ts with `slotIdStr`, lines 91-108):**
```typescript
where.OR = [
  // Done: arrival footprint
  { obdEmailDate: { gte: istStart, lt: istEnd }, workflowStage: { in: ["dispatched", "closed", "cancelled"] } },
  // Done: hold footprint
  { heldAt: { gte: istStart, lt: istEnd }, workflowStage: "closed" },
  // Done: dispatch footprint
  { dispatchTargetDate: { gte: dateStart, lt: dateEnd }, workflowStage: "closed" },
  // Pending: (arrived OR held) on D, slot-filtered
  {
    workflowStage: { notIn: ["dispatched", "closed", "cancelled", "order_created", "pending_tint_assignment"] },
    AND: [
      { OR: [{ obdEmailDate: { gte: istStart, lt: istEnd } }, { heldAt: { gte: istStart, lt: istEnd } }] },
      { OR: [{ arrivalSlotId: histSlotId }, { arrivalSlotId: null, originalSlotId: histSlotId }] },
    ],
  },
];
```

The history query is **date-range specific for a single day D**. It fences on `[istStart, istEnd)`.

"Pending from earlier" needs: ALL past days, pending only, no specific date, no slot filter,
oldest-first. The required WHERE:
```typescript
// New — not a variation of history, new work:
where.obdEmailDate = { lt: todayIstStart };           // arrived BEFORE today
where.workflowStage = { in: ["pending_support", "tinting_done"] };
where.dispatchStatus = null;                          // not held
where.isRemoved = false;
orderBy = [{ obdEmailDate: "asc" }, { obdNumber: "asc" }];  // oldest first
```

**Assessment: NOT a trivial variation.** The history machinery fetches a date-range snapshot with
three footprint arms (arrival / hold / dispatch). "Pending from earlier" is a simpler unbounded
query with NO footprint arms and an upper-bound-only date fence. Both reuse `prisma.orders`, but
the WHERE structure is fundamentally different. A new `section === "earlier"` parameter in
`orders/route.ts` (similar to how `section === "hold"` works) is the cleanest approach —
~15 lines of new WHERE building code.

---

### F5. Header badge count source — existing or new?

No existing count can be re-aimed for "N pending from earlier." The candidates:

- `holdCount`: global hold count — different concept (held orders, not pending unhandled orders)
- `pendingCount` per slot: IST-today-fenced — excludes past orders by design
- History `pendingCount`: date-range specific for day D — would need to be called for EVERY past day

**A new count query is needed.** Could live in `slots/route.ts` alongside `holdCount`:
```typescript
// New: past-day pending count (arrived before today, still unhandled)
const earlierPendingCount = await prisma.orders.count({
  where: {
    AND: [
      {
        obdEmailDate: { lt: todayStart },       // before today IST
        workflowStage: { in: ["pending_support", "tinting_done"] },
        dispatchStatus: null,
        isRemoved: false,
      },
      hideExclusion,
    ],
  },
});
```
This returns once per `GET /api/support/slots` call and is added to the response payload
alongside `holdCount`. The `SlotsResponse` type in `support-page-content.tsx` would get a new
`earlierPendingCount: number` field.

---

### F6. Double-count check

If today board = today's arrivals only (already the case) and "pending from earlier" = orders
with `obdEmailDate < todayStart`, the two populations are MUTUALLY EXCLUSIVE by the date fence.
One row can be in at most one of the two lists.

**Tiles at risk of double-counting:**

| Tile | Risk | Verdict |
|---|---|---|
| `pendingCount` per slot (today IST) | Could a past-day order appear? | NO — `obdEmailDate ≥ todayStart` fence excludes pre-today. |
| `holdCount` (global) | Past-held + today-held counted together? | YES — intentional. Hold is a cross-date overlay. NOT a double-count problem. |
| `doneCount` (today IST) | Could a past-day done order count? | NO — `obdEmailDate ≥ todayStart` fence excludes pre-today. |
| New `earlierPendingCount` | Could it count a today-arrived order? | NO — `obdEmailDate < todayStart` fence excludes today. |
| Header `todayTotal` in `support-page-content.tsx` | What feeds into it? | `headerPending + headerTinting + headerDispatched + doneCount` (line 398) — all today-fenced. `earlierPendingCount` is NOT in `todayTotal` — correctly excluded. |

**Confirmed: no double-count risk** if the date fences are kept strictly non-overlapping.
`holdCount` is intentionally global and is shown as a separate tab badge, not included in
`todayTotal`.

---

### F7. Call status of `lib/day-boundary.ts` and `lib/slot-cascade.ts`

Confirmed by grep. Both are imported in three files. ALL call sites are **commented out**:

```
app/api/support/slots/route.ts:22:   // await runDailyCleanupIfNeeded();
app/api/support/slots/route.ts:23:   // await runSlotCascadeIfNeeded(todayStr);
app/api/warehouse/board/route.ts:66: //   await runDailyCleanupIfNeeded();
app/api/warehouse/board/route.ts:67: //   await runSlotCascadeIfNeeded(todayIST);
app/api/planning/board/route.ts:24:  //   await runDailyCleanupIfNeeded();
app/api/planning/board/route.ts:25:  //   await runSlotCascadeIfNeeded(todayIST);
```

The comment in `slots/route.ts` line 21 explains why:
```typescript
// DISABLED: slot cascade removed — slots are fixed by obdEmailTime
```

**Both functions are DEAD CODE in production.** They are never called.

**Tint-order interaction if re-enabled (NOT recommended — per SUPPORT §8 landmine):**
- `slot-cascade.ts`: Queries `slotId: closedSlot.id` (lines 92-98). Tint orders have `slotId = null`
  at import and after completion (uses non-null completionSlotId). Wait — tint orders DO get `slotId`
  stamped at completion. So a completed tint order with `slotId = 2` (Afternoon) would be eligible
  for cascade if Afternoon slot closes. **This is the risk.** CORE §13 flag is correct.
- `day-boundary.ts`: Queries `slotId: { not: morningSlot.id }` AND `NOT: { slotId: null }` (lines 83-85).
  Tint orders at import have `slotId = null` → excluded by `NOT: { slotId: null }`. Post-completion
  tint orders with `slotId != morning` → would be reset. Same risk.

**If re-enabling either function, add `orderType: { not: "tint" }` to the WHERE clause.**

---

### F8. Size read — blast radius of the carry-over switch (plain English)

**The "today = today's arrivals only" switch is ALREADY DONE in the code.** Both the orders list
query and all per-slot counts in the today path are IST-date-fenced. No WHERE clause edits needed.

`CLAUDE_SUPPORT.md §4.1` and §6 say the tiles are "unfenced" and carry-over "happens naturally" —
**these doc statements are WRONG for the current code state.** The doc should be corrected in the
next consolidation pass.

**What IS missing (the new build):**
1. **`earlierPendingCount` query in `slots/route.ts`:** ~10 new lines, returns count past-pending.
2. **New response field `earlierPendingCount`:** Update `SlotsResponse` type in `support-page-content.tsx`.
3. **Header badge in `support-page-content.tsx`:** ~10-20 lines — a clickable badge that switches to the "earlier" section.
4. **New `section === "earlier"` arm in `orders/route.ts`:** ~12 new WHERE-building lines.
5. **Client: fetch + display the "earlier" flat list:** New `orders.length` display with oldest-first sort — `support-page-content.tsx` and possibly a new sub-component. ~30-50 lines.

**Blast radius:** Contained. No existing WHERE clause changes. No existing tile changes. No schema
changes. The "hold tab" unfenced behavior is preserved. The only touch points are:
- `slots/route.ts` (add count, update return shape)
- `orders/route.ts` (add section arm)
- `support-page-content.tsx` (badge + list wiring)
- Type definition for `SlotsResponse`

**Size: MEDIUM.** ~100 lines total across 3 files. The conceptual complexity is low once the
discovery is clear; the implementation is mostly additive.

---

## Build-readiness summary

### Confirmed facts the build depends on

**Import / slot stamping (Area A):**
- `resolveArrivalSlotId` is already imported in `obd/route.ts` at line 20.
- Tint orders at import: `arrivalSlotId = null` (ternary at line 1021 — 2 paths both null).
- Enrichment (`applyMailOrderEnrichment`): ALREADY sets `arrivalSlotId` for ALL matched orders
  (tint AND non-tint). Only `slotId`/`originalSlotId` are tint-guarded (lines 276-284). The
  `arrivalSlotId` write (line 295) is outside the guard.
- Tint completion routes: NEITHER `done/route.ts` NOR `split/done/route.ts` writes `arrivalSlotId`.
  Both write `slotId`/`originalSlotId` only.
- `slot-ruler.ts` has 5 slots (Morning=1, Afternoon=2, Evening=3, Late Evening=7, Night=4) with
  inclusive ≤ boundaries. Tint completion uses the OLD 4-slot inline logic with exclusive < and no
  Late Evening. These are DIFFERENT resolvers.

**Today board / slot tab (Areas B, F):**
- `pending_tint_assignment` IS in the `notIn` exclusion list (today list query, line 86).
- `tinting_in_progress` and `tint_assigned` are NOT in the `notIn` → they DO appear in the today
  slot list (with the purple TINTING pill).
- Both today list arms and all per-slot counts are IST-date-fenced (Area F confirms: no carry-over).
- `holdCount` and `section === "hold"` are intentionally unfenced.

**Status display (Area C):**
- `getRowType()` at lines 104-109: `tinting_in_progress` AND `tint_assigned` → `"tinting"` → purple pill.
- `pending_tint_assignment` is excluded from the list → no pill to design for currently.
- Status labels are hardcoded inline in JSX (no central registry).

**Hold/cancel sync (Area E):**
- Support hold and cancel have NO tint-stage guard today. Both act on ANY non-cancelled order.
- Tint Manager's only "cancel" is Remove-OBD, HARD-gated to `pending_tint_assignment`.
- Tint Manager's "hold" (`orders/[id]/status/route.ts`) has no stage guard AND does not stamp `heldAt`.
- Sync is passive (shared DB columns: `workflowStage`, `dispatchStatus`, `isRemoved`). No event bus.

**Tint completion / auto-dispatch (Area D):**
- `dispatchTargetDate` and `dispatchWindowId` columns exist on `orders` (nullable). Not written
  during tinting lifecycle today.
- Auto-dispatch can be gated on `dispatchWindowId !== null` — clean skip if no window pre-set.

**Pre-set slot on tint rows (Area H):**
- Dispatch Slot column (col 8), line 1223: `isPhysicallyDispatched || isTinting` shows grey "—".
  Removing `|| isTinting` from that branch is the ONE change needed to expose the picker on tinting rows.
- Priority col (line 1297) and checkbox (line 1045) also gate on `isTinting` — those stay hidden.
- `DispatchSlotPicker` is fully reusable: `value`, `onChange`, `disabled`, `forceOpenGen` props
  already exist. No changes to the picker component.
- For tinting rows the picker `onChange` must call a NEW `onPresetSlot` handler, NOT `onSingleDispatch`
  (which would fire the dispatch close-couple).
- No existing route stores `dispatchTargetDate`+`dispatchWindowId` without `workflowStage: "closed"`.
  A new dedicated route is required: `app/api/support/orders/[id]/preset-slot/route.ts` (~45 lines).
- The PATCH route (`orders/[id]/route.ts`) cannot be extended: wrong schema + `$transaction` landmine.
- `done/route.ts` line 49 fetches ALL order columns (no `select`). `dispatchWindowId` and
  `dispatchTargetDate` are already available in `order` at completion — zero query change for half (b).
- `split/done/route.ts` parent-bubble fetch is also a no-`select` `findFirst`. Same availability.
- `dispatchWindows` (from `dispatch_slot_master`, 4 seeded rows) are already fetched and passed to
  the table in `support-page-content.tsx` — no new server query needed on the client side.
- `ORDER_INCLUDE` in `orders/route.ts` already includes `dispatchWindow` relation (the FK join).
  `order.dispatchWindow?.windowTime` is available on every order row the client sees.
- `pending_tint_assignment` rows remain excluded from Support today list (no picker needed there).
- Total size for half (a): ~100 lines across 2 existing files + 1 new file. No schema migration.

---

## Area H — Pre-set dispatch slot on tint rows (step 4a)

Files read for this section:
- `docs/CLAUDE_SUPPORT.md` (§4.10, §4.13, §6, §8)
- `components/support/dispatch-slot-picker.tsx`
- `components/support/support-orders-table.tsx` (lines 940-1350)
- `components/support/support-page-content.tsx`
- `app/api/support/orders/[id]/dispatch/route.ts`
- `app/api/support/orders/[id]/route.ts` (PATCH)
- `app/api/tint/operator/done/route.ts` (completion fetch)
- Grep: all `app/api/**` writes of `dispatchWindowId` / `dispatchTargetDate`

---

### H1. Picker visibility on tint rows

**File:** `components/support/support-orders-table.tsx` lines 1221-1292

```tsx
{/* ── Dispatch Slot (col 8) ──────────────────────────────────────── */}
<div>
  {isPhysicallyDispatched || isTinting ? (
    <span className="text-[10px] text-gray-300">—</span>
  ) : savingSlot ? (
    // ... saving spinner
  ) : isDoneRow ? (
    // ... show saved slot or —
  ) : currentDs === "hold" ? (
    <span className="text-[10px] text-gray-300">—</span>
  ) : (
    <DispatchSlotPicker ... />
  )}
</div>
```

**The gate is `isPhysicallyDispatched || isTinting` at line 1223.** When true, renders a grey "—"
instead of the picker.

`isTinting` is derived at line 988:
```typescript
const isTinting = rt === "tinting";
// rt from getRowType(order), line 986:
// ["tinting_in_progress", "tint_assigned"].includes(order.workflowStage) → "tinting"
```

And `isNonInteractive` at line 990:
```typescript
const isNonInteractive = isPhysicallyDispatched || isTinting;
```

This gate is applied to ALL three interactive columns:
- **Checkbox** (line 1045): `{isNonInteractive || isReadOnly ? <div className="w-4" /> : <Checkbox .../>}`
- **Status column** (line 1126): `{isPhysicallyDispatched ? ... : isTinting ? <purple TINTING pill>`
- **Dispatch Slot column** (line 1223): `{isPhysicallyDispatched || isTinting ? <grey "—"> : ...}`
- **Priority column** (line 1297): `{isPhysicallyDispatched || isTinting ? <grey "—"> : ...}`

**Confirmed: there is an EXPLICIT condition hiding the picker for tinting rows.** It is a single
`|| isTinting` in the dispatch-slot column gate. Removing it from that specific branch is the
only table-side change needed to expose the picker on tinting rows.

`pending_tint_assignment` rows: never reach the table component — excluded from the Support today
list entirely by the `notIn` in `orders/route.ts` line 86.

---

### H2. Save path for a normal pending row — intent vs immediate write

**When operator picks a slot on a pending (non-tint) row:**

`support-orders-table.tsx` lines 1282-1291:
```tsx
<DispatchSlotPicker
  value={null}
  onChange={(v) => {
    if (!v || !onSingleDispatch) return;
    setSavingSlot({ date: v.date, windowTime: v.windowTime });
    void onSingleDispatch(order.id, { dispatchTargetDate: v.date, dispatchWindowId: v.dispatchWindowId });
  }}
  windows={dispatchWindows ?? []}
  forceOpenGen={dispatchPickerTrigger?.id === order.id ? dispatchPickerTrigger.gen : undefined}
/>
```

`onSingleDispatch` maps to `handleDispatch` in `support-page-content.tsx` lines 276-287:
```typescript
const handleDispatch = useCallback(async (orderId: number, target: { dispatchTargetDate: string; dispatchWindowId: number }) => {
  const res = await fetch(`/api/support/orders/${orderId}/dispatch`, {
    method: "POST", ...
  });
  ...
  await refresh();
}, [refresh]);
```

**Server call fires IMMEDIATELY on window-pick. No Submit step for single-row dispatch.**

The "dispatch intent is client-only" principle (SUPPORT §6) refers ONLY to the green badge
(`dispatchIntentIds` Set) that shows between "choose Dispatch" in the Status menu and actually
picking a window. The intent is the pre-pick state. Once the window is actually picked, the server
call fires and the order closes. The principle is: "never stamp `dispatchStatus='dispatch'` without
a slot" — the client-only intent period prevents a half-committed server state.

**For tint pre-set, this principle means:** the new preset-slot route must NOT set
`dispatchStatus = "dispatch"`. It should only write `dispatchTargetDate` + `dispatchWindowId`.
No `dispatchStatus` change at pre-set time. The `dispatchStatus` only becomes `"dispatch"` when
completion fires the auto-flip.

---

### H3. Any existing route that persists slot without closing?

**Grep result — every write of `dispatchWindowId` or `dispatchTargetDate` across `app/api/**`:**

| File | Write | `workflowStage` also written? |
|---|---|---|
| `orders/[id]/dispatch/route.ts` line 86-89 | `dispatchTargetDate`, `dispatchWindowId` | YES → `"closed"` |
| `orders/[id]/release/route.ts` line 85-89 | `dispatchTargetDate`, `dispatchWindowId` | YES → `"closed"` |
| `support/bulk/route.ts` line 93-97 | `dispatchTargetDate`, `dispatchWindowId` | YES → `"closed"` |

All three are reads in `orders/route.ts` and `slots/route.ts` — no writes there.

The PATCH route (`orders/[id]/route.ts`) patchSchema (lines 81-86):
```typescript
const patchSchema = z.object({
  dispatchStatus: z.string().optional(),
  priorityLevel:  z.number().int().min(1).max(5).optional(),
  dispatchSlot:   z.string().nullable().optional(),   // old legacy string field
  note:           z.string().optional(),
});
```

`dispatchTargetDate` and `dispatchWindowId` are **NOT** in the PATCH schema. The PATCH route
cannot accept or persist them as-is.

**CONFIRMED: NO existing route stores `dispatchTargetDate` + `dispatchWindowId` without also
writing `workflowStage = "closed"`.** A new route is the only clean path for half (a).

---

### H4. Dispatch route close-coupling — confirmed non-reusable

**File:** `app/api/support/orders/[id]/dispatch/route.ts`

Stage block at lines 56-61:
```typescript
if (["tinting_in_progress", "tint_assigned"].includes(order.workflowStage)) {
  return NextResponse.json(
    { error: "Cannot dispatch — tinting not complete" },
    { status: 400 },
  );
}
```

**The dispatch route already BLOCKS itself for mid-tint orders.** Even if the lock were removed,
the write at lines 83-91 would still close the order:

```typescript
await prisma.orders.update({
  where: { id: orderId },
  data: {
    workflowStage: "closed",      // ← always
    dispatchStatus: "dispatch",   // ← always
    dispatchTargetDate: targetDate,
    dispatchWindowId: body.dispatchWindowId,
  },
});
```

**Dispatch route is inseparably coupled to closing. Cannot be reused for tint pre-set.**

The same pattern holds for `release/route.ts` (which closes from `hold`) and `bulk/route.ts`.
All three write `workflowStage: "closed"` unconditionally alongside the slot fields.

---

### H5. PATCH route option — blocked by schema + landmine

**File:** `app/api/support/orders/[id]/route.ts`

PATCH schema (lines 81-86) does not include `dispatchTargetDate` or `dispatchWindowId`. Extending
the schema to add them would work structurally, but those new writes would land inside the
existing `$transaction` block at line 173:

```typescript
// ── Write in transaction ──────────────────────────────────────────────────
const updatedOrder = await prisma.$transaction(async (tx) => {
  for (const entry of logEntries) {
    await tx.order_status_logs.create({ data: entry });
  }
  if (dispatchStatus === "hold") {
    await tx.dispatch_change_queue.create({ ... });
  }
  return tx.orders.update({ where: { id }, data: updateData });
});
```

Adding `dispatchTargetDate` and `dispatchWindowId` to `updateData` inside this transaction would:
1. Violate CORE §3 further (more writes inside an already-violating transaction)
2. Increase pooler-timeout risk on Vercel + Supabase
3. Touch a route flagged in SUPPORT §8 as `[LANDMINE]` — "refactor in a dedicated session"

**Extending the PATCH route is the wrong approach.** The correct path is a new dedicated route:

**Proposed new route:** `app/api/support/orders/[id]/preset-slot/route.ts` (POST)
- Accepts: `dispatchTargetDate` (YYYY-MM-DD) + `dispatchWindowId` (Int)
- Guard: order must be `orderType === "tint"` AND `workflowStage IN ["pending_tint_assignment", "tint_assigned", "tinting_in_progress"]` (or include `tinting_done` if needed)
- Writes ONLY: `orders.dispatchTargetDate` + `orders.dispatchWindowId` — no `workflowStage` change
- No `$transaction` — sequential awaits (CORE §3 compliant)
- Logs to `order_status_logs` with `fromStage/toStage = order.workflowStage` (unchanged)
- ~40-50 lines total

Allows clearing too: accept `null` for both fields to clear a pre-set slot.

---

### H6. Completion read — half (b) confirm

**File:** `app/api/tint/operator/done/route.ts` line 49 (order fetch):

```typescript
// 1. Load order — verify stage
const order = await prisma.orders.findFirst({ where: { id: orderId, isRemoved: false } })
```

**No `select` clause.** Prisma returns ALL scalar columns from `orders` — including
`dispatchWindowId` and `dispatchTargetDate`. Both fields are available in `order` at completion
time **without any change to the query.**

The auto-flip branch can be added after line 185 (the current `orders.update`):

```typescript
// Current (lines 178-185):
await prisma.orders.update({
  where: { id: orderId },
  data: {
    workflowStage: "pending_support",
    slotId: completionSlotId,
    originalSlotId: completionSlotId,
  },
})

// Future branch — reads pre-set slot from already-fetched `order`:
// if (order.dispatchWindowId !== null && order.dispatchTargetDate !== null) {
//   workflowStage: "closed", dispatchStatus: "dispatch"
//   (keep dispatchTargetDate + dispatchWindowId as already set)
// } else {
//   workflowStage: "pending_support"  ← existing fallback, unchanged
// }
```

**`split/done/route.ts` parent bubble** (the step after the `$transaction` that advances the
parent to `pending_support`): the parent order fetch in the bubble also uses `findFirst` without
`select`, so `dispatchWindowId` + `dispatchTargetDate` are equally available on the parent fetch.
The same branch applies there.

The `split/done/route.ts` `$transaction` at line 50 wraps ONLY the per-split updates
(`order_splits.update`, `split_status_logs.create`, `tint_logs.create`, `order_status_logs.create`,
and `orders.update` for `slotId`). The parent-bubble `orders.update` (which advances the parent's
`workflowStage`) happens AFTER the `$transaction`, as a sequential await. The auto-dispatch branch
would go in that post-transaction parent update — **no interaction with the `$transaction`
landmine**.

---

### H — Size read for half (a): pre-set slot on tint rows

**New work needed:**

| Change | File | Lines |
|---|---|---|
| New `preset-slot/route.ts` | `app/api/support/orders/[id]/preset-slot/route.ts` (new) | ~45 |
| Remove `\|\| isTinting` from slot-col gate; add tinting branch with picker + pre-set value | `components/support/support-orders-table.tsx` lines 1223-1224 + ~15 new | ~20 |
| New `handlePresetSlot` handler; pass `onPresetSlot` prop to table | `components/support/support-page-content.tsx` | ~20 |
| `onPresetSlot` prop threading through `SupportOrdersTable` → `OrderRow` | `support-orders-table.tsx` props + `OrderRow` props | ~8 |
| Display pre-set slot value in the picker on tinting rows | `support-orders-table.tsx` (picker `value=` derivation) | ~5 |

**Total: ~100 lines across 2 existing files + 1 new file.** No schema changes (columns exist).

**Interactions to flag:**

1. **`$transaction` landmine:** The new preset-slot route is standalone with sequential awaits —
   no interaction. Do NOT route through the PATCH route's transaction.

2. **"Dispatch intent is client-only" principle:** The pre-set picker on tinting rows does NOT
   use `dispatchIntentIds` or the Status chooser flow. It's a DIRECT slot pick stored immediately.
   This is deliberate — there's no "pending intent" state on a tint row (the order stays in its
   tint stage regardless of what slot is pre-set). No client-only state needed; fire the server
   on pick.

3. **Sticky `dispatchStatus` issue:** The preset-slot route writes ONLY `dispatchTargetDate` +
   `dispatchWindowId`. It does NOT touch `dispatchStatus`. If a tint order already has a stale
   `dispatchStatus = "dispatch"` from enrichment AND a pre-set slot, the auto-done guard
   (SUPPORT §4.8: fires only at `workflowStage = "pending_support"`) will NOT close it while
   it's in a tint stage. Safe — the guard is stage-gated. But when completion fires the
   auto-flip, the order already has `dispatchStatus = "dispatch"` from enrichment, making the
   post-completion state internally consistent (`closed` + `dispatch` + `dispatchTargetDate`).

4. **Cancel clears `dispatchStatus` but not slot fields:** If an operator pre-sets a slot and then
   the order is cancelled (`cancel/route.ts` writes `dispatchStatus = null` but leaves
   `dispatchTargetDate`/`dispatchWindowId` untouched), stale slot data remains on the cancelled
   row. Not a display bug (cancelled rows show the red Cancelled pill, not the slot). Worth noting
   but deferred — the existing sticky-status cleanup will handle this when addressed.

5. **`pending_tint_assignment` rows stay excluded from Support** (notIn at orders/route.ts line 86).
   The Tint Manager is the right place to pre-set a slot on those (if ever needed). The Support
   picker only needs to work on `tint_assigned` and `tinting_in_progress` rows, which ARE
   visible in Support's today slot list (not in the notIn).

**Size verdict: SMALL-MEDIUM.** Clean additive build — no landmine contact, no schema migration,
no transaction involvement, clear fallback (if no slot is pre-set, completion falls back to
`pending_support` exactly as today).

---

### Remaining unknowns

1. **Tint Manager order list query** (`app/api/tint/manager/orders/route.ts`) was NOT read in this
   discovery. Unknown: exactly what `workflowStage` IN filter it uses for each Kanban column.
   Impacts: whether a Support-cancelled order (stage = "cancelled") actually disappears from TM's
   Kanban on next fetch. Assumed yes (it's not a TM stage), but unverified.

2. **`applyMailOrderEnrichment` and `$transaction` at split/done/route.ts line 50.** The split-done
   `$transaction` wraps the `orders.update` for `slotId`/`originalSlotId`. Any new field added
   at split completion (e.g., `arrivalSlotId`) must go INSIDE the existing `$transaction` block.
   This is a known landmine (CORE §3 violation), not new discovery.

3. **`CLAUDE_SUPPORT.md §4.1` and §6 carry-over doc statements are wrong.** Needs correction in a
   consolidation pass AFTER the code build is confirmed working.

4. **Tint Manager `$transaction` in `cancel-assignment/route.ts` line 26.** Pre-existing CORE §3
   violation. Not in the direct path of the tint-in-support build, but note if touching that route
   to add a stage guard.

5. **`orders.orderType` field.** Tint orders are identified by `orderType === "tint"`. The build
   (when adding `arrivalSlotId` at import for tint orders) must use `orderType !== "tint"` to
   confirm it's changing the RIGHT ternary condition in `obd/route.ts`.

