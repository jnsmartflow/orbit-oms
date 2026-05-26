# Sampling Library — Phase 1 Handoff

**Session date:** 2026-05-21 / 2026-05-22
**Status:** Phase 1 build complete (steps 1–11 of original checklist).
**Commit status:** ⚠️ NOTHING PUSHED TO MAIN. All work sits on the depot PC, uncommitted.
**Next session:** Sampling Library Phase 2 — Polish + Final Push.

---

## 1. What got built (in order)

### Step 1 — Database schema
- `sampling_register` table created in Supabase via `docs/plans/sampling-register/01-schema.sql`
- `sampling_recipes` table created in same SQL
- camelCase columns throughout, no `@map`
- Both tables use enum types `TinterType` and `PackCode` (already existed in DB)
- Indexes on filter fields + composite unique on `(samplingNo, skuCode, packCode)`
- Status: **live in production**

### Step 2 — Prisma schema mirror
- `prisma/schema.prisma` edited to add two new models
- Back-relations added on `users`, `delivery_point_master`, `sales_officer_master`
- `npx prisma generate` ran clean
- `npx tsc --noEmit` passed
- Status: **live in local schema, not pushed**

### Step 3 — Excel classifier + importer
- `scripts/lib/sampling-classifier.ts` — shared classifier logic
- `scripts/classify-sampling-excel.ts` — produces `Tinting_data_Tracker_N_REVIEWED.xlsx` (importer's working file)
- `scripts/generate-final-review-xlsx.ts` — produces `Tinting_data_Tracker_N_FINAL_REVIEW.xlsx` (offline triage file with colour-coding + date formatting)
- `scripts/import-sampling-library.ts` — dry-run + commit modes
- Classifier rules:
  - Action = IMPORT when all rows for a sampling no agree on shade + SKU + tinter type + pack
  - Action = REVIEW when multi-shade, partial blank, unknown pack, etc.
  - Action = SKIP when invalid sampling no, all rows blank shade, all rows blank SKU
  - tinterType hard-coded to `TINTER` (no ACOTONE rows in source)
  - Pack extracted from DESC tail or recovered via SKU master lookup
  - SKU lookup uses TWO sources: SAP stock file (primary) + 9-sheet legacy master (fallback)
- Final import result: **3,566 parents + 4,052 recipes** in production DB

### Step 3 repair — Backfill historical data
- `scripts/repair-sampling-import.ts` — fills in data that initial import dropped
- New SQL: `docs/plans/sampling-register/03-repair-schema.sql`
  - Added `siteNameRaw TEXT` column to `sampling_register`
  - Created `sampling_usage_log` table for activity history
- Repair commit results:
  - 3,566 parents UPDATED — `createdAt` set to earliest historical date per sampling no (range now spans 2022-05-02 to 2026-05-15, not just today)
  - 1,520 parents matched to `delivery_point_master` via exact site name
  - 2,041 parents stored raw site name (no master match)
  - 10,619 `sampling_usage_log` rows INSERTED — one per Excel row with date, sku, pack, qty (from col H), dealer, site

### Step 4 — Permissions
- `lib/permissions.ts` edited:
  - `'sampling_library'` added to `PageKey` type, `ALL_PAGE_KEYS`, `PAGE_NAV_MAP`
  - href = `/tint/sampling-library`
- SQL: `docs/plans/sampling-register/02-permissions.sql`
  - 4 roles granted: admin (full), tint_manager (view+edit+export), ops_admin (view+edit+import+export), tint_operator (view+edit per spec)
  - SQL patched to include `updatedAt` column (was missing, would have failed on rerun)
- Status: **live in DB**

### Steps 5, 6, 7 — API endpoints
- `app/api/sampling-library/route.ts` — GET (list with filters + pagination), POST (create)
- `app/api/sampling-library/[samplingNo]/route.ts` — GET (detail), PATCH (update)
- `app/api/sampling-library/[samplingNo]/variants/route.ts` — GET (variants list), POST (add/upsert variant)
- `app/api/sampling-library/[samplingNo]/review/route.ts` — POST (mark reviewed)
- `app/api/sampling-library/[samplingNo]/usage-log/route.ts` — GET (paginated activity history)
- Shared helpers in `app/api/sampling-library/_lib/`:
  - `validate.ts` — pigment + enum validators
  - `detail.ts` — detail-response shape builder reused by GET / PATCH / review
- All API routes use `export const dynamic = 'force-dynamic'`
- No `prisma.$transaction` anywhere
- Permission check via `checkAnyPermission(roles, 'sampling_library', '<canView|canEdit|canImport>')`

### Step 8 — Page shell + FIX-2 sidebar
- `app/(tint)/tint/sampling-library/page.tsx` — bare component
- `app/(tint)/tint/sampling-library/layout.tsx` — clone of TM layout with permission key swap (added in FIX-2)
- `components/sampling-library/sampling-library-content.tsx` — UniversalHeader + URL-driven filter state + 2-pane layout
- `components/shared/role-sidebar.tsx` — registered `FlaskConical` icon for `sampling_library` (FIX-2)
- Header shows: title + shade count + type pills (All/Tinter/Acotone) + Needs Review badge + Filter dropdown + IST clock + search

### Step 9 — List pane (rebuilt to match mockup)
- `components/sampling-library/sampling-library-list-pane.tsx`
- First build: vertical-stack cards (cousin pattern) — rebuilt after mockup review
- Final build: horizontal 3-column rows per LOCKED mockup
  - Col 1: `#samplingNo` + TINTER/ACOTONE label
  - Col 2: shade name + pin icon + site (or "no site" / "legacy · no site")
  - Col 3: date + 20px indicator circle (amber dot for needs-review, teal initials avatar for SO, or gray dash)
- Selected = `bg-teal-50` + `border-l-teal-700` (3px)
- URL-driven selection via `?samplingNo=<N>`
- Infinite scroll via IntersectionObserver, 50 per page, sort = updatedAt desc

### Step 10 — Detail pane (7 sections)
- `components/sampling-library/sampling-library-detail-pane.tsx`
- Sections built:
  1. Header strip — big `#samplingNo` mono, TINTER label below, shade name, ACTIVE pill, "<N> uses · <N> packs", action icons top-right (Pencil/Ban/AlertTriangle — placeholders, no handlers)
  2. Meta strip — Born At label + date, creator avatar + name, pin + site, building + dealer
  3. Variant tabs — one per recipe row, primary first, click switches active
  4. Pigment cards — large display of non-zero pigments for selected variant
  5. Footnote — "Recipe for 1 tin of X pack..."
  6. Recipe history table — dynamic pigment columns (only shows pigments that have value across variants)
  7. Activity history timeline (new section, mockup-faithful)
- Selected row in recipe history highlighted teal

### POLISH-1 — Typography weight reduction
- Both list-pane and detail-pane patched to match cousin pages (TM, Shade Master)
- 16 style adjustments applied: font-bold → font-semibold or font-medium across pills, table cells, pigment values, headers
- Result: detail pane feels visibly lighter and consistent with rest of OrbitOMS

### UI-1 — Activity history + dynamic pigment columns
- API: added `siteNameRaw` and `siteMissing` to detail + list endpoint responses
- API: new `/usage-log` endpoint
- UI: recipe-history pigment columns now dynamic (only show non-zero pigments)
- UI: site display uses pin + amber "missing" badge when siteNameRaw is set
- UI: new Activity History timeline section with date-left / details-right layout, "Load more" pagination at 25 per fetch

---

## 2. What's pending (open issues for Phase 2)

The following came up in final review and are NOT yet fixed. All visible on the depot PC's localhost build.

### Issue A — Variant tabs duplicated by SKU
**What:** Shade #134481 shows 5 tabs (`20 LT · 4 LT · 20 LT · 4 LT · 4 LT`) because we have 5 recipe rows (different SKUs, including case variants like IN28109481 and in28109481).
**Why:** Each `sampling_recipes` row becomes a tab.
**User's preference:** Collapse to ONE tab per unique pack (so just `20 LT` and `4 LT` for this shade). Recipe is shared across SKUs anyway.
**Open decision:** confirm grouping rule (pack-only OR case-insensitive SKU+pack). User did not answer this in session.

### Issue B — Recipe history section title misleading
**What:** Section labeled "RECIPE HISTORY" but it's actually a variant list (the variants of this shade).
**Action:** Rename to something clearer like "VARIANTS" or "PACK VARIANTS" or "RECIPE BY PACK". Final name to be agreed in Phase 2.

### Issue C — Activity history layout — timeline → simple table
**What:** Activity history is currently a date-left / details-right timeline. User wants a flat table for easier scanning.
**Plus:** Current line reads "Used at J K INFRA · GPH PALSANA POLICE" — that's wrong, J K Infra is the **dealer** and GPH PALSANA POLICE is the **site**. Need explicit column headers.
**Suggested columns:** Date · Dealer · Site · Pack · Qty · SKU · Operator (with proper headers).

### Issue D — Meta strip ordering: dealer before site
**What:** Currently shows site before dealer (pin icon then building icon). User wants dealer first, then site.

### Issue E — One site / multiple dealers AND multiple sites / multiple dealers
**What:** Current UI shows one dealer + one site per shade. Real data has shades with:
- Same site used by different dealers (one site multi-dealer)
- Same dealer using different sites (one dealer multi-site)
- Many-to-many combinations
**Action needed:** Compute distinct (dealer, site) pairs from `sampling_usage_log` and display all of them, not just one. Mockup section §1 says "X sites · Y dealers" — that text is correct but the meta strip below currently shows only one of each.

### Issue F — "Born At" — rename to professional term
**What:** Current label says "BORN AT". User wants a more professional label.
**Suggestion:** "CREATED ON", "FIRST ENTERED", or "ADDED" — recommend `CREATED ON` for consistency with rest of OrbitOMS where `createdAt` is the convention. Final pick in Phase 2.

### Issue G — Colour palette overhaul
**What:** User reports too much teal in the detail pane. CLAUDE_UI.md "ONE teal element" rule was relaxed during this session because the LOCKED mockup itself used teal across many elements. User now wants to step back from teal.
**Action:** Reduce teal usage; replace with black/gray/neutral. Reserve teal for selection state and PRIMARY badge only. ACTIVE pill, sampling-no number, pack pills, recipe-history selected row, etc. → all neutralized.
**Implication:** Mockup is no longer the visual source of truth on colour. Cousin pages (TM, Shade Master) become the colour reference.

### Issue H — Header void space + redesign
**What:** Detail pane header section 1 has empty/awkward space below the large `#samplingNo` block. Visual rhythm feels off.
**Action:** Redesign the header to fill space sensibly. Possible directions:
- Move action icons down beside the meta strip instead of top-right
- Use the void to show the "X uses · Y sites · Z dealers · W packs" inline with the shade name
- Add a status timeline / last-action summary
- Final design to be drafted in Phase 2 before code change

---

## 3. Other bugs surfaced (NOT in Phase 1 scope, logged for separate work)

### Tint Operator — "Submit TI before starting" misfires
- Diagnosis report: `app/api/tint/operator/start/route.ts` lines 35-42 and 82-88 did not filter assignments by status. Skipped/cancelled rows could be picked instead of the active assignment.
- FIX-1 prompt applied to depot PC:
  - `start/route.ts` — status filter added: `IN ('assigned', 'tinting_in_progress', 'paused')`
  - `split/start/route.ts` — same with order_splits enums
  - `pause/route.ts`, `resume/route.ts` — converted findUnique to findFirst with status filter
  - `split/done/route.ts` — added status filter
- `tsc --noEmit` clean
- ⚠️ **NOT PUSHED TO PROD.** Depot PC has the fix locally. Production code still has the bug.
- Manual SQL workaround used during session to unblock Chandresh: reset assignment 80 from `tinting_in_progress` to `skipped`.
- **Recommendation for Phase 2 kickoff:** push FIX-1 along with Phase 2 polish in one commit so prod gets the fix before another reassignment triggers the bug again.

### Pre-existing CORE §3 violations noted
- `app/api/tint/operator/split/done/route.ts` already uses `prisma.$transaction` (pre-existing, not introduced by us)
- `app/api/admin/shades/route.ts` uses `prisma.$transaction([findMany, count])` (pre-existing — Claude Code avoided copying this pattern in our new list endpoint)
- Both are landmines worth fixing in a future cleanup pass. Not blocking.

### `02-permissions.sql` missing `updatedAt` (patched in-session)
- Original SQL file would have failed on rerun because `role_permissions.updatedAt` is NOT NULL with no default. Patched mid-session — current file is safe to re-run.

---

## 4. Production database state at end of session

| Table | Row count | Notes |
|---|---|---|
| `sampling_register` | 3,566 | All `needsReview = false`, all `tinterType = TINTER`, `createdAt` spans 2022-2026 |
| `sampling_recipes` | 4,052 | 27 pigment columns each, isPrimary set, usage counters at 0 |
| `sampling_usage_log` | 10,619 | One row per IMPORT row in source Excel; operator NULL throughout (no operator column in source) |
| `role_permissions` (sampling_library rows) | 4 | admin / tint_manager / ops_admin / tint_operator |

## 5. Files NOT YET COMMITTED to git

All sit on `C:\Users\HP\OneDrive\VS Code\orbit-oms` uncommitted. Listing for awareness:

```
prisma/schema.prisma                                        EDITED
lib/permissions.ts                                          EDITED
components/shared/role-sidebar.tsx                          EDITED

app/(tint)/tint/sampling-library/page.tsx                   NEW
app/(tint)/tint/sampling-library/layout.tsx                 NEW

app/api/sampling-library/route.ts                           NEW
app/api/sampling-library/[samplingNo]/route.ts              NEW
app/api/sampling-library/[samplingNo]/variants/route.ts     NEW
app/api/sampling-library/[samplingNo]/review/route.ts       NEW
app/api/sampling-library/[samplingNo]/usage-log/route.ts    NEW
app/api/sampling-library/_lib/validate.ts                   NEW
app/api/sampling-library/_lib/detail.ts                     NEW

components/sampling-library/sampling-library-content.tsx           NEW
components/sampling-library/sampling-library-list-pane.tsx         NEW
components/sampling-library/sampling-library-detail-pane.tsx       NEW

app/api/tint/operator/start/route.ts                        EDITED (FIX-1)
app/api/tint/operator/split/start/route.ts                  EDITED (FIX-1)
app/api/tint/operator/pause/route.ts                        EDITED (FIX-1)
app/api/tint/operator/resume/route.ts                       EDITED (FIX-1)
app/api/tint/operator/split/done/route.ts                   EDITED (FIX-1)

scripts/lib/sampling-classifier.ts                          NEW
scripts/classify-sampling-excel.ts                          EDITED
scripts/generate-final-review-xlsx.ts                       NEW
scripts/import-sampling-library.ts                          NEW
scripts/list-missing-skus.ts                                NEW
scripts/repair-sampling-import.ts                           NEW

docs/plans/sampling-register/01-schema.sql                  NEW (already executed in Supabase)
docs/plans/sampling-register/02-permissions.sql             NEW (already executed in Supabase)
docs/plans/sampling-register/03-repair-schema.sql           NEW (already executed in Supabase)
docs/plans/sampling-register/Tinting_data_Tracker_N_REVIEWED.xlsx       NEW (artifact)
docs/plans/sampling-register/Tinting_data_Tracker_N_FINAL_REVIEW.xlsx   NEW (artifact)
docs/plans/sampling-register/stock 21.05.2026.xlsx                       NEW (data source)
docs/plans/sampling-register/sku-master.xlsx                             NEW (data source)
docs/plans/sampling-register/missing-skus.txt                            NEW (diagnostic output)
docs/plans/Tinting data Tracker_N.xlsx                                   NEW (data source)
```

## 6. Phase 2 kickoff plan

Next session should start with this exact ordering:

1. **Re-read all canonical files + this handoff doc** (no reset, just continuation)
2. **Decide variant grouping rule** (Issue A) — settle the open question
3. **Draft prompts for issues A through H in sequence** — Claude Code prompts as usual, one at a time, dry-run/preview where applicable
4. **Final polish review** — open both `localhost:3000/tint/sampling-library` and the LOCKED mockup side-by-side, walk through every section
5. **Commit + push** — all of Phase 1 + Phase 2 + FIX-1 in logical commits to main (one push)
6. **Vercel verification** — refresh `orbitoms.in/tint/sampling-library` after deploy, sanity check
7. **User training note** — short message for Chandresh / Deepak about the new screen, especially the Needs Review queue (currently 0, but will populate as REVIEW-bucket data gets imported later)

## 7. Engineering rules respected (CORE §3 audit)

- ✅ No `prisma.$transaction` introduced
- ✅ No `prisma db push`
- ✅ All API routes have `export const dynamic = 'force-dynamic'`
- ✅ `tsc --noEmit` clean at every checkpoint
- ✅ DB columns camelCase, no `@map`
- ✅ Schema changes via Supabase SQL Editor (3 SQL files run), Prisma client regenerated by hand
- ✅ PowerShell 5.1 quirks respected: `;` not `&&`, paths quoted, `BitConverter` not `ToHexString`
- ✅ Sequential awaits everywhere, no transactions

## 8. Known data quality observations (not bugs)

- ~329 SKUs from the sampling Excel were not in either SKU master (stock or legacy). Recovered IMPORT count went from 1,450 → 3,566 after SAP stock master added. Remaining ~700 sampling nos sit in REVIEW bucket — to be triaged later via UI.
- Site matching is exact-only (no fuzzy matching by design). Common unmatched sites include typos like "RAGHUVEER SCRALETT" (real spelling: SCARLETT) and generics like "SAMPLE" (111 rows — these are sample-test entries, not real sites).
- Operator column does not exist in source Excel. All 10,619 usage_log rows have `operatorId = NULL`. UI shows "—" placeholder.
- `BORN AT 21 May 2026` issue was fully resolved by the repair script — dates now range 2022-05-02 to 2026-05-15 historically.
