# PHASE_2_BUILD_PROMPTS.md — Orbit OMS
# Sequential prompt guide for Phase 2: Order Import Engine + Workflow Screens
# Source of truth: Schema v11 · CLAUDE_CONTEXT.md
#
# HOW TO USE:
# 1. Start every Claude Code session: claude "Read CLAUDE_CONTEXT.md fully before doing anything else."
# 2. Run one STEP at a time. Complete the TEST before moving to the next step.
# 3. Steps are ordered by dependency — do not skip.
# 4. All DB changes go via Supabase SQL Editor — never npx prisma db push locally.

---

## Phase 2 scope

| Step | Screen / Component | Status |
|---|---|---|
| STEP 1 | Schema v11 — expand Phase 2 stubs to full models | ❌ |
| STEP 2 | Import API — preview + confirm endpoints | ❌ |
| STEP 3 | Import UI — /import screen (upload → preview → result) | ❌ |
| STEP 4 | Support screen — /support order queue | ❌ |
| STEP 5 | Tint Manager — /tint/manager Kanban | ❌ |
| STEP 6 | Tint Operator — /tint/operator execution | ❌ |
| STEP 7 | Final wiring + pre-deploy validation | ❌ |

---

## STEP 1 — Schema v11: Expand Phase 2 tables

**What this builds:** Full Prisma model definitions for all 5 import tables and all 5 order/tinting tables. Replaces the id-only stubs from Phase 1.
**Dependency:** None — do first.
**DB rule:** After updating schema.prisma, generate SQL and paste into Supabase SQL Editor. Do NOT run prisma db push locally.
**Test:** `npx prisma validate` exits clean. `npx tsc --noEmit` exits clean.

```
Read CLAUDE_CONTEXT.md fully. Then read the current /prisma/schema.prisma.

We are expanding the Phase 2 stub models to full definitions (Schema v11).
Do NOT touch any Phase 1 models or Phase 3 stubs.

━━━ REPLACE these stub models with full definitions ━━━

── MODEL: import_batches ─────────────────────────────────────────────────────
model import_batches {
  id           Int                  @id @default(autoincrement())
  batchRef     String               @unique
  importedById Int
  importedBy   users                @relation(fields: [importedById], references: [id])
  headerFile   String
  lineFile     String
  totalObds    Int                  @default(0)
  skippedObds  Int                  @default(0)
  failedObds   Int                  @default(0)
  status       String               @default("processing")
  createdAt    DateTime             @default(now())
  updatedAt    DateTime             @updatedAt
  rawSummaries import_raw_summary[]
  orders       orders[]
}

── MODEL: import_raw_summary ─────────────────────────────────────────────────
model import_raw_summary {
  id                   Int                     @id @default(autoincrement())
  batchId              Int
  batch                import_batches          @relation(fields: [batchId], references: [id])
  obdNumber            String
  sapStatus            String?
  smu                  String?
  smuCode              String?
  materialType         String?
  natureOfTransaction  String?
  warehouse            String?
  obdEmailDate         DateTime?
  obdEmailTime         String?
  totalUnitQty         Int?
  grossWeight          Float?
  volume               Float?
  billToCustomerId     String?
  billToCustomerName   String?
  shipToCustomerId     String?
  shipToCustomerName   String?
  invoiceNo            String?
  invoiceDate          DateTime?
  rowStatus            String                  @default("valid")
  rowError             String?
  createdAt            DateTime                @default(now())
  rawLineItems         import_raw_line_items[]
}

── MODEL: import_raw_line_items ──────────────────────────────────────────────
model import_raw_line_items {
  id                Int                         @id @default(autoincrement())
  rawSummaryId      Int
  rawSummary        import_raw_summary          @relation(fields: [rawSummaryId], references: [id])
  obdNumber         String
  lineId            Int
  skuCodeRaw        String
  skuDescriptionRaw String?
  batchCode         String?
  unitQty           Int
  volumeLine        Float?
  isTinting         Boolean                     @default(false)
  rowStatus         String                      @default("valid")
  rowError          String?
  createdAt         DateTime                    @default(now())
  enrichedLine      import_enriched_line_items?
}

── MODEL: import_enriched_line_items ─────────────────────────────────────────
model import_enriched_line_items {
  id            Int                   @id @default(autoincrement())
  rawLineItemId Int                   @unique
  rawLineItem   import_raw_line_items @relation(fields: [rawLineItemId], references: [id])
  skuId         Int
  sku           sku_master            @relation(fields: [skuId], references: [id])
  unitQty       Int
  volumeLine    Float?
  lineWeight    Float
  isTinting     Boolean
  createdAt     DateTime              @default(now())
}

── MODEL: import_obd_query_summary ───────────────────────────────────────────
model import_obd_query_summary {
  id           Int      @id @default(autoincrement())
  obdNumber    String   @unique
  orderId      Int?     @unique
  order        orders?  @relation(fields: [orderId], references: [id])
  totalLines   Int
  totalUnitQty Int
  totalWeight  Float
  totalVolume  Float
  hasTinting   Boolean
  createdAt    DateTime @default(now())
}

── MODEL: orders ──────────────────────────────────────────────────────────────
model orders {
  id                   Int                       @id @default(autoincrement())
  obdNumber            String                    @unique
  batchId              Int
  batch                import_batches            @relation(fields: [batchId], references: [id])
  customerId           Int?
  customer             delivery_point_master?    @relation(fields: [customerId], references: [id])
  shipToCustomerId     String
  shipToCustomerName   String?
  orderType            String
  workflowStage        String                    @default("order_created")
  dispatchSlot         String?
  dispatchSlotDeadline DateTime?
  priorityLevel        Int                       @default(3)
  dispatchStatus       String?
  invoiceNo            String?
  invoiceDate          DateTime?
  obdEmailDate         DateTime?
  sapStatus            String?
  materialType         String?
  natureOfTransaction  String?
  warehouse            String?
  totalUnitQty         Int?
  grossWeight          Float?
  volume               Float?
  isActive             Boolean                   @default(true)
  createdAt            DateTime                  @default(now())
  updatedAt            DateTime                  @updatedAt
  querySnapshot        import_obd_query_summary?
  statusLogs           order_status_logs[]
  tintAssignments      tint_assignments[]
  splits               order_splits[]
}

── MODEL: order_status_logs ──────────────────────────────────────────────────
-- INSERT-ONLY. Never update or delete rows from this table.
model order_status_logs {
  id          Int      @id @default(autoincrement())
  orderId     Int
  order       orders   @relation(fields: [orderId], references: [id])
  fromStage   String?
  toStage     String
  changedById Int
  changedBy   users    @relation(fields: [changedById], references: [id])
  note        String?
  createdAt   DateTime @default(now())
}

── MODEL: tint_assignments ───────────────────────────────────────────────────
model tint_assignments {
  id           Int      @id @default(autoincrement())
  orderId      Int
  order        orders   @relation(fields: [orderId], references: [id])
  assignedToId Int
  assignedTo   users    @relation("TintAssignmentOperator", fields: [assignedToId], references: [id])
  assignedById Int
  assignedBy   users    @relation("TintAssignmentManager", fields: [assignedById], references: [id])
  status       String   @default("assigned")
  startedAt    DateTime?
  completedAt  DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

── MODEL: tint_logs ──────────────────────────────────────────────────────────
-- INSERT-ONLY. Never update or delete rows from this table.
model tint_logs {
  id            Int      @id @default(autoincrement())
  orderId       Int
  order         orders   @relation(fields: [orderId], references: [id])
  action        String
  performedById Int
  performedBy   users    @relation(fields: [performedById], references: [id])
  note          String?
  createdAt     DateTime @default(now())
}

── MODEL: order_splits ───────────────────────────────────────────────────────
model order_splits {
  id        Int      @id @default(autoincrement())
  orderId   Int
  order     orders   @relation(fields: [orderId], references: [id])
  createdAt DateTime @default(now())
}

━━━ ADD back-relations to existing Phase 1 models ━━━

On users model, add:
  importBatches                   import_batches[]
  orderStatusLogs                 order_status_logs[]
  tintAssignmentsAsOperator       tint_assignments[]  @relation("TintAssignmentOperator")
  tintAssignmentsAsManager        tint_assignments[]  @relation("TintAssignmentManager")
  tintLogs                        tint_logs[]

On delivery_point_master model, add:
  orders                          orders[]

On sku_master model, add:
  enrichedLineItems               import_enriched_line_items[]

━━━ IMPORTANT: grossWeightPerUnit on sku_master ━━━
Check if grossWeightPerUnit exists on sku_master in the current schema.prisma.
If it was removed in v10 schema updates, ADD IT BACK:
  grossWeightPerUnit  Float   @default(0)
This field is REQUIRED for lineWeight calculation during import enrichment.

━━━ AFTER updating schema.prisma ━━━

1. Run: npx prisma validate
   Fix all errors before continuing.

2. Run: npx tsc --noEmit
   Fix all TypeScript errors.

3. Generate migration SQL. Run:
   npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma --script
   
   If that fails due to local DB connection, instead write the SQL manually to:
   /prisma/migrations/phase2_schema_v11.sql
   
   The SQL must contain:
   - ALTER TABLE statements for new back-relation columns
   - CREATE TABLE statements for all 10 expanded tables
   - All foreign key constraints
   
   I will paste this SQL into Supabase SQL Editor manually.

4. Report: list of all models changed, confirm validate passes, confirm tsc passes.
```

**Test:** `npx prisma validate` exits clean. `npx tsc --noEmit` exits clean. SQL file ready for Supabase.

---

## STEP 2 — Import API (preview + confirm)

**What this builds:** The two-endpoint import API. POST with `?action=preview` parses both XLS files and returns a structured preview payload. POST with `?action=confirm` commits the approved OBDs as orders.
**Dependency:** Step 1 complete and SQL applied to Supabase.
**Test:** Upload sample files via curl or Postman. Preview returns correct rowStatus per OBD. Confirm creates orders rows in Supabase.

```
Read CLAUDE_CONTEXT.md fully. Schema is now v11 with full Phase 2 tables.

Build the OBD import API at /app/api/import/obd/route.ts

━━━ ROLES ━━━
requireRole(session, ['Admin', 'Dispatcher', 'Support'])

━━━ SHARED TYPES ━━━
Create /lib/import-types.ts with these interfaces (used by both API and UI):

interface ImportLinePreview {
  rawLineItemId: number
  lineId: number
  skuCodeRaw: string
  skuDescriptionRaw: string | null
  unitQty: number
  isTinting: boolean
  rowStatus: 'valid' | 'error'
  rowError: string | null
}

interface ImportObdPreview {
  rawSummaryId: number
  obdNumber: string
  shipToCustomerId: string | null
  shipToCustomerName: string | null
  obdEmailDate: string | null
  totalUnitQty: number | null
  grossWeight: number | null
  rowStatus: 'valid' | 'duplicate' | 'error'
  rowError: string | null
  lineCount: number
  tintLineCount: number
  orderType: 'tint' | 'non_tint'
  lines: ImportLinePreview[]
}

interface ImportPreviewResponse {
  batchId: number
  batchRef: string
  summary: {
    totalObds: number
    validObds: number
    duplicateObds: number
    errorObds: number
    totalLines: number
    validLines: number
    errorLines: number
  }
  obds: ImportObdPreview[]
}

interface ImportConfirmBody {
  batchId: number
  confirmedObdIds: number[]
}

interface ImportConfirmResponse {
  success: boolean
  batchId: number
  batchRef: string
  ordersCreated: number
  linesEnriched: number
}

━━━ ENDPOINT 1: POST /api/import/obd?action=preview ━━━

Input: multipart/form-data
  headerFile  — OBD Header .xlsx file
  lineFile    — Line Items .xlsx file

STEP A — Parse both files using the 'xlsx' npm package.

  Header: read sheet named "LogisticsTrackerWareHouse"
  Parse ONLY these 18 columns (ignore all others):
    "OBD Number", "Status", "SMU", "SMU Code", "MaterialType",
    "NatureOfTransaction", "Warehouse", "OBD Email Date", "OBD Email Time",
    "UnitQty", "GrossWeight", "Volume", "Bill To Customer Id",
    "Bill To Customer Name", "ShipToCustomerId", "Ship To Customer Name",
    "InvoiceNo", "InvoiceDate"

  Line items: read sheet named "Sheet1"
  Parse all 8 columns:
    "obd_number", "line_id", "sku_codes", "sku_description",
    "batch_code", "unit_qty", "volume_line", "Tinting"

  Type coercions:
  - OBD Number: always String (SAP numbers can be long — do not parse as Int)
  - UnitQty, unit_qty, line_id: Int
  - GrossWeight, Volume, volume_line: Float
  - Tinting: Boolean (xlsx may return TRUE/FALSE string or 1/0 — handle both)
  - OBD Email Date, InvoiceDate: parse to Date if present, else null
  - All other fields: String or null if empty/missing

STEP B — Validate each header row.
  For each OBD:
  1. If obdNumber already exists in orders table → rowStatus = "duplicate"
  2. Else if shipToCustomerId not found in delivery_point_master.customerCode → rowStatus = "error", rowError = "Unknown customer: " + shipToCustomerId
  3. Else → rowStatus = "valid"

  Run both checks in two bulk queries (not N+1):
  - const existingOrders = await prisma.orders.findMany({ where: { obdNumber: { in: allObdNumbers } }, select: { obdNumber: true } })
  - const knownCustomers = await prisma.delivery_point_master.findMany({ where: { customerCode: { in: allCustomerIds } }, select: { customerCode: true } })

STEP C — Validate each line item row.
  For each line:
  1. If skuCodeRaw not found in sku_master.skuCode → rowStatus = "error", rowError = "Unknown SKU: " + skuCodeRaw
  2. Else → rowStatus = "valid"

  Use one bulk query:
  - const knownSkus = await prisma.sku_master.findMany({ where: { skuCode: { in: allSkuCodes } }, select: { skuCode: true } })

STEP D — Generate batchRef.
  Format: "BATCH-YYYYMMDD-NNN"
  NNN = count of import_batches created today + 1, zero-padded to 3 digits.
  Query: prisma.import_batches.count({ where: { createdAt: { gte: startOfToday } } })

STEP E — Write to DB in a single Prisma transaction:
  1. Create import_batches row (status = "processing")
  2. For each header row: create import_raw_summary row linked to batchId
  3. For each line item row: create import_raw_line_items row linked to rawSummaryId
     (match obd_number from line item → obdNumber from header to find rawSummaryId)
     If a line's obd_number has no matching header row → rowStatus = "error", rowError = "No matching OBD header"

STEP F — Build and return ImportPreviewResponse.
  orderType per OBD: if any line for that OBD has isTinting = true → "tint" else "non_tint"
  tintLineCount: count of lines with isTinting = true for that OBD
  Return HTTP 200 with the full payload.

━━━ ENDPOINT 2: POST /api/import/obd?action=confirm ━━━

Input: JSON body matching ImportConfirmBody.

STEP A — Load confirmed raw rows.
  Fetch all import_raw_summary where id IN confirmedObdIds AND rowStatus != "duplicate".
  Fetch all their import_raw_line_items where rowStatus = "valid".

STEP B — Load slot rules for enrichment.
  For each OBD, we need the delivery type to look up slot rules.
  Lookup: delivery_point_master WHERE customerCode = shipToCustomerId → get areaId → get area.deliveryTypeId (or deliveryTypeOverrideId if set).
  If customer not found → use Local delivery type as fallback.

  Load delivery_type_slot_config with slot relation for relevant delivery types.

STEP C — Determine slot per OBD.
  Parse obdEmailTime (String "HH:MM") into hours and minutes.
  Compare against slotRules for that delivery type in sortOrder:
    For each rule where slotRuleType = "time_based":
      if obdEmailTime >= windowStart AND obdEmailTime < windowEnd → use this slot
    If no time_based rule matches → use the rule where isDefault = true
  If obdEmailDate or obdEmailTime is null → use the isDefault = true rule.

  dispatchSlot = slot.name (e.g. "Morning 10:30")
  dispatchSlotDeadline = obdEmailDate combined with slot.slotTime as DateTime.
    If slot.isNextDay = true → add 1 day to obdEmailDate.

STEP D — Determine orderType and workflowStage per OBD.
  orderType: ANY line has isTinting = true → "tint" else "non_tint"
  workflowStage: orderType = "tint" → "pending_tint_assignment" else "pending_support"

STEP E — Write everything in a single Prisma $transaction:
  For each confirmed OBD:

  a. Create orders row:
     {
       obdNumber, batchId,
       customerId (from delivery_point_master lookup — null if not found),
       shipToCustomerId, shipToCustomerName,
       orderType, workflowStage,
       dispatchSlot, dispatchSlotDeadline,
       priorityLevel: 3,  // default Normal
       invoiceNo, invoiceDate, obdEmailDate,
       sapStatus, materialType, natureOfTransaction, warehouse,
       totalUnitQty, grossWeight, volume
     }

  b. For each valid line item of this OBD:
     - Fetch sku_master WHERE skuCode = skuCodeRaw (use the preloaded map — not N+1)
     - lineWeight = unitQty × sku.grossWeightPerUnit
     - Create import_enriched_line_items row

  c. Create import_obd_query_summary row:
     {
       obdNumber,
       orderId: order.id,
       totalLines: validLines.length,
       totalUnitQty: sum of line.unitQty,
       totalWeight: sum of lineWeight,
       totalVolume: sum of line.volumeLine (treat null as 0),
       hasTinting: orderType === "tint"
     }

  d. Create order_status_logs row (INSERT-ONLY — never skip this):
     {
       orderId: order.id,
       fromStage: null,
       toStage: workflowStage,
       changedById: session.user.id,
       note: `Created via import batch ${batchRef}`
     }

  After all OBDs processed — still inside the transaction:
  e. Update import_batches:
     {
       status: "completed",
       totalObds: confirmedObdIds.length,
       skippedObds: count of rowStatus = "duplicate" in this batch,
       failedObds: count of rowStatus = "error" in this batch
     }

STEP F — Return ImportConfirmResponse.
  ordersCreated = count of orders created
  linesEnriched = count of import_enriched_line_items created

━━━ ERROR HANDLING ━━━
- Wrap entire confirm transaction in try/catch.
- On any error: set import_batches.status = "failed", return HTTP 500 with { error: message }.
- Never leave partial data. The transaction must be fully atomic.
- On preview parse error (unparseable file): return HTTP 400 with { error: "Cannot parse file. Ensure the correct sheet names are present." }

━━━ AFTER BUILDING ━━━
Run: npx tsc --noEmit
Fix every TypeScript error. No 'any' types. All interfaces must match /lib/import-types.ts exactly.
```

**Test:** Use the provided OBD_Header.xlsx and Line_Items.xlsx sample files.
- Preview call: should return 6 OBDs, some valid, check rowStatus values match expectations.
- Confirm call with all valid OBD IDs: verify orders rows appear in Supabase.
- Confirm with empty array: should return 0 orders created without error.
- Duplicate test: import same file twice — second preview should show duplicate OBDs.

---

## STEP 3 — Import UI screen (/import)

**What this builds:** The shared import screen accessible to Admin, Dispatcher, and Support roles. Three-stage flow: upload → preview table → result.
**Dependency:** Step 2 API working and returning correct responses.
**Test:** Upload sample files. Preview shows correct table with status badges. Confirm creates orders. Result screen shows correct counts.

```
Read CLAUDE_CONTEXT.md fully. Import API is at /api/import/obd.

Build the OBD import screen as a shared route accessible to Admin, Dispatcher, and Support.

━━━ FILES TO CREATE ━━━
/app/(import)/layout.tsx               — route group layout
/app/(import)/import/layout.tsx        — import page layout with auth guard
/app/(import)/import/page.tsx          — main import page (client component)

━━━ LAYOUT ━━━
/app/(import)/import/layout.tsx:
  Auth guard: requireRole(session, ['Admin', 'Dispatcher', 'Support'])
  On fail: redirect to /unauthorized

  Full-width layout (no sidebar).
  Top header bar matching admin panel style:
  - Left: Orbit OMS logo/text in navy #1a237e
  - Center: "OBD Import" page title
  - Right: user name + role badge + sign-out button
  Background: slate-50. Main content area: centered, max-w-6xl, px-6 py-8.

━━━ STATE ━━━
All state is local React (useState). No external state library.

type Stage = 'upload' | 'preview' | 'result'

State variables:
  stage: Stage = 'upload'
  headerFile: File | null
  lineFile: File | null
  isLoading: boolean
  previewData: ImportPreviewResponse | null
  selectedIds: Set<number>   // rawSummaryId values of checked OBDs
  confirmResult: ImportConfirmResponse | null
  error: string | null

Import types from /lib/import-types.ts.

━━━ STAGE 1: Upload ━━━

Two drag-and-drop file upload zones displayed side by side (gap-6, each flex-1).

Each zone:
  - Dashed border (border-dashed border-2 border-slate-300)
  - rounded-xl, bg-white, p-8
  - Centered content: upload icon (lucide UploadCloud), label, format hint
  - onClick: trigger hidden <input type="file" accept=".xlsx,.xls">
  - onDragOver / onDrop: handle drag-and-drop
  - When file selected: show filename + formatted file size + remove (×) button
  - Hover state: border-[#1a237e] bg-blue-50

Left zone label: "OBD Header File"
Right zone label: "Line Items File"
Both: "Drag & drop or click to browse" · ".xlsx, .xls only"

Below the zones:
  "Preview Import" button (full width, navy bg):
  - Disabled if either file is null
  - Shows spinner when isLoading = true
  - On click: build FormData, POST /api/import/obd?action=preview
  - On success: set previewData, set stage = 'preview'
    Auto-select all valid OBDs: selectedIds = new Set(previewData.obds.filter(o => o.rowStatus === 'valid').map(o => o.rawSummaryId))
  - On error: set error message, show inline alert

━━━ STAGE 2: Preview ━━━

Summary bar — 5 stat pills in a row (shadcn/ui Badge or custom):
  Total OBDs (neutral) | Valid (green) | Duplicates (yellow) | Errors (red) | Total Lines (neutral)
  Values from previewData.summary.

Selection controls row (below summary bar):
  Left: "X of Y OBDs selected" label (update reactively as selectedIds changes)
  Right: "Select All Valid" button | "Deselect All" button

Main table (shadcn/ui Table):
Columns:
  □ Checkbox
  OBD Number
  Customer ID
  Customer Name
  OBD Date         (format: DD MMM YYYY or "—")
  Qty
  Weight (kg)
  Lines             (total / tint count e.g. "4 / 2 tint")
  Type              (Badge: TINT=blue, NON-TINT=slate)
  Status            (Badge: Valid=green, Duplicate=yellow, Error=red)

Checkbox behaviour:
  - rowStatus = "valid" → checked by default, can be unchecked
  - rowStatus = "duplicate" → unchecked, DISABLED (cannot be checked)
  - rowStatus = "error" → unchecked by default, CAN be checked (user may want to import despite unknown SKU — valid OBD header with all-error lines just creates an empty order)

Row background:
  valid → white (default)
  duplicate → bg-yellow-50
  error → bg-red-50

Expandable rows:
  Clicking anywhere on the row (not the checkbox) toggles expansion.
  Expanded content: nested table showing line items.
  Line items sub-table columns: Line ID | SKU Code | SKU Description | Qty | Tinting | Status
  Tinting: show badge (TINT / —)
  Status: 🟢 or 🔴 badge matching rowStatus

Action bar (sticky bottom or below table):
  Left: "← Back" button → sets stage = 'upload', clears state
  Right: "Confirm Import (X OBDs)" button
    - Disabled if selectedIds.size === 0
    - Shows spinner when isLoading = true
    - On click: POST /api/import/obd?action=confirm with { batchId: previewData.batchId, confirmedObdIds: Array.from(selectedIds) }
    - On success: set confirmResult, set stage = 'result'
    - On error: show inline error toast (do NOT navigate away)

━━━ STAGE 3: Result ━━━

Centered card (max-w-md, mx-auto, mt-16):
  Large green checkmark icon (lucide CheckCircle2, size 64, text-green-500)
  Heading: "Import Complete" (text-2xl font-medium)
  Batch reference: "Batch: BATCH-20260315-001" (monospace, text-slate-500)

  Stats grid (2×2):
    Orders Created  |  Lines Enriched
    Skipped (dupes) |  Errors

  Two buttons:
  - "Import Another Batch" → reset all state, set stage = 'upload'
  - "View Orders" → navigate to /support

━━━ DESIGN RULES ━━━
  - Follow existing admin panel design system exactly
  - Navy #1a237e for primary buttons and header
  - shadcn/ui Table, Badge, Button, Card, Checkbox components throughout
  - Table header: bg-slate-50, text-slate-600, text-sm
  - No scrollbars visible (overflow-hidden on outer containers, internal scroll where needed)
  - Consistent with admin panel table styling (reference /admin/customers/page.tsx)
  - Loading states on both preview and confirm buttons — never leave user without feedback
  - Error messages shown inline (red alert box below button), not as browser alerts

━━━ AFTER BUILDING ━━━
Run: npx tsc --noEmit
Fix every TypeScript error. No 'any'.
Report: files created, any issues.
```

**Test:**
- Upload OBD_Header.xlsx + Line_Items.xlsx → preview loads within 3 seconds.
- Summary bar shows correct counts.
- Duplicate rows are yellow and unchecked + disabled.
- Expand a row → line items sub-table appears.
- Deselect one valid OBD → counter updates to "X-1 of Y selected".
- Confirm → result screen shows correct counts.
- "Import Another Batch" → resets to upload stage.
- Upload same files again → preview shows all OBDs as duplicate.

---

## STEP 4 — Support screen (/support)

**What this builds:** Support role's primary screen. Shows all orders across all workflow stages. Allows setting dispatch_status, priority, and slot override per order.
**Dependency:** Step 3 complete. Orders exist in DB from import.
**Test:** Log in as Support. All orders visible. Set dispatch_status on one order. Verify order_status_logs row created.

```
Read CLAUDE_CONTEXT.md fully.

Build the Support order queue at /app/(support)/support/page.tsx

━━━ LAYOUT ━━━
/app/(support)/layout.tsx:
  requireRole(session, ['Support', 'Admin'])
  Full-width layout with header (same pattern as import screen header).
  Header: "Support Queue" page title.

━━━ DATA FETCHING ━━━
API: GET /api/support/orders
  Query params: stage, orderType, dispatchStatus, search, page, limit (25 per page)
  Returns: paginated orders with customer, querySnapshot, batch relations
  Include: orders.customer (customerName, area), orders.querySnapshot (totalWeight, hasTinting)
  Auth: requireRole(session, ['Support', 'Admin'])

━━━ SCREEN LAYOUT ━━━

Filter bar (above table):
  - Search (OBD number or customer name, debounced 300ms)
  - Workflow Stage filter (Select from status_master WHERE domain='workflow')
  - Order Type filter (Select: All | Tint | Non-Tint)
  - Dispatch Status filter (Select: All | null | hold | dispatch | waiting_for_confirmation)
  - "Clear filters" link

Stats row (4 cards):
  - Total orders | Pending support | Pending tint | On hold

Main table:
Columns:
  OBD Number
  Customer Name
  Area
  Weight (kg)      from querySnapshot.totalWeight
  Type             Badge: TINT / NON-TINT
  Workflow Stage   Badge styled per stage (use status_master label)
  Dispatch Status  Badge or "—"
  Priority         Badge: URGENT / NORMAL
  Slot             dispatch_slot value or "—"
  Actions          (Edit button → opens Sheet)

Clicking Edit opens a Sheet panel (right side, max-w-lg):
  Sheet title: OBD Number + Customer Name
  Read-only fields:
    - Order Type, Workflow Stage, Batch Ref, Invoice No, Created At
  
  Editable fields:
    1. Dispatch Status (Select):
       Options from status_master WHERE domain='dispatch': hold | dispatch | waiting_for_confirmation
       Nullable — "Not set" option included.
    
    2. Priority (Select):
       Options: Normal (priorityLevel=3) | Urgent (priorityLevel=2)
    
    3. Slot Override (Select):
       Options from slot_master WHERE isActive=true
       Shows current slot. Support can override to any slot.
       Helper text: "Overrides the auto-assigned slot. Audit trail is written."
    
    4. Note (Textarea, optional):
       Free text note written to order_status_logs.

  Save button:
    PATCH /api/support/orders/[id]
    Body: { dispatchStatus, priorityLevel, dispatchSlot, note }
    Server writes order_status_logs row for EVERY change (even if only one field changed).
    On save: close Sheet, refresh table row.

  Line items section (below editable fields, read-only):
    Shows import_enriched_line_items for this order joined via rawLineItem → rawSummary → obdNumber.
    Columns: SKU Code, Description, Qty, Weight, Tinting
    If no enriched lines: show "No line items found."

━━━ API ROUTES ━━━
/app/api/support/orders/route.ts — GET (list with filters + pagination)
/app/api/support/orders/[id]/route.ts — GET (single), PATCH (update)

PATCH logic (server-side):
  1. Load current order from DB.
  2. Detect which fields changed (dispatchStatus, priorityLevel, dispatchSlot).
  3. For each changed field, write one order_status_logs row:
     { orderId, fromStage: currentValue, toStage: newValue, changedById, note }
  4. If dispatchStatus changing TO 'hold' AND order is on a dispatch plan:
     Write a dispatch_change_queue row to notify Dispatcher. (Stub this — just create the row, no UI yet.)
  5. Update orders row.

requireRole: ['Support', 'Admin'] on all routes.

━━━ AFTER BUILDING ━━━
Run: npx tsc --noEmit
Fix all errors.
```

**Test:** Import a batch (Step 3). Go to /support. All orders visible. Filter by "Pending Support". Open an order → set dispatch_status to "hold". Verify in Supabase: orders row updated, order_status_logs row created with fromStage=null, toStage="hold".

---

## STEP 5 — Tint Manager screen (/tint/manager)

**What this builds:** Tint Manager's Kanban view. Shows all tint orders. Assigns tint operators to orders.
**Dependency:** Step 3 complete. Tint orders exist in DB.
**Test:** Log in as Tint Manager. Tint orders visible in Kanban. Assign operator. Verify tint_assignments + tint_logs rows created.

```
Read CLAUDE_CONTEXT.md fully.

Build the Tint Manager Kanban at /app/(tint)/tint/manager/page.tsx

━━━ LAYOUT ━━━
/app/(tint)/layout.tsx:
  requireRole(session, ['Tint Manager', 'Admin'])
  Header: same pattern. Title: "Tint Operations"

━━━ DATA ━━━
API: GET /api/tint/manager/orders
  Returns all orders where orderType = 'tint'
  Include: customer, querySnapshot, tintAssignments (with assignedTo user name)
  Auth: requireRole(['Tint Manager', 'Admin'])

API: GET /api/tint/manager/operators
  Returns all users WHERE role.name = 'Tint Operator' AND isActive = true
  Returns: { id, name }

━━━ KANBAN LAYOUT ━━━
Three columns side by side (flex, gap-4):

Column 1: "Pending Assignment" (workflowStage = 'pending_tint_assignment')
Column 2: "In Progress" (workflowStage = 'tinting_in_progress')
Column 3: "Done" (workflowStage = 'tinting_done')

Each column:
  - Header with column label + count badge
  - bg-slate-100 background, rounded-xl, p-3
  - Scrollable card list inside

Each order card:
  - bg-white, rounded-lg, p-3, shadow-sm
  - OBD Number (font-mono, bold)
  - Customer name
  - Weight (from querySnapshot.totalWeight)
  - Assigned to: operator name + avatar initial, or "Unassigned" in red if no assignment
  - Time since order_created (e.g. "2h ago")
  - Click → opens Assignment Sheet

Assignment Sheet (right panel):
  Order details (read-only):
    OBD Number, Customer, Area, Weight, Line count, Created at
  
  Line items (read-only list):
    SKU Code | Description | Qty | Tinting badge
  
  Assignment section:
    "Assign to Operator" Select:
      Options: all active Tint Operators (from /api/tint/manager/operators)
      Pre-selected if already assigned.
    
    Note field (optional textarea)
    
    "Assign" button:
      POST /api/tint/manager/assign
      Body: { orderId, assignedToId, note }
      
      Server actions:
      1. Create tint_assignments row { orderId, assignedToId, assignedById: session.user.id, status: 'assigned' }
      2. Update orders.workflowStage = 'pending_tint_assignment' (keep — operator will move to in_progress)
      3. INSERT tint_logs row { orderId, action: 'assigned', performedById: session.user.id, note }
      4. INSERT order_status_logs row { orderId, fromStage: current, toStage: 'pending_tint_assignment', changedById, note: 'Assigned to ' + operatorName }
      
      On success: close Sheet, refresh board.

━━━ AFTER BUILDING ━━━
Run: npx tsc --noEmit
Fix all errors.
```

**Test:** Import a tint order batch. Go to /tint/manager. Tint orders appear in "Pending Assignment" column. Assign to a Tint Operator. Verify tint_assignments row + tint_logs row in Supabase.

---

## STEP 6 — Tint Operator screen (/tint/operator)

**What this builds:** Tint Operator's personal work queue. Shows only orders assigned to them. Start and Done actions.
**Dependency:** Step 5 complete. Assignments exist.
**Test:** Log in as Tint Operator. Only assigned orders visible. Click Start → workflowStage changes. Click Done → workflowStage moves to pending_support.

```
Read CLAUDE_CONTEXT.md fully.

Build the Tint Operator screen at /app/(tint)/tint/operator/page.tsx

━━━ LAYOUT ━━━
Reuse /app/(tint)/layout.tsx (already created in Step 5).
Override requireRole for operator: requireRole(session, ['Tint Operator'])
Title: "My Tint Jobs"

━━━ DATA ━━━
API: GET /api/tint/operator/my-orders
  Returns: all orders where:
    tintAssignments.some(a => a.assignedToId = session.user.id AND a.status != 'done')
  Include: customer, querySnapshot, tintAssignments (filtered to current user's assignment)
  Auth: requireRole(['Tint Operator'])

━━━ SCREEN ━━━
Simple list layout (no Kanban — operator sees only their queue).

Stats bar: count of Assigned | In Progress | Done Today

Order cards in two sections:
  Section 1: "In Progress" (workflowStage = 'tinting_in_progress') — shown first, highlighted
  Section 2: "To Do" (workflowStage = 'pending_tint_assignment')

Each card:
  - OBD Number (mono), Customer name, Weight
  - Time assigned ("Assigned 45min ago")
  - Line items summary: "3 lines · 2 tint"
  
  Buttons (conditionally shown):
  - workflowStage = 'pending_tint_assignment' → "Start" button (primary)
  - workflowStage = 'tinting_in_progress' → "Mark Done" button (green)

━━━ START ACTION ━━━
POST /api/tint/operator/start
Body: { orderId }
Auth: requireRole(['Tint Operator'])

Server:
1. Verify the requesting user is the assignedTo for this order.
2. Update tint_assignments: { status: 'in_progress', startedAt: now() }
3. Update orders.workflowStage = 'tinting_in_progress'
4. INSERT tint_logs { orderId, action: 'started', performedById }
5. INSERT order_status_logs { orderId, fromStage: 'pending_tint_assignment', toStage: 'tinting_in_progress', changedById }

━━━ DONE ACTION ━━━
POST /api/tint/operator/done
Body: { orderId }
Auth: requireRole(['Tint Operator'])

Server:
1. Verify the requesting user is the assignedTo for this order.
2. Update tint_assignments: { status: 'done', completedAt: now() }
3. Update orders.workflowStage = 'tinting_done'
4. THEN immediately: Update orders.workflowStage = 'pending_support'
   (tinting_done is transient — order moves directly to pending_support)
5. INSERT tint_logs { orderId, action: 'completed', performedById }
6. INSERT order_status_logs { orderId, fromStage: 'tinting_in_progress', toStage: 'pending_support', changedById, note: 'Tinting completed' }

━━━ AFTER BUILDING ━━━
Run: npx tsc --noEmit
Fix all errors.
```

**Test:** Assign an order to Tint Operator (Step 5). Log in as that operator. Order appears in "To Do". Click Start → moves to "In Progress", workflowStage = 'tinting_in_progress' in DB. Click Done → disappears from queue, workflowStage = 'pending_support' in DB. Verify tint_logs has 'started' and 'completed' rows.

---

## STEP 7 — Final Phase 2 wiring + validation

**What this builds:** Navigation links between screens, sidebar updates, TypeScript clean, Phase 2 sign-off.
**Dependency:** All Steps 1–6 complete.
**Test:** Zero TypeScript errors. All Phase 2 screens accessible by correct roles. Audit trails correct.

```
Read CLAUDE_CONTEXT.md fully. Final Phase 2 wiring checklist. Execute in order:

1. Update admin sidebar (/components/admin/admin-sidebar.tsx):
   Add navigation items for Phase 2 screens (visible to correct roles based on session):
   - "Import Orders" → /import (show for Admin, Dispatcher, Support)
   - "Support Queue" → /support (show for Support, Admin)
   - "Tint Manager" → /tint/manager (show for Tint Manager, Admin)
   - "Tint Jobs" → /tint/operator (show for Tint Operator)

2. Update /app/(admin)/admin/page.tsx dashboard:
   Add 2 new stat cards:
   - Orders Today: count of orders created today
   - Pending Support: count of orders WHERE workflowStage = 'pending_support'
   Keep all existing 6 stat cards.

3. Create /app/support/page.tsx redirect:
   Simple redirect to /support (the (support) route group) for backward compatibility.
   Also create /app/orders/page.tsx → redirect to /support.

4. Run full validation:
   npx tsc --noEmit
   Fix EVERY TypeScript error before continuing.

5. Run: npx prisma validate
   Must exit clean.

6. Audit trail spot-check — verify in Supabase Studio:
   □ Every order has at least one order_status_logs row (created at import)
   □ Every tint action has a tint_logs row
   □ No updates or deletes on tint_logs or order_status_logs tables

7. Role access check — test each route with wrong role:
   □ /import with Tint Operator → /unauthorized
   □ /support with Picker → /unauthorized
   □ /tint/operator with Dispatcher → /unauthorized
   □ /tint/manager with Tint Operator → /unauthorized

8. Confirm no hardcoded:
   □ Slot times (must come from slot_master)
   □ Status strings not queried from status_master (inline string values on orders fields are OK — status_master is for display/UI, orders.workflowStage stores string directly)
   □ No dispatch_cutoff_time references (removed in v10)

9. Report: files created in Phase 2, any remaining issues, what Phase 3 will build.
```

**Test:** `npx tsc --noEmit` exits clean. `npx prisma validate` exits clean. Full import-to-support flow works end to end: import → support sees order → set dispatch → tint assigned → operator completes → order reaches pending_support.

---

## APPENDIX A — Phase 2 API route summary

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | /api/import/obd?action=preview | Admin, Dispatcher, Support | Parse XLS, write raw, return preview |
| POST | /api/import/obd?action=confirm | Admin, Dispatcher, Support | Write enriched, create orders |
| GET | /api/support/orders | Support, Admin | List all orders with filters |
| GET | /api/support/orders/[id] | Support, Admin | Single order with line items |
| PATCH | /api/support/orders/[id] | Support, Admin | Update dispatchStatus, priority, slot |
| GET | /api/tint/manager/orders | Tint Manager, Admin | All tint orders |
| GET | /api/tint/manager/operators | Tint Manager, Admin | Active tint operators |
| POST | /api/tint/manager/assign | Tint Manager, Admin | Create tint_assignments row |
| GET | /api/tint/operator/my-orders | Tint Operator | Own assigned orders only |
| POST | /api/tint/operator/start | Tint Operator | Start tinting |
| POST | /api/tint/operator/done | Tint Operator | Complete tinting |

---

## APPENDIX B — Import pipeline data flow

```
OBD_Header.xlsx           Line_Items.xlsx
(sheet: LogisticsTrackerWareHouse)  (sheet: Sheet1)
        ↓                           ↓
   [Parse + validate]         [Parse + validate]
        ↓                           ↓
import_raw_summary     import_raw_line_items
(18 cols mapped)        (8 cols mapped)
        ↓                           ↓
        ← ← [User reviews preview] → →
                     ↓
              [User confirms]
                     ↓
        import_enriched_line_items
        (SKU join, lineWeight computed)
                     ↓
        import_obd_query_summary
        (totals: weight, qty, volume)
                     ↓
               orders row
        (workflowStage + dispatchSlot set)
                     ↓
           order_status_logs
        (INSERT-ONLY audit trail)
                     ↓
         ┌──────────────────┐
         ↓                  ↓
  pending_tint_      pending_support
   _assignment       (non-tint orders)
  (tint orders)
```

---

## APPENDIX C — Slot calculation pseudocode

```typescript
function determineSlot(obdEmailDate: Date | null, obdEmailTime: string | null, slotRules: SlotRule[]): SlotResult {
  const defaultRule = slotRules.find(r => r.isDefault)

  if (!obdEmailDate || !obdEmailTime) {
    return buildResult(defaultRule, obdEmailDate)
  }

  const [hours, minutes] = obdEmailTime.split(':').map(Number)
  const timeMinutes = hours * 60 + minutes

  const timeBased = slotRules
    .filter(r => r.slotRuleType === 'time_based')
    .sort((a, b) => a.sortOrder - b.sortOrder)

  for (const rule of timeBased) {
    const start = timeToMinutes(rule.windowStart)
    const end = timeToMinutes(rule.windowEnd)
    if (timeMinutes >= start && timeMinutes < end) {
      return buildResult(rule, obdEmailDate)
    }
  }

  return buildResult(defaultRule, obdEmailDate)
}

function buildResult(rule: SlotRule, obdEmailDate: Date | null): SlotResult {
  const deadline = obdEmailDate
    ? new Date(obdEmailDate)
    : new Date()

  const [slotHours, slotMinutes] = rule.slot.slotTime.split(':').map(Number)
  if (rule.slot.isNextDay) deadline.setDate(deadline.getDate() + 1)
  deadline.setHours(slotHours, slotMinutes, 0, 0)

  return { dispatchSlot: rule.slot.name, dispatchSlotDeadline: deadline }
}
```

---

*Phase 2 Build Guide · Schema v11 · March 2026*
*Depends on: CLAUDE_CONTEXT.md · Config Master v2*