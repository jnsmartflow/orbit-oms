# code-update-2026-07-11 — obdEmailDate time-strip fix + IST carried-over badge

**Commit:** `3c0cd366` (main)
**Files:** `app/api/import/obd/route.ts`, `app/api/support/orders/route.ts`
**Type:** root-cause bug fix (import correction pass) + tag-along IST fix
**DB:** not touched. No schema change. No backfill (orders self-correct on next auto-import batch).

---

## What was wrong (plain English)

An order (OBD `9108192224`, SO `1046195285`) appeared under the **Morning** arrival
slot when it should not have. Chasing it revealed the arrival slot itself was fine —
the real problem was upstream, in how `orders.obdEmailDate` gets its time.

Workflow that exposed it:

- **Auto-import** runs every ~10 min and carries the OBD's **real date + time**.
- **Urgent manual SAP upload** uses a template with **no time column**, so the order
  is stamped date-only → midnight → **05:30 IST** → always buckets to **Morning**.
- The **next auto-import batch** is supposed to correct that order once the real time
  is available. It does correct `orderDateTime` — but it was **stripping the time back
  off `obdEmailDate`**.

### The exact bug

In `handleAutoImportPatchHeaders` (the correction pass), two fields were written from
two different sources in the same block:

```
updateData.orderDateTime = newDT;         // merged date+time  ✓ real time
updateData.obdEmailDate  = incomingDate;  // raw date-only     ✗ midnight (BUG)
```

`newDT` (the merged, correct timestamp) was in hand — but `obdEmailDate` was filled
from the bare `incomingDate` instead. So every header-patched order lost its time on
`obdEmailDate` and reverted to midnight.

Analogy: the correction crew had the right time in their hand, stamped it correctly on
one field, then wrote the plain date on the other — a sloppy copy, not a lost value.

---

## The fixes (committed `3c0cd366`)

### Edit 1 — source fix (root cause)
`app/api/import/obd/route.ts` · `handleAutoImportPatchHeaders` (~3362-3364)

```diff
             updateData.orderDateTime = newDT;
-          updateData.obdEmailDate  = incomingDate;
+          updateData.obdEmailDate  = newDT;
             changedFields.push("orderDateTime", "obdEmailDate");
```

`obdEmailDate` now carries the real merged date+time, same as `orderDateTime`.
The `mergeEmailDateTime` / `parseDateCell` logic that builds `newDT` was **not** changed.

### Edit 2 — IST carried-over badge fix (tag-along, same root theme)
`app/api/support/orders/route.ts` (~200)

```diff
-    const obdDate = order.obdEmailDate?.toISOString().slice(0, 10) ?? dateStr;
+    const obdDate = order.obdEmailDate
+      ? order.obdEmailDate.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
+      : dateStr;
```

`isCarriedOver` / `daysOverdue` was extracting the order's day in **UTC**
(`toISOString().slice(0,10)`). For any order timed 00:00–05:29 IST, the UTC date reads
one day earlier → false "carried over" badge + bogus overdue count. Switched to the IST
`toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })` idiom so the day matches the
board's date. The `?? dateStr` fallback was preserved.

---

## Side effect: two other modules quietly repaired

`orders.obdEmailDate` is read by more than the arrival slot. Because header-patched
orders were feeding a fake midnight, these were **already silently degraded** and are now
fixed for free by Edit 1:

- **Dispatch engine** (`lib/dispatch/dispatch-engine.ts`) reads `obdEmailDate` as its
  `punchDateTime` for a same-day/different-day "effective clock" pick. It was getting fake
  midnight for patched orders → wrong clock. Now correct.
- **Support order display** (`support-orders-table.tsx`, `support-hold-table.tsx`) showed
  `00:00` for previously-patched orders → now shows real time.

Blast radius of the change is Support/import/dispatch reads that were **already** assuming
a real time; nothing depended on `obdEmailDate` being date-only. (One read site,
`support/orders/route.ts:200`, did assume date-only via UTC slice — that is Edit 2 above.)

---

## Verification (pending — run after next auto-import batch)

Read-only. Fresh / re-patched orders should read **"has real time"**, not "STILL MIDNIGHT".

```sql
-- Verify patch-headers now keeps real time on obdEmailDate
SELECT
  o."obdNumber",
  o."soNumber",
  to_char(o."obdEmailDate" AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI') AS obd_email_ist,
  to_char(o."orderDateTime" AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI') AS order_dt_ist,
  CASE
    WHEN to_char(o."obdEmailDate" AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') = '00:00'
      THEN 'STILL MIDNIGHT'
    ELSE 'has real time'
  END AS obd_time_check
FROM orders o
WHERE o."isRemoved" = false
  AND o."obdEmailDate" >= (now() AT TIME ZONE 'Asia/Kolkata')::date - interval '1 day'
ORDER BY o."obdEmailDate" DESC
LIMIT 30;
```

Expected: recent orders say "has real time". A brand-new manual upload not yet revisited by
a batch may still show midnight until its next batch pass — that is normal.

**No backfill.** Already-wrong orders correct themselves on their next auto-import batch;
the rest age out. Decision: not worth a one-time re-stamp.

---

## OPEN — next step (not done yet)

The **arrival-slot fork itself is still the OLD rule.** Inside
`applyMailOrderEnrichment` (`route.ts:299-308`) it still compares
`mo_orders.receivedAt` vs `mo_orders.punchedAt`. The intended new rule was NOT applied in
this commit — this commit only made `obdEmailDate` trustworthy so the new rule can safely
use it.

### The intended new arrival-slot rule (to build next)
Compare `orders.orderDateTime` vs `orders.obdEmailDate` by IST calendar day:

| Situation | Timestamp used for arrival slot |
|---|---|
| same IST day | `orderDateTime` (real mail time) |
| different IST day (order blocked, released later) | `obdEmailDate` (release/finalize time) |

Since the OBD always follows the mail, earliest = `orderDateTime`, latest = `obdEmailDate`
— so no min/max step is needed. **No midnight fallback needed anymore** now that Edit 1
guarantees `obdEmailDate` carries a real time.

Notes for that build:
- Single edit to the fork in `applyMailOrderEnrichment` (site A) is enough — it runs last
  and wins for mail-matched orders. Non-mail orders already have
  `orderDateTime == obdEmailDate`, so the same-day branch gives them today's behaviour.
- Blast radius is Support screens only. Mail Orders pills, Trip, Dispatch do not read
  `arrivalSlotId`.
- Reuse the `toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })` idiom for the
  day comparison — no new date lib.
- Confirm OBD `9108192224` re-buckets correctly once a fresh order with the real time
  flows through.
