# Challan Formula Auto-Fill from TI Shade Data

**Date:** 2026-05-26
**Type:** Feature ship + context update
**Module:** Tint / Delivery Challans
**Status:** ✅ Shipped to production, live-tested

---

## What shipped

The **Formula / Shade column** on delivery challans now auto-fills from the Tint Operator's TI submission. Before this, Chandresh (TM) typed every shade name manually into each challan. Now the shade name flows automatically from TO → challan the moment TI is submitted.

### Key behaviours

- **Trigger:** Auto-fill runs on every TI submit (POST `/api/tint/operator/tinter-issue`)
- **Format:** Shade name only (e.g. `spl 30yy 69/048`). Sampling number is saved in `tinter_issue_entries.samplingNo` but NOT shown on the challan.
- **Latest TI wins:** TI is insert-only; the sync helper picks the row with the latest `createdAt` per `rawLineItemId` across both TI tables.
- **Two TI tables read:** `tinter_issue_entries` (TINTER) and `tinter_issue_entries_b` (ACOTONE). Latest across both wins.
- **Manual override = permanent per-row lock:** When TM saves a formula manually via the PATCH route, that row is stamped `isManuallyOverridden = true` and future TI submissions skip it silently. No warning, no badge — just respected forever for that specific row. Other rows on the same challan continue to auto-fill normally.
- **Per-row lock scope:** Lock is scoped to `(challanId, rawLineItemId)`. A future OBD for the same site/SKU/shade is a fresh formula row → auto-fills normally → can be overridden again if needed.

### Skip rules

The sync helper silently skips:
- TI rows with `rawLineItemId IS NULL` (legacy or split-level rows that can't map to a specific line)
- Lines where `isTinting = false` (non-tint lines on a tint OBD)
- Formula rows where `isManuallyOverridden = true`
- Voided challans (`isVoided = true` → whole order skipped)
- TI rows where `shadeName` is null/empty (sampling-only TI no longer auto-fills)

### No backfill

Auto-fill applies only to TI submissions after the feature shipped. Existing challans stay as-is (blank or whatever TM had typed manually).

---

## Schema changes (v27.4 → v27.4, no version bump)

Three new columns added to `delivery_challan_formulas`:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `isManuallyOverridden` | `BOOLEAN NOT NULL` | `false` | Permanent lock flag — true once TM types a value, future TI never overwrites |
| `autoFilledAt` | `TIMESTAMPTZ NULL` | `NULL` | Timestamp of last auto-fill write (cleared when row becomes manually overridden) |
| `sourceTiEntryId` | `INTEGER NULL` | `NULL` | Audit pointer to the TI row id that filled this formula (no FK — cross-table pointer, can be from either TI table) |

SQL file: `sql/2026-05-26-add-formula-override-tracking.sql`

---

## Files touched

### New files
- `lib/tint/sync-challan-formulas.ts` — the sync helper
- `sql/2026-05-26-add-formula-override-tracking.sql` — schema migration

### Modified files
- `prisma/schema.prisma` — 3 fields added to `delivery_challan_formulas` model
- `app/api/tint/operator/tinter-issue/route.ts` — calls `syncChallanFormulasFromTi(orderId)` after the per-entry create loop, wrapped in try-catch so sync failure does not break TI submit. Sync result returned in response as `formulaSync` field for debugging.
- `app/api/tint/manager/challans/[orderId]/route.ts` — PATCH upsert now stamps `isManuallyOverridden = true`, `autoFilledAt = null`, `sourceTiEntryId = null` on every manual save

---

## Sync helper: `lib/tint/sync-challan-formulas.ts`

### Signature
```typescript
export async function syncChallanFormulasFromTi(
  orderId: number,
): Promise<SyncChallanFormulasResult>
```

### Result shape
```typescript
interface SyncChallanFormulasResult {
  orderId:                number;
  challanId:              number | null;
  totalLatestTiRows:      number;
  upserted:               number;
  skippedNullRawLineItem: number;
  skippedNonTinting:      number;
  skippedManualOverride:  number;
  skippedNoText:          number;
  reason?:                "no-challan" | "voided" | "ok";
}
```

### Algorithm
1. Find challan for `orderId`. Bail early if missing (`reason: "no-challan"`) or voided (`reason: "voided"`).
2. Query both TI tables for that orderId, filter `rawLineItemId IS NOT NULL`.
3. Group by `rawLineItemId`, take latest `createdAt` per group across both tables.
4. Load `import_raw_line_items` by id-set (NOT by `orderId` — table is keyed by `obdNumber`).
5. Load existing formula rows to check `isManuallyOverridden`.
6. Per-line sequential upsert (no `prisma.$transaction`):
   - Skip non-tint lines
   - Skip manually-overridden rows
   - Skip rows where shade text is empty
   - Upsert with `formula`, `autoFilledAt = now`, `sourceTiEntryId = TI row id`
7. Return result with counters.

### Constraints honoured
- ✅ No `prisma.$transaction` — sequential awaits only (CORE §3)
- ✅ camelCase columns, no `@map`
- ✅ Errors bubble up to caller (TI submit route wraps in try-catch)

---

## Deferred issues (logged in ROADMAP + CLAUDE_TINT §13)

While building this feature, two pre-existing bugs surfaced in `app/api/tint/manager/challans/[orderId]/route.ts`. Both are documented but NOT fixed in this commit:

### 1. `$transaction` landmine
File: `app/api/tint/manager/challans/[orderId]/route.ts:527`
The formula upsert is wrapped in `prisma.$transaction(async (tx) => { ... })`. Violates CORE §3. Same class as the TM reorder API landmine. Currently safe because only TM Chandresh saves challans (low concurrency). Plan a dedicated refactor session.

### 2. Cell-clear UX bug
`components/tint/challan-content.tsx:211-213` filters empty strings out of the PATCH body. Server has no delete branch. Effect: clearing a cell in the UI does NOT clear the DB row. After Phase 4 this also means a TM cannot "unlock" a manually overridden row by clearing it.

**Mitigation if unlock is ever needed:** build a proper "Reset to auto" button rather than rely on empty-string semantics.

---

## Commits

| Hash | Type | Description |
|---|---|---|
| `20fc3fe7` | feat | Phases 1-4: schema + helper + wire-in + TM override stamp |
| `cf582100` | chore | Docs consolidation (schema v27.4 refresh, archive May drafts, new context files) |
| `ed2d1af5` | fix | Drop sampling number from challan format (post-deploy hotfix) |

---

## Engineering learnings from this session

### 1. `import_raw_line_items` is keyed by `obdNumber`, not `orderId`
The diagnostic prompt assumed an `orderId` column existed. It does not. Claude Code pushed back correctly and queried by `id` set instead (already in memory from the TI grouping step). Saves a DB lookup too.

### 2. `tinter_issue_entries.rawLineItemId` is nullable
Legacy TI rows or split-level submissions may not have a line link. The sync helper must skip these silently. There's no DB-level uniqueness on `(orderId, rawLineItemId)` — "latest by `createdAt`" is the only correct selector.

### 3. Both TI tables share the same shape for auto-fill purposes
TINTER (13 pigments) and ACOTONE (14 pigments) tables both carry `shadeName`, `samplingNo`, `rawLineItemId`, `createdAt`. The pigment columns differ but are irrelevant for the formula text. Union queries by selecting only the common columns.

### 4. Pre-existing dirty working tree must be diagnosed before committing
Found 34 unrelated changes (schema v27.4 doc refresh, 28 archived drafts, 2 new context files) sitting in the working tree when we tried to commit Phase 5. Resolved by splitting into a clean 2-commit cleanup (feature + docs chore) before pushing. Skipped 3 files (2 xlsx + `.claude/settings.local.json`) for separate later handling.

### 5. Per-row lock is simpler than per-shade or per-site lock
Originally considered warning UI when TI updates after a manual override. Smart Flow's call: no warning, no badge — once TM edits a cell, that cell is locked forever for that specific challan's specific line. Future OBDs for the same site/SKU naturally start fresh (new formula row, new lock state). Database key `(challanId, rawLineItemId)` makes the scope automatic — no extra logic needed.

### 6. Don't bundle format choice with other design choices
Started with format "shade · S/N samplingNo" based on reasoning about customer re-tinting workflows. After live deploy and one challan inspection, Smart Flow's call: drop sampling number entirely. Shipped as a 10-min hotfix. Lesson: ship the smallest defensible format, iterate on real challans.

---

## Production validation

✅ **CHN-2026-00243** (5818104 — WS PU Elastomeric Int base(92) 20Ltr, two lines)
- Line 1 (10 qty): auto-filled `spl 30yy 69/048 · S/N 26-0017` (old format pre-hotfix)
- Line 2 (1 qty): auto-filled `SPL DARK · S/N 26-0018` (old format pre-hotfix)

This proved:
- Multi-shade auto-fill works (Test 1 + Test 2 in one shot)
- Two different shades on two different lines, each correctly resolved via `rawLineItemId`
- Real depot OBD, not synthetic test data

Post-hotfix challans will display shade name only.

---

## Recommended follow-up tests (do as natural depot flow triggers them — no need to force)

- **Test 3 — TI resubmit:** When a TO corrects a shade on an active line, verify the challan picks up the new shade (overwrites the old auto-filled value).
- **Test 4 — Manual override locks:** When Chandresh manually edits a formula cell, verify the DB row gets `isManuallyOverridden = true`.
- **Test 5 — Locked row ignores future TI:** Resubmit TI for a manually-overridden line, verify the formula does NOT change.
- **Test 6 — Voided challan blocks auto-fill:** Submit TI on an OBD with a voided challan, verify no formula rows are created.
- **Test 7 — Non-tint line ignored:** TI cannot reach non-tint lines via the UI, but defensively no formula rows should ever exist for `isTinting = false` lines.

---

## Consolidation target

When next consolidating drafts into canonical context files, the content of this doc should land in:

- **`docs/CLAUDE_TINT.md` §9 (Delivery Challans):** describe the auto-fill flow, the per-row lock semantics, the format ("shade name only"), and the sync helper's place in the architecture.
- **`docs/CLAUDE_TINT.md` §13 (Landmines):** the two deferred bullets are already added.
- **`docs/ROADMAP.md` Deferred / Known issues:** the two deferred entries are already added.
- **`docs/CLAUDE_CORE.md` §3 (Engineering rules):** no change — this feature respects all existing rules and adds none.

Once consolidated, this draft can be moved to `docs/archive/drafts/2026-05/` (alongside the 28 drafts archived in the docs chore commit `cf582100`).
