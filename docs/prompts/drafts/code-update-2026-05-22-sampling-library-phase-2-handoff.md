# Sampling Library — Phase 2 Handoff

**Session date:** 2026-05-22 (continuation of Phase 1 session)
**Status:** Phase 2 polish complete (steps 1–6.5 of revised checklist).
**Commit status:** ⚠️ NOTHING PUSHED. All Phase 1 + Phase 2 + FIX-1 work still sits on the depot PC uncommitted. By explicit decision, the final commit is deferred to end of Phase 3.
**Next session:** Sampling Library Phase 3 — Data Normalisation + Delivery No + Final Push.

---

## 1. What got built in Phase 2

### Step 1 — Variant tab collapse (Issue A)
- Tabs in detail pane now collapse by unique `packCode` instead of one tab per recipe row
- Implementation: client-side `useMemo` in `sampling-library-detail-pane.tsx` builds `PackGroup[]` from the flat variants array
- Canonical recipe picker per group: `isPrimary` desc → `usageCount` desc → `id` asc
- PRIMARY pill lives on whichever tab contains the primary recipe row
- Tab counter = sum of `usageCount` across rows in the pack group
- SKUS USED table at the bottom still iterates the flat array (unchanged)
- Console.warn fires for degenerate data (multiple `isPrimary=true` rows in same pack group)

### Step 2 — Detail API: 6 new aggregate fields
In `app/api/sampling-library/_lib/detail.ts`:
- `dealersTotal: number` — distinct count from sampling_usage_log
- `sitesTotal: number` — distinct count
- `primaryDealer: string | null` — earliest by first usageDate (changed from "most-used" in step 6)
- `primarySite: string | null` — same earliest rule
- `primarySiteMissing: boolean` — true when primarySite is not matched in `delivery_point_master.customerName` (case-insensitive trimmed)
- `allDealers: string[]` — ordered by usage count desc
- `allSites: string[]` — ordered by usage count desc
- `usageSummary: UsageSummaryRow[]` — per (site, dealer) pair with SO via `delivery_point_master.salesOfficerGroup → salesOfficerMaster` cascade

All sequential awaits, no transactions, follows CORE §3.

### Step 3 — Label renames (Issues B + F)
- `RECIPE HISTORY` section heading → `SKUS USED`
- `BORN AT` meta label → `CREATED ON`
- `Activity History` section heading → `TINTING HISTORY`

### Step 4 — Header restructure (Issue H)
- Header was: single flex row, left block (#samplingNo + TINTER) + right block (shade name + ACTIVE + counters + nested CREATED ON meta + actions)
- Header is now: same flex row but CREATED ON meta strip pulled OUT of the right block and dropped as a sibling div below, full-width, with `border-top` divider
- Void space under `#samplingNo` is filled by the full-width meta strip
- Counters (X uses · Y packs · Z sites · W dealers) sit on line 2 of the right block, using `sitesTotal` + `dealersTotal` from the new API fields

### Step 5 — USED AT summary table (new section)
- Above TINTING HISTORY
- Columns: Site · Dealer · SO · First · Last · Uses
- Widths: 28 / 24 / 18 / 10 / 10 / 10
- Smart Title Case via inline helper
- SO chip pattern: 18px circle initials avatar + name, em-dash when null
- Empty state: "No site usage recorded yet" centred italic gray-400 11px
- "Export →" placeholder link in section header, gray (not teal)

### Step 6 — TINTING HISTORY rebuilt as flat table (Issue C)
- Was a date-left / details-right timeline
- Now a fixed table per CLAUDE_UI §40
- Columns: Date · Dealer · Site · SKU · Qty · Operator
- Widths: 12 / 22 / 22 / 16 / 10 / 18
- Operator fallback chain: `users.name (joined) ?? operatorNameRaw ?? "Harsh"` — all legacy rows render "Harsh" since pre-system Chandresh's data has no operator column
- Initials avatar on operator (gray, not teal)
- Pagination "Load more (N) →" footer preserved, 25 per fetch from `/usage-log`
- Date format: "DD MMM YY"

### Step 6 cont — Cleanup edits
- USED AT: removed the second-line `SAP: {customerCode}` under site names (inconsistent across typo variants — would mislead the user about which sites are "matched")
- TINTING HISTORY: dropped `tin / tins` suffix from QTY column, just shows the number
- Meta strip: dealer chip BEFORE site chip (Issue D)
- Meta strip: dealer + site now resolve to FIRST-EVER pair (earliest `usageDate`), not most-used — matches CREATED ON date
- Removed SKUS USED row highlight (canonical row of the active tab is no longer visually distinguished — eliminates "linked to tab" confusion)

### Step 6.5 — MISSING badge restored
- When `primarySiteMissing === true`, amber `MISSING` badge renders next to the site name in the meta strip
- Useful data quality signal for the TM
- Uses existing amber `bg-amber-50 text-amber-700 border border-amber-200` (semantic warning stays — not part of teal overhaul)

### Step 6 cont — Colour palette overhaul (Issue G)
- Cousin colour budget restored (CLAUDE_UI §2 ONE teal max + sanctioned carve-outs)
- Two teal elements survive: list-pane selection (`bg-teal-50 border-l-teal-700`) and PRIMARY pill on variant tab
- Everything else now gray:
  - `#samplingNo` big number → gray-900
  - ACTIVE pill → gray-100 / gray-700
  - Variant tab active text + underline → gray-900
  - Variant tab inactive text → gray-500
  - Pigment card labels (YOX, TBL, etc.) → gray-500
  - Pigment card borders → gray-200
  - PACK pills in SKUS USED → gray-100 / gray-700
  - Creator avatar in CREATED ON → gray-100 / gray-700
  - SO avatar in USED AT → gray-100 / gray-700
  - Operator avatar in TINTING HISTORY → gray
  - Export → links → gray-700, no font-medium
  - TINTER label in list rows → gray-400
  - SO initials avatar in list pane → gray
- NEEDS REVIEW pill stays amber (semantic warning, carve-out per spec)

---

## 2. What's pending (open issues for Phase 3)

### Issue I — Data normalisation pass (NEW)
**What:** Legacy Excel data contains case-variant SKUs (`IN28109471` vs `in28109471`), typo-variant dealer names, typo-variant site names (`Gph-piplod` vs `Gph Piplod`, `Antilia` vs `Antilla`). These should be normalised so the same physical entity collapses to one row in USED AT, SKUS USED, and TINTING HISTORY.
**Source of truth:**
- SKUs → `sku_master.materialCode` (canonical casing)
- Dealer / Site → `delivery_point_master.customerName` (canonical spelling)
**Action:** Claude Code audits `sampling_recipes`, `sampling_usage_log`, then proposes a normalisation map (dry-run report). Smart Flow reviews. Then commit mode runs `UPDATE` statements.

### Issue J — Delivery no on TINTING HISTORY (NEW)
**What:** Each tinting event has a Delivery No (OBD-style identifier). Legacy data: backfill from the source Excel by row-index alignment, where present. Forward data: populate from `assignment.deliveryNumber` (or equivalent) when the TI flow lands real data.
**Schema change:** add `deliveryNumber TEXT NULLABLE` to `sampling_usage_log` via Supabase SQL Editor.
**Repair script:** re-read the source Excel, build a `(samplingNo, row_index) → deliveryNumber` map, run sequential UPDATE on `sampling_usage_log`.
**UI:** add `DELIVERY NO` line under the existing row in TINTING HISTORY (sub-line under DATE column, mono font, gray-400, 10px — only renders when present). Or as a separate column — to be decided in Phase 3 design pass.

### Issue K — Action button handlers (DEFERRED FROM PHASE 1)
The 3 icons top-right of the header (edit / deactivate / mark for review) still console.log only. Not blocking. Wire when the related modals are designed.

### Issue L — Sales Officer column shows blank everywhere (BLOCKED ON DATA)
The SO column in USED AT is wired correctly via the `delivery_point_master.salesOfficerGroup → salesOfficer` cascade, but blank for all rows because legacy `sampling_usage_log` rows have `siteId = null`. Once Issue I (site normalisation) is done and `siteId` is backfilled for matched sites, SO populates automatically. No code change needed — just data.

### Issue M — `+N` multi-dealer/site pill (DEFERRED, by design)
The meta strip shows only first-ever dealer + site. Multi-entity disclosure happens via the header counters (X sites · Y dealers) + the USED AT table below. No `+N` pill. Decision is final.

### Issue N — Active sampling search by site/dealer/SO (NICE-TO-HAVE)
The header search currently searches by sampling number + shade name. Adding "dealer", "site", or "SO" as searchable fields would help operators jump to a sampling by who used it. Not blocking. Deferred.

---

## 3. Other items not addressed in this session

### FIX-1 — Tint Operator "Submit TI before starting" bug
**Status unchanged from Phase 1 handoff.** Files on depot PC are edited and `tsc --noEmit` clean. Still uncommitted. Will go in the final Phase 3 push.

### Pre-existing CORE §3 violations
**Status unchanged.** `app/api/tint/operator/split/done/route.ts` and `app/api/admin/shades/route.ts` still use `prisma.$transaction`. Not introduced by us. Future cleanup pass.

---

## 4. Production database state (no change since Phase 1)

Schema is v26.6 — no schema changes in Phase 2 (all changes were UI + API logic). Row counts unchanged:
- `sampling_register` 3,566 parents
- `sampling_recipes` 4,052 variants
- `sampling_usage_log` 10,619 usage rows
- `role_permissions` (sampling_library) 4 rows

Phase 3 will bump to v26.7 once `sampling_usage_log.deliveryNumber` is added.

---

## 5. Files NOT YET COMMITTED to git (Phase 1 + Phase 2 + FIX-1)

The set is unchanged from Phase 1 handoff §5. No new files added in Phase 2 — only edits to existing Phase 1 files:

```
EDITED IN PHASE 2:
prisma/schema.prisma                                       (unchanged in Phase 2, already edited)
app/api/sampling-library/_lib/detail.ts                    (6 new fields + usageSummary aggregation + earliest-pair rule + primarySiteMissing)
components/sampling-library/sampling-library-detail-pane.tsx (header restructure, USED AT, TINTING HISTORY, meta strip, colour overhaul, MISSING badge, cleanup edits)
components/sampling-library/sampling-library-list-pane.tsx (colour audit — TINTER label + SO avatar swap)

EDITED IN PHASE 1 (unchanged in Phase 2):
lib/permissions.ts                                          (sampling_library page key)
components/shared/role-sidebar.tsx                          (FlaskConical icon)

NEW IN PHASE 1 (unchanged in Phase 2):
app/(tint)/tint/sampling-library/page.tsx
app/(tint)/tint/sampling-library/layout.tsx
app/api/sampling-library/route.ts
app/api/sampling-library/[samplingNo]/route.ts
app/api/sampling-library/[samplingNo]/variants/route.ts
app/api/sampling-library/[samplingNo]/review/route.ts
app/api/sampling-library/[samplingNo]/usage-log/route.ts
app/api/sampling-library/_lib/validate.ts
components/sampling-library/sampling-library-content.tsx

FIX-1 (unchanged since Phase 1):
app/api/tint/operator/start/route.ts
app/api/tint/operator/split/start/route.ts
app/api/tint/operator/pause/route.ts
app/api/tint/operator/resume/route.ts
app/api/tint/operator/split/done/route.ts

SCRIPTS (Phase 1, unchanged):
scripts/lib/sampling-classifier.ts
scripts/classify-sampling-excel.ts
scripts/generate-final-review-xlsx.ts
scripts/import-sampling-library.ts
scripts/list-missing-skus.ts
scripts/repair-sampling-import.ts

DOCS (Phase 1, unchanged):
docs/plans/sampling-register/01-schema.sql
docs/plans/sampling-register/02-permissions.sql
docs/plans/sampling-register/03-repair-schema.sql
```

---

## 6. Phase 3 kickoff plan

Next session in this exact order:

1. **Read all canonical files + this handoff + Phase 1 handoff + Phase 2 design spec** (continuation, no reset)
2. **Step 1 — Schema bump** for `sampling_usage_log.deliveryNumber` via Supabase SQL Editor (Phase 3 SQL file `04-delivery-no.sql`)
3. **Step 2 — Repair script** to backfill `deliveryNumber` from source Excel by row-index alignment
4. **Step 3 — Normalisation audit** (Issue I) — dry-run script reports SKU + dealer + site collisions, surfaces conflicting variants
5. **Step 4 — Smart Flow review** of the normalisation report — approve or hand-edit before commit mode runs
6. **Step 5 — Normalisation commit run** — sequential UPDATEs on `sampling_recipes` + `sampling_usage_log`
7. **Step 6 — UI updates** — add DELIVERY NO surface in TINTING HISTORY (column or sub-line, to be designed)
8. **Step 7 — Final smoke test** — open `localhost:3000/tint/sampling-library` and verify deduped rows in USED AT, SKUS USED, TINTING HISTORY across multiple shades (#134481 with case-variant SKUs, #133999 with typo-variant sites)
9. **Step 8 — Commit and push** — Phase 2 + Phase 3 + FIX-1 all in one logical push to `main`
10. **Step 9 — Vercel verification** — load `orbitoms.in/tint/sampling-library` and sanity-check
11. **Step 10 — Training note** — short message for Chandresh / Deepak about the production rollout

---

## 7. Decisions locked in Phase 2 (reference)

- Variant tab grouping: by pack only (one tab per unique pack code)
- Section rename: SKUS USED, CREATED ON, TINTING HISTORY
- Header: Option 1 — big `#samplingNo` left, shade name + counters right, action icons far right, meta strip full-width below
- Meta strip: minimal — CREATED ON · date · creator · dealer · site (in that order). No `+N` pill. Multi-entity disclosure via header counters + USED AT table.
- Primary dealer + primary site rule: FIRST-EVER pair (earliest usageDate), not most-used
- USED AT section above TINTING HISTORY, columns Site · Dealer · SO · First · Last · Uses
- USED AT: no SAP code under site name (defer until normalisation done)
- TINTING HISTORY: no tin/tins suffix
- Colour budget: cousin rules restored, teal only on list selection + PRIMARY pill
- Amber MISSING badge: stays as semantic warning carve-out
- Operator legacy fallback: hard-coded "Harsh" (no DB backfill)

---

## 8. Engineering rules audit (Phase 2)

- ✅ No `prisma.$transaction` introduced
- ✅ No `prisma db push`
- ✅ No schema changes (deferred to Phase 3)
- ✅ All API routes have `export const dynamic = 'force-dynamic'`
- ✅ `tsc --noEmit` clean at every checkpoint (verified after each of the 6 prompts)
- ✅ DB columns camelCase, no `@map`
- ✅ Sequential awaits everywhere, no transactions
- ✅ Cousin colour budget restored
- ✅ Fixed table standard (CLAUDE_UI §40) applied to USED AT and TINTING HISTORY

---

*Phase 2 handoff · Sampling Library · 2026-05-22*
