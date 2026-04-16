-- 1. Enums
CREATE TYPE tinter_type AS ENUM ('TINTER', 'ACOTONE');
CREATE TYPE pack_code AS ENUM ('500ml', '1L', '4L', '10L', '20L');

-- 2. Patch existing tinter_issue_entries
ALTER TABLE tinter_issue_entries
  ADD COLUMN "tinterType" tinter_type NOT NULL DEFAULT 'TINTER',
  ADD COLUMN "packCode"   pack_code   NULL;

-- 3. tinter_issue_entries_b (Acotone)
CREATE TABLE tinter_issue_entries_b (
  id                  SERIAL PRIMARY KEY,
  "orderId"           INTEGER NOT NULL REFERENCES orders(id),
  "splitId"           INTEGER REFERENCES order_splits(id),
  "tintAssignmentId"  INTEGER REFERENCES tint_assignments(id),
  "submittedById"     INTEGER NOT NULL REFERENCES users(id),
  "baseSku"           TEXT NOT NULL,
  "tinQty"            DECIMAL(10,3) NOT NULL DEFAULT 0,
  "packCode"          pack_code NULL,
  "YE2"  DECIMAL(10,3) NOT NULL DEFAULT 0,
  "YE1"  DECIMAL(10,3) NOT NULL DEFAULT 0,
  "XY1"  DECIMAL(10,3) NOT NULL DEFAULT 0,
  "XR1"  DECIMAL(10,3) NOT NULL DEFAULT 0,
  "WH1"  DECIMAL(10,3) NOT NULL DEFAULT 0,
  "RE2"  DECIMAL(10,3) NOT NULL DEFAULT 0,
  "RE1"  DECIMAL(10,3) NOT NULL DEFAULT 0,
  "OR1"  DECIMAL(10,3) NOT NULL DEFAULT 0,
  "NO2"  DECIMAL(10,3) NOT NULL DEFAULT 0,
  "NO1"  DECIMAL(10,3) NOT NULL DEFAULT 0,
  "MA1"  DECIMAL(10,3) NOT NULL DEFAULT 0,
  "GR1"  DECIMAL(10,3) NOT NULL DEFAULT 0,
  "BU2"  DECIMAL(10,3) NOT NULL DEFAULT 0,
  "BU1"  DECIMAL(10,3) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "tie_b_split_xor_assignment" CHECK (
    NOT ("splitId" IS NOT NULL AND "tintAssignmentId" IS NOT NULL)
  )
);

-- 4. shade_master
CREATE TABLE shade_master (
  id                    SERIAL PRIMARY KEY,
  "shadeName"           TEXT NOT NULL,
  "shipToCustomerId"    TEXT NOT NULL,
  "shipToCustomerName"  TEXT NOT NULL,
  "tinterType"          tinter_type NOT NULL,
  "packCode"            pack_code NOT NULL,
  "baseSku"             TEXT NOT NULL,
  "tinQty"              DECIMAL(10,3) NOT NULL DEFAULT 0,
  "YOX"  DECIMAL(10,3), "LFY"  DECIMAL(10,3), "GRN"  DECIMAL(10,3),
  "TBL"  DECIMAL(10,3), "WHT"  DECIMAL(10,3), "MAG"  DECIMAL(10,3),
  "FFR"  DECIMAL(10,3), "BLK"  DECIMAL(10,3), "OXR"  DECIMAL(10,3),
  "HEY"  DECIMAL(10,3), "HER"  DECIMAL(10,3), "COB"  DECIMAL(10,3),
  "COG"  DECIMAL(10,3),
  "YE2"  DECIMAL(10,3), "YE1"  DECIMAL(10,3), "XY1"  DECIMAL(10,3),
  "XR1"  DECIMAL(10,3), "WH1"  DECIMAL(10,3), "RE2"  DECIMAL(10,3),
  "RE1"  DECIMAL(10,3), "OR1"  DECIMAL(10,3), "NO2"  DECIMAL(10,3),
  "NO1"  DECIMAL(10,3), "MA1"  DECIMAL(10,3), "GR1"  DECIMAL(10,3),
  "BU2"  DECIMAL(10,3), "BU1"  DECIMAL(10,3),
  "createdById"  INTEGER NOT NULL REFERENCES users(id),
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "shade_master_unique"
    UNIQUE ("shipToCustomerId", "shadeName", "packCode", "tinterType")
);

CREATE INDEX "idx_shade_master_lookup"
  ON shade_master ("shipToCustomerId", "tinterType")
  WHERE "isActive" = true;
```

Run it, confirm no errors, then come back here.

---

## STEP 2 — Claude Code prompt (paste after SQL succeeds)
```
Read CLAUDE_CONTEXT.md fully before doing anything else.

We are adding the Shade Master / Shade Memory feature to the Tint Operator screen.
The Supabase SQL has already been executed. The following now exist in the database:
- Enum: tinter_type ('TINTER', 'ACOTONE')
- Enum: pack_code ('500ml', '1L', '4L', '10L', '20L')
- tinter_issue_entries has two new columns: tinterType (tinter_type, default TINTER), packCode (pack_code, nullable)
- New table: tinter_issue_entries_b (Acotone TI entries, 14 shade columns: YE2 YE1 XY1 XR1 WH1 RE2 RE1 OR1 NO2 NO1 MA1 GR1 BU2 BU1)
- New table: shade_master (shadeName, shipToCustomerId, shipToCustomerName, tinterType, packCode, baseSku, tinQty, all 13 TINTER columns + all 14 ACOTONE columns, createdById, isActive)

─── TASK 1: PRISMA SCHEMA ───────────────────────────────────────────────────

Add the following to prisma/schema.prisma:

1. Add enums:
   enum TinterType { TINTER ACOTONE }
   enum PackCode { ml_500 "500ml"  L_1 "1L"  L_4 "4L"  L_10 "10L"  L_20 "20L" }
   Note: use @map for the string values that start with numbers.

2. Add tinterType and packCode fields to the existing TinterIssueEntry model.

3. Add new model TinterIssueEntryB with all fields matching tinter_issue_entries_b.
   Relations: orderId → Order, splitId → OrderSplit (optional),
   tintAssignmentId → TintAssignment (optional), submittedById → User.

4. Add new model ShadeMaster with all fields matching shade_master.
   Relation: createdById → User.

Run:
  npx prisma validate
  npx tsc --noEmit

Fix any type errors. Report back with confirmation that both commands exit clean.

─── TASK 2: API ROUTES ──────────────────────────────────────────────────────

Create the following API routes:

1. GET /api/tint/operator/shades
   - Auth: Operator, TintManager, Admin
   - Query params: shipToCustomerId (required), tinterType (required)
   - Returns all shade_master records where shipToCustomerId matches,
     tinterType matches, isActive = true
   - Order by shadeName ASC
   - Return full record (all columns) so frontend can auto-fill without
     a second call

2. POST /api/tint/operator/shades
   - Auth: Operator, TintManager, Admin
   - Body: full shade_master payload (shadeName, shipToCustomerId,
     shipToCustomerName, tinterType, packCode, baseSku, tinQty,
     + relevant shade columns for the tinterType)
   - Check for existing record with same shipToCustomerId + shadeName
     + packCode + tinterType
   - If exists → return 409 with body: { conflict: true, existingId: id, shadeName }
   - If not exists → insert and return 201

3. PUT /api/tint/operator/shades/[id]
   - Auth: Operator, TintManager, Admin
   - Body: same as POST
   - Find shade_master by id, update all formula fields + updatedAt
   - Return 200

4. POST /api/tint/operator/tinter-issue-b
   - Auth: Operator
   - Mirrors existing /api/tint/operator/tinter-issue exactly,
     but writes to tinter_issue_entries_b instead
   - Same logic: accepts array of entries, sets tiSubmitted = true
     on the split or tintAssignment after insert
   - Body: { splitId?, tintAssignmentId?, entries: [{ baseSku, tinQty,
     packCode, YE2, YE1, XY1, XR1, WH1, RE2, RE1, OR1, NO2, NO1,
     MA1, GR1, BU2, BU1 }] }

5. GET /api/tint/operator/tinter-issue-b/[id]
   - Auth: Operator
   - Mirrors existing /api/tint/operator/tinter-issue/[id]
   - [id] is splitId or tintAssignmentId depending on query param
     ?type=split or ?type=assignment
   - Returns all tinter_issue_entries_b rows for that job

6. GET /api/admin/shades
   - Auth: Admin
   - Paginated (page, limit query params, default limit 50)
   - Filters: tinterType, packCode, shipToCustomerId (all optional)
   - Returns shade_master rows with createdBy user name joined

7. PATCH /api/admin/shades/[id]
   - Auth: Admin
   - Body: { isActive: boolean }
   - Toggles isActive on shade_master record

─── TASK 3: UI — TINT OPERATOR TI FORM ─────────────────────────────────────

The existing TI form is in the tint operator screen. Extend it as follows.
Do NOT break the existing Tinter (TINTER) flow — it must continue to work.

3a. TINTER SELECTOR
- Add at the very top of the TI form, before all other fields
- Two large toggle/segmented buttons: "Tinter" and "Acotone"
- Default: "Tinter" selected (preserves existing behaviour)
- Selecting Acotone switches the shade columns section to the
  14 Acotone columns (YE2, YE1, XY1, XR1, WH1, RE2, RE1, OR1,
  NO2, NO1, MA1, GR1, BU2, BU1)
- Selecting Tinter shows the existing 13 columns
- Switching tinter type clears all shade column values and
  clears any selected shade from the shade selector

3b. SHADE SELECTOR
- Appears below the tinter selector, above baseSku/tinQty
- Label: "Saved Shade (optional)"
- shadcn/ui Combobox (searchable select)
- On mount: call GET /api/tint/operator/shades with
  shipToCustomerId from the order and the selected tinterType
- Each option displays: "{shadeName} · {packCode}"
- If no results: show muted text "No saved shades for this customer"
  and disable the combobox
- On selection: auto-fill baseSku, tinQty, packCode, and all
  shade columns instantly from the selected shade record
- Apply bg-amber-50 border-amber-300 to all filled inputs for
  1500ms then fade back to normal (use a setTimeout + className toggle)
- Show a "Clear" link next to the combobox to reset all fields
  to empty without page refresh

3c. PACK CODE FIELD
- Add a packCode Select (shadcn/ui) in the same row as baseSku and tinQty
- Options: 500ml, 1L, 4L, 10L, 20L
- Required field — validate before submit

3d. SAVE AS SHADE TOGGLE
- Place between the last shade column input and the Submit button
- shadcn/ui Switch labeled "Save as shade formula"
- When toggled ON: animate-in a text input below it labeled "Shade name"
  (use transition-all + max-height or opacity transition)
- Submit button disabled if toggle is ON and shade name is empty
- On submit with toggle ON:
  - POST /api/tint/operator/shades
  - If 409 → show shadcn/ui AlertDialog:
    "Shade '[name]' already exists for this customer with this
    pack size. Overwrite it?"
    Buttons: Cancel | Overwrite
  - If Overwrite confirmed → PUT /api/tint/operator/shades/[existingId]
  - Then proceed with normal TI form submission

3e. FORM SUBMISSION
- If tinterType = TINTER → POST /api/tint/operator/tinter-issue (existing)
  Include packCode in the payload
- If tinterType = ACOTONE → POST /api/tint/operator/tinter-issue-b (new)

─── TASK 4: ADMIN SHADES SCREEN ─────────────────────────────────────────────

Create page: /admin/shades
Route group: (admin) layout (existing admin sidebar)

- Page title: "Shade Master"
- Filters row: Tinter Type (All / Tinter / Acotone) | Pack Code (All / 500ml / 1L / 4L / 10L / 20L) | Search by customer ID or shade name
- Table columns: Shade Name | Customer ID | Customer Name | Tinter | Pack | Base SKU | Tin Qty | Created By | Created At | Active (toggle)
- Active toggle calls PATCH /api/admin/shades/[id] inline
- Pagination: 50 per page
- No create button — shades are created only from the operator TI form

─── CONSTRAINTS ─────────────────────────────────────────────────────────────
- Next.js 14 App Router, TypeScript strict, Tailwind + shadcn/ui, Prisma
- Do not install any new libraries
- All Prisma enum values that start with numbers must use @map
- Run npx tsc --noEmit after all changes and confirm clean before reporting done