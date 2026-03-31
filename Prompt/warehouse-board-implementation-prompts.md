# Warehouse Board — Implementation Prompts
# Execute these prompts ONE AT A TIME in Claude Code (Opus mode)
# Report results back before running the next one

---

## Pre-flight: Schema Migration

### Prompt 0 — Create pick_assignments table (RUN IN SUPABASE SQL EDITOR)

```sql
-- Run this in Supabase SQL Editor — NOT in terminal
-- Schema v18: pick_assignments for warehouse board

CREATE TABLE pick_assignments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  picker_id INTEGER NOT NULL REFERENCES users(id),
  sequence_number INTEGER NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  assigned_by_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'assigned',
  picked_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(order_id)
);

CREATE INDEX idx_pick_assignments_picker ON pick_assignments(picker_id);
CREATE INDEX idx_pick_assignments_status ON pick_assignments(status);
```

Then in Claude Code terminal:
```
npx prisma db pull
npx prisma generate
npx tsc --noEmit
```

Verify pick_assignments model appears in prisma/schema.prisma. Zero TS errors.

---

## Step 1 — API Routes

### Prompt 1A — GET /api/warehouse/board

```
Read CLAUDE_CONTEXT_v30.md fully before doing anything else.
Confirm you understand Section 17.2, 37, 38, and 39.

=== TASK: Create GET /api/warehouse/board API route ===

File: app/api/warehouse/board/route.ts

This route returns all data needed for the warehouse board.

Query parameters:
- date (optional, defaults to today)
- deliveryType (optional, filter by delivery type name)
- slotId (optional, filter by slot)

Response shape:
{
  unassigned: CustomerGroup[]
  assigned: {
    picker: { id, name, avatarInitial }
    assignments: CustomerGroup[]
    stats: { total, picked, pending, totalKg }
  }[]
  stats: { unassigned, picking, picked, totalOBDs }
}

CustomerGroup shape:
{
  customerId: string
  customerName: string
  area: string
  route: string
  priority: string
  customerRating: string
  deliveryType: string
  slotId: number
  slotName: string
  totalKg: number
  totalUnits: number
  hasTinting: boolean
  tintingPendingCount: number
  tintingCompleteCount: number
  tripInfo: { tripNumber, vehicleNo, vehicleType } | null
  orders: {
    id: number
    obdNumber: string
    weightKg: number
    units: number
    isPicked: boolean
    pickedAt: string | null
    hasTinting: boolean
    tintingStatus: string | null
    pickAssignment: { id, sequenceNumber, pickerId } | null
  }[]
}

Business logic:
- Only orders where at least one split has dispatchStatus = 'dispatch'
- Group orders by shipToCustomerId
- Unassigned = no row in pick_assignments
- Auto-sort unassigned: slot urgency → vehicle assigned (on confirmed trip) → priority (P1>P2>P3) → key customer (A)
- Join dispatch_plan_orders → dispatch_plans for trip/vehicle info
- Join delivery_point_master for customer name, area, route, rating
- Join import_obd_query_summary for weight, hasTinting

Constraints:
- export const dynamic = 'force-dynamic'
- checkPermission for Floor Supervisor or Admin
- No prisma.$transaction
- Run npx tsc --noEmit — zero errors
- DO NOT write UI code yet
```

### Prompt 1B — GET /api/warehouse/pickers

```
Read CLAUDE_CONTEXT_v30.md fully before doing anything else.

=== TASK: Create GET /api/warehouse/pickers API route ===

File: app/api/warehouse/pickers/route.ts

Returns all users with picker role + today's stats.

Response:
{
  pickers: {
    id: number
    name: string
    avatarInitial: string
    status: 'picking' | 'available'
    assignedCount: number
    pickedCount: number
    pendingCount: number
    totalKg: number
  }[]
}

Logic:
- Query users where role = Picker (check role_master for exact name)
- Left join pick_assignments where assigned_at >= today start AND status IN ('assigned','picked')
- Status = 'picking' if pendingCount > 0, else 'available'
- Sort: picking first, then available

Constraints:
- export const dynamic = 'force-dynamic'
- checkPermission for Floor Supervisor or Admin
- Run npx tsc --noEmit — zero errors
```

### Prompt 1C — POST /api/warehouse/assign

```
Read CLAUDE_CONTEXT_v30.md fully before doing anything else.

=== TASK: Create POST /api/warehouse/assign API route ===

File: app/api/warehouse/assign/route.ts

Request body: { orderIds: number[], pickerId: number }

Logic:
1. Validate pickerId exists with picker role
2. Validate all orderIds exist with dispatchStatus = 'dispatch'
3. Check none already have pick_assignment — return 400 if any do
4. Get max sequence_number for this picker today (or 0 if none)
5. Create pick_assignment rows: sequence_number = max+1, max+2, etc.
6. Return created assignments

Constraints:
- export const dynamic = 'force-dynamic'
- checkPermission for Floor Supervisor or Admin
- Session user = assigned_by_id
- Sequential awaits (no prisma.$transaction)
- Run npx tsc --noEmit — zero errors
```

### Prompt 1D — POST /api/warehouse/orders/[id]/mark-picked

```
Read CLAUDE_CONTEXT_v30.md fully before doing anything else.

=== TASK: Create POST /api/warehouse/orders/[id]/mark-picked ===

File: app/api/warehouse/orders/[id]/mark-picked/route.ts

Toggle isPicked on an order.

Logic:
1. Find order by id
2. Toggle: if !isPicked → set isPicked=true, pickedAt=now, pickedById=session user
3. Toggle: if isPicked → set isPicked=false, pickedAt=null, pickedById=null
4. Update pick_assignment status too (assigned ↔ picked)
5. Sync order_splits.isPicked for all splits of this order
6. Return updated order

NOTE: Check if /api/planning/orders/[id]/mark-picked already exists.
If it does, either extend it or create warehouse-specific version that also handles pick_assignments.

Constraints:
- export const dynamic = 'force-dynamic'
- checkPermission for Floor Supervisor or Admin
- Run npx tsc --noEmit — zero errors
```

---

## Step 2 — Page + Layout

### Prompt 2 — Warehouse page and layout components

```
Read CLAUDE_CONTEXT_v30.md fully before doing anything else.
Reference Section 17.2 for exact layout spec.

=== TASK: Create warehouse page + layout components ===

Files to create:

1. app/warehouse/page.tsx
   - Server component, permission check (Floor Supervisor or Admin)
   - Renders <WarehousePage />

2. components/warehouse/warehouse-page.tsx
   - Client component, main orchestrator
   - Types matching API response shapes from Step 1
   - State: selectedDate, activeDeliveryType, activeSlotId, selectedOrderIds[], boardData, pickersData
   - fetchBoard() and fetchPickers() — call on mount + every 30s
   - handleAssign(orderIds, pickerId) — POST assign, refetch
   - handleMarkPicked(orderId) — POST mark-picked, refetch
   - Layout: header → delivery tabs → slot tabs → flex split (300px left + flex right)

3. components/warehouse/warehouse-header.tsx
   - "Warehouse Board" + date + refresh + stats row
   - Stats: X Unassigned · X Picking · X Picked | X OBDs

4. components/warehouse/warehouse-delivery-tabs.tsx
   - Clone planning/delivery-tabs.tsx pattern
   - Underline style tabs with counts

5. components/warehouse/warehouse-slot-tabs.tsx
   - NEW: underline TABS (not cards like dispatcher)
   - One active at a time
   - Tab content: name + urgent badge (red <30min) + "X/Y" pick progress
   - Active = border-b-2 border-gray-800

Constraints:
- Split: left w-[300px] border-r bg-white + right flex-1
- Height: h-[calc(100vh-155px)] for main area (adjust based on actual header+tabs height)
- Match mockup v8 styling exactly
- Run npx tsc --noEmit — zero errors
```

---

## Step 3 — Left Panel

### Prompt 3 — Unassigned panel + cards

```
Read CLAUDE_CONTEXT_v30.md fully before doing anything else.

=== TASK: Create unassigned panel components ===

1. components/warehouse/unassigned-panel.tsx
   - w-[300px] fixed, border-r, bg-white, flex flex-col
   - Header: "Unassigned" + count badge + total kg + OBD count
   - Sort indicator: text-[9px] "Auto-sorted: Slot → Vehicle → Priority"
   - flex-1 overflow-y-auto scrollbar area: renders UnassignedCard list
   - Bottom footer (border-t bg-gray-50): selected count + picker dropdown (10 names) + "Assign" button
   - Assign button calls parent handleAssign

2. components/warehouse/unassigned-card.tsx
   - Checkbox (gray-700 fill when selected, ring-2 on card)
   - Priority dot: red (P1) / amber (P2) / gray (P3)
   - Key star ★ if customerRating = 'A' (amber-500)
   - Customer name (text-[11px] font-medium, truncate)
   - Expand chevron (right side)
   - Row: area · OBD count + weight (bold, right-aligned)
   - Vehicle tag: "🚚 Trip X · VehicleType" gray-100 bg — only if tripInfo exists
   - Tinting badge: "🎨 N" purple-50 bg — only if hasTinting
   - WHY hint badge: amber-50 bg, text-[8px]
     - Build from sort signals: "Slot closing" if <30min, "Vehicle" if on confirmed trip, "P1/P2/P3", "★" if key
   - Expanded: border-t, OBD rows: amber dot + mono OBD# + tinting badge + weight + units

Constraints:
- Card styling matches mockup v8 left panel exactly
- Run npx tsc --noEmit — zero errors
```

---

## Step 4 — Right Panel

### Prompt 4A — Pickers panel + picker lane

```
Read CLAUDE_CONTEXT_v30.md fully before doing anything else.

=== TASK: Create pickers panel + picker lane ===

1. components/warehouse/pickers-panel.tsx
   - flex-1, flex flex-col
   - Header: "Pickers" + "X picking · Y available"
   - flex-1 overflow-y-auto, p-3, space-y-2
   - Renders picker lanes (Picking state) then "AVAILABLE" section header then available rows
   - Pass onMarkPicked callback down

2. components/warehouse/picker-lane.tsx
   - Two visual modes based on picker status:

   MODE A — Picking (has pending items):
   - Container: bg-white rounded-lg border-gray-200
   - Header row (clickable, expand/collapse):
     - Avatar circle: w-6 h-6 colored bg, text-[10px] font-bold, initial letter
     - Name: text-[11px] font-medium w-20
     - Progress bar: flex-1 max-w-[140px] h-1.5, green fill
     - Count: "X/Y" text-[10px]
     - Total kg: text-[10px] text-gray-400
     - Chevron (rotate-180 when expanded)
   - Expanded content (default expanded):
     - px-4 py-3
     - Flex wrap gap-3: renders PickCard components (320px each)
     - After cards: renders DoneChip

   MODE B — Available (no pending):
   - Single row: bg-white rounded-lg border-gray-100
   - Avatar (gray-100 bg) + Name (gray-500) + "X done today" + green "Available" badge
   - No expand, no chevron

   Avatar colors: predefined array cycled by picker index:
   ['blue','emerald','orange','rose','sky','purple','amber','teal','indigo','pink']

Constraints:
- Run npx tsc --noEmit — zero errors
```

### Prompt 4B — Pick card + done chip

```
Read CLAUDE_CONTEXT_v30.md fully before doing anything else.

=== TASK: Create pick card and done chip ===

1. components/warehouse/pick-card.tsx
   - w-[320px] rounded-lg border-gray-200 bg-white p-3
   - Hover: border-gray-300 shadow-sm
   - Click to expand/collapse OBD detail
   - COLLAPSED:
     - Row 1: sequence badge (w-5 h-5 bg-gray-800 text-white rounded-full, number inside) + customer name (text-[11px] font-medium) + right-aligned pick progress "X/Y" (amber if pending)
     - Row 2: OBD count · weight (font-medium text-gray-700) · units — text-[10px]
     - Row 3: area name — text-[9px] text-gray-400
     - Row 4: vehicle tag "🚚 Trip X" (gray-100 bg text-[8px]) + tinting "🎨 N" (purple-50 bg) if applicable
   - EXPANDED (border-t mt-2 pt-2):
     - OBD rows stacked:
       - PICKED: bg-gray-50 rounded px-2 py-1.5 — green check + mono OBD# (gray-500) + weight + "Picked"
       - UNPICKED: bg-white border rounded px-2 py-1.5 — amber dot + mono OBD# (gray-700) + weight + "Pick" button
     - Pick button: h-5 px-1.5 text-[8px] bg-gray-100 hover:bg-gray-200 rounded
     - {/* SKU detail area — future iteration */}

2. components/warehouse/done-chip.tsx
   - COLLAPSED (default):
     - Inline-flex, rounded-full, bg-gray-50 px-2.5 py-1
     - Green check (10px) + "X done · Y kg" (text-[9px] gray-400) + tiny chevron
     - Clickable, hover:bg-gray-100
   - EXPANDED:
     - mt-2, flex gap-2 flex-wrap
     - Done cards: w-[180px] rounded-lg border-gray-100 bg-gray-50 p-2.5 opacity-50
       - Green check + customer name (text-[10px] gray-500) + weight (text-[9px] gray-400)

Constraints:
- Run npx tsc --noEmit — zero errors
```

---

## Step 5 — Integration

### Prompt 5 — Wire + test

```
Read CLAUDE_CONTEXT_v30.md fully before doing anything else.

=== TASK: Wire all warehouse components together and test ===

1. In warehouse-page.tsx, connect:
   - boardData → UnassignedPanel (unassigned customer groups) + PickersPanel (assigned groups per picker)
   - pickersData → PickersPanel (picker list with stats)
   - handleAssign → UnassignedPanel footer
   - handleMarkPicked → PickersPanel → PickerLane → PickCard
   - activeDeliveryType → filter boardData
   - activeSlotId → filter boardData
   - Auto-refresh: useEffect with setInterval(30000), cleanup on unmount

2. Loading states:
   - Show skeleton/spinner while fetching
   - Optimistic update on Mark Picked (toggle immediately, revert on error)

3. Error handling:
   - Toast/alert on assign failure (e.g., order already assigned)
   - Toast on mark-picked failure

4. Test on localhost:
   - /warehouse loads for Floor Supervisor role
   - /warehouse redirects for unauthorized roles
   - Delivery type tabs filter
   - Slot tabs filter
   - Unassigned cards render with correct sort order
   - Select + assign moves cards to picker lane
   - Picker lanes show Picking/Available correctly
   - Pick button toggles status
   - Done chip collapses/expands
   - Auto-refresh works

5. Run:
   - npx tsc --noEmit — zero errors
   - Test all API routes manually if needed

Report results. DO NOT push to git yet.
```

---

## Step 6 — Deploy

### Prompt 6 — Commit + push

```
Read CLAUDE_CONTEXT_v30.md fully before doing anything else.

=== TASK: Final check and deploy ===

1. npx tsc --noEmit — confirm zero errors
2. git add -A
3. git commit -m "Phase 4: Warehouse Board — pick coordination for Floor Supervisor

   New page: /warehouse
   Schema v18: pick_assignments table
   API: board, pickers, assign, mark-picked
   UI: split view — 300px unassigned + flex picker lanes
   Features: auto-sort with WHY hints, picker assignment with locked sequence,
   done items collapsed into chips, 320px dispatcher-style cards"
4. git push

Report Vercel deployment URL.
```

---

## Execution Notes

- Prompt 0: Run SQL manually in Supabase SQL Editor FIRST
- All other prompts: Run in Claude Code with Opus model
- ONE prompt at a time — report results before next
- After each prompt: npx tsc --noEmit must pass
- If TS errors: fix before proceeding
- If API shape needs adjustment: update types in warehouse-page.tsx to match
- Reference mockup: docs/mockups/warehouse-board-supervisor-v8.html
