# Support Page Visual Redesign — Claude Code Prompt
# Read CLAUDE_CONTEXT_v34.md fully before doing anything else.
# Reference mockup: docs/mockups/support-mockup-v9.html
# Model: Opus (complex UI overhaul, multi-file)

---

## Goal

Redesign the Support page (`/support`) to match the locked v9 mockup design.
This is a VISUAL + UX overhaul — changes to layout, input patterns, tabs, and styling.
Business logic, API routes, and data flow stay the same.

**Read every file fully before making any changes.**

---

## Reference: Current vs New

### Current (live):
- Tabs: Overdue | Today (count) | Hold
- Slot bar: colored dots per slot, inline text
- Action bar: green "Submit Selected" button at top + "Select All" + stats
- Table: dropdowns for Dispatch, Priority, Ship Override, Slot on every row
- Cascade badge: boxed green "from Morning" with icon
- Delivery type: colored pills (green "Local", blue "Upcountry")

### New (v9 mockup):
- Top-level tabs: All (count) | Hold (count) — underline style
- Status filter pills: All | Pending | Dispatch | Dispatched — rounded pill style with counts
- Slot bar: compact pills (done=gray+check, active=dark border, counts spelled out)
- Toolbar: Select All (left) | Group by + Export + Search (right)
- Table: clickable badges for Dispatch + Priority (popover on click), slot pill dropdown on pending rows only, plain text on resolved rows
- Cascade: `↻ Afternoon` in gray-400, tight below slot
- Delivery type: plain text (no colored pills)
- Volume column instead of Qty (renamed, right-aligned)
- No Ship Override column (moved to detail drawer)
- Sticky bottom bar: appears on selection — "X selected · Y qty · Z customers" + Clear + "Submit X Orders"
- Dispatched rows: faded (opacity-35), no interactive elements

---

## Structural Changes

### 1. Top-level tabs: Replace Overdue/Today/Hold with All/Hold

**Current:** Three tabs — Overdue, Today (with count), Hold
**New:** Two tabs — All (with count), Hold (with amber count)

- "All" shows everything for today (replaces "Today")
- "Hold" shows dedicated hold follow-up view
- "Overdue" is removed — cascade + date picker handle this
- Use underline tab style matching Planning/Warehouse boards

### 2. Status filter pills (NEW — inside All tab only)

Add a row of rounded filter pills below the tabs:
- `All {total}` — default active, dark border + dark count
- `● Pending {count}` — gray dot, filters to dispatch status unset
- `● Dispatch {count}` — green dot, filters to dispatch status = dispatch
- `✓ Dispatched {count}` — green check, filters to dispatched orders

These are CLIENT-SIDE filters on the already-fetched data.
Active pill gets dark border + white count on dark bg.
Inactive pills get gray border + gray count.

### 3. Slot bar redesign

Replace current colored-dot slot bar with compact pills:
- Height: 28px, border-radius: 6px, font-size: 12px
- Done slots: gray-50 bg, gray border, gray check icon + name
- Active slot: dark border, dark text, shows "61 pending · 5 done" (spelled out)
- Normal slot: white bg, gray border, count
- Same data, just restyled

### 4. Remove "Submit Selected" from top → Sticky bottom bar

**Remove:** Green "Submit Selected" button from action bar, colored stats dots
**Add:** Sticky bottom bar (fixed to bottom, above page content):
- Only visible when rows are selected (transform translateY animation)
- Left: "X selected" (bold) + "Y qty · Z customers" (gray)
- Right: "Clear" (gray text) + "Submit X Orders" (indigo-600 button)
- White bg, top border, upward shadow

### 5. Toolbar simplification

Keep: Select All (left), Group by dropdown, Export button, Search input (right)
Remove: Stats display (61 pending · 5 done · 0 tinting) — moved to header
The stats now live in the page header on the right side.

### 6. Table columns change

**Remove:** Ship Override column, Qty column header star markers
**Rename:** QTY → VOL (right-aligned, same data)
**Final columns:** checkbox | OBD/Date | Customer | Route/Type | Vol | Age | Dispatch | Priority | Slot

Grid template (use this exact CSS):
```css
grid-template-columns: 32px 120px minmax(140px, 1fr) minmax(80px, 0.6fr) 44px 36px 96px 68px minmax(100px, 0.7fr);
gap: 0 10px;
```

### 7. Dispatch/Priority: Dropdowns → Clickable badges with popover

**Current:** `<select>` dropdowns for Dispatch and Priority on every row
**New:** Colored badge pills that open a popover on click

#### Dispatch badge states:
- **Unset** (no status): `badge-unset` — gray-100 bg, gray-400 text, shows "—"
- **Dispatch**: `badge-dispatch` — green-50 bg, green-600 text, green dot + "Dispatch"
- **Hold**: `badge-hold` — amber-50 bg, amber-600 text, amber dot + "Hold"
- **Dispatched**: `badge-dispatched` — emerald-50 bg, emerald-600 text, emerald dot + "Dispatched" (read-only)

#### Priority badge states:
- **FIFO**: `badge-fifo` — gray-50 bg, gray-500 text
- **P1**: `badge-p1` — red-50 bg, red-600 text
- **P2**: `badge-p2` — amber-50 bg, amber-600 text
- **P3**: `badge-p3` — gray-50 bg, gray-500 text

#### Popover behavior:
- Click badge → small dropdown appears below (position: absolute)
- Shows 2-4 options with colored dots
- Click option → badge updates, popover closes
- Click outside → popover closes
- Only one popover open at a time

#### For resolved rows (dispatch already set from import):
- Dispatch badge shown but slightly muted
- Priority shown as plain text (no badge) if FIFO, badge if P1/P2/P3
- Slot shown as plain text (no dropdown)
- Badges still clickable to change if needed

#### For dispatched rows:
- Dispatch badge shown as read-only (no popover)
- No priority, no slot
- Entire row at opacity-35
- No checkbox

### 8. Slot: Dropdown pill on pending, plain text on resolved

**Pending rows:** Slot shown as styled `<select>` with pill appearance:
- border-radius: 12px, height: 24px, font-size: 11px
- Standard select with custom chevron

**Resolved rows:** Slot shown as plain gray text "Night"
**Dispatched rows:** No slot shown

### 9. Cascade badge redesign

**Current:** Boxed green badge with icon "⏩ from Morning"
**New:** Simple gray text `↻ Afternoon` (or `↻ Evening` etc)

- Pending rows: `text-[10px] text-gray-400` below the slot dropdown, tight spacing (mt-px)
- Resolved rows: inline after slot text — "Night ↻ Aftn" in gray-300
- Only shown when originalSlotId !== slotId

### 10. Delivery type styling

**Current:** Colored pills — green "Local", blue "Upcountry"
**New:** Plain text — just "Local" or "Upcountry" in text-[10px] text-gray-400 below route name

### 11. Hold tab (dedicated view)

When Hold tab is active, show a different table layout:
- Columns: OBD/Date | Customer | Route/Type | Vol | Hold Since | Hold Reason | Actions
- Hold Since: duration badge (red for 2d+, amber for 1d)
- Hold Reason: text field (from order notes or a new field)
- Actions: "Release" (indigo text link) + "Cancel" (gray text link)
- No slot bar, no status filter pills in Hold view

### 12. Header stats

Move stats to header right side:
- "X Pending  Y Dispatched  Z Tinting | N OBDs"
- text-xs text-gray-400, counts in text-gray-600 font-medium

---

## Implementation Rules

1. **Read each file fully before editing**
2. **Change ONLY visual/UX** — no business logic changes
3. **No new npm packages**
4. **No schema changes**
5. **No API route changes** (data fetching stays the same)
6. **`npx tsc --noEmit` must pass clean after all changes**
7. **Keep all existing state management and data flow**
8. **Ship Override data still saved via existing API — just not shown in table (access via detail drawer)**

---

## Files to Change

| File | Scope |
|---|---|
| `components/support/support-orders-table.tsx` | Main component — all table rendering, badge components, popover logic, sticky bar, status filter pills |
| `app/support/page.tsx` | Page layout — tab structure (All/Hold), header stats |

**Before changing, read both files completely to understand current structure.**

---

## Implementation Order

1. Read both files fully
2. Update tab structure (All/Hold replacing Overdue/Today/Hold)
3. Add status filter pills (client-side filter)
4. Restyle slot bar to compact pills
5. Replace Dispatch/Priority dropdowns with badge + popover components
6. Update slot column (pill dropdown on pending, text on resolved)
7. Restyle cascade badge to `↻ SlotName`
8. Remove Ship Override column, rename Qty→Vol
9. Add sticky bottom bar (replace top Submit button)
10. Style delivery type as plain text
11. Update header stats
12. Style dispatched rows (faded)
13. Build Hold tab view
14. `npx tsc --noEmit` — must be clean
15. Test on localhost

---

## Constraints Reminder

- No `prisma db push`
- No `prisma.$transaction`
- `export const dynamic = 'force-dynamic'` on any API routes
- Tailwind + shadcn/ui only
- Desktop only (no mobile)
