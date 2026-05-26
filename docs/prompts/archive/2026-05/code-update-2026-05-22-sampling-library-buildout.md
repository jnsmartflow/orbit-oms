# Context Update v1 — Sampling Library Phase 1 shipped + repair-import + UI-1
Session date: 2026-05-22
Target files: CLAUDE_TINT.md §10 (new); CLAUDE_CORE.md §11 (sampling_library promoted from stub); CLAUDE_UI.md (per-screen teal exemption + Sampling Library typography note); schema version bump.

## SCHEMA CHANGES

Bump schema version: **v26.5 → v26.6**.

Run in Supabase SQL Editor (file: `docs/plans/sampling-register/03-repair-schema.sql`):

```sql
ALTER TABLE sampling_register
  ADD COLUMN IF NOT EXISTS "siteNameRaw" TEXT;

CREATE TABLE IF NOT EXISTS sampling_usage_log (
  "id"               SERIAL        PRIMARY KEY,
  "samplingNo"       INTEGER       NOT NULL REFERENCES sampling_register("samplingNo") ON DELETE CASCADE,
  "recipeId"         INTEGER       REFERENCES sampling_recipes(id) ON DELETE SET NULL,
  "usageDate"        DATE,
  "operatorId"       INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  "operatorNameRaw"  TEXT,
  "tinQty"           DECIMAL(10,3) NOT NULL DEFAULT 0,
  "dealerNameRaw"    TEXT,
  "siteNameRaw"      TEXT,
  "skuCodeRaw"       TEXT,
  "packCode"         "PackCode",
  "sourceRowIndex"   INTEGER,
  "createdAt"        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sampling_usage_log_sampling           ON sampling_usage_log ("samplingNo");
CREATE INDEX IF NOT EXISTS idx_sampling_usage_log_sampling_date      ON sampling_usage_log ("samplingNo", "usageDate" DESC);
CREATE INDEX IF NOT EXISTS idx_sampling_usage_log_operator_date      ON sampling_usage_log ("operatorId", "usageDate");
CREATE INDEX IF NOT EXISTS idx_sampling_usage_log_site               ON sampling_usage_log ("siteNameRaw");
```

`prisma/schema.prisma` mirrors: `sampling_register.siteNameRaw`, new `sampling_usage_log` model, and back-relations on `users.samplingUsageEntries` + `sampling_recipes.usageLog`.

## NEW/MODIFIED FILES

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | Added `siteNameRaw`, `sampling_usage_log` model, back-relations |
| `lib/permissions.ts` | Added `sampling_library` to `PageKey` union, `ALL_PAGE_KEYS`, `PAGE_NAV_MAP` |
| `components/shared/role-sidebar.tsx` | Added `FlaskConical` icon mapping for `sampling_library` |
| `app/(tint)/tint/sampling-library/page.tsx` | Bare server-component page wrapper |
| `app/(tint)/tint/sampling-library/layout.tsx` | Per-route layout (auth + sidebar) cloned from `tint/manager` |
| `app/api/sampling-library/route.ts` | List GET (paginated, filtered) + create POST |
| `app/api/sampling-library/[samplingNo]/route.ts` | Detail GET + PATCH metadata |
| `app/api/sampling-library/[samplingNo]/variants/route.ts` | Variants GET + upsert POST |
| `app/api/sampling-library/[samplingNo]/review/route.ts` | Mark-reviewed POST (idempotent-strict) |
| `app/api/sampling-library/[samplingNo]/usage-log/route.ts` | Paginated activity-log GET |
| `app/api/sampling-library/_lib/validate.ts` | Pigment array helpers, enum validators |
| `app/api/sampling-library/_lib/detail.ts` | Shared `buildSamplingDetail()` builder |
| `components/sampling-library/sampling-library-content.tsx` | Page shell — UniversalHeader + URL-driven filter state |
| `components/sampling-library/sampling-library-list-pane.tsx` | Left list pane, 4-col row, infinite scroll, gray-pattern selection |
| `components/sampling-library/sampling-library-detail-pane.tsx` | Right detail pane — 8 sections incl. dynamic pigment cols + activity timeline |
| `docs/plans/sampling-register/03-repair-schema.sql` | Idempotent additive schema patch (REPAIR-1) |
| `scripts/repair-sampling-import.ts` | Repair: createdAt + siteId/siteNameRaw + usage_log (REPAIR-1 + REPAIR-1a TIN QTY join from original Excel) |

## NEW API ENDPOINTS

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET    | `/api/sampling-library`                            | `sampling_library:canView`     | Paginated list; filters: search, tinterType, isActive, needsReview, siteId, salesOfficerId |
| POST   | `/api/sampling-library`                            | `sampling_library:canImport`   | Create parent (+ optional first variant). Allocates next samplingNo = MAX+1. |
| GET    | `/api/sampling-library/:samplingNo`                | `sampling_library:canView`     | Detail with siteName / siteNameRaw / siteMissing / primaryRecipe / aggregate counts |
| PATCH  | `/api/sampling-library/:samplingNo`                | `sampling_library:canEdit`     | Edit shadeName / site / SO / dealer / notes / isActive / needsReview. Cannot change samplingNo, tinterType, createdById, createdAt. |
| GET    | `/api/sampling-library/:samplingNo/variants`       | `sampling_library:canView`     | Variants with 27-pigment record + activePigments helper |
| POST   | `/api/sampling-library/:samplingNo/variants`       | `sampling_library:canEdit`     | Upsert by `(samplingNo, skuCode, packCode)` unique key. If isPrimary=true, clears it on every other variant first. |
| POST   | `/api/sampling-library/:samplingNo/review`         | `sampling_library:canEdit`     | Mark needsReview=false; optional `resolution` text appends to notes. Returns 400 if already reviewed. |
| GET    | `/api/sampling-library/:samplingNo/usage-log`      | `sampling_library:canView`     | Paginated usage history with operator join |

All routes start with `export const dynamic = "force-dynamic"`. All write paths use sequential awaits (no `prisma.$transaction`).

## BUSINESS RULES ADDED

- **Page key `sampling_library`** lives at `/tint/sampling-library`. Granted (in `role_permissions`) to admin, ops_admin, tint_manager, tint_operator. Phase 1 policy: "everyone with view can also edit" — strict per-action permissions deferred.
- **samplingNo is a natural key.** Preserve legacy Excel values. New rows = `MAX(samplingNo) + 1`, computed by `POST /api/sampling-library` via aggregate. No autoincrement.
- **Variants are uniquely keyed `(samplingNo, skuCode, packCode)`.** Re-POSTing the same combo updates the existing row (P2002-on-create triggers a fallback update path). The shared validator (`app/api/sampling-library/_lib/validate.ts`) is the single source for pigment normalisation and pack-code validation.
- **`isPrimary` is exclusive within a sampling.** POSTing a variant with `isPrimary=true` clears it on every other variant first via `updateMany`. No transactions — if the clearing step succeeds but the create fails, the 500 response says so and asks for manual cleanup.
- **Partial-state writes are accepted by design.** `POST /api/sampling-library` with `firstVariant`: if the parent insert succeeds but the variant insert fails, the parent is NOT rolled back. Response returns 500 with `samplingNo=X but variant failed: <reason>. Add the variant manually.` Trade-off explicitly allowed by CORE §3 (no `prisma.$transaction`).
- **Site resolution is exact-match only.** On import/repair, `siteNameRaw` is compared case-insensitive + trimmed against `delivery_point_master.customerName`. Match → set `siteId`, clear `siteNameRaw`. No match → leave `siteId` NULL, store the raw text. No fuzzy matching.
- **API computes `siteMissing = (siteId IS NULL AND siteNameRaw IS NOT NULL)`** on both detail and list responses. UI shows an amber `missing` badge against the raw text in that state. Blank-site rows render as em-dash.
- **Activity history is one row per IMPORT row from source Excel** in `sampling_usage_log`. `recipeId` is nullable (some Excel rows lack a clean SKU+pack match to a recipe variant); we still log the activity. `operatorId`/`operatorNameRaw` are NULL for the historical import — no Operator column in source.
- **Detail pane is structured as 8 visible sections**: (1) header — sno + shade + status + actions; (2) Born-At meta strip — date / creator avatar / site / dealer; (3) variant tabs; (4) pigment cards (only non-zero); (5) recipe footnote; (6) recipe history table (dynamic pigment columns); (7) action icons (top-right of §1, placeholder); (8) activity history timeline. Notes / Used-At / audit-footer from the locked mockup are NOT yet built.
- **Recipe history pigment columns are dynamic.** Compute the union of pigments where ANY variant has `value > 0`, sorted by canonical 27-code order (13 TINTER + 14 ACOTONE). The hard-coded 5-column set is gone.
- **Selection state in the left list pane uses the cousin gray pattern** (`bg-gray-100 border-l-[3px] border-l-gray-900`), NOT the teal pattern from the locked mockup. Overrides the mockup.

## BUSINESS RULES CHANGED / SUPERSEDED

- **CLAUDE_UI "ONE teal element max" rule is per-screen exempted for Sampling Library.** Smart Flow confirmed teal can appear on the segment pill, variant tabs, PRIMARY pill, pack pill, Export links, recipe-history active-row highlight. The exemption applies only to this screen; cousins remain bound by the rule.
- **Typography across Sampling Library trimmed from locked-mockup weights** to match cousin convention: `font-bold` → `font-semibold` for status pills, variant tabs, PRIMARY badge, pack-pill, pigment-card values; `font-bold` → `font-medium` for table headers and tabular cell values; sampling-no in list pane reduced from `text-[15px]` to `text-[13px]`; shade name in detail header from `text-[22px] font-bold` to `text-[18px] font-semibold`. The mockup pixel match was overridden for weight/size only — colors and layout still match.
- **Sampling Library import (step 3b) is now considered "phase 1 v1" — superseded by REPAIR-1 + REPAIR-1a.** The original import (a) wrote `createdAt = today's date` for every parent and (b) ignored Excel SITE NAME and (c) collapsed all per-tinting rows into recipes (no usage history). REPAIR-1 sets `createdAt = earliest Excel usage date`, populates `siteId`/`siteNameRaw`, and re-explodes Excel rows into `sampling_usage_log`. REPAIR-1a reads TIN QTY from the original Excel by **position (col index 7)** — its header is blank in the source, so the classifier dropped it from REVIEWED.xlsx; the script joins via row-index alignment, spot-checked across 5 rows before each run.

## PENDING ITEMS

New pendings:
- **Detail-pane action buttons** (Edit / Deactivate / Mark for review, top-right of §1) are placeholder-only; they log to console. Wire to PATCH `/:samplingNo` and POST `/:samplingNo/review` when modal/form components are designed.
- **"Export →" links** in Recipe History and Activity History sections are placeholders. CSV export not wired.
- **Site / Sales Officer filter dropdowns** in the page header are stubbed. UH filter groups currently only include Status and Needs Review. Site/SO need master-data autocompletes (not the standard UH multi-pill style).
- **Strict per-action role permissions** deferred per Phase 1 spec. Currently any role with `canView` also has effective edit (Phase 1 policy). Tighten when the page is operator-facing.
- **TI workflow integration** not wired: `tinter_issue_entries` does not carry `samplingNo` yet, and `sampling_usage_log` is populated one-shot from Excel — no live updates from TI submits.
- **Notes / Used-At / Audit-footer sections** from the locked mockup not yet built in the detail pane. Tracked separately.

Completed from earlier drafts:
- ✓ Sampling Library schema (v1) — DONE in step 3a
- ✓ Sampling Library Excel importer + classifier + REVIEWED.xlsx workflow — DONE in step 3b
- ✓ Sampling Library page shell + list + detail panes — DONE this session (steps 8 / 9 / 10)
- ✓ Page key `sampling_library` added to `PAGE_NAV_MAP` / `ALL_PAGE_KEYS` / `PageKey` union — DONE
- ✓ Sidebar icon (FlaskConical) + per-route layout — DONE
- ✓ Repair-import for createdAt + siteId/siteNameRaw + sampling_usage_log — DONE (REPAIR-1 + REPAIR-1a)

## CHECKLIST UPDATES

Add to CLAUDE_CORE.md §14 session-start checklist:

- When working on Sampling Library, confirm schema **v26.6** (sampling_register has `siteNameRaw` column; `sampling_usage_log` table present with 4 indexes). Older versions will fail at runtime.

## CONSOLIDATION NOTES

- **CLAUDE_TINT.md — append §10 "Sampling Library"** covering:
  - Page route `/tint/sampling-library`, page key `sampling_library`, 4 granted roles
  - Three tables: `sampling_register`, `sampling_recipes`, `sampling_usage_log` — field reference + the natural-key rule
  - 8 API endpoints (list/detail/PATCH/variants/POST-variant/review/usage-log/POST-create)
  - Site resolution semantics: `siteId` vs `siteNameRaw` vs `siteMissing` (computed)
  - Activity History data source = `sampling_usage_log` (one row per Excel IMPORT row; nullable recipeId; nullable operator)
  - 8-section detail-pane structure
  - REPAIR-1 + REPAIR-1a gotchas: TIN QTY column has BLANK header in source Excel — read by position (col index 7)
  - File should grow toward ~200 lines; if it crosses 250, extract to `docs/CLAUDE_SAMPLING_LIBRARY.md` and update CLAUDE.md §3 router

- **CLAUDE_CORE.md §11 — promote `sampling_library` from stub to production-live**, with cross-references to CLAUDE_TINT.md §10. Note schema version bump.

- **CLAUDE_UI.md — add per-screen teal-exemption note (?)**: Sampling Library page uses teal across multiple elements intentionally (segment pill, variant tabs, PRIMARY pill, pack pill, Export links, recipe-history active row). Cousins remain bound by the "ONE teal element max" rule. Open question for consolidation: codify as a per-screen override mechanism, or as a per-page exemption list.

- **CLAUDE_UI.md — Sampling Library typography note (?)**: when the locked mockup specifies `font-bold` for status pills / variant tabs / large tabular numerals, the implementation drops one weight to `font-semibold` or `font-medium` to match cousin convention. Decide at merge time whether this is a project-wide rule or a Sampling Library-only override.

- **Schema version bump v26.5 → v26.6**: `sampling_register.siteNameRaw` column added; `sampling_usage_log` table added with 4 indexes. Mirror in `prisma/schema.prisma` + back-relations on `users.samplingUsageEntries` and `sampling_recipes.usageLog`.
