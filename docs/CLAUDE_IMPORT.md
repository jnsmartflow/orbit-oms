# CLAUDE_IMPORT.md — OrbitOMS Import Pipeline
# v1.7 · Schema v27.13 · August 2026 · updated 2026-08-04 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Covers the SAP/OBD import pipeline end-to-end: manual SAP upload, Auto-Import (**LIVE** — see §10), the shared upsert utility that both paths funnel through, schema, filters, and downstream consumers.

Primary users (live `import_obd` grants, SELECT 2026-08-04 — CORE §5): admin, billing_operator, tint_manager, operations (granted 2026-08-01, `c8f8d020`), operation_manager. ⚠ dispatcher and support are **seeded** for this key but **all-false live** — this line named them as users until 2026-08-04; that was seed, not reality.

---

## 1. What this module is

OrbitOMS receives Outbound Deliveries (OBDs) from SAP via two import paths:

- **Manual SAP** — operator uploads a SAP OBT export `.xlsx` via the universal import modal or the admin `/import` page. This is the active production path as of 2026-05-14. Preview-then-confirm with optional bypass for fast batches.
- **Auto-Import** — scheduled background pull on the **import PC** (a separate machine — task state and trigger config are unverifiable from the depot PC; DB batch markers are the ground truth). **LIVE and running** (resumed 2026-06-20; the "paused as of 2026-05-14" claim was corrected 2026-08-03, and the MECHANISM line corrected 2026-08-04): **it is the v2 pure-JSON pipeline** — `Auto-Import-v2.ps1` fetches Breakwalls FormGetData JSON, HMAC-signs with `auto-import-json-v1` (`IMPORT_HMAC_SECRET_JSON`), and POSTs to `?action=auto-json`, plus the `check` pre-filter and the `patch-headers`/`pending-invoices` invoice+clock sweep. **Every one of the 944 batches 2026-06-20→08-03 (3,876 OBDs) carries the `[auto-import] auto-json` marker; the v1 multipart path (`?action=auto`) has ZERO batches in the entire table.** The old "HMAC-signs a multipart payload" wording survived the 2026-08-03 status correction — status and mechanism were two separate stale claims. Repo copy of what runs: **`docs/Powershell/Auto-Import-v2.ps1`** (a copy is a claim, not proof it is deployed unmodified). The v1-mechanism copies (`docs/sample/Auto-Import.ps1`, `docs/Parser/Auto-Import.ps1`, `docs/Powershell/Auto-Import.ps1` — all titled "v2.0", all posting to the old `orbit-oms.vercel.app` domain) are historical; see §14's naming-trap landmine.

Both paths converge at `upsertObd()` (`lib/import-upsert.ts`) — the shared brain that owns create-vs-patch decisions, line-level diff, soft-remove cascades, audit logging, and downstream-effect signalling.

Scale: ~100–200 OBDs/day per CORE §1. Single-depot deployment.

Downstream consumers: `orders` rollup, `import_obd_query_summary` cache, `applyMailOrderEnrichment()` hook (CLAUDE_MAIL_ORDERS.md §7), challan auto-creation (CLAUDE_TINT.md §9.1), Floor Control (CLAUDE_FLOOR.md), Tint Manager Kanban, dispatch planning, warehouse picking.

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

Auto-Import path (LIVE — the v2 JSON pipeline, §10; mechanism corrected 2026-08-04):
  Scheduler on the import PC (~10 min) → Auto-Import-v2.ps1
    → Breakwalls FormGetData JSON (no Excel files anywhere)
    → POST ?action=check           (HMAC v2) — which OBDs are new?
    → POST ?action=auto-json       (HMAC v2, auto-import-json-v1 / IMPORT_HMAC_SECRET_JSON)
    → middleware bypasses session (HMAC verified by the handler)
    → handleAutoImportJson → processAutoImportRows("auto-json")
    → bulk createMany (CREATE-only for lines: existing OBDs skipped at ingest)
    → applyMailOrderEnrichment
  Phase 9.5, same cycle:
    → GET  ?action=pending-invoices — OBDs in the window with invoiceNo null
    → POST ?action=patch-headers    — null→value invoice fill + clock repair +
                                      dispatch-window repair (§12, Step B)
```

Manual SAP exercises both create and patch paths. The auto-json ingest is **create-only for lines** — an existing OBD is skipped entirely at ingest; the ONLY writes to existing OBDs from the auto pipeline go through the separate `patch-headers` action (null-only invoice fill + clock/slot/window repair, §12). Neither auto action ever reaches `applyLinePatch`.

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

### 3.2 Auto-Import v1 — LogisticsTracker + per-OBD merge (HISTORICAL — never evidenced in batches)

> **The live pipeline is v2 FormGetData JSON — no Excel files** (§10.1, shipped). The sheet layout
> below is v1-only, kept as reference; `import_batches` holds **zero** v1-marker batches
> (checked 2026-08-04), so this layout has no batch evidence of ever running in the current table.

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

⚠ **`skuId` is now written `null` on every import** and is read by nothing live (2026-07-19 —
§8.1). The column and its `sku_master` relation still physically exist in `schema.prisma`; dropping
them is bundled with the future retire-old-table step. `lineWeight` is **not a weight** — see §8.1.

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

**Unknown SKU is NOT dropped at import.** Line lands with `skuCodeRaw` set and is flagged via the
`note` field (§8.1), never discarded. Surfaced in mail-orders enrichment + order detail UI.

### 8.1 Catalog recognition + the enrichment write [LIVE, 2026-07-19, commit `b91b7381`]

**`prisma.sku_master` no longer appears in `app/api/import/obd/route.ts` at all.** Recognition — and
everything that keys off it — now resolves against **`sku_master_v2` by `material`** (the SAP code,
matched against `skuCodeRaw`). The catalog itself is documented in `CLAUDE_CORE.md`; this section
covers only what import does with it.

### The single truthiness check

Every read builds a `Set<string>` of recognised material codes; **three** enrichment fields then key
off one boolean (`known`) derived from it. All three used to key off the old-table lookup:

| Field | Written |
|---|---|
| `skuId` | **`null`** — outright, unconditionally |
| `lineWeight` | `known ? 0 : null` |
| `note` | `known ? null : "Unknown SKU — manual mapping required"` |

**It was three fields, not two.** Anyone re-deriving this and finding only `skuId`/`lineWeight` has
missed the `note`, which is the one the operator actually sees.

### Both confirm paths were cut over

| Path | Handler | How it gets the v2 set |
|---|---|---|
| **Auto** | `handleAutoImport` | **Reuses** the in-scope `existingSkuSet` already built at STEP C — no second query |
| **Legacy `?action=confirm`** | `handleConfirm` | Adds ONE `sku_master_v2.findMany` **inside the existing `Promise.all`** — no extra round trip, no `$transaction` (CORE §3) |

The live manual-SAP path (`handleManualSapConfirm`) delegates to `upsertObd()` and **never wrote the
bookmark** — nothing to cut there. `?action=confirm` is the legacy handler kept for backwards compat
(§9); it was cut over anyway so the two paths cannot drift.

### RESOLVED BUG — preview and confirm now agree

The preview gates already read `sku_master_v2`; confirm still read the old `sku_master`. **The two
disagreed about what counted as a known SKU** — an operator could see a clean preview and get
"Unknown SKU — manual mapping required" notes after confirming, or the reverse. Both now read the
same table with the same semantics, so **preview and confirm agree for the first time.** This came
free with the cut-over; do not re-introduce a second recognition source on either side.

### Coverage — what actually changed

Measured across 703 distinct active SAP codes at cut-over: **119 GAINED** (v2 knows them, the old
table didn't → `lineWeight` null→0, note cleared), **0 LOST**. On the measured set v2 is a strict
superset — nothing that resolved before stopped resolving, so the change is purely additive.

Against the wider population of distinct ACTIVE raw SAP import codes (~1,152): old `sku_master`
~57%, `sku_master_v2` ~73%, **~309 codes (~27%) in NEITHER** → those keep getting the Unknown-SKU
note and fall back to raw SAP text downstream. Cleanup is tracked in `docs/ROADMAP.md`.

> ⚠ **The "~99% coverage" figure does NOT apply here.** That number is Table C's coverage of
> **app-format email lines** (`CLAUDE_MAIL_ORDERS.md §4.1`) — a completely different population from
> SAP import codes. Do not quote it when reasoning about import recognition.

### No `isPrimary` filter

Enrichment must recognise **any** real SAP code, including a duplicate twin. Filtering
`isPrimary = true` here would re-introduce resolution gaps. Only the order-entry surfaces filter on
it (`CLAUDE_PLACE_ORDER.md`).

---

## 9. Routes and handlers

All import operations dispatch through a single route with an `?action=` query param.

```ts
// app/api/import/obd/route.ts (dispatch verified 2026-08-04)
export async function POST(req: Request): Promise<NextResponse> {
  const url = new URL(req.url, "http://localhost");
  const action = url.searchParams.get("action");

  // Five HMAC-authenticated actions dispatch BEFORE session auth:
  if (action === "auto")              return handleAutoImport(req);           // v1 — wired, zero batch evidence
  if (action === "check")             return handleAutoImportCheck(req);      // v2, LIVE
  if (action === "auto-json")         return handleAutoImportJson(req);       // v2, LIVE
  if (action === "patch-headers")     return handleAutoImportPatchHeaders(req);    // v2, LIVE
  if (action === "pending-invoices")  return handleAutoImportPendingInvoices(req); // v2, LIVE

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
| `auto` | `handleAutoImport` | HMAC v1 multipart — **wired but zero batch evidence ever** (§10); do not delete without an owner decision |
| `auto-json` | `handleAutoImportJson` | **[LIVE — v2, the production auto path]** HMAC v2 JSON payload → `processAutoImportRows()` |
| `check` | `handleAutoImportCheck` | **[LIVE — v2]** read-only pre-check: which submitted OBDs are new? |
| `patch-headers` | `handleAutoImportPatchHeaders` | **[LIVE — v2]** null-only invoice fill + clock/arrival-slot/dispatch-window repair (§12) |
| `pending-invoices` | `handleAutoImportPendingInvoices` | **[LIVE — v2]** OBDs in a date window with `invoiceNo` null (feeds Phase 9.5) |
| `preview` | `handlePreview` | Legacy preview (kept for backwards compat) |
| `confirm` | `handleConfirm` | Legacy confirm |

*(The auto-json/check/patch-headers/pending-invoices rows said "[PLANNED — v2]" or were absent until 2026-08-04 — the build shipped without this table being updated.)*

All routes need `export const dynamic = 'force-dynamic'`.

---

## 10. Auto-Import operational details

**Status: LIVE — on the v2 JSON path.** Resumed 2026-06-20 and running since. Both import paths are
active: manual SAP upload carries the bulk of OBD volume, Auto-Import runs alongside it.

⚠ **This section carried TWO separate stale claims.** "PAUSED as of 2026-05-14" survived until
2026-08-03 (six weeks stale); the mechanism ("HMAC-signs a multipart payload") survived until
2026-08-04 — the status correction did not re-check what actually runs. Batch evidence: **944
batches / 3,876 OBDs 2026-06-20→08-03, every one marked `[auto-import] auto-json`; zero v1
multipart batches exist in the whole table** (vs 264 manual-sap batches / 24,334 OBDs in the same
window). Do not restore either wording without re-SELECTing `import_batches`.

**Cadence — derived from batch data 2026-07-20→08-04 (the scheduler itself is on the import PC and
unverifiable from here):** batches observed **08:15–22:52 IST**, densest 10:00–19:00; median gap
between consecutive same-day batches **~20 min** (consistent with a ~10-min timer where a batch is
only created when new OBDs exist); minute-of-hour drifts across the 10-min grid (Task Scheduler
drift, not a fixed :x0 tick). **No batches on Sundays** (2026-07-26, 08-02 — depot closed, SAP emits
nothing). The old "every 10 min, 8AM–8PM IST" claim was close but understated the evening tail.

Runtime facts (v2, live):
- HMAC signing: `IMPORT_HMAC_SECRET_JSON` env var, fixed string `"auto-import-json-v1"` (timestamp-free)
- Repo copy of the running script: `docs/Powershell/Auto-Import-v2.ps1` (`$ToolRoot = "F:\VS Code\OBD-Import Tool v2"` — describes the import PC)
- State files in `Master\`: see CORE §4 · PowerShell 5.1 quirks per CORE §3
- v1 reference (`IMPORT_HMAC_SECRET`, `"auto-import-v1"`, the XLSX merge): historical — §3.2

### 10.1 Auto-Import v2 — pure JSON pipeline [SHIPPED — LIVE since 2026-06-20 per batch markers]

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

**Build sequence — ALL STEPS SHIPPED** (table corrected 2026-08-04; it froze at the 2026-06-20
"NOT DONE" snapshot while the build shipped around it):

| Step | Description | Status (evidence) |
|---|---|---|
| 1-3, 6 | FormGetData proof · field map · `processAutoImportRows()` design · PS v2 design | DONE (as recorded 2026-06-20) |
| 4 | `processAutoImportRows()` in route | **SHIPPED** — `route.ts`, called by both `auto` and `auto-json` handlers |
| 5 | `?action=auto-json` handler | **SHIPPED** — `handleAutoImportJson`, wired in the dispatch |
| 7 | PS v2 script | **SHIPPED** — repo copy `docs/Powershell/Auto-Import-v2.ps1` |
| 8/8b | `?action=check` integration + handler | **SHIPPED** — `handleAutoImportCheck` (read-only pre-check) |
| 9 | End-to-end smoke | moot — running in production since 2026-06-20 |
| 10 | Deploy + enable on the import PC | **RUNNING** — 944 auto-json batches through 2026-08-03, plus 2026-08-04 15:07 IST (14 OBDs) |

**Shipped beyond the locked design:** `?action=patch-headers` grew from "null-only invoice fill" into
the full clock/arrival-slot/dispatch-window repair pass (§12), and `?action=pending-invoices` feeds
the Phase 9.5 sweep — neither was in the 2026-06-20 step list.

**Known recovery gaps:** v2 missed OBDs created between pause (2026-05-14) and go-live (2026-06-20). Those were manual-SAP territory.

---

## 11. UI components

- `components/import/sap-preview.tsx` — preview modal. Per-OBD outcome (new/patch/skipped/error) + issues list. Confirm button posts to `manual-sap-confirm`.
- `components/import/import-modal.tsx` — universal entry. Wrapped wherever an import action lives.
- `components/import/import-page-content.tsx` — admin `/admin/import` page content.

State lives in `useState` inside each component. No shared state store.

---

## 12. Slot assignment integration

Cross-reference CORE §9 (⚠ pending update — see flag below).

**Two distinct slot fields — do not conflate:**
| Field | Meaning | Set when | Applies to |
|---|---|---|---|
| `arrivalSlotId` | which slot the OBD *arrived* in (5-slot ruler: Morning/Afternoon/Evening/Late Evening/Night) | import time | ALL orders — tint and non-tint |
| `slotId` / `originalSlotId` | completion/dispatch slot | SAP: at import (non-tint); tint: at tinting completion | ALL orders |

- **Non-tint orders:** both `arrivalSlotId` and `slotId`/`originalSlotId` are set at import via the resolvers below.
- **Tint orders (`orderType === "tint"`):** `slotId`/`originalSlotId` stay `null` at import — set on tint completion (CLAUDE_TINT.md §2). `arrivalSlotId` is now set at import for tint orders too, same as non-tint (see below) — **this changed 2026-06-29.**
- **`arrivalSlotId` at import (2026-06-29 change) [LIVE]:** both `handleManualSapConfirm` (~line 1021) and the auto-import confirm path (~line 2822) in `app/api/import/obd/route.ts` used to compute `arrivalSlotId` with a tint-guarded ternary: `orderType !== "tint" && emailDateTime ? resolveArrivalSlotId(emailDateTime) : null`. The tint guard was **removed** from both — now `emailDateTime ? resolveArrivalSlotId(emailDateTime) : null`, so tint orders get a real `arrivalSlotId` at import instead of permanently `null`. No backfill run — applies to new orders only.
- **Pre-existing coverage note:** `applyMailOrderEnrichment()` already stamped `arrivalSlotId` correctly for **mail-matched** orders (tint included) before this change — only `slotId`/`originalSlotId` were tint-guarded there, never `arrivalSlotId`. So before 2026-06-29, mail-matched tint orders already had a correct `arrivalSlotId`; only NON-mail-matched tint orders were affected by the old import-time guard. The 2026-06-29 change covers that remaining gap at the source.
- **`applyMailOrderEnrichment()` overrides `orderDateTime`** from `mo_orders.receivedAt` when there's a matching `soNumber`. Then re-applies `resolveSlot` for non-tint orders only (`slotId`/`originalSlotId`); `arrivalSlotId` recalculation is not tint-guarded (see above).

**Why a wrong import-time value mattered — manual SAP has no time column.** The 19-column manual SAP layout (§3.1) has no `OBD Email Time` column, so `obdEmailTime = null` for every row → `mergeEmailDateTime` returns the date unchanged → `emailDateTime` = midnight UTC = 05:30 IST = 330 minutes → `resolveArrivalSlotId` always buckets this to **Morning**, regardless of true arrival time. This is a pre-existing condition for non-tint orders too (they've always landed in Morning when no email time is present); it only became newly *visible* for tint orders once the 2026-06-29 import-time change above gave them a real (if wrong) `arrivalSlotId` instead of `null`.

**JSON auto-import correction pass now re-stamps `arrivalSlotId` (2026-06-29 fix, commit `0a9b2a37`) [LIVE].** `handleAutoImportPatchHeaders` (`?action=patch-headers`, §10.1) is the correction pass that re-fetches real email times for **non-mail-owned** orders (mail-owned orders are already corrected by `applyMailOrderEnrichment`, which has always re-stamped `arrivalSlotId` correctly). Before this fix, `handleAutoImportPatchHeaders` corrected `orderDateTime`/`obdEmailDate` and (for non-tint) `slotId`/`originalSlotId`/`dispatchSlot`, but **never touched `arrivalSlotId`** — so a manual-SAP order stuck at Morning stayed stuck at Morning even after its real time arrived via auto-import. Fix: two lines added immediately after `counts.timeFixed++` and **above** the `if (existing.orderType !== "tint")` guard —
```ts
updateData.arrivalSlotId = resolveArrivalSlotId(newDT);
changedFields.push("arrivalSlotId");
```
Sitting above the tint guard is deliberate: `arrivalSlotId` recalculation applies to **all** order types (consistent with the two-field distinction above), while the guard below it correctly continues to gate only `slotId`/`originalSlotId`/`dispatchSlot`. **Effect:** new orders self-correct — SAP import drops them in with a rough Morning slot, the next auto-import correction pass (~10 min during business hours) fixes the time and now also moves the order to its correct arrival-slot tab, with no manual action and no backfill. **Known limitation (accepted):** between SAP import and the next correction pass, the order still shows under Morning — Smart Flow confirmed this window is acceptable.

### 12.1 `obdEmailDate` time-strip bug in the same correction pass — fixed (commit `3c0cd366`, 2026-07-11) [LIVE]

A **separate** bug in the same `handleAutoImportPatchHeaders` function, found chasing an order
(OBD `9108192224`, SO `1046195285`) that stayed stuck under Morning. The arrival-slot fix above
(§12, `0a9b2a37`) was working correctly — the real problem was one field over: the correction pass
computed the merged, correct date+time (`newDT`) and wrote it correctly to `orderDateTime`, but then
wrote `obdEmailDate` from the **raw, date-only `incomingDate`** instead of the same `newDT` — a copy
mistake, not a lost value:

```diff
             updateData.orderDateTime = newDT;
-          updateData.obdEmailDate  = incomingDate;
+          updateData.obdEmailDate  = newDT;
             changedFields.push("orderDateTime", "obdEmailDate");
```

Every header-patched order was losing its time on `obdEmailDate` and reverting to midnight. This
was silently degrading two other consumers that already assumed `obdEmailDate` carried a real
time — repaired for free by this one-line fix:
- **`lib/dispatch/dispatch-engine.ts`** reads `obdEmailDate` as its `punchDateTime` for a
  same-day/different-day "effective clock" pick — was getting a fake midnight for every
  header-patched order, now correct.
- The then-live Support board showed `00:00` for previously-patched orders (board retired
  2026-07-27 — `archive/2026-07-support/`; today's beneficiaries of a real time here are the
  dispatch engine, Floor, and Picking).

### 12.1b Punch-clock guard + dispatch-window repair (2026-08-02/03, commits `03b6dd19` → `dee603dc` + `ab70c826`) [LIVE]

Two related additions after the fixes above — both verified in code 2026-08-04:

- **`lib/dispatch/punch-clock.ts` — "a date with no time is not a clock."** Manual SAP's 19-column
  layout has no time column, so `obdEmailDate` lands at exactly 00:00:00.000 **UTC** (renders 05:30
  IST) — earlier than every dispatch window, so the engine's effective-clock pick pinned such bills
  to `R1_LOCAL_1030` (audited 2026-08-03: **5,517 of 9,521 rows** carried the fake value).
  `hasClockTime()` + `resolveArrivalClocks(email, punch)` are now the SINGLE OWNER of "which clocks
  may the engine see": a date-only value is passed as `null`, dropping the engine to its
  single-clock path; if BOTH clocks are null the engine declines (`no-order-datetime`) and the bill
  reaches the operator unslotted — **deliberately; a wrong slot is worse than no slot.** ⚠ The tell
  is **UTC midnight, not IST midnight** — 18:30 UTC = 00:00 IST rows are GENUINE times; do not
  "fix" the test to IST. Two consumers must stay in agreement: the import auto-slot call site and
  Floor's rail suggestion (`lib/floor/suggest.ts`).
- **`patch-headers` Step B — dispatch-window repair (`ab70c826`).** The pass already repaired the
  clock; it now also **re-runs `evaluateDispatchSlot` from the corrected timestamps** on the same
  tick. Same scope gates as the import call site (smu / dispatchStatus / delivery type — NOT
  widened), same manual guard (`dispatchSlotSource === 'manual'` is never overwritten), and **a
  decline never nulls an existing slot** ("no opinion" ≠ "remove"). Folded into the ONE existing
  `orders.update` — a second update per bill would false-fire every board's `updatedAt` live-sync
  marker (CORE §3).

**No backfill run.** Already-wrong orders self-correct on their next auto-import batch (same
self-healing pattern as §12 above); the rest age out. Not worth a one-time re-stamp.

### 12.2 The intended new arrival-slot rule — DESIGNED, **NOT BUILT** [NEXT]

⚠ The arrival-slot fork itself (`applyMailOrderEnrichment`, ~route.ts:299-308) is **still the OLD
rule** — it compares `mo_orders.receivedAt` vs `mo_orders.punchedAt`. §12.1 only made
`obdEmailDate` trustworthy enough for a *future* rule to safely use it; the new rule was **not**
applied in that commit. Do not treat this as done.

**The intended rule (to build next):** compare `orders.orderDateTime` vs `orders.obdEmailDate` by
IST calendar day —

| Situation | Timestamp to use for arrival slot |
|---|---|
| same IST day | `orderDateTime` (real mail time) |
| different IST day (order blocked, released later) | `obdEmailDate` (release/finalize time) |

Since the OBD always follows the mail, earliest = `orderDateTime`, latest = `obdEmailDate` — no
min/max step needed. No midnight fallback needed either, now that §12.1 guarantees `obdEmailDate`
carries a real time. Single edit site: the fork in `applyMailOrderEnrichment` (it runs last and wins
for mail-matched orders); non-mail orders already have `orderDateTime == obdEmailDate`, so the
same-day branch gives them today's behaviour unchanged. Reuse the
`toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })` idiom for the day comparison — no new
date library. Confirm OBD `9108192224` re-buckets correctly once a fresh order with a real time
flows through, as the acceptance check.

⚠ **FLAG FOR CORE PASS (step 6):** CORE §9 needs one sentence added: *"`arrivalSlotId` is set at import for ALL orders (tint and non-tint) via `resolveArrivalSlotId(emailDateTime)`. `slotId` stays null for tint until completion."* (Already flagged in step 1 — not re-flagged here.) No new CORE items from this step.

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

- **Auto-Import ingest is create-only for lines.** `processAutoImportRows` skips existing OBDs entirely; line-patch logic is exclusive to Manual SAP. The auto pipeline's ONLY writes to existing OBDs are the separate `patch-headers` action's null-only invoice fill + clock/slot/window repair (§12) — header fields, never lines.
- **THE NAMING TRAP — three scripts, misleading version labels.** `Auto-Import.ps1` titled "**v2.0**" is the **v1 XLSX/multipart** script ("v2.0" = OBD-Import **Tool** v2, not the pipeline) — copies at `docs/sample/`, `docs/Parser/` (untracked), `docs/Powershell/`, all posting to the OLD `orbit-oms.vercel.app` domain, zero batch evidence ever. The script matching what runs is `Auto-Import-v2.ps1` titled "**v1.0**" (pure JSON, `www.orbitoms.in`). "Version two" is ambiguous across every doc mention — name the FILE, not the number. *(The Parser copy's `$ToolRoot` also points at a `%USERPROFILE%\OneDrive` path while the v2 script and CORE §4 say `F:\` — different machines/eras; only the import PC knows its own truth.)*
- **`import_batches.createdAt` is `timestamp` WITHOUT time zone (naive UTC).** Postgres `AT TIME ZONE 'Asia/Kolkata'` on it converts the WRONG WAY (treats the naive value as IST) — silently shifting every timestamp by −11h. Convert with `+ interval '5 hours 30 minutes'`. This bit the 2026-08-04 cadence measurement on its first attempt.
- **`ObdSource` enum has two values.** Don't re-add a third without auditing `LINE_AUTHORITY`, the orphan handler, and the audit logger.
- **`ExistingLine` doesn't carry weights.** `state.ts:42-48` SELECT clause omits `netWeight` and `totalWeight`. Weight diffs on re-import currently go silently un-audited. Data still updates if the row is touched for other reasons. See §15 if weight diff becomes needed.
- **`refItem` field deleted.** Pre-rewrite `RawSapRow` had `refItem: number | null` reading col 9 as an integer. New layout's col 9 is the SAP Reference Document (string). Field deleted, replaced by `referenceDoc: string | null`. Don't reintroduce.
- **Patch-path `createMany` parity.** Both `createPath` (`lib/import-upsert.ts`) and `applyLinePatch` (`lib/import-upsert/lines.ts`) call `createMany` to insert new rows. Both must include the same columns. The 2026-05-14 weight fields were added to both — easy to forget one.
- **Preview noise on mixed-LF deliveries.** Row-level non-LF skip emits one `SkippedRow` per dropped row. Preview UI loops `parseResult.skipped` and renders one OBD entry per row. A delivery with 4 LF rows + 1 non-LF row appears twice in preview. Not observed in current production data; flip to `warnings.push` if it becomes noisy.
- **Old SAP layout detection.** Uploading the pre-2026-05-14 25-column file gets `FileFormatError`. No backwards-compat shim — SAP must re-export.
- **Storage Location (col 3)** is read into `RawSapRow` but never written anywhere. Intentionally inert.
- **Mail-order enrichment match is by `soNumber` only.** When SAP emits two separate OBDs for the same mail order's split bills, both get the same `soNumber` and both inherit the same enrichment payload (`updateMany` 1:N). Usually desired; flag if a future use case needs per-OBD targeting.
- **Soft-removed OBDs in re-import.** If a removed OBD comes back, preview shows it as `skipped: previously_removed` and AUTO path skips silently via the existing `existingObdSet.has(...) → continue`. Admin restore is the only path back.
- **`lineWeight` is NOT a weight.** It has never held a mass — a recognised line stores literal `0`,
  an unrecognised one stores `null`. There is no `grossWeightPerUnit` column on either catalog table
  and never was. In practice it is a **"was this code recognised?" flag** (§8.1). Every reader is
  display-only and tolerates null; nothing sums, averages, or otherwise does arithmetic on it — do
  not start, and do not "fix" the zeros by populating them with real weights without auditing every
  consumer first. The name is the trap.
- **`import_enriched_line_items.skuId` is written `null` and read by nothing live** [2026-07-19
  sweep, `code-discovery-2026-07-19h`]. Zero live runtime paths read the column, traverse the `sku`
  relation off an enriched line, or filter on it. The only readers anywhere are **two
  underscore-prefixed scratch diagnostics** (`_diagnose-sku-5961032.ts`,
  `_diagnose-skuid-collision.ts`) — outside the `tsc --noEmit` gate, never imported by the app, kept
  on disk per CORE §3. They matter only at the eventual DROP-column step, not before. **This does
  NOT authorise dropping the column or removing the relation** — that stays bundled with the future
  "retire old `sku_master` + rename v2" session.
- **⚠ Do NOT "finish the migration" by repointing the `skuId` FK to `sku_master_v2`.** The two
  tables assign different id numbers to the same material code — verified zero overlap. The bookmark
  is retired by **resolving via `material`**, never by moving the FK. Full evidence and the id-space
  detail live in `CLAUDE_CORE.md`'s SKU-catalog section — read it before touching this, and do not
  restate it from memory. Inline warning comments sit at the former read sites; leave them there.
- **Two date/time fields written from two different sources in `handleAutoImportPatchHeaders` is a repeatable mistake class.** `orderDateTime` and `obdEmailDate` must both be written from the same merged `newDT` value (§12.1) — a raw/unmerged source on one of the pair silently strips its time back to midnight. Fixed once (commit `3c0cd366`); watch for the same pattern if this function is edited again.

---

## 15. Open items / future work

- **Cross-source orphan policy — NOW LIVE-RELEVANT, still undecided.** Auto-Import IS running (since 2026-06-20), so the deferred question is active daily: when a SAP authoritative re-import follows an auto-json create on the same OBD, the v2 `lineId` (real SAP item numbers) vs composite-key interplay decides what gets orphaned. Options unchanged: (a) accept as cleanup · (b) one-time lineId backfill · (c) keep auto non-authoritative and let manual-sap rebuild the line set. The old "deferred until un-paused" framing is void — it un-paused six weeks before anyone re-read this line.
- **Weight diff in audit log.** Currently skipped to keep audit-log noise low. Re-add if depot ops needs weight-change tracking.
- **`articleTag` rule for ZINR.** Today the row is included with a breadcrumb warning. If business semantics emerge for ZINR articleTags, implement the rule and remove the warning.
- **Old SAP layout shim** if SAP ever ships the old layout again (e.g. depot-level legacy). Not built today.
- **Auto-Import patch path.** Today Auto-Import is create-only. If Auto-Import ever needs to patch existing OBDs (e.g. for late-update detection), the path needs to go through `upsertObd` like manual SAP does, with `LINE_AUTHORITY['auto-import'] = 'authoritative'`. Big change — full re-audit needed.
- ~~Auto-Import v2 — steps 4–10 not yet built~~ — **SHIPPED, see §10.1** (corrected 2026-08-04). Design doc now at `docs/prompts/archive/2026-06/web-update-2026-06-20-auto-import-v2-pure-json.md` (was in drafts/).
- **`IMPORT_HMAC_SECRET_JSON`** is in Vercel and working (live auto-json batches authenticate daily). `IMPORT_HMAC_SECRET` (v1 var) stays until the v1 `?action=auto` handler is retired — which is now a real candidate: zero batch evidence ever (§9/§10). Retiring it is an owner decision, not a cleanup.
- **lineId semantic change in v2.** v1 used ordinal positions (10/20/30); v2 uses real SAP item numbers. This means composite key `lineId|skuCodeRaw` will NOT match between a v1 create and a v2 patch. Create-only policy makes this safe, but if patch path ever becomes needed for Auto-Import, re-audit the key strategy.
- **The new same-day/different-day arrival-slot rule is designed but NOT built** (§12.2). The live fork in `applyMailOrderEnrichment` still uses the old `receivedAt` vs `punchedAt` comparison. Building it is a single-site edit once picked up — see §12.2 for the full rule and the acceptance check (OBD `9108192224`).

---

## Change log — v1.7 (2026-08-04 reconciliation pass, method v1.1)

Evidence: `import_batches` SELECTs (timestamps naive-UTC-corrected), the repo script copies, `route.ts` read at the call sites, git log. Claim IDs from the session report.

- IMP-1 (§1/§2/§10): the MECHANISM corrected — the live auto path is the v2 pure-JSON pipeline (`Auto-Import-v2.ps1` → `?action=auto-json` + `patch-headers`/`pending-invoices`, HMAC `auto-import-json-v1`); the "multipart payload" wording survived the 2026-08-03 status fix. Zero v1 batches exist in the whole table.
- IMP-2 (§1): primary-user list rebuilt from live grants (operations + operation_manager in; dispatcher/support were seed-only).
- IMP-3 (§3.2): v1 XLSX layout re-labelled HISTORICAL.
- IMP-4 (§9): dispatch snippet + action table updated — five HMAC actions live before session auth; "[PLANNED — v2]" rows were shipped code.
- IMP-5 (§10): cadence stated from data — batches 08:15–22:52 IST, median same-day gap ~20 min, no Sunday batches; scheduler config itself marked unverifiable from the depot PC.
- IMP-6 (§10): today's-batches re-check resolved — auto-json batch 2026-08-04 15:07 IST (14 OBDs); the morning zero was timing, not a stall.
- IMP-7 (§10.1): build-sequence table corrected — all steps SHIPPED; patch-headers/pending-invoices noted as shipped beyond the locked design.
- IMP-8 (§12.1): retired Support board no longer named as a live display consumer.
- IMP-9 (§12.1b): NEW — punch-clock guard (`03b6dd19`→`dee603dc`; 5,517/9,521 fake-midnight audit) + patch-headers Step B dispatch-window repair (`ab70c826`).
- IMP-10 (§14): landmines updated — create-only wording now covers the patch-headers exception; NEW naming-trap landmine (Auto-Import.ps1 "v2.0" is the v1 script); NEW naive-UTC `createdAt` conversion trap.
- IMP-11 (§15): open items — v2 build rows closed; orphan-policy item re-framed as live-relevant; HMAC_JSON var confirmed working; v1 handler flagged as a retirement candidate (owner decision).
- §12.2 verified still NOT built (the fork still compares `receivedAt` vs `punchedAt` — `route.ts:322-331`); left as-is deliberately.

- Schema stamp -> v27.13 (final-pass 12b, 2026-08-05).

---

*Import v1.7 · Schema v27.13 · OrbitOMS · updated 2026-08-04*
