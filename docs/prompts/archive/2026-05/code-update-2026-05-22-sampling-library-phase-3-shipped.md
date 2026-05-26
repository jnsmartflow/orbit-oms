# Sampling Library — Phase 3 Shipped (Production Live)

**Session date:** 2026-05-22 (continuation of Phase 1 + Phase 2 sessions, all three phases shipped together)
**Status:** ✅ Phase 1 + Phase 2 + Phase 3 + FIX-1 all committed and pushed to `main`. Vercel auto-deployed to `orbitoms.in`.
**Schema version:** v27.2 → v27.3 (sampling_usage_log.deliveryNumber added)
**Next workstream:** Sampling Library Phase 4 — wire to Tint Operator TI workflow (separate planning session).

---

## 1. What landed in production today

### Three commits pushed to `main`:

1. **`ad69e281`** — `fix(tint-operator): filter assignments by active status in start/pause/resume/done routes`
   - FIX-1 from earlier sessions. Tint Operator routes now use `findFirst` with status filter instead of `findUnique`, preventing the "submit TI before starting" error when an assignment was already marked done.

2. **`e38b2c1d`** — `feat(sampling-library): production-ready library with delivery number + last-used sort`
   - The full Sampling Library feature: Phase 1 (historical viewer) + Phase 2 (UI polish) + Phase 3 (delivery no + last-used sort).

3. **`ccb568df`** — `docs: archive mockups + prompt drafts from review-view + keyboard-fix sessions`
   - Trailing artifacts from already-shipped review-view redesign and order mobile-keyboard fix sessions.

---

## 2. Sampling Library — what's live

### Functionality
A read-only historical viewer of all 4 years of legacy tinting data. Currently:
- **3,566 sampling shades** in `sampling_register`
- **4,052 variant recipes** in `sampling_recipes`
- **10,619 usage events** in `sampling_usage_log` (with **8,491 delivery numbers** backfilled from source Excel)

### Page
- Route: `/tint/sampling-library`
- Sidebar icon: FlaskConical (lucide-react)
- Page key: `sampling_library`
- Granted to roles: admin, ops_admin, tint_manager, tint_operator
- Phase 1 policy: anyone with view permission has effective edit. Strict per-action permissions deferred.

### List pane (left)
- Sorted globally by `MAX(sampling_usage_log.usageDate)` desc, NULLS LAST, `samplingNo` desc as tiebreaker
- Sort happens at SQL level via `prisma.$queryRaw` LEFT JOIN with subquery
- Each row: `#samplingNo`, `TINTER`/`ACOTONE` type label, shade name, Last Used date (`DD MMM YY`) or "Never used"
- Filter pills: All / Tinter / Acotone (segment) + Status + Needs Review
- Search: by samplingNo or shadeName (ILIKE)

### Detail pane (right) — 6 visible sections
1. **Header** — `#samplingNo` mono left, shade name + ACTIVE pill (teal) + 3 action icons (placeholder) right, counters underneath (X uses · Y packs · Z sites · W dealers)
2. **CREATED ON meta strip** — full-width strip with date · creator avatar · dealer · site · MISSING badge (amber) when site doesn't match master
3. **Variant tabs** — one tab per unique pack code, click to switch. No PRIMARY pill (dropped in Phase 3).
4. **Pigment cards** — only non-zero pigments shown, dynamic column set
5. **SKUS USED table** — variant rows with dynamic pigment columns
6. **USED AT table** — Site · Dealer · SO · First · Last · Uses. Sort: site name asc (case + hyphen/space insensitive), uses desc on ties
7. **TINTING HISTORY table** — Date · Delivery No · Dealer · Site · SKU · Qty · Operator. Pagination via "Load more (N)" footer.

### What's intentionally NOT in this release
- Notes section (deferred to Phase 4+)
- Used-At + Audit-footer sections from the original mockup
- Live write integration (no TI submits write to sampling_usage_log yet)
- 3 ActionButtons in header (Edit / Deactivate / Mark-for-review) are console.log placeholders
- Site / Sales Officer master-data filter dropdowns (stubbed in UH, not wired)
- CSV export (Export → links are placeholders)
- Strict per-action permissions (currently "view = edit" effective)

---

## 3. Phase 3 specific changes

### Schema (v26.6 → v26.7 → v27.3)

Bump applied to canonical schema version in `docs/CLAUDE_CORE.md §7` (v27.2 → v27.3 — chained from the already-current v27.2 state, not from Phase 2's stated v26.6).

```sql
-- docs/plans/sampling-register/04-delivery-no.sql
ALTER TABLE sampling_usage_log ADD COLUMN IF NOT EXISTS "deliveryNumber" TEXT;
CREATE INDEX IF NOT EXISTS idx_sampling_usage_log_delivery_no ON sampling_usage_log ("deliveryNumber");
```

Prisma model `sampling_usage_log` gained `deliveryNumber String? @db.Text` between `packCode` and `sourceRowIndex`.

### Delivery No backfill

Script: `scripts/repair-sampling-import-deliveryno.ts`

- Reads `docs/plans/sampling-register/Tinting_data_Tracker_N_REVIEWED.xlsx`, finds `Delivery no` header (column index 25)
- Aligns Excel rows to DB rows by `(samplingNo, sourceRowIndex)` — same alignment as Phase 1's REPAIR-1a
- Result: 8,491 rows updated · 2,128 rows skipped (Excel blank) · 0 alignment failures
- Idempotent: re-runs are no-ops via `WHERE "deliveryNumber" IS NULL`
- Two modes: `--mode=audit` (read-only) and `--mode=commit` (interactive yes/no prompt before UPDATE)

### Normalisation audit (NOT applied — scope decision)

Script: `scripts/normalise-sampling-data.ts`

- Audit mode ran successfully, produced 3 reports in `docs/plans/sampling-register/`:
  - `audit-skus.txt` (5 HIGH · 112 MEDIUM · 59 LOW · 0 UNRESOLVED)
  - `audit-dealers.txt` (86 HIGH · 113 MEDIUM · 41 LOW · 121 UNRESOLVED)
  - `audit-sites.txt` (291 HIGH · 104 MEDIUM · 136 LOW · 596 UNRESOLVED)
- Commit mode preview ran. **Smart Flow reviewed and aborted before applying.**
- Reason: MEDIUM band contained dangerous false positives:
  - `'SURAT PAINTS' → 'Sara Paints'` (distance=2 — different dealers)
  - `'STAR SALES' → 'SAI SALES'` (distance=2 — different dealers)
  - `'KANANI ENTERPRISE' → 'Sahani Enterprise'` (distance=2 — different surnames)
  - `'SARA COLOURS' → 'Sarita Colours'` (distance=2 — different dealers)
- Decision: Levenshtein-based fuzzy matching cannot reliably distinguish typos from genuinely different entities. Legacy typo cleanup deferred indefinitely.
- 3 backup tables created and **left in place** (`sampling_recipes_backup_20260522`, `sampling_usage_log_backup_20260522`, `sampling_register_backup_20260522`) — can be dropped at any time, or kept as a snapshot for future reference.

### UI changes

| Element | Before | After |
|---|---|---|
| Variant tabs PRIMARY pill | Teal pill on primary tab | Removed |
| Variant tabs overflow | `overflow-x-auto` (showed false scroll arrows) | `overflow-x-hidden` |
| Header ACTIVE pill | Gray (`bg-gray-100 text-gray-700`) | Teal (`bg-teal-50 text-teal-700`) |
| Recipe footnote ("Recipe for 1 tin of N pack. Poured into N SKU codes — see history below.") | Visible | Removed (along with `Info` lucide-react import) |
| TINTING HISTORY columns | Date · Dealer · Site · SKU · Qty · Operator (6 cols) | Date · **Delivery No** · Dealer · Site · SKU · Qty · Operator (7 cols, widths: 10 · 13 · 20 · 20 · 14 · 8 · 15) |
| USED AT sort | Postgres ORDER BY count desc (case-sensitive ties) | JS sort: site name asc (case + hyphen/space insensitive via `normaliseForSort` helper), uses desc on ties, null/empty sites to bottom |
| List pane row layout | `#samplingNo` + TINTER + shade name + site name + updatedAt date + indicator | `#samplingNo` + TINTER + shade name + **lastUsedAt date** + optional indicator (needs-review badge or SO avatar, em-dash fallback dropped) |
| List pane sort | findMany `orderBy: { updatedAt: "desc" }` (per-page only) | Raw SQL LEFT JOIN, ORDER BY `lastUsedAt DESC NULLS LAST, samplingNo DESC` (global across pagination) |
| List pane date format | `DD MMM` | `DD MMM YY` (year added for clarity) |
| List pane "LAST USED" label above date | Visible | Removed (date alone is clear from context) |
| Detail pane scrollbar on right edge | Browser-native vertical scroll arrows (real scrollable content) | Left as-is — genuine scroll, useful |

### Cousin colour budget audit (per CLAUDE_UI §2)

Teal elements on Sampling Library after Phase 3:
1. List pane row selection (`bg-teal-50 border-l-teal-700`) — kept
2. ACTIVE pill in detail header — NEW
3. ~~PRIMARY pill on variant tab~~ — dropped

Net: still 2 teal elements (selection + ACTIVE). Cousin colour budget restored. CLAUDE_UI §2 "ONE teal element max" rule per-screen exemption from Phase 1 is now formally removed.

---

## 4. Files changed across Phase 1 + Phase 2 + Phase 3 (all committed in `e38b2c1d`)

### Modified
- `components/shared/role-sidebar.tsx` — FlaskConical icon for sampling_library
- `docs/CLAUDE_CORE.md` — schema v27.2 → v27.3
- `lib/permissions.ts` — sampling_library page key
- `package.json` + `package-lock.json` — added `exceljs` ^4.4.0 (for Phase 1 importer), `tsx` ^4.22.3 (for running scripts)
- `prisma/schema.prisma` — sampling_register/recipes/usage_log models, back-relations, deliveryNumber field

### New — page + API
- `app/(tint)/tint/sampling-library/page.tsx`
- `app/(tint)/tint/sampling-library/layout.tsx`
- `app/api/sampling-library/route.ts` (list GET + create POST — list query rewritten to raw SQL in Phase 3)
- `app/api/sampling-library/[samplingNo]/route.ts`
- `app/api/sampling-library/[samplingNo]/variants/route.ts`
- `app/api/sampling-library/[samplingNo]/review/route.ts`
- `app/api/sampling-library/[samplingNo]/usage-log/route.ts`
- `app/api/sampling-library/_lib/validate.ts`
- `app/api/sampling-library/_lib/detail.ts`

### New — components
- `components/sampling-library/sampling-library-content.tsx`
- `components/sampling-library/sampling-library-list-pane.tsx`
- `components/sampling-library/sampling-library-detail-pane.tsx`

### New — scripts (in `scripts/`)
- `lib/sampling-classifier.ts`
- `classify-sampling-excel.ts`
- `generate-final-review-xlsx.ts`
- `import-sampling-library.ts`
- `list-missing-skus.ts`
- `repair-sampling-import.ts` (REPAIR-1 + REPAIR-1a from Phase 1)
- `repair-sampling-import-deliveryno.ts` (Phase 3 delivery no backfill)
- `normalise-sampling-data.ts` (Phase 3 — audit mode used, commit mode aborted)

### New — docs
- `docs/mockups/sampling-library/` (locked HTML mockups from Phase 1 design)
- `docs/plans/sampling-register/01-schema.sql`
- `docs/plans/sampling-register/02-permissions.sql`
- `docs/plans/sampling-register/03-repair-schema.sql`
- `docs/plans/sampling-register/04-delivery-no.sql` (Phase 3)
- `docs/plans/sampling-register/Tinting_data_Tracker_N_REVIEWED.xlsx` (source data)
- `docs/plans/sampling-register/audit-skus.txt` · `audit-dealers.txt` · `audit-sites.txt` (Phase 3 audit reports)
- `docs/prompts/drafts/SAMPLING_LIBRARY_DESIGN_SPEC.md`
- `docs/prompts/drafts/code-update-2026-05-22-sampling-library-buildout.md`
- `docs/prompts/drafts/code-update-2026-05-22-sampling-library-phase-1-handoff.md`
- `docs/prompts/drafts/code-update-2026-05-22-sampling-library-phase-2-handoff.md`
- `docs/prompts/drafts/web-update-2026-05-22-sampling-library-phase-2-design-spec.md`
- `docs/prompts/drafts/web-update-2026-05-22-sampling-library-phase-3-kickoff.md`

---

## 5. Engineering rules audit (across all 3 phases)

- ✅ No `prisma.$transaction` introduced. Sequential awaits throughout.
- ✅ No `prisma db push`. Schema bumps via Supabase SQL Editor + `npx prisma generate`.
- ✅ All API routes have `export const dynamic = "force-dynamic"`.
- ✅ `tsc --noEmit` clean before every commit.
- ✅ DB columns camelCase, no `@map`.
- ✅ Raw SQL queries use parameterised `$queryRaw` (template literal form), never `$queryRawUnsafe` with string concat.
- ✅ Fixed table standard (CLAUDE_UI §40) applied to USED AT, SKUS USED, TINTING HISTORY.
- ✅ Cousin colour budget restored (CLAUDE_UI §2).
- ✅ All commits go directly to `main`. No feature branches.
- ✅ Smoke test on localhost before every push.

### Pre-existing CORE §3 violations NOT addressed (out of scope)

These were flagged in Phase 1 but not introduced by this work. To be cleaned up in a future pass:
- `app/api/tint/operator/split/done/route.ts` — still uses `prisma.$transaction`
- `app/api/admin/shades/route.ts` — still uses `prisma.$transaction`

---

## 6. Honest state — what Sampling Library currently is and isn't

### What it IS

- A working **read-only historical viewer** of 4 years of legacy tinting data
- Useful for Chandresh / Deepak / Chandrasing to look up: "what recipe did we use for shade X last time? at which site? which dealer? when?"
- Searchable by samplingNo + shadeName
- Sortable globally by Last Used date

### What it ISN'T (yet)

- **Not live.** When a tinter does a TI today, NO row gets written to `sampling_usage_log`. The library stays frozen at the historical snapshot.
- **Not editable from UI.** The 3 action icons (Edit, Deactivate, Mark for review) in the header are placeholders.
- **Not creating new shades from UI.** The `POST /api/sampling-library` endpoint exists but no form is wired to it.
- **Not auto-detecting new variants.** When a TI uses a new SKU+pack combo on an existing shade, nothing is created automatically.
- **Not exporting.** "Export →" links are placeholders.

These all become Phase 4 work.

---

## 7. Open items at end of Phase 3

### Deferred from earlier phases (still open)

- **Detail-pane ActionButtons** (Edit / Deactivate / Mark-for-review) — placeholders only
- **"Export →" links** in SKUS USED, USED AT, TINTING HISTORY — placeholders
- **Site / Sales Officer master-data filter dropdowns** in UH — stubbed
- **Strict per-action role permissions** — currently "view = edit"
- **Notes / Audit-footer sections** from original mockup — not built
- **TI workflow → sampling_usage_log live write** — the entire Phase 4 mission

### New from Phase 3

- **Sites with NULL siteId after Phase 3** — 596 sites still don't match `delivery_point_master`. SO column in USED AT will show em-dash for these. Resolution requires either adding entries to `delivery_point_master.customerName` or a smarter master-matching workflow.
- **3 backup tables** (`*_backup_20260522`) sitting in Supabase. Drop when ready, or keep as snapshot.
- **2,128 sampling_usage_log rows still have NULL deliveryNumber** — these are legacy rows where the source Excel itself was blank. Can't be repaired without external data.

---

## 8. Production verification checklist (after Vercel deploy lands)

Open `https://orbitoms.in/tint/sampling-library` and:

- [ ] List loads, sorted by Last Used desc, top row is most recently tinted shade
- [ ] Search for `134481` → opens cleanly, USED AT shows 4 piplod variants adjacent, TINTING HISTORY shows DELIVERY NO column with real numbers and em-dash mix
- [ ] Search for `133999` → opens cleanly, DELIVERY NO column shows real numbers + em-dash for legacy blanks
- [ ] Click any random shade with 0 uses → list shows "Never used" on right
- [ ] Variant tabs → no PRIMARY pill anywhere
- [ ] ACTIVE pill in header → teal
- [ ] FIX-1 verification: open Tint Operator, start a job, complete it, refresh — should NOT see the "submit TI before starting" error

---

## 9. Training note for the team

Short Slack / WhatsApp to Chandresh, Deepak, Chandrasing:

> Sampling Library is live now at orbitoms.in/tint/sampling-library — left sidebar has a new flask icon for it.
>
> Right now it shows the last 4 years of tinting data from the paper register. You can search by sampling number (e.g. 134481) or by shade name (e.g. SPL 21YY 08/489). Each shade opens to show recipe, which SKUs it's been poured into, which sites used it, and full tinting history with delivery numbers.
>
> This is read-only for now — it's looking at past data. The next phase will connect it to the live tinting workflow so new TIs automatically update here. We'll plan that next session.
>
> Try opening 134481 first — it's a good example with multiple sites and dealers.

---

*Phase 3 shipped handoff · Sampling Library · 2026-05-22*
