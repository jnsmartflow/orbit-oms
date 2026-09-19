# Code discovery — 2026-08-06 — Floor's order-time source

Diagnosis only. No code changed, no schema changed.

## Summary

Floor Control's list rows and detail panel always show `orders.orderDateTime`, falling back to `orders.obdEmailDate` only when `orderDateTime` is empty. For any bill that has a matching mail order, `orderDateTime` gets permanently overwritten to the **email-received time** the moment the SAP delivery imports and matches by SO number — unconditionally, with no comparison against the actual SAP punch time. That is why Floor can show a bill as arriving "05 Aug 20:40" (when the customer's order email came in) even though SAP didn't actually punch the delivery until the next morning. The "compare the two clocks and use whichever is later" rule described in the Import canon as designed-but-not-built is confirmed still not built by reading the live code — there is no comparison at all for this field, just an unconditional overwrite.

## Field traced

**`orders.orderDateTime`** (falling back to `orders.obdEmailDate` when null) — read via the identical expression in three places:

- `lib/floor/queries.ts` — `getFloorRail()` line 350 and `getFloorBoard()` line 509: `obdDateTime: (order.orderDateTime ?? order.obdEmailDate)?.toISOString() ?? null`
- `app/api/floor/order/[orderId]/route.ts` line 140 — same expression, feeds `FloorDetail.obdDateTime`

Rendered by:
- `components/floor/rail-card.tsx:173` — rail card timestamp (`fmtWhen(card.obdDateTime)`)
- `components/floor/floor-table.tsx:175` — Floor board row
- `components/floor/detail-panel.tsx:344` and `components/floor/detail-details.tsx:58` — detail panel, labelled **"OBD date"**
- `components/floor/hold-tab.tsx:103`, `components/floor/cancelled-tab.tsx:132` — Hold/Cancelled tabs

All six call sites consume the one `obdDateTime` value computed server-side by the same `orderDateTime ?? obdEmailDate` expression — there is no separate client-side formatter picking a different field (no `formatOrderDateTime` helper exists under `components/floor/`; each component just calls a local date-formatting utility on the payload's `obdDateTime`).

## Write path

- **`app/api/import/obd/route.ts` — order creation** (both manual-SAP confirm, ~line 1131/1180, and the auto-json handler, ~line 2946/2992): `orderDateTime` and `obdEmailDate` are both set to `emailDateTime = mergeEmailDateTime(summary.obdEmailDate, summary.obdEmailTime)` — the raw SAP-row punch date+time. **The two fields start out identical.** Runs once, at import, for every new OBD.

- **`app/api/import/obd/route.ts:230` `applyMailOrderEnrichment(soNumbers)`** — runs immediately after order creation/patch in the same import batch, scoped only to the SO numbers just seen. For each SO number, looks up the newest matching `mo_orders` row. If found and `mailOrder.receivedAt` is truthy (line 303-304):
  ```ts
  if (mailOrder.receivedAt) {
    updateData.orderDateTime = mailOrder.receivedAt;   // unconditional — no comparison to obdEmailDate
    ...
  }
  ```
  `obdEmailDate` is **not** touched by this function at all — it is left exactly as SAP set it at creation. This write always wins over the creation-time value because it runs after and there is no guard/condition on it beyond "does a matching mail order exist and does it have a `receivedAt`."

- **`app/api/import/obd/route.ts:3330` `handleAutoImportPatchHeaders` (`?action=patch-headers`)** — the ~10-minute correction pass that later re-stamps `orderDateTime`/`obdEmailDate` together from a corrected SAP time (line 3440 `if (!mailOwned)`). It explicitly **skips** this repair when the OBD is mail-owned (`mailOwned = Boolean(mailOrder?.receivedAt)`, checked via a fresh `mo_orders` lookup at line 3431-3436). So once a bill is mail-matched, this pass never touches its `orderDateTime`/`obdEmailDate` again — the enrichment-written email time is permanent.

- **Auto-json's own header-patch for existing OBDs** (§10.1 of the Import canon, "patches `invoiceNo`, `orderDateTime`, `slotId` only if null") only fires when the field is currently `null`; it never overwrites a value enrichment already set.

Order of execution, top to bottom, for one OBD that turns out to be mail-matched: **create → enrichment overwrites `orderDateTime` → every later correction pass declines to touch it because it's mail-owned.**

## Conditions

**Not conditional — unconditional whenever a mail-order match exists.** There is no code path where Floor would show the punch/billing time instead of the email time for a mail-matched bill, other than the practically-impossible case of `mo_orders.receivedAt` being null (the column isn't nullable in the schema and is always populated by the ingest route). Concretely:

- **No `mo_orders` match ever** (pure SAP-only bill): `orderDateTime` stays what it was set to at creation/patch-headers — the real SAP punch time. Floor shows the punch time. Correct, unremarkable case.
- **A `mo_orders` match exists** (any point after the matching SO number is seen): `orderDateTime` = `mo_orders.receivedAt` (email time), permanently, regardless of when SAP actually punched the delivery, and regardless of how many days apart the two events are. Floor shows the email time, forever, for that bill.

This confirms `CLAUDE_IMPORT.md §12.2` at the code level: the "intended" rule — compare `orderDateTime` vs `obdEmailDate` by IST calendar day and use the later one — is **not built**. It's not just "using the old rule" either; there is no comparison logic guarding `orderDateTime` at all in `applyMailOrderEnrichment`. (The *old* receivedAt-vs-punchedAt IST-day comparison that IS present at lines 322-331 governs a different field — `arrivalSlotId` — not `orderDateTime`.) `CLAUDE_FLOOR.md §10`'s landmine ("the floor row displays orderDateTime while the slot was decided by obdEmailDate") is confirmed accurate and, per this trace, understates it slightly: it isn't just that the two disagree — `orderDateTime` is structurally pinned to the email clock for the life of a mail-matched bill.

## Worked example — OBD 9108720396 / SO 1046448389 / Shree Rang Sarovar

Three different timestamps exist for this one bill, from three different systems:

1. **`mo_orders.receivedAt` = 05 Aug 2026, 20:40** — when the customer's order email arrived and was parsed by Mail Orders.
2. **SAP's own record of the delivery — 2026-08-06, 10:07:46** — the true OBD punch time, captured on the `import_raw_summary` row for this OBD (`obdEmailDate`/`obdEmailTime`) when SAP actually emitted the delivery the next morning. (The exact on-screen modal the user described as "Received On / Received At" wasn't located verbatim in the current component tree during this trace — the closest live surface reading these fields with friendly-looking output is `import-page-content.tsx`/`import-modal.tsx`, which format `obdEmailDate`/`obdEmailTime` from the SAP row. Functionally this is the same raw SAP timestamp described above regardless of which exact screen rendered it.)
3. **Billing's "punched by Deepanshu Thakur 09:59" (06 Aug)** — `mo_orders.punchedAt`/`punchedById`, the moment the billing operator saved the SO Number against this mail order in Mail Orders (a Mail-Orders-side action, unrelated to SAP).

When OBD 9108720396 imported on 06 Aug and its `soNumber` (`1046448389`) matched the existing `mo_orders` row, `applyMailOrderEnrichment` ran: it found `mailOrder.receivedAt` = 05 Aug 20:40 and wrote `orders.orderDateTime = 05 Aug 20:40` unconditionally — no check against the SAP punch time (06 Aug 10:07:46) or against how many calendar days apart the two events were. `orders.obdEmailDate` was never touched by enrichment, so it still holds whatever was written at creation/patch-headers (the real SAP-side time) — but Floor's display expression prefers `orderDateTime` whenever it's non-null, so `obdEmailDate` never gets a chance to show through.

**Plain-English conclusion:** Floor shows 05 Aug 20:40 instead of the 06 Aug punch time because the code has exactly one rule for a mail-matched bill's displayed time — "always the email-received time" — and that rule has no exception for how late the actual SAP punch arrives. The billing screen's 09:59 timestamp is a third, still-different clock (the operator's own punch action inside Mail Orders) that Floor doesn't read at all.

## Canon accuracy check

- **`CLAUDE_FLOOR.md §10`** landmine ("floor row displays orderDateTime while the slot was decided by obdEmailDate") — **confirmed accurate**, and this trace adds the missing mechanism: it's not a race or an occasional disagreement, it's a structural, permanent pin once a mail match exists.
- **`CLAUDE_IMPORT.md §12.2`** ("the intended same-day/different-day arrival-slot rule is designed but NOT built; the live fork still compares receivedAt vs punchedAt") — **confirmed still true** as of this trace (2026-08-06), reading `route.ts` directly. One nuance worth folding back into canon: the receivedAt-vs-punchedAt day comparison that already exists in `applyMailOrderEnrichment` governs `arrivalSlotId` only (lines 322-331) — it has never applied to `orderDateTime` itself, which has no comparison logic of any kind, just an unconditional overwrite (line 302-304). §12.2's framing ("the fork... compares receivedAt vs punchedAt") is accurate for the slot fork but could be misread as also describing how `orderDateTime` is chosen — it isn't; `orderDateTime` has no fork at all.
- **`CLAUDE_CORE.md §9`** ("applyMailOrderEnrichment()... sets orderDateTime from mo_orders.receivedAt") — **confirmed accurate and precise**, matches the code exactly at line 302-304.
