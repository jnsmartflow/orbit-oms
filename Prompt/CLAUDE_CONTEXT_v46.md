# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v46.md fully before doing anything else."
# Version: Phase 1 Go-Live · Schema v24 · Context v46 · April 2026

---

## 1-41. [Unchanged from v38]

(All sections 1 through 41 remain unchanged — refer to v38 for full content)

---

## 42. Known Issues / Pending Fixes (UPDATED v46)

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
13. **Mail Order — Lock persistence** — Lock flag (formerly OD/CI) is currently local state only (lost on refresh). Add `isLocked` boolean field to `mo_orders` table + PATCH API endpoint to persist flag.
14. **Universal header — old header code** — TM has old header wrapped in `display:none` div. Should be fully removed in cleanup pass. Planning and Warehouse old header component files (PlanningHeader, WarehouseHeader, DeliveryTabs, SlotBar, etc.) are no longer imported but files still exist on disk.
15. **Universal header — production verification pending** — Only TM, Tint Operator, and Mail Orders headers verified in production. Support, Planning, Warehouse, TI Report, Shade Master need verification after respective users log in.
16. **Mail Orders — auto-refresh** — Page doesn't auto-refresh when new orders arrive via PowerShell. Need setInterval (30-60s) on the fetch useEffect.

---

## 43. Queued Features (UPDATED v46)

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
- ~~**Mail Order email parsing + SKU enrichment (PowerShell)**~~ — **DONE v41.**
- ~~**Mail Order backend (DB + APIs + enrichment engine)**~~ — **DONE v42.**
- ~~**Mail Order frontend page**~~ — **DONE v43.**
- ~~**Mail Order role**~~ — **DONE v43.**
- ~~**soNumber import mapping**~~ — **DONE v44.** SAP SONum → orders.soNumber.
- ~~**Dispatch enrichment from FW: email**~~ — **DONE v44.** PS v3 extracts dispatch data.
- ~~**Mail Order — customer matching**~~ — **DONE v45.** Customer code auto-matching from email subject.
- ~~**Universal header system**~~ — **DONE v46.** Shared `<UniversalHeader />` component across all 8 boards. Segmented slot control, unified filter dropdown, search, clock, date stepper, shortcuts panel. Verified on TM, Tint Operator, Mail Orders. Remaining boards pending production login verification.
- **Cascade badge** — When `originalSlotId !== slotId`, show `⏩ from {originalSlot.name}` badge on order rows.
- **Apply neutral theme to all screens** — Support, Planning, Warehouse, Tint Operator need same neutral palette as TM v39.
- **Order detail panel** — wire into Planning board and Warehouse board
- **Audit history in detail panel** — order_status_logs exists, not yet fetched/rendered
- **CustomerMissingSheet styling** — not matching admin customer form
- **Smart slot assignment** — orders arriving at/after slot cutoff auto-escalate
- **Visual "carried over" indicator for overdue orders in slot tabs**
- **MIS Override Layer** — Admin-only field-level overrides per OBD
- **Barcode/QR label generation** — post-TI submission
- **Customer data enrichment** — remaining area batches
- **Operations password change** — operations@orbitoms.com temp password 'operations123' must be changed in prod
- **Mail Order — Lock persistence** — flag is currently local state only. Need DB persistence.
- **Mail Order — SAP operator role page** — consider adding read-only ops view
- **Mail Order — auto-refresh** — add setInterval polling for new orders
- **Watch-OrderEmails-v2.ps1 retirement** — RE: email script no longer needed. Stop running Watch script on Windows PC.
- **Mail Order — backfill endpoint cleanup** — `app/api/mail-orders/backfill-customers/route.ts` is temporary, delete after confirming.
- **Universal header cleanup** — remove display:none old header code from TM, delete unused PlanningHeader/WarehouseHeader/DeliveryTabs/SlotBar component files.

---

## 52-54. [Unchanged from v39-v40]

(Tint Manager Redesign, Shade Master Redesign, TI Report Redesign — refer to respective versions)

---

## 56. Email Monitor Pipeline — RE: Emails (DEPRECATED v44)

**DEPRECATED.** Refer to v41 for historical reference only.

---

## 57. Mail Order Pipeline (UPDATED v45 — unchanged in v46)

(Refer to v45 for full Mail Order Pipeline documentation including customer matching)

---

## 58. Universal Header System (NEW v46 — April 4, 2026)

### Overview
Shared `<UniversalHeader />` component used by all 8 board screens. Provides consistent layout, positioning, and keyboard shortcuts across all roles and views.

### Component
**File:** `components/universal-header.tsx`

### Props Interface
```typescript
UniversalHeaderProps {
  // Row 1
  title: string
  stats?: HeaderStat[]               // { label, value }
  showDownload?: boolean             // TI Report only
  onDownload?: () => void

  // Row 2 left
  segments?: HeaderSegment[]         // { id, label, count? }
  activeSegment?: number | string | null
  onSegmentChange?: (id) => void
  leftExtra?: React.ReactNode       // TI Report date range picker

  // Row 2 right
  rightExtra?: React.ReactNode      // TM view toggle
  filterGroups?: FilterGroup[]       // { label, key, options[] }
  activeFilters?: Record<string, string[]>
  onFilterChange?: (filters) => void
  showDatePicker?: boolean           // default true
  currentDate?: Date
  onDateChange?: (date) => void

  // Search
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (query) => void

  // Shortcuts
  shortcuts?: ShortcutItem[]         // { key, label }
}
```

### Layout

**Row 1 (52px, sticky top-0):**
```
LEFT:   Title (14px semibold) · Stats (11px gray-400, ml-3)
RIGHT:  Clock (11px, tabular-nums) | ⌨ Shortcuts | [Download] | Search bar (180px→260px)
```
- Title never includes date — date is shown in the stepper only
- Clock: IST, HH:MM, updates every second
- Shortcuts: keyboard icon, click opens panel, ? key toggles
- Search: / key focuses, Esc clears, 300ms debounce
- Download: teal CTA, only when showDownload=true
- Dividers: w-px h-4 bg-gray-200 between elements

**Row 2 (40px, sticky top-[52px]):**
```
LEFT:   Segmented control (slot pills or status tabs)
RIGHT:  [rightExtra] | Filter ▾ | ‹ Today · 04 Apr ›
```
- Segmented control: bg-gray-100 track, teal-600 active, gray-500 inactive
- No "All" button — deselected = show all
- Only 4 slots shown: Morning, Afternoon, Evening, Night (Next Day filtered out)
- Filter button: gray-200 border inactive, gray-900 + count badge when active
- Date stepper: arrows + "Today · 04 Apr" or "Yesterday · 03 Apr"

### Color Hierarchy
- **Teal (bg-teal-600):** Active slot segment ONLY (+ Download button on TI Report)
- **Dark gray (gray-900):** Active filter badge, date label
- **Light gray (gray-400):** Everything else — clock, icons, inactive segments, dividers
- **No slot selected = no teal in header = fully neutral**

### Keyboard Shortcuts (Universal)
| Key | Action |
|---|---|
| / | Focus search bar |
| ? | Toggle shortcuts panel |
| Esc | Close search / popover |
| 1-4 | Jump to slot segment |
| ↑↓ | Navigate rows (handled by board) |
| Enter | Expand/detail (handled by board) |

### Per-Board Wiring

| Board | Segments | Filter Groups | Date | Extras |
|---|---|---|---|---|
| Support | Slots (4) | View, Status, Del Type, Priority | Stepper | Search (new) |
| Tint Manager | Slots (4) | Del Type, Priority, Type, Operator | Stepper | View toggle (rightExtra) |
| Planning | Slots (4) | Del Type, Dispatch Status | Stepper | — |
| Warehouse | Slots (4) | Del Type, Pick Status | Stepper | — |
| Mail Orders | Slots (4) | Status, Match, Dispatch | Stepper | — |
| Tint Operator | Status tabs (3) | — | None | — |
| TI Report | Date presets (3) | Tinter Type [, Operator] | None | Date range (leftExtra), Download |
| Shade Master | — | Tinter Type, Status | None | — |

### Production Status
- **Verified:** Tint Manager, Tint Operator, Mail Orders
- **Pending verification:** Support, Planning, Warehouse, TI Report, Shade Master (need respective user logins)

---

## 55. Session Start Checklist (UPDATED v46)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v24** (v23 + mo_orders: customerMatchStatus, customerCandidates)
3. **Universal header (v46):** `<UniversalHeader />` in `components/universal-header.tsx`. Used by ALL 8 boards. Do NOT create new header patterns — use this component.
4. **CLAUDE_UI.md v4.3:** Load alongside this file for ALL UI work — teal brand system, universal header spec, segmented control, smartTitleCase, Lock icons
5. **Planning is ORDER level** (v28 correction still applies)
6. **Tint Manager uses OrderDetailPanel** not SkuDetailsSheet (v39)
7. **Delivery type dot colors:** blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross). Normalize with .toUpperCase().
8. **Slot segments:** 4 slots only — Morning, Afternoon, Evening, Night. Filter out Next Day Morning (isNextDay).
9. **Shade Master:** No segments, no date picker. Search + filter only.
10. **TI Report:** Date presets as segments, DateRangePicker as leftExtra, Download button, no date stepper.
11. **page.tsx pattern:** All board pages are bare `<ComponentName />` — no wrapper div, no title
12. **Mail Order frontend:** LIVE. 12-column table, customer code matching, delivery type dots, smart title case, dispatch badges, SO Number auto-punch, Lock column, urgent banner.
13. **Mail Order enrichment:** Try-and-verify engine.
14. **Mail Order PowerShell:** `Parse-MailOrders-v3.ps1` — run manually for now, Task Scheduler setup pending.
15. **Mail Order Lock flag:** Local state only — not persisted to DB yet.
16. **billing_operator role:** id=13, pageKey=mail_orders. Users: Deepanshu (id 25), Bankim (id 26). Password: Billing@123.
17. **SAP import enrichment:** `applyMailOrderEnrichment()` auto-applies dispatch data from mo_orders to orders when soNumber matches.
18. **soNumber on orders:** Mapped from SAP XLS "SONum" column in both manual and auto-import. Indexed.
19. **Mail Order customer matching:** LIVE (v45). customer-match.ts. Three states: exact/multiple/unmatched.
20. **Mail Order keyboard shortcuts:** C=copy code, S=copy SKU, P=open picker, Esc=close popover, ↑↓=navigate, Enter=expand.
21. **Smart title case:** smartTitleCase() in lib/mail-orders/utils.ts. Applied to customer name, SO name, remarks, area, route.
22. **Backfill endpoint:** `/api/mail-orders/backfill-customers` — temporary, delete after production verification.
23. **Universal header color rule:** ONE teal element (active slot). Everything else gray. No teal on filter, date, search.
24. **Universal header props:** segments (count optional), leftExtra, rightExtra, showDatePicker, showDownload. Read component file for full interface.
25. **Old header cleanup pending:** TM has display:none wrapper. Old PlanningHeader/WarehouseHeader files exist but unused.
26. All existing checklist items from v38 #36 still apply

---

*Version: Phase 1 Go-Live · Schema v24 · Context v46 · April 2026*
