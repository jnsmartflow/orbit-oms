# CLAUDE_TINT.md — Tint Module
# v1.1 · Schema v27.2
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Covers Tint Manager, Tint Operator, Manual Tint Entry, Delivery Challans, Shade Master, TI Report.

Users: Chandresh Kolgha (tint_manager), Deepak Vasava + Chandrasing Valvi (tint_operator).

---

## 1. Tint Manager — /tint/manager

Primary user: Chandresh.

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

### 1.2 Operator workload pills

- "Unassigned · N" pill (red-ish): count of orders in Pending column (no operator yet)
- One pill per operator from `/api/tint/manager/operators`: count = assigned + in-progress combined (orders + activeSplits)
- Tap pill to filter all 4 columns to that operator's work. Tap again to deselect.
- Operator filter lives in pills only — not in Filter dropdown.

### 1.3 Missing customer badge (rightExtra)

Amber pill showing "N missing" when count > 0. Covers both tint and non-tint orders for SMU = "Retail Offtake" / "Decorative Projects".

Popover lists orders with: OBD, type badge (Tint/Non-Tint), customer name, SMU. Click opens `CustomerMissingSheet`. Re-fetches on resolve. Badge disappears when all resolved.

Endpoint: `GET /api/tint/manager/missing-customers` → `{ count, orders[] }`. Excludes terminal workflow stages.

### 1.4 Delivery type filter

Values must match DB exact casing: `Local`, `Upcountry`, `IGT`, `Cross Depot`.

### 1.5 Kanban 4 columns

Pending | Assigned | In Progress | Completed.

Column count pills: all neutral `bg-gray-100 text-gray-700 border-gray-200`. No semantic colours on column headers.

Empty state: compact "No orders" italic. No icon, no subtitle.

### 1.6 Card / row content

Every card shows:
- OBD (mono) · orderDateTime (via `formatOrderDateTime()` helper)
- Age badge (`CLAUDE_UI.md §35`) when 1+ days old
- Customer / Site name
- SMU
- Priority
- Articles, Volume
- Operator avatar (22×22px)
- Re-assign action (in Assigned rows)
- Dispatch status badge inline next to site name

Card sort: `sequenceOrder ASC → priorityLevel ASC → date ASC`.

### 1.7 Table view

`<table>` with `table-layout: fixed` per `CLAUDE_UI.md §35`.

- 9 columns: # / OBD / SMU / Site Name / Priority / Articles / Volume / Operator-Action / Time / Actions
- Widths: 4/13/10/18/7/9/6/15/10/8%
- First column `#`: 1-based serial counter per section
- "Customer" renamed to "Site Name"
- Slot column removed
- Dispatch status badge inline in CustomerCell (Dispatch/Hold/Waiting)
- Re-assign action added to Assigned section rows
- Roomy spacing: 10px vertical, 14px horizontal cell padding
- Four stacked sections: Pending / Assigned / In Progress / Completed. `mb-4` between.

### 1.8 Sequence order — single source of truth

Operator screen reads `sequenceOrder` from `orders`/`order_splits` (NOT `operatorSequence` from `tint_assignments`).

**Per-operator reorder:** Move up/down only swaps within same operator's assigned orders. API: `/api/tint/manager/reorder` — finds target order's operator, filters list to that operator, swaps.

**Assignment queue position:** New assignments get `sequenceOrder = MAX + 1` for that operator's existing queue (FIFO).

### 1.9 Customer missing flow

- `customerMissing` boolean on `orders` table
- Badge in header Row 2 rightExtra (amber pill) for SMUs "Retail Offtake" / "Decorative Projects"
- Click opens `CustomerMissingSheet`

### 1.10 API

`GET /api/tint/manager/orders` returns slot/deliveryType data, slotSummary, orderDateTime on all order/split/assignment payloads.

---

## 2. Slot assignment for tint orders

See `CLAUDE_CORE.md §9`.

- At import: `orderType === "tint"` → `slotId = null`, `originalSlotId = null`.
- At completion (whole order, `/api/tint/operator/done`): sets `slotId` + `originalSlotId` on order using `resolveSlot()` thresholds on current IST time.
- At split completion (`/api/tint/operator/split/done`): sets slot on **parent** order. Latest completion wins.
- No buffer before cutoff — completion at 10:25 → Morning slot.
- `applyMailOrderEnrichment()` skips slot recalculation for tint orders.

---

## 3. Tint Operator — /tint/operator

Primary users: Deepak, Chandrasing.

**Key files:**
- `components/tint/tint-operator-content.tsx`
- `app/api/tint/operator/my-orders/route.ts`
- `app/api/tint/operator/done/route.ts`
- `app/api/tint/operator/split/done/route.ts`
- `app/api/tint/operator/orders/route.ts`
- `app/api/tint/operator/action/route.ts`

Visual spec: `CLAUDE_UI.md §36-37`.

### 3.1 Layout

3-level hierarchy:
- **Row 1** — UniversalHeader: title "My Jobs", stats (queue/active/done counts), clock, search
- **Row 2** — Job filter as teal-600 segment pill (leftExtra). Click opens 400px dropdown with scoreboard + queue cards. Progress bar (rightExtra): amber <25%, teal 25-75%, green >75%.
- **Below Row 2** — Bill To / Ship To as equal-width cards (`grid-cols-2`). Full customer names.
- **Main** — 320px SKU left panel + flex TI form right. Mobile: left panel hidden below md.

### 3.2 Job queue sequence enforcement

TM controls job sequence via assignment order. Operator CANNOT start a future job — only "Save TI" is available for non-current jobs.

- **Current job** = first assigned in queue with no other job `in_progress`, OR the job that is `tinting_in_progress`
- **Future jobs:** show "Save TI" only (gray-900). After TI saved: "TI saved — waiting in queue" status text, no action buttons.

### 3.3 CTA button rules

- Save actions (Save TI, Update TI Entry): `bg-gray-900 text-white`
- Workflow actions (Save TI & Start, Start Job, Mark as Done): `bg-green-600 text-white`
- **No teal on any CTA button.** Teal exists only in sidebar + job pill.
- `handleSubmitTI(andStart: boolean)` — supports save-only mode
- Buttons use natural width, `whitespace-nowrap`, `flex-shrink-0`.

### 3.4 Left panel card states

- Selected: `bg-gray-100 border-l-[3px] border-l-gray-900` — no coloured borders
- Unselected (all statuses): `bg-white border-gray-200 hover:bg-gray-50` — status via ✓ checkmark or Pending badge only

### 3.5 Pigment-coloured shade cells

See `CLAUDE_UI.md §37` for full colour table.

- Each shade input has tinted bg + 3px top border in actual pigment colour
- `border-radius: 0 0 6px 6px` (flat top, rounded bottom)
- Filled cells (value > 0): deeper bg + darker border

Toggle: "+ Show all 13" expands to full grid. "− Show active only" collapses back.

### 3.6 Post-save form behaviour

After successful Save TI or Update TI Entry:
- Do NOT reset `tiEntries` to `defaultTIFormEntry()`
- Instead: `fetchOrders` → `loadExistingTIEntries` → the `selectedLineIdx` effect repopulates form from updated `existingTIEntries` map
- `existingTIEntries` must create **new Map reference** on update (not mutate in place) to trigger React re-render
- `selectedLineIdx` effect depends on: `selectedLineIdx`, `selectedJob?.id`, `existingTIEntries`
- After saving NEW entry: auto-advance to next uncovered line if any

### 3.7 Auto-load existing TI entry on line selection

When operator clicks a line card (or line auto-selected on load):
- Line HAS existing entry → form populated with saved values, "ACTIVE SHADE VALUES" mode, `editingEntryId` set, `tinterType` set
- Line has NO entry → fresh empty form, full shade grid, `editingEntryId` null

### 3.8 Timer calculation

- Elapsed timer: `Math.max(0, now.getTime() - new Date(startedAt).getTime())`
- Guard against negative values — always use `Math.max(0, diff)`
- Reads from job that is `tinting_in_progress`
- Prisma DateTime comes as ISO string with Z suffix — parsed correctly by `new Date()`
- `setInterval` ticks every 1000ms with immediate first tick
- Displays in both Row 2 (next to pill) and footer

### 3.9 Multi-line Save TI + Start flow

Current job (assigned, not in progress): ALWAYS shows `[Save TI]` + `[Save TI & Start]` regardless of how many lines are covered.

- "Save TI" — saves current line only, auto-advances to next uncovered line
- "Save TI & Start" — saves current line AND starts job timer

### 3.10 API data

`GET /api/tint/operator/my-orders` returns per order/split: `billToCustomerId`, `billToCustomerName`, `areaName`, `routeName`, `deliveryTypeName`. Top-level: `totalAssignedToday`, `totalDoneToday`.

---

## 4. Manual Tint Entry

Chandresh's manual override when auto-classification misses a tint requirement.

**Use cases:**
1. Sample requests / custom shades where the SKU description doesn't trigger any tint keyword
2. Late additions — dealer calls after import and asks for a custom shade on what was originally a stock-colour order

**UI:** Modal on Tint Manager screen. Operator types OBD number, picks which lines need tinting, submits with reason.

**Schema:**
```
manual_tint_entries
  id, orderId (FK → orders), lineIds (JSON array of import_raw_line_items.id),
  reason TEXT, createdBy (FK → users), createdAt
```

**Behaviour:** Additive only — does not modify or replace auto-classification at import time. Adds the OBD to the tint workflow with the chosen lines flagged as tinting.

---

## 5. Delivery Challan — /tint/manager/challans

TM screen.

**Key files:**
- `components/tint/challan-content.tsx`
- `components/tint/challan-document.tsx`
- `app/api/tint/manager/challans/route.ts`
- `app/api/tint/manager/challans/[orderId]/route.ts`

### 5.1 Auto-creation

At import time (not lazily on click) for orders with SMU = "Retail Offtake" or "Decorative Projects". Sequence based on `orderDateTime` within batch. Number format: `CHN-{YEAR}-{5-digit seq}`. Created regardless of customer master status.

### 5.2 SMU filter

Only "Retail Offtake" and "Decorative Projects" appear. Other SMU values excluded.

Sort: `orderBy: { orderDateTime: "asc" }`.

### 5.3 Layout — split view

See `CLAUDE_UI.md §33`.

- 320px left panel: compact 3-line rows. Selected: `bg-teal-50 + border-l-teal-600`. No search in panel.
- Right panel: action bar (challan ID mono + OBD + customer gray-400 | Edit outline + Print dark) + challan document on `#f9fafb` bg.
- UniversalHeader: no segments. Filter groups: SMU + Route. Date stepper. Search.

### 5.4 Document — B&W print

See `CLAUDE_UI.md §34` for full visual spec.

- Grayscale only palette. **No teal. No blue.**
- Logo: `/jsw-dulux-logo.png` (800×193 PNG-24). Height 34px. Container `paddingRight: 24px`.
  - Web view: NO inline filter (full colour)
  - Print view: `filter: grayscale(100%) brightness(0) !important` via `@media print`
- Header: Logo · "DELIVERY CHALLAN" centred · Challan number + OBD date right column (`minWidth: 165`)
- Right column shows challan number (bold mono) stacked over OBD date (`DD MMM YYYY` light). Labels "CHALLAN NO." / "CHALLAN DATE" removed.
- Address bar (#374151) is the only dark section
- Bill To includes address (lookup via `billToCustomerId` from `delivery_point_master`)
- Footer entity: `JSW Dulux Limited (formerly Akzo Nobel India Limited)`. Hardcoded in `challan-document.tsx`.

### 5.5 S5 contact resolution

Three columns: CUSTOMER (Bill To) / SALES OFFICER / SITE-RECEIVER (Ship To). Each uses a cascade.

**Bill-To contact cascade (CUSTOMER column):**
1. `isPrimary === true`
2. `contactRole.name ∈ {Owner, Manager, Proprietor, Partner, Director}`
3. First contact in array
4. null

**Ship-To site contact cascade (SITE / RECEIVER column):**
1. `isPrimary === true AND contactRole.name ≠ "Sales Officer"`
2. `contactRole.name ∈ {Site Engineer, Contractor, Supervisor}`
3. First contact with role ≠ "Sales Officer"
4. null

**Sales Officer cascade (SALES OFFICER column):**
1. `delivery_point_master.salesOfficerGroupId → sales_officer_group.salesOfficer`
2. Contact on Ship-To where `contactRole.name === "Sales Officer"`
3. null

Constants: `OWNER_ROLES`, `SITE_ROLES` arrays in `challans/[orderId]/route.ts`. Future role additions edit those arrays.

`isPrimary` is always selected on all three `delivery_point_contacts` join blocks (billToPoint, shipToPoint, codesAreIdentical duplicate fetch).

### 5.6 S5 phone rendering

When a contact resolves:
- Name: line 1, `fontSize 11, color #374151, marginTop 3`
- Phone: line 2, `fontSize 10, color #6b7280, marginTop 1, fontFamily SF Mono`

When no contact: fallback `<div height:20>` preserves row height. Blank S5 columns are valid output.

### 5.7 Print CSS

`@page` rules MUST be top-level in `globals.css` — cannot nest in `@media print`.

Use `visibility: hidden` on body + `visibility: visible` on print area (not `display: none`).

### 5.8 Table

`table-layout: fixed` + `<colgroup>` 5/13/35/15/8/12/12%. Header 28px `#f9fafb`. Data rows 32px. Blank rows to minimum 8. Totals row 2px top border.

### 5.9 Fini display

Challan document is **Fini-always**. No toggle. SKU codes and descriptions on the printed document always come from `mo_sku_lookup.material` / `description`. See `CLAUDE_MAIL_ORDERS.md §16`.

---

## 6. Shade Master — /tint/manager/shades, /tint/shades

- 2-row UniversalHeader
- `IosToggle`, type filter (TINTER/ACOTONE), pack filter, pagination
- Columns: # | Shade Name | Customer ID | Type | SKU Code | Pack | Status | Active | Added By | Added At

---

## 7. TI Report — /ti-report, /tint/manager/ti-report

- `DateRangePicker` with presets (leftExtra in UniversalHeader)
- No Summary tab
- Inline shade expand
- Download Excel button
- Filter dropdown: operator + type
- Columns: chevron | Date | OBD No. | Dealer | Site | Base | Pack | Tins | Operator | Time

---

## 8. Permissions

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

## 9. Landmines

- **TM reorder API** (`/api/tint/manager/reorder/route.ts` ~line 429) uses `prisma.$transaction` — violates `CORE §3`, left as-is for simple two-update swap. Formula upserts are idempotent so partial-failure semantics are acceptable.
- **`operatorSequence` field** on `tint_assignments` and `order_splits` — unused. Sort by `sequenceOrder` only.
- **`SlotSummaryItem` interface** in `tint-manager-content.tsx` — defined but unused.
- **CustomerMissingSheet** styling doesn't match admin customer split-view form (cosmetic).
- **Shade Master `isActive` filter** — `/api/admin/shades` filter param unverified in production.
- **Challan lazy creation** — `[orderId]` detail API may still auto-create challans on click. Verify before relying on import-time-only creation.
- **Challan print CSS** — old class names (`ch-header`, `tint-yes`) may persist in `globals.css` `@media print` rules.
- **`lib/slot-cascade.ts`** — disabled. If ever re-enabled, must skip tint orders.
- **Customer master gaps:** SHREE RANG SAROVAR (102359) and similar Bill-To customers missing any contact → challan S5 CUSTOMER column blanks.
- **SKU master gap:** when SAP ships an OBD with an unknown SKU (e.g. `5888558` DP M900 Gloss Enamel Brilliant White 20L), the line lands but enrichment is null. Add via Shade Master or SKU master.

---

*Tint v1.1 · Schema v27.2*
