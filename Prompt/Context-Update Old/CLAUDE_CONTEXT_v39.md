# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v39.md fully before doing anything else."
# Version: Phase 1 Go-Live · Schema v21 · Context v39 · April 2026

---

## 1-41. [Unchanged from v38]

(All sections 1 through 41 remain unchanged — refer to v38 for full content)

---

## 42. Known Issues / Pending Fixes (UPDATED v39)

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

---

## 43. Queued Features (UPDATED v39)

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

### Overview
Complete visual and functional redesign of the Tint Manager screen. Neutral palette matching Support/Warehouse boards. Fixed broken slot filter. Added slot awareness, delivery type indicators, and order detail panel.

### API Changes — `/api/tint/manager/orders`

New fields added to every order, split, and completed assignment in the response:
```
slotId:           number | null     — from orders.slotId FK → slot_master
slotName:         string | null     — from slot_master.name
slotTime:         string | null     — from slot_master.slotTime
slotIsNextDay:    boolean           — from slot_master.isNextDay
originalSlotId:   number | null     — from orders.originalSlotId
originalSlotName: string | null     — resolved via slotNameMap lookup
deliveryTypeName: string | null     — from customer → area → delivery_type_master.name
```

New response field:
```
slotSummary: SlotSummaryItem[]     — all active slots with tintPendingCount
```

Prisma query changes: added `slot` include on all 5 parallel queries, extended `area` select to include `deliveryType`, added 6th parallel query for `slot_master.findMany`.

### API Permission — `/api/orders/[id]/detail`
Added `ROLES.TINT_MANAGER` and `ROLES.OPERATIONS` to `requireRole` call — was missing, caused "Failed to load" error.

### Page Layout — 2 rows of chrome

**BEFORE (v38):** 5+ rows — Header, Slot filter, Filter bar, Workload bar, Stat cards
**AFTER (v39):** 2 rows only

```
Row 1: Tint Manager · 11 Pending · 2 Assigned · 0 In Progress · 0 Done · 2,304L · 12 OBDs    🔍 Search · Cards/Table · Clock
Row 2: Morning(9) · Afternoon ✓ · Evening ✓ · Night(3) · NextDay ✓                            [Filter ▾]  [Workload ▾]
Row 3: Content starts immediately (cards or table)
```

**Removed:**
- 4 stat cards (counts moved to header inline)
- 4-stage sticky header strip (redundant with section headers)
- Separate filter bar row (merged into Filter dropdown)
- Separate workload bar row (merged into Workload dropdown)
- Column reference strip (removed — scroll-triggered sticky strip gone)

### Slot Strip
- Real slot names from `slot_master` via `slotSummary` API data
- `isSlotClosed()` helper: IST time check with 15-min grace (reuses Support pattern)
- Closed slots: gray + dimmed. Done slots: checkmark. Active: dark border.
- Click to filter board by slotId. Click again to deselect (show all).
- No "All" button — default state = no slot selected = all shown.

### Filter Dropdown
- Single "Filter" button on Row 2 right side
- Opens dropdown panel with 4 filter groups:
  - **Delivery Type** — multi-select: Local, UPC, IGT, Cross (Set<string> state)
  - **Priority** — single-toggle: Urgent, Normal (click to activate, click again to deselect)
  - **Type** — single-toggle: Split, Whole
  - **Operator** — dropdown select
- Active count badge on Filter button: `Filter (2)`
- "Clear all filters" link at bottom of panel
- Closes on backdrop click

### Workload Dropdown
- Single "Workload" button on Row 2 right side
- Opens dropdown panel with operator chips showing assigned/inProgress/done counts
- Same data as before — just rendered in dropdown instead of collapsible bar

### Card View Changes

**Accent bars removed.** No colored top strip on cards. Clean white border-gray-200.

**Card layout:**
```
[✂ 1 · 6 left]  [Eye] [+] [⋯]    ← icon row (split info LEFT, icons RIGHT)
[● Normal]                          ← badge row
CUSTOMER NAME ⚠                     ← customer + inline missing icon
● 9106114692 · Area · Date          ← OBD row with delivery type dot
[SMU | SO | ART | VOL]              ← 2×2 info grid
[Create Split] or [Assign]          ← footer CTA (uniform height)
```

**Split indicator:** Moved from separate amber bar to icon row left side: `✂ 1 · 6 left` in amber text. Saves one row — all cards same height.

**Customer Missing:** Changed from full amber pill below customer name to inline ⚠ icon (AlertCircle 14px) next to customer name. Clickable → opens CustomerMissingSheet.

**Delivery type dot:** 5px colored dot before OBD number.
- Local = `bg-blue-600`
- Upcountry = `bg-orange-600`
- IGT = `bg-teal-600`
- Cross Depot = `bg-rose-600`

**Normal badge:** Changed from indigo/purple to neutral gray (`bg-gray-50 border-gray-200 text-gray-500`).

**Operator avatars:** Changed from indigo `#1a237e` to neutral `bg-gray-700`. Completed = `bg-green-600`.

**Buttons:** Assign and Create Split both use outlined neutral: `bg-white border-gray-200 text-gray-700 hover:bg-gray-50`.

### Table View Changes

**Column sequence:** OBD NO. → SMU → CUSTOMER → SLOT → PRIORITY → ARTICLES → VOLUME → STAGE → TIME → ACTIONS

**Unified 10-column grid** (all fr units, fills 100% width):
```typescript
const TABLE_GRID = "1fr 1.2fr 1.8fr 0.7fr 0.7fr 1.1fr 0.6fr 1.6fr 0.8fr 0.5fr";
```

**Stage column (col8) per section:**
- Pending: CTA button (Assign or Create Split + "6 left" amber text beside)
- Assigned: Operator avatar + name
- In Progress: Operator avatar + name
- Completed: Operator avatar + name

**Time column (col9) per section:**
- Pending: empty
- Assigned: Assigned At time
- In Progress: Elapsed time
- Completed: Completed At time

**Removed columns:** Area/Type, Sales Officer, Dispatch Status (moved to detail panel).

**SMU display:** Plain text `text-gray-600 font-medium` — no pill/badge.

**Section headers:** `● Section Name  count` with total volume right-aligned: `2,124 L`

**Text color hierarchy:**
- `text-gray-900 font-medium` — Customer name (darkest, primary)
- `text-gray-800 font-mono` — OBD number
- `text-gray-600` — SMU, Articles, Volume, Operator name
- `text-gray-400` — Slot, Time, Date, Priority "Normal"
- Semantic: Urgent = red, Missing = amber, "6 left" = amber

### Order Detail Panel
- Replaced SkuDetailsSheet with shared OrderDetailPanel on eye icon click
- `detailOrderId` state on TintManagerContent — passed to `<OrderDetailPanel orderId={detailOrderId} onClose={...} />`
- KanbanCard + SplitKanbanCard: eye icon triggers `onViewDetail` callback
- Table view: onOrderClick triggers detail panel
- SkuDetailsSheet import removed from TM (component file NOT deleted)

### Filter State Changes
```typescript
// REMOVED:
slotFilter: "all" | "10:30" | "12:30" | "15:30"   → replaced
dispatchFilter: "all" | "dispatch" | "hold" | "waiting_for_confirmation"  → removed

// ADDED/CHANGED:
slotFilter: "all" | number                          — slotId from slot_master
delTypeFilter: Set<string>                          — multi-select delivery types
filterDropdownOpen: boolean                         — dropdown panel open state
slotSummary: SlotSummaryItem[]                      — slot data from API
detailOrderId: number | null                        — order detail panel
```

### Operator Filter Bug Fix
Pending orders with operator filter: now only shows if order has a split assigned to that operator. Previously showed all pending orders that had any tintAssignment linked.

### Files Modified
- `app/api/tint/manager/orders/route.ts` — slot/deliveryType data, slotSummary
- `app/api/orders/[id]/detail/route.ts` — added tint_manager + operations roles
- `components/tint/tint-manager-content.tsx` — full redesign (header, slot strip, filter dropdown, workload dropdown, card styling, detail panel)
- `components/tint/tint-table-view.tsx` — 10-column grid, neutral styling, CTA buttons, delivery type dots

---

## 53. Session Start Checklist (UPDATED v39)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v21**
3. **TM redesign (v39):** Neutral palette, 2-row header, slot strip, filter dropdown, 10-column table, order detail panel
4. **CLAUDE_UI.md:** Load alongside this file for ALL UI work — defines the neutral theme system
5. **Planning is ORDER level** (v28 correction still applies)
6. **Tint Manager uses OrderDetailPanel** not SkuDetailsSheet (v39)
7. **Delivery type dot colors:** blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross)
8. **Filter state:** slotFilter is `"all" | number`, delTypeFilter is `Set<string>`, dispatchFilter removed
9. All existing checklist items from v38 #36 still apply

---

*Version: Phase 1 Go-Live · Schema v21 · Context v39 · April 2026*
