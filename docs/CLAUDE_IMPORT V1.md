# CLAUDE_IMPORT.md — OrbitOMS Import Pipeline
# v1 · Schema v27.2 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Covers the SAP/OBD import pipeline end-to-end: manual SAP upload, Auto-Import (currently paused), the shared upsert utility that both paths funnel through, schema, filters, and downstream consumers.

Primary users: admin, dispatcher, support, billing_operator, tint_manager (all gated on `import_obd` / `canImport` per role).

---

## 1. What this module is

OrbitOMS receives Outbound Deliveries (OBDs) from SAP via two import paths:

- **Manual SAP** — operator uploads a SAP OBT export `.xlsx` via the universal import modal or the admin `/import` page. This is the active production path as of 2026-05-14. Live at https://orbitoms.in. Preview-then-confirm with optional bypass for fast batches.
- **Auto-Import** — scheduled background pull on the depot PC, paused as of 2026-05-14. When active, runs every 10 minutes (8AM–8PM IST), fetches SAP files via LAN, HMAC-signs a multipart payload, and POSTs to a dedicated endpoint. Reference script at `docs/sample/Auto-Import.ps1` (production copy lives outside the repo per CORE §4).

Both paths converge at `upsertObd()` (`lib/import-upsert.ts`) — the shared brain that owns create-vs-patch decisions, line-level diff, soft-remove cascades, audit logging, and downstream-effect signalling.

Scale: ~100–200 OBDs/day per CORE §1. Single-depot deployment.

Downstream consumers of the import output: `orders` rollup, `import_obd_query_summary` cache, `applyMailOrderEnrichment()` hook (CLAUDE_MAIL_ORDERS.md §7), challan auto-creation (CLAUDE_TINT.md §5), Support board, Tint Manager Kanban, dispatch planning, warehouse picking.

---

## 2. Pipeline overview

```
Manual SAP path:
  Operator → /admin/import upload
    → POST /api/import/obd?action=manual-sap-preview (10MB cap, .xlsx)
    → parseSapFile(buffer, { fallbackObdEmailDate })
        → readSheet → groupRows → applyRules → buildObds
    → preview UI: per-OBD outcome (new / patch / skipped / error) + issues
  Operator → click Confirm Import
    → POST /api/import/obd?action=manual-sap-confirm
    → re-parse file → for each ObdInput: upsertObd(...)
        → createPath OR patchPath
    → caller dispatches DownstreamEffect[] returned by upsertObd:
        applyMailOrderEnrichment  (matches mo_orders.soNumber)
        createChallanForOrder     (Retail Offtake / Decorative Projects only)
        rebuildQuerySummaryForOrder
        + customer-resolved / order-type-mismatch signals

Auto-Import path (paused):
  Scheduler (10 min) → Auto-Import.ps1
    → fetch SAP files via LAN, merge LogisticsTracker + per-OBD details
    → HMAC-sign with auto-import-v1 literal
    → POST /api/import/obd?action=auto (multipart, x-import-key-id header)
    → middleware bypasses session (HMAC verified by route handler)
    → handleAutoImport: bucket by obdNumber → AutoLineInterim
    → bulk createMany (CREATE-only: skips existing OBDs entirely)
    → applyMailOrderEnrichment
```

Manual SAP exercises both create and patch paths. Auto-Import is create-only (route.ts:2376 explicitly `continue`s on already-existing OBDs) and therefore never reaches `patchLines`.

---

## 3. File layouts

### 3.1 Manual SAP — new 19-column layout

The current SAP OBT export. One worksheet (`Sheet1` typical). Header row 1, data row 2 onward. Parser uses position-based access — does NOT match by header text. Column map locked:

| Col | Header | Field | Table | Notes |
|-----|--------|-------|-------|-------|
| 1 | Delivery | `obdNumber` | summary + lines | OBD number, 10-digit typical |
| 2 | Shipping Point/Receiving Pt | `warehouse` | summary | e.g. `IN53` |
| 3 | Storage Location | (ignored) | — | Read into `RawSapRow` but not propagated downstream |
| 4 | Division | `smu` (via lookup) | summary | DIVISION_TO_SMU: 70=Deco Retail, 74=Decorative Projects, 76=Distributor, 77=Retail Offtake |
| 5 | Sold-To Party | `billToCustomerId` | summary | String |
| 6 | Name of sold-to party | `billToCustomerName` | summary | |
| 7 | Ship-To Party | `shipToCustomerId` | summary + orders | String |
| 8 | Name of the ship-to party | `shipToCustomerName` | summary + orders | |
| 9 | Reference Document | `soNumber` | summary + orders | String (not int). SAP sales order number |
| 10 | Delivery Type | (filter only) | — | Keep `LF` rows; drop everything else |
| 11 | Item category | `isTinting` derivation | lines | `isTinting = (itemCategory === "Z007")`. ZZRE handled separately |
| 12 | Item | `lineId` | lines | Int. `10`/`20` for line items; `900001+` for picked sub-rows |
| 13 | Material | `skuCodeRaw` | lines | String, case-sensitive (no `.toLowerCase()`) |
| 14 | Description | `skuDescriptionRaw` | lines | |
| 15 | Delivery quantity | `unitQty` | lines | Int |
| 16 | Volume | `volumeLine` | lines | Float, also summed to summary.volume |
| 17 | Net weight | `netWeight` | lines | Float |
| 18 | Total Weight | `totalWeight` | lines | Float, auto-summed to summary.grossWeight |
| 19 | Batch | `batchCode` | lines | String, empty → null |

REQUIRED_COLS (read-sheet.ts:54-58): `[delivery, warehouse, division, soldToParty, shipToParty, referenceDoc, deliveryType, itemCategory, item, material, deliveryQty]`. Optional positions (`volume`, `netWeight`, `totalWeight`, `batch`, the name fields, `storageLocation`) may legitimately be blank on individual rows.

### 3.2 Auto-Import — LogisticsTracker + per-OBD merge

Auto-Import.ps1 builds a combined `.xlsx` with two named sheets and POSTs it as a single file:

- Sheet `LogisticsTrackerWareHouse` — header per OBD. Column names read by `handleAutoImport` (route.ts:2266, 2447-2456):
  - `OBD Number` → `obdNumber`
  - `SMU Code` / `SMU` → `smuCode` / `smu`
  - `Status` → `sapStatus`
  - `MaterialType`, `NatureOfTransaction`, `Warehouse`
  - `OBD Email Date`, `OBD Email Time` → `obdEmailDate` / `obdEmailTime`
  - `UnitQty`, `GrossWeight`, `Volume`
  - `Bill To Customer Id`, `Bill To Customer Name`
  - `ShipToCustomerId`, `Ship To Customer Name`
  - `InvoiceNo`, `InvoiceDate`
  - `SONum` → `soNumber`

- Sheet `LineItems` — one row per surviving SAP line. Columns:
  - `obd_number`, `line_id`, `sku_codes`, `sku_description`
  - `unit_qty`, `volume_line`
  - `batch_code` (read into `batchCode`; currently always null because Auto-Import.ps1's `$rawRows` shape at lines 745-752 doesn't populate it)
  - `Tinting` (boolean), `article`, `article_tag`

Auto-Import.ps1 preserves 1:1 row passthrough by design — lines 761-776 explicitly note "Same-SKU duplicate rows on one OBD must NOT be merged. Article + Tinting are calculated per line."

### 3.3 Old SAP layout — deprecated

The pre-2026-05-14 SAP export had ~25 columns with different positions (notably `itemCategory` at col 24 and `deliveryType` at col 25, and no `Batch` column at all). The parser was rewritten on 2026-05-14 against the new 19-column layout. **Do not support the old layout.** If a user uploads the old format the parser throws `FileFormatError: Header row is missing required column position(s): …` — SAP must re-export.

---

## 4. Schema (import tables)

Schema v27.2. All columns camelCase, no `@map` (CORE §3).

### `import_batches`

One row per import run.

```
id           Int @id @default(autoincrement())
batchRef     String @unique          // human label, e.g. "[manual-sap] file.xlsx (obdEmailDate: 2026-05-14)"
importedById Int  → users.id
headerFile   String                  // descriptive label for the source file
lineFile     String                  // "" for SAP single-file imports
totalObds    Int @default(0)
skippedObds  Int @default(0)
failedObds   Int @default(0)
status       String @default("processing")   // "processing" | "complete" | "failed"
createdAt    DateTime @default(now())
updatedAt    DateTime @updatedAt
```

### `import_raw_summary`

One row per OBD per import. Patches accumulate on the original creating row (state.ts:35-39 picks earliest summary via `orderBy: { id: "asc" }`); never creates a new summary row per re-import.

```
id, batchId, obdNumber
sapStatus, smu, smuCode, materialType, natureOfTransaction, warehouse
obdEmailDate (DateTime?), obdEmailTime (String? "HH:mm")
totalUnitQty, grossWeight, volume
billToCustomerId, billToCustomerName
shipToCustomerId, shipToCustomerName
invoiceNo, soNumber, invoiceDate, smuNumber
rowStatus String @default("valid"), rowError
createdAt
```

No compound unique constraints. `obdNumber` is NOT unique here (duplicate rows can exist in theory; in practice the upsert logic guarantees one summary per OBD).

### `import_raw_line_items`

One row per surviving SAP line per OBD. **Duplicates by `(obdNumber, skuCodeRaw)` are permitted** — the schema has no unique constraint blocking them, and the composite-key patch logic in `lib/import-upsert/lines.ts` preserves them across re-imports.

```
id, rawSummaryId, obdNumber, lineId
skuCodeRaw, skuDescriptionRaw, batchCode
unitQty, volumeLine
netWeight, totalWeight        // added 2026-05-14
isTinting, article, articleTag
rowStatus, rowError
lineStatus String @default("active")    // "active" | "removed_by_import"
removedAt, removedReason
createdAt
```

Relations: `enrichedLineItem` (1:1 unique), `splitLineItems` (1:N), `challanFormulas` (1:N), `tinterIssueEntries(_b)` (1:N).

### `import_enriched_line_items`

Enrichment pass writes one row per raw line. `rawLineItemId` is `@unique` — guarantees 1:1 with the raw row. Duplicate-SKU raw rows each get their own enriched row.

```
id, rawLineItemId (UNIQUE FK), skuId (FK sku_master, nullable)
unitQty, volumeLine, lineWeight, isTinting
note, createdAt
```

### `import_obd_query_summary`

Cached per-OBD aggregate. `obdNumber` UNIQUE, `orderId` UNIQUE. Rebuilt by `rebuildQuerySummaryForOrder()` whenever the upsert plan reports line-level changes or header totals changes (see `effects.ts` → `query-summary-rebuild`).

```
obdNumber UNIQUE, orderId UNIQUE
totalLines, totalUnitQty, totalWeight, totalVolume
hasTinting, totalArticle, articleTag
createdAt
```

### `import_shadow_log`

INSERT-ONLY analysis log for shadow-mode cutover phases. Not actively written today; the model is retained for future cutovers when behaviour changes need to be A/B compared before commit.

```
batchId, obdNumber, source
actualOutcome, shadowOutcome, decision (JSON)
errors, createdAt
indexed on (batchId), (obdNumber), (createdAt)
```

---

## 5. Parser package — `lib/sap-parser/`

Pure synchronous module. No DB access, no HTTP, no `Date.now()` side effects. The whole pipeline is deterministic given the same buffer + `fallbackObdEmailDate`.

Files:

- `index.ts` — entry point. `parseSapFile(buffer, options) → ParseResult`. Orchestrates `readSheet → groupRows → applyRules → buildObds`. Computes a file-level invariant `createdObds + skippedDeliveries === uniqueDeliveries`; on failure emits `stats-mismatch` warning instead of throwing.
- `read-sheet.ts` — opens the workbook via the `xlsx` package, validates header width, converts data rows to `RawSapRow[]`. Throws `FileFormatError` if required column positions are missing (the only loud failure path); `FileParseError` if the workbook itself can't be opened.
- `group-rows.ts` — buckets `RawSapRow[]` by `delivery`. Applies skip rule D.1 (whole-delivery non-LF returns with `delivery.length < 10`). Detects non-contiguous duplicate delivery headers and warns while merging.
- `apply-rules.ts` — per-delivery filtering and 1:1 row → LineInterim mapping. Drops non-LF rows, qty=0/null rows, item≤0, missing-material, and ZZRE rows. Emits warnings for unknown categories and ZINR rows.
- `build-obd.ts` — assembles one `ObdInput` per delivery from `LineInterim[]` + header row (first row of the group). Sums `totalWeight` → `grossWeight`. Wires `warehouse` from col 2 and `soNumber` from col 9 of the header row.
- `cells.ts` — `toStr`, `toStrOrNull`, `toNum`, `toInt`. Defensive coercion helpers.
- `types.ts` — public types: `ParseResult`, `RawSapRow`, `SkippedRow`, `WarningKind`, error classes (`FileParseError`, `FileFormatError`).

### `RawSapRow` shape

One parsed XLSX row reduced to load-bearing fields (types.ts:71-91 post-rewrite):

```
rowNumber, delivery, warehouse, division
soldToParty, soldToName, shipToParty, shipToName
referenceDoc, deliveryType, itemCategory
item (Int), material, description
deliveryQuantity, volume, netWeight, totalWeight, batch
```

The old `refItem` field was deleted in the 2026-05-14 rewrite (the slot it occupied — col 9 — semantically shifted from "parent item ref" to "SAP Reference Document").

### `LineInterim` shape

Per-line interim record (apply-rules.ts:38-50):

```
lineId, skuCodeRaw, skuDescriptionRaw, batchCode
unitQty, volumeLine, netWeight, totalWeight
isTinting, itemCategory, parentRowNumber
```

Post-rewrite each `LineInterim` is 1:1 with its source `RawSapRow`. `parentRowNumber` is vestigial (always equals `rowNumber`) but kept for debug clarity.

### Output

`ParseResult.obds: ObdInput[]` — the public contract between the parser and the upsert brain. `ObdInput` shape lives in `lib/import-upsert/types.ts` (shared with auto-import and manual-template paths). `linesToObdLineInput` (build-obd.ts) maps each `LineInterim` → `ObdLineInput`.

---

## 6. Upsert brain — `lib/import-upsert/`

Shared utility called by all three import sources. Pure planner / DB executor split — the caller injects `now` for determinism, errors are collected per-OBD without crashing the batch.

Files:

- `lib/import-upsert.ts` — entry wrapper. Exports `upsertObd(input, source, batchId, batchRef, userId, now, options)`. Routes between `createPath` and `patchPath` based on whether `orders.findUnique({ obdNumber })` returns null. P2002 race on create → retries as patch.
- `types.ts` — shared types: `ImportSource = "auto-import" | "manual-template" | "manual-sap"`, `ObdInput`, `ObdLineInput`, `ExistingOrder`, `ExistingLine`, `ExistingSummary`, `LinePatchPlan`, `HeaderPatchPlan`. Constants: `LINE_AUTHORITY`, `DIVISION_TO_SMU`, `CHALLAN_ELIGIBLE_SMU`.
- `state.ts` — `loadExistingObd(obdNumber)` reads order + earliest summary + all lines (three sequential awaits per CORE §3). `resolveCustomerId(shipToCustomerId)` looks up `delivery_point_master.id` from a SAP customer code.
- `lines.ts` — planner `patchLines()` + executor `applyLinePatch()`. Composite-key matching, diff, soft-removes, split cascades.
- `header.ts` — planner `patchHeader()` + executor `applyHeaderPatch()`. NULL → value fills for most fields; auto-import-only overwrite for `obdEmailDate`.
- `effects.ts` — pure `buildEffects()`. Returns `DownstreamEffect[]` the caller dispatches: `mail-order-enrichment`, `challan-create`, `query-summary-rebuild`, `customer-resolved`, `order-type-mismatch`.
- `helpers.ts` — `resolveSmuFromDivision`, `resolveSlotFromTime`, `mergeEmailDateTime`, `fmt`. Mirror the inline helpers in `route.ts` to keep behaviour consistent across the two import-handler styles.
- `audit.ts` — `formatAuditNote()` + `writeAuditLogs()`. Writes per-change rows to `order_status_logs`. Change kind encoded as `[type]` prefix in the `note` field (no schema column for change type).

### Planner vs executor split

Planners are pure functions returning a plan object (`HeaderPatchPlan`, `LinePatchPlan`). Executors run the DB writes from those plans. This lets the upsert utility be unit-testable, and lets the caller flip dry-run mode via `options.dryRun: true` (returns the full plan + effects but skips writes).

### `createPath` (new OBDs)

`lib/import-upsert.ts:142-293`. Creates `orders` row with `workflowStage` (tint → `pending_tint_assignment`, non-tint → `pending_support`) and `slotId` (non-tint only — tint stays `null` per CORE §9). Creates one `import_raw_summary` row. `createMany` on `import_raw_line_items` for all lines, including `netWeight` + `totalWeight`. Writes audit log entries, builds effects, returns `outcome: "created"`.

### `patchPath` (existing OBDs)

`lib/import-upsert.ts:297-422`. Computes header diff (`patchHeader`) and line diff (`patchLines`). Sequential awaits to apply each side (no `prisma.$transaction` per CORE §3). Empty-incoming-list rule: an authoritative source arriving with zero lines does NOT soft-remove existing lines — must send at least one line to claim authority over the line set. Returns `outcome: "patched"` (changes applied) or `outcome: "unchanged"` (no diff produced).

### Composite key — `(lineId + "|" + skuCodeRaw)`

After the 2026-05-14 rewrite, `patchLines` matches existing ↔ incoming rows by composite key via `makeKey(lineId, skuCodeRaw)` (lines.ts:11-23):

```ts
function makeKey(lineId: number, skuCodeRaw: string): string {
  return `${lineId}|${skuCodeRaw.trim()}`;
}
```

**Rationale.** SKU alone is not unique within an OBD:
- Same tinter SKU appears on multiple `lineId`s (e.g. `IN70270181` on `lineId` 10 and 20).
- The `900001+` picked sub-row series can carry the same SKU on different `lineId`s with different `batchCode`s.

`lineId` disambiguates. `skuCodeRaw` is trimmed defensively (XLS cells sometimes carry stray whitespace). Material codes are case-sensitive identifiers in SAP, so no `.toLowerCase()`. `Int` columns absorb SAP zero-padding (`"000070"` and `"70"` both parse to `70`).

`makeKey` is file-local — only `lib/import-upsert/lines.ts` uses it.

### Orphan handling

When an authoritative re-import (manual-sap) arrives with at least one line, existing active lines whose composite key is absent from the incoming set are soft-removed:

```
lineStatus    = "removed_by_import"
removedAt     = now
removedReason = "Removed by manual-sap batch <id>"
```

The literal `"removed_by_import"` must stay exact. Downstream filters depend on it (orders detail panel, splits cascade, TM views).

Cascade: every soft-remove also writes a matching `lineStatus` update to `split_line_items` referencing the same `rawLineItemId` (effects.ts handling).

### `LINE_AUTHORITY`

```ts
{
  "auto-import":     false,
  "manual-template": false,
  "manual-sap":      true,
}
```

Only authoritative sources may overwrite `unitQty`/`volumeLine`/`isTinting` on existing lines AND soft-remove orphans. Non-authoritative sources may only fill NULL `volumeLine` and add genuinely-new lines. Prevents two manual sources fighting over the same OBD's data.

---

## 7. Hard rules — non-negotiable

- **`"removed_by_import"` literal** on `lineStatus` for orphan soft-removes — never rename. Used as a magic string in `lineStatus` filter clauses across orders detail, TM API, delivery challan, splits, audit logs.
- **Composite key separator is `|`** — not empty string, not `:`. Keeps debug output unambiguous.
- **LF-only filter at the row level** (`apply-rules.ts`, STEP 1). Non-LF rows are SAP returns; we don't import them. Independent of the older delivery-level D.1 skip.
- **Qty=0 silent drop.** SAP convention: qty=0 means "not yet picked" or "fully picked, see counterpart sub-row". Either way no positive quantity to import.
- **Auto-sum line `totalWeight` into summary `grossWeight`** via `sumOrNull(lines.map(l => l.totalWeight))` in `build-obd.ts`. Per-line weights also persist for granular reporting.
- **Slot assignment skipped for tint orders.** `orderType === "tint"` → `slotId = null` at import. Tint operator's `/done` endpoint sets the slot on completion. See CORE §9 and CLAUDE_TINT.md §2.
- **Mail-order enrichment hook always fires post-upsert.** `applyMailOrderEnrichment(soNumbers[])` matches incoming `soNumber` against `mo_orders.soNumber` and applies `dispatchStatus`, `priorityLevel`, `remarks`, ship-to overrides, and `orderDateTime` (from `mo_orders.receivedAt`). One `soNumber` can map to multiple OBDs.
- **Customer matching** — see CLAUDE_MAIL_ORDERS.md §5. Import path itself only does exact-code lookup via `resolveCustomerId(shipToCustomerId)` against `delivery_point_master`. Unmatched → `customerMissing: true` on the order; flips back automatically when a later import resolves.
- **Storage Location (col 3) is read but ignored downstream.** Reserved for future warehouse-zone routing.
- **Sequential awaits only.** No `prisma.$transaction` anywhere in this pipeline (CORE §3).
- **`export const dynamic = "force-dynamic"`** on the route (route.ts).
- **Schema columns are camelCase, no `@map`** (CORE §3). The 2026-05-14 additions `netWeight` and `totalWeight` follow this rule.

---

## 8. Filters and drops

In order of application (parser side):

1. **Delivery-level D.1 — non-LF returns with short delivery numbers.** `group-rows.ts:75-83`. If `delivery.length < 10 && deliveryType !== "LF"` the whole delivery is skipped with reason `"non-LF return"`. Fast path for return deliveries that have abbreviated IDs.
2. **Row-level non-LF filter.** `apply-rules.ts` STEP 1. Any row with `deliveryType !== "LF"` is dropped; recorded in `skipped[]` with reason `"non-LF row"`.
3. **ZZRE — whole delivery (D.2).** Every row's `itemCategory === "ZZRE"` → whole delivery skipped with reason `"all-lines-ZZRE"`.
4. **ZZRE — mixed.** Individual ZZRE rows in otherwise-non-ZZRE deliveries are dropped per-row with `mixed-zzre-line` warning.
5. **Qty=0/null silent drop.** SAP convention as noted above.
6. **Item ≤ 0** → drop + `negative-or-zero-item` warning.
7. **Missing material** → drop + `missing-material` warning.
8. **Unknown item category** → row INCLUDED with `unknown-item-category` warning; `isTinting` defaults to `false`.
9. **ZINR breadcrumb** → row included; emits `zinr-article-tag-pending` warning. Placeholder for a future `articleTag` rule.
10. **D.3 — no surviving lines.** If a delivery's `LineInterim[]` ends up empty after rules → skipped with reason `"no-valid-lines"`.

**Unknown SKU is NOT dropped at import.** The line lands in `import_raw_line_items` with `skuCodeRaw` set; `import_enriched_line_items.skuId` is null. Mail-orders enrichment + the order detail UI surface unmatched lines. See CLAUDE_MAIL_ORDERS.md §19 for SKU master gaps.

---

## 9. Routes and handlers

All import operations dispatch through a single route with an `?action=` query param.

```ts
// app/api/import/obd/route.ts:2971-3000  (verbatim)
export async function POST(req: Request): Promise<NextResponse> {
  const url = new URL(req.url, "http://localhost");
  const action = url.searchParams.get("action");

  if (action === "auto") return handleAutoImport(req);

  const session = await auth();
  requireRole(session, [
    ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT,
    ROLES.BILLING_OPERATOR, ROLES.TINT_MANAGER,
  ]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "import_obd", "canImport");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  if (action === "preview")            return handlePreview(req, session!);
  if (action === "confirm")            return handleConfirm(req, session!);
  if (action === "manual-sap-preview") return handleManualSapPreview(req, session!);
  if (action === "manual-sap-confirm") return handleManualSapConfirm(req, session!);

  return NextResponse.json({ error: "Invalid action. …" }, { status: 400 });
}
```

Action → handler map:

| `?action=` | Handler | Auth | Purpose |
|---|---|---|---|
| `auto` | `handleAutoImport` | HMAC (no session) | Auto-Import endpoint, called by `Auto-Import.ps1`. CREATE-only. |
| `preview` | `handlePreview` | Session + `import_obd:canImport` | Manual-template (combined_v2 / two_file_v1) preview pass |
| `confirm` | `handleConfirm` | Session | Manual-template confirm — operator picks which OBDs to commit |
| `manual-sap-preview` | `handleManualSapPreview` | Session | SAP preview — runs `parseSapFile` and returns per-OBD outcome |
| `manual-sap-confirm` | `handleManualSapConfirm` | Session | SAP confirm — re-parses and calls `upsertObd` per OBD |

`auto` skips session auth by routing before `await auth()`. HMAC verification happens inside `handleAutoImport` via `verifyHmacSignature(req)` — fails closed if `IMPORT_HMAC_SECRET` env var is missing or the signature doesn't match the fixed string `"auto-import-v1"`. Header `x-import-key-id: auto-import-v1` is the bypass marker the middleware checks (CORE §4).

`export const dynamic = "force-dynamic"` (route.ts). 10MB upload cap on SAP path. SAP preview and confirm both re-parse the file (the parser is pure; cheaper than stashing intermediate state).

---

## 10. Auto-Import operational details

**Status: paused as of 2026-05-14.** Manual SAP is the active production path. The facts below apply when Auto-Import is resumed.

**Deployment.** Production script lives at `F:\VS Code\OBD-Import Tool v2\Auto-Import.ps1` on the depot PC (outside the orbit-oms repo). The orbit-oms repo carries a reference copy at `docs/sample/Auto-Import.ps1` for context. **Never modify the repo copy — it is a snapshot.**

**Schedule.** Windows Task Scheduler task `2_Auto_Import`, runs every 10 minutes from 8AM to 8PM IST. `ExecutionTimeLimit = PT5M`, `Repetition.Interval = PT10M`, `StopAtDurationEnd = false`. Lazy session reuse — SAP login cookie cached 4h via `session-cookie.txt`.

**Authentication.** HMAC-SHA256 with `IMPORT_HMAC_SECRET`. The signed message is the literal string `"auto-import-v1"` — fixed, timestamp-free (CORE §3 — avoids depot PC clock-drift breaking signatures). Two headers on every request:

```
x-import-key-id:  auto-import-v1
x-hmac-signature: <hex>
```

Middleware bypasses session auth when both are present on `/api/import/obd`. The route handler then calls `verifyHmacSignature(req)` to validate the signature against the secret.

**State files under `<ToolRoot>\Master\`:**

| File | Purpose |
|---|---|
| `daily-state.txt` | Last successful run timestamp + cycle counters |
| `session-cookie.txt` | Cached SAP login cookie (4h TTL; never wiped — lazy re-login handles staleness) |
| `yesterday-recovery-state.txt` | Yesterday's outstanding OBDs being retried |
| `pending-upload.txt` | Files that failed upload (3-retry queue per Phase 11) |
| `last-spec-call.txt` | Most recent successful SAP spec fetch timestamp |
| `last-noise-call.txt` | Most recent throwaway "noise" call (anchors tally-based pagination) |
| `obd-tally-<YYYY-MM-DD>.txt` | Daily per-date OBD tallies for incremental fetch |

**PowerShell quirks.** Followed during any depot-PC scripting — do not duplicate the full list, see CORE §3. Highlights relevant to Auto-Import:

- `[BitConverter]::ToString($h).Replace("-","").ToLower()` for HMAC hex output, not `[Convert]::ToHexString()` (PS 5.1 compat).
- `Invoke-WebRequest -UseBasicParsing`, not `Invoke-RestMethod`.
- Statement-form `try { $x = ... } catch { ... }` only — no PS 7+ expression-form.

**Resume checklist when un-pausing:**

1. Verify the SAP LogisticsTracker XLS column layout the script consumes is still compatible. The LogisticsTracker file is independent from the SAP OBT export the manual path uses — should be unaffected by the manual-path column changes.
2. Smoke-test against a single OBD before re-enabling the scheduler.
3. Verify the composite-key patch path. Auto-Import is non-authoritative (`LINE_AUTHORITY["auto-import"] = false`) so it does NOT orphan-remove existing lines — only fills NULLs and adds new lines. Safe by design.
4. Confirm `IMPORT_HMAC_SECRET` is synced between depot PC env and Vercel env vars (all three Vercel environments).
5. Re-enable the scheduled task. Watch the first few cycles via Vercel logs.

---

## 11. UI components

Three React client components, all under `components/import/`.

**`import-modal.tsx`** (~1140 LOC, universal import entry). Renders the modal triggered by any board's `<UniversalHeader showImport>`. Stage machine: `idle → parsing → preview → confirm-intent → submitting → result | error`. Format toggle: SAP file vs Manual template (`combined_v2`). Optional Preview toggle — preview-on flows through preview-then-confirm; preview-off commits directly (with an amber warning shown). 10MB cap, `.xlsx` only. Esc/X/backdrop dismissal varies by stage (in-flight blocks Esc; preview stage prompts to discard; confirm-intent reverts to preview on Esc).

**`import-page-content.tsx`** (~1000 LOC, admin `/admin/import` page). Same data flow as the modal but with a larger surface for the preview table. Template selector drives which file-drop zones render. Manual-template path supports per-OBD selection (checkboxes) before confirm; SAP path commits everything previewed (no per-OBD selection). Marked for future split when a fourth template lands.

**`sap-preview.tsx`** (SAP-specific preview rendering). The SAP preview response shape is different from manual-template (no `batchId`, no per-OBD selection, outcomes are `new` / `patch` / `skipped` / `error`). Compact table with expandable warnings per OBD. Confirm button shows the importable count; greyed when nothing to commit.

All three components live entirely client-side. Server fetches happen via `fetch("/api/import/obd?action=...")`. State is local — no global store, no React Context, no Redux. Loading + error states are per-stage strings.

---

## 12. Slot assignment integration

Cross-reference: CORE §9 (slot thresholds), CLAUDE_MAIL_ORDERS.md §1 (mo_orders enrichment).

**Non-tint orders.** Slot is set at import via `resolveSlotFromTime(emailTime)` (`helpers.ts:26-34`) on the merged `orderDateTime`. Thresholds (IST):

```
< 10:30   → Morning   (slot 1)
< 12:30   → Afternoon (slot 2)
< 15:30   → Evening   (slot 3)
≥ 15:30   → Night     (slot 4)
null      → Night     (slot 4)
```

`originalSlotId` is set to the same value at create-time. Slot 5 (Next Day Morning) is defined in the schema but never assigned at import.

**Tint orders.** `orderType === "tint"` → `slotId = null, originalSlotId = null` at import. The tint operator's `/api/tint/operator/done` (or `/split/done`) endpoint computes slot at completion time and writes it on the parent order. For split orders the parent's slot is set when the last split completes (latest-completion-wins). See CLAUDE_TINT.md §2.

**Mail-order override.** `applyMailOrderEnrichment(soNumbers[])` (route.ts:226) matches `import_raw_summary.soNumber` against `mo_orders.soNumber`. On match it overrides `orderDateTime` from `mo_orders.receivedAt` (the email arrival time). A mail order received at 8:45 AM IST but punched into SAP at 11 AM still gets Morning slot. Tint orders have their slot recalculation skipped — see `applyMailOrderEnrichment` implementation for the early-out.

**Slot cascade and day-boundary reset are DISABLED.** `lib/slot-cascade.ts` and `lib/day-boundary.ts` exist but are not called from any route (CORE §13). If ever re-enabled they must skip tint orders.

---

## 13. Audit and observability

**Per batch.** Every import run creates one `import_batches` row. `batchRef` is a human label embedded with source + filename + obdEmailDate (e.g. `[manual-sap] file.xlsx (obdEmailDate: 2026-05-14)`). Status: `processing` → `complete` / `failed`. Counters: `totalObds`, `skippedObds`, `failedObds`.

**Per OBD.** `order_status_logs` gets one row per applied change. Note format is `[change_type] <detail> via <source> batch <batchRef>` (`audit.ts:16-23`). Greppable via the `[change_type]` prefix — no schema column for change type itself. Encoded types: `obd_created`, `header_patched`, `header_overwritten`, `line_added`, `line_patched`, `line_removed`, `line_restored`.

**Per line.** `lineStatus` on `import_raw_line_items` transitions:
- `active` (default at create)
- `removed_by_import` (soft-remove during re-import patch — preserves history rather than hard-deleting)
- Restorations flip back to `active` with `removedAt: null`, `removedReason: null`.

`split_line_items` mirrors `lineStatus` changes via cascade in `effects.ts` so dispatch/picking views see soft-removes.

**Shadow log.** `import_shadow_log` is INSERT-ONLY. Used during phase cutovers to compare new upsert decisions against current behaviour without committing. Inactive today but retained for future cutovers.

**Console warnings worth watching** (Vercel logs):

- `[patchLines] Duplicate (lineId=N, sku='X') in {existing|incoming} lines` — true composite-key collision. Rare. Indicates either a parser bug or genuinely corrupted source data.
- `applyMailOrderEnrichment skipped` — `soNumber` didn't match any `mo_orders` row. Expected for OBDs that don't originate from a mail order.
- `stats-mismatch` parser warning — invariant `createdObds + skippedDeliveries === uniqueDeliveries` failed. Shouldn't happen in steady state.
- `duplicate-delivery-header` — same OBD number appears in non-contiguous row groups in the source file. Parser merges and warns.

No dedicated batch-level audit UI today. Per-OBD audit is visible in the order detail panel at `/admin/orders/[id]`. Batch-level view is open work — see §15.

---

## 14. Landmines

Things that look fixable but aren't. Style mirrors CORE §13.

- **`"removed_by_import"` literal.** Used as a magic string in `lineStatus` filter clauses across orders detail (`app/api/orders/[id]/detail/route.ts:108`), TM API, delivery challan, splits cascade, audit logs. Do not rename to `"removed"` even though planning docs sometimes write it that way. The 2026-05-14 rewrite preserved the original literal deliberately.
- **Composite key migration.** Pre-2026-05-14 the patch path matched line items by `skuCodeRaw` alone. Historical Auto-Import data wrote `lineId=0` for all rows (a behaviour documented in the now-removed comment block in `lines.ts:47-52`). A future SAP re-import on any such legacy OBD will see the composite key `(0, SKU)` ≠ `(real_lineId, SKU)` and orphan-soft-remove every existing line. Acceptable on the clean-slate state at 2026-05-14 cutover; risk re-emerges if Auto-Import resumes and writes new `lineId=0` rows. Decision deferred — see §15.
- **`parentRowNumber` on `LineInterim`.** Carried over from pre-rewrite grouping logic where one `LineInterim` could aggregate multiple source rows. Post-rewrite each `LineInterim` is 1:1 with its `RawSapRow` so `parentRowNumber === rowNumber` always. Vestigial but harmless — kept for debug clarity.
- **`KNOWN_ITEM_CATEGORIES` warning chatter.** `apply-rules.ts` emits `unknown-item-category` for any category outside the allowlist. After the LF-only filter the warning still fires for legitimate-but-unrecognised categories. Mostly noise; do not act on it without confirming a real semantic shift.
- **`duplicate-sku-summed` `WarningKind` removed.** The pre-rewrite parser emitted this whenever it merged multiple rows of the same SKU. Post-rewrite no merging happens. Do not re-add the variant to the union — the type is the source of truth and adding it back would silently break tests against the type.
- **`ExistingLine` doesn't carry weights.** `state.ts:42-48` SELECT clause omits `netWeight` and `totalWeight`. Intentional: weights rarely change post-import, and adding them to the diff would inflate audit log noise. Means weight-only changes on re-import currently go silently un-audited (the data still updates if the row is touched for other reasons via the patch flow). See §15 if weight diff becomes needed.
- **`refItem` field deleted.** Pre-rewrite `RawSapRow` had `refItem: number | null` reading col 9 of the old layout as an integer. New layout's col 9 is the SAP Reference Document (string, e.g. `"1045686409"`). Field was deleted, replaced by `referenceDoc: string | null`. The old name was misleading anyway. Do not reintroduce.
- **Patch-path `createMany` parity.** Both `createPath` (in `lib/import-upsert.ts`) and `applyLinePatch` (in `lib/import-upsert/lines.ts`) call `createMany` to insert new rows. Both must include the same columns. The 2026-05-14 weight fields were added to both — easy to add a new column to one and forget the other.
- **Preview noise on mixed-LF deliveries.** Row-level non-LF skip emits one `SkippedRow` per dropped row. The preview UI loops `parseResult.skipped` and renders one OBD entry per row. A delivery with 4 LF rows + 1 non-LF row appears twice in the preview (once as `new`/`patch`, once as `skipped`). Not observed in current production data; flip to `warnings.push` if it becomes noisy.
- **Old SAP layout detection.** A user uploading the pre-2026-05-14 25-column file gets `FileFormatError: Header row is missing required column position(s): …`. The 19-col parser cannot parse the old layout. No backwards-compat shim — SAP must re-export.
- **Storage Location (col 3)** is read into `RawSapRow` but never written anywhere downstream. Intentionally inert — reserved for future warehouse-zone routing. Do not propagate to summary without confirming a consumer exists.
- **Mail-order enrichment match is by `soNumber` only.** When SAP emits two separate OBDs for the same mail order's split bills, both get the same `soNumber` and both inherit the same enrichment payload (`updateMany` 1:N per `applyMailOrderEnrichment`). Usually desired; flag if a future use case needs per-OBD targeting.

---

## 15. Open items / future work

- **Auto-Import resume + cross-source orphan policy.** When Auto-Import comes back online, decide policy for the case where a SAP authoritative re-import follows an Auto-Import create on the same OBD. Today the composite-key change would orphan everything Auto-Import wrote (if it ever wrote `lineId=0`). Options: (a) treat as acceptable cleanup, (b) one-time backfill to map Auto-Import lineIds before resume, (c) keep Auto-Import non-authoritative and let manual-sap re-imports rebuild the line set. Decision deferred until Auto-Import is actually un-paused.
- **Weight diff in audit log.** Currently weights persist on insert but aren't compared on re-import (`ExistingLine` doesn't carry them). Add later if weight tracking becomes needed. Requires: extend `ExistingLine`, update `state.ts` SELECT, add weight comparison in `patchLines` diff, format weight changes via `fmt()` in audit notes.
- **Storage Location (col 3) consumer.** Read into `RawSapRow` today but discarded. If/when warehouse-zone routing needs it, surface through `ObdInput` → `import_raw_summary` → `orders`.
- **Tint Operator shade auto-match on duplicate-SKU lines.** `components/tint/tint-operator-content.tsx:788` uses `.find(l => l.skuCodeRaw === shade.skuCode)` — picks the FIRST tinting line when same-SKU duplicates exist. Auto-fill misses the second twin. Operator can still tint it manually; not data loss, just UX friction. Polish task.
- **Barcode/QR label generation post-tinter-issue.** Not in scope today. When tinted batches need physical labels at the warehouse, label data (SKU code + batch + tinter + qty) would come from `tinter_issue_entries` joined with `import_raw_line_items.batchCode`. The composite-key change + per-row Batch column make per-batch labels viable for the first time.
- **E-way bill JSON export.** Government compliance requirement that may land. Source data sits on `import_raw_summary` + `import_raw_line_items`.
- **Batch-level audit UI.** No standalone page yet. Per-OBD audit lives in `/admin/orders/[id]` detail. A batch-level view (all OBDs touched by one `import_batches` row + errors) would help triage failed imports.

---

*Import v1 · Schema v27.2 · OrbitOMS · 2026-05-14*
