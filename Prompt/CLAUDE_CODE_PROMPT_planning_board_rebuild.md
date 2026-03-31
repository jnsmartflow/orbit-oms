# Claude Code Prompt — Dispatcher Planning Board Rebuild

## Pre-flight

Read `CLAUDE_CONTEXT_v28.md` fully before doing anything else. Pay special attention to:
- Section 17.1: Dispatcher Planning Board design (LOCKED)
- Section 33: Planning Board UI Components
- Section 34: Implementation Plan
- Section 35: Schema Correction (order-level, not split-level)

---

## Task

Rebuild the Planning Board UI at `/planning` to match the locked v8 design. The current v27 components do NOT match the design and need full replacement.

---

## Reference

HTML mockup: `docs/mockups/planning-board-dispatcher-APPROVED.html` — open this file and match the design exactly.

Key design decisions:
1. **Calm, neutral design** — gray/white base, color only for urgent/action items
2. **Two-column layout** — Left: Unassigned (300px fixed), Right: Trips (flex)
3. **Auto Draft prominent** — Indigo button at top of Unassigned panel
4. **Grouping filters** — None / Route / Area / Priority toggle buttons
5. **Customer pills** — 3 rows inside trip cards
6. **Collapsible trips** — Draft expanded, Confirmed collapsed
7. **Route in trip header** — Area in customer pill

---

## Step 1: Update API response

File: `app/api/planning/board/route.ts`

Add to the orders query (inside customer include):
```typescript
customer: {
  select: {
    id: true,
    shipToName: true,
    customerRating: true,  // for Key star (rating = 'A')
    area: {
      select: {
        id: true,
        name: true,
        primaryRoute: {
          select: {
            id: true,
            name: true
          }
        }
      }
    }
  }
}
```

Add to order select:
```typescript
hasTinting: true  // if this field exists, else derive from splits
```

---

## Step 2: Create new components

Delete all existing files in `components/planning/` and create fresh:

Before writing any component, run:
view docs/mockups/planning-board-dispatcher-APPROVED.html

Study the HTML structure, classes, and layout. Match it exactly.

### 2.1 `components/planning/planning-page.tsx`

Main page component. Fetches data, manages state, renders layout.

```typescript
'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { PlanningHeader } from './planning-header'
import { DeliveryTabs } from './delivery-tabs'
import { SlotBar } from './slot-bar'
import { UnassignedPanel } from './unassigned-panel'
import { TripsPanel } from './trips-panel'
import { DetailPanel } from './detail-panel'

// Types
interface Customer {
  id: string
  shipToName: string
  customerRating: string | null
  area: {
    id: number
    name: string
    primaryRoute: {
      id: number
      name: string
    } | null
  } | null
}

interface Order {
  id: string
  obdNumber: string
  totalWeight: number
  totalQty: number
  totalArticle: number
  articleTag: string
  priorityLevel: number
  hasTinting: boolean
  isPicked: boolean
  customer: Customer | null
  dispatchPlan: { id: string; tripNumber: number } | null
  splits: { id: string; isPicked: boolean }[]
}

interface Slot {
  id: number
  name: string
  cutoffTime: string
}

interface Plan {
  id: string
  tripNumber: number
  status: string
  vehicleId: string | null
  vehicle: { vehicleNo: string; category: string } | null
  totalWeightKg: number
  orders: Order[]
}

// State
export function PlanningPage() {
  const { data: session } = useSession()
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [deliveryType, setDeliveryType] = useState('Local')
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
  const [grouping, setGrouping] = useState<'none' | 'route' | 'area' | 'priority'>('route')
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set())
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)
  
  const [orders, setOrders] = useState<Order[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [loading, setLoading] = useState(true)

  const role = session?.user?.role || ''
  const canManagePlan = ['dispatcher', 'admin'].includes(role)
  const canPick = ['floor_supervisor', 'admin'].includes(role)

  // Fetch data
  useEffect(() => {
    fetchData()
  }, [selectedDate, deliveryType])

  async function fetchData() {
    setLoading(true)
    try {
      const res = await fetch(`/api/planning/board?date=${selectedDate.toISOString()}&deliveryType=${deliveryType}`)
      const data = await res.json()
      setOrders(data.orders || [])
      setPlans(data.plans || [])
      setSlots(data.slots || [])
    } catch (err) {
      console.error('Failed to fetch planning data', err)
    }
    setLoading(false)
  }

  // Derived data
  const unassignedOrders = orders.filter(o => !o.dispatchPlan)
  const stats = {
    customers: new Set(orders.map(o => o.customer?.id)).size,
    obds: orders.length,
    trips: plans.length
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-[13px] text-gray-600">
      <PlanningHeader 
        date={selectedDate}
        onDateChange={setSelectedDate}
        onRefresh={fetchData}
        stats={stats}
      />
      
      <div className="bg-white border-b border-gray-200 px-5 py-3">
        <DeliveryTabs 
          active={deliveryType} 
          onChange={setDeliveryType}
          counts={{ Local: 8, Upcountry: 4, IGT: 0, Cross: 0 }} // TODO: from API
        />
        <SlotBar 
          slots={slots}
          selected={selectedSlot}
          onSelect={setSelectedSlot}
        />
      </div>

      <div className="flex h-[calc(100vh-140px)]">
        <UnassignedPanel
          orders={unassignedOrders}
          grouping={grouping}
          onGroupingChange={setGrouping}
          selectedOrders={selectedOrders}
          onSelectionChange={setSelectedOrders}
          onOrderClick={setDetailOrder}
          onCreateTrip={() => {/* TODO */}}
          onAddToTrip={() => {/* TODO */}}
          onAutoDraft={() => {/* TODO */}}
          canManagePlan={canManagePlan}
        />
        
        <TripsPanel
          plans={plans}
          onOrderClick={setDetailOrder}
          onConfirm={() => {/* TODO */}}
          onDispatch={() => {/* TODO */}}
          canManagePlan={canManagePlan}
          canPick={canPick}
        />
      </div>

      {detailOrder && (
        <DetailPanel
          order={detailOrder}
          onClose={() => setDetailOrder(null)}
          onRemoveFromTrip={() => {/* TODO */}}
          canPick={canPick}
        />
      )}
    </div>
  )
}
```

### 2.2 `components/planning/planning-header.tsx`

Simple header with date, refresh, stats.

### 2.3 `components/planning/delivery-tabs.tsx`

Underline-style tabs (not pills). Active = dark text + border-b-2.

### 2.4 `components/planning/slot-bar.tsx`

Horizontal slot cards. Only urgent (< 30 min) gets red. Others neutral.

### 2.5 `components/planning/unassigned-panel.tsx`

Left panel with:
- Auto Draft button (prominent, indigo)
- Grouping filters (None/Route/Area/Priority)
- Customer list (grouped when grouping selected)
- Selection footer with Create Trip + Add to Trip

### 2.6 `components/planning/customer-card.tsx`

Card for unassigned list:
- Priority dot + Key star + Name
- Area + OBD count
- Weight
- Checkbox for selection

### 2.7 `components/planning/trips-panel.tsx`

Right panel listing all trips.

### 2.8 `components/planning/trip-card.tsx`

Collapsible card:
- Header: Trip # + Status + Route badge + Vehicle + Weight + Customer count + Chevron
- Body (when expanded): Customer pills grid
- Footer: Picked count + Confirm/Dispatch button

### 2.9 `components/planning/customer-pill.tsx`

3-row pill inside trip:
- Row 1: Priority dot + Name + Key star + Pick status (amber dot or gray check)
- Row 2: OBDs · Weight (bold) · Units
- Row 3: Area + Tinting badge if applicable

### 2.10 `components/planning/detail-panel.tsx`

Slide-in panel from right:
- Customer info
- Stats (kg, OBDs, units)
- Tinting alert if applicable
- OBD list with pick status
- Remove from Trip button

---

## Step 3: Update page

File: `app/planning/page.tsx`

```typescript
import { PlanningPage } from '@/components/planning/planning-page'

export const dynamic = 'force-dynamic'

export default function Page() {
  return <PlanningPage />
}
```

---

## Step 4: Styling guidelines

Follow these exactly:

| Element | Style |
|---|---|
| Background | `bg-[#f8f9fa]` |
| Cards | `bg-white rounded-lg border border-gray-200` |
| Text primary | `text-gray-800` or `text-gray-700` |
| Text secondary | `text-gray-500` or `text-gray-400` |
| Text muted | `text-gray-300` |
| Urgent slot | `bg-red-50 border-red-200` + `text-red-600` |
| Normal slot | `bg-white border-gray-200` |
| Auto Draft button | `bg-indigo-600 hover:bg-indigo-700 text-white` |
| Confirm button | `bg-gray-800 hover:bg-gray-900 text-white` |
| Dispatch button | `bg-green-600 hover:bg-green-700 text-white` |
| Route badge | `text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded text-[9px]` |
| Tinting badge | `text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded text-[9px]` |
| Priority P1 | `bg-red-400` (small dot) |
| Priority P2 | `bg-amber-400` (small dot) |
| Priority P3 | `bg-gray-300` (small dot) |
| Pick pending | `bg-amber-400` (small dot on right) |
| Picked | Gray checkmark icon |
| Key customer | `★` in `text-amber-500` |

---

## Step 5: Test

1. `npx tsc --noEmit` — must pass with zero errors
2. `npm run dev` — test on localhost
3. Verify:
   - Calm, neutral appearance
   - Only urgent slot has red
   - Auto Draft is prominent
   - Grouping works
   - Draft trips expanded, Confirmed collapsed
   - Customer pills show 3 rows
   - Detail panel slides in/out

---

## Constraints

- Do NOT change API routes (they work)
- Do NOT change database schema
- Do NOT introduce new libraries
- Match HTML mockup v8 exactly
- Keep role-based rendering (canManagePlan, canPick)

---

## Deliverables

1. All new component files in `components/planning/`
2. Updated `app/planning/page.tsx`
3. Updated `app/api/planning/board/route.ts` (add customer.area, customerRating)
4. Zero TypeScript errors
5. Working localhost preview

---

## After completion

Report:
- Files created/modified
- Any issues encountered
- Screenshot of working page (if possible)
