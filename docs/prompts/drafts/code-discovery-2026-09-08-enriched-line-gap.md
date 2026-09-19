# Code discovery — the missing `import_enriched_line_items` rows
# 2026-09-08 · diagnosis only, no code written · reader: whoever picks up the fix

Scope read: `docs/CLAUDE_CORE.md` §3, `docs/CLAUDE_IMPORT.md` (whole file),
`lib/import-upsert.ts` (the entry file — there is **no** `lib/import-upsert/index.ts`),
`lib/import-upsert/{lines,effects,audit,helpers}.ts`, and
`app/api/import/obd/route.ts` (both the manual-sap confirm handler and the auto-json handler).

---

## Q1 — Where enriched rows are created

**Two write sites in the entire repo. Both are in `app/api/import/obd/route.ts`. Neither is on the manual-SAP path.**

| # | File + lines | Inside | Serves |
|---|---|---|---|
| 1 | `app/api/import/obd/route.ts:1368-1392` — build loop 1369-1383, `createMany` at **1387** | `handleConfirm` (STEP D5) | `?action=confirm` — the **legacy** template confirm |
| 2 | `app/api/import/obd/route.ts:3212-3239` — build loop 3213-3227, `createMany` at **3231** | `processAutoImportRows` (CONFIRM D5) | `?action=auto` **and** `?action=auto-json` (the live auto path; `handleAutoImportJson:3353` delegates here) |

**Creation is create-path only, and only on those two paths.** Both loops iterate
`o.validLines` of orders the handler just created in this batch — never an existing OBD:

- Auto path, `route.ts:2663` — `if (existingObdSet.has(obdNumber)) continue;` — an existing OBD never enters `autoOrderInterims`, so it never reaches CONFIRM D5.
- Legacy confirm, `route.ts:805` — an existing OBD is stamped `rowStatus = "duplicate"` and dropped before D5.

**The patch path creates a raw line and no enriched row.** `applyLinePatch` inserts adds with
`lib/import-upsert/lines.ts:187-204`:

```ts
if (plan.adds.length > 0) {
  await prisma.import_raw_line_items.createMany({ data: plan.adds.map(...) });   // lines.ts:187
}
```

That is the whole insert. There is no enriched write anywhere in `lib/import-upsert/*` — the
create branch (`lib/import-upsert.ts:240-257`) writes raw lines only, `effects.ts:47-92` emits five
effect kinds and none of them is an enrichment of this table (`mail-order-enrichment` is the
`mo_orders` hook, a different thing entirely), and `audit.ts` writes only `order_status_logs`.

---

## Q2 — Root cause of the added-line gap (population 1)

`handleManualSapConfirm` (`route.ts:1595-1836`) has **no D5 step at all**. Its entire per-OBD body
is the `upsertObd` call at `route.ts:1729`, followed by the effect-dispatch loop
(`route.ts:1759-1793`) which handles `mail-order-enrichment`, `challan-create`,
`query-summary-rebuild`, `customer-resolved` and `order-type-mismatch` — and nothing else. The
upsert brain it delegates to writes raw lines and never enriched ones. So the manual-SAP path has
never written a single `import_enriched_line_items` row, on create or on patch. When a re-upload
adds a line to an OBD that auto-import created earlier, the sibling lines have enriched rows
(auto-import made them at CONFIRM D5) and the new one does not — which is exactly the shape live
data shows on OBD 9109269668: line 900001 (auto-created) enriched, line 900028 (added by
BATCH-20260907-063, a `[manual-sap]` batch) not.

**Exact line responsible:** `lib/import-upsert/lines.ts:187` —
`await prisma.import_raw_line_items.createMany({ data: plan.adds.map(...) })`. That statement is
the only insert an added line ever gets. (Its enclosing caller, `route.ts:1729`, is where the gap
is *structurally* owned: the manual-sap handler is the one confirm handler with no enriched step.)

---

## Q3 — Whole-bill hypothesis (population 2)

**Hypothesis: these are the bills that manual-SAP *created*, not merely patched — same root cause as
population 1, one level up.** Auto-import is create-only and enriches everything it creates; manual
SAP creates a bill with zero enriched rows and nothing ever backfills. A bill that auto-import
reaches first gets full enrichment for life; a bill auto-import never sees is created by
`handleManualSapConfirm` → `createPath` (`lib/import-upsert.ts:240`) and is 100% unenriched from
birth. The monthly shape supports this before any query is run: auto-import resumed **2026-06-20**
(`CLAUDE_IMPORT.md §10`), so June 1-19 had **no** auto path at all — every bill in that window was
manual-SAP-created, which is why June is 1,808 bills against 416 / 338 / 104 for the months after.
The residue in Jul-Sep would then be the bills auto-import structurally misses: Sundays (§10 —
"no batches on Sundays"), OBDs landing outside the 08:15-22:52 IST batch window, and anything the
3-day chase window did not recover. This is **not** a legitimate never-enriched order category —
nothing in the code branches enrichment on order type, SMU, item category or the tint flag; both D5
loops enrich every valid line unconditionally, and the only per-line variation is `lineWeight`/`note`
flipping on `sku_master_v2` recognition.

`orders.batchId` is a safe discriminator: it is set at create on both paths
(`lib/import-upsert.ts:167`, `route.ts:3013`) and `header.ts:6` lists it as **locked** — patch never
rewrites it. `import_batches` has no `source` column; the marker is the `headerFile` prefix
(`[manual-sap]` at `route.ts:1627`, `[auto-import]` at `route.ts:2616`, `[<templateId>]` at
`route.ts:743`).

### The query — READ-ONLY, not run

```sql
-- READ-ONLY. Does "no enriched rows" line up with the batch that CREATED the order?
WITH bill AS (
  SELECT
    o."id"                                                                        AS order_id,
    date_trunc('month', o."createdAt")                                            AS month,
    CASE
      WHEN b."headerFile" LIKE '[manual-sap]%'  THEN 'manual-sap'
      WHEN b."headerFile" LIKE '[auto-import]%' THEN 'auto-import'
      ELSE 'legacy-template'
    END                                                                           AS created_by,
    COUNT(*) FILTER (WHERE rli."lineStatus" = 'active')                           AS active_lines,
    COUNT(*) FILTER (WHERE rli."lineStatus" = 'active' AND eli."id" IS NULL)      AS unenriched_lines
  FROM orders o
  JOIN import_batches b                    ON b."id"   = o."batchId"
  JOIN import_raw_line_items rli           ON rli."obdNumber" = o."obdNumber"
  LEFT JOIN import_enriched_line_items eli ON eli."rawLineItemId" = rli."id"
  WHERE o."createdAt" >= DATE '2026-06-01'
    AND o."createdAt" <  DATE '2026-09-09'
  GROUP BY o."id", month, b."headerFile"
)
SELECT
  month,
  created_by,
  COUNT(*)                                                              AS bills,
  COUNT(*) FILTER (WHERE unenriched_lines = 0)                          AS fully_enriched,
  COUNT(*) FILTER (WHERE unenriched_lines = active_lines)               AS whole_bill_gap,
  COUNT(*) FILTER (WHERE unenriched_lines > 0
                     AND unenriched_lines < active_lines)               AS partial_gap,
  SUM(unenriched_lines)                                                 AS missing_rows
FROM bill
WHERE active_lines > 0
GROUP BY month, created_by
ORDER BY month, bills DESC;
```

**What a PASS proves.** `whole_bill_gap` sits essentially entirely in the `manual-sap` row and
equals that row's `bills` count (manual-SAP-created bills are ~100% whole-bill gaps, `fully_enriched`
≈ 0); the `auto-import` row shows `whole_bill_gap` ≈ 0 and carries the `partial_gap` count (that is
population 1 — auto-created bills that manual-SAP later added a line to); and the June `manual-sap`
row is far larger than July's. That confirms population 2 is the same defect as population 1, that
the discriminator is the *creating source* and nothing about the order's category, and that no
further hypothesis (order type / SMU / item category / tint) needs testing.

**What a FAIL proves.** If `whole_bill_gap` is spread across `created_by`, or if a large number of
`manual-sap`-created bills come back `fully_enriched`, then the creating batch is not the
discriminator — something else is writing or suppressing enrichment, and the next cut is by
`orders."orderType"`, `orders."smu"` and `import_raw_line_items."isTinting"` on the gap set alone.
A partial pass (manual-sap dominates but auto-import also shows whole-bill gaps) would mean a
*second*, separate hole on the auto path — most likely batches where the `createMany` at
`route.ts:3231` threw and the handler returned 500 after the orders were already committed at
`route.ts:3049`, which would show up as `import_batches.status = 'failed'` on those batches.

---

## Q4 — Who reads `import_enriched_line_items`

Swept twice (ripgrep with slash char-classes, then MSYS `grep -rn` over the whole repo minus
`node_modules`); the two sweeps reconcile exactly. Fifteen files mention the table or the
`enrichedLineItem` relation. **Thirteen of the fifteen are comments** — the `docs/prompts/…19b`
catalog-repoint warnings telling future authors *not* to resolve the catalog through
`enrichedLineItem.sku` (`lib/picking/resolve-lines.ts:17`, `lib/picking/queue.ts:570`,
`lib/picking/family-groups.ts:17`, `app/api/picking/order/[orderId]/route.ts:27,131`,
`app/api/picking/combined/route.ts:140`, `app/api/floor/order/[orderId]/route.ts:80`,
`app/api/billing/picking/order/[orderId]/route.ts:153`, plus the two write sites' own comments).
**An import is not a call — and here most of them are not even imports.**

### Real readers

| Reader | How it uses the table | What a missing row does |
|---|---|---|
| `app/api/orders/[id]/detail/route.ts:107-124` | **Drives the query.** `lineItems` is built by `findMany` on `import_enriched_line_items` filtered by `rawLineItem.lineStatus = "active"`; raw is reached only through the nested `select`. | A bill with no enriched rows returns **`lineItems: []`** — the panel shows an order with zero line items even though its active raw lines exist. Not a wrong value; a blank list. `removedLineCount` (line 155) counts raw directly and is unaffected, so the panel would show "Show removed (2)" above an empty items list. |
| `app/api/orders/[id]/removed-lines/route.ts:60,91` | Reads raw lines, uses enriched only for `lineWeight` via the optional relation, already null-coalesced. | `lineWeight` renders as null/`—`. Cosmetic — and per `CLAUDE_IMPORT.md §14` `lineWeight` is not a weight, it is a "was this SKU recognised" flag that nothing does arithmetic on. |
| `scripts/_diagnose-skuid-collision.ts`, `scripts/_diagnose-sku-5961032.ts`, `scripts/_smoke-order-detail-repoint.ts` | Underscore-prefixed scratch diagnostics, outside the `tsc --noEmit` gate, never imported by the app. | Nothing — not live code. |
| `archive/2026-07-support/api/support/orders/[id]/route.ts:73` | Retired 2026-07-27. | Nothing — route does not resolve. |

### Real impact on a picker, tint operator or biller today: **none.**

Chasing the client of the one route that would break: `/api/orders/[id]/detail` is fetched from
exactly one place — `components/shared/order-detail-panel.tsx:142` (and `:306` for removed-lines) —
and **that component has no live importer**. `OrderDetailPanel` is referenced only by the archived
support table (`archive/2026-07-support/components/support/support-orders-table.tsx:22,652`) and two
`docs/` review copies. `components/tint/manager/board-detail-panel.tsx:6-10` states in its own header
that it superseded it and that the file "simply loses its last import" (CORE §3 — not deleted).
The live panels get their data elsewhere: the Tint Manager panel renders from board data it already
holds, and Billing's uses `BillingOrderDetailPanel` → `/api/billing/picking/order/[orderId]`.

So the picker, tint operator and biller all read **`import_raw_line_items`**, which is complete on
every one of these bills. The table's practical status today is: written by two paths, read by two
routes, and both routes are unreachable from the live UI.

---

## Verdict — bug or by design?

**Population (2) is a bug, not a design category — and it is the same bug as population (1), one
level up.** Confidence, stated separately because the two halves are not equally certain:

- **The code fact: certain.** Every write site is accounted for. `handleManualSapConfirm` and the
  whole `lib/import-upsert/*` brain contain no enriched write, on create or on patch. A
  manual-SAP-created bill *cannot* have enriched rows, and nothing backfills. There is no branch
  anywhere on order type, SMU, item category or tint that would make "never enriched" deliberate.
- **That this explains the live 2,666 bills: high but unverified.** The mechanism is proven and the
  June-vs-July shape matches the 2026-06-20 auto-import resumption almost too neatly, but I have not
  run the query. If it fails, the partial-pass branch in Q3 says where to look next.
- **The severity: low today, and that is load-bearing.** Nothing an operator touches reads this
  table. Calling it a data-integrity bug is right; calling it an outage is not.

The honest summary is that a table documented as 1:1 with raw lines has silently been ~1:1-minus-
manual-SAP since the manual-SAP path went live on 2026-05-14, and it went unnoticed because its only
consumer had already been superseded.

---

## Fix options — implement none

**Option A — document the hole, write nothing.** Add it to `CLAUDE_IMPORT.md §14` landmines
("`import_enriched_line_items` is NOT 1:1 — the manual-SAP path never writes it; a query driven off
this table silently drops every manual-SAP-created bill") and drop a comment at
`app/api/orders/[id]/detail/route.ts:107`.
*Risk:* the trap survives. The next author who adds a reader — a report, a new detail panel, a
billing export — gets a confidently empty result for a large slice of bills and no error. Cheapest,
and it protects nothing but the reader's attention.

**Option B — close the hole: write enriched rows from the upsert brain, then backfill.** Add the
enriched write to both `createPath` (`lib/import-upsert.ts:240`) and `applyLinePatch`
(`lib/import-upsert/lines.ts:187`), fed by a `sku_master_v2` recognition set preloaded through the
existing `options.preloaded` hook so the batch stays at one catalog query.
*Risk:* `createMany` does not return ids, so both sites need a follow-up `findMany` on the just-
inserted raw lines to get `rawLineItemId` — an extra query per OBD on the hottest import path, and
`prisma.$transaction` is forbidden (CORE §3), so a crash between the two writes leaves exactly the
gap this fix is closing. It also needs a one-time backfill of the ~2,666 orphan bills, which is a
data write → Smart Flow in the SQL Editor, joining `sku_master_v2` by `material` to reproduce
`lineWeight`/`note`. Most work, and it re-invests in a table nothing currently reads.

**Option C — retire the table instead: repoint the one real reader.** Rewrite
`app/api/orders/[id]/detail/route.ts` to drive `lineItems` off `import_raw_line_items` (which
already carries `unitQty`, `volumeLine`, `isTinting`) and derive the recognition flag from the
`sku_master_v2` lookup the route **already performs** at line 146; drop the `lineWeight` join from
`removed-lines`. Then the 1:1 table has zero readers and the gap stops mattering, which folds
cleanly into the already-planned "retire old `sku_master` + rename v2" session that owns the
`skuId` column and its relation.
*Risk:* it is a retirement decision, not a cleanup, so it needs an owner. Both affected routes are
currently unreachable from the live UI, so the change cannot be smoke-tested through a screen —
only by calling the routes directly. And it forecloses on `import_enriched_line_items` as a future
enrichment surface; if anyone still wants that table to mean something, B is the option, not C.

*Recommendation if one is wanted: A now (it is five minutes and stops the next author walking into
it), and C when the `sku_master` retirement session comes round. B only if someone names a consumer
that needs a real enriched row.*
