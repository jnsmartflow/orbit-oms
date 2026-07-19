# CLAUDE_SAMPLING_LIBRARY.md — Sampling Library Module
# v1.4 · Schema v27.11 · July 2026 · Phase 4 shipped 2026-05-25 · Cohort A+B restore 2026-05-27
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Digital library for the depot's paper-based Sampling Register. Shade name + tinter recipes + usage history. Replaced `shade_master` (Phase 4 shipped 2026-05-25) as the depot's single source of truth for tinted shades.

Page route: `/tint/sampling-library`
Page key: `sampling_library`

Roles granted:
- `tint_manager` — view + edit
- `tint_operator` — view (read-only)
- `admin` — full
- `ops_admin` — view

Primary users: Chandresh (TM), Deepak + Chandrasing (operators reference past recipes).

---

## 1. What this module is

The depot maintains a paper "Sampling Register" with hand-written shade recipes — one numbered entry per shade, with one or more SKU+pack variants per entry, and a history of which dealer/site used what.

This module digitises that register and surfaces it as:
- A searchable, filterable browse page
- A reference workspace for Chandresh when approving new shades
- Live integration into Tint Operator's TI workflow — every TI Done auto-writes a `sampling_usage_log` row (shipped Phase 4, 2026-05-25)

---

## 2. Schema

### sampling_register (parent)

```
samplingNo      TEXT PRIMARY KEY   — permanent natural key. Allocation = MAX(samplingNo) + 1.
shadeName       TEXT NOT NULL      — permanent shade name (one register entry = one shade)
tinterType      TinterType         — TINTER | ACOTONE
siteId          INT FK → delivery_point_master.id (nullable)
siteNameRaw     TEXT               — raw site name from import (kept even when siteId resolves)
salesOfficerId  INT FK → sales_officer_master.id (nullable)
dealerName      TEXT               — raw dealer name from import
notes           TEXT
isActive        BOOLEAN DEFAULT true
needsReview     BOOLEAN DEFAULT false
createdById     INT FK → users.id
createdAt       TIMESTAMPTZ        — set to EARLIEST historical date per sampling no during import
updatedAt       TIMESTAMPTZ

INDEX (tinterType, isActive)
INDEX (needsReview)
INDEX (siteId)
INDEX (salesOfficerId)
INDEX (shadeName)
```

**Site resolution:**
- `siteId` populated only when raw site name had an exact match in `delivery_point_master`
- `siteNameRaw` always populated (master string from import)
- `siteMissing` (computed at API) = `siteNameRaw IS NOT NULL AND siteId IS NULL`

### sampling_recipes (variants under each register entry)

```
id              SERIAL PRIMARY KEY
samplingNo      TEXT FK → sampling_register CASCADE
skuCode         TEXT NOT NULL
productName     TEXT
packCode        PackCode?          — enum, NULLABLE since v27.5 (legacy paper register
                                     entries often have no pack recorded; operator
                                     identifies by skuCode instead)
tinQty          DECIMAL DEFAULT 0
-- 13 TINTER pigment columns (all Decimal DEFAULT 0):
YOX, LFY, GRN, TBL, WHT, MAG, FFR, BLK, OXR, HEY, HER, COB, COG
-- 14 ACOTONE pigment columns (all Decimal DEFAULT 0):
YE2, YE1, XY1, XR1, WH1, RE2, RE1, OR1, NO2, NO1, MA1, GR1, BU2, BU1
isPrimary       BOOLEAN DEFAULT false   — first variant flagged primary
usageCount      INT DEFAULT 0           — denormalised counter from usage_log
firstUsedAt     TIMESTAMPTZ
lastUsedAt      TIMESTAMPTZ
createdAt       TIMESTAMPTZ
updatedAt       TIMESTAMPTZ

UNIQUE (samplingNo, skuCode, packCode) NULLS NOT DISTINCT
                                      — natural key for one recipe variant; NULLS NOT
                                        DISTINCT blocks duplicate null-pack rows on
                                        re-import (v27.5).
INDEX (samplingNo)
INDEX (skuCode, packCode)
INDEX (lastUsedAt DESC)
INDEX (samplingNo, isPrimary)
```

### sampling_usage_log (one row per Excel import row + future TI-done writes)

```
id              SERIAL PRIMARY KEY
samplingNo      TEXT FK → sampling_register CASCADE
recipeId        INT FK → sampling_recipes SET NULL (nullable on legacy import rows)
usageDate       DATE (nullable)
operatorId      INT FK → users.id (nullable)
operatorNameRaw TEXT
tinQty          DECIMAL DEFAULT 0       — read from Excel col 7 (BLANK header — by position)
dealerNameRaw   TEXT
siteId          INT FK → delivery_point_master.id (nullable)
siteNameRaw     TEXT
skuCodeRaw      TEXT
packCode        PackCode (nullable)
deliveryNumber  TEXT (nullable)         — v27.4. OBD-style identifier from source Excel
sourceRowIndex  INT                     — back-reference to Excel row
createdAt       TIMESTAMPTZ

INDEX (samplingNo)
INDEX (samplingNo, usageDate DESC)
INDEX (operatorId, usageDate)
INDEX (siteNameRaw)
```

---

## 3. Phases shipped so far

### Phase 1 — Foundation (2026-05-22)

- Schema in production (Supabase, prisma/schema.prisma)
- Excel classifier + importer scripts: 3,566 parents + 4,052 recipes imported
- Phase 1 page (browse + filter, read-only)
- Permissions wired

### Phase 1 repair — Historical backfill (2026-05-22)

- `scripts/repair-sampling-import.ts` filled data initial import dropped:
  - `createdAt` set to earliest historical date per sampling no (range now 2022-05-02 to 2026-05-15)
  - 1,520 parents matched to `delivery_point_master` via exact site name
  - 2,041 parents stored `siteNameRaw` only (no master match)
  - 10,619 `sampling_usage_log` rows inserted (one per Excel row)

### Phase 2 — Detail pane (2026-05-22)

8-section detail-pane structure, polish on filters + status pills.

### Phase 3 — Normalisation + Delivery No (2026-05-22/23)

- Schema v27.4 column `sampling_usage_log.deliveryNumber` added
- Data normalisation: case-variant deduplication on SKUs / dealer names / site names
- Confidence-banded approach: high (case-only) auto-applied; medium (whitespace/hyphen variants) suggested; low (Levenshtein ≤ 2) manual review
- Source of truth: `sku_master.skuCode` for SKUs; `delivery_point_master.customerName` for dealer/site

> **Correction (2026-07-19 docs pass) — two errors were in this line:**
>
> 1. **There is no `materialCode` column on `sku_master`.** The column is and always was
>    **`skuCode`** (`String @unique`, verified in `prisma/schema.prisma`). Corrected above.
> 2. **This was a ONE-TIME offline normalisation input, not a live dependency.** No Sampling Library
>    runtime code reads `sku_master` — grep-confirmed. The live module reads the **raw imported
>    line** (`skuCodeRaw` on `sampling_usage_log`, and `import_raw_line_items` upstream), never the
>    operational catalog. Sampling is a confirmed **non-reader** of the catalog, alongside Tint
>    Manager/Operator, Delivery Challan, the Support board, Warehouse, and Trip Report.
>
> **⚠ PRE-DROP RISK — `scripts/normalise-sampling-data.ts:313`.** This is the ONE remaining reader
> of old `sku_master` in this module: `prisma.sku_master.findMany({ select: { skuCode: true } })`.
> Unlike the underscore-prefixed scratch diagnostics, it is a **committed script with no underscore
> prefix**, so `tsconfig.json`'s `exclude` (`scripts/_*.ts`) does **not** cover it — **it is inside
> the `tsc --noEmit` gate.** When old `sku_master` is eventually dropped and its Prisma model
> removed, this file **will fail to compile** and block every commit until it is dealt with.
>
> Recorded as a known risk for that future session, **not a fix** — do not touch the script now. The
> old table still exists and the script still compiles; there is nothing broken today.

### Phase 4 — Live operator integration (SHIPPED 2026-05-25)

Wired Sampling Library into live Tint Operator TI workflow:
- Every TI Save attaches a `samplingNo` to `tinter_issue_entries` (new or existing shade)
- Every TI marked Done writes a `sampling_usage_log` row with real operator, OBD (`deliveryNumber`), dealer, site, qty, date
- New variant auto-created when `(samplingNo, skuCode, packCode)` doesn't exist in `sampling_recipes`
- Operator screen suggests past tinting at same site (exact-match cards + reference shades)
- Save shade toggle removed; always-visible shade name input replaces it
- Confirmation popup on save responses (shows allocated `samplingNo`)
- `samplingNo` chip in TI summary area after save
- `shade_master` retired — see CORE landmines for transition status

### Phase 4 bugfix — siteId on usage_log (SHIPPED 2026-06-01, commit `df7e61e9`)

Bug: `usage-log-writer.ts` had no `siteId` field in `UsageLogArgs`. Every Mark-Done since Phase 4 ship wrote `siteId = null`. Same-site suggestions (`suggest.ts`) match `usage_log.siteId` strictly — null rows were invisible. Confirmed real case: operator created `26-0080` as a duplicate of `26-0046` at the same site Regency Tower because the prior tinting didn't surface in suggestions.

Fix: pass `siteId: order.customerId` into `writeUsageLogsForAssignment`. Sequential-await fallback to `sampling_register.siteId` if the passed value is null. Backfill applied (23 rows recovered) via OBD→order link.

**Confirmed:** `orders.customerId` IS the resolved ship-to site FK → `delivery_point_master.id`. It is NOT the bill-to dealer. The suggestion engine writes MUST populate siteId.

### Phase 4.5 + 5 — Orphan fix (DESIGNED, NOT SHIPPED — parked 2026-05-26)

Design locked at 14 points but deferred indefinitely after live data showed only 1 orphan in 48 hours of operation (training/UX issue, not a code defect).

**The shape of the problem:** Operator types new shade → hits Save TI → system creates `sampling_register` + `sampling_recipes` rows. Operator then realises shade already exists → picks existing samplingNo via SuggestionCard → hits Update TI Entry. Result: originally-created register row left orphaned with `usageCount=0`.

**Designed fix — Option D (defer allocation to Mark Done):**
- Save TI for new shade: write `tinter_issue_entries` with `samplingNo=null`, `shadeName=<typed>`. Do NOT call `next_sampling_no()`.
- Update TI Entry switch: rewrite `tinter_issue_entries.samplingNo`. No orphan.
- Mark Done null-samplingNo (new shade pending): allocate via `next_sampling_no()`, create register + recipe, update TI row, write usage_log + recipe bump.

**Decision triggers** (run end of each month):
```sql
SELECT
  COUNT(*) AS total_created_this_month,
  COUNT(*) FILTER (
    WHERE NOT EXISTS (SELECT 1 FROM sampling_usage_log WHERE "samplingNo" = sr."samplingNo")
      AND NOT EXISTS (SELECT 1 FROM tinter_issue_entries WHERE "samplingNo" = sr."samplingNo")
      AND NOT EXISTS (SELECT 1 FROM tinter_issue_entries_b WHERE "samplingNo" = sr."samplingNo")
  ) AS orphan_count
FROM sampling_register sr
WHERE sr."createdAt" >= date_trunc('month', NOW());
```

- Orphan count < 20/month → keep deferring, manual cleanup
- Orphan count 20-50/month → schedule Phase 4.5 + 5 within 2-4 weeks
- Orphan count > 50/month → ship immediately

### Phase 4.6 — REVIEW pile import (SHIPPED 2026-05-27)

Imported the 4-year legacy REVIEW pile from `Tinting_data_Tracker_N_FINAL_REVIEW.xlsx`:
- 601 sampling numbers landed (out of 702 in source)
- 827 recipes added, 2,549 usage_log rows
- 97 skipped: 24 SPL-prefix conflicts (real product distinction) + 69 2v2 ties + 4 promoted-from-tie excluded
- Site backfill recovered 230 parents via case-insensitive UPDATE against `delivery_point_master.customerName`

**Schema change (v27.5):** `sampling_recipes.packCode` made nullable. Composite unique recreated with `NULLS NOT DISTINCT`. Why: 4 years of paper register data where pack wasn't recorded — default-to-18L would lie, skipping would lose 64% of the pile. Nullable lets the data land truthfully; operators identify by SKU code instead.

**Code changes (commit `0a05f5ad`):** 6 files updated for null-safe pack handling — detail pane label, suggestion card label, suggest API types, detail API types, prisma schema, plus deferred fix at `sampling-resolution.ts:82` for the operator Scenario 3 mid-edit corner case.

### Phase 4.7 — Cohort A + B full restore (SHIPPED 2026-05-27)

Two mirror-image gaps in legacy data fixed. Net result: **4,353 shades** in the library, every legacy TI from 2022 onward now visible in operator suggestion engine.

**Cohort A — recipe restoration:** 3,566 sampling numbers had a register row + usage_log rows but NO recipes. Suggestion engine ignored them (`suggest.ts:133` short-circuits on `if (!row.recipe) continue`).
- Derived recipe per parent by majority formula across its usage rows
- 3-step SKU/pack lookup: Excel DESC → Alt SKU Master → existing recipes
- Pack normalisation (18L→20L, 3.7L→4L, 0.9L→1L, 9L→10L, 3.6L→4L)
- 4,034 INSERTs via `scripts/_seed-cohort-a.ts` (multi-row batching, 13.8s execution)
- Post-fix on 62 rows that landed with 2 isPrimary recipes via `scripts/_fix-cohort-a-primaries.ts`
- Pack coverage: 3,542 with pack / 510 null

**Cohort B — usage history restoration:** 601 sampling numbers had recipes but no tinting history. 488 single-shade → straightforward; 109 multi-shade → spawned 118 child sampling numbers using `#PARENT-N` convention.

**Child sampling number rules (locked):**
- Same shade name + same formula as parent = noise/typo, merge to canonical parent
- Different shade name + same formula = merge to canonical (e.g. "78GG 21/381" vs "78GG 221/381" typo)
- Different shade name + different formula = create child `#PARENT-N`
- Child fields (shade, site, dealer, SKU) come from **dominant value in child rows**, NOT inherited from parent

**Cohort B cleanup (4 corrective fixes after first run):**
1. Duplicate usage_log rows: morning automated import had already added these — deleted 2,545 duplicates via signature match (samplingNo + usageDate + siteNameRaw + skuCodeRaw + deliveryNumber), kept 285 genuinely-new child rows
2. Children `createdAt` set to NOW() instead of earliest usageDate — fixed via UPDATE per child
3. `usageCount` not denormalised on children — fixed via `COUNT(usage_log rows by recipeId)`
4. `tinQty` left as 0 (Excel col 7 blank header missed) — backfilled via VALUES table mapping `sourceRowIndex` → quantity

### Phase 4.8 — New tinting rows 16-25 May (SHIPPED 2026-05-27)

Imported 80 new rows from `Tinting_data_Tracker_N_new.xlsx`. 3 rows skipped because their Excel sno (`#2`, `#3`, `#4`) maps to existing OrbitOMS entries `#26-0002` / `#26-0003` / `#26-0004` (Chandresh drops the `26-0` prefix when transcribing to paper register).

**Excel column layout change:** the new file dropped the duplicate "Site Name" column at col 9, shifting pigment columns left by 1. New PIG_COLS = [9..21]. Future imports must adjust position-based readers.

**5-path row classification:**
| Path | Action | Rows |
|---|---|---|
| 1 | Existing recipe → just usage_log | 4 |
| 2 | Parent exists, no recipes → recipe + usage_log | 42 |
| 3 | Same shade, new SKU → new recipe + usage_log | 1 |
| 4 | Different shade → child sno + recipe + usage_log | 2 |
| 5 | Truly new sampling number → register + recipe + usage_log | 29 |

Required 3 retry rounds before clean landing — surface area: child suffix collisions, partial-commit cleanup, recipe duplicate-key conflicts. Final v3 added `ON CONFLICT DO NOTHING` to every INSERT plus a defensive cleanup prologue.

### Phase 5 — Site fuzzy match (DEFERRED)

`suggest.ts` matches "past tinting at same site" on `sampling_usage_log.siteId` ONLY. There is no `siteNameRaw` fallback. After post-restore site backfill, ~2,411 parents still have null `siteId` (no exact match in `delivery_point_master`). These are invisible to suggestions.

Phase 5 will add a one-shot fuzzy-match pass to recover the most of these. Not built. **Never auto-fuzzy-match** site names in production — suffixes like "FACE" / phase numbers distinguish genuinely different sites (CORE §3 rule).

---

## 4. Page layout — /tint/sampling-library

UniversalHeader with title "Sampling Library" + stats (entries, recipes, this month). Type filter (TINTER/ACOTONE) as leftExtra segment. Pack + Status filters in dropdown.

### Browse pane (left)

- Filterable list of `sampling_register` entries
- Row: samplingNo (mono) · shadeName (semibold) · tinterType pill · isActive/needsReview status pills · usage count · last-used date
- Sort: lastUsedAt DESC default, with secondary controls for shadeName ASC / createdAt DESC

### Detail pane (right) — 8 sections

When a row is selected:

1. **Header strip** — samplingNo, shadeName, type pill, isActive toggle, needsReview chip, kebab menu
2. **Variant tabs** — one tab per `sampling_recipes` row under this samplingNo (SKU + pack). Primary tab marked with PRIMARY pill.
3. **Recipe table** — 13 TINTER or 14 ACOTONE pigment values, tinQty, isPrimary toggle, lastUsedAt
4. **Sales officer + dealer** — labels, derived from parent fields
5. **Used at** — list of sites where this shade has been tinted (derived from usage_log grouped by site)
6. **SKUs used** — list of SKU codes that have been tinted under this shade (derived from usage_log grouped by skuCode)
7. **Tinting history** — one row per `sampling_usage_log` row: date · operator · siteName · dealer · sku · pack · tinQty · deliveryNumber. Default sort lastUsedAt DESC.
8. **Action buttons (3 icons in detail header strip):**
   - Edit (pencil) → opens edit modal
   - Deactivate (ban) → `PATCH { isActive: false }` confirm modal
   - Mark for review (alert-triangle) → `POST /api/sampling-library/[samplingNo]/review`

### Visual style — exemption

Per `CLAUDE_UI.md §22`, this page uses teal across multiple elements intentionally:
- Segment pill (TINTER/ACOTONE)
- Variant tabs (active)
- PRIMARY pill
- Pack pill
- Export links
- Recipe-history active row

Typography drops one weight from spec (`font-bold` → `font-semibold` or `font-medium`) for cousin-page consistency.

---

## 5. API endpoints

All `export const dynamic = 'force-dynamic'`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/sampling-library` | sampling_library canView | List with filters (type, pack, status, search, page, sort) |
| GET | `/api/sampling-library/[samplingNo]` | sampling_library canView | Full detail incl. recipes + usage log |
| PATCH | `/api/sampling-library/[samplingNo]` | sampling_library canEdit | Update parent fields (shadeName, dealerName, salesOfficerId, isActive, notes) |
| GET | `/api/sampling-library/[samplingNo]/variants` | sampling_library canView | List recipes (variants) — alternative to /detail when only variants needed |
| POST | `/api/sampling-library/[samplingNo]/variants` | sampling_library canEdit | Add new variant (recipe) under existing parent |
| POST | `/api/sampling-library/[samplingNo]/review` | sampling_library canEdit | Toggle `needsReview` |
| GET | `/api/sampling-library/[samplingNo]/usage-log` | sampling_library canView | Paginated usage history |
| POST | `/api/sampling-library` | sampling_library canEdit | Create new parent entry (allocates next samplingNo, inserts first variant + first usage_log row) |
| GET | `/api/sampling-library/operator-search` | sampling_library canView | Global partial-match reuse search (§11) — ILIKE on samplingNo / shadeName / usage site name; optional `type`; `RESULT_LIMIT=50`; returns applyable `SuggestFlatRow` rows |
| POST | `/api/sampling-library/formula-match` | operator | Issue-1 formula-match gate (§11) — per-litre for TINTER, exact 27-value for ACOTONE; active/zero pre-filter |

---

## 6. Sampling number allocation

**`MAX(samplingNo) + 1`** — plain sequential, no year prefix.

**Allocated at the moment of save** (not at toggle, not at screen open).

**Race-safe via P2002 retry pattern** (same as `import_batches.batchRef`):
1. Read `MAX(samplingNo)` → compute `nextNo`
2. INSERT with `nextNo`
3. On P2002 (unique constraint violation) → re-read MAX → retry up to 5 times
4. After 5 retries → 500 error

---

## 7. Phase 1 import — REPAIR gotchas

These are non-obvious quirks from the historical Excel import worth remembering:

- **TIN QTY column has BLANK header** in source Excel. Reader uses **column index 7** (position-based), not header text. `scripts/import-sampling-library.ts` REPAIR-1.
- **Action classification rules** (from `scripts/lib/sampling-classifier.ts`):
  - `IMPORT` = all rows for a sampling no agree on shade + SKU + tinter type + pack
  - `REVIEW` = multi-shade, partial blank, unknown pack, etc.
  - `SKIP` = invalid sampling no, all rows blank shade, all rows blank SKU
- **tinterType hard-coded to TINTER** during import (no ACOTONE rows in legacy source)
- **Pack** extracted from DESC tail OR recovered via SKU master lookup
- **SKU lookup uses TWO sources**: SAP stock file (primary) + 9-sheet legacy master (fallback)
- **Date range** spans 2022-05-02 to 2026-05-15 after `createdAt` backfill (NOT just import day)
- **2,041 parents have `siteNameRaw` but null `siteId`** — site name didn't match `delivery_point_master`. Surfaced in UI as "site missing" pills.

---

## 8. Files map

```
app/(tint)/tint/sampling-library/
  page.tsx                          server: roles + initial fetch
  sampling-library-page.tsx         client root
  sampling-list.tsx                 left pane list with filters
  sampling-detail.tsx               right pane 8-section detail
  edit-modal.tsx, deactivate-modal.tsx, review-modal.tsx, new-variant-modal.tsx

components/sampling-library/
  variant-tabs.tsx
  recipe-table.tsx
  usage-log-table.tsx
  used-at-list.tsx
  skus-used-list.tsx
  action-buttons.tsx
  sampling-library-list-pane.tsx    left-pane list (carries the tinter-type tag ~:263-269;
                                    earlier docs wrongly cited status-pills.tsx/sampling-list.tsx)

components/tint/operator/
  flat-suggestion-list.tsx          operator reuse list (§11; replaced retired suggestion-card.tsx)
  formula-match-modal.tsx           "Same shade found" reuse modal (Use / Create new / Cancel)

lib/sampling-library/
  types.ts
  fetchers.ts                       client API helpers
  filters.ts                        URL query → filter object
  allocate-sampling-no.ts           P2002 retry pattern
lib/sampling/
  pack-litres.ts                    dose-litres map + packDoseLitres / canScale /
                                    scalePigments(3dp) / perLitreFingerprint(2dp) (§11)

api/sampling-library/
  route.ts                          GET list, POST create
  [samplingNo]/route.ts             GET detail, PATCH parent
  [samplingNo]/variants/route.ts    GET variants, POST new variant
  [samplingNo]/review/route.ts      POST toggle needsReview
  [samplingNo]/usage-log/route.ts   GET paginated usage
  operator-search/route.ts          global partial-match reuse search (§11)
  formula-match/route.ts            per-litre (TINTER) / exact (ACOTONE) match gate (§11)
  _lib/suggest.ts                   flatSuggestions builder + otherSites grouping (§11)

scripts/                            (outside docs index; reference scripts on depot PC)
  classify-sampling-excel.ts        Excel → review xlsx
  generate-final-review-xlsx.ts     Colour-coded triage xlsx
  import-sampling-library.ts        Dry-run + commit
  repair-sampling-import.ts         Historical backfill
  lib/sampling-classifier.ts        Shared classifier
```

---

## 9. Landmines

- **Cross-customer "same site" grouping not implemented.** Multi-SAP-code sites (e.g. "Sun Shantam" with 5 customer codes) are treated as separate sites. Future ROADMAP item.
- **Recipe `usageCount` denormalised** from usage_log. Phase 4 keeps this counter in sync on every usage_log write. Cron rebuild planned as belt-and-braces (P2 in ROADMAP).
- **`packCode` is nullable since v27.5.** Both `sampling_recipes.packCode` and `sampling_usage_log.packCode` allow null. Legacy paper register entries from 2022-2026 often have no pack recorded; nullable lets the data land truthfully and operators identify by SKU code. Unique constraint uses `NULLS NOT DISTINCT` to prevent duplicate null-pack rows.
- **`createdAt` backfill** — `createdAt` does NOT equal "row insertion time" for repaired parents. It equals "earliest historical Excel date for this samplingNo". For new entries created via live operator workflow, `createdAt = now()` as usual.
- **`shade_master` retired.** Phase 4 shipped 2026-05-25. Operator screen no longer reads `shade_master`. Table still exists with historical data, scheduled for deletion after a retention window. Do not write to it.
- **Sub-minute precision on usage_log timestamps** — `usageDate` is captured at minute granularity (matches paper register tradition). Don't surface seconds in UI.
- **Per-screen teal exemption is unique to this page** (CLAUDE_UI.md §22). Don't propagate to cousin pages.
- **Suggestion engine matches siteId STRICTLY** — `suggest.ts` queries on `usage_log.siteId` numeric FK. There is NO `siteNameRaw` fallback. Null `siteId` rows are invisible to same-site suggestions. The Phase 4 siteId write bug (FIXED 2026-06-01) made every Mark-Done since launch invisible until backfill ran. New writes always set `siteId = orders.customerId`.
- **`orders.customerId` IS the ship-to site FK** → `delivery_point_master.id`. It is NOT the bill-to dealer. Verified across multiple OBDs. Use this as the source of truth for any site-link backfill.
- **Never auto-fuzzy-match site names.** Site name suffixes like "FACE" / phase numbers distinguish genuinely different sites. Stripping or fuzzy-matching risks linking the wrong site. Backfill must prefer OBD→order→customerId resolution over name match. CORE §3 rule.
- **Split completion does NOT log sampling usage.** `app/api/tint/operator/split/done/route.ts` never writes a `sampling_usage_log` row. Split-completed tints never appear in usage history or same-site suggestions. Pre-existing, separate from any other bug. ROADMAP item.
- **Excel column 7 (TIN QTY) has a blank header** in the source tracker. Position-based reads must use column index 7 explicitly. Header-text-based parsers will silently miss this column. Lost data is invisible until visual inspection (rows appear with tinQty = 0).
- **Excel column layout drift.** The 27 May tracker file dropped a duplicate "Site Name" column at col 9, shifting all pigment columns left by 1. New PIG_COLS = [9..21] vs old [10..22]. Future imports must re-verify column positions, not assume backward compat.
- **Stale-CSV blast radius.** Don't trust CSV exports — automated background scripts may have written since export. Always run `SELECT COUNT(*) FROM ...` at session start. After any partial-commit failure, run a signature-based duplicate-detection scan BEFORE re-running.
- **`isPrimary` invariant.** Every sampling number must have exactly 1 recipe with `isPrimary=true`. Bulk INSERTs that mark "first inserted" as primary may need a post-hoc fixup. Verify with the SQL in §10.

---

## 10. Lessons codified (from Cohort A+B restore session)

These patterns surfaced during the 4,353-shade full restore. Keep them in mind for any future bulk sampling library work.

### Reverify live DB state at session start
Don't trust CSV exports. Always run a quick `SELECT COUNT(*) FROM sampling_*` at the start of any data-modifying session to confirm the snapshot matches reality. Background imports may have run since the CSV was exported.

### Paper register vs OrbitOMS sno mapping
When Chandresh writes single/double-digit numbers in the paper register on dates after Phase 4 ship date, those are shorthand for `#26-XXXX` operator-created entries — NOT new sampling numbers to create. Always check shade name + site + creation date to confirm the mapping before importing.

### Defensive ON CONFLICT on all bulk inserts
For ad-hoc import SQL targeting tables with unique constraints, ALWAYS add `ON CONFLICT (...) DO NOTHING` to make re-runs idempotent. Saves session-cleanup overhead when the inevitable stale-CSV collision happens.

### Child sampling number suffix collisions
When generating `#PARENT-N` children for parents that may have had children created in prior sessions, start the suffix counter at `MAX(existing_suffix) + 1` rather than 1. Query the live DB beats trusting CSV state.

### Pack enum string convention
PostgreSQL accepts pack code values as quoted enum strings: `'20L'::"PackCode"` not the Prisma field name `L_20`. Bare values without `::"PackCode"` will fail in raw SQL.

### Recipe `isPrimary` invariant — verify after bulk insert
```sql
SELECT "samplingNo", SUM(CASE WHEN "isPrimary" THEN 1 ELSE 0 END)
FROM sampling_recipes
GROUP BY "samplingNo"
HAVING SUM(CASE WHEN "isPrimary" THEN 1 ELSE 0 END) != 1;
```
Should return 0 rows.

### Multi-row INSERT batching for large SQL files
Supabase SQL Editor rejects files much over 1 MB. Use a Claude Code seed script (see `scripts/_seed-cohort-a.ts`, `_seed-cohort-b.ts`) with 50-row multi-row INSERTs and per-row P2002 fallback. Sub-15s execution for files with 3,000+ statements.

### Site visibility is silent
Imports landed cleanly but were invisible to operator suggestions until the `siteId` UPDATE on usage_log. Easy to miss this and declare success too early. Always verify suggestion-engine surface area after an import — query one site that should now have rows.

### Schema relaxations have ripple effects
Making one column nullable cascaded into 6 code edits + a unique-index recreation with `NULLS NOT DISTINCT` (Phase 4.6). Budget that.

### Time-bucketed `createdAt` distribution catches import waves
After any partial-commit failure:
```sql
SELECT DATE_TRUNC('hour', "createdAt") AS bucket, COUNT(*)
FROM sampling_usage_log GROUP BY bucket ORDER BY bucket;
```

---

## 11. Suggestion engine + pack scaling (operator reuse)

The Tint Operator reuse area (UI: `CLAUDE_UI.md §34`; operator flow: `CLAUDE_TINT.md §3.12`) is fed by this module.

**Flat suggestions (rewrite, 2026-06-16).** `_lib/suggest.ts` now emits **`flatSuggestions`** — an uncapped this-site list with `isExactMatch`, `primarySiteName`, `otherSites[]`. The old two-section exact/reference UI and its `exact.slice(0,3)` / `reference.slice(0,5)` caps are gone (`exactMatches`/`referenceList` still built but no longer consumed by the UI — remove in cleanup). Shared helpers `groupOtherSitesBySampling(samplingNos, excludeSiteId)` + `assembleFlatRow(...)`; exported `SuggestFlatRow`, `SuggestOtherSite`.

- **Search scope** (`operator-search`): all sites, partial (ILIKE contains) on `samplingNo` / `shadeName` / usage site name; optional `type`; `RESULT_LIMIT = 50`. No fuzzy (CORE §3 never-fuzzy-match-sites; `pg_trgm` deferred). No formula-value search.
- **Exact match** = a sampling with a variant matching the current line's `skuCode` AND `packCode` (multiple possible). Pinned top.
- **Pick = reuse, no allocation.** Attaches the existing `samplingNo`; a cross-site pick records the current site as another usage. The save path (`sampling-resolution.ts`, Scenarios 2/3) was already correct — the duplicate problem was *findability*.

**Pack scaling model (one sampling number holds multiple pack variants).** `lib/sampling/pack-litres.ts`:
- A pack scales by its **dose litres**, not raw base volume (base pairs with its nominal can; colorant fills the gap). Map: `500ml→0.5 · 0.9/0.925/1L→1 · 3.6/3.7/4L→4 · 9/9.25/10L→10 · 15→15 · 18/18.5/20L→20 · 22→22 · 30→30 · 40→40 · null→unscalable`. Nominal reuse buckets are **1/4/10/20** only; rare (0.5/15/22/30/40/null) stand alone.
- Scaling is **linear by dose-litres** (verified across all 217 multi-pack samplings; non-clean cases were data-quality noise, not real exceptions). `scalePigments` 3 dp; `perLitreFingerprint` 2 dp.
- **Scaling happens ON USE only** (TINTER): using a different-bucket row creates a **NEW pack variant under the SAME sampling number** (no new number) via the existing `sampling_recipes.create` (Scenario 2). Each pack variant keeps its own `usageCount` / `lastUsedAt`; existing variants immutable (Issue-1 guard). **ACOTONE is never scaled.**
- **formula-match** (`formula-match/route.ts`): per-litre fingerprint for TINTER (2-dp tolerance catches scaled packs — a typed 4 L matches an existing 20 L of the same shade), exact 27-value for ACOTONE. The reuse modal Cancel/Esc/backdrop aborts with no new number.

> Edit-path gap (open): the "Update TI Entry" path skips the formula-match gate and can save a null `samplingNo` — see `CLAUDE_TINT.md §14`.

---

## 12. Duplicate Merge (runbook)

Sampling Library is **operator-created runtime data, NOT CSV-seeded** — merges go live the moment the SQL runs (no commit/push/deploy) and are NOT wiped on a catalog reseed; no seed mirror-back. All work is data-only via Supabase SQL Editor (no `BEGIN`/`COMMIT`, sequential, stop on any error), plus temporary `_bak_*` tables dropped after the live smoke test.

**Business rules:**
- **Duplicates = EXACT full formula, never shade name.** Same `shadeName` with different pigment values is NOT a duplicate; different name + identical formula IS. Recipe fingerprint (all pigment columns + tinterType) is the true dedup key.
- **`packCode` is stored RAW** (`20L`, `10L`…), NOT the display label (`L_20` / `20 LT`); SQL uses the raw enum (`'20L'::"PackCode"`). Safer: match a recipe by `(samplingNo, skuCode)` only — within one number a SKU appears once — sidestepping the pack-label trap.
- **SKU+pack clash on merge → combine, don't duplicate** (unique `(samplingNo, skuCode, packCode)` NULLS NOT DISTINCT): keep one recipe, `usageCount = SUM`, `lastUsedAt = MAX`, re-point dropped `usage_log.recipeId` to the survivor, DELETE the dropped recipe.
- **`isPrimary` invariant (§9) survives** — master keeps its own primary; clear `isPrimary` on all re-pointed rows (exactly 1 true after).
- **TI history re-points in place, never dedupe/delete** — `tinter_issue_entries.samplingNo` → master (unique OBD/delivery number prevents duplicate TI rows).
- **Never delete `sampling_register` rows** — sources are inactivated (`isActive=false`); they stop appearing in the active list and stop matching new entries.
- **One review CSV per slice** (new dated file per slice; never append — Excel/OneDrive locks the shared file).

**Reference graph (every place a samplingNo lives):**
| table.column | merge action |
|---|---|
| `sampling_register.samplingNo` (PK) | sources → `isActive=false` (keep) |
| `sampling_recipes.samplingNo` (FK CASCADE) | re-point to master; resolve SKU+pack clashes first |
| `sampling_usage_log.samplingNo` (FK CASCADE) | re-point to master |
| `sampling_usage_log.recipeId` (FK SET NULL) | re-point dropped-clash rows to survivor recipe |
| `tinter_issue_entries.samplingNo` (FK SetNull) | re-point in place (never delete) |
| `tinter_issue_entries_b.samplingNo` | empty in practice — confirm 0, no action |
| `delivery_challan_formulas.sourceTiEntryId` | points at TI **id**, not samplingNo → untouched; don't delete TI rows |
| JSON / free-text columns | none hold a samplingNo (probed) |

**Runbook (per group):** 1) find the group by exact-formula match → new dated review CSV (one per slice); 2) owner sets `mergeInto` master (default pick: prefer 26-series, else highest total usageCount, tie-break oldest createdAt); 3) clash-detection grid (`GROUP BY skuCode, packCode HAVING COUNT(*)>1`); 4) merge SQL — backup → per-clash combine → re-point sources to master → primary invariant → inactivate sources; 5) verify grid (master recipe_count, primary_count=1, sources_active=0, leftover_children=0); 6) live smoke test on orbitoms.in; 7) drop backup tables.

**Status:** 3 white-only groups merged (masters `26-0196`/`26-0106`/`26-0094`); **~380 duplicate groups remain** — process group by group per the runbook. Pending: an exact-dupe-finder tool (given a seed number, find all active samplings whose primary recipe matches exactly → dated review CSV); junk test sampling `#26-0285` cleanup. Owner chose manual SQL over a batch script for now.

---

*Sampling Library v1.4 · Schema v27.11 · July 2026 · Phase 4 shipped + Cohort A+B restored · OrbitOMS*
