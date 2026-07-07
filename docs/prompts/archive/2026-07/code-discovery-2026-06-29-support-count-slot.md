# Discovery: Support board count + slot bugs
# Date: 2026-06-29 · Post c901d6 (tint-in-support build)
# Read-only discovery — no code changes

---

## Area A — Header vs Export count

### A1. Header "N OBDs" count — exact source

`support-page-content.tsx:413-417`:
```ts
const headerPending    = slots.reduce((s, sl) => s + sl.pendingCount, 0);
const headerDispatched = slots.reduce((s, sl) => s + sl.dispatchedCount, 0);
const headerTinting    = slots.reduce((s, sl) => s + sl.tintingCount, 0);
const todayTotal       = headerPending + headerTinting + headerDispatched + doneCount;
// shown as: { label: "OBDs", value: todayTotal }
```

These slot counts come from `slots/route.ts` today path. Each per-slot query:

**pendingCount** (lines 151-158):
```ts
prisma.orders.count({
  where: {
    arrivalSlotId: slot.id,      // ← REQUIRES non-null arrivalSlotId
    workflowStage: { in: ["pending_support", "tinting_done"] },
    dispatchStatus: null,
    isRemoved: false,
    obdEmailDate: { gte: todayStart, lt: todayEnd },
  }
});
```

**tintingCount** (lines 171-179):
```ts
prisma.orders.count({
  where: {
    arrivalSlotId: slot.id,      // ← REQUIRES non-null arrivalSlotId
    workflowStage: { in: ["pending_tint_assignment", "tinting_in_progress", "tint_assigned"] },
    isRemoved: false,
    obdEmailDate: { gte: todayStart, lt: todayEnd },
  }
});
```

**dispatchedCount** (lines 161-169):
```ts
prisma.orders.count({
  where: {
    arrivalSlotId: slot.id,      // ← REQUIRES non-null arrivalSlotId
    dispatchStatus: "dispatch",
    workflowStage: { notIn: ["dispatched", "closed"] },
    isRemoved: false,
    obdEmailDate: { gte: todayStart, lt: todayEnd },
  }
});
```

**doneCount** (lines 133-147) — NO arrivalSlotId filter:
```ts
prisma.orders.count({
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
  }
});
```

Summary: all three live-tile counts (`pendingCount`, `tintingCount`, `dispatchedCount`) hard-require `arrivalSlotId = slot.id`. Orders with `arrivalSlotId = null` are excluded from ALL of them. `doneCount` has no arrivalSlotId requirement, so done orders are counted regardless.

### A2. Export "N OBDs" — exact source

`support-orders-table.tsx:488-504`:
```ts
function handleExport() {
  const header = "OBD,Customer,Route,Vol,Status,Priority\n";
  const rows = filtered.map((o) => { ... }).join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `support-orders-${date}.csv`; a.click();
}
```

`filtered` = `displayOrders` from `support-page-content.tsx` (the currently visible list). When the user is in the "All" slot view (active segment clicked again → `section="slot-all"`, `slotId` omitted), `fetchOrders` calls `/api/support/orders?section=slot&date=D` with NO slotId. `orders/route.ts` today path without slotId:

```ts
// orders/route.ts line 85-88 (today, no slotId):
where.OR = [
  { workflowStage: { notIn: ["dispatched","cancelled","closed","order_created"] },
    obdEmailDate: { gte: istStart, lt: istEnd } },
  { workflowStage: { in: ["closed","dispatched","cancelled"] },
    obdEmailDate: { gte: istStart, lt: istEnd } },
];
// NO arrivalSlotId filter
```

All today's orders are included regardless of arrivalSlotId.

### A3. The delta — what causes the 12-order gap

Side-by-side comparison:

| Condition | Header (slots/route.ts) | Export (orders/route.ts All view) |
|-----------|------------------------|----------------------------------|
| `arrivalSlotId = some_slot.id` + not done | Counted in pendingCount or tintingCount | Included |
| `arrivalSlotId = null` + not done | **NOT counted anywhere** | **Included** |
| Done (closed/dispatched/hold/cancelled) | Counted in doneCount (no slot filter) | Included |

The 12-order gap = orders with `arrivalSlotId = null` in non-done stages (`pending_tint_assignment`, `tinting_in_progress`, `tint_assigned`, `pending_support` with `dispatchStatus=null`, `tinting_done`). These rows appear in the export but are counted in neither per-slot tiles nor doneCount.

The exact condition that produces the gap:
```
arrivalSlotId = null
AND workflowStage NOT IN (dispatched, closed, cancelled)
AND dispatchStatus != "hold"
AND isRemoved = false
AND obdEmailDate IN [today IST range]
```

### A4. Are the 12 orders tint orders?

YES. The gap is caused entirely by the OLD import code's tint guard, which the c901d6 build removed.

**Old code (pre-c901d6)** in both import paths (`handleManualSapConfirm` ~line 1018 and `handleAutoImport` ~line 2819):
```ts
// OLD — tint orders bypassed arrivalSlotId stamping
const arrivalSlotId = orderType !== "tint" && emailDateTime
  ? resolveArrivalSlotId(emailDateTime)
  : null;
```

→ Tint orders ALWAYS got `arrivalSlotId = null` at import.

**New code (c901d6)** — guard removed (both paths):
```ts
// NEW — tint orders now get arrivalSlotId at import
const arrivalSlotId = emailDateTime ? resolveArrivalSlotId(emailDateTime) : null;
```

c901d6 went live TODAY (2026-06-29). Any tint orders that were imported BEFORE the build went live have `arrivalSlotId = null`. Their `obdEmailDate` is today, so they fall inside the today IST fence and appear in the export — but `arrivalSlotId = null` → excluded from all per-slot counts → 12-order gap.

The 12 gap orders are precisely: tint orders imported today via manual SAP before c901d6 was deployed to Vercel.

**Link to Area B**: Area A's gap orders are those still in tint stages (pending_tint_assignment, tinting_in_progress, tint_assigned) or in pending_support but not yet acted on. Area B's "wrong slot" orders are the ones that DID get an arrivalSlotId stamped (post-build) — but got the wrong value. They are from the same root deficiency in the time input (see Area B below), but A and B are NOT the same root.

---

## Area B — Tint slot misplacement

### B1. Where emailDateTime comes from at SAP import

`app/api/import/obd/route.ts:148-161` — `mergeEmailDateTime`:
```ts
function mergeEmailDateTime(emailDate: Date | null, emailTime: string | null): Date | null {
  if (!emailDate || !emailTime) return emailDate;  // ← null time: returns date unchanged
  const [h, m] = emailTime.split(":").map(Number);
  const istMinutes = h * 60 + m;
  const utcMinutes = istMinutes - 330;
  // ... converts IST time to UTC, stores as UTC Date
}
```

For manual SAP (19-column format per CLAUDE_IMPORT §3.1): the SAP file has NO `OBD Email Time` column. The parser sets `obdEmailTime = null` for every row. `obdEmailDate` comes from the form field `fallbackObdEmailDate`, parsed as `new Date("YYYY-MM-DD")` = midnight UTC.

Result: `mergeEmailDateTime(midnightUTC, null) = midnightUTC`. No time merge occurs.

`emailDateTime = new Date("2026-06-29")` = `2026-06-29T00:00:00.000Z`.

**Auto-import v1** (paused) DID have OBD Email Date + Time from the LogisticsTracker sheet. When it was active, it could supply real email times. But it is paused and not running.

### B2. arrivalSlotId stamp at import — exact lines

`route.ts:1021-1022` (manual SAP confirm) and `route.ts:2822` (auto-import confirm):
```ts
const arrivalSlotId = emailDateTime ? resolveArrivalSlotId(emailDateTime) : null;
```

`lib/slots/slot-ruler.ts:80-84`:
```ts
export function resolveArrivalSlotId(date: Date, cutoffs = DEFAULT_SLOT_CUTOFFS): number {
  return SLOT_IDS[slotIndex(istMinutes(date), cutoffs)];
}
```

`istMinutes(2026-06-29T00:00:00.000Z)`:
- IST = UTC+5:30 → 00:00 UTC = 05:30 IST
- `h=5, m=30` → 5×60+30 = **330 minutes**

`slotIndex(330, DEFAULT_SLOT_CUTOFFS)` (`slot-ruler.ts:48-57`):
```ts
if (mins <= cutoffs.morning)     return 0;  // 330 <= 630 ✓ → index 0
```

`SLOT_IDS[0] = SLOT_MORNING = 1` (id=1).

**Result: ALL manual SAP orders (tint and non-tint) get `arrivalSlotId = 1` (Morning) at import when no email time is in the file.**

This is a pre-existing condition for non-tint orders (they've always gotten Morning slot from midnight UTC). It becomes newly visible for tint orders after c901d6 because before the build, tint orders had `arrivalSlotId = null` (invisible on tabs); now they get `arrivalSlotId = 1` (Morning, visible but wrong).

### B3. Does auto-import correct arrivalSlotId on a later pass?

Auto-import is PAUSED (2026-05-14). No later auto-import pass exists.

There IS `applyMailOrderEnrichment` (`route.ts:227-317`), which runs after every manual SAP import. It sets `arrivalSlotId` for mail-matched orders:

```ts
// route.ts:286-295
const receivedIST = mailOrder.receivedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const punchedIST  = mailOrder.punchedAt?.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) ?? null;
const arrivalBase = (punchedIST === null || receivedIST === punchedIST)
  ? mailOrder.receivedAt
  : mailOrder.punchedAt!;
updateData.arrivalSlotId = resolveArrivalSlotId(arrivalBase);
// ...
await prisma.orders.updateMany({ where: { soNumber: soNum }, data: updateData });
```

Enrichment runs `updateMany` for each soNumber that has a matching mail order. It DOES overwrite `arrivalSlotId` with a value derived from `mailOrder.receivedAt` (or `punchedAt` for carry-over) — which is the correct IST email time.

**BUT**: enrichment only runs when `mailOrder = await prisma.mo_orders.findFirst({ where: { soNumber: soNum } })` returns a result. The guard at line 236: `if (!mailOrder) continue;` — if no mail order match, the entire enrichment block (including `arrivalSlotId` correction) is SKIPPED. For non-mail-matched tint orders, `arrivalSlotId` stays at the wrong import-time value (Morning).

There is no other mechanism that re-runs `applyMailOrderEnrichment` if a mail order arrives AFTER the SAP OBD was already imported. Enrichment fires once, at SAP import time, for soNumbers in that batch.

### B4. orderDateTime vs arrivalSlotId — any divergence?

At import time (`route.ts:1057`):
```ts
orderData: {
  orderDateTime: emailDateTime,    // midnight UTC
  arrivalSlotId,                   // resolveArrivalSlotId(midnight UTC) = 1 (Morning)
  ...
}
```

Both source from the same `emailDateTime`. No divergence at import.

Enrichment (`route.ts:267-295`):
```ts
updateData.orderDateTime = mailOrder.receivedAt;      // correct IST time
// ...
updateData.arrivalSlotId = resolveArrivalSlotId(arrivalBase);  // correct slot
await prisma.orders.updateMany({ where: { soNumber: soNum }, data: updateData });
```

Enrichment corrects BOTH fields together via the same `updateMany`. No divergence after enrichment either.

For non-mail-matched orders: both `orderDateTime = midnight UTC` and `arrivalSlotId = 1 (Morning)` remain wrong. They are wrong in the same direction — no divergence between them, but both are wrong relative to the true arrival time.

### B5. Plain statement — why tint orders appear in the wrong slot tab

A tint order imported via manual SAP gets `arrivalSlotId = 1 (Morning)` because the SAP file has no time column → `obdEmailTime = null` → `emailDateTime = midnight UTC` → 05:30 IST → Morning slot. Enrichment only corrects this for mail-matched orders. Non-mail-matched tint orders are permanently stuck in the Morning slot tab regardless of their actual arrival time.

This is NEW behavior post-c901d6. Before the build, tint orders had `arrivalSlotId = null` (the old tint guard), so they were invisible on all slot tabs. After the build, they get `arrivalSlotId = 1` and appear in Morning — correct only for orders that truly arrived before 10:30 IST; wrong for all others.

The lines responsible:

- `route.ts:1021` (manual SAP confirm): `const arrivalSlotId = emailDateTime ? resolveArrivalSlotId(emailDateTime) : null;`
- `route.ts:2822` (auto-import confirm — same pattern)
- `route.ts:148-161` (`mergeEmailDateTime`): returns `emailDate` unchanged when `emailTime = null`
- `slot-ruler.ts:48-57` (`slotIndex`): 330 minutes IST (= midnight UTC in IST) → Morning

---

## Link verdict (are A and B one root?)

**No — two distinct bugs, same upstream deficiency.**

| | Area A (count gap) | Area B (wrong slot) |
|--|--|--|
| **Orders affected** | Tint orders imported BEFORE c901d6 today | Tint orders imported AFTER c901d6 today (non-mail-matched) |
| **arrivalSlotId value** | `null` | `1` (Morning — wrong) |
| **Symptom** | Not counted in header tiles | Appear in Morning tab instead of correct tab |
| **Root** | Old tint guard set arrivalSlotId=null; backfill not run on deploy | New stamp uses midnight UTC as time source; no email time in SAP file |
| **Shared upstream** | Both caused by no `obdEmailTime` in manual SAP 19-column format | ← same |

The c901d6 build PARTIALLY fixed the issue: it removed the null guard so tint orders now get a slot. But the time input is wrong (midnight UTC → Morning always), so the slot is still wrong for any order not corrected by enrichment. Area A is the "null" residue from before the build; Area B is the "wrong value" consequence of the build's fix.

---

## Fix gap list (no code)

Listed smallest-scope first per area.

### For Area A (count = header under-count)

**A-fix-1 — SQL backfill (smallest, no code deploy)**
Set `arrivalSlotId = 1` for today's tint orders with `arrivalSlotId = null` that have non-null `obdEmailDate`. Safe: any value is better than null for the count; they'd go into Morning slot (same destination as post-build imports). Run via Supabase SQL Editor.

**A-fix-2 — NULL-safe fallback in per-slot counts (one-line code fix)**
In `slots/route.ts` pendingCount / tintingCount / dispatchedCount queries for the today path, mirror the history path's NULL-safe pattern:
```ts
// history path already handles this:
OR: [{ arrivalSlotId: slot.id }, { arrivalSlotId: null, originalSlotId: slot.id }]
```
Add the same OR to today's per-slot counts. Orders with `arrivalSlotId = null` would then fall into the slot matching their `originalSlotId`. For tint orders created before today's build, `originalSlotId` is also null → they'd still be missed. So this fix alone is incomplete without A-fix-1 as a companion.

**A-fix-3 — "no-slot" counter bucket (additive, no removal)**
Add an `unslottedCount` to `slots/route.ts` that counts orders with `arrivalSlotId = null` in non-done stages today. Surface it in the header as a separate tile. Doesn't fix the root, but removes the invisible gap. Most conservative option.

**Interaction with c901d6**: All A fixes are additive to the import stamp logic shipped in c901d6 and don't touch it.

### For Area B (slot value = wrong slot)

**B-fix-1 — Use batch upload time when obdEmailTime is null (code deploy)**
In `handleManualSapConfirm` (and `handleAutoImport`), when `obdEmailTime = null`, derive `emailDateTime` from the current wall-clock time instead of midnight UTC. The import batch `createdAt` (or `new Date()` at processing time) is a reasonable proxy for arrival time — much better than midnight UTC → always-Morning.

Implementation: pass `new Date()` or `import_batch.createdAt` as the time component in `mergeEmailDateTime` when `emailTime = null`. Alternatively, override in `build-obd.ts` or `handleManualSapConfirm` directly.

**Scope**: Affects all manual SAP orders (tint AND non-tint) with no email time. Non-tint orders have had this bug since the beginning; they'd benefit too. No interaction with the tint-specific guard that c901d6 removed.

**B-fix-2 — Re-trigger enrichment on mail order arrival**
If a mail order with a matching soNumber arrives AFTER the SAP OBD was imported, fire `applyMailOrderEnrichment([soNumber])` at that point. This would correct `arrivalSlotId` (and `orderDateTime`) for late-arriving mail orders. Pre-existing gap, not introduced by c901d6. Requires a hook in the mail order parsing path.

**B-fix-3 — Backfill today's non-enriched tint orders**
After deploying B-fix-1, backfill `arrivalSlotId` for today's tint orders that got Morning by mistake. Use a SQL update that reads `import_batch.createdAt` for the batch that created each order.

### Ordering / interaction

1. A-fix-1 (SQL backfill) — immediate, no deploy needed, removes the 12-order header gap
2. B-fix-1 (use upload time) — small code change, deploy needed, prevents future wrong-slot stamps
3. A-fix-2 (NULL-safe slot count) — code change, prevents future null-slot gaps if B-fix-1 ever misses a case
4. B-fix-3 (backfill today's wrong-slot orders) — after B-fix-1 deploys
5. B-fix-2 (enrichment on mail arrival) — separate, larger scope, deferred

B-fix-1 and A-fix-2 interact in that A-fix-2 is a safety net for cases B-fix-1 might miss (e.g. if emailDateTime is null entirely). They are not redundant.

None of the fixes above touch `applyMailOrderEnrichment`'s arrivalSlotId logic, which is already correct for mail-matched orders.

---

*Discovery complete. No code changed. All findings from read-only code analysis.*
