# Web update — SAP import architecture (2026-05-01)

Target file: `docs/prompts/drafts/web-update-2026-05-01-sap-import-architecture.md`

Companion to: any prior in-flight `code-update-*` files from this work; this is the comprehensive web-side state.

---

## Section 1 — Schema state (v26.5)

`split_line_items` and `import_raw_line_items` carry a soft-remove triplet so the brain can patch line sets without destroying history.

`split_line_items` columns added:
- `lineStatus` text default `'active'`
- `removedAt` timestamptz nullable
- `removedReason` text nullable
- `lastSeenInBatchId` int nullable

`import_raw_line_items` columns added:
- `lineStatus` text default `'active'`
- `removedAt` timestamptz nullable
- `removedReason` text nullable

Sparse partial index on each table for non-active rows: `WHERE "lineStatus" <> 'active'`.

New table `import_shadow_log` (id, batchId, obdNumber, source, actualOutcome, shadowOutcome, decision JSONB, errors, createdAt) plus four indexes. Used by Steps 4A/5 to compare what auto-import / manual-template would have done versus what upsertObd would have done. Read-only diagnostic.

Schema changes were applied via Supabase SQL Editor only. No Prisma `db push`. `npx prisma generate` after.

---

## Section 2 — Library: `lib/sap-parser/`

Pure synchronous parser turning a SAP OBT export XLSX buffer into `ObdInput[]` for upsertObd consumption. No DB calls, no HTTP, no Date.now() — operator-picked obdEmailDate flows in via `options.fallbackObdEmailDate`.

Files (7 total, ~750 LOC, largest 235 LOC):
- `index.ts` — `parseSapFile(buffer, options)` entry point
- `types.ts` — `ParseOptions`, `ParseResult`, `RawSapRow`, `Warning`, `SkippedRow`, error classes
- `cells.ts` — private type-coercion helpers (`toStr`, `toNum`, `toInt`, `toStrOrNull`)
- `read-sheet.ts` — XLSX → flat `RawSapRow[]` via position-based column lookup with header validation
- `group-rows.ts` — buckets by Delivery + applies non-LF return skip rule
- `apply-rules.ts` — category routing + drop-zero, sum-by-SKU qty rule
- `build-obd.ts` — grouped buckets → `ObdInput[]` with sum-or-null aggregation

Skip rules:
- Length<10 + Delivery Type ≠ LF → skip whole delivery (returns)
- All-ZZRE delivery → skip whole delivery
- ZZRE lines mixed with others → drop only the ZZRE lines, warn

Category routing (Item Category column):
- TAN / ZKL3 / ZINR → normal line
- Z007 → `isTinting: true`
- ZZRE → drop the line

Qty rule (simplified after iteration):
- Filter out rows where Delivery quantity = 0 or null
- Group remaining rows by Material code
- Emit one line per group: lineId = lowest item number in group; unitQty/volumeLine/grossWeight = sum across group
- Future enhancement: when SAP exports include per-row Batch numbers, switch to `(Material, Batch)` grouping. Code comment in `apply-rules.ts` flags this. Smart Flow's call: don't sum across batches once Batch column appears.

Division → SMU map (deterministic on real data):
- `70` → "Deco Retail"
- `74` → "Decorative Projects"
- `76` → "Distributor"
- `77` → "Retail Offtake"

Warnings emitted as-is (don't block import):
- `unknown-item-category` — category not in TAN/ZKL3/ZINR/Z007/ZZRE
- `zinr-article-tag-pending` — ZINR row needs articleTag rule (deferred)
- `duplicate-sku-summed` — same SKU appeared in multiple rows of one delivery, summed together
- `non-LF-return` — informational on the skipped delivery

File-level errors throw `FileParseError` / `FileFormatError` (corrupt buffer, missing required header columns).

Stats invariant: `createdObds + skippedDeliveries === uniqueDeliveries`. Emits `stats-mismatch` warning if violated; doesn't throw.

Smoke-test result against `EXPORT_29_04_2026.XLSX` (941 rows):
- 159 unique deliveries
- 157 created OBDs
- 2 returns skipped (`96182959`, `96202905`)
- 11 OBDs with at least one isTinting line
- 137 deliveries had multi-row picks (sub-rows present)
- 18 duplicate-sku-summed warnings (split-pick batches)
- Total qty across all 157 OBDs: 4474 units

---

## Section 3 — Library: `lib/import-upsert/`

The shared "brain" all three import paths flow through. Single source of truth for OBD dedup, header patching, line patching, audit logging, and downstream effect emission.

Files (8 total, ~1226 LOC):
- `index.ts` — `upsertObd(input, source, batchId, batchRef, userId, now, opts)` entry point
- `types.ts` — `ObdInput`, `ExistingOrder`, `ExistingLine`, `UpsertResult`, `DownstreamEffect` etc.
- `header.ts` — header create-or-patch with field-level authority rules
- `lines.ts` — line patch logic with per-source authority
- `effects.ts` — emits effects array (no firing — effects fire in handler)
- `state.ts` — orchestrates lifecycle for one OBD
- `helpers.ts` — small utilities
- `audit.ts` — formats `[change_type] detail via {source} batch {batchRef}` audit notes for `order_status_logs`

Key behavioural rules:

Header policy:
- **Lockable** (never overwritten once set): `obdNumber`, `customerId`, `shipToCustomerId`, `smu`
- **Patchable null→value** (filled when null, never overwritten): `invoiceNo`, `soNumber`, `materialType`, `natureOfTransaction`, `warehouse`, `obdEmailTime`, `invoiceDate`, etc.
- **Special override** (auto-import only): `obdEmailDate` can be overwritten by auto-import from any prior source — auto-import is authoritative for delivery date

Line policy by source (`LINE_AUTHORITY`):
- **manual-sap** — overwrites existing qty/volume even if non-null; can soft-remove lines no longer present in incoming set; can restore previously soft-removed lines that come back
- **auto-import** / **manual-template** — only fill nulls, never overwrite; cannot soft-remove
- Soft-remove only fires when authoritative source has at least one incoming line (defensive — empty incoming doesn't wipe the order)

Line matching (FIXED in this work):
- Match by `skuCodeRaw` (trimmed, case-sensitive). NOT by `lineId`.
- Reason: auto-import historically wrote `lineId=0`. SAP brings real SAP item numbers (10, 20, 900001). Old lineId-based matching saw all SAP lines as new and soft-removed all auto-import lines on every SAP run, producing ghost-row pollution.
- Per-source duplicate-SKU guard: if either incoming or existing has the same SKU twice, prefer the first occurrence and log a warning. Parser already sums duplicates so incoming should be clean; defensive against legacy bad-import data on the existing side.

Audit format on `order_status_logs.note`:
- `[obd_created] OBD {obd} created with {n} line(s) via {source} batch {batchRef}`
- `[header_patched] {field} {old} → {new} via {source} batch {batchRef}`
- `[header_overwritten] {field} {old} → {new} via {source} batch {batchRef}`
- `[line_added] lineId {id} (sku {sku}, qty {n}) via {source} batch {batchRef}`
- `[line_patched] lineId {id} {field} {old} → {new} via {source} batch {batchRef}`
- `[line_removed] lineId {id} (sku {sku}) via {source} batch {batchRef}`
- `[line_restored] lineId {id} (sku {sku}) via {source} batch {batchRef}`

Legacy auto-import notes (`"Created via auto-import batch ..."` without prefix) get `changeType: "other"` in the audit panel — neutral gray badge, no error.

Effects array shapes:
- `mail-order-enrichment` — payload: `{ soNumber }` → handler calls `applyMailOrderEnrichment([soNumber])`
- `challan-create` — handler calls `createChallanForOrder(orderId, ...)`
- `query-summary-rebuild` — handler calls `rebuildQuerySummaryForOrder(orderId, ...)` — uses `upsert` (not `createMany`) since the row may already exist
- `customer-resolved` — log only, no remediation
- `order-type-mismatch` — log only, no remediation
- `slot-recalc` — currently NOT emitted by `buildEffects()` (patchHeader handles slot inline). Switch case exists in handlers as TODO no-op for future Step 12.

`dryRun: true` mode runs the whole brain without any DB writes — used by Step 4A/5 shadow paths.

---

## Section 4 — Auto-import shadow integration

`/api/import/obd?action=auto-import` (PowerShell-driven HMAC endpoint) now runs upsertObd in shadow mode alongside the existing skip-duplicate logic, comparing outcomes and writing to `import_shadow_log`. Gated by `IMPORT_SHADOW_MODE !== "true"` (env var unset → shadow doesn't run, no overhead). When `IMPORT_SHADOW_MODE=true` is set in Vercel, every auto-import cycle writes a shadow comparison row.

Shadow integration files: handler additions in `app/api/import/obd/route.ts` (`runAutoImportShadow` + `headerRowToObdInput`).

**Status**: shadow code present but `IMPORT_SHADOW_MODE` env var is unset in Vercel. Flip after depot resumes; watch shadow logs clean for 24h before Step 4B cutover.

---

## Section 5 — Manual-template shadow integration

`handlePreview` (manual-template path at `?action=preview`) also runs upsertObd in shadow mode. Same gating: `IMPORT_SHADOW_MODE` env var.

---

## Section 6 — Manual-SAP API endpoints (Step 7 + Step 7-fix)

Two new actions on `/api/import/obd`:
- `?action=manual-sap-preview` — multipart upload (file + obdEmailDate); parses, classifies each OBD as new/patch/skipped/error against orders table; returns preview JSON; NO live writes
- `?action=manual-sap-confirm` — multipart re-upload of same file; runs upsertObd per OBD; writes audit; fires downstream effects; returns summary

Auth: same gate as existing manual flow — `requireRole([ADMIN, DISPATCHER, SUPPORT])` plus `checkPermission(role, "import_obd", "canImport")` for non-admins.

Behind feature flag `SAP_IMPORT_ENABLED`. Default unset = OFF = 503 returned. Currently set to `"true"` in Vercel Production.

File constraints: max 10MB, .xlsx only, validated client + server.

Re-parse strategy at confirm (no staging tables). Two parses per import cycle, but avoids cleanup if user abandons mid-flow and avoids race if multiple operators upload same file.

`import_batches` row format:
- `batchRef` — `BATCH-YYYYMMDD-NNN`
- `headerFile` — `[manual-sap] {filename} (obdEmailDate: {YYYY-MM-DD})`
- `lineFile` — empty string
- `totalObds` — parser-emitted + parser-skipped
- `skippedObds` — parser-skipped only (NOT counting upsert "unchanged")
- `failedObds` — upsert errored count

Challan number reservation:
- Counted eligible OBDs (those with `challan-create` effect) at start of confirm flow
- Single `findFirst` lookup of current max challan number
- Sequential counter passed via closure to per-OBD `createChallanForOrder` calls
- Eliminates intra-batch races
- `createChallanForOrder` retains single P2002 retry as inter-batch safety net

Effects firing — sequential per-OBD, try/catch wrapped, never crashes batch. Errors logged, batch continues.

---

## Section 7 — Manual-SAP UI (Step 8)

New "SAP File — Direct OBT Export" template option in Manual Import page (`/admin/import` and `/import`).

Files:
- `lib/dates.ts` (new) — server-safe `getTodayIST()` extracted from `lib/day-boundary.ts` to avoid Prisma transitive dep in client components
- `lib/day-boundary.ts` — re-imports from `lib/dates.ts`
- `lib/import-templates.ts` — adds `manual-sap` entry, extends `ImportTemplate` interface with `singleSap` and `requiresObdEmailDate`
- `lib/import-types.ts` — adds `SapPreviewObd`, `SapPreviewWarning`, `SapPreviewResponse`, `SapConfirmResponse`
- `components/import/sap-preview.tsx` (new, 269 LOC) — SAP-specific preview rendering with banner, stats, fixed table, warnings panel, inline confirmation banner
- `components/import/import-page-content.tsx` — SAP state slots, upload-stage SAP zone + date picker, preview/result branching, two new handlers, FileZone `accept` prop, Import Now toggle hidden when SAP selected
- `FileZone` — gained optional `accept` prop (default `.xlsx,.xls`); SAP zone passes `.xlsx`. Existing usages untouched.

Operator workflow:
1. Pick "SAP File" template from dropdown
2. Single XLSX file picker + OBD Date picker (defaults to today IST)
3. Click Preview → parser runs server-side, renders per-OBD table with NEW/PATCH/SKIPPED/ERROR badges, warnings panel
4. Click "Confirm Import (N OBDs)" → inline confirmation banner appears (no native dialog, no shadcn modal added)
5. Click "Yes, Confirm" → POST to confirm endpoint
6. Result screen: Created / Patched / Unchanged / Errored tile grid, batch ref displayed

Whole-file confirm (no per-OBD selection) — operator either imports the whole file or cancels. By design — re-parse strategy doesn't support selective IDs.

Import Now (skip-preview) toggle hidden when SAP selected — forces preview-then-confirm flow always.

Result counters interpretation:
- **Created** — new OBDs that didn't exist
- **Patched** — existing OBDs with changes applied
- **Unchanged** — existing OBDs where SAP and DB already match (no writes)
- **Errored** — per-OBD upsert failures (batch continues despite these)

`import_batches.skippedObds` counts parser-skipped only (the 2 ZLR returns) — NOT upsert "unchanged".

---

## Section 8 — Audit history panel (Step 10)

Files:
- `app/api/orders/[id]/audit-history/route.ts` (new, 75 LOC) — GET endpoint, returns recent 100 `order_status_logs` entries with actor name JOINed from `users`. Auth: `[SUPPORT, DISPATCHER, ADMIN, OPERATIONS, TINT_MANAGER]`. Returns `totalCount` when >100.
- `components/shared/order-audit-history.tsx` (new, 232 LOC) — client component, props `{orderId, isOpen}`. Lazy-fetches on isOpen flip. Renders compact rows with timestamp + actor + summary + change-type badge. Click row → expand full note. Refresh icon. Loading/empty/error states. IST timestamps.
- `components/shared/order-detail-panel.tsx` — replaces "Coming soon" placeholder with collapsible History toggle. `expandHistory` state resets on orderId change.

Change-type badge palette:
- `obd_created` → green-50 / green-700
- `header_patched` → blue-50 / blue-700
- `header_overwritten` → amber-50 / amber-700
- `line_added` → green-50 / green-700
- `line_patched` → blue-50 / blue-700
- `line_removed` → red-50 / red-700
- `line_restored` → teal-50 / teal-700
- any other (incl. legacy unprefixed notes) → gray-50 / gray-500

Timestamp format (IST):
- Today → `HH:mm`
- Yesterday → `Yesterday HH:mm`
- Older → `DD MMM HH:mm`

Section collapsed by default — operator clicks toggle to fetch + show. State persists per panel-open; resets on order change. `changedBy === null` falls back to `"System"`. No id=1 special-case.

---

## Section 9 — Soft-removed line UI + Step 3 gap closure (Step 11)

Files:
- `app/api/orders/[id]/detail/route.ts` (+11/-2) — A.1 patch: adds `lineStatus: 'active'` to the enriched-line-items relation traversal `where: { rawLineItem: { obdNumber: order.obdNumber, lineStatus: 'active' } }`. This closes a Step 3 filter gap — the existing query bypassed the active filter because it traversed the relation indirectly. Also adds `removedLineCount` to detail response.
- `app/api/orders/[id]/removed-lines/route.ts` (new, 86 LOC) — GET endpoint returning soft-removed lines for an OBD. Auth mirrors detail endpoint exactly. Reads `import_raw_line_items` directly (where `lineStatus !== 'active'`), JOINs `import_enriched_line_items` for SKU code/description.
- `components/shared/order-detail-panel.tsx` (+125/-3) — adds `RemovedLine` interface, `removedLineCount` field on `OrderDetail` type, `expandRemoved` state + lazy-fetch, toggle UI, greyed line rendering.

Removed-line styling:
- Background: `bg-gray-50/50`
- All text: `text-gray-400`, all columns line-through (SKU mono, description, qty/vol tabular-nums)
- Trailing `[removed]` badge: `bg-gray-100 border-gray-200 text-gray-500`
- Native browser tooltip on row hover with `removedReason`
- Mini italic line below row: `Removed DD MMM HH:mm — {reason}` (`text-[10px] text-gray-400 italic`)

Toggle hidden when `removedLineCount === 0`. Cached per panel-open lifetime so re-toggling doesn't re-fetch. Resets on order change.

Operational paths unchanged — Step 3 filters still in place on TM Kanban, Dispatch Board, Picker, Challan render. The Step 11 affordance only changes what's visible in the order detail panel.

---

## Section 10 — `generateBatchRef` + `createBatchWithRetry`

`generateBatchRef()` in `app/api/import/obd/route.ts` was changed from `count() + 1` to `MAX(batchRef WHERE startsWith prefix) + 1`:

```typescript
const latest = await prisma.import_batches.findFirst({
  where:   { batchRef: { startsWith: `BATCH-${dateStr}-` } },
  orderBy: { batchRef: "desc" },
  select:  { batchRef: true },
});
let nextSeq = 1;
if (latest) {
  const tail = latest.batchRef.slice(prefix.length);
  const parsed = parseInt(tail, 10);
  if (!Number.isNaN(parsed)) nextSeq = parsed + 1;
}
```

Reason: the old `count()`-based approach collided when prior creates left gaps (rolled-back attempts, interleaved races between auto-import and manual flows). Production manual-SAP confirm hit P2002 unique violation on first prod run because auto-import had used today's sequence numbers.

`createBatchWithRetry` wraps `prisma.import_batches.create` with up-to-3 retries on `Prisma.PrismaClientKnownRequestError` code `P2002`. Each retry regenerates the batchRef. Used at all three call sites:
- `handlePreview` (manual-template)
- `handleManualSapConfirm` (manual-SAP)
- `handleAutoImport` (auto-import)

`prisma.import_batches.create` now appears only inside this helper.

Side effect: `import { Prisma }` instead of `import type { Prisma }` so `instanceof PrismaClientKnownRequestError` works at runtime. Scalar `importedById: userId` switched to relational `importedBy: { connect: { id: userId } }` to satisfy strict `Prisma.import_batchesCreateInput` type. Underlying DB write identical.

---

## Section 11 — Pending / on-the-horizon

Steps still to execute (depot dependency):

- **Step 4B — Auto-import cutover.** Replace skip-duplicate logic with `upsertObd(input, "auto-import", ...)`. First flip `IMPORT_SHADOW_MODE=true` for 24-48h, watch shadow logs clean, then cutover. Auto-import to also write `[obd_created]` audit prefix as part of this step.
- **Step 5B — Manual-template cutover.** Mirrors Step 4B for the manual-template path.
- **Step 12 — Patch triggers cascade.** When manual-SAP soft-removes a line, downstream tables (`pick_list_items`, `tinter_issue_entries`, `tinter_issue_entries_b`) need a corresponding cascade. Currently they hold their own copies and would orphan. Need cascade logic in `effects.ts`.
- **Step 13 — Recompute query summary on patch.** Already partially implemented as the `query-summary-rebuild` effect using `upsert`. Verify it correctly recomputes `totalLines`, `totalUnitQty`, `totalWeight`, `totalVolume`, `hasTinting`, `totalArticle`, `articleTag` from active lines.
- **Step 14 — End-to-end test plan.** Document the operator-flow test cases for the new SAP path.
- **Step 15 — Production deployment + monitoring.** Set up regular monitoring queries (phantom row count, shadow log diffs).

Optional polish skipped for now:
- **Step 9** — Empty SAP template download. Operators can copy a real SAP file structure if needed; "download blank template" button is a nicety, not a blocker.

Future enhancements:
- SAP file Batch column support: when SAP exports per-row Batch numbers, switch parser's `group by Material` to `group by (Material, Batch)`. Smart Flow's call. Comment in `apply-rules.ts` flags this.
- "View full history" link from a removed line directly to its `line_removed` audit entry — connects Steps 10 and 11.
- Auto-import to write `[obd_created]` prefix on `order_status_logs.note` for consistency with new format.
- Restore-line UI for admins (currently can only be undone via SQL or a fresh SAP import bringing the SKU back).

---

## Section 12 — Critical operational notes

Environment variables in Vercel:
- `SAP_IMPORT_ENABLED=true` — Production. Live and tested.
- `IMPORT_SHADOW_MODE` — UNSET. Don't flip until depot resumes. Shadow code is dormant, ready to activate.

Operator workflow for SAP imports:
1. Admin / billing operator opens `https://www.orbitoms.in/admin/import`
2. Picks "SAP File — Direct OBT Export" template
3. Uploads XLSX, picks OBD Date (defaults today IST — set to actual file date if importing yesterday's data)
4. Clicks Preview → reviews per-OBD outcomes table
5. Clicks Confirm → "Yes, Confirm" on inline banner
6. Result screen shows counts; batch ref recorded in `import_batches` with `[manual-sap]` prefix

Production monitoring queries:

```sql
-- Recent SAP imports
SELECT id, "batchRef", "headerFile", "totalObds", "skippedObds", "failedObds", status, "createdAt"
FROM import_batches
WHERE "headerFile" LIKE '[manual-sap]%'
ORDER BY id DESC LIMIT 10;

-- Phantom row health check (must stay 0)
SELECT COUNT(*) AS phantom_rows
FROM import_raw_line_items rli1
WHERE rli1."lineStatus" = 'removed_by_import'
  AND EXISTS (
    SELECT 1 FROM import_raw_line_items rli2
    WHERE rli2."obdNumber" = rli1."obdNumber"
      AND rli2."skuCodeRaw" = rli1."skuCodeRaw"
      AND rli2."lineStatus" = 'active'
  );

-- Audit log breakdown for a specific batch
SELECT
  CASE
    WHEN note LIKE '%line_added%'        THEN 'line_added'
    WHEN note LIKE '%line_patched%'      THEN 'line_patched'
    WHEN note LIKE '%line_removed%'      THEN 'line_removed'
    WHEN note LIKE '%line_restored%'     THEN 'line_restored'
    WHEN note LIKE '%header_patched%'    THEN 'header_patched'
    WHEN note LIKE '%header_overwritten%' THEN 'header_overwritten'
    WHEN note LIKE '%obd_created%'       THEN 'obd_created'
    ELSE 'other'
  END AS change_kind,
  COUNT(*) AS count
FROM order_status_logs
WHERE note LIKE '%BATCH-XXXXXXXX-NNN%'
GROUP BY change_kind
ORDER BY count DESC;
```

Phantom-row cleanup SQL (only needed if a buggy run reintroduces them):

```sql
-- Step 1: enriched rows first (FK constraint)
DELETE FROM import_enriched_line_items
WHERE "rawLineItemId" IN (
  SELECT rli1.id FROM import_raw_line_items rli1
  WHERE rli1."lineStatus" = 'removed_by_import'
    AND EXISTS (
      SELECT 1 FROM import_raw_line_items rli2
      WHERE rli2."obdNumber" = rli1."obdNumber"
        AND rli2."skuCodeRaw" = rli1."skuCodeRaw"
        AND rli2."lineStatus" = 'active'
    )
);

-- Step 2: raw rows
DELETE FROM import_raw_line_items rli1
WHERE rli1."lineStatus" = 'removed_by_import'
  AND EXISTS (
    SELECT 1 FROM import_raw_line_items rli2
    WHERE rli2."obdNumber" = rli1."obdNumber"
      AND rli2."skuCodeRaw" = rli1."skuCodeRaw"
      AND rli2."lineStatus" = 'active'
  );
```

Test fixture location: `test/fixtures/EXPORT_29_04_2026.XLSX` (gitignored — `test/fixtures/*.xlsx` and `*.XLSX` patterns added to `.gitignore`).

Production verification at end of work:
- `BATCH-20260501-005` (`EXPORT_29_04_2026.XLSX`, today's date) on prod: 159 totalObds, 0 created, 0 patched, 157 unchanged, 0 errored, completed in <15 sec, 0 phantom rows
- All three import paths now flow through `createBatchWithRetry` (no more P2002 risk)
- Audit history panel and soft-removed-line UI both live in every order detail panel

Bug history (today, all caught and fixed pre-cutover):
- **Line matching by lineId** — auto-import wrote lineId=0, SAP brings real item numbers; old matching saw all lines as new. Fixed: match by skuCodeRaw. Local-only impact; phantoms cleaned via SQL.
- **batchRef collision** — `count()+1` collided with auto-import's same-day batches. Fixed: max+1 + retry helper. Surfaced on first prod run; no data loss.
- **Step 3 enriched-traversal gap** — detail endpoint's enriched-side query bypassed the lineStatus filter. Closed in Step 11.
