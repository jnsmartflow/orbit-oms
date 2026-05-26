# Sampling Library — Phase 2 Design Spec

**Session date:** 2026-05-22
**Status:** Locked. Source of truth for Phase 2 Claude Code prompts.
**Supersedes:** `docs/mockups/sampling-library/sampling-library-LOCKED.html` for all decisions below. The LOCKED mockup remains the structural blueprint but is **explicitly overridden on colour and rhythm** per Phase 1 final review.

This doc captures 8 locked decisions (Issues A–H) plus one bug fix (FIX-1) to be pushed together.

---

## Visual reference

Cousin pages (Tint Manager, Shade Master) are the visual reference for colour and typography. The mockup is **not** the colour reference any more.

---

## Issue A — Variant tabs collapsed by pack only

**Problem:** Shade #134481 currently shows 5 variant tabs (`20 LT · 4 LT · 20 LT · 4 LT · 4 LT`) because we have 5 `sampling_recipes` rows for 5 different SKUs of the same shade. Tabs duplicate visually.

**Rule:** Collapse variant tabs to **one tab per unique pack code**. Multiple SKUs sharing the same pack roll up into a single tab.

**Implementation:**
- Group `sampling_recipes` rows for a sampling by `packCode`
- One tab per unique packCode
- Within a group, pick **one** "canonical" recipe to display in the pigment cards. Rule: the row where `isPrimary = true` if present, else the row with the highest `usageCount`, else the lowest `id` (deterministic tiebreaker)
- The "PRIMARY" pill stays on whichever tab contains the primary recipe row
- "X uses" counter on tab = sum of `usageCount` across all rows in that pack group
- The actual variant rows (with SKU codes) still appear in the "SKUS USED" table below — that's where SKU-level detail lives

**Edge case:** if two rows in the same pack group have different pigment values, prefer `isPrimary`. Surface a small warning in the detail pane footer: "Note: N SKUs in this pack have slightly different recipes — see table below." (Defer the warning UI; just preserve the data.)

---

## Issue B — Rename "RECIPE HISTORY" → "SKUS USED"

**Problem:** Section labelled "RECIPE HISTORY" actually shows the SKU variants for this shade, not historical recipe revisions.

**Rule:** Rename section title to **`SKUS USED`** (all caps, same typography as other section headers).

**Implementation:** Single label change in `sampling-library-detail-pane.tsx`. The section's counter pill (`5 entries`) stays — just changes meaning from "5 historical entries" to "5 SKU variants".

---

## Issue C — Activity history: timeline → table

**Problem:** Current activity history is a date-left / details-right timeline. User wants a flat table. Also the current line "Used at J K INFRA · GPH PALSANA POLICE" wrongly equates dealer and site.

**Rule:** Replace timeline with a proper table. Section heading renamed to **`TINTING HISTORY`**.

**Columns (in order):**

| Column | Source | Notes |
|---|---|---|
| Date | `sampling_usage_log.usageDate` | Format: `DD MMM YY` (`14 May 26`) |
| Dealer | `sampling_usage_log.dealerNameRaw` | Smart Title Case via `smartTitleCase()` |
| Site | `sampling_usage_log.siteNameRaw` (joined to delivery_point_master if siteId not null) | Smart Title Case |
| Pack | `sampling_usage_log.packCode` | Pack pill style — see colour rules below |
| Qty | `sampling_usage_log.tinQty` | Right-aligned, format `N tins` or `N tin` |
| SKU | `sampling_usage_log.skuCodeRaw` | Mono font, gray-600 |
| Operator | `users.name` via `operatorId`, else `operatorNameRaw`, else em-dash | Currently always em-dash for historical data |

**Table standard:** `CLAUDE_UI.md §40` — `table-layout: fixed`, header `bg-gray-50` border `#ebebeb`, row borders `#f0f0f0`, hover `#fafafa`, 10px/14px cell padding.

**Pagination:** Keep existing "Load more (N)" pattern from `/api/sampling-library/:samplingNo/usage-log`. 25 per fetch.

**Empty state:** "No tinting history yet" centred, italic, gray-400, 11px.

---

## Issue D — Meta strip: dealer BEFORE site

**Problem:** Meta strip currently shows pin (site) then building (dealer). User wants dealer first.

**Rule:** Order is `CREATED ON · creator · dealer · site`. Dealer icon = `ti-building-store` or `Building2` from lucide. Site icon = `ti-map-pin` or `MapPin` from lucide.

---

## Issue E — Multi-dealer / multi-site meta strip

**Problem:** Real data has many-to-many dealer↔site combinations per shade. Current UI shows only one of each.

**Rule:**
- Compute distinct `(dealerName, siteName)` pairs from `sampling_usage_log` for this sampling
- Pick the **most-used** pair as the "primary" display (rank by `COUNT(*)` over (dealer, site) tuples, descending; tiebreak by most-recent usageDate)
- Display the primary dealer name + primary site name in the meta strip
- If there are more distinct dealers than the displayed one, append a `+N` pill next to the dealer chip
- Same for sites: if more distinct sites exist than the displayed one, append a `+N` pill next to the site chip
- Click on a `+N` pill opens a small popover listing all distinct values

**API change:** `GET /api/sampling-library/:samplingNo` detail response gains:
```
dealersTotal: number       // distinct count
sitesTotal: number         // distinct count
primaryDealer: string|null // most-used dealer name (smartTitleCase applied client-side)
primarySite: string|null   // most-used site name
allDealers: string[]       // for the +N popover
allSites: string[]         // for the +N popover
```

These come from `SELECT DISTINCT` aggregations over `sampling_usage_log`. Sequential queries, no transactions.

---

## Issue F — Rename "BORN AT" → "CREATED ON"

**Rule:** Single label change. Same typography (10px, gray tertiary, uppercase, 0.5px letter-spacing).

---

## Issue G — Colour palette overhaul

**Problem:** Phase 1 used the LOCKED mockup's heavy teal as a screen-level exemption to the `CLAUDE_UI.md §2` "ONE teal element max" rule. User wants to roll that back.

**Rule:** Sampling Library returns to the **standard cousin colour budget**, same as Tint Manager and Shade Master. Teal usage is **strictly limited to**:

1. Sidebar accent (already in shared layout — unchanged)
2. **List pane selection state** — `bg-teal-50 + border-l-[3px] border-l-teal-700` on the selected row only
3. **PRIMARY pill** on the variant tab — `bg-teal-100 text-teal-700` (small badge inside the active primary variant tab)

Everything else loses teal:

| Element | Before (Phase 1) | After (Phase 2) |
|---|---|---|
| Big `#samplingNo` mono number in detail header | teal-700 | `text-gray-900` |
| `ACTIVE` pill | `bg-teal-50 text-teal-700 border-teal-200` | `bg-gray-100 text-gray-700 border-gray-200` |
| Variant tab text (active) | `text-teal-700` | `text-gray-900 font-semibold + border-b-2 border-gray-900` |
| Variant tab text (inactive) | `text-gray-400` | `text-gray-500` |
| Pack pill chips (in SKUS USED table, TINTING HISTORY) | `bg-teal-50 text-teal-700` | `bg-gray-100 text-gray-700` |
| Pigment value cards | label teal-600 | label `text-gray-500` |
| Recipe-history (now SKUS USED) selected row | `bg-teal-50/50` highlight | **no highlight** — leave as default row |
| "Export →" link | `text-teal-700` | `text-gray-700 hover:text-gray-900 underline` |
| "All / Tinter / Acotone" segment in header | already neutral via UH | unchanged |
| "Needs Review: 0" pill | `bg-amber-50 text-amber-700` | unchanged (semantic amber stays) |
| Type label "TINTER" under `#samplingNo` | gray | unchanged |

**Result:** the detail pane reads neutral gray/black with two teal accents (list pane selection + PRIMARY pill). Matches cousin pages.

`CLAUDE_UI.md §2` "ONE teal element max" rule is RESTORED for this screen. The per-screen exemption noted in Phase 1 v1 handoff is REMOVED.

---

## Issue H — Header redesign (Option 1)

**Problem:** Phase 1 header had a big `#samplingNo` on the left, shade name + ACTIVE pill on the right, and void space below the number.

**Design:** Two-block layout, divided by a 0.5px vertical rule.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  #134481      │  SPL 21YY 08/489   [ACTIVE]              [edit][ban][!]  │
│  TINTER       │                                                          │
│               │  38 uses · 2 packs · 5 sites · 4 dealers                 │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────    │
│  CREATED ON 04 Mar 2025 · ⓗ Harsh · 🏪 Shivam Paints +3 · 📍 GPH Palsana Police +4 │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Block 1 (left, ~140px wide):**
- `#134481` — `font-mono text-[28px] font-semibold text-gray-900` (was teal, now gray-900)
- `TINTER` — `text-[10px] font-medium uppercase tracking-[0.5px] text-gray-400` (mt-1)

**Block 2 (right, flex-1):**
- Border-left `0.5px solid #e5e7eb`, padding-left `20px`, padding-top `4px`
- Line 1: shade name `text-[18px] font-semibold text-gray-900` + ACTIVE pill (gray-100 chip) + action icons pushed to the far right
- Line 2 (mt-2): counters as inline strip — `<N> uses · <N> packs · <N> sites · <N> dealers` — each count is `text-gray-900 font-semibold` followed by lowercase label `text-gray-600`. Separators are `·` in `text-gray-300`.

**Action icons (top-right of block 2):**
- 3 icon buttons: edit (pencil), deactivate (ban), mark for review (alert-triangle)
- Each: `w-7 h-7 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-700 flex items-center justify-center`
- Currently placeholders, no handlers (deferred from Phase 1)

**Below the two-block header (full width):**
- `border-top: 0.5px solid #e5e7eb`, padding-top `12px`
- Meta strip — see §D + §E

---

## Issue E meta strip layout (final)

Single row, flex with `gap: 20px` and `flex-wrap: wrap` for narrow viewports.

Order:
1. `CREATED ON` label (10px uppercase tracking-0.5 gray-400) + calendar icon + date in `text-[12px] text-gray-900`
2. Gray-300 `·` separator
3. Creator avatar (16px circle, initials in gray-100 bg gray-900 text) + creator name `text-[12px] text-gray-900`
4. Gray-300 `·` separator
5. `building-store` icon (gray-400) + dealer name `text-[12px] text-gray-900` + optional `+N` pill (`bg-gray-100 text-gray-500 text-[10px] font-medium rounded-full px-1.5 py-0.5`)
6. `map-pin` icon (gray-400) + site name `text-[12px] text-gray-900` + optional `+N` pill

The `+N` pill, when present, is clickable. Click opens a `<Popover>` (shadcn) listing all distinct dealers (or sites) in `sampling_usage_log` for this samplingNo. Sorted by usage count desc.

If no dealer or site data exists (no usage log rows yet), show em-dash:
- `🏪 —` `📍 —`

---

## Files affected (Phase 2)

| File | Reason |
|---|---|
| `components/sampling-library/sampling-library-detail-pane.tsx` | All section renames, header redesign, colour overhaul, meta strip rebuild, variant tab collapse logic, activity history → table |
| `components/sampling-library/sampling-library-list-pane.tsx` | Audit teal usage; selection state stays teal but check no other teal remains |
| `app/api/sampling-library/[samplingNo]/route.ts` | Add `dealersTotal`, `sitesTotal`, `primaryDealer`, `primarySite`, `allDealers`, `allSites` to detail response |
| `app/api/sampling-library/_lib/detail.ts` | Shared builder — add the new aggregate fields |
| `app/api/sampling-library/[samplingNo]/usage-log/route.ts` | Probably no change — already paginates. Verify response shape matches table columns |

No SQL changes. No Prisma schema changes. No new dependencies.

---

## FIX-1 — Tint Operator "Submit TI before starting" bug push

Already on the depot PC, uncommitted. Push together with Phase 2 in the same commit batch.

Files:
- `app/api/tint/operator/start/route.ts` — status filter added
- `app/api/tint/operator/split/start/route.ts` — same
- `app/api/tint/operator/pause/route.ts` — `findUnique` → `findFirst` with status filter
- `app/api/tint/operator/resume/route.ts` — same
- `app/api/tint/operator/split/done/route.ts` — status filter

`tsc --noEmit` confirmed clean on the depot PC. No further changes needed — just include in the final commit.

---

## Commit plan (end of session)

One logical commit sequence to `main`:

1. **Commit A — FIX-1** (`fix(tint-operator): filter assignments by active status in start/pause/resume/done routes`)
2. **Commit B — Sampling Library Phase 1 + Phase 2 polish** (`feat(sampling-library): production-ready library page with phase 2 polish`)
3. `git push origin main` — single push triggers one Vercel deploy

Vercel deploys to `bom1`. Smoke test on `https://orbitoms.in/tint/sampling-library` after deploy lands.

---

## Engineering rules audit (Phase 2)

- ✅ No `prisma.$transaction`
- ✅ No `prisma db push`
- ✅ All API routes `export const dynamic = 'force-dynamic'`
- ✅ `tsc --noEmit` required before each commit
- ✅ No new dependencies
- ✅ camelCase columns, no `@map`
- ✅ Sequential awaits only
- ✅ Smoke test on localhost before push

---

*Phase 2 design spec · Sampling Library · 2026-05-22*
