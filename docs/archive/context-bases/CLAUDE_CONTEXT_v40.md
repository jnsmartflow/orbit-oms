# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v40.md fully before doing anything else."
# Version: Phase 1 Go-Live · Schema v21 · Context v40 · April 2026

---

## 1-41. [Unchanged from v38]

(All sections 1 through 41 remain unchanged — refer to v38 for full content)

---

## 42. Known Issues / Pending Fixes (UPDATED v40)

1. **Warehouse header stats mismatch** — header shows different count than unassigned panel in history view
2. **Cleanup Prisma field mapping** — pick_assignments.clearedAt had @map("cleared_at") mismatch, fixed by removing @map. Verify cleanup runs correctly on next day boundary.
3. ~~**Slot cascade (NOT YET BUILT)**~~ — **DONE v33.**
4. **Duplicate pick columns** — orders and order_splits both have camelCase (isPicked, pickedAt, pickedById) AND snake_case (is_picked, picked_at, picked_by_id) columns. Use camelCase ones via Prisma.
5. ~~**Tint manager filter crash**~~ — **FIXED v36.** All array assignments in tint-manager-content.tsx and tint-operator-content.tsx have ?? [] fallbacks.
6. **Slot cascade changedById** — uses hardcoded userId=1 (admin) for system-generated audit logs.
7. ~~**Import not working**~~ — **FIXED v34.**
8. **Slot cascade cascades pending_support orders** — cascade moves ALL orders including those not yet submitted by Support. Consider adding workflowStage filter to cascade eligibility.
9. **Support board default slot on refresh** — intermittent issue, deprioritised.
10. ~~**TM slot filter broken**~~ — **FIXED v39.** Was using hardcoded times on legacy dispatchSlot text field. Replaced with real slotId from slot_master.
11. ~~**TM dispatch filter misleading**~~ — **FIXED v39.** Removed entirely — most pre-completion orders have null dispatchStatus.
12. **Shade Master isActive filter** — UI sends `isActive=true/false` param but `/api/admin/shades` may not handle it yet. Verify and add if missing.

---

## 43. Queued Features (UPDATED v40)

- ~~**Slot cascade**~~ — **DONE v33**
- ~~**Import debugging**~~ — **DONE v34**
- ~~**OBD date parsing fix**~~ — **DONE v34**
- ~~**Support history view**~~ — **DONE v35**
- ~~**Order detail panel**~~ — **DONE v35** (Support only → now also TM v39)
- ~~**Role-based navigation + redirects**~~ — **DONE v36**
- ~~**Operations role + unified ops view**~~ — **DONE v36**
- ~~**TM filter fix + slot awareness**~~ — **DONE v39**
- ~~**TM neutral palette redesign**~~ — **DONE v39**
- ~~**TM order detail panel integration**~~ — **DONE v39**
- ~~**Shade Master neutral redesign**~~ — **DONE v40**
- ~~**TI Report neutral redesign**~~ — **DONE v40**
- **Cascade badge** — When `originalSlotId !== slotId`, show `⏩ from {originalSlot.name}` badge on order rows. Data already in API response (v39). Purely UI work — detail panel only for TM.
- **Apply neutral theme to all screens** — Support, Planning, Warehouse, Tint Operator need same neutral palette as TM v39. Use CLAUDE_UI.md as style guide.
- **soNumber import mapping** — column exists in DB + Prisma, need to map from SAP XLS column
- **Order detail panel** — wire into Planning board (customer pill click) and Warehouse board (pick card click)
- **Audit history in detail panel** — order_status_logs exists, not yet fetched/rendered
- **CustomerMissingSheet styling** — not matching admin customer form
- **Smart slot assignment** — orders arriving at/after slot cutoff auto-escalate
- **Visual "carried over" indicator for overdue orders in slot tabs**
- **MIS Override Layer** — Admin-only field-level overrides per OBD
- **Barcode/QR label generation** — post-TI submission
- **Customer data enrichment** — remaining area batches
- **Operations password change** — operations@orbitoms.com temp password 'operations123' must be changed in prod

---

## 52. Tint Manager Redesign (NEW v39 — April 2, 2026)

(unchanged — refer to v39)

---

## 53. Shade Master Redesign (NEW v40 — April 2, 2026)

### Overview
Full neutral theme redesign of the Shade Master screen. Previously used old indigo/slate palette with shadcn Badge and Switch. Now matches TM v39 / Support board aesthetic.

### Layout
**2-row header — full page board (no outer page wrapper)**

```
Row 1 (42px sticky):
  Left:  Shade Master · N shades · N active · N inactive
  Right: [Search] | [All · TINTER · ACOTONE toggle] | [Pack ▾]

Row 2 (36px sticky top-[42px]):
  Left:  [All] [Active] [Inactive] status filter pills

Table immediately below with px-4 py-3 spacing, rounded-lg border-gray-200 wrapper.
Pagination in 40px footer strip.
```

**page.tsx** — bare `<ShadeMasterContent />`, no wrapper div, no title/subtitle.
Both routes updated:
- `app/(tint)/tint/manager/shades/page.tsx`
- `app/(tint)/tint/shades/page.tsx`

### Column Sequence
```
# · Shade Name · Customer ID · Type · SKU Code · Pack · Status · Active · Added By · Added At
```

**Reasoning:** Type → SKU Code → Pack is a natural drill-down (machine → product → size).

### Key Design Decisions
- **Type column:** 5px dot (blue=TINTER, orange=ACOTONE) + muted label (`text-gray-400`)
- **Status badge:** inline `span` — Active = `bg-green-50 border-green-200 text-green-700`, Inactive = `bg-gray-50 border-gray-200 text-gray-500`
- **Active toggle:** Custom `IosToggle` component (36×20px) — green when on, gray when off. Replaces shadcn Switch.
- **Added At:** date primary (`text-gray-900 font-medium`), time secondary (`text-gray-400`), stacked two lines
- **Search:** debounced, fires on change (no Enter needed)
- **isActive filter:** passes `isActive=true/false` to API — verify `/api/admin/shades` supports this param

### Files Modified
- `components/tint/shade-master-content.tsx` — full redesign
- `app/(tint)/tint/manager/shades/page.tsx` — stripped to bare component
- `app/(tint)/tint/shades/page.tsx` — stripped to bare component

---

## 54. TI Report Redesign (NEW v40 — April 2, 2026)

### Overview
Full neutral theme redesign of the TI Report (Tinter Issue MIS report). Removed old indigo palette, filter card, and Summary tab. Added DateRangePicker with presets + calendar. Simplified to single transaction view with inline shade expand.

### Mental Model
TI Report is a **MIS reporting screen** — read-only, no submission workflow. Primary use: TM filters by date/operator, verifies entries, downloads Excel for management. Flow: filter → verify on screen → download.

### Layout
**2-row header — full page**

```
Row 1 (42px sticky):
  Left:  TI Report · N entries · N.N tins · TINTER N · ACOTONE N
  Right: [↓ Download Excel · 02 Apr] (shows active range in button)

Row 2 (40px sticky top-[42px]):
  Left:  [DateRangePicker ▾]  [Search OBD…]
  Right: [Filter ▾]

Table immediately below with px-4 py-3 spacing, rounded-lg border-gray-200 wrapper.
```

**page.tsx** — bare `<TIReportContent />` for both routes:
- `app/(tint)/ti-report/page.tsx`
- `app/(tint)/tint/manager/ti-report/page.tsx`

### Summary Tab
**Removed entirely.** Single transaction view only. Summary data available in header stats (totalEntries, totalTins, byType).

### Column Sequence (9 columns)
```
chevron · Date · OBD No. · Dealer · Site · Base · Pack · Tins · Operator · Time
```
- Chevron (expand toggle) — no header
- Base and Pack are **separate columns** (not merged)
- Tins: no `.toFixed(2)` — show clean number (`2` not `2.00`)
- Operator · Time: avatar + name + time in one cell

### Inline Shade Expand
Click any row → `ShadeExpandRow` appears immediately below showing full shade grid.
- Uses `<React.Fragment key={key}>` (not bare `<>`) for correct DOM position
- TINTER label: `text-blue-600`, ACOTONE label: `text-orange-500`
- Non-zero values: `text-gray-900 font-semibold`
- Zero values: `text-gray-200`

### DateRangePicker Component
Inline component in `ti-report-content.tsx`. See CLAUDE_UI.md §15 for full spec.
- Presets: Today / Yesterday / This Week / This Month
- Calendar: month nav, day grid, range highlight, future dates disabled
- Two-click range selection: click from → click to → closes
- Active range shown in trigger button label

### Filter Dropdown
Contains: Operator list + Type (All/TINTER/ACOTONE). Active count badge. Clear all link.

### Download Button
Shows active date range inline: `Download Excel · 02 Apr` or `Download Excel · 25 Mar – 02 Apr`.
Downloads full column set (all shade columns + KG calculations) regardless of screen view.
Disabled when no rows or loading.

### Tinter Type Dots
5px dot before OBD number: TINTER = `bg-blue-600`, ACOTONE = `bg-orange-500`.

### Files Modified
- `components/tint/ti-report-content.tsx` — full redesign
- `app/(tint)/ti-report/page.tsx` — stripped to bare component
- `app/(tint)/tint/manager/ti-report/page.tsx` — stripped to bare component

---

## 55. Session Start Checklist (UPDATED v40)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v21**
3. **TM redesign (v39):** Neutral palette, 2-row header, slot strip, filter dropdown, 10-column table, order detail panel
4. **CLAUDE_UI.md v3:** Load alongside this file for ALL UI work — defines neutral theme, IosToggle, DateRangePicker
5. **Planning is ORDER level** (v28 correction still applies)
6. **Tint Manager uses OrderDetailPanel** not SkuDetailsSheet (v39)
7. **Delivery type dot colors:** blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross)
8. **Filter state:** slotFilter is `"all" | number`, delTypeFilter is `Set<string>`, dispatchFilter removed
9. **Shade Master:** 2-row header, IosToggle, column sequence `# · Name · CustID · Type · SKU · Pack · Status · Active · By · At`
10. **TI Report:** DateRangePicker, no Summary tab, inline shade expand, Base and Pack separate columns
11. **page.tsx pattern:** All board pages are bare `<ComponentName />` — no wrapper div, no title
12. All existing checklist items from v38 #36 still apply

---

*Version: Phase 1 Go-Live · Schema v21 · Context v40 · April 2026*
