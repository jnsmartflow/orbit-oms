# Sampling Library — Locked Design Spec

**Status:** ✅ Approved by Smart Flow · awaiting implementation
**Mockup reference:** `docs/mockups/sampling-library/sampling-library-v4.html`
**Date locked:** 18 May 2026

---

## Purpose

Bring the depot's paper Sampling Register into OrbitOMS as a searchable, browseable digital library. **Phase 1 is read + search only.** No wiring into TI workflow yet. Get operator/TM sign-off on the page first, then wire later.

---

## Page route

`/tint/sampling-library` (new page key: `sampling_library`)

Add to `PAGE_NAV_MAP`, `PageKey`, `ALL_PAGE_KEYS`. Grant view+edit to:
- `admin`
- `ops_admin`
- `tint_manager`
- `tint_operator`
- `sales_officer` (read-only initially)

For Phase 1: **everyone with view can edit** (per operator answers — strict permissions deferred).

---

## Layout

**Split view 35% / 65%** — left list, right detail. No tabs, no slide-overs.

### Top bar (existing UniversalHeader pattern)

- Row 1: page title "Sampling Library" · 3 stats (Total / Active / Needs Review) · search box · "+ New Sampling" primary button
- Row 2: filter chips — Type · Status · SO · Site · Date range · "Needs Review" amber pill · Clear

### Left pane (35%) — minimal list

Sticky toolbar at top: result count + sort control (default "Last used ↓").

Each row is a 4-column grid, 2 lines tall (~56px min height):

```
[sampling no]   [shade name]              [date]    [SO]
[TINTER label]  [📍 site name]            [        ] [avatar]
```

| Field | Style |
|---|---|
| Sampling No. | JetBrains Mono, bold, 13.5px, `#134481` format |
| Type sub-label | Mono uppercase 10px, tinter=blue / acotone=orange |
| Shade Name | Inter semibold 13px |
| Site | Inter 11px muted, pin icon prefix |
| Date | Mono 11.5px |
| SO avatar | 22px circle, teal+white if has SO, grey+em-dash if empty |

**Empty/legacy rows:** site shows "legacy · no site" or "unresolved · 2022 batch" in italic muted.
**Needs Review rows:** amber dot with halo replaces SO avatar.
**Selected row:** teal soft background + 3px teal left border.

### Right pane (65%) — detail

Stacked sections, all visible (scroll the pane). Order from top:

#### 1. Header

```
┌─────────────────────────────────────────────────────────────────┐
│ #134481  │  SPL 21YY 08/489                          [✏][⊘][⚠] │
│ TINTER   │  ⏺ Active · 15 uses · 5 sites · 4 dealers · 2 packs │
│          │  ─────────────────────────────────────────────────  │
│          │  Born at · 📅 09 Jan 2026 · (AS) Ajay Shah ·       │
│          │            📍 GPH Piplod · 🏢 Bajrang Structures   │
└─────────────────────────────────────────────────────────────────┘
```

- **Sampling No. block** (left): big mono 30px `#134481`, TINTER/ACOTONE label below in mono 10.5px, vertical divider on right
- **Shade block** (centre):
  - Shade name (Inter bold 18px)
  - Status row: Active badge + summary "X uses · Y sites · Z dealers · N packs"
  - Dashed top border, then **origin line**: label "Born at" + 4 pieces separated by dots:
    - 📅 Date (calendar icon)
    - SO avatar (20px circle, "AS") + name
    - 📍 Site (pin icon) + name
    - 🏢 Dealer (building icon) + name
- **Actions block** (right): 3 icon buttons — Edit · Deactivate · Mark Needs Review

> ⚠️ Origin label text: **"Born at"** (not "Born", not "Created on")

#### 2. Recipe

Tab switcher at top — one tab per pack size used. Default tab = **20 LT if present**, else most-used pack.

```
┌─────────────────────────────────────────────────────────────────┐
│  20 LT · 8 uses [PRIMARY]   │  4 LT · 7 uses                   │
│ ─────────────────────────────                                   │
│                                                                 │
│   ┌─────┐  ┌─────┐  ┌──────┐                                   │
│   │ YOX │  │ TBL │  │ WHT  │   ← only non-zero pigments        │
│   │ 350 │  │  30 │  │ 1400 │                                   │
│   └─────┘  └─────┘  └──────┘                                   │
│                                                                 │
│  ⓘ Recipe for 1 tin of 20 LT pack. Poured into 2 SKU codes.    │
└─────────────────────────────────────────────────────────────────┘
```

- Tabs: pack size label + use count + "PRIMARY" pill on the default
- Pigment chips: rounded card border teal-soft, code label (mono 10.5px teal) above, value (mono 22px bold) below
- **Only render chips for non-zero pigments** — empty pigments are skipped entirely
- Footnote line at bottom

#### 3. Recipe History

Wide horizontal-scroll table — one row per (SKU + pack) combo used historically.

| SKU | Product | Pack | YOX | TBL | WHT | BLK | OXR | ... | Uses | Last Used |
|---|---|---|---|---|---|---|---|---|---|---|
| IN28109481 | DULUX GLOSS ACCENT BASE | 20 LT | 350 | 30 | 1,400 | — | — | | 8 | 14 May 26 |
| IN28109471 | DN GLOSS ACCENT BASE | 4 LT | 70 | 6 | 280 | — | — | | 5 | 18 Mar 26 |
| 5867123 | DN GLOSS ACCENT BASE | 4 LT | 70 | 6 | 280 | — | — | | 2 | 14 May 26 |

- Pigment columns: all 13 TINTER columns (YOX, LFY, GRN, TBL, WHT, MAG, FFR, BLK, OXR, HEY, HER, COB, COG) for tinter samplings; 14 ACOTONE for acotone
- Empty cells: em-dash `—`, muted
- **Primary row** (the pack matching the active recipe tab): soft teal background + teal left-edge bar
- Pack as pill: mono 10.5px in teal-soft chip
- Sort by Uses desc
- Right-aligned export link in section title

#### 4. Notes

Single textarea, surface-2 bg, editable. Pre-saved sample text.

#### 5. Used At — cross-site reuse

Compact table grouped by (Site + Dealer + SO) showing first/last/uses.

| Site | Dealer | SO | First | Last | Uses |
|---|---|---|---|---|---|
| GPH Piplod (SAP: 102359) | Bajrang Structures LLP | (AS) Ajay Shah | 09 Jan | 18 Mar | 9 |

#### 6. Activity — full TI timeline

Latest 5 TIs by default, "View all →" link.

```
14 May   J.K Infra tinted at GPH Palsana Police          2 tins
         5867123 · 4LT · by Deepak
```

#### 7. Audit footer

Bottom strip on surface-2 bg: "Created DD MMM YYYY by NAME · Updated DD MMM YYYY"

---

## Design tokens (locked)

| Token | Value |
|---|---|
| Body font | Inter |
| Mono font | JetBrains Mono |
| Accent | `#0F766E` (teal) — single page accent |
| Tinter pill | `#1D4ED8` on `#DBEAFE` |
| Acotone pill | `#C2410C` on `#FFEDD5` |
| Amber (needs review) | `#B45309` on `#FEF3C7` |
| Green (active) | `#047857` on `#D1FAE5` |
| Modal CTA bg | `bg-gray-900` per UI §13 |

---

## Schema requirements

Two new tables. See `docs/plans/sampling-register/schema.md` for full design.

### `sampling_register` (parent — one row per sampling number)

| Field | Type | Notes |
|---|---|---|
| `samplingNo` | Int PK | Natural key. Preserve legacy values. New = MAX+1 |
| `shadeName` | String | Editable. Not unique. |
| `tinterType` | enum TinterType | TINTER / ACOTONE — fixed at creation |
| `siteId` | Int? FK → delivery_point_master.id | Nullable for legacy |
| `salesOfficerId` | Int? FK → sales_officer_master.id | Nullable for legacy |
| `dealerName` | String? | Free text for now (no dealer master) |
| `notes` | String? | TM annotations |
| `isActive` | Boolean default true | Soft delete |
| `needsReview` | Boolean default false | Migration flag |
| `createdById` | Int FK → users.id | "system" user for migration |
| `createdAt`, `updatedAt` | DateTime | |

### `sampling_recipes` (child — one row per SKU+pack combo)

| Field | Type | Notes |
|---|---|---|
| `id` | Int PK autoincrement | |
| `samplingNo` | Int FK → sampling_register.samplingNo | |
| `skuCode` | String | The SAP base SKU |
| `productName` | String? | Description from import (e.g. "DULUX GLOSS ACCENT BASE") |
| `packCode` | enum PackCode | Existing enum |
| `tinQty` | Decimal default 0 | |
| **13 TINTER pigment cols** | Decimal? default 0 | YOX, LFY, GRN, TBL, WHT, MAG, FFR, BLK, OXR, HEY, HER, COB, COG |
| **14 ACOTONE pigment cols** | Decimal? default 0 | YE2, YE1, XY1, XR1, WH1, RE2, RE1, OR1, NO2, NO1, MA1, GR1, BU2, BU1 |
| `isPrimary` | Boolean default false | One per sampling, set on the 20LT variant if exists |
| `usageCount` | Int default 0 | Updated when TI references it |
| `lastUsedAt` | DateTime? | Updated on every TI submit |
| `firstUsedAt` | DateTime? | Set on first TI use |
| `createdAt`, `updatedAt` | DateTime | |

Unique: `@@unique([samplingNo, skuCode, packCode])`
Indexes: `(tinterType, skuCode, packCode, isActive)` on parent + child for hot path

### No changes to `shade_master` in Phase 1

Stays as-is. Read-only retention. Future phase deprecates writes.

### No changes to `tinter_issue_entries` in Phase 1

`samplingNo` link comes later when we wire TI workflow.

---

## Migration — seed library from 4-year Excel

**Source file:** `2026_SAMPLE.xlsx` and `Tinting_data_Tracker_N.xlsx` (~14k rows / ~4.2k sampling numbers).

**Classification at import:**

1. **Clean rows (~89%)** — one sampling number = one shade name, recipe stable per (SKU + pack). Auto-import.
2. **Multi-shade rows (~11%)** — one sampling number has multiple shade names. Set `needsReview=true`, parent row created with first shade name as candidate, child variants imported with their actual values. TM reviews later.

**For every imported row:**
- `siteId` = NULL (legacy, unknown)
- `salesOfficerId` = NULL (legacy, unknown)
- `dealerName` = first dealer seen for that sampling (free text)
- `createdById` = system user (create one if missing — username "migration_bot" or similar)
- `createdAt` = original Excel date if present, else import timestamp
- `notes` = NULL

**`isPrimary` logic:** for each sampling, set isPrimary=true on the variant with packCode="L_20" if it exists; else on the most-used pack.

**Pigment columns:** import exact values from Excel as-is. No normalisation.

---

## What's NOT in Phase 1

- ❌ Creating a new sampling from this page (deferred — TI workflow integration covers it)
- ❌ Editing recipe values from this page (recipes are append-only)
- ❌ Wiring `samplingNo` onto `tinter_issue_entries` (separate phase)
- ❌ Operator-facing recipe lookup during TI submit (separate phase)
- ❌ Sticker/label printing
- ❌ Strict role permissions (everyone-can-edit per operator answers)

---

## What IS in Phase 1

✅ New page at `/tint/sampling-library`
✅ Search + filters (sampling no, shade name, site, type, status, SO, date)
✅ List view with selected-row highlight
✅ Detail panel with all 7 sections per the locked mockup
✅ Edit shade name / notes / activate-deactivate / mark-needs-review
✅ Recipe tab switcher per pack
✅ Recipe history table (read-only)
✅ Used At cross-site table
✅ Activity timeline (last 5, expandable to full)
✅ Excel import (admin-only endpoint, dry-run + commit)
✅ TM review queue for the 11% flagged rows

---

## Build sequence (suggested for next session)

| Step | Work | Est |
|---|---|---|
| 1 | Schema migration (sampling_register + sampling_recipes) via Supabase SQL Editor | 30 min |
| 2 | Prisma client regen + types | 10 min |
| 3 | Excel import script (CSV-driven, dry-run mode) | 2 hrs |
| 4 | TM review queue UI + resolve endpoints | 1.5 hrs |
| 5 | Page shell + UniversalHeader + filters | 1 hr |
| 6 | Left list pane + search | 1.5 hrs |
| 7 | Right detail pane — header + recipe + recipe history | 2 hrs |
| 8 | Right detail pane — notes + used-at + activity timeline | 1.5 hrs |
| 9 | Edit actions (shade name, notes, deactivate, mark review) | 1 hr |
| 10 | Run import on production with 4-year Excel | 30 min |
| 11 | Smoke test + screenshots → share with operators | 30 min |
| | **Total** | **~12 hrs** |

---

## Files to be created/modified

```
prisma/schema.prisma                                    [edit — add models]
app/(tint)/tint/sampling-library/page.tsx              [new]
app/(tint)/tint/sampling-library/layout.tsx            [new]
components/tint/sampling-library/                       [new dir]
  ├── sampling-library-content.tsx                     [main split layout]
  ├── library-list-pane.tsx                            [left pane]
  ├── library-detail-pane.tsx                          [right pane]
  ├── library-detail-header.tsx                        [header section]
  ├── library-recipe-block.tsx                         [recipe tabs + chips]
  ├── library-recipe-history.tsx                       [wide table]
  ├── library-used-at-table.tsx                        [cross-site]
  └── library-activity-timeline.tsx                    [TI log]
app/api/tint/sampling-library/
  ├── list/route.ts                                    [GET paginated list]
  ├── [samplingNo]/route.ts                            [GET detail, PATCH metadata]
  └── [samplingNo]/variants/route.ts                   [GET recipe variants]
app/api/admin/sampling-library/
  ├── import/route.ts                                  [POST CSV, dry-run]
  ├── import/commit/route.ts                           [POST commit]
  └── review/[samplingNo]/route.ts                     [POST resolve]
scripts/import-sampling-excel.ts                        [one-time importer]
lib/sampling-library/
  ├── classifier.ts                                    [clean vs needsReview logic]
  ├── primary-variant.ts                               [isPrimary selection]
  └── usage-stats.ts                                   [updates on TI submit — Phase 2]
docs/CLAUDE_TINT.md                                    [edit — append §10 Sampling Library]
```

---

## Engineering rules (CORE §3 — non-negotiable)

- No `prisma.$transaction` — sequential awaits only
- No `prisma db push` — Supabase SQL Editor + `npx prisma generate`
- All API routes: `export const dynamic = 'force-dynamic'`
- All commits go direct to `main`, no feature branches
- `tsc --noEmit` must pass before commit
- DB columns camelCase, no `@map`
- Modal CTAs: `bg-gray-900`

---

## Acceptance criteria

Smart Flow approves Phase 1 when:

1. Page loads at `/tint/sampling-library` with 4-year Excel data visible
2. Operator can type a sampling number and find the row in <2s
3. Right pane shows shade name, recipe (20LT default), all SKU+pack variants, full TI timeline
4. "Needs Review" filter shows the ~11% flagged rows
5. TM can resolve a flagged row (rename, split, or discard)
6. Page renders correctly on desktop 1440px and 1920px
7. No console errors
8. `tsc --noEmit` passes
