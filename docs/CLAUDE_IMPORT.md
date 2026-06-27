# CLAUDE_IMPORT.md — OrbitOMS Import Pipeline
# v1.1 · Schema v27.7 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Covers the SAP/OBD import pipeline end-to-end: manual SAP upload, Auto-Import (currently paused), the shared upsert utility that both paths funnel through, schema, filters, and downstream consumers.

Primary users: admin, dispatcher, support, billing_operator, tint_manager (all gated on `import_obd` / `canImport` per role).

---

## 1. What this module is

OrbitOMS receives Outbound Deliveries (OBDs) from SAP via two import paths:

- **Manual SAP** — operator uploads a SAP OBT export `.xlsx` via the universal import modal or the admin `/import` page. This is the active production path as of 2026-05-14. Preview-then-confirm with optional bypass for fast batches.
- **Auto-Import** — scheduled background pull on the depot PC, **paused as of 2026-05-14**. When active, runs every 10 minutes (8AM–8PM IST), fetches SAP files via LAN, HMAC-signs a multipart payload, and POSTs to a dedicated endpoint. Reference script at `docs/sample/Auto-Import.ps1` (production copy lives outside the repo per CORE §4).

Both paths converge at `upsertObd()` (`lib/import-upsert.ts`) — the shared brain that owns create-vs-patch decisions, line-level diff, soft-remove cascades, audit logging, and downstream-effect signalling.

Scale: ~100–200 OBDs/day per CORE §1. Single-depot deployment.

Downstream consumers: `orders` rollup, `import_obd_query_summary` cache, `applyMailOrderEnrichment()` hook (CLAUDE_MAIL_ORDERS.md §7), challan auto-creation (CLAUDE_TINT.md §9.1), Support board, Tint Manager Kanban, dispatch planning, warehouse picking.

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

Manual SAP exercises both create and patch paths. Auto-Import is **create-only** (route.ts:2376 explicitly `continue`s on already-existing OBDs) and therefore never reaches `patchLines`.

---

## 3. File layouts

### 3.1 Manual SAP — new 19-column layout

The current SAP OBT export. One worksheet (`Sheet1` typical). Header row 1, data row 2 onward. Parser uses position-based access — does NOT match by header text. Column map locked:

| Col | Header | Field | Table | Notes |
|-----|--------|-------|-------|-------|
| 1 | Delivery | `obdNumber` | summary + lines | 10-digit typical |
| 2 | Shipping Point/Receiving Pt | `warehouse` | summary | e.g. `IN53` |
| 3 | Storage Location | (ignored) | — | Read into `RawSapRow` but not propagated |
| 4 | Division | `smu` (via lookup) | summary | DIVISION_TO_SMU: 70=Deco Retail, 74=Decorative Projects, 76=Distributor, 77=Retail Offtake |
| 5 | Sold-To Party | `billToCustomerId` | summary | String |
| 6 | Name of sold-to party | `billToCustomerName` | summary | |
| 7 | Ship-To Party | `shipToCustomerId` | summary + orders | String |
| 8 | Name of the ship-to party | `shipToCustomerName` | summary + orders | |
| 9 | Reference Document | `soNumber` | summary + orders | String (NOT int). SAP sales order number |
| 10 | Delivery Type | (filter only) | — | Keep `LF` rows; drop everything else |
| 11 | Item category | `isTinting` derivation | lines | `isTinting = (itemCategory === "Z007")`. ZZRE handled separately |
| 12 | Item | `lineId` | lines | Int. `10`/`20` for line items; `900001+` for picked sub-rows |
| 13 | Material | `skuCodeRaw` | lines | String, case-sensitive |
| 14 | Description | `skuDescriptionRaw` | lines | |
| 15 | Delivery quantity | `unitQty` | lines | Int |
| 16 | Volume | `volumeLine` | lines | Float, summed to summary.volume |
| 17 | Net weight | `netWeight` | lines | Float (added 2026-05-14) |
| 18 | Total Weight | `totalWeight` | lines | Float (added 2026-05-14), auto-summed to summary.grossWeight |
| 19 | Batch | `batchCode` | lines | String, empty → null |

REQUIRED_COLS (read-sheet.ts:54-58): `[delivery, warehouse, division, soldToParty, shipToParty, referenceDoc, deliveryType, itemCategory, item, material, deliveryQty]`. Optional positions (`volume`, `netWeight`, `totalWeight`, `batch`, name fields, `storageLocation`) may legitimately be blank on individual rows.

### 3.2 Auto-Import v1 — LogisticsTracker + per-OBD merge (current, PAUSED)

> **v2 replaces this entirely with FormGetData JSON — no Excel files.** See §10.1 for the v2 design. The sheet layout below is v1-only.

`Auto-Import.ps1` builds a combined `.xlsx` with two named sheets:

- Sheet `LogisticsTrackerWareHouse` — header per OBD:
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

- Sheet `LineItems` — one row per surviving SAP line.

### 3.3 Old SAP layout — deprecated

Pre-2026-05-14 25-column export. **No backwards-compat shim.** A user uploading the old file gets `FileFormatError: Header row is missing required column position(s)`. SAP must re-export.

---

## 4. Schema (import tables)

### import_batches

```
id, batchRef (UNIQUE, retry-safe), source ('manual-sap'|'auto-import'),
fileName, fileSize, uploadedById, status ('processing'|'success'|'error'),
errorMessage, createdAt, completedAt
```

`batchRef` collisions hit a P2002 retry pattern.

### import_raw_summary

One row per OBD per batch.

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

No compound unique constraints. `obdNumber` is NOT unique here.

### import_raw_line_items

One row per surviving SAP line per OBD. **Duplicates by `(obdNumber, skuCodeRaw)` are permitted** — the composite-key patch logic preserves them.

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

### import_enriched_line_items

One row per raw line. `rawLineItemId @unique` guarantees 1:1. Duplicate-SKU raw rows each get their own enriched row.

```
id, rawLineItemId (UNIQUE FK), skuId (FK sku_master, nullable)
unitQty, volumeLine, lineWeight, isTinting
note, createdAt
```

### import_obd_query_summary

Cached per-OBD aggregate. `obdNumber UNIQUE`, `orderId UNIQUE`. Rebuilt by `rebuildQuerySummaryForOrder()` whenever the upsert plan reports line-level or header changes.

```
obdNumber UNIQUE, orderId UNIQUE
totalLines, totalUnitQty, totalWeight, totalVolume
hasTinting, totalArticle, articleTag
createdAt
```

### import_shadow_log

INSERT-ONLY analysis log for shadow-mode cutover phases. Not actively written today.

```
batchId, obdNumber, source
actualOutcome, shadowOutcome, decision (JSON)
errors, createdAt
indexed on (batchId), (obdNumber), (createdAt)
```

---

## 5. Parser package — lib/sap-parser/

Pure synchronous module. No DB access, no HTTP, no `Date.now()` side effects. Deterministic given same buffer + `fallbackObdEmailDate`.

Files:
- `index.ts` — entry point. `parseSapFile(buffer, options) → ParseResult`. Orchestrates `readSheet → groupRows → applyRules → buildObds`. Computes file-level invariant `createdObds + skippedDeliveries === uniqueDeliveries`; emits `stats-mismatch` warning on failure (no throw).
- `read-sheet.ts` — opens workbook via `xlsx` package, validates header width, converts data rows to `RawSapRow[]`.
- `group-rows.ts` — buckets rows by delivery. Skips short-delivery non-LF returns (`delivery.length < 10 && deliveryType !== "LF"`) with reason `"non-LF return"`.
- `apply-rules.ts` — STEP 1: row-level non-LF filter. STEP 2: ZZRE checks. STEP 3: per-row validation. **NO grouping** — every surviving row becomes one DB row (2026-05-14 change, dropped SKU-summing logic).
- `build-obd.ts` — emits `ObdInput[]` from filtered rows. Auto-sums line `totalWeight` into summary `grossWeight`. Auto-sums `volumeLine` into summary `volume`.
- `cells.ts` — typed cell readers (`readInt`, `readFloat`, `readString`).
- `types.ts` — `RawSapRow`, `LineInterim`, `ObdInput`, `SkippedRow`, `WarningKind`, `ParseResult`.

### Column constants

In `read-sheet.ts`:
```ts
export const COL = {
  delivery: 0,
  warehouse: 1,
  storageLocation: 2,
  division: 3,
  soldToParty: 4,
  soldToName: 5,
  shipToParty: 6,
  shipToName: 7,
  referenceDoc: 8,
  deliveryType: 9,
  itemCategory: 10,
  item: 11,
  material: 12,
  description: 13,
  deliveryQty: 14,
  volume: 15,
  netWeight: 16,
  totalWeight: 17,
  batch: 18,
} as const;
```

### LineInterim shape

```ts
{
  lineId: number;
  skuCodeRaw: string;
  skuDescriptionRaw: string | null;
  batchCode: string | null;
  unitQty: number;
  volumeLine: number;
  netWeight: number | null;
  totalWeight: number | null;
  isTinting: boolean;
  itemCategory: string | null;
  article: string | null;
  articleTag: string | null;
}
```

---

## 6. Upsert brain — lib/import-upsert/

Planner vs executor split. The planner reads existing state and produces a plan; the executor applies the plan and emits downstream effects.

### Files

- `lib/import-upsert.ts` — entry wrapper. Exports `upsertObd(input, ctx) → { outcome, effects }`. Branches: `createPath` (no existing summary) vs `patchPath` (existing summary found). `createPath` also calls `createMany` on lines, passing `netWeight` + `totalWeight`.
- `lib/import-upsert/types.ts` — `ObdInput`, `ObdLineInput`, `UpsertContext`, `UpsertOutcome` ('new'|'patched'|'no-change'|'skipped-previously-removed'), `DownstreamEffect` discriminated union.
- `lib/import-upsert/state.ts` — `loadExistingState()` returns `ExistingState` (summary, lines as `Map<key, ExistingLine>`, current header diff). Lines `SELECT` does NOT include `netWeight`/`totalWeight` (see §14 landmines).
- `lib/import-upsert/lines.ts` — `applyLinePatch()`. Composite-key keyed: `makeKey(lineId, skuCodeRaw) = lineId + "|" + skuCodeRaw`. Inserts new lines via `createMany`, updates existing in-place, marks orphans `lineStatus = "removed_by_import"` (literal string, never change).
- `lib/import-upsert/header.ts` — `applyHeaderPatch()`. Per-field diff. Skips no-ops.
- `lib/import-upsert/effects.ts` — `dispatchEffects()`. Effect kinds: `apply-mail-order-enrichment`, `create-challan-for-order`, `query-summary-rebuild`, `customer-resolved`, `order-type-mismatch`.
- `lib/import-upsert/helpers.ts` — small pure helpers (key construction, weight sum, etc.).
- `lib/import-upsert/audit.ts` — `recordAuditEntry()`. Writes to `import_shadow_log` when enabled.

### The composite key

`makeKey(lineId: number, skuCodeRaw: string): string` returns `${lineId}|${skuCodeRaw}`.

Why composite: SAP can emit two rows with the same SKU but different `lineId` (and possibly different batches). Pre-2026-05-14 the parser grouped by SKU and summed; that lost the row-level data. After the rewrite, both incoming and existing maps key on `lineId + "|" + skuCodeRaw` so duplicate-SKU pairs are preserved across re-imports.

### LINE_AUTHORITY map

```ts
const LINE_AUTHORITY: Record<ObdSource, "authoritative" | "non-authoritative"> = {
  "manual-sap": "authoritative",
  "auto-import": "non-authoritative",
};
```

Authoritative: the source can mark orphan lines `removed_by_import`. Non-authoritative: orphans left alone.

In practice Auto-Import never reaches `applyLinePatch` (create-only path), so the flag is mostly hypothetical until Auto-Import resumes.

### Orphan handling

When an existing line key doesn't appear in the incoming set:
- If source is authoritative: `UPDATE ... SET lineStatus = 'removed_by_import', removedAt = now(), removedReason = '...'`
- If source is non-authoritative: leave the row alone

**Never hard-delete.** Removed lines persist forever for audit.

---

## 7. Hard rules — non-negotiable

- **`removed_by_import` literal stays exact.** Don't rename, don't enum-ify, don't `.toLowerCase()`.
- **Composite key uses `|` separator.** Don't change separator without also rebuilding every map consumer.
- **LF-only filter at row level.** ZZRE handled separately.
- **Qty=0 silent drop.** SAP convention — don't surface a warning.
- **Auto-sum `totalWeight` into summary `grossWeight`.** In `build-obd.ts`.
- **Slot assignment skipped for tint orders.** `orderType === "tint"` → `slotId = null` at import. Slot set on tint completion (CLAUDE_TINT.md §2).
- **Mail-order enrichment hook runs after upsert.** Effect dispatched by `dispatchEffects()`.
- **Customer matching cascade** lives in mail-orders module — see `CLAUDE_MAIL_ORDERS.md §5` (don't duplicate here).
- **Storage Location (col 3)** read but ignored downstream. Reserved for future warehouse-zone routing. Don't propagate without confirming a consumer exists.
- `export const dynamic = "force-dynamic"` on the route.
- Schema columns are camelCase, no `@map`. The 2026-05-14 additions `netWeight` and `totalWeight` follow this rule.

---

## 8. Filters and drops

In order of application (parser side):

1. **Delivery-level D.1** — non-LF returns with short delivery numbers. `group-rows.ts:75-83`. Skip whole delivery with reason `"non-LF return"`.
2. **Row-level non-LF filter.** `apply-rules.ts` STEP 1. Drop with reason `"non-LF row"`.
3. **ZZRE — whole delivery (D.2).** Every row's `itemCategory === "ZZRE"` → whole delivery skipped (`"all-lines-ZZRE"`).
4. **ZZRE — mixed.** Individual ZZRE rows in otherwise-non-ZZRE deliveries dropped per-row with `mixed-zzre-line` warning.
5. **Qty=0/null silent drop.** SAP convention.
6. **Item ≤ 0** → drop + `negative-or-zero-item` warning.
7. **Missing material** → drop + `missing-material` warning.
8. **Unknown item category** → row INCLUDED with `unknown-item-category` warning; `isTinting` defaults to `false`.
9. **ZINR breadcrumb** → row included; emits `zinr-article-tag-pending`. Placeholder for future `articleTag` rule.
10. **D.3 — no surviving lines.** Skipped with `"no-valid-lines"`.

**Unknown SKU is NOT dropped at import.** Line lands with `skuCodeRaw` set; `import_enriched_line_items.skuId` is null. Surfaced in mail-orders enrichment + order detail UI.

---

## 9. Routes and handlers

All import operations dispatch through a single route with an `?action=` query param.

```ts
// app/api/import/obd/route.ts
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

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
```

| Action | Handler | Purpose |
|---|---|---|
| `manual-sap-preview` | `handleManualSapPreview` | SAP preview (dry run) |
| `manual-sap-confirm` | `handleManualSapConfirm` | SAP confirm (commits) |
| `auto` | `handleAutoImport` | HMAC-signed Auto-Import v1 (PAUSED) |
| `auto-json` | `handleAutoImportJson` | [PLANNED — v2] HMAC-signed JSON payload; no XLSX |
| `check` | `handleAutoImportCheck` | [PLANNED — v2] Pre-check: are any submitted OBDs already imported? |
| `preview` | `handlePreview` | Legacy preview (kept for backwards compat) |
| `confirm` | `handleConfirm` | Legacy confirm |

All routes need `export const dynamic = 'force-dynamic'`.

---

## 10. Auto-Import operational details

**Status: PAUSED as of 2026-05-14.** Manual SAP upload is the active path. When Auto-Import resumes it will be v2 (pure JSON) — see §10.1. The v1 XLSX path (`?action=auto`) is kept for reference but will not be un-paused.

When un-paused (v1 reference):
- Scheduled task: every 10 min, 8AM-8PM IST
- HMAC signing: `IMPORT_HMAC_SECRET` env var, fixed string `"auto-import-v1"` (timestamp-free, avoids clock drift)
- State files in `Master\`: see CORE §4
- PowerShell 5.1 quirks per CORE §3
- ExecutionTimeLimit `PT5M`, Repetition interval `PT10M`, `StopAtDurationEnd=false`

### 10.1 Auto-Import v2 — pure JSON pipeline [DESIGN LOCKED 2026-06-20, BUILD IN PROGRESS]

Goal: replace the two-step XLSX download cycle with a direct FormGetData JSON POST. No Excel files. No intermediate sheets.

**Locked decisions:**
- `lineId` carries the real SAP item number (the ONE approved deviation from v1: v1 used ordinal 10/20/30; v2 preserves what the SAP Breakwalls API returns).
- CREATE-ONLY: same as v1 — never patches existing OBDs. Patch is manual-SAP's domain.
- HMAC key: hardcoded `"auto-import-json-v1"` string (distinct from v1's `"auto-import-v1"`).
- Env var: `IMPORT_HMAC_SECRET_JSON` (new; separate from `IMPORT_HMAC_SECRET` which stays for v1 route).
- All v1 PC enrichment rules still apply (isTinting from SMU gate, article/articleTag logic, config files in `Master\`).

**FormGetData payload shape:**
```json
{
  "invoiceNumber": "string",
  "obdNumber": "string",
  "headerRows": [{ "key": "...", "value": "..." }],
  "lineRows":   [{ "key": "...", "value": "..." }]
}
```

**Header field map** (`headerRows[].key` → DB field):

| FormGetData key | DB field |
|---|---|
| `SAP Delivery Number` | `obdNumber` |
| `Sales Order Number` | `soNumber` |
| `Bill To Customer Id` | `billToCustomerId` |
| `Name of Sold-To Party` | `billToCustomerName` |
| `Ship-To Party` | `shipToCustomerId` |
| `Name of Ship-To Party` | `shipToCustomerName` |
| `SMU Code` | `smuCode` / `smu` (lookup) |
| `Invoice No` | `invoiceNo` |
| `Invoice Date` | `invoiceDate` |
| `OBD Email Date` | `obdEmailDate` |
| `OBD Email Time` | `obdEmailTime` |
| `Unit Qty` | `totalUnitQty` |
| `Gross Weight` | `grossWeight` |
| `Volume` | `volume` |
| `SAP Status` | `sapStatus` |
| `Material Type` | `materialType` |
| `Nature of Transaction` | `natureOfTransaction` |
| `Warehouse` | `warehouse` |
| `Posting Date` | fallback for `obdEmailDate` if missing |

**Line field map** (`lineRows[].key` → DB field):

| FormGetData key | DB field |
|---|---|
| `Item Number` | `lineId` (real SAP item number) |
| `Material Code` | `skuCodeRaw` |
| `Description` | `skuDescriptionRaw` |
| `Delivery Qty` | `unitQty` |
| `Volume` | `volumeLine` |
| `Item Category` | `itemCategory` (→ `isTinting` via Z007 rule) |
| `Net Weight` | `netWeight` |
| `Total Weight` | `totalWeight` |
| `Batch` | `batchCode` |

**Header-patch for existing OBDs (§3.5 of design doc):**
If `?action=auto-json` receives an OBD number that already exists, it does NOT skip blindly. It patches `invoiceNo`, `orderDateTime`, and `slotId` ONLY IF they are currently null on that order. Rationale: v1 never had these fields (they were in the LogisticsTracker sheet which the PS script couldn't easily correlate per-OBD); v2's FormGetData response has them directly. Guard: don't overwrite if already set by manual-SAP.

**Yesterday-completeness pass (§3.6 of design doc):**
On each run, PS v2 also re-fetches OBDs from yesterday + day-before-yesterday (rolling 3-day chase window). Covers OBDs that were created late or had their invoice stamped after the same-day run. Server only patches null fields — safe to re-submit.

**Build sequence status (as of 2026-06-20):**

| Step | Description | Status |
|---|---|---|
| 1 | Prove FormGetData returns the expected payload | DONE |
| 2 | Confirm field key names match the map above | DONE |
| 3 | Design `processAutoImportRows()` refactor (shared core for v1+v2) | DONE (design) |
| 4 | Build `processAutoImportRows()` in route | NOT DONE |
| 5 | Build `?action=auto-json` handler | NOT DONE |
| 6 | Design PS v2 script | DONE |
| 7 | Build PS v2 script | NOT DONE |
| 8 | Integrate `?action=check` pre-check | NOT DONE |
| 8b | Build `?action=check` handler on server | NOT DONE |
| 9 | End-to-end smoke test on dev (bench data) | NOT DONE |
| 10 | Deploy PS v2 + enable on depot PC | NOT DONE |

**Known recovery gaps:** v2 will miss any OBD created between pause (2026-05-14) and v2 go-live. Those must be imported manually via SAP.

### Resume checklist (v1 — superseded by v2)

1. Verify HMAC secret matches Vercel env vars
2. Audit cross-source orphan policy (see §15 open items)
3. Smoke-test against a small known batch
4. Re-enable Windows Task Scheduler task `2_Auto_Import`
5. Monitor `import_batches` + `/api/health` for first 24h

---

## 11. UI components

- `components/import/sap-preview.tsx` — preview modal. Per-OBD outcome (new/patch/skipped/error) + issues list. Confirm button posts to `manual-sap-confirm`.
- `components/import/import-modal.tsx` — universal entry. Wrapped wherever an import action lives.
- `components/import/import-page-content.tsx` — admin `/admin/import` page content.

State lives in `useState` inside each component. No shared state store.

---

## 12. Slot assignment integration

Cross-reference CORE §9.

- **Non-tint orders:** slot set at import via `resolveSlot(orderDateTime)`.
- **Tint orders (`orderType === "tint"`):** `slotId = null` at import. Slot set on tint completion (CLAUDE_TINT.md §2).
- **`applyMailOrderEnrichment()` overrides `orderDateTime`** from `mo_orders.receivedAt` when there's a matching `soNumber`. Then re-applies `resolveSlot` for non-tint orders only.

---

## 13. Audit and observability

- `import_batches` records every run (status, file metadata, completed time).
- `import_shadow_log` for shadow analysis. INSERT-ONLY.
- Console warnings to look out for:
  - `stats-mismatch` — file-level invariant violation
  - `unknown-item-category` — new SAP item category not yet mapped
  - `mixed-zzre-line` — partial ZZRE delivery
  - `zinr-article-tag-pending` — articleTag rule placeholder
  - `missing-material` — SAP row without material code
- `lineStatus` transitions: `active` ↔ `removed_by_import`. Never any other value.

---

## 14. Landmines

- **Auto-Import is create-only.** It calls `createMany` directly and skips `upsertObd`'s patch path. If a re-imported OBD comes through Auto-Import, it gets `continue`'d (route.ts:2376). All patch logic is exclusive to Manual SAP today.
- **`ObdSource` enum has two values.** Don't re-add a third without auditing `LINE_AUTHORITY`, the orphan handler, and the audit logger.
- **`ExistingLine` doesn't carry weights.** `state.ts:42-48` SELECT clause omits `netWeight` and `totalWeight`. Weight diffs on re-import currently go silently un-audited. Data still updates if the row is touched for other reasons. See §15 if weight diff becomes needed.
- **`refItem` field deleted.** Pre-rewrite `RawSapRow` had `refItem: number | null` reading col 9 as an integer. New layout's col 9 is the SAP Reference Document (string). Field deleted, replaced by `referenceDoc: string | null`. Don't reintroduce.
- **Patch-path `createMany` parity.** Both `createPath` (`lib/import-upsert.ts`) and `applyLinePatch` (`lib/import-upsert/lines.ts`) call `createMany` to insert new rows. Both must include the same columns. The 2026-05-14 weight fields were added to both — easy to forget one.
- **Preview noise on mixed-LF deliveries.** Row-level non-LF skip emits one `SkippedRow` per dropped row. Preview UI loops `parseResult.skipped` and renders one OBD entry per row. A delivery with 4 LF rows + 1 non-LF row appears twice in preview. Not observed in current production data; flip to `warnings.push` if it becomes noisy.
- **Old SAP layout detection.** Uploading the pre-2026-05-14 25-column file gets `FileFormatError`. No backwards-compat shim — SAP must re-export.
- **Storage Location (col 3)** is read into `RawSapRow` but never written anywhere. Intentionally inert.
- **Mail-order enrichment match is by `soNumber` only.** When SAP emits two separate OBDs for the same mail order's split bills, both get the same `soNumber` and both inherit the same enrichment payload (`updateMany` 1:N). Usually desired; flag if a future use case needs per-OBD targeting.
- **Soft-removed OBDs in re-import.** If a removed OBD comes back, preview shows it as `skipped: previously_removed` and AUTO path skips silently via the existing `existingObdSet.has(...) → continue`. Admin restore is the only path back.

---

## 15. Open items / future work

- **Auto-Import resume + cross-source orphan policy.** When Auto-Import comes back online, decide policy for the case where a SAP authoritative re-import follows an Auto-Import create on the same OBD. The composite-key change could orphan everything Auto-Import wrote (if it ever wrote `lineId=0` or similar). Options:
  - (a) treat as acceptable cleanup
  - (b) one-time backfill to map Auto-Import lineIds before resume
  - (c) keep Auto-Import non-authoritative and let manual-sap re-imports rebuild the line set
  Decision deferred until Auto-Import is actually un-paused.
- **Weight diff in audit log.** Currently skipped to keep audit-log noise low. Re-add if depot ops needs weight-change tracking.
- **`articleTag` rule for ZINR.** Today the row is included with a breadcrumb warning. If business semantics emerge for ZINR articleTags, implement the rule and remove the warning.
- **Old SAP layout shim** if SAP ever ships the old layout again (e.g. depot-level legacy). Not built today.
- **Auto-Import patch path.** Today Auto-Import is create-only. If Auto-Import ever needs to patch existing OBDs (e.g. for late-update detection), the path needs to go through `upsertObd` like manual SAP does, with `LINE_AUTHORITY['auto-import'] = 'authoritative'`. Big change — full re-audit needed.
- **Auto-Import v2 — steps 4–10 not yet built.** See §10.1 build sequence. Design is locked; build has not started. Reference design doc at `docs/prompts/drafts/web-update-2026-06-20-auto-import-v2-pure-json.md` for full detail.
- **`IMPORT_HMAC_SECRET_JSON` env var** must be added to Vercel before step 5. Keep `IMPORT_HMAC_SECRET` (v1 var) until v1 handler is retired.
- **lineId semantic change in v2.** v1 used ordinal positions (10/20/30); v2 uses real SAP item numbers. This means composite key `lineId|skuCodeRaw` will NOT match between a v1 create and a v2 patch. Create-only policy makes this safe, but if patch path ever becomes needed for Auto-Import, re-audit the key strategy.

---

*Import v1.1 · Schema v27.7 · OrbitOMS*
