# CLAUDE_IMPORT.md — OrbitOMS Import Pipeline
# v1.11 · Schema v27.24 · September 2026 · updated 2026-09-18 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Covers the SAP/OBD import pipeline end-to-end: the four import sources (manual SAP .xlsx, SAP clipboard paste, manual template, Auto-Import — **LIVE**, §10), the shared upsert utility the two SAP sources funnel through, the no-mail-order auto-release every source ends with (§2.1), the anomaly guard (§8.3), schema, filters, and downstream consumers.

Primary users (live `import_obd` grants, SELECT 2026-08-04 — CORE §5): admin, billing_operator, tint_manager, operations (granted 2026-08-01, `c8f8d020`), operation_manager. ⚠ dispatcher and support are **seeded** for this key but **all-false live** — this line named them as users until 2026-08-04; that was seed, not reality. ⚠ Access mode is `user` (live 2026-09-18, Q02), so who may import is decided per PERSON by the Import OBDs tick (`import_obd` canImport) — the only rule since `792efc52` (§9). The role list above is the 2026-08-04 role-grant read, not the gate.

---

## 1. What this module is

OrbitOMS receives Outbound Deliveries (OBDs) from SAP through four sources (`components/import/import-modal.tsx:44` `type Format = "sap-paste" | "sap" | "manual-template"`, plus the machine path):

- **SAP clipboard paste** — the operator copies SAP's on-screen OBD list and pastes it into the Import window. **The window's DEFAULT format** (`import-modal.tsx:108` `useState<Format>("sap-paste")`, reset to it at `:130`). Actions `sap-paste-preview` / `sap-paste-confirm` (commit `37ceb57a`, §3.4). Same report, same authority as the .xlsx — `ImportSource "manual-sap"` (§6).
- **Manual SAP** — operator uploads a SAP OBT export `.xlsx` via the Import window's "SAP" format or the `/import` page. Preview-then-confirm with optional bypass for fast batches.
- **Manual template** — the Import window's third format (`import-modal.tsx:707`), posting `?action=preview` then `?action=confirm` (`:515`, `:531`). Live and user-reachable, not a legacy leftover.
- **Auto-Import** — scheduled background pull on the **import PC** (a separate machine — task state and trigger config are unverifiable from the depot PC; DB batch markers are the ground truth). **LIVE and running** (resumed 2026-06-20; the "paused as of 2026-05-14" claim was corrected 2026-08-03, and the MECHANISM line corrected 2026-08-04): **it is the pure-JSON pipeline** — the depot script fetches Breakwalls JSON, HMAC-signs with `auto-import-json-v1` (`IMPORT_HMAC_SECRET_JSON`), and POSTs to `?action=auto-json`, plus the `check` pre-filter, the `day-obds` count and the `patch-headers`/`pending-invoices` invoice+clock sweep. **Every one of the 944 batches 2026-06-20→08-03 (3,876 OBDs) carries the `[auto-import] auto-json` marker; the v1 multipart path (`?action=auto`) has ZERO batches in the entire table.** The old "HMAC-signs a multipart payload" wording survived the 2026-08-03 status correction — status and mechanism were two separate stale claims. Two tracked repo copies post to that path: `docs/Powershell/Auto-Import-v2.ps1` and `docs/Powershell/Auto-Import-v3.ps1` (tracked since `eb34532c`, 2026-09-08). **v3 is PROBABLY what runs — UNVERIFIED:** `docs/ROADMAP.md` ("⚠ Canon is stale on the auto-import cadence") records live batch gaps of 1–5 min that v2's fixed ~10-min cycle cannot produce, and the ten volume-zero header-only bills match a rule only v3 has (§8.3). Only the import PC can confirm which file is scheduled (a copy is a claim, not proof it is deployed unmodified). The v1-mechanism copies (`docs/sample/Auto-Import.ps1`, `docs/Parser/Auto-Import.ps1`, `docs/Powershell/Auto-Import.ps1` — all titled "v2.0", all posting to the old `orbit-oms.vercel.app` domain) are historical; see §14's naming-trap landmine.

The two SAP sources (.xlsx and paste) converge at `upsertObd()` (`lib/import-upsert.ts:92`) — the shared brain that owns create-vs-patch decisions, line-level diff, soft-remove cascades, audit logging, and downstream-effect signalling. Auto-Import (`processAutoImportRows`) and the manual template (`handlePreview` + `handleConfirm`) create their bills inline in `app/api/import/obd/route.ts`; they call `upsertObd` only from the shadow runners (`route.ts:2790`, `:3089`, `IMPORT_SHADOW_MODE`, default off).

**Every source ends the same way:** mail-order enrichment first, then the no-mail-order fallback (§2.1) releases every new non-tint bill that no mail order spoke for straight to `pending_picking`. No bill waits for a person to release it (`b3dfe5b8`, 2026-09-11).

Scale: ~100–200 OBDs/day per CORE §1. Single-depot deployment.

Downstream consumers: `orders` rollup, `import_obd_query_summary` cache, `applyMailOrderEnrichment()` hook (CLAUDE_MAIL_ORDERS.md §7), the no-mail-order fallback (§2.1), challan auto-creation (CLAUDE_TINT.md §9.1), Floor Control (CLAUDE_FLOOR.md), Tint Manager, picking (CLAUDE_PICKING.md).

---

## 2. Pipeline overview

```
SAP paste path (the Import window's DEFAULT format, §3.4) and Manual SAP (.xlsx) path:
  Operator → header Import window (or the /import page — .xlsx and template, no paste)
    → POST ?action=sap-paste-preview  (JSON { block, obdEmailDate }, 4,000,000-char cap)
         → parseSapPaste → readPaste → groupRows → applyRules → buildObds
      or ?action=manual-sap-preview   (10MB cap, .xlsx)
         → parseSapFile(buffer, { fallbackObdEmailDate })
         → readSheet → groupRows → applyRules → buildObds
    → preview UI: per-OBD outcome (new / patch / skipped / error) + issues
  Operator → click Confirm Import (from the window, the write runs in the header pill, §11)
    → POST ?action=sap-paste-confirm | ?action=manual-sap-confirm
    → re-parse → for each ObdInput: upsertObd(input, "manual-sap", …)
        → createPath OR patchPath
    → caller dispatches DownstreamEffect[] returned by upsertObd:
        applyMailOrderEnrichment  (matches mo_orders.soNumber)
        createChallanForOrder     (Retail Offtake / Decorative Projects only)
        rebuildQuerySummaryForOrder
        + customer-resolved / order-type-mismatch signals
    → applyNoMailOrderFallback(every non-errored OBD of the batch)   (§2.1)

Manual-template path:
  → POST ?action=preview  (handlePreview — the real ingest: batch + raw rows + qty guard, §8.3)
  → POST ?action=confirm  (handleConfirm — creates orders)
    → applyMailOrderEnrichment → applyNoMailOrderFallback (§2.1)

Auto-Import path (LIVE — the pure-JSON pipeline, §10; mechanism corrected 2026-08-04):
  Scheduler on the import PC → Auto-Import-v3.ps1 (probably; every 1 min, mode-based)
                               or Auto-Import-v2.ps1 (~10 min) — §10
    → Breakwalls JSON (no Excel files anywhere)
    → POST ?action=day-obds / ?action=check (HMAC v2) — what is missing / new?
    → POST ?action=auto-json       (HMAC v2, auto-import-json-v1 / IMPORT_HMAC_SECRET_JSON)
    → middleware bypasses session (HMAC verified by the handler)
    → handleAutoImportJson → processAutoImportRows(…, "auto-json", skipEmptyPayloadObds=true)
    → empty payload + volume > 0 → OBD NOT created, retried next cycle;
      volume 0 → header-only import on purpose (§8.3)
    → bulk createMany (CREATE-only for lines: existing OBDs skipped at ingest)
    → applyMailOrderEnrichment → applyNoMailOrderFallback (§2.1)
  Invoice pass, same script:
    → POST ?action=pending-invoices — OBDs in the window with invoiceNo null
    → POST ?action=patch-headers    — null→value invoice fill + clock repair +
                                      dispatch-window repair (§12, Step B)
```

Manual SAP and paste exercise both create and patch paths. The auto-json ingest is **create-only for lines** — an existing OBD is skipped entirely at ingest; the ONLY writes to existing OBDs from the auto pipeline go through the separate `patch-headers` action (null-only invoice fill + clock/slot/window repair, §12). Neither auto action ever reaches `applyLinePatch`.

### 2.1 The no-mail-order fallback — every bill released on import [LIVE, `b3dfe5b8`, 2026-09-11]

**This file owns this behaviour.** Other canon points here.

`applyNoMailOrderFallback(obdNumbers)` (`app/api/import/obd/route.ts:554`). Mail-order enrichment is the
only thing that copies a `dispatchStatus` onto a new bill, and only when a `mo_orders` row matches its
SO number. This function releases the bills no mail order spoke for.

**Which bills qualify** — one `orders.findMany` (`route.ts:566-585`), all of:
`obdNumber IN <the batch>` · `workflowStage = "pending_support"` · `dispatchStatus = null` ·
`orderType ≠ "tint"` · `isRemoved = false`. So a mail-matched bill (already moved by enrichment), a
held bill (`dispatchStatus = "hold"`), a tint bill and a removed bill never qualify. Tint bills
release themselves on completion — `CLAUDE_TINT.md §2`.

**What it writes, per bill — exactly ONE `orders.update` and ONE `order_status_logs.create`:**
- `orders.update` (`route.ts:643-650`): `dispatchStatus: "dispatch"`, `workflowStage: SUPPORT_DONE_OUTPUT`
  (`= "pending_picking"`, `lib/workflow-stages.ts:61`), plus the slot fields when the engine gives one.
  One write so the `MAX(orders.updatedAt)` live-sync markers fire once (CORE §3).
- `order_status_logs.create` (`route.ts:655-663`): `pending_support → pending_picking`,
  `changedById: 1`, note **`"Auto-dispatched on import (no mail order for this bill)"`** — deliberately
  not enrichment's "Auto-dispatched by enrichment" note, so the two paths stay tell-apart in the log.

**The slot:**
- **Engine slot** — `evaluateDispatchSlot` (`lib/dispatch/dispatch-engine.ts`) with `dispatchStatus:
  "dispatch"` passed in (the value this same update writes; the WHERE clause already proved the bill is
  not held) and the clocks from `resolveArrivalClocks(orderDateTime, obdEmailDate)` (§12.1b). On
  `assigned`, writes `dispatchTargetDate`, `dispatchWindowId` (looked up by `windowTime` from the active
  `dispatch_slot_master` rows, loaded once per batch, `route.ts:560-564`), `dispatchSlotRuleId` and
  `dispatchSlotSource: "auto"` (`route.ts:614-622`). A `windowTime` with no active row releases the bill
  with no slot and a `console.warn`.
- **A manual slot is preserved** — when `dispatchSlotSource === "manual"` the engine is not called and no
  slot field is written (`route.ts:597`). Floor's Change slot writes that source without a status, so
  such a bill needs only the release.
- **A decline leaves the slot NULL** (`route.ts:628-639`) — the bill is still released and shows "no
  slot" on the boards. No "today plus the next window" default.
- **The SMU gate** — `evaluateDispatchSlot` declines `smu-not-deco-retail` for any `smu !== "Deco
  Retail"` (`dispatch-engine.ts:144-145`). It is unchanged, so Decorative Projects, Retail Offtake,
  Distributor and no-SMU bills are released with no engine slot. The function's own header comment
  (`route.ts:520-528`) measures this at ~12.5 of ~23.7 released bills a day (30 days to 2026-09-10) and
  records widening the gate as an owner decision, not a bug.

**The four call sites** — each runs AFTER `applyMailOrderEnrichment`, keyed on `obdNumber` (not
`soNumber`, so bills with no SO number are reached):

| Call site | Handler | Source |
|---|---|---|
| `route.ts:1423` (STEP D1c) | `handleConfirm` | manual template |
| `route.ts:2017` (after the effect loop) | `handleManualSapConfirm` | manual SAP .xlsx |
| `route.ts:2562` (after the effect loop) | `handleSapPasteConfirm` | SAP paste |
| `route.ts:3869` (CONFIRM D1c) | `processAutoImportRows` | `?action=auto` and `?action=auto-json` |

The two SAP call sites pass every non-errored result (`results.filter(r => r.outcome !== "errored")`),
so a patched or unchanged OBD still at `pending_support` with a null status is released too.

⚠ **"A late mail order cannot happen" is an owner statement recorded in the function's header
(`route.ts:534-538`, 2,498 of 2,498 pairs in 30 days had the mail order first).** If that ever stops
being true, a later `hold` would find the bill already released.

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

REQUIRED_COLS (read-sheet.ts:52-57): `[delivery, warehouse, division, soldToParty, shipToParty, referenceDoc, deliveryType, itemCategory, item, material, deliveryQty]`. Optional positions (`volume`, `netWeight`, `totalWeight`, `batch`, name fields, `storageLocation`) may legitimately be blank on individual rows.

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

### 3.4 SAP clipboard paste — the screen list [LIVE, `37ceb57a`, 2026-09-14]

The operator copies SAP's on-screen OBD list (the same 19 columns as §3.1, pipe-ruled) and pastes it.
**The paste is the Import window's default format** (§1).

**Routes** (`app/api/import/obd/route.ts`), both after the session gate (§9) and both gated by
`SAP_IMPORT_ENABLED` exactly as the .xlsx handlers (`route.ts:2203`, `:2356`):

| Action | Handler | Notes |
|---|---|---|
| `sap-paste-preview` | `handleSapPastePreview` (`:2202`) | Read-only. Same `SapPreviewResponse` as the .xlsx preview, plus `unresolvedCustomers` |
| `sap-paste-confirm` | `handleSapPasteConfirm` (`:2355`) | The write. A copy of `handleManualSapConfirm` with its differences marked in the code (`:2350`) |

- Body: JSON `{ block, obdEmailDate }`, parsed by `parseSapPasteBody` (`:2160`). The screen list has no
  date column, so `obdEmailDate` defaults to today in the UI, as for the file.
- **`SAP_PASTE_MAX_CHARS = 4_000_000`** (`:2138`) → a **413 as JSON** (`:2176-2179`), because Vercel's own
  body limit answers with a non-JSON 413.
- A paste that cannot be read returns 400 `SapPasteBlockedResponse` (`lib/import-types.ts:117`) and writes
  nothing.
- `ImportSource` stays **`"manual-sap"`** (`upsertObd(input, "manual-sap", …)`, `route.ts:2494-2495`) —
  same report, same `LINE_AUTHORITY` (§6). The batch is told apart only by its `[sap-paste]` `headerFile`
  prefix (`route.ts:2389`, §4).

**The library — `lib/sap-paste/`:**

| File | What | Pure? |
|---|---|---|
| `read-paste.ts` | `readPaste(block)` (`:165`) → `ReadPasteResult` (`RawSapRow[]` + per-line errors). ANY error blocks the paste | **Pure, sync** — client-importable (the modal runs it for its live summary) |
| `index.ts` | `parseSapPaste(block, { fallbackObdEmailDate })` (`:42`) — `groupRows` → `applyRules` → `buildObds` from `lib/sap-parser/` unchanged, mirroring `parseSapFile` | **Async** — `buildObds` reads the catalog. Never import `@/lib/sap-paste` from a client component; import `@/lib/sap-paste/read-paste` |
| `resolve-names.ts` | `resolvePasteCustomerNames(obds, createObdNumbers)` (`:72`) — one `delivery_point_master.findMany` | **DB read** |

**🔴 The item-number conversion — runs on the RAW TEXT, before `applyRules`** (`readPaste`, PASS 3,
`read-paste.ts:248-283`). A picked batch sub-row is `"001"` on the screen and `900001` in the .xlsx and
from auto-import. `/^0\d{2}$/` and > 0 → `900000 + value` (`SUB_ITEM_BASE`, `:88`); any other leading-zero
token → error; an un-padded value that is not a multiple of 10, or ≥ 100 in a delivery holding a sub-item
token ≥ `090` (`HIGH_SUB_THRESHOLD`, `:96`) → ambiguity error. **Ambiguity is always an error, never a
guess.** Unconverted, `"028"` would be item 28: rule P (§8, 7a) would never fire, and on the patch path
`makeKey` (§6) would never match the stored `900028|SKU`, so the authoritative branch would soft-remove
and re-add every picked line.

**🔴 Customer names — the width trap** (`resolve-names.ts`, create path only). The screen prints the two
name columns at fixed widths — 22 (sold-to) and 25 (ship-to) (`PASTE_NAME_WIDTHS`, `read-paste.ts:35`;
`WIDTH`, `resolve-names.ts:28`). A cut name arrives at WIDTH−2 or WIDTH−1 characters; a name exactly
WIDTH long is complete. So **length only decides whether to LOOK** (`needsLookup`, `text.length >= WIDTH - 2`);
the **starts-with test decides whether to REPLACE**: the master name replaces the pasted text only when,
case- and whitespace-normalised, it starts with it AND is longer. Equal → kept silently. Code not in
`delivery_point_master` → kept, reported as `not-in-master` (the only kind the operator sees, as
`unresolvedCustomers`, de-duplicated by code — `unresolvedPasteCustomers`, `route.ts:2147`); otherwise
kept as `no-match`. The starts-with guard is what stops counter code `899199` (one institutional master
label, many walk-in SAP names) renaming every counter sale — **do not hardcode a code.** The patch path
needs none of this: `header.ts` only fills a NULL `shipToCustomerName` and never patches bill-to.

Evidence for the conversion, the name rule and the fixture comparison:
`docs/prompts/drafts/code-update-2026-09-14-sap-paste-import.md` §2, §3, §5.

---

## 4. Schema (import tables)

### import_batches

```
id, batchRef (UNIQUE, retry-safe), importedById (FK users),
headerFile, lineFile, totalObds, skippedObds, failedObds,
status, createdAt, updatedAt
```
*(schema.prisma:787-802, verified 2026-09-18)*

`batchRef` collisions hit a P2002 retry pattern (`createBatchWithRetry`).

⚠ **THERE IS NO `source` COLUMN.** Until 2026-09-14 this block listed `source ('manual-sap'|'auto-import')`,
plus `fileName`, `fileSize`, `uploadedById`, `errorMessage` and `completedAt` — none of which exist.
**Source is readable ONLY from the `headerFile` PREFIX**, written by each confirm handler:

| Prefix | Written by | Example |
|---|---|---|
| `[auto-import] auto-json` | `processAutoImportRows` (`?action=auto-json`, `route.ts:3327`) | `[auto-import] auto-json` |
| `[manual-sap]` | `handleManualSapConfirm` (`route.ts:1839`) | `[manual-sap] EXPORT 12.09.XLSX (obdEmailDate: 2026-09-12)` |
| `[sap-paste]` | `handleSapPasteConfirm` (`route.ts:2389`) | `[sap-paste] clipboard 546 rows (obdEmailDate: 2026-09-14)` |
| `[<templateId>]` | `handlePreview` — manual template (`route.ts:928`) | `[combined_v2] <file name>` (`ImportTemplateId`, `lib/import-templates.ts:1`) |

**The `⚠` suffix.** When the anomaly guard (§8.3) records anything for a batch, `writeImportAnomalies`
rewrites `headerFile` as `<original label> ⚠ <parts>` (`lib/import-qty-guard.ts:249-255`), each part
`qty-mismatch xN: …`, `empty-skip xN: …` or `header-only xN: …` — e.g.
`[auto-import] auto-json ⚠ qty-mismatch x1: <obd>(<declared>→<observed>)` (`labelPart`, `:126`). Only auto and manual-template batches can
carry it. The prefix is untouched, so prefix filters still match.

Filter with `"headerFile" LIKE '[sap-paste]%'` etc. — in Postgres `LIKE`, `[` is a literal. ⚠ A paste
batch's per-OBD audit notes still read `via manual-sap batch BATCH-…` (its `ImportSource` is
`"manual-sap"`, §6), so the batch's `headerFile` is the ONLY place a paste is distinguishable.

**`status`** — the code writes `processing` → `completed` | `failed` (the old `'success'|'error'` never
existed). Live SELECT 2026-09-14: every persisted row is `completed` (2,421 auto-import · 570 manual-sap ·
2 sap-paste).

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

Relations: `enrichedLineItem` (0..1 — unique FK, but many raw lines have none; see below), `splitLineItems` (1:N), `challanFormulas` (1:N), `tinterIssueEntries(_b)` (1:N).

### import_enriched_line_items

At most one row per raw line — `rawLineItemId @unique` guarantees **no more than one**, not one.
Duplicate-SKU raw rows that do get enriched each get their own row.

⚠ **NOT 1:1 with raw lines.** Only two writers exist, both in `app/api/import/obd/route.ts` and both
for bills the handler has just CREATED: `handleConfirm` STEP D5 (`:1599`, manual template) and
`processAutoImportRows` CONFIRM D5 (`:4038`, auto). The two SAP sources never write it — neither
`handleManualSapConfirm`, `handleSapPasteConfirm` nor anything in `lib/import-upsert*` touches the table
(no match for "enriched" under `lib/import-upsert.ts` / `lib/import-upsert/`), and a line ADDED by the
patch path (`applyLinePatch`, `lib/import-upsert/lines.ts:187`) gets a raw row only. So every bill
created by manual SAP or paste has no enriched rows, and a line manual SAP adds to an auto-created bill
has none either. Both live readers — `app/api/orders/[id]/detail/route.ts:107` (drives `lineItems` off
this table, so such a bill returns an empty list) and `app/api/orders/[id]/removed-lines/route.ts:60`
— are fetched only by `components/shared/order-detail-panel.tsx`, which has no live importer. **Never
drive a new reader off this table**; read `import_raw_line_items`. Diagnosis:
`docs/prompts/drafts/code-discovery-2026-09-08-enriched-line-gap.md`.

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

INSERT-ONLY analysis log. **Written today by the anomaly guard** (§8.3): `writeImportAnomalies`
(`lib/import-qty-guard.ts:215`, one `createMany` per batch) called from `handlePreview` (`route.ts:1093`,
`source "manual-template"`) and `processAutoImportRows` (`route.ts:3570`, `source "auto-import"`), with
`shadowOutcome` ∈ `qty_mismatch` / `empty_payload_skipped` / `header_only_allowed`, `actualOutcome` ∈
`imported` / `skipped`, the numbers in `decision` and the note in `errors`. The original shadow-mode
writers (`runManualTemplateShadow`, `runAutoImportShadow`, `route.ts:2855`, `:3140`) remain gated by
`IMPORT_SHADOW_MODE` (default off).

```
batchId, obdNumber, source
actualOutcome, shadowOutcome, decision (JSON)
errors, createdAt
indexed on (batchId), (obdNumber), (createdAt)
```

---

## 5. Parser package — lib/sap-parser/

⚠ **NOT a pure module — corrected 2026-09-14.** Until then this line read "Pure synchronous module. No DB
access", which has been false since **2026-08-09**: `buildObds` reads the `sku_master_v2` pack catalog
from the database (`loadPackCatalog`, `build-obd.ts:33,47`) to resolve `article`/`articleTag` (§8.2), and
that is why `parseSapFile` is `async`.

| Stage | Pure? |
|---|---|
| `readSheet` (`read-sheet.ts`) — and the paste counterpart `readPaste` (`lib/sap-paste/read-paste.ts`, §3.4) | **Pure, synchronous** — no DB, no HTTP, no clock |
| `groupRows` (`group-rows.ts`) | **Pure, synchronous** |
| `applyRules` (`apply-rules.ts`) | **Pure, synchronous** |
| `buildObds` (`build-obd.ts`) | **NOT pure — async, ONE catalog `findMany` per file**, then no per-line I/O |

Still true: no HTTP, no `Date.now()`, no writes, and deterministic given the same input,
`fallbackObdEmailDate` **and the same catalog rows**. A file/paste costs one query, not one per line.

Files:
- `index.ts` — entry point. `parseSapFile(buffer, options) → Promise<ParseResult>` (async, for `buildObds`). Orchestrates `readSheet → groupRows → applyRules → buildObds`. Computes file-level invariant `createdObds + skippedDeliveries === uniqueDeliveries`; emits `stats-mismatch` warning on failure (no throw).
- `read-sheet.ts` — opens workbook via `xlsx` package, validates header width, converts data rows to `RawSapRow[]`.
- `group-rows.ts` — buckets rows by delivery. Skips short-delivery non-LF returns (`delivery.length < 10 && deliveryType !== "LF"`) with reason `"non-LF return"`.
- `apply-rules.ts` — `applyRules()` (`:106`): D.2 all-ZZRE skip, then rule P's pre-pass, then the per-row filter loop. Rules 0/E/1/J.3/J.4 have ONE implementation, `classifyRow()` (`:70`), shared by the pre-pass and the loop (`a290c116`); rule P (`BATCH_SUB_ITEM_FLOOR = 900000`, `:47`) is §8 item 7a. **NO grouping** — every surviving row becomes one DB row (2026-05-14 change, dropped SKU-summing logic).
- `build-obd.ts` — `buildObds()` (`:33`) emits `ObdInput[]` from filtered rows and computes `article`/`articleTag` per line (`computeArticleInfo`, `:126`). Auto-sums line `totalWeight` into summary `grossWeight`. Auto-sums `volumeLine` into summary `volume`.
- `cells.ts` — typed cell coercers `toStr`, `toNum`, `toInt`, `toStrOrNull` (`:8`, `:14`, `:21`, `:32`).
- `types.ts` — `ParseOptions`, `ParseResult`, `SkippedRow`, `WarningKind`, `Warning`, `RawSapRow`, `KNOWN_ITEM_CATEGORIES`, `FileParseError`, `FileFormatError`. `SkippedRow.reason` is `"non-LF return" | "all-lines-ZZRE" | "no-valid-lines" | "non-LF row" | "parent item superseded by batch sub-items"` (`:39-48`). (`LineInterim` lives in `apply-rules.ts`; `ObdInput` in `lib/import-upsert/types.ts`.)

### Column constants

In `read-sheet.ts:21` — a **non-exported, 1-based** map:
```ts
const COL = {
  delivery:        1,
  warehouse:       2,
  storageLocation: 3,
  division:        4,
  soldToParty:     5,
  soldToName:      6,
  shipToParty:     7,
  shipToName:      8,
  referenceDoc:    9,
  deliveryType:   10,
  itemCategory:   11,
  item:           12,
  material:       13,
  description:    14,
  deliveryQty:    15,
  volume:         16,
  netWeight:      17,
  totalWeight:    18,
  batch:          19,
} as const;
```

### LineInterim shape

`apply-rules.ts:79` (article/articleTag are added later, by `buildObds`):
```ts
{
  lineId:            number;
  skuCodeRaw:        string;
  skuDescriptionRaw: string | null;
  batchCode:         string | null;
  unitQty:           number;
  volumeLine:        number | null;
  netWeight:         number | null;
  totalWeight:       number | null; // also aggregated to OBD-level grossWeight
  isTinting:         boolean;
  itemCategory:      string;        // raw, kept for OBD-level diagnostics
  parentRowNumber:   number;        // source row number
}
```

---

## 6. Upsert brain — lib/import-upsert/

Planner vs executor split. The planner reads existing state and produces a plan; the executor applies the plan and emits downstream effects.

### Files

- `lib/import-upsert.ts` — entry wrapper (there is no `lib/import-upsert/index.ts`). Exports `upsertObd(input, source, batchId, batchRef, userId, now, options = {}) → Promise<UpsertResult>` (`:92`). Branches: `createPath` (`:143`, no existing order) vs `patchPath` (`:302`). `createPath` also calls `createMany` on lines (`:240`), passing `netWeight` + `totalWeight`. Re-exports the public types plus `CHALLAN_ELIGIBLE_SMU`, `DIVISION_TO_SMU`, `LINE_AUTHORITY` and three helpers.
- `lib/import-upsert/types.ts` — `ImportSource`, `ObdInput`, `ObdLineInput`, `UpsertOptions` (`dryRun`, `preloaded`), `UpsertResult`, `UpsertOutcome` = `"created" | "patched" | "unchanged" | "errored"` (`:84`), `DownstreamEffect` with `EffectType` (`:71-76`); constants `DIVISION_TO_SMU`, `SMU_CODE_BY_NAME`, `LINE_AUTHORITY`, `CHALLAN_ELIGIBLE_SMU`. There is no `UpsertContext`.
- `lib/import-upsert/state.ts` — `loadExistingObd(obdNumber)` (`:17`) returns `{ order, summary, lines: ExistingLine[] }`; also `resolveCustomerId()` (`:59`). Lines `SELECT` does NOT include `netWeight`/`totalWeight` (see §14 landmines).
- `lib/import-upsert/lines.ts` — `patchLines()` (pure planner, `:49`) + `applyLinePatch()` (executor, `:178`). Composite-key keyed: `makeKey(lineId, skuCodeRaw)` (`:28`). Inserts new lines via `createMany` (`:187`), updates existing in-place, marks orphans `lineStatus = "removed_by_import"` (literal string, never change).
- `lib/import-upsert/header.ts` — `patchHeader()` (pure planner, `:41`) + `applyHeaderPatch()` (executor, `:152`). Per-field diff. Skips no-ops. Has **no** `totalUnitQty` / `grossWeight` / `volume` handling at all (Defect B, §15).
- `lib/import-upsert/effects.ts` — `buildEffects()` (`:47`). Effect kinds (`EffectType`): `mail-order-enrichment`, `challan-create`, `query-summary-rebuild`, `customer-resolved`, `order-type-mismatch`. The confirm handlers loop the returned effects themselves.
- `lib/import-upsert/helpers.ts` — `resolveSmuFromDivision`, `resolveSlotFromTime`, `mergeEmailDateTime`, `fmt`.
- `lib/import-upsert/audit.ts` — `formatAuditNote()` + `writeAuditLogs()` (`:33`), a `createMany` into **`order_status_logs`** (`:40`). It does not write `import_shadow_log`.

### `SMU_CODE_BY_NAME` — this file owns it

`lib/import-upsert/types.ts:243` — SMU name → SAP division code, the inverse of `DIVISION_TO_SMU`
(`:207`), kept directly beside it (edit the two together). Includes `"Deco" → "10"`, which the forward
map deliberately lacks (the header comment explains why). Exists because `orders` carries only the SMU
name. Live callers: `lib/ci/queries.ts:740`, `:881` · `lib/floor/queries.ts:1049` ·
`lib/picking/queue.ts:882` · `lib/picking/colour-work-query.ts:60` · `lib/picking/tint-workload.ts:384`
(plus comment-only mentions in `lib/ci/types.ts`, `lib/ci/workbook.ts`, `lib/picking/colour-work.ts`,
`lib/picking/types.ts`, and two `scripts/_chk-*` scratch files).

### The composite key

`makeKey(lineId: number, skuCodeRaw: string): string` returns `` `${lineId}|${skuCodeRaw.trim()}` `` (`lines.ts:28-29`) — the SKU is trimmed, never case-folded.

Why composite: SAP can emit two rows with the same SKU but different `lineId` (and possibly different batches). Pre-2026-05-14 the parser grouped by SKU and summed; that lost the row-level data. After the rewrite, both incoming and existing maps key on `lineId + "|" + skuCodeRaw` so duplicate-SKU pairs are preserved across re-imports.

### LINE_AUTHORITY map

```ts
// lib/import-upsert/types.ts:10 and :256-260
export type ImportSource = "auto-import" | "manual-template" | "manual-sap";

export const LINE_AUTHORITY: Record<ImportSource, boolean> = {
  "auto-import":     false,
  "manual-template": false,
  "manual-sap":      true,
};
```

*(Corrected 2026-09-14. This block showed a two-value `ObdSource` and a `"authoritative" | "non-authoritative"`
STRING map; the code has had THREE sources and a BOOLEAN map. There is no type named `ObdSource`.)*

`true` (authoritative): the source can overwrite `unitQty`/`volumeLine`/`isTinting`, restore soft-removed
lines, and mark orphan lines `removed_by_import`. `false`: adds new lines and fills a NULL `volumeLine` only;
orphans left alone.

⚠ **The SAP paste import (2026-09-14) deliberately passes `"manual-sap"`** — it is the same SAP report, so it
must carry the same authority. It did NOT add a fourth value. Its batches are told apart by the
`[sap-paste]` `headerFile` prefix (§4).

In practice Auto-Import never reaches `applyLinePatch`: it is LIVE but CREATE-ONLY (§2, §10), so its `false`
entry is not exercised. *(This line said "until Auto-Import resumes" — it resumed 2026-06-20.)*

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
7a. **Rule P — parent superseded by batch sub-items** (`25fc3c99`, hardened `a290c116`, 2026-09-08;
   `apply-rules.ts`). A row with `item < 900000` (`BATCH_SUB_ITEM_FLOOR`) is dropped when the SAME
   delivery holds a row at `item ≥ 900000` for the SAME `skuCodeRaw` **that itself survives rules
   0/E/1/J.3/J.4** (the shared `classifyRow()`, so a discarded sub-item never supersedes its parent).
   **Not silent**, unlike rule 5: it pushes to `skipped[]` with the visible reason
   **`"parent item superseded by batch sub-items"`** (`types.ts:46`), shown in the preview's issues and
   counted in `import_batches.skippedObds`. A low-numbered row with no sub-item sibling for its SKU is
   real stock and untouched. Why: OBD `9109269668` (2026-09-07) stored the parent's 26 units twice. ⚠ A
   rule-P skip is ROW-level but adds 1 to `totalObds` and `skippedObds` and a second preview card, the
   same shape as `"non-LF row"` (`docs/ROADMAP.md` → Import Pipeline → P3).
8. **Unknown item category** → row INCLUDED with `unknown-item-category` warning; `isTinting` defaults to `false`.
9. **ZINR breadcrumb** → row included; emits `zinr-article-tag-pending`. ⚠ **The warning text is now stale** — it says "needs articleTag rule (deferred)", but since 2026-08-09 ZINR rows resolve a tag through the same rule as every other category (§8.2). Left in place deliberately (it gates nothing and is preview-only) rather than removed in a change that was about the tag rule; retire it in its own pass.
10. **D.3 — no surviving lines.** Skipped with `"no-valid-lines"`.

**Unknown SKU is NOT dropped at import.** Line lands with `skuCodeRaw` set and is flagged via the
`note` field (§8.1), never discarded. Surfaced in mail-orders enrichment + order detail UI.

### 8.2 The article / articleTag rule — `lib/article-tag.ts` [LIVE, 2026-08-09]

**Before this file the rule did not exist in this repo.** It lived only on the depot PC, as
`Get-ArticleInfo` in `Auto-Import*.ps1` reading `$ToolRoot\Master\pack-sizes.txt` — a config file
that is not in git and whose only copy on the dev machine is a stale mirror under
`OneDrive\VS Code\OBD-Import Tool v2\Master\`. The server copied the PowerShell-computed
`article_tag` field through verbatim, and **`build-obd.ts` hardcoded `articleTag: null`** on every
manual-SAP line ever imported. Measured 2026-08-08: **15,370 manual-SAP lines null on pack sizes the
dictionary DID cover (100% of manual-SAP, 0% of auto-json)**, plus **3,847 lines** across 16 pack
sizes the dictionary never covered at all.

**Resolution order — first match wins.** `sku_master_v2` is the primary source; the old pack-size
list is the fallback.

1. Catalog lookup by `material` (no `isPrimary` filter — `material` is `@unique`, nothing to disambiguate).
   - `unit === "PC"` → `"N Pcs"`. **Checked first**: piece goods carry `volumeLine` 0, so every
     volume-based branch below would reject them.
   - `piecesPerCarton != null` → carton math at the SKU's **own** count.
2. `packSize = volumeLine / unitQty`, with the SIZE_OVERRIDES below applied **to the fallback
   lookup only, never to the catalog**.
   - DRUM `10, 20, 15` → `"N Drum"` · BAG `25, 30, 40` → `"N Bag"`
   - CARTON `1→6, 4→4, 0.5→12, 0.05→20, 0.1→20, 0.2→12, 0.3→12`
3. **No match → `null`, deliberately.** See "deliberately untagged" below. An untagged line is
   recoverable; a wrong pack count sends a picker to the wrong shelf. **Do not add guesses here.**

#### The SIZE_OVERRIDES map — why four odd sizes fold into round ones

`0.925 → 1` · `3.7 → 4` · `9.25 → 10` · `18.5 → 20`

These are the **"93 Base" tinting-base pattern**, confirmed by Smart Flow: a tinting base is
deliberately under-filled by **7.5%** to leave headroom for the colourant added at the tinting
machine, so a "0.925 L" base physically ships in the **same container** as its round-size 1 L twin.
The override exists because the container is what a picker carries, and SAP reports the fill volume,
not the container. Each override is exactly `round_size × 0.925`.

⚠ **`3.7 → 4` is a deliberate BLANKET decision, not a per-product one.** The 3.7 L bucket also
contains **"WN Wanda Basecoat" automotive products** (`IN61100471`, `IN61100371`, `IN61120071`,
`IN61111071`, `IN61184071`, `IN61100271`, `IN61110071`, `IN61180071`, plus the `5379xxx` Wanda 2K
Topcoats) which are **unrelated to the tinting-base pattern** and merely happen to compute to 3.7 L.
Smart Flow chose explicitly to apply the override to the WHOLE 3.7 L group rather than carve out the
Wanda SKUs. **Do not "fix" this as a bug** — if it ever needs splitting, it needs a per-SKU rule, and
that is a decision, not a cleanup.

#### Deliberately untagged — no rule, no guess [pending physical verification]

Left returning `null` on Smart Flow's explicit call, pending a physical check of the actual products:

| packSize | What it is | Status |
|---|---|---|
| `2.5`, `3`, `5` | mixed L and KG (thinners, distemper, putty, waterproofing) | container type not yet decided |
| `0.4` — crackfiller / 300G-family + 4 non-spray automotive touch-up SKUs | | type not yet decided, **separately** from the spray-can question |
| `0.4` — 400 ML spray-paint aerosols (`5695743/44/45/47/48/49/51/52`) | tentatively decided as **24/carton**, then **explicitly REOPENED** | may actually sell as individual pieces (`Pcs`), not cartons — **currently null**, needs confirmation before any rule is added |
| *(none)* | 2 lines with genuinely broken source data — null/zero volume | unfixable by any rule; one is literally named "…20L" in its own description but carries no volume on that order line |

**These are not gaps to be closed by whoever reads this next.** They are open decisions with a named
owner. Adding a rule without the physical check is exactly the failure mode step 3 exists to prevent.

**Why the catalog beats the file:** `pack-sizes.txt` holds ONE carton count per pack size (`1=6`),
but `sku_master_v2` records four 1 L SKUs at **9** per carton — `5948208`, `5948212`, `5948220`,
`IN32400023` (all `DN WS Max 10yr` bases + `IP DN WS Prime coat Primer`). The flat file cannot
express a per-SKU exception, so those four were **mis-tagged in production** for as long as the rule
has existed (qty 45 tagged `7 Carton 3 Tin`; at 9/carton it is `5 Carton`). New imports are correct;
**historical rows keep the wrong tag** (§15).

> **Verified against live data 2026-08-09** — all four rows still read `piecesPerCarton = 9`,
> `updatedAt` unchanged since the 2026-07-19 catalog build. A session draft claimed these were
> "corrected to 6 via a direct SQL UPDATE" on 2026-08-09; **no such update exists in the data**, and
> the same draft says elsewhere that 9 is the correct value. The catalog says 9, the code uses 9.
> If anyone ever does decide 6 is physically right, that is a `sku_master_v2` data change — **not**
> a code change, and not a reason to touch `lib/article-tag.ts`.

**Float safety:** pack sizes are compared as `Math.round(packSize * 10000)` integer keys. `0.05`,
`0.1`, `0.2`, `0.3`, `0.925` are none of them exactly representable as doubles — `packSize === 0.05`
is a coin flip. Do not "simplify" these back to decimal equality.

**Performance:** `loadPackCatalog()` batches the whole file/batch into ONE `findMany`; per-line
`computeArticleInfo(input, catalog)` then does no I/O. A 10-line order costs **1 query, not 10** —
the same batch-preload shape used by `lib/picking/queue.ts:402`, `app/api/billing/picking/list`,
and `upsertObd`'s `preloaded` option. Sequential awaits only, never `prisma.$transaction`.

⚠ **The module exports TWO compute functions and only one is used.** `computeArticleInfo()` returns
`{article, articleTag}` and is the one wired at all three write sites — the numeric `article` column
feeds `totalArticle`, so the tag alone is never enough. **`computeArticleTag()` (tag-only) has ZERO
callers — it is dead code as shipped**, kept because it was the signature the build spec named. If
you are adding a caller, use `computeArticleInfo()`. Either function called **without** the catalog
argument falls back to a per-call `findUnique`: fine for a one-off, an N+1 in a loop. Nothing
enforces this — it is a trap for the next caller, not a guarded API.

**Wired at two call sites serving four actions** — `lib/sap-parser/build-obd.ts:126` (inside
`buildObds`, which serves BOTH manual-SAP .xlsx and the SAP paste — `lib/sap-paste/index.ts` reuses it
unchanged) and the shared line builder in `processAutoImportRows` (`route.ts:3412`, serves BOTH
`?action=auto` and `?action=auto-json`). The manual-template path does not call it: `handlePreview`
copies the payload's own `article` / `article_tag` (`route.ts:1007-1008`). On the auto
paths the **server result is primary**; the payload's own `article_tag` is used only when the server
returns null and the payload did not, logged as `[auto-import] articleTag fallback to payload`. A
steady stream of that warning means the catalog has drifted behind the depot's `pack-sizes.txt`.

⚠ **`headerRowToObdInput` (`route.ts:3165`) is NOT a write site.** It is shadow-only
(`IMPORT_SHADOW_MODE`, default off) and feeds a dry-run comparison. Wiring the tag rule there does
nothing. The live auto path builds its lines inline in `processAutoImportRows`.

**Order-level roll-up — grouped by SKU FIRST** (`36103761`, 2026-08-10). All THREE roll-up sites
(`rebuildQuerySummaryForOrder` `route.ts:765`, manual-template CONFIRM D3 `:1501`, auto-import CONFIRM
D3 `:3952`) call `rollupArticleTagsBySku(lines, catalog)` (`lib/article-tag.ts:291`). It groups the
order's lines by trimmed `skuCodeRaw`, sums `unitQty` (and `volumeLine`, so the fallback pack size is
preserved), calls `computeArticleInfo` ONCE per SKU group, and returns `{ articleTag, totalArticle }` so
the count matches the tag. Why: qty 1 + qty 5 of a 6-per-carton SKU is `"1 Carton"`, not `"6 Tin"` —
tagging per line then adding strings cannot recover the carton. No DB access: the caller preloads the
catalog. Per-line `articleTag` is not touched. The group strings then go through
`aggregateArticleTags()` (now in `lib/article-tag-parse.ts:67`, re-exported from `lib/article-tag.ts:231`),
which previously existed as three byte-identical inline copies. Display order
`Drum → Bag → Carton → Tin → Pcs`, joined with `", "`.

🔴 **A separate, pre-existing live bug was fixed here — found while verifying the `Pcs` type, not
planned.** The old inline parser read `parts[0]` as the count and joined **everything else** as the
type, so a multi-group tag like `"1 Carton 3 Tin"` produced the type string `"Carton 3 Tin"`, which
matched nothing in the type list and was **silently discarded**. **801 of 14,207 tagged production
rows are multi-group**, and any order whose tagged lines were *all* multi-group rolled up to a **NULL
order-level tag** — verified: OBD `9108735710`, one line correctly tagged `"7 Carton 3 Tin"`,
order-level tag `null`. The picker saw nothing. Carton math makes multi-group tags far more common,
so shipping the catalog rule without this would have made the order tag **worse** than before. The
shared parser walks number/word pairs instead. **Historical rows are not recomputed** — the roll-up
only reruns when an order's lines next change.

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

### 8.3 The import-anomaly guard — `lib/import-qty-guard.ts` [LIVE, 2026-09-08]

Wired into the two HEADER-SOURCED paths only — `processAutoImportRows` (both auto actions) and
`handlePreview` (manual template; despite its name it is the real ingest that writes the batch and the
raw rows). **Not wired into manual SAP or paste, by design:** their header total is summed from the very
lines it would be compared against (`build-obd.ts`), so the check would be vacuous. Records go to
`import_shadow_log` + the batch's `headerFile` suffix (§4) through ONE `writeImportAnomalies` call per
batch (`:205`; one call so a batch with two kinds keeps both in its label). Both writes are try/caught —
the guard can never fail an import.

**1. Qty mismatch — recorded, NEVER blocks** (`9188699a`). `detectQtyMismatch(obdNumber, declared,
lines, rowStatus)` (`:61`) compares the header's `UnitQty` with the sum of the line array; `declared`
null or 0 is exempt. On a mismatch the note `[qty_mismatch] header UnitQty N vs line sum M …`
(`qtyMismatchNote`, `:86`) is **appended to `import_raw_summary.rowError`** (`appendRowError`, `:92`;
`route.ts:1033-1037` template, `:3511-3517` auto) and a `qty_mismatch` shadow row is written.
**`rowStatus` is never touched** — live code whitelists `rowStatus in ("valid","warning")` before
creating an order and derives `customerMissing` from it, so a new value would silently drop the bill
(the reasoning is in the header of `writeImportAnomalies`, `:183-203`). Same rows, same batch outcome,
same response either way.

**2. Empty-payload skip — `?action=auto-json` only** (`a11bf7ee`). `processAutoImportRows(…, "auto-json",
true)` (`route.ts:4164`) sets `skipEmptyPayloadObds`; the v1 `?action=auto` handler and manual template
keep the old behaviour. An OBD whose payload carried **zero line rows AND declared `Volume` > 0** is
`continue`d before any summary is written — **not created**, so the create-only auto path offers it again
next cycle (`route.ts:3483-3491`). Recorded as `empty_payload_skipped` (`actualOutcome "skipped"`).

**3. Volume-zero carve-out — header-only on purpose** (`d8fcf1ed`). Zero lines with `Volume` 0 or absent
is imported **header-only** (`headerOnlyImport = true`, `route.ts:3492-3500`), because
`Auto-Import-v3.ps1` deliberately posts a volume-zero OBD without lines for manual SAP to complete later
(`Auto-Import-v3.ps1:1156-1163`, `:1372-1375`). Recorded as `header_only_allowed` (`actualOutcome
"imported"`, `decision.awaitingManualSap: true`, note "AWAITING MANUAL SAP"). The qty guard is
suppressed for that OBD so the declared-vs-zero case is not double-counted (`route.ts:3511-3513`).
⚠ Nothing in the UI surfaces such a bill as awaiting its lines — this shadow row is the only trace
(`docs/ROADMAP.md` → Import Pipeline → 🔴 P1).

---

## 9. Routes and handlers

All OBD import operations dispatch through one route, `POST /api/import/obd`, with an `?action=` query
param (`app/api/import/obd/route.ts:4584-4641`, verified 2026-09-18). A second, read-only route,
`GET /api/import/access`, tells a screen whether to draw the Import button (§9.1).

```ts
// app/api/import/obd/route.ts:4584 (shape at HEAD, comments condensed)
export async function POST(req: Request): Promise<NextResponse> {
  const url = new URL(req.url, "http://localhost");
  const action = url.searchParams.get("action");

  // 🔴 MACHINE PATHS — exempt from the tick below, and they MUST stay above it (:4588-4600)
  if (action === "auto")              return handleAutoImport(req);
  if (action === "check")             return handleAutoImportCheck(req);
  if (action === "auto-json")         return handleAutoImportJson(req);
  if (action === "patch-headers")     return handleAutoImportPatchHeaders(req);
  if (action === "pending-invoices")  return handleAutoImportPendingInvoices(req);
  if (action === "day-obds")          return handleAutoImportDayObds(req);

  // PEOPLE — one rule: the Import OBDs tick
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "…not signed in…" }, { status: 401 });
  const allowed = await checkAnyPermission(
    session.user.roles ?? [session.user.role], "import_obd", "canImport",
  );
  if (!allowed) return NextResponse.json({ error: "…ask an admin to tick Import OBDs…" }, { status: 403 });

  if (action === "preview")            return handlePreview(req, session!);
  if (action === "confirm")            return handleConfirm(req, session!);
  if (action === "manual-sap-preview") return handleManualSapPreview(req, session!);
  if (action === "manual-sap-confirm") return handleManualSapConfirm(req, session!);
  if (action === "sap-paste-preview")  return handleSapPastePreview(req, session!);
  if (action === "sap-paste-confirm")  return handleSapPasteConfirm(req, session!);

  return NextResponse.json({ error: "Invalid action. …" }, { status: 400 });
}
```

**The `import_obd` canImport tick over ALL held roles is the ONLY rule for people** (`792efc52`,
2026-09-16). No role list, no `requireRole`, no admin short-circuit in the route — the admin / superuser
bypass lives inside `checkAnyPermission`. 401/403 are JSON, not a redirect, so the Import window shows a
readable error. Was a `requireRole` job-title list plus `checkPermission(primary role)` until
2026-09-16; now the tick alone (`792efc52`). Do not revert.

🔴 **Landmine — the six machine actions must stay ABOVE the session gate.** `auto`, `check`, `auto-json`,
`patch-headers`, `pending-invoices`, `day-obds` are called by the import PC's scheduled script, which
carries no session; each handler verifies its own HMAC. `middleware.ts:46-58` lets `/api/import/obd`
through on `x-import-key-id` ∈ `auto-import-v1` / `auto-import-json-v1`, and its comment names the same six
actions. Moving any of them below the tick — or "tidying" them into it — stops the automatic import for
the whole depot (`route.ts:4588-4594` comment).

| Action | Handler | Purpose |
|---|---|---|
| `sap-paste-preview` | `handleSapPastePreview` (`:2202`) | SAP paste preview (read-only) — §3.4 |
| `sap-paste-confirm` | `handleSapPasteConfirm` (`:2355`) | SAP paste confirm (commits) — §3.4 |
| `manual-sap-preview` | `handleManualSapPreview` (`:1670`) | SAP .xlsx preview (dry run) |
| `manual-sap-confirm` | `handleManualSapConfirm` (`:1807`) | SAP .xlsx confirm (commits) |
| `auto` | `handleAutoImport` | HMAC v1 multipart — **wired but zero batch evidence ever** (§10); do not delete without an owner decision |
| `auto-json` | `handleAutoImportJson` | **[LIVE — the production auto path]** HMAC v2 JSON payload → `processAutoImportRows()` |
| `check` | `handleAutoImportCheck` | **[LIVE — v2]** read-only pre-check: which submitted OBDs are new? |
| `patch-headers` | `handleAutoImportPatchHeaders` | **[LIVE — v2]** null-only invoice fill + clock/arrival-slot/dispatch-window repair (§12) |
| `pending-invoices` | `handleAutoImportPendingInvoices` | **[LIVE — v2]** OBDs in a date window with `invoiceNo` null (feeds the invoice pass) |
| `day-obds` | `handleAutoImportDayObds` (`route.ts:4505`) | **[v2, HMAC v2]** read-only: count + OBD numbers whose `obdEmailDate` falls in a `fromDate`–`toDate` window (31-day cap). Near-clone of `pending-invoices` with **no** `invoiceNo` filter and **no** `isRemoved` filter — soft-removed orders are included on purpose, mirroring `check`, so the depot script never sees them as "missing" and re-imports them forever. Dispatched at `route.ts:4600`; `Auto-Import-v3.ps1`'s glance calls it (`$ApiUrlDayObds`, `:79`) |
| `preview` | `handlePreview` (`:797`) | Manual template — the real ingest: creates the batch, writes raw summary + lines, runs the qty guard (§8.3). Reached from the Import window's "Manual template" format |
| `confirm` | `handleConfirm` (`:1219`) | Manual template — promotes the previewed summaries into `orders`, enrichment, fallback (§2.1) |

*(The auto-json/check/patch-headers/pending-invoices rows said "[PLANNED — v2]" or were absent until 2026-08-04 — the build shipped without this table being updated.)*

### 9.1 `GET /api/import/access` + `useCanImportObds` — who sees the Import button [`792efc52`]

`app/api/import/access/route.ts` → `{ canImport }` from the SAME `checkAnyPermission(roles, "import_obd",
"canImport")` the POST route makes (signed out → `{ canImport: false }`, 401). `force-dynamic`, read-only.
It only decides what a screen draws; the POST route is what refuses.

`useCanImportObds()` (`lib/hooks/use-can-import-obds.ts`) fetches it once per mount and **defaults to
false, staying false on every failure** (non-OK, non-JSON, network error) — fail-closed, the button
appears once the answer is yes. Its result is passed as `showImport` to `UniversalHeader`. **Six
callers:**

| Screen component | Line |
|---|---|
| `app/(mail-orders)/mail-orders/mail-orders-page.tsx` (Billing / Mail Orders) | `:211` |
| `components/tint/tint-manager-content.tsx` | `:88` |
| `components/tint/tint-operator-content.tsx` | `:406` |
| `components/tint/challan-content.tsx` | `:63` |
| `components/tint/shade-master-content.tsx` | `:135` |
| `components/tint/ti-report-content.tsx` | `:368` |

The `/import` page applies the same tick in its layout (`app/(import)/import/layout.tsx:30`, redirect to
`/unauthorized`). The sidebar link reads `import_obd` **canView** (`lib/permissions.ts:43`) — a person
with canView but not canImport sees the link and is redirected. Never add a per-screen role list back.

All routes need `export const dynamic = 'force-dynamic'`.

---

## 10. Auto-Import operational details

**Status: LIVE — on the pure-JSON path.** Resumed 2026-06-20 and running since. All four sources are
active: manual SAP (.xlsx or paste) carries the bulk of OBD volume, Auto-Import runs alongside it.

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

⚠ **That cadence is v2's. v3 is probably what runs now — UNVERIFIED.** `docs/Powershell/Auto-Import-v3.ps1`
(`v3.0 "fast lane"`, tracked since `eb34532c`) is fired by Task Scheduler **every 1 minute** and decides
its own mode by IST time of day (header `:5-16`: SLEEP before 10:00 apart from one morning sweep, BUSY
glance every minute, RELAX every ~10 min, PATROL every ~30 min 20:00–24:00). A glance compares Breakwalls'
count with `?action=day-obds` and imports only what is missing. `docs/ROADMAP.md` ("⚠ Canon is stale on the auto-import cadence") records live
auto-batch gaps of 1, 4, 5 … minutes, which v2's fixed cycle cannot produce, and the volume-zero
header-only bills (§8.3) match a rule only v3 has. Only the import PC can confirm which file is scheduled.

Runtime facts (live):
- HMAC signing: `IMPORT_HMAC_SECRET_JSON` env var, fixed string `"auto-import-json-v1"` (timestamp-free)
- Repo copies that post to the live path: `docs/Powershell/Auto-Import-v3.ps1` (probably running) and
  `docs/Powershell/Auto-Import-v2.ps1`; both set `$ToolRoot = "F:\VS Code\OBD-Import Tool v2"` (v3 `:56`,
  v2 `:38`) — describes the import PC
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

**What the server receives** — `handleAutoImportJson` (`route.ts:4130`) requires a JSON body
`{ headerRows: RawHeaderRow[], lineRows: RawLineRow[] }` (422 if `headerRows` is empty) and hands both to
`processAutoImportRows`. The rows are **flat objects keyed by the old v1 sheet names**, not `{key, value}`
pairs — the depot script builds them: `Build-HeaderRow` (`Auto-Import-v3.ps1:756`) from the Breakwalls
list row, `Build-LineRow` (`:784`) from the FormGetData line array, posted as
`@{ headerRows = …; lineRows = … }` (`:1413`). Key types: `RawHeaderRow` / `RawLineRow`, `route.ts:50-80`.

**Header keys the server reads** (`processAutoImportRows`, `route.ts:3374-3552`):

| `hr[...]` key | Stored as |
|---|---|
| `OBD Number` | `obdNumber` |
| `SONum` | `soNumber` |
| `Bill To Customer Id` / `Bill To Customer Name` | `billToCustomerId` / `billToCustomerName` |
| `ShipToCustomerId` / `Ship To Customer Name` | `shipToCustomerId` / `shipToCustomerName` |
| `SMU` / `SMU Code` | `smu` / `smuCode` (copied as sent) |
| `InvoiceNo` / `InvoiceDate` | `invoiceNo` / `invoiceDate` |
| `OBD Email Date` / `OBD Email Time` | `obdEmailDate` / `obdEmailTime` |
| `UnitQty` | `totalUnitQty` (also the qty guard's `declared`, §8.3) |
| `GrossWeight` | `grossWeight` |
| `Volume` | `volume` (also the empty-payload / header-only test, §8.3) |
| `Status` | `sapStatus` |
| `MaterialType` / `NatureOfTransaction` / `Warehouse` | same-named columns |

**Line keys the server reads** (`route.ts:3395-3451`):

| `lr[...]` key | Stored as |
|---|---|
| `obd_number` | groups lines under their OBD (`route.ts:3312`) |
| `line_id` | `lineId` (the real SAP item number) |
| `sku_codes` | `skuCodeRaw` |
| `sku_description` | `skuDescriptionRaw` |
| `unit_qty` | `unitQty` |
| `volume_line` | `volumeLine` |
| `Tinting` | `isTinting` — the **payload's** flag (`parseBooleanCell`), computed by the script's `Get-Tinting` (SMU gate + keywords, v3 `:370`); NOT the Z007 rule |
| `batch_code` | `batchCode` — `Build-LineRow` always sends `$null` |
| `article` / `article_tag` | fallback only when the server rule returns null (§8.2) |

⚠ **The auto path stores NO line weights.** Its raw-line `createMany` (`route.ts:3585-3606`) writes
`lineId, skuCodeRaw, skuDescriptionRaw, batchCode, unitQty, volumeLine, isTinting, article, articleTag,
rowStatus, rowError` — no `netWeight` / `totalWeight`, and the payload carries none. Nor does it store
`itemCategory`. Only the two SAP sources write line weights (`createPath`, `lib/import-upsert.ts:240-255`).
Tracked in `docs/ROADMAP.md` → Import Pipeline → "P1 — Line weights are not populated on two of three
import paths".

**Header-patch for existing OBDs:** done by the separate `?action=patch-headers` action (§12), never by
`auto-json` — `processAutoImportRows` skips an OBD that already exists (`route.ts:3379`). Guard: null-only
invoice fill, so a value manual SAP already set is not overwritten.

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

- `components/import/import-modal.tsx` — the header Import window, mounted by `UniversalHeader` (`components/universal-header.tsx:655`) when the screen passes `showImport` (§9.1). Three formats — `"sap-paste"` (default), `"sap"`, `"manual-template"` (`:44`, `:108`). It renders its own preview; for the two SAP formats the WRITE is handed to the header pill (`handOffSapWrite`, `:454`) and the window closes. Manual template keeps its in-window result.
- `components/import/import-page-content.tsx` — the in-page importer behind BOTH `/import` (`app/(import)/import/page.tsx`, the sidebar target) and `/admin/import` (`app/(admin)/admin/import/page.tsx`). Runs in-page, not through the pill.
- `components/import/sap-preview.tsx` — `SapPreview`, per-OBD outcome (new/patch/skipped/error) + issues list. Imported only by `import-page-content.tsx` (`:37`); the modal does not use it.
- **Header import pill** — `ImportProgressProvider` (`components/import/import-progress-provider.tsx`, mounted in the root layout `app/layout.tsx:90`, owns the in-flight SAP write) and `ImportProgressPill` (`components/import/import-progress-pill.tsx`, rendered by `universal-header.tsx:422`), `37ceb57a`. Header chrome: `CLAUDE_UI.md §6`.

State lives in `useState` inside each component; the only shared state is the import-progress provider.

---

## 12. Slot assignment integration

Cross-reference CORE §9 (⚠ pending update — see flag below).

**Two distinct slot fields — do not conflate:**
| Field | Meaning | Set when | Applies to |
|---|---|---|---|
| `arrivalSlotId` | which slot the OBD *arrived* in (5-slot ruler: Morning/Afternoon/Evening/Late Evening/Night) | import time | ALL orders — tint and non-tint |
| `slotId` / `originalSlotId` | completion/dispatch slot | SAP: at import (non-tint); tint: at tinting completion | ALL orders |

- **Non-tint orders:** both `arrivalSlotId` and `slotId`/`originalSlotId` are set at import via the resolvers below.
- **Tint orders (`orderType === "tint"`):** `slotId`/`originalSlotId` stay `null` at import — set on tint completion (CLAUDE_TINT.md §2). `arrivalSlotId` is now set at import for tint orders too, same as non-tint, on the auto and manual-template paths (see below) — **this changed 2026-06-29.** The two SAP sources still leave it null for tint (see the ⚠ below).
- **`arrivalSlotId` at import (2026-06-29 change, `c901d660`) [LIVE]:** the manual-template confirm (`handleConfirm`, `route.ts:1343`) and the auto-import confirm path (`processAutoImportRows`, `route.ts:3794`) used to compute `arrivalSlotId` with a tint-guarded ternary: `orderType !== "tint" && emailDateTime ? resolveArrivalSlotId(emailDateTime) : null`. The tint guard was **removed** from both — now `emailDateTime ? resolveArrivalSlotId(emailDateTime) : null`, so tint orders get a real `arrivalSlotId` at import instead of permanently `null`. No backfill run — applies to new orders only.
- ⚠ **The two SAP sources (.xlsx and paste) still carry the tint guard.** They create through `upsertObd` → `createPath`, which computes `arrivalSlotId = orderType !== "tint" && orderDate ? resolveArrivalSlotId(orderDate) : null` (`lib/import-upsert.ts:160`). A tint bill CREATED by manual SAP or paste is born with `arrivalSlotId` null; mail-order enrichment (`route.ts:345`) or `patch-headers` (`route.ts:4295`) may stamp it later. The 2026-06-29 change never reached this path.
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

⚠ The arrival-slot fork itself (`applyMailOrderEnrichment`, `route.ts:337-345`) is **still the OLD
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

- `import_batches` records every run (status, the `headerFile` label with its source prefix and any `⚠` anomaly suffix, counts — §4).
- `import_shadow_log` — INSERT-ONLY. Live rows come from the anomaly guard (`qty_mismatch` / `empty_payload_skipped` / `header_only_allowed`, §8.3); shadow-mode rows only when `IMPORT_SHADOW_MODE` is on.
- `import_raw_summary.rowError` carries `[qty_mismatch] …` for a header-vs-lines disagreement (§8.3). Never look for it in `rowStatus`.
- `order_status_logs` note `"Auto-dispatched on import (no mail order for this bill)"` marks a fallback release (§2.1); `"Auto-dispatched by enrichment"` marks a mail-matched one.
- Preview skip reason `parent item superseded by batch sub-items` — rule P fired (§8, 7a).
- Console warnings to look out for:
  - `[no-mail-fallback] … no slot, engine declined: <reason>` / `Released N bill(s)` — §2.1
  - `[auto-import] empty payload with real volume — OBD skipped for retry` / `volume-zero header-only import — awaiting manual SAP` — §8.3
  - `stats-mismatch` — file-level invariant violation
  - `unknown-item-category` — new SAP item category not yet mapped
  - `mixed-zzre-line` — partial ZZRE delivery
  - `zinr-article-tag-pending` — **stale since 2026-08-09** (§8.2); ZINR now tags like any category
  - `[auto-import] articleTag fallback to payload` — the server rule returned null and the depot PC's did not. A steady stream means `sku_master_v2` has drifted behind `Master\pack-sizes.txt` (§8.2)
  - `missing-material` — SAP row without material code
- `lineStatus` transitions: `active` ↔ `removed_by_import`. Never any other value.

---

## 14. Landmines

- **Auto-Import ingest is create-only for lines.** `processAutoImportRows` skips existing OBDs entirely; line-patch logic is exclusive to the two SAP sources (.xlsx and paste). The auto pipeline's ONLY writes to existing OBDs are the separate `patch-headers` action's null-only invoice fill + clock/slot/window repair (§12) — header fields, never lines. On `auto-json` it also declines to create an OBD whose payload had no lines but a real volume (retried next cycle), and creates a volume-zero one header-only (§8.3).
- **THE NAMING TRAP — five files, three scripts, misleading version labels.** Name the FILE, never the number — "version two" is ambiguous across every doc mention.

  | File | Title line | Tracked? | Posts to | What it is |
  |---|---|---|---|---|
  | `docs/sample/Auto-Import.ps1` | `Auto-Import.ps1 -- v2.0` | yes | `orbit-oms.vercel.app` | v1 XLSX/multipart ("v2.0" = OBD-Import **Tool** v2) — zero batch evidence ever |
  | `docs/Parser/Auto-Import.ps1` | same | **no** | same | copy of the above |
  | `docs/Powershell/Auto-Import.ps1` | same | **no** | same | copy of the above |
  | `docs/Powershell/Auto-Import-v2.ps1` | `Auto-Import-v2.ps1 -- v1.0` | yes | `www.orbitoms.in` | pure JSON, fixed ~10-min cycle |
  | `docs/Powershell/Auto-Import-v3.ps1` | `Auto-Import-v3.ps1 -- v3.0 "fast lane"` | yes (`eb34532c`) | `www.orbitoms.in` | pure JSON, fired every minute, mode-based — **probably what runs** (§10, unverified) |

  *(The sample/Parser copies' `$ToolRoot` point at a `%USERPROFILE%\OneDrive` path while v2, v3, the Powershell copy and CORE §4 say `F:\` — different machines/eras; only the import PC knows its own truth.)* The other `docs/Powershell/*.ps1` files (`0-FrtIngestion`, `3-PendingFetch`, `4-LogisticsEntry`, untracked) are Breakwalls freight/logistics automation, not OrbitOMS import.
- **The six machine actions must stay above the session gate** (§9) — moving one below the tick stops depot auto-import. The middleware HMAC exemption (`middleware.ts:46-58`) and the `route.ts:4588-4594` comment both say so.
- **Never write an import anomaly into `import_raw_summary.rowStatus`** (§8.3). Order creation whitelists `valid`/`warning`; any other value silently drops the bill from the app. Anomalies go to `rowError` and `import_shadow_log`.
- **`import_enriched_line_items` is not 1:1 with raw lines** (§4) — the SAP sources never write it. Do not build a reader on it.
- **The no-mail-order fallback must stay AFTER enrichment and keyed on `obdNumber`** (§2.1). The ordering is what keeps a mail-matched bill untouched by it (`route.ts:530-532`); keyed on `soNumber` it would miss the bills that have none (`route.ts:1415-1420`). Exactly one `orders.update` per bill.
- **`import_batches.createdAt` is `timestamp` WITHOUT time zone (naive UTC).** Postgres `AT TIME ZONE 'Asia/Kolkata'` on it converts the WRONG WAY (treats the naive value as IST) — silently shifting every timestamp by −11h. Convert with `+ interval '5 hours 30 minutes'`. This bit the 2026-08-04 cadence measurement on its first attempt.
- **`ImportSource` has THREE values — `auto-import`, `manual-template`, `manual-sap` (`lib/import-upsert/types.ts:10`).** Don't add a FOURTH without auditing `LINE_AUTHORITY` (a `Record<ImportSource, boolean>`, so the compiler forces an entry but not a correct one), the orphan handler, the `source === "auto-import"` branches in `header.ts` and `import-upsert.ts`, and the audit-note wording. *(Corrected 2026-09-14: this said "`ObdSource` enum has two values" — no type of that name exists, and there were three. The caution stands; only the count was wrong.)* The SAP paste import deliberately reuses `"manual-sap"` rather than adding one (§6).
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
- ~~**`articleTag` rule for ZINR.**~~ — **SUPERSEDED 2026-08-09 (§8.2).** ZINR was never the reason tags were missing: the manual-SAP parser emitted `null` for EVERY item category, ZINR included. The rule now lives in `lib/article-tag.ts` and applies to all categories. The breadcrumb warning itself is stale but was left in place (§8 rule 9) — retiring it is a separate, one-line pass.
- **Backfill of historical null AND wrong `articleTag` is NOT done — a separate decision.** This change fixes new imports only. `patchLines` (`lib/import-upsert/lines.ts`) never touches `articleTag` on an existing line, so even a manual-SAP re-upload of an old OBD will not fix it. Two distinct populations: ~19,200 historical **null** lines, and the **138 wrongly-tagged** lines on the four 9-per-carton SKUs (§8.2), which are worse than null because they read as authoritative. Needs an owner decision on whether to rewrite live picking data. Tracked in `docs/ROADMAP.md` → Import Pipeline.
- **Pack sizes still deliberately untagged**, pending depot confirmation of the container word: `0.4` (400 ML sprays, 57 lines), `5` (221), `3` (29), `2.5` (3). The catalog has `packCode`+`unit` for most of these but nothing in `sku_master_v2` distinguishes Drum from Bag — see the Check D finding in the 2026-08-09 discovery. Add them to §8.2's lists once the depot confirms.
- **Old SAP layout shim** if SAP ever ships the old layout again (e.g. depot-level legacy). Not built today.
- **Defect B — header totals are never recomputed on the patch path.** `patchHeader` / `applyHeaderPatch` (`lib/import-upsert/header.ts`) contain no `totalUnitQty`, `grossWeight` or `volume` handling at all, so `orders` + `import_raw_summary` keep the totals written at create while a manual-SAP re-upload adds, removes or re-sizes lines. The rebuild effect is already wired and dead: `effects.ts:72` fires `query-summary-rebuild` on a change to exactly those three fields, which `patchHeader` never emits. The gated recommendation is a narrowed fix — recompute `totalUnitQty` only, skip bills with zero active lines, drop `grossWeight` (the line weights cannot support it, §10.1) — and **not before** the nineteen short/zero-line bills are recorded, since a recompute would erase the header that is the only evidence of their missing stock (`docs/ROADMAP.md` → Import Pipeline → 🔴 P1). Full gate: `docs/prompts/drafts/code-discovery-2026-09-08-import-qty-integrity.md` §DEFECT B — GATE. Owner decision; not built.
- **Header-only bills are invisible as "awaiting lines".** A volume-zero auto-json bill is imported header-only and traced only in `import_shadow_log` (`header_only_allowed`, §8.3); nothing surfaces it to an operator. Tracked in `docs/ROADMAP.md` → Import Pipeline.
- **Auto-Import patch path.** Today Auto-Import is create-only. If Auto-Import ever needs to patch existing OBDs (e.g. for late-update detection), the path needs to go through `upsertObd` like manual SAP does, with `LINE_AUTHORITY['auto-import'] = true` (a boolean map — §6). Big change — full re-audit needed.
- ~~Auto-Import v2 — steps 4–10 not yet built~~ — **SHIPPED, see §10.1** (corrected 2026-08-04). Design doc now at `docs/prompts/archive/2026-06/web-update-2026-06-20-auto-import-v2-pure-json.md` (was in drafts/).
- **`IMPORT_HMAC_SECRET_JSON`** is in Vercel and working (live auto-json batches authenticate daily). `IMPORT_HMAC_SECRET` (v1 var) stays until the v1 `?action=auto` handler is retired — which is now a real candidate: zero batch evidence ever (§9/§10). Retiring it is an owner decision, not a cleanup.
- **lineId semantic change in v2.** v1 used ordinal positions (10/20/30); v2 uses real SAP item numbers. This means composite key `lineId|skuCodeRaw` will NOT match between a v1 create and a v2 patch. Create-only policy makes this safe, but if patch path ever becomes needed for Auto-Import, re-audit the key strategy.
- **The new same-day/different-day arrival-slot rule is designed but NOT built** (§12.2). The live fork in `applyMailOrderEnrichment` still uses the old `receivedAt` vs `punchedAt` comparison. Building it is a single-site edit once picked up — see §12.2 for the full rule and the acceptance check (OBD `9108192224`).

---

## Change log — v1.11 (2026-09-18 reconciliation pass, canon sweep batch B1)

Reconciled against code at HEAD `5ab9ee40` and CORE Schema v27.24; live facts from the 2026-09-18 canon-sweep
CSV. Schema stamp v27.15 → v27.24 (earned: the import tables were re-read against `schema.prisma`).

- Header / §1: four sources (SAP paste — the modal default —, manual SAP .xlsx, manual template, auto-json);
  only the two SAP sources converge at `upsertObd`; every source ends in the no-mail-order fallback;
  `Auto-Import-v3.ps1` named as probably running (unverified, ROADMAP batch-gap evidence); primary-users
  line notes `user` access mode (live Q02) and the tick as the only gate. Retired consumers (dispatch
  planning, warehouse) dropped.
- §2: pipeline diagram redrawn for all four sources, the empty-payload skip and the fallback. NEW §2.1 —
  `applyNoMailOrderFallback` (`b3dfe5b8`): who qualifies, the one update + one log, engine slot / manual
  slot kept / decline leaves NULL / SMU gate, four call sites. This file owns it.
- NEW §3.4 — the SAP paste pipeline folded in from `code-update-2026-09-14-sap-paste-import.md` (routes,
  body cap, `lib/sap-paste/*`, the item-number conversion, the name-width rule).
- §4: `schema.prisma` anchor; `headerFile` prefix table gains `[<templateId>]` and the `⚠` anomaly suffix;
  `import_enriched_line_items` is NOT 1:1 (only template + auto write it); `import_shadow_log` IS written
  (anomaly guard).
- §5: `COL` is non-exported and 1-based; `cells.ts` names; `LineInterim` shape; `types.ts` contents incl.
  the rule-P `SkippedRow` reason; `classifyRow`; `REQUIRED_COLS` anchor.
- §6: `upsertObd` signature, `UpsertOutcome`, `loadExistingObd`, `buildEffects` + real effect kinds,
  `patchLines`/`patchHeader` planners, helpers, `writeAuditLogs` → `order_status_logs`, `makeKey` trims.
  NEW `SMU_CODE_BY_NAME` entry with its callers.
- §8: rule P added as item 7a (`25fc3c99`, `a290c116`). §8.2: `rollupArticleTagsBySku` groups by SKU before
  tagging (`36103761`); write-site sentence and `headerRowToObdInput` anchor fixed. NEW §8.3 — the anomaly
  guard (`9188699a`, `a11bf7ee`, `d8fcf1ed`).
- §9: snippet replaced with the HEAD shape — the `import_obd` canImport tick over all held roles is the only
  rule (`792efc52`); lag note removed; machine-action landmine; sap-paste + manual-template rows; anchors.
  NEW §9.1 — `GET /api/import/access` + `useCanImportObds` and its six callers.
- §10 / §10.1: v3 cadence note and repo copies; field maps replaced with the flat keys the server actually
  reads; the auto path stores no line weights; header-patch paragraph points at `patch-headers`.
- §11: the modal's three formats and the pill hand-off; `SapPreview` used only by the page; the page backs
  `/import` and `/admin/import`; header pill → `CLAUDE_UI.md §6`.
- §12: the 2026-06-29 arrival-slot change cited at its real sites; NEW ⚠ — the SAP sources' `createPath`
  still tint-guards `arrivalSlotId`. §12.2 anchor.
- §13: observability for the fallback, the guard, rule P. §14: naming trap rebuilt (five files, tracked
  status); new landmines (machine actions, `rowStatus`, enriched table, fallback ordering). §15: Defect B and
  header-only visibility added as open items.

---

## Change log — v1.10 (2026-09-14, four false claims corrected during the SAP paste build)

Not a reconciliation pass — the schema stamp is deliberately NOT bumped (CLAUDE.md §4). Each claim was
verified in code during the paste-import build (commit `37ceb57a`), and every canonical `docs/CLAUDE_*.md`
plus the router was swept for the stale phrasing first; all copies were in this file.

- §4 `import_batches`: the listed `source` column does not exist (nor `fileName`, `fileSize`,
  `uploadedById`, `errorMessage`, `completedAt`, nor statuses `success`/`error`). Real columns from
  `schema.prisma:783-799`; source lives only in the `headerFile` prefix (`[auto-import]` / `[manual-sap]` /
  `[sap-paste]`). Status values re-verified by live SELECT.
- §5: "pure synchronous module, no DB access" false since 2026-08-09 — `buildObds` reads the catalog, so
  `parseSapFile` is async. Pure vs impure stages now tabled.
- §6 + §14: there are THREE `ImportSource` values and `LINE_AUTHORITY` is a boolean map
  (`lib/import-upsert/types.ts:10`, `:256-260`); no `ObdSource` type exists. Landmine caution kept. The §15
  "Auto-Import patch path" item's string-map wording fixed to match. §6's "until Auto-Import resumes" corrected
  in passing (live since 2026-06-20).
- §9: `?action=day-obds` added to the snippet and the action table; the snippet's other lag (role list,
  admin short-circuit, the two sap-paste actions) flagged under it, not rewritten.
- NOT fixed here, recorded for consolidation in `docs/prompts/drafts/code-update-2026-09-14-sap-paste-import.md`:
  further false claims in §5 (`cells.ts` helper names, `COL` shape) and §6's file list (`upsertObd`
  signature, `UpsertOutcome` values, `loadExistingState`, `dispatchEffects` + effect-kind names,
  `recordAuditEntry` / `import_shadow_log`, `makeKey` omits `.trim()`).

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

*Import v1.11 · Schema v27.24 · OrbitOMS · updated 2026-09-18 — reconciliation pass (canon sweep batch B1): the no-mail-order fallback (§2.1), the SAP paste pipeline (§3.4), the anomaly guard (§8.3), rule P, the SKU-grouped roll-up, the tick-only import gate + `GET /api/import/access` (§9/§9.1), the v3 script and the real auto-path keys (§10), the enriched-table gap and `SMU_CODE_BY_NAME` folded in; §5/§6 names corrected. Prior: v1.10, 2026-09-14 — four FALSE claims corrected (§4 `import_batches` has no `source` column — source is the `headerFile` prefix; §5 the parser is not pure, `buildObds` reads the catalog; §6/§14 `ImportSource` has three values and `LINE_AUTHORITY` is a boolean map; §9 `day-obds` was missing). Schema stamp deliberately not bumped. Prior: v1.9, 2026-08-09 — §8.2 completed from the full session record: SIZE_OVERRIDES rationale (incl. the deliberate 3.7 L Wanda blanket call), the deliberately-untagged table, the `computeArticleTag()` dead-code warning, and the multi-group roll-up bug written up as its own find. Four-SKU `piecesPerCarton` re-verified against live data (still 9 — a draft claim that it had been changed to 6 is contradicted by the rows). §15 backfill item split into null vs wrongly-tagged. Schema stamp realigned v27.14 → v27.15 to match CORE v94. Prior: v1.8, same day — §8.2 first added with commit `9de0c55b`*
