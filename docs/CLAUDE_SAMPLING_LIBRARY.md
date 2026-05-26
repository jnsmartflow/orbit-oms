# CLAUDE_SAMPLING_LIBRARY.md — Sampling Library Module
# v1.1 · Schema v27.4 · Phase 4 shipped 2026-05-25
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
packCode        PackCode           — enum
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

UNIQUE (samplingNo, skuCode, packCode)   — natural key for one recipe variant
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
- Source of truth: `sku_master.materialCode` for SKUs; `delivery_point_master.customerName` for dealer/site

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

Total 8 endpoints. All `export const dynamic = 'force-dynamic'`.

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
  status-pills.tsx
  action-buttons.tsx

lib/sampling-library/
  types.ts
  fetchers.ts                       client API helpers
  filters.ts                        URL query → filter object
  allocate-sampling-no.ts           P2002 retry pattern

api/sampling-library/
  route.ts                          GET list, POST create
  [samplingNo]/route.ts             GET detail, PATCH parent
  [samplingNo]/variants/route.ts    GET variants, POST new variant
  [samplingNo]/review/route.ts      POST toggle needsReview
  [samplingNo]/usage-log/route.ts   GET paginated usage

scripts/                            (outside docs index; reference scripts on depot PC)
  classify-sampling-excel.ts        Excel → review xlsx
  generate-final-review-xlsx.ts     Colour-coded triage xlsx
  import-sampling-library.ts        Dry-run + commit
  repair-sampling-import.ts         Historical backfill
  lib/sampling-classifier.ts        Shared classifier
```

---

## 9. Landmines

- **Cross-customer "same site" grouping not implemented.** Multi-SAP-code sites (e.g. "Sun Shantam" with 5 customer codes) are treated as separate sites until Phase 4 grouping work.
- **Recipe `usageCount` denormalised** from usage_log. Phase 4 keeps this counter in sync on every usage_log write. Cron rebuild planned as belt-and-braces (P2 in ROADMAP).
- **`packCode` enum** — both `sampling_recipes.packCode` and `sampling_usage_log.packCode` must match the `PackCode` enum. Legacy import set most to known packs but some import rows came through with packCode=null (recipe match failed); these have null `recipeId` in usage_log.
- **`createdAt` backfill** — `createdAt` does NOT equal "row insertion time" for repaired parents. It equals "earliest historical Excel date for this samplingNo". For new entries created post-2026-05-22, `createdAt = now()` as usual.
- **`shade_master` retired.** Phase 4 shipped 2026-05-25. Operator screen no longer reads `shade_master` — all shade suggestions come from `sampling_usage_log`. `shade_master` table still exists with historical data but is scheduled for deletion after a retention window. Do not write to it.
- **Sub-minute precision on usage_log timestamps** — when Phase 4 starts writing on TI Done, the `usageDate` is captured at minute granularity (matches paper register tradition). Don't surface seconds in UI.
- **Per-screen teal exemption is unique to this page** (CLAUDE_UI.md §22). Don't propagate to cousin pages.

---

*Sampling Library v1.1 · Schema v27.4 · Phase 4 shipped · OrbitOMS*
