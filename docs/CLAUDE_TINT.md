# CLAUDE_TINT.md — Tint Module
# v1.0 · Schema v26.5 · April 2026
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Covers Tint Manager, Tint Operator, Delivery Challans, Shade Master, TI Report.

Users: Chandresh (tint_manager), Deepak Vasava + Chandrasing Valvi (tint_operator). Test operator id=5 deleted.

---

## 1. Tint Manager — /tint/manager

Primary user: Chandresh. LIVE (Phase 1 active).

**Key files:**
- `components/tint/tint-manager-content.tsx`
- `components/tint/tint-table-view.tsx`
- `app/api/tint/manager/orders/route.ts`
- `app/api/tint/manager/missing-customers/route.ts`
- `app/api/tint/manager/reorder/route.ts`
- `app/api/tint/manager/assign/route.ts`

### 1.1 Header (UniversalHeader, two-row)

**Row 1:** Title "Tint Manager" · stats · clock · shortcuts · search.

**Row 2:** Operator workload pills (leftExtra) · missing-customer badge (rightExtra) · View toggle · Filter dropdown.

**No slot segments, no date stepper.** Slots are dispatch windows, irrelevant to tinting. TM is always a live view.

### 1.2 Operator workload pills (replaces old slot segments)

- "Unassigned · N" pill (red-ish): count of orders in Pending column (no operator yet)
- One pill per operator from `/api/tint/manager/operators`: count = assigned + in-progress combined (orders + activeSplits)
- Tap pill to filter all 4 columns to that operator's work. Tap again to deselect.
- Operator filter moved OUT of Filter dropdown (lives in pills now).
- Workload dropdown removed (pills replace it).

### 1.3 Missing customer badge (rightExtra)

Amber pill showing "N missing" when count > 0. Covers both tint and non-tint orders for SMU = "Retail Offtake" / "Decorative Projects".

Popover lists orders with: OBD, type badge (Tint/Non-Tint), customer name, SMU. Click opens `CustomerMissingSheet`. Re-fetches on resolve. Badge disappears when all resolved.

Endpoint: `GET /api/tint/manager/missing-customers` → `{ count, orders[] }`. Excludes terminal workflow stages.

### 1.4 Delivery type filter (fix)

Values must match DB exact casing: `Local`, `Upcountry`, `IGT`, `Cross Depot`. Previously sent uppercase, caused zero matches.

### 1.5 Kanban 4 columns

Pending | Assigned | In Progress | Completed.

Column count pills: all neutral `bg-gray-100 text-gray-700 border-gray-200`. No semantic colours on column headers.

Empty state: compact "No orders" italic. No icon, no subtitle.

### 1.6 Card / row content

Every card shows:
- OBD (mono) · orderDateTime (via `formatOrderDateTime()` helper)
- Age badge (see UI §47) when 1+ days old
- Customer / Site name
- SMU
- Priority
- Articles, Volume
- Operator avatar (22×22px)
- Re-assign action (in Assigned rows)
- Dispatch status badge inline next to site name

Card sort: `sequenceOrder ASC → priorityLevel ASC → date ASC` (urgent floats up when sequence equal).

### 1.7 Table view

Converted from CSS Grid to `<table>` with `table-layout: fixed`. See UI §47.

- 9 columns: # / OBD / SMU / Site Name / Priority / Articles / Volume / Operator-Action / Time / Actions
- Widths: 4/13/10/18/7/9/6/15/10/8%
- First column `#`: 1-based serial counter per section
- "Customer" renamed to "Site Name"
- Slot column removed
- Dispatch status badge inline in CustomerCell (Dispatch/Hold/Waiting)
- Re-assign action added to Assigned section rows
- Roomy spacing: 10px vertical, 14px horizontal cell padding
- Data rows: ~44px with two-line OBD cell (OBD + date + age badge)
- Four stacked sections: Pending / Assigned / In Progress / Completed. `mb-4` between.

### 1.8 Sequence order — single source of truth

Operator screen reads `sequenceOrder` from `orders`/`order_splits` (NOT `operatorSequence` from `tint_assignments`). TM reorder changes immediately visible to operators on refresh.

**Per-operator reorder:** Move up/down only swaps within same operator's assigned orders. Cannot accidentally swap Deepak's order with Chandrasing's. API: `/api/tint/manager/reorder` — finds target order's operator, filters list to that operator, swaps.

**Assignment queue position:** New assignments get `sequenceOrder = MAX + 1` for that operator's existing queue (FIFO — new orders land at bottom).

### 1.9 Customer missing flow

- `customerMissing` boolean on `orders` table
- Badge in header Row 2 rightExtra (amber pill) for SMUs "Retail Offtake" / "Decorative Projects"
- Click opens `CustomerMissingSheet`
- Chose amber (warning, not error) — monitor Chandresh's usage before adding timed reminder
- Styling known to not match admin customer split-view form (cosmetic pending)

### 1.10 API

`GET /api/tint/manager/orders` returns slot/deliveryType data, slotSummary, orderDateTime on all order/split/assignment payloads.

---

## 2. Slot assignment for tint orders (see CORE §9)

- At import: `orderType === "tint"` → `slotId = null`, `originalSlotId = null`. Non-tint unchanged.
- At completion (whole order, `/api/tint/operator/done`): sets `slotId` + `originalSlotId` on order using `resolveSlot()` thresholds on current IST time.
- At split completion (`/api/tint/operator/split/done`): sets slot on **parent** order. Latest completion wins (each split updates the slot).
- No buffer before cutoff — completion at 10:25 → Morning slot.
- `applyMailOrderEnrichment()` skips slot recalculation for tint orders.

---

## 3. Tint Operator — /tint/operator

Primary users: Deepak, Chandrasing. LIVE.

**Key files:**
- `components/tint/tint-operator-content.tsx` — full v4 redesign
- `app/api/tint/operator/my-orders/route.ts`
- `app/api/tint/operator/done/route.ts`
- `app/api/tint/operator/split/done/route.ts`
- `app/api/tint/operator/orders/route.ts`
- `app/api/tint/operator/action/route.ts`

Visual spec: `CLAUDE_UI.md §48-49`.

### 3.1 Layout (v4 redesign)

3-level hierarchy:
- **Row 1** — UniversalHeader: title "My Jobs", stats (queue/active/done counts), clock, search
- **Row 2** — Job filter as teal-600 segment pill (leftExtra). Click opens 400px dropdown with scoreboard + queue cards. Progress bar (rightExtra): amber <25%, teal 25-75%, green >75%.
- **Below Row 2** — Bill To / Ship To as equal-width cards (`grid-cols-2`). Full customer names, no truncation.
- **Main** — 320px SKU left panel + flex TI form right. Mobile: left panel hidden below md.

### 3.2 Job queue sequence enforcement

TM (Chandresh) controls job sequence via assignment order. Operator CANNOT start a future job — only "Save TI" is available for non-current jobs.

- **Current job** = first assigned in queue with no other job `in_progress`, OR the job that is `tinting_in_progress`
- **Future jobs:** show "Save TI" only (gray-900). After TI saved: "TI saved — waiting in queue" status text, no action buttons.

### 3.3 CTA button rules

- Save actions (Save TI, Update TI Entry): `bg-gray-900 text-white`
- Workflow actions (Save TI & Start, Start Job, Mark as Done): `bg-green-600 text-white`
- **No teal on any CTA button.** Teal exists only in sidebar + job pill.
- `handleSubmitTI(andStart: boolean)` — supports save-only mode (`andStart=false` skips the start endpoint call)
- Buttons use natural width (no `max-w`), `whitespace-nowrap`, `flex-shrink-0`. Never truncate.

### 3.4 Left panel card states (final)

- Selected: `bg-gray-100 border-l-[3px] border-l-gray-900` — no coloured borders
- Unselected (all statuses): `bg-white border-gray-200 hover:bg-gray-50` — status via ✓ checkmark or Pending badge only, no coloured left borders

Simplified from earlier states (amber-300 / green-300 borders removed) to reduce colour noise competing with shade grid.

### 3.5 Pigment-coloured shade cells

See UI §49 for full colour table.

- Each shade input has tinted bg + 3px top border in actual pigment colour
- `border-radius: 0 0 6px 6px` (flat top, rounded bottom)
- Filled cells (value > 0): deeper bg + darker border
- Constants at top of `tint-operator-content.tsx`: `TINTER_SHADE_COLORS` (13 shades) and `ACOTONE_SHADE_COLORS` (14 shades)
- Each map: `{ bg, bgFill, border, top, topFill, label }` hex values per shade code

### 3.6 Active shade values display

"ACTIVE SHADE VALUES" mode shows ONLY shades with value > 0 — no empty columns.
If no values entered: full grid shown ("SHADE QUANTITIES (TINTER/ACOTONE)").
Toggle: "+ Show all 13" expands to full grid. "− Show active only" collapses back (only when active values exist).

### 3.7 Post-save form behaviour

After successful Save TI or Update TI Entry:
- Do NOT reset `tiEntries` to `defaultTIFormEntry()`
- Instead: `fetchOrders` → `loadExistingTIEntries` → the `selectedLineIdx` effect repopulates form from updated `existingTIEntries` map
- `existingTIEntries` must create **new Map reference** on update (not mutate in place) to trigger React re-render
- `selectedLineIdx` effect depends on: `selectedLineIdx`, `selectedJob?.id`, `existingTIEntries`
- After saving NEW entry: auto-advance to next uncovered line if any

### 3.8 Auto-load existing TI entry on line selection

When operator clicks a line card (or line auto-selected on load):
- Line HAS existing entry → form populated with saved values, "ACTIVE SHADE VALUES" mode, `editingEntryId` set, `tinterType` set
- Line has NO entry → fresh empty form, full shade grid, `editingEntryId` null

### 3.9 Timer calculation

- Elapsed timer: `Math.max(0, now.getTime() - new Date(startedAt).getTime())`
- Guard against negative values (timezone/parsing issues) — always use `Math.max(0, diff)`
- Reads from job that is `tinting_in_progress` (not just `selectedJob`)
- Prisma DateTime comes as ISO string with Z suffix — parsed correctly by `new Date()`
- `setInterval` ticks every 1000ms with immediate first tick
- Displays in both Row 2 (next to pill) and footer

### 3.10 Multi-line Save TI + Start flow

Current job (assigned, not in progress): ALWAYS shows `[Save TI]` + `[Save TI & Start]` regardless of how many lines are covered.

Operator decides when to start — no prerequisite of "all lines covered".
- "Save TI" — saves current line only, auto-advances to next uncovered line
- "Save TI & Start" — saves current line AND starts job timer

### 3.11 Removed elements

- Old 240px left panel job queue cards
- Old bottom sheet queue overlay
- "+ Add Another Entry" button (left panel navigation replaces multi-entry creation)
- Base SKU dropdown for first entry (driven by left panel selection)
- Entry header when single entry
- Purple TINT badge from TI header (redundant on tinting-only screen)

### 3.12 API data

`GET /api/tint/operator/my-orders` returns per order/split: `billToCustomerId`, `billToCustomerName`, `areaName`, `routeName`, `deliveryTypeName`. Top-level: `totalAssignedToday`, `totalDoneToday`. Extended existing `rawSummaries` + customer includes, no new DB queries.

---

## 4. Delivery Challan — /tint/manager/challans

TM screen. LIVE (redesigned v67-v71).

**Key files:**
- `components/tint/challan-content.tsx`
- `components/tint/challan-document.tsx`
- `app/api/tint/manager/challans/route.ts`

### 4.1 Auto-creation

At import time (not lazily on click) for orders with SMU = "Retail Offtake" or "Decorative Projects". Sequence based on `orderDateTime` within batch. Number format: `CHN-{YEAR}-{5-digit seq}`. Created regardless of customer master status.

### 4.2 SMU filter

Only "Retail Offtake" and "Decorative Projects" appear. Other SMU values (Deco, Deco Retail, Distributor) excluded.

Sort: `orderBy: { orderDateTime: "asc" }`.

### 4.3 Layout — split view (UI §45)

- 320px left panel: compact 3-line rows (OBD mono + challan badge / customer name / SMU dot + route + articles). Selected: `bg-teal-50 + border-l-teal-600`. No search in panel (handled by UniversalHeader).
- Right panel: action bar (challan ID mono + OBD + customer gray-400 | Edit outline + Print dark) + challan document on `#f9fafb` bg.
- UniversalHeader: no segments. Filter groups: SMU + Route. Date stepper. Search.

### 4.4 Document — B&W print (UI §46)

- Grayscale only palette. **No teal. No blue.**
- Logo CSS filter: `grayscale(100%) brightness(0)` for pure black print
- Address bar (#374151) is the only dark section
- Structure: Header → dark address bar → SMU/OBD/Warehouse fields → Bill To / Ship To → Customer/SO/Receiver → Line items table → Footer (terms + transport + signatures) → bottom bar (regd office + GSTIN)
- Bill To includes address (lookup via `billToCustomerId` from `delivery_point_master`)
- Table: `table-layout: fixed` + `<colgroup>` 5/13/35/15/8/12/12%. Header 28px `#f9fafb`. Data rows 32px. Blank rows to minimum 8. Totals row 2px top border.

### 4.5 Print CSS

`@page` rules must be top-level in `globals.css` — cannot nest in `@media print`.

Use `visibility: hidden` on body + `visibility: visible` on print area (not `display: none` — hides the print area itself).

---

## 5. Shade Master — /tint/manager/shades, /tint/shades

LIVE (redesigned v40).

- 2-row UniversalHeader
- `IosToggle`, type filter (TINTER/ACOTONE), pack filter, pagination
- Columns: # | Shade Name | Customer ID | Type | SKU Code | Pack | Status | Active | Added By | Added At

Pending: verify `/api/admin/shades` handles `isActive` filter param.

---

## 6. TI Report — /ti-report, /tint/manager/ti-report

LIVE (redesigned v40).

- `DateRangePicker` with presets (leftExtra in UniversalHeader)
- No Summary tab
- Inline shade expand
- Download Excel button
- Filter dropdown: operator + type
- Columns: chevron | Date | OBD No. | Dealer | Site | Base | Pack | Tins | Operator | Time

---

## 7. Permissions

Three TM page keys in `lib/permissions.ts`:
- `delivery_challans`
- `shade_master`
- `ti_report`

All three added to `PAGE_NAV_MAP`, `PageKey` type, `ALL_PAGE_KEYS`.

`role_permissions` SQL:
```sql
INSERT INTO role_permissions ("roleSlug", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
VALUES
  ('tint_manager', 'delivery_challans', true, false, false, true, false),
  ('tint_manager', 'shade_master',      true, false, false, true, false),
  ('tint_manager', 'ti_report',         true, false, true,  false, false)
ON CONFLICT ("roleSlug", "pageKey") DO NOTHING;
```

Layout `app/(tint)/tint/manager/layout.tsx` uses `buildNavItems()` only — never manually append Delivery Challans / Shade Master / TI Report. Role passed from `session.user.role` (not hardcoded).

---

## 8. Pending items (Tint module)

### TM
- SlotSummaryItem interface defined but unused — can remove
- Legacy filter dropdown cleanup
- `operatorSequence` field on `tint_assignments` and `order_splits` unused — schema cleanup later
- Reorder API uses `prisma.$transaction` — violates project rule but left as-is (simple two-update swap). Refactor to sequential awaits later.
- CustomerMissingSheet styling doesn't match admin customer split-view form (cosmetic)
- CustomerMissingSheet area/route dropdown 403 fix pushed, needs production verification

### Tint Operator (post-launch verification)
- Full end-to-end workflow test: assign from TM → fill TI → save → start → add entry → mark done → auto-advance
- Suggestion strip verification — needs saved shade data; test with customer that has shade history
- Queue dropdown keyboard navigation (↑↓ + Esc) — designed, may not be implemented
- Mobile layout — left panel hidden on <md, TI form full width, needs proper mobile testing
- Timer display in footer during in-progress state — verify renders correctly
- ACOTONE shade grid — verify colour mapping renders when switching to ACOTONE tab
- Post-save form blank reset — verify updating TI entry preserves shade values without page refresh
- Shade suggestion strip renders between TI header and form when saved shades exist for SKU+pack combination — needs shade master data to test

### Challan
- Challan lazy creation removal — `[orderId]` detail API may still auto-create challans on click. Verify and remove if present.
- Challan print CSS verification — `@media print` rules in `globals.css` with new B&W layout. Old class names (ch-header, tint-yes) may need updating.
- SMU dropdown in challan filter — old dropdown had "Project" option. Now handled by UniversalHeader filter with correct values.

### Slot / orderDateTime
- orderDateTime on other screens — Support, Planning, Warehouse boards still use `obdEmailDate`/`obdEmailTime`. Update when those screens go live.
- `lib/slot-cascade.ts` remains disabled. If ever re-enabled, must skip tint orders.

---

*Tint v1.0 · Schema v26.5 · April 2026*
