# Discovery: JSON auto-import slot re-stamp gap
# Date: 2026-06-30 · Read-only · No code changed

Follows on from: `docs/prompts/drafts/code-discovery-2026-06-29-support-count-slot.md`
That doc traced Area A (header count mismatch) and Area B (tint slot misplacement) from the
manual-SAP path. This doc traces the v2 JSON auto-import path and answers whether it re-stamps
`arrivalSlotId` when it corrects arrival time.

---

## Context

Auto-import v2 (`?action=auto-json`) is live. Per the design doc
(`docs/prompts/archive/2026-06/web-update-2026-06-20-auto-import-v2-pure-json.md`), the
pipeline has four server-side actions:

| action | handler | purpose |
|---|---|---|
| `?action=check` | `handleAutoImportCheck` | pre-check: return OBD numbers already in DB |
| `?action=auto-json` | `handleAutoImportJson` → `processAutoImportRows()` | CREATE new OBDs from JSON payload |
| `?action=patch-headers` | `handleAutoImportPatchHeaders` | CORRECTION: update existing OBDs with real email time + invoice |
| `?action=pending-invoices` | `handleAutoImportPendingInvoices` | read-only: list OBDs still missing invoiceNo |

All four are dispatched in `app/api/import/obd/route.ts` lines 3422–3426.

The correction pass (`?action=patch-headers`) is what the previous discovery identified as the
likely slot re-stamp route. This discovery verifies its exact behaviour.

---

## Q1 — Name the live JSON auto-import file and function that UPDATES an existing OBD

**File:** `app/api/import/obd/route.ts`
**Function:** `handleAutoImportPatchHeaders` (lines 3191–3327)
**Dispatch:** `if (action === "patch-headers") return handleAutoImportPatchHeaders(req);` (line 3425)
**HMAC:** same v2 key as auto-json (`IMPORT_HMAC_SECRET_JSON`, key id `auto-import-json-v1`)

This is the only handler that writes to an existing OBD on a correction pass. `handleAutoImportJson`
delegates to `processAutoImportRows()` which is **CREATE-only** — existing OBDs are filtered out
at STEP B (existingObdSet) and never touched.

---

## Q2 — Quote the exact update data block where it writes the corrected time

From `handleAutoImportPatchHeaders`, section c (lines ~3277–3306):

```ts
// ── c. Time / slot — only if NOT mail-owned ──────────────────────────────
if (!mailOwned) {
  const incomingDate = parseDateCell(raw["OBD Email Date"]);
  const incomingTime = toStr(raw["OBD Email Time"]) || null;
  const newDT        = mergeEmailDateTime(incomingDate, incomingTime);

  if (newDT !== null) {
    const existingMs = existing.orderDateTime?.getTime() ?? null;
    if (existingMs !== newDT.getTime()) {
      updateData.orderDateTime = newDT;
      updateData.obdEmailDate  = incomingDate;
      changedFields.push("orderDateTime", "obdEmailDate");
      counts.timeFixed++;

      if (existing.orderType !== "tint") {
        if (!existing.slotToOverride) {
          const { slotId, dispatchSlot } = resolveSlot(incomingTime);
          updateData.slotId         = slotId;
          updateData.originalSlotId = slotId;
          updateData.dispatchSlot   = dispatchSlot;
          changedFields.push("slotId", "originalSlotId", "dispatchSlot");
          counts.slotFixed++;
        } else {
          counts.slotOverrideKept++;
        }
      }
    }
  }
}
```

---

## Q3 — CRITICAL: is arrivalSlotId present in that updateData block?

**`arrivalSlotId` is absent. It is not written anywhere in `handleAutoImportPatchHeaders`.**

A grep for `arrivalSlotId` in the entire route.ts file confirms it appears in exactly three places:
1. `applyMailOrderEnrichment` (line 295) — sets it for mail-matched orders
2. `processAutoImportRows` (line 1021 manual path, line 2822 auto path) — sets it at CREATE time
3. Zero occurrences in `handleAutoImportPatchHeaders`

The function's counters (`counts.slotFixed`, `counts.mailOwnedSkipped`, etc.) have no `arrivalSlotFixed`
counter either, confirming the omission was not accidental tracking — `arrivalSlotId` was never part
of the patch-headers design.

---

## Q4 — If re-stamp is missing, name the exact spot it must be added

Inside `handleAutoImportPatchHeaders`, the re-stamp must be added immediately after `counts.timeFixed++`
and **before** the `if (existing.orderType !== "tint")` guard:

```ts
counts.timeFixed++;

// ADD HERE — arrivalSlotId: re-stamp whenever orderDateTime changes, for all order types
updateData.arrivalSlotId = resolveArrivalSlotId(newDT);
changedFields.push("arrivalSlotId");

if (existing.orderType !== "tint") {
  ...
}
```

Why **before** the tint guard: `arrivalSlotId` is the arrival-day slot (5-slot ruler, which slot
the OBD arrived in). It applies to BOTH tint and non-tint orders. The tint guard that follows it
correctly applies only to `slotId`/`originalSlotId`/`dispatchSlot` (completion-time slots, null
for tint until mixing finishes). The two slot types are distinct:

| field | meaning | set when | applies to |
|---|---|---|---|
| `arrivalSlotId` | which slot the OBD *arrived* in | import time | all orders |
| `slotId` / `originalSlotId` | completion slot (dispatch window) | SAP: at import; tint: at completion | all orders |

Adding `arrivalSlotId` before the tint guard means:
- Non-tint orders: `arrivalSlotId` + `slotId`/`dispatchSlot` all recomputed
- Tint orders: only `arrivalSlotId` recomputed (`slotId` stays null — correct)

---

## Q5 — Does this JSON path run for ALL corrected orders, or only mail-matched ones?

**The patch-headers correction pass runs for non-mail-owned orders only.**

Section b of `handleAutoImportPatchHeaders` (lines ~3264–3307):

```ts
// ── b. Mail-owned check ──────────────────────────────────────────────────
const soNum = toStr(raw["SONum"]) || null;
let mailOwned = false;
if (soNum) {
  const mailOrder = await prisma.mo_orders.findFirst({
    where:   { soNumber: soNum, status: "punched" },
    orderBy: { createdAt: "desc" },
    select:  { receivedAt: true },
  });
  mailOwned = Boolean(mailOrder?.receivedAt);
}

// ── c. Time / slot — only if NOT mail-owned ──────────────────────────────
if (!mailOwned) {
  // ... correction applied here
} else {
  if (parseDateCell(raw["OBD Email Date"]) !== null) {
    counts.mailOwnedSkipped++;
  }
}
```

Mail-owned orders are skipped entirely in the time/slot section. This is CORRECT — mail-order
enrichment (`applyMailOrderEnrichment`, run after every import, line 295) already handles
mail-matched orders and DOES stamp `arrivalSlotId` correctly:

```ts
updateData.arrivalSlotId = resolveArrivalSlotId(arrivalBase);
// where arrivalBase = mailOrder.receivedAt (or punchedAt for carry-over)
```

So the gap is:
- **Mail-owned orders**: `arrivalSlotId` correct (via `applyMailOrderEnrichment`)
- **Non-mail-owned orders corrected by patch-headers**: `arrivalSlotId` NOT updated ← BUG

---

## Auto-json CREATE path (first-time OBD, no prior import)

For completeness: when an OBD is created fresh via `?action=auto-json`, `processAutoImportRows`
stamps `arrivalSlotId` correctly at line 2822:

```ts
const emailDateTime = mergeEmailDateTime(summary.obdEmailDate, summary.obdEmailTime);
// ...
const arrivalSlotId = emailDateTime ? resolveArrivalSlotId(emailDateTime) : null;
// ...
// then in createMany data:
arrivalSlotId,
```

The Breakwalls `/data` JSON includes `PickListEmailTime` (real time from the source system),
mapped to `"OBD Email Time"` in headerRows per design doc §3.4. So a first-time auto-json import
has a real email time → `arrivalSlotId` is correct.

The gap only triggers when an OBD was **already imported by manual SAP** (null email time →
`arrivalSlotId = Morning`) before auto-import ran its correction pass.

---

## Full slot-assignment matrix (post-c901d6 + v2 live)

| Import path | Order type | arrivalSlotId at create | Correction pass | arrivalSlotId after correction |
|---|---|---|---|---|
| Manual SAP | non-tint | Morning (wrong — null time → midnight UTC → 330 min → Morning) | applyMailOrderEnrichment (mail-owned) | Correct ✓ |
| Manual SAP | non-tint | Morning (wrong) | patch-headers (non-mail-owned) | **Still Morning ✗ — not re-stamped** |
| Manual SAP | tint | Morning (wrong, post-c901d6) | applyMailOrderEnrichment (mail-owned) | Correct ✓ |
| Manual SAP | tint | Morning (wrong) | patch-headers (non-mail-owned) | **Still Morning ✗ — not re-stamped** |
| auto-json (first create) | non-tint | Correct (real PickListEmailTime) | n/a (new order, no patch needed) | n/a |
| auto-json (first create) | tint | Correct (real PickListEmailTime) | n/a | n/a |

---

## Link to Area B from prior discovery

Area B (tint orders appear under wrong arrival slot tab) has TWO contributing causes:

1. **Manual SAP null time → Morning** (identified in prior discovery)
2. **patch-headers does not re-stamp arrivalSlotId** (THIS discovery)

If auto-import's patch-headers ran and DID re-stamp `arrivalSlotId`, the Area B symptom would
self-heal for non-mail-owned orders within one or two auto-import cycles (once Breakwalls has
`PickListEmailTime` for that OBD and the patch sees the time changed). Without the re-stamp, the
slot is permanently stuck at Morning for those orders.

Area A (header count mismatch) is unaffected — that bug is about null `arrivalSlotId` excluding
orders from slot-tab header counts. The patch-headers correction does not change whether an order
has a null `arrivalSlotId`; it just corrects a wrong non-null value.

---

## Fix gap list (cross-referenced with prior discovery)

| ID | Fix | File | Exact spot |
|---|---|---|---|
| C-fix-1 | Add `arrivalSlotId` re-stamp to patch-headers | `app/api/import/obd/route.ts` | After `counts.timeFixed++` in `handleAutoImportPatchHeaders`, before `if (existing.orderType !== "tint")` |
| A-fix-1 | SQL backfill: set `arrivalSlotId` from `orderDateTime` for orders where null | Supabase SQL Editor | UPDATE orders SET arrivalSlotId = resolved value WHERE arrivalSlotId IS NULL AND orderDateTime IS NOT NULL |
| A-fix-2 | NULL-safe slot count: add `OR (arrivalSlotId IS NULL AND originalSlotId = slot.id)` fallback to today-path per-slot counts | `app/api/support/slots/route.ts` | lines 151–169 pendingCount + tintingCount + dispatchedCount |
| B-fix-1 | Same as C-fix-1 — once patch-headers re-stamps correctly, future wrong-slot cases self-heal | same | same |
| B-fix-2 | SQL backfill: recompute `arrivalSlotId` for existing orders stuck at Morning despite arriving later | Supabase SQL Editor | UPDATE orders SET arrivalSlotId = resolved value WHERE arrivalSlotId = 1 AND orderDateTime time-of-day > 10:30 IST |

Priority: C-fix-1 first (prevents future recurrence) → A-fix-1 + B-fix-2 backfill together
(corrects existing data) → A-fix-2 as a defensive NULL-safe guard.

---

## What was NOT found / caveats

- The v2 PS script (`Auto-Import-v2.ps1`) is not committed to the repo; it lives on the depot PC
  at `F:\VS Code\OBD-Import Tool v2\`. Confirmed from design doc. Cannot verify from code whether
  `?action=patch-headers` is actively being called each cycle — this must be confirmed operationally.
- `docs/Powershell/0-FrtIngestion.ps1`, `3-PendingFetch.ps1`, `4-LogisticsEntry.ps1` are part of
  the Breakwall/LogisticsEntry freight-report pipeline — completely unrelated to OBD auto-import.
- `docs/Powershell/Auto-Import.ps1` is the v1 XLS-based script (paused, uses `?action=auto`).

---

*Discovery-only doc · Read-only · No code changed · 2026-06-30*
