# SUPPORT_QUEUE_IMPLEMENTATION_STEPS.md
# Step-by-step Claude Code prompts for implementing the Support Queue redesign
# Run each step in order. Wait for completion before running the next.

---

## PRE-WORK: Copy Files

Before starting Claude Code, manually:
1. Copy `SUPPORT_QUEUE_REDESIGN_v11.md` to your project root: `F:\Harsh Onedrive\OneDrive\VS Code\orbit-oms\`
2. Copy `support-queue-v11.html` to your project root as reference

---

## STEP 1: Read Context + Spec

```
Read CLAUDE_CONTEXT_v25.md fully. Then read SUPPORT_QUEUE_REDESIGN_v11.md fully. Confirm you understand both before proceeding. Do NOT write any code yet.
```

---

## STEP 2: Add JetBrains Mono Font

```
Check if JetBrains Mono font is loaded in the app. If not, add it to app/layout.tsx or globals.css. Also verify Plus Jakarta Sans is loaded. Run npx tsc --noEmit after.
```

---

## STEP 3: Restructure support-page-content.tsx Layout

```
Read SUPPORT_QUEUE_REDESIGN_v11.md Section 2 (Layout Structure) and Section 4 (Main Tab Bar).

Modify components/support/support-page-content.tsx:
- Remove the SupportLeftNav import and usage
- Add state: mainTab ('overdue' | 'today' | 'hold'), default 'today'
- Add state: activeSlotTab (number | null) — tracks which slot sub-tab is active within Today
- Keep ALL existing state, handlers, fetchSlots, fetchOrders, refresh logic unchanged
- Change the render layout to:
  1. Main tab bar (white bg, NOT dark) with 3 tabs: Overdue (red accent), Today (indigo accent), Hold (amber accent)
  2. Each tab shows badge count (overdueCount, total pending from all slots, holdCount)
  3. When Today is active: show slot sub-tabs below (from slots array)
  4. When Overdue is active: no sub-tabs, call fetchOrders with section='overdue'
  5. When Hold is active: no sub-tabs, call fetchOrders with section='hold'
  6. Below tabs: render SupportOrdersTable with new props for mainTab and activeSlotTab

Pass these new props to SupportOrdersTable:
- mainTab: string
- activeSlotTab: number | null (the slotId)

Keep all existing props (orders, section, onDispatch, onHold, etc.)

Important: The main tab bar should have WHITE background with light bottom border. Active tab has colored 2.5px bottom border. NOT dark/black.

Run npx tsc --noEmit after. There will be type errors from SupportOrdersTable — that's expected, we fix those in Step 4.
```

---

## STEP 4: Rewrite support-orders-table.tsx — Table Structure

```
Read SUPPORT_QUEUE_REDESIGN_v11.md Sections 3, 6, 7, 8, 9, 10, 11 fully.

Completely rewrite components/support/support-orders-table.tsx with the new design. This is a large file — take it step by step.

PART A — Props and Types:
- Accept all existing props from support-page-content.tsx (orders, section, onDispatch, onHold, etc.)
- Add new props: mainTab, activeSlotTab
- Keep SupportOrder type as-is

PART B — Table with merged columns:
- Checkbox column
- OBD / Date merged column (OBD mono bold on top, date+time gray below)
- Customer merged column (name bold on top, SH-ID mono gray below, ⚠ Missing badge if applicable)
- Route / Type merged column (route on top, Local/Upcountry pill below)
- Qty column (mono bold number + TINT/NON pill)
- Age column (calculated from createdAt, color-coded pill)
- Dispatch ★ dropdown (Dispatch/Hold/Cancel) — color changes on value change
- Priority ★ dropdown (FIFO/Urgent/High) — color changes on value change
- Ship Override ★ (text + ✎ button → opens ship-to modal)
- Slot ★ dropdown (—/Morning/Afternoon/Evening/Night)

PART C — Row states:
- Pending rows: all dropdowns active, checkbox enabled
- Dispatched rows: dimmed (opacity 0.45), show "DISPATCHED" green status tag instead of dropdown, checkbox disabled
- Tinting rows: dimmed, show "TINTING" purple status tag, checkbox disabled
- Changed rows: subtle indigo background when any dropdown modified

PART D — SMU Grouping:
- Group orders by querySnapshot SMU (or any field based on group-by selector)
- Render collapsible group headers with chevron, name, counts
- Group-by dropdown in action bar: SMU | Route | Del. Type | Customer | None

PART E — Action bar:
- Submit Selected button (indigo) — disabled when no selection
- Select All button
- Stat pills: N pending, N done, N tinting
- Group by dropdown
- Export button
- Search input

PART F — Floating bulk bar:
- Positioned absolute at bottom center of table card
- Shows when 2+ checkboxes selected
- Dark bg (#1c1e30), white text, rounded
- Buttons: Set Dispatch, Set Hold, Set Cancel
- Priority and Slot bulk dropdowns

PART G — Styling:
- Table inside white card with 12px border-radius, subtle border
- Row height 56px
- No zebra striping
- Editable column headers in indigo color
- Custom dropdown styling with SVG chevron
- Colors per SUPPORT_QUEUE_REDESIGN_v11.md Section 14

Keep the CancelOrderDialog and CustomerMissingSheet integrations as-is.

Run npx tsc --noEmit after.
```

---

## STEP 5: Hold Tab View

```
Read SUPPORT_QUEUE_REDESIGN_v11.md Section 17 (Hold Tab).

In support-orders-table.tsx, when mainTab === 'hold':
- Show hold-specific table with columns: Checkbox, OBD/Date, Customer, Route/Type, Qty, Original Slot, On Hold duration, Reason, Actions (Release + Cancel)
- Sub-tabs above table: All | Today | 1-2 Days | 3+ Days (client-side filter by hold duration)
- "Release Selected" as the submit button text instead of "Submit Selected"
- On Hold duration: calculate from order's updatedAt timestamp
- Reason: from order notes if available, otherwise show "—"
- Release button calls onRelease handler
- Cancel button opens CancelOrderDialog

Run npx tsc --noEmit after.
```

---

## STEP 6: Overdue Tab View

```
Read SUPPORT_QUEUE_REDESIGN_v11.md Section 18 (Overdue Tab).

In support-orders-table.tsx, when mainTab === 'overdue':
- Show same table structure as Today but:
  - No SMU grouping (flat list)
  - Date column text in red color
  - Age pills always red/pulsing style
  - Sub-tabs: All | Yesterday | 2+ Days (client-side filter by obdEmailDate)
  - Full editable dropdowns (Dispatch, Priority, Ship Override, Slot)
  
Run npx tsc --noEmit after.
```

---

## STEP 7: Detail Panel (Row Click)

```
In support-orders-table.tsx, add a right slide-in detail panel (380px width).

When user clicks a row body (not on dropdowns/checkboxes):
- Panel slides from right with semi-transparent overlay
- Shows: OBD number chip, close button
- Section 1 "Order Details": Customer, Ship-To ID, Route, Del Type, SMU, Qty, Weight, Tinting status
- Section 2 "Line Items": table with SKU, Description, Qty, Tint badge (if querySnapshot or enriched data available)
- Section 3 "Audit History": placeholder text for now (actual audit log API can be added later)

Close on overlay click or ✕ button.

Run npx tsc --noEmit after.
```

---

## STEP 8: Ship-To Override Modal

```
Create a new component: components/support/ship-to-override-modal.tsx

Props:
- open: boolean
- onOpenChange: (open: boolean) => void
- orderId: number | null
- obdNumber: string | null
- currentOverride: string | null
- onSave: (orderId: number, overrideData: ShipToOverrideData) => Promise<void>

ShipToOverrideData type:
- type: 'none' | 'customer' | 'area' | 'freetext'
- customerId?: number
- areaId?: number
- routeId?: number
- address?: string
- contactName?: string
- contactPhone?: string
- reason: string

UI: shadcn Dialog with:
- Override Type dropdown (conditional fields show/hide)
- Reason textarea
- Cancel + Save buttons

For now, the save handler can just call a placeholder — the actual ship-to override API route doesn't exist yet. Just wire the UI.

Run npx tsc --noEmit after.
```

---

## STEP 9: Cancel Dialog Styling Update

```
Read components/support/cancel-order-dialog.tsx.

Update styling to match the new design palette:
- Use indigo (#6366f1) for accents instead of [#1a237e]
- OBD chip: mono font, indigo bg
- Reason select and textarea: border-radius 7px, 1.5px border
- Buttons: rounded-lg
- Confirm button: red bg

Small changes only — keep all logic.

Run npx tsc --noEmit after.
```

---

## STEP 10: Final Verification

```
Run npx tsc --noEmit — must pass clean with zero errors.

Then verify:
1. All 3 main tabs render (Overdue, Today, Hold)
2. Today tab shows 4 slot sub-tabs with countdown timers
3. Table renders with merged columns and proper styling
4. Dropdowns change color on value change
5. Checkboxes trigger floating bulk bar
6. Submit Selected works
7. Row click opens detail panel
8. Ship Override ✎ opens modal
9. Cancel in dropdown opens cancel dialog
10. Customer Missing badge + sheet still works

List any issues found.
```

---

## STEP 11: Update CLAUDE_CONTEXT

```
Read CLAUDE_CONTEXT_v25.md. Update Section 16 (Support Queue) to reflect the new v11 design:
- 3-zone layout: Overdue / Today / Hold tabs
- Today has 4 slot sub-tabs
- Table with merged columns, SMU grouping, inline status tags
- Floating bulk bar
- Detail panel on row click
- Ship-to override modal
- Group-by selector

Update Section 22 (Folder structure) to add:
- components/support/ship-to-override-modal.tsx

Update Session checklist items as needed.

Save as CLAUDE_CONTEXT_v26.md. Draft starter prompt for next session.
```
