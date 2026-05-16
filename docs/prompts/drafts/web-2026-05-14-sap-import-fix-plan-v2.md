# SAP Import Fix Plan — v2

**Date:** 2026-05-14
**Author:** Claude (planning session) for Smart Flow
**Target session:** Implementation (new web session → drafts Claude Code prompts → depot PC executes)
**Goal:** Fully working SAP manual import with new file layout, no duplicate SKU grouping, batch + weights stored per line, by tomorrow morning.

**Changelog from v1:**
- Fixed schema field names (`billToCustomerId` etc. — v1 used wrong names)
- Corrected `applyRules` return shape in §4.4 snippet
- Added note that 6 duplicate-SKU cases were verified in planning session against the sample XLSX
- Added explicit list of parser features intentionally dropped in §4.4
- Removed Auto-Import orphan warning (confirmed: no existing data, clean slate)

---

## 1. Context for the implementation session

### 1.1 Why this work exists

Two related problems in the manual SAP import flow:

1. **Column mismap.** The current SAP parser was built for the OLD SAP export layout. SAP has changed the export — the new file has 19 columns with different positions, plus a new Batch column. The parser reads columns by position, not by header text, so every field lands in the wrong DB column. Today the parser throws "missing column 24, 25" before any row is imported.

2. **Duplicate SKU grouping.** The current parser groups rows by Material (SKU) and sums quantities. We don't want this. Auto-Import already does 1:1 per-row passthrough — SAP import needs the same fix.

Auto-Import is currently paused. SAP-only is the active import path for tomorrow's users.

**Important:** `import_raw_line_items` and `import_raw_summary` are currently empty (no production data yet). Tonight's first SAP upload writes the first-ever rows. Clean slate.

### 1.2 What's already been decided (do not re-discuss these)

| Decision | Locked answer |
|----------|---------------|
| Pre-filter rule | Drop rows where `Delivery Type ≠ LF` AND drop rows where `Qty = 0` |
| Grouping | None. Every source row that survives the filter = one DB row |
| Patch matching key | Composite `(lineId, skuCodeRaw)` |
| Orphan rows on re-import | Mark `lineStatus = 'removed'` with `removedAt`, `removedReason` (don't hard-delete) |
| SO number field | `soNumber` (already exists on `import_raw_summary`) |
| Batch field | `batchCode` (already exists on `import_raw_line_items` as `String?`) |
| Net + Total weight on lines | Add two new nullable Float columns: `netWeight`, `totalWeight` |
| Summary `grossWeight` | Keep as-is. Parser auto-sums line `totalWeight` into it |
| Tint Operator shade auto-match | Known minor regression on duplicate-SKU lines (auto-fills first only). Not fixing in this round |

### 1.3 Files involved (confirmed paths)

- SAP route handlers: `app/api/import/obd/route.ts` — handlers `handleManualSapPreview` (line ~1245) and `handleManualSapConfirm` (line ~1380)
- Parser package: `lib/sap-parser/` (7 files — `index.ts`, `read-sheet.ts`, `group-rows.ts`, `apply-rules.ts`, `build-obd.ts`, `cells.ts`, `types.ts`)
- Upsert brain: `lib/import-upsert.ts` + `lib/import-upsert/` (7 files — `audit.ts`, `effects.ts`, `header.ts`, `helpers.ts`, `lines.ts`, `state.ts`, `types.ts`)
- Schema: `prisma/schema.prisma` — models `import_raw_summary` (lines 474–502), `import_raw_line_items` (lines 504–529)
- Admin UI: `components/import/sap-preview.tsx`, `components/import/import-modal.tsx`, `components/import/import-page-content.tsx`
- Sample SAP file (new layout): `docs/sample/sap-new-layout.XLSX` — 495 rows, 114 OBDs
- Auto-Import reference (paused): `docs/sample/Auto-Import.ps1` — reference only, no edits

### 1.4 Locked column mapping for new SAP layout

Schema field names below are the **actual** column names in `import_raw_summary` (per schema lines 490–493 and confirmed against auto-import payload at `route.ts:2447-2450` and `headerRowToObdInput` at `route.ts:2219-2222`).

| SAP Col | Header | OrbitOMS field | Table | Notes |
|---------|--------|----------------|-------|-------|
| 1 | Delivery | `obdNumber` | summary + lines | |
| 2 | Shipping Point/Receiving Pt | `warehouse` | summary | |
| 3 | Storage Location | ignore | — | |
| 4 | Division | `smu` | summary | Via existing division→SMU lookup |
| 5 | Sold-To Party | `billToCustomerId` | summary | String |
| 6 | Name of sold-to party | `billToCustomerName` | summary | |
| 7 | Ship-To Party | `shipToCustomerId` | summary | String |
| 8 | Name of the ship-to party | `shipToCustomerName` | summary | |
| 9 | Reference Document | `soNumber` | summary | String, NOT int. Same field auto-import + mail orders use |
| 10 | Delivery Type | filter only | — | Keep only `LF` rows |
| 11 | Item category | `isTinting` derivation | lines | `isTinting = (cat == 'Z007')` |
| 12 | Item | `lineId` | lines | Integer |
| 13 | Material | `skuCodeRaw` | lines | String, no trim/transform |
| 14 | Description | `skuDescriptionRaw` | lines | |
| 15 | Delivery quantity | `unitQty` | lines | Integer |
| 16 | Volume | `volumeLine` | lines | Float |
| 17 | Net weight | `netWeight` | lines | Float, **new column** |
| 18 | Total Weight | `totalWeight` | lines | Float, **new column** |
| 19 | Batch | `batchCode` | lines | String, empty → null |

### 1.5 Expected result with sample file

**Verified in planning session against `docs/sample/sap-new-layout.XLSX`:**

- Total source rows: 495 across 114 OBDs
- After `Delivery Type ≠ LF` filter: 470 rows kept (25 dropped — all ZLR)
- After `Qty = 0` filter: 260 rows kept across 98 OBDs (210 zero-qty rows dropped)
- 6 duplicate-SKU cases in surviving rows — all must persist as separate DB rows after import

The 6 duplicate-SKU cases (verified in planning session):

| OBD | SKU | Count | lineIds | Batches |
|-----|-----|-------|---------|---------|
| 9106995963 | IN70270181 | 2 | 10, 20 | both blank |
| 9106995962 | 5911947 | 2 | 10, 30 | both blank |
| 9107008468 | 5853011 | 2 | 900001, 900002 | T20260301, T20260401 |
| 9107008767 | 5852573 | 2 | 900001, 900002 | 0004620135, 0004620136 |
| 9107025209 | IN28140072 | 3 | 900004, 900005, 900006 | C20260301, I20260301, T20260401 |
| (one more — confirm in DB after import) | | | | |

Cases 1 + 2 are the trickiest — same SKU + no batch on two separate lines. These are the real stress test for the composite-key patch path.

---

## 2. Execution checklist (master)

```
Plan — SAP import fix (4 phases)

[ ] Phase 0 — Schema change (Supabase SQL Editor)
    [ ] 0.1 Add netWeight column
    [ ] 0.2 Add totalWeight column
    [ ] 0.3 Hand-edit prisma/schema.prisma
    [ ] 0.4 Run npx prisma generate locally
    [ ] 0.5 Confirm Prisma client picks up new fields

[ ] Phase 1 — Parser rewrite (lib/sap-parser/)
    [ ] 1.1 Read all 7 parser files + types
    [ ] 1.2 Update COL constants in read-sheet.ts to new positions
    [ ] 1.3 Update REQUIRED_COLS to match new layout
    [ ] 1.4 Add Batch + Net weight + Total weight to RawSapRow type
    [ ] 1.5 Add LF-only + Qty>0 pre-filters in apply-rules.ts
    [ ] 1.6 Remove grouping logic (STEP 2 + STEP 3 in apply-rules.ts)
    [ ] 1.7 Wire soNumber from col 9 (string) into ObdInput
    [ ] 1.8 Pass batch + weights through LineInterim to ObdLineInput
    [ ] 1.9 Auto-sum line totalWeight into summary.grossWeight in build-obd.ts
    [ ] 1.10 npx tsc --noEmit clean
    [ ] 1.11 Commit Phase 1 to main

[ ] Phase 2 — Patch path key change (lib/import-upsert/lines.ts)
    [ ] 2.1 Read lines.ts fully + effects.ts + state.ts + types.ts
    [ ] 2.2 Change existing-rows map key from skuCodeRaw → (lineId + "|" + skuCodeRaw)
    [ ] 2.3 Change incoming-rows map key the same way
    [ ] 2.4 Verify orphan-removal logic still uses lineStatus = 'removed' flow
    [ ] 2.5 Update console warnings to reflect new composite key
    [ ] 2.6 Search for other SKU-only-keyed maps in lib/import-upsert/
    [ ] 2.7 npx tsc --noEmit clean
    [ ] 2.8 Commit Phase 2 to main

[ ] Phase 3 — Test and verify
    [ ] 3.1 Upload sap-new-layout.XLSX via admin SAP import UI
    [ ] 3.2 Verify preview shows 98 OBDs (not 114)
    [ ] 3.3 Confirm preview shows 260 line rows total
    [ ] 3.4 Click Confirm Import
    [ ] 3.5 Spot-check OBD 9106995963 in DB — 2 rows for SKU IN70270181, lineId 10 + 20
    [ ] 3.6 Spot-check OBD 9106995962 — 2 rows for SKU 5911947, lineId 10 + 30
    [ ] 3.7 Spot-check OBD 9107008468 — 2 rows for SKU 5853011, different batches
    [ ] 3.8 Verify netWeight + totalWeight populated on a sample line
    [ ] 3.9 Verify soNumber populated on summary
    [ ] 3.10 Re-upload same file → verify rows patched (not duplicated)
    [ ] 3.11 Verify order detail panel renders all lines
    [ ] 3.12 Verify Tint Manager card view for one tinting OBD
    [ ] 3.13 Smoke-test Delivery Challan render for one OBD
```

---

## 3. Phase 0 — Schema change

### 3.1 What changes

Add two columns to `import_raw_line_items`:

```sql
ALTER TABLE import_raw_line_items
  ADD COLUMN "netWeight" double precision,
  ADD COLUMN "totalWeight" double precision;
```

Both nullable. No default. No data migration needed — table is empty.

### 3.2 How to apply

1. Open Supabase project → SQL Editor
2. Paste the SQL above
3. Run
4. Confirm columns appear via:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'import_raw_line_items'
  AND column_name IN ('netWeight', 'totalWeight');
```

### 3.3 Update Prisma schema (hand-edit)

In `prisma/schema.prisma`, inside `model import_raw_line_items`, add two lines after `volumeLine`:

```prisma
volumeLine          Float?
netWeight           Float?
totalWeight         Float?
isTinting           Boolean                     @default(false)
```

Then run locally:
```
npx prisma generate
```

`prisma db pull` will not work on depot PC (IPv4 fallback per CORE §3) — hand-edit is the documented path.

### 3.4 Exit criteria for Phase 0

- [ ] Both columns visible in Supabase Table Editor
- [ ] schema.prisma has the two new fields
- [ ] `npx prisma generate` succeeded
- [ ] No TypeScript errors when referencing `netWeight` / `totalWeight` in IDE

### 3.5 Commit

```
git add prisma/schema.prisma
git commit -m "schema: add netWeight + totalWeight to import_raw_line_items"
git push origin main
```

---

## 4. Phase 1 — Parser rewrite

### 4.1 Files touched

Inside `lib/sap-parser/`:

- `read-sheet.ts` — column position constants
- `types.ts` — add fields to `RawSapRow` and `LineInterim`
- `apply-rules.ts` — pre-filters + remove grouping
- `build-obd.ts` — wire soNumber + sum totalWeight into grossWeight
- `cells.ts` — verify `toNumOrNull` and `toStrOrNull` handle the new column types
- `group-rows.ts` — verify still works (groups raw rows by OBD only, not by SKU)
- `index.ts` — verify exports unchanged

### 4.2 Step 1.2 — Column positions in `read-sheet.ts`

Replace the existing `COL` constant with positions matching the new 19-column layout:

```typescript
// New layout — 19 columns
const COL = {
  delivery:     1,   // OBD number
  warehouse:    2,   // Shipping Point
  // storageLocation: 3 — ignored
  division:     4,   // → SMU
  soldToCode:   5,   // billToCustomerId
  soldToName:   6,   // billToCustomerName
  shipToCode:   7,   // shipToCustomerId
  shipToName:   8,   // shipToCustomerName
  refDoc:       9,   // → soNumber (string)
  deliveryType: 10,  // LF / ZLR — filter only
  itemCategory: 11,  // TAN / Z007 / ZKL3 / ZZRE
  item:         12,  // lineId
  material:     13,  // SKU code
  description:  14,
  qty:          15,
  volume:       16,
  netWeight:    17,
  totalWeight:  18,
  batch:        19,
} as const;
```

Update `REQUIRED_COLS` to validate critical columns:
```typescript
const REQUIRED_COLS = [1, 4, 5, 7, 10, 11, 12, 13, 15];
```

### 4.3 Step 1.4 — Types

In `types.ts`, add three fields to `RawSapRow`:

```typescript
export type RawSapRow = {
  // ... existing fields ...
  netWeight: number | null;
  totalWeight: number | null;
  batch: string | null;
};
```

And to `LineInterim`:

```typescript
export type LineInterim = {
  lineId: number;
  skuCodeRaw: string;
  skuDescriptionRaw: string | null;
  unitQty: number;
  volumeLine: number | null;
  netWeight: number | null;
  totalWeight: number | null;
  batchCode: string | null;
  isTinting: boolean;
  itemCategory: string;
  parentRowNumber: number;
};
```

### 4.4 Step 1.5 + 1.6 — Pre-filters and no-grouping in `apply-rules.ts`

The existing `applyRules(groups)` function returns `AppliedRulesResult = { linesByDelivery: Map<string, LineInterim[]>, skipped: SkippedRow[], warnings: Warning[] }`. Preserve that signature.

Inside the per-OBD loop, replace the old STEP 2 (group by Material) + STEP 3 (emit one line per group) with:

```typescript
// STEP 1 — Pre-filter rows for this OBD
const usableRows = g.rows.filter(r => {
  if (r.deliveryType !== "LF") return false;     // skip ZLR and any non-LF
  if ((r.deliveryQuantity ?? 0) === 0) return false;  // skip qty=0 rows
  if (!r.material) return false;                  // safety
  return true;
});

// If OBD has zero usable rows, skip the whole OBD
if (usableRows.length === 0) {
  // log to skipped[] using existing SkippedRow shape
  continue;  // move to next OBD in groups
}

// STEP 2 — Emit one LineInterim per usable row (no grouping)
const lines: LineInterim[] = usableRows.map(r => ({
  lineId:            r.item,
  skuCodeRaw:        r.material as string,
  skuDescriptionRaw: r.description,
  unitQty:           r.deliveryQuantity ?? 0,
  volumeLine:        r.volume,
  netWeight:         r.netWeight,
  totalWeight:       r.totalWeight,
  batchCode:         r.batch,
  isTinting:         (r.itemCategory ?? "") === "Z007",
  itemCategory:      r.itemCategory ?? "",
  parentRowNumber:   r.rowNumber,
}));

linesByDelivery.set(g.delivery, lines);
```

#### Parser features intentionally dropped

The old `apply-rules.ts` had multiple warnings + skip rules that the new LF-only + Qty>0 filter makes unreachable. **These are intentionally removed — implementation session must not re-add them:**

- `mixed-zzre-line` warnings (LF-only filter already excludes ZZRE)
- `unknown-category` warnings against `KNOWN_ITEM_CATEGORIES`
- `ZINR` breadcrumb logging
- `negative-or-zero-item` warning (Qty>0 filter handles zero; SAP shouldn't emit negative on LF)
- `missing-material` warning (caught by the `!r.material` safety in the new filter)
- `duplicate-sku-summed` warning (no more grouping, so no more summing)
- The D.2 "skip whole delivery if all ZZRE" rule (subsumed by LF-only filter)

The new code should be much shorter than the old `apply-rules.ts`. That's correct.

### 4.5 Step 1.7 + 1.8 + 1.9 — Wire fields into `build-obd.ts`

In `build-obd.ts`:

- `ObdInput.soNumber` ← read raw value at col 9 as **string** (NOT int). Use `toStrOrNull` from `cells.ts`.
- `ObdInput.billToCustomerId` ← col 5 string
- `ObdInput.billToCustomerName` ← col 6 string
- `ObdInput.shipToCustomerId` ← col 7 string
- `ObdInput.shipToCustomerName` ← col 8 string
- For each `ObdLineInput`: add `batchCode`, `netWeight`, `totalWeight` from the LineInterim
- `ObdInput.grossWeight` ← sum of all `lines.map(l => l.totalWeight)`, null if all null

Confirm field names against current `ObdInput` type and `headerRowToObdInput` in route.ts:2219-2222 — these must match exactly.

### 4.6 Step 1.10 — Verify

```
npx tsc --noEmit
```
Zero errors required before commit.

### 4.7 Commit

```
git add lib/sap-parser/
git commit -m "sap-parser: new column layout, LF+qty>0 pre-filter, no grouping, batch+weights+soNumber"
git push origin main
```

---

## 5. Phase 2 — Patch path key change

### 5.1 File touched

`lib/import-upsert/lines.ts` only (primary). Read `effects.ts`, `state.ts`, `types.ts` defensively but only edit if they assume SKU-as-key.

### 5.2 Current behaviour (to remove)

Around lines 54–71:

```typescript
const bySkuCode = new Map<string, ExistingLine>();
for (const l of existingLines) {
  const key = l.skuCodeRaw.trim();
  if (bySkuCode.has(key)) {
    console.warn(`[patchLines] Duplicate SKU '${key}' ...; using first`);
    continue;
  }
  bySkuCode.set(key, l);
}
// ... same shape for incomingBySkuCode ...
```

### 5.3 New behaviour

Replace with composite key `(lineId, skuCodeRaw)`:

```typescript
// Build composite key: lineId + "|" + skuCodeRaw
const makeKey = (lineId: number, sku: string) => `${lineId}|${sku.trim()}`;

const byKey = new Map<string, ExistingLine>();
for (const l of existingLines) {
  const key = makeKey(l.lineId, l.skuCodeRaw);
  if (byKey.has(key)) {
    console.warn(`[patchLines] Duplicate (lineId=${l.lineId}, sku=${l.skuCodeRaw}) in existing lines for batch ${batchId}; using first (id=${byKey.get(key)!.id}, ignored=${l.id})`);
    continue;
  }
  byKey.set(key, l);
}

const incomingByKey = new Map<string, ObdLineInput>();
for (const l of incomingLines) {
  const key = makeKey(l.lineId, l.skuCodeRaw);
  if (incomingByKey.has(key)) {
    console.warn(`[patchLines] Duplicate (lineId=${l.lineId}, sku=${l.skuCodeRaw}) in incoming lines for batch ${batchId}; using first occurrence`);
    continue;
  }
  incomingByKey.set(key, l);
}
```

Update all downstream loops in the same function that match incoming → existing to use `byKey` / `incomingByKey` instead of `bySkuCode` / `incomingBySkuCode`.

### 5.4 Orphan handling

The existing "mark removed" logic stays exactly as-is. For each existing row whose key is not present in incoming, mark `lineStatus = 'removed'`, set `removedAt = now()`, `removedReason = 'not in re-import'` (or whatever the current literal is — preserve it).

### 5.5 Verify

```
npx tsc --noEmit
```

Search the codebase for any other place that maps line items by `skuCodeRaw` and could need the same change:

```
grep -rn "skuCodeRaw" lib/import-upsert/
grep -rn "bySkuCode\|incomingBySkuCode" lib/
```

### 5.6 Commit

```
git add lib/import-upsert/
git commit -m "import-upsert: patch line items by (lineId+skuCodeRaw) composite key"
git push origin main
```

---

## 6. Phase 3 — Test and verify

### 6.1 First import test

1. Open `https://orbitoms.in/admin/import` (or wherever manual SAP upload lives)
2. Select file `docs/sample/sap-new-layout.XLSX`
3. Pick today's date for ObdEmailDate
4. Click Preview
5. Expected preview: **98 OBDs, 260 line rows**
6. If preview matches → click Confirm Import
7. Read confirmation response — success expected

### 6.2 DB spot-checks (Supabase SQL Editor)

Run these queries to verify the 3 critical duplicate-SKU cases:

```sql
-- Case 1: OBD 9106995963, SKU IN70270181 — 2 rows, lineId 10 + 20, batch null
SELECT id, "obdNumber", "lineId", "skuCodeRaw", "unitQty", "batchCode", "lineStatus"
FROM import_raw_line_items
WHERE "obdNumber" = '9106995963' AND "skuCodeRaw" = 'IN70270181'
ORDER BY "lineId";
-- Expect: 2 rows, lineIds 10 and 20, both qty 10, both batchCode NULL, both lineStatus 'active'

-- Case 2: OBD 9106995962, SKU 5911947 — 2 rows, lineId 10 + 30, batch null
SELECT id, "obdNumber", "lineId", "skuCodeRaw", "unitQty", "batchCode", "lineStatus"
FROM import_raw_line_items
WHERE "obdNumber" = '9106995962' AND "skuCodeRaw" = '5911947'
ORDER BY "lineId";
-- Expect: 2 rows, lineIds 10 and 30, both qty 2, both batchCode NULL

-- Case 3: OBD 9107008468, SKU 5853011 — 2 rows, different batches
SELECT id, "obdNumber", "lineId", "skuCodeRaw", "unitQty", "batchCode"
FROM import_raw_line_items
WHERE "obdNumber" = '9107008468' AND "skuCodeRaw" = '5853011'
ORDER BY "lineId";
-- Expect: 2 rows, lineIds 900001 and 900002, batches T20260301 and T20260401
```

### 6.3 Field-level spot-checks

```sql
-- Verify netWeight + totalWeight populated
SELECT "obdNumber", "lineId", "skuCodeRaw", "netWeight", "totalWeight"
FROM import_raw_line_items
WHERE "obdNumber" = '9106993343'
LIMIT 5;
-- Expect: non-null values in both weight columns

-- Verify soNumber and customer fields populated on summary
SELECT "obdNumber", "soNumber", "warehouse",
       "billToCustomerId", "billToCustomerName",
       "shipToCustomerId", "shipToCustomerName"
FROM import_raw_summary
WHERE "obdNumber" IN ('9106975964', '9106993343', '9106995962')
ORDER BY "obdNumber";
-- Expect: soNumber populated (e.g. 9106975964 → 1045686409, 9106993343 → 1045689367)
-- Expect: all customer fields populated

-- Confirm total row count after first import
SELECT COUNT(*) FROM import_raw_line_items
WHERE "lineStatus" = 'active';
-- Expect: 260
```

### 6.4 Re-import test (critical — exercises Phase 2 patch path)

1. Same file, upload again
2. Expected: parser detects existing OBDs, hits patch path
3. After confirm:

```sql
-- Should still be 260 active rows total, not 520
SELECT COUNT(*) FROM import_raw_line_items
WHERE "lineStatus" = 'active';
-- Expect: 260

-- Total including removed rows: should still be 260 (no orphans, same file = perfect match)
SELECT COUNT(*) FROM import_raw_line_items;
-- Expect: 260 (no soft-removed rows since file content unchanged)

-- Spot-check 9106995963 — still 2 rows, not 4
SELECT id, "lineId", "skuCodeRaw", "unitQty", "lineStatus"
FROM import_raw_line_items
WHERE "obdNumber" = '9106995963' AND "skuCodeRaw" = 'IN70270181';
-- Expect: 2 active rows, same ids as before (proves patch, not re-create)
```

### 6.5 UI smoke tests

- [ ] Open `/admin/orders/[id]` for one of the imported OBDs — verify all lines render
- [ ] Open Tint Manager (`/tint/manager`) — verify a tinting OBD (Z007 category) appears in Kanban
- [ ] Open Delivery Challan view for one OBD — verify rendering doesn't break with duplicate-SKU lines
- [ ] Open Tint Operator screen if there's a tinting OBD — flag (don't fix) the shade auto-match limitation on duplicate-SKU lines

### 6.6 If anything fails in Phase 3

- Phase 1 only: `git revert <phase-1-sha>` and `git push origin main`. SAP import goes back to broken (current state) but everything else still works.
- Phase 2 only: `git revert <phase-2-sha>` and `git push origin main`. Patch path falls back to SKU-only key. Duplicate-SKU re-imports lose one row but first imports still work.
- Both: revert both, drop the columns in Supabase, you're back to pre-fix state.

---

## 7. Engineering rules to follow (from CORE §3)

- All commits go directly to `main`. No feature branches, no PRs.
- Schema changes via Supabase SQL Editor only. No `prisma db push`.
- `prisma db pull` doesn't work on depot PC. Hand-edit schema.prisma.
- No `prisma.$transaction`. Sequential `await` calls only.
- `npx tsc --noEmit` must pass before every commit.
- Smoke-test locally before pushing.
- Vercel auto-deploys from main.
- DB columns are camelCase, no `@map`.
- `export const dynamic = 'force-dynamic'` on all API routes (parser doesn't touch routes but worth knowing).

---

## 8. Open items / follow-ups (NOT in tonight's scope)

- **Auto-Import resume.** When Auto-Import comes back online, verify it works with the new SAP file column layout (it reads from a separate LogisticsTracker file, so should be unaffected — but worth a smoke test). Also verify Auto-Import's interaction with the new composite-key patch path.
- **Tint Operator shade auto-match.** Line 788 of `tint-operator-content.tsx` uses `.find(skuCode)` — auto-fills only first row when SKU repeats. Manual workaround works. Minor UX polish for a future session.
- **Storage Location (col 3).** Currently ignored. Confirm with Smart Flow if needed later.
- **Reference Document (col 9) parsing.** Old parser parsed as int. New parser reads as string and writes to `soNumber`. Verify mail-orders enrichment still matches SO numbers correctly (it should — `soNumber` is `String?` on both sides).

---

## 9. How to start the implementation session

Open a new Claude.ai chat. Attach the 7 canonical context files + this plan file (`docs/prompts/drafts/web-2026-05-14-sap-import-fix-plan-v2.md`).

First message to Claude:

> "Read all attached files. The SAP import fix plan v2 has full context — all decisions are locked. Start by drafting the Claude Code prompt for Phase 0 (schema change). One phase at a time."

Claude should then draft Phase 0 prompt only, you run it in Claude Code on the depot PC, paste results back, then Phase 1, etc.

---

## 10. Done definition

Tonight's session is done when:

- [ ] All 4 phases complete
- [ ] All Phase 3 spot-checks pass
- [ ] One re-import cycle verified clean
- [ ] No regressions in Tint Manager / Order Detail / Challan rendering
- [ ] Smart Flow has tested manual SAP upload end-to-end at least once
- [ ] Ready for Chandresh / Deepanshu / Bankim to use tomorrow

If any of the above fails, revert affected phase per §6.6 and ship the remaining good phases.
