# ORBIT_OMS_PROMPTS.md — Consolidated Build Prompt Guide
# Single source of truth for all Claude Code prompts
# Version: Phase 3 · Schema v12 · March 2026
#
# HOW TO USE:
# 1. Start every session: claude "Read CLAUDE_CONTEXT.md and CLAUDE_UI.md fully before doing anything else."
# 2. Run ONE step at a time. Complete the TEST before moving to the next.
# 3. All DB changes go via Supabase SQL Editor — never npx prisma db push locally.
# 4. Run npx prisma generate after every SQL migration.

---

## PHASE STATUS

| Phase | Steps | Status |
|---|---|---|
| Phase 1 — Foundation | Steps 1–14 | ✅ Complete |
| Phase 2 — Order Pipeline | Steps 15–20 | ✅ Complete |
| Phase 3 — Tint Splits | Steps 21–28 | ✅ Complete |
| Phase 3 — UI Polish | Steps 29–35 | 🔄 In Progress |
| Phase 4 — Dispatch Planning | Steps 36–42 | ⏳ Not started |
| Phase 5 — Warehouse Execution | Steps 43–48 | ⏳ Not started |

---

# PHASE 1 — FOUNDATION (✅ Complete)

All Phase 1 steps are complete. Schema v10, admin panel, auth, seed data all built.
Do not re-run these steps unless rebuilding from scratch.

Key deliverables:
- Next.js 14 scaffold with TypeScript, Tailwind, shadcn/ui, Prisma, NextAuth
- Schema v10 — 38 tables (23 master + 5 import stubs + 5 order stubs + 7 dispatch stubs)
- Admin panel with CRUD for all master tables
- Role-based auth with 7 roles
- Seed data for all lookup tables

---

# PHASE 2 — ORDER PIPELINE (✅ Complete)

All Phase 2 steps are complete. Import engine, support queue, tint manager v1, operator screen built.
Do not re-run these steps.

Key deliverables:
- OBD import engine (XLS → DB) with preview + confirm flow
- Support queue with dispatch status, priority, slot override
- Tint Manager 4-column Kanban (v1)
- Tint Operator screen with Start/Done
- Order status audit trail

---

# PHASE 3 — TINT SPLITS (✅ Complete)

## STEP 21 — Schema v12 (✅ Done)

order_splits expanded, split_line_items + split_status_logs added.
SQL migration applied to Supabase. prisma generate run.

## STEP 22 — Split Builder API (✅ Done)

File: `app/api/tint/manager/splits/create/route.ts`
Creates splits with line items in one transaction.
Validates qty against available remaining per line.

## STEP 23 — Split Builder Modal (✅ Done)

File: `components/tint/split-builder-modal.tsx`
Two-panel modal: Available Lines (left) + Splits builder (right).
Previous splits history section at bottom.
Opened from `...` menu on Pending cards.

## STEP 24 — Tint Manager Kanban v3 (✅ Done)

File: `components/tint/tint-manager-content.tsx`
Pending column: OBD cards with split indicator + remaining qty.
Assigned/In Progress: both split cards AND regular order cards.
Completed: splits with completedAt >= today.
Two-badge status trail on Completed cards.
OBD date/time inline in OBD row.

## STEP 25 — Split Actions (✅ Done)

Files:
- `app/api/tint/manager/splits/reassign/route.ts`
- `app/api/tint/manager/splits/cancel/route.ts`
- `app/api/tint/manager/cancel-assignment/route.ts`

Re-assign and Cancel in `...` menu on Assigned split cards.
Cancel restores OBD to pending_tint_assignment if no remaining splits.

## STEP 26 — Tint Operator v3 (✅ Done)

File: `components/tint/tint-operator-content.tsx`
Operator sees BOTH regular assigned orders AND their splits.
New routes:
- `app/api/tint/operator/split/start/route.ts`
- `app/api/tint/operator/split/done/route.ts`
Split done → status = tinting_done (stays, does NOT auto-move to pending_support).

## STEP 27 — Support Queue v3 (✅ Done)

File: `components/support/support-page-content.tsx`
Splits summary section inside order edit sheet.
Per-split dispatch status toggle.
New route: `app/api/support/splits/[id]/route.ts`

## STEP 28 — Final TypeScript Validation (✅ Done)

npx tsc --noEmit — 0 errors.

---

# PHASE 3 — UI POLISH (🔄 In Progress)

## STEP 29 — Support Queue redesign

```
Read CLAUDE_CONTEXT.md and CLAUDE_UI.md fully.
Then read:
  components/support/support-page-content.tsx
  app/api/support/orders/route.ts

Restyle the Support Queue screen following CLAUDE_UI.md design system.
DO NOT change any API logic, mutation handlers, or business rules.

Apply these visual changes:
- Topbar: "Support Queue" title (font-extrabold) + total orders badge
- Filter row: slot chips + order type select + dispatch status select + clear button
- Stat bar: StatCard components for Total | Hold | Dispatch | Waiting | Urgent | Pending Support | Pending Tint
- Table: bg-white border border-[#e2e5f1] rounded-xl overflow-hidden shadow-sm
  - Header: bg-[#f7f8fc] text-[11px] font-bold uppercase text-gray-400
  - Rows: hover:bg-[#f7f8fc] transition-colors
  - OBD number: font-mono text-[12px]
  - Status badges: use color system from CLAUDE_UI.md
- Edit sheet: w-[500px], section titles, dispatch toggle (3-button), priority toggle (2-button)
  - Splits section shows below editable fields

Run: npx tsc --noEmit — fix all errors.
```

## STEP 30 — Tint Manager card layout consistency

```
Read CLAUDE_CONTEXT.md and CLAUDE_UI.md fully.
Then read: components/tint/tint-manager-content.tsx

Ensure all 4 column cards have identical height by verifying:
1. Pending card bottom = Assign button (full width, navy)
2. Assigned card bottom = operator row (single row, avatar + name + time)
3. In Progress card bottom = operator row + progress bar
4. Completed card bottom = operator row + 100% progress bar + two-badge trail

No card should have extra empty space. All cards should end at the same visual level.

Run: npx tsc --noEmit — fix all errors.
```

## STEP 31 — Tint Operator screen redesign

```
Read CLAUDE_CONTEXT.md and CLAUDE_UI.md fully.
Then read: components/tint/tint-operator-content.tsx

Restyle the Tint Operator screen:
- Topbar: "My Tint Jobs" (font-extrabold) + operator name
- Stat bar: 3 StatCards — My Queue | In Progress | Completed Today
- Job cards: match CLAUDE_UI.md card structure
  - For splits: show "OBD · Split N · Route · Date"
  - For regular orders: show "OBD · Route · Date"
  - Meta grid: Articles | Volume | Slot | Status
  - SKU lines: only lines for this split/OBD
  - Progress bar
  - Action button: Start (navy) or Done (green)

Run: npx tsc --noEmit — fix all errors.
```

---

# PHASE 4 — DISPATCH PLANNING (⏳ Not started)

## STEP 36 — Schema v13: Expand dispatch tables

```
Read CLAUDE_CONTEXT.md fully. Then read /prisma/schema.prisma.

Expand dispatch_plans, dispatch_plan_vehicles, dispatch_plan_orders from stubs.

dispatch_plans:
  id, planRef, slotId, date, status (draft|confirmed|dispatched), createdById, createdAt, updatedAt
  relations: vehicles[], orders[], planOrders[]

dispatch_plan_vehicles:
  id, planId, vehicleId, driverName, driverPhone, assignedAt
  relations: plan, vehicle

dispatch_plan_orders:
  id, planId, orderId (nullable), splitId (nullable), sequence, addedById, addedAt
  NOTE: Either orderId OR splitId — dispatch happens per split for tint orders

Run: npx prisma validate
Run: npx tsc --noEmit
Report: confirm both pass clean.
```

SQL to run in Supabase after schema update: (generate from prisma diff)

## STEP 37 — Dispatcher screen

```
Read CLAUDE_CONTEXT.md and CLAUDE_UI.md fully.

Build /app/(dispatcher)/dispatcher/page.tsx

Screen shows orders/splits with dispatchStatus = 'dispatch' that are not yet
on a dispatch plan.

Features:
- Filter by slot, route, delivery type
- Group by slot → show orders/splits per slot
- Vehicle sizing indicator (L1 rule: ≤900kg = Light, 901-2000kg = Medium, >2000kg = Heavy)
- "Create Plan" → groups selected orders into a dispatch_plan
- Assign vehicle to plan
- Confirm plan → moves orders/splits to dispatch_confirmation stage

API routes needed:
  GET  /api/dispatcher/queue        — Orders/splits ready for dispatch
  POST /api/dispatcher/plans        — Create dispatch plan
  POST /api/dispatcher/plans/[id]/confirm — Confirm plan
  GET  /api/dispatcher/vehicles     — Available vehicles

requireRole(['Dispatcher', 'Admin'])
Run: npx tsc --noEmit — fix all errors.
```

## STEP 38 — Hold queue for dispatcher

```
Read CLAUDE_CONTEXT.md fully.
Then read: app/api/support/orders/[id]/route.ts

When Support sets dispatchStatus = 'hold' on an order/split that is already
on a dispatch plan, a dispatch_change_queue row must be written.

Build: app/api/dispatcher/hold-queue/route.ts
  GET — returns all dispatch_change_queue rows for open plans
  PATCH /[id] — mark as acknowledged (removes from queue)

Add hold queue notification to dispatcher screen — shows count badge.

Run: npx tsc --noEmit — fix all errors.
```

---

# PHASE 5 — WAREHOUSE EXECUTION (⏳ Not started)

## STEP 43 — Schema v14: Expand pick_lists

```
Read CLAUDE_CONTEXT.md fully. Then read /prisma/schema.prisma.

Expand pick_lists and pick_list_items from stubs.

pick_lists:
  id, planId, orderId (nullable), splitId (nullable), status, assignedPickerId,
  supervisorId, createdAt, updatedAt

pick_list_items:
  id, pickListId, skuCode, description, requiredQty, pickedQty, status, note

Run: npx prisma validate + npx tsc --noEmit
```

## STEP 44 — Floor Supervisor screen

Built after dispatch planning is complete.
Shows all active pick lists. Assigns pickers. Verifies material.

## STEP 45 — Picker screen

Built after supervisor screen.
Picker sees only their assigned pick lists.
Mark items as picked. Flag discrepancies.

---

# UTILITY PROMPTS

## Fix TypeScript errors (run anytime)

```
Read CLAUDE_CONTEXT.md fully.
Run: npx tsc --noEmit
Fix every error found. Do not leave any TypeScript errors.
Report: total errors before + after (must be 0). Files changed.
```

## Fix hydration errors

```
Find the component causing the hydration mismatch.
Add suppressHydrationWarning to any element that renders time/date values
that differ between server and client render.
Example: <span suppressHydrationWarning>{timeString}</span>
Run: npx tsc --noEmit — confirm no errors introduced.
```

## Clear test data (Supabase SQL)

```sql
DELETE FROM split_status_logs;
DELETE FROM split_line_items;
DELETE FROM order_splits;
DELETE FROM import_enriched_line_items;
DELETE FROM import_obd_query_summary;
DELETE FROM order_status_logs;
DELETE FROM tint_assignments;
DELETE FROM tint_logs;
DELETE FROM orders;
DELETE FROM import_raw_line_items;
DELETE FROM import_raw_summary;
DELETE FROM import_batches;
```

## Run PowerShell OBD merger

```powershell
cd "C:\Users\HP\OneDrive\Orbit OMS\OBD-Tools"
Unblock-File -Path ".\Merge-OBD-Files.ps1"
.\Merge-OBD-Files.ps1
```

## Verify split data in Supabase

```sql
-- All splits
SELECT id, "splitNumber", status, "dispatchStatus", "totalQty", "articleTag", "completedAt"
FROM order_splits ORDER BY id DESC LIMIT 10;

-- Split line items
SELECT sl."splitId", sl."rawLineItemId", sl."assignedQty"
FROM split_line_items sl ORDER BY id DESC LIMIT 20;

-- Split audit trail
SELECT * FROM split_status_logs ORDER BY id DESC LIMIT 10;

-- Article data verification
SELECT "obdNumber", "lineId", "article", "articleTag"
FROM import_raw_line_items ORDER BY id DESC LIMIT 20;

-- OBD summary
SELECT "obdNumber", "totalArticle", "articleTag"
FROM import_obd_query_summary ORDER BY id DESC LIMIT 10;
```