# SUPPORT_QUEUE_REDESIGN_v11.md
# Support Queue UI Redesign — Final Approved Mockup v11
# Use this file as the design spec for implementation

---

## 1. Overview

Redesign the Support Queue UI (3 component files only). All API routes and business logic are complete and working — DO NOT touch any API files or support-page-content.tsx orchestrator logic.

**Files to modify:**
- `components/support/support-left-nav.tsx` → DELETE (replaced by new layout)
- `components/support/support-orders-table.tsx` → REWRITE completely
- `components/support/cancel-order-dialog.tsx` → minor styling update
- `components/support/support-page-content.tsx` → UPDATE layout structure (remove left nav, add main tabs + sub tabs), keep all state/handler logic

**Files NOT to touch:**
- `app/api/support/**` — all API routes
- `components/shared/customer-missing-sheet.tsx`

---

## 2. Layout Structure — 3-Zone Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠ Overdue (3)  │  📋 Today (42)  │  ⏸ Hold (4)          │  ← Main tabs (NOT dark/black — use white bg with colored accents)
├─────────────────────────────────────────────────────────────┤
│  ● Morning ✓  │  ● Afternoon 08:24  │  ● Evening  │  ● Night │  ← Sub tabs (only in Today view)
├─────────────────────────────────────────────────────────────┤
│  [Submit Selected] [Select All]  stats  [Group by ▾] [Export] [Search] │  ← Action bar
├─────────────────────────────────────────────────────────────┤
│  ▾ Retail Offtake  6 pending · 2 dispatched                │  ← SMU group header (collapsible)
│    row row row row row row                                  │  ← Pending rows (editable)
│    row row (dimmed, DISPATCHED tag)                         │  ← Dispatched rows inline
│  ▾ Decorative Projects  2 pending · 2 tinting              │
│    row row                                                  │  ← Pending rows
│    row row (dimmed, TINTING tag)                            │  ← Tinting rows inline
│                                                             │
│  ┌─────────────────────────────────────────────┐            │
│  │  2 Selected  [Set: Dispatch] [Set: Hold]... │            │  ← Floating bulk bar (bottom)
│  └─────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

### Zone 1: Overdue Tab
- Full page for previous-day leftover orders
- Sub-tabs: All | Yesterday | 2+ Days
- Same table structure with inline editable dropdowns
- Age pills in red (pulsing for 1d+)
- OBD dates shown in red color

### Zone 2: Today Tab (default active)
- Sub-tabs: Morning | Afternoon | Evening | Night (4 fixed slots from slot_master)
- Each sub-tab shows: countdown timer, pending/done counts
- Table grouped by SMU with collapsible headers
- Dispatched and tinting rows stay in table (dimmed, with status tag instead of dropdown)
- "Held today" reference rows (orders held today in this slot) also shown dimmed

### Zone 3: Hold Tab
- Full page backlog of ALL held orders (can sit for days)
- Sub-tabs: All | Today | 1-2 Days | 3+ Days
- Table shows: OBD, Customer, Route, Qty, Original Slot, On Hold duration, Reason
- Actions: Release + Cancel per row
- Bulk: Release Selected

---

## 3. Table Design — Compact Merged Columns

### Column structure (6 data + 4 editable = 10 columns):

| Column | Content | Width |
|--------|---------|-------|
| Checkbox | Select for bulk | 36px |
| OBD / Date | OBD number (mono bold) on top, "29 Mar · 08:12" below in gray | auto |
| Customer | Customer name (bold) on top, SH-XXXXX below in mono gray. ⚠ Missing badge if applicable | auto |
| Route / Type | Route name on top, Local/Upcountry pill below | auto |
| Qty | Qty number (mono bold) + TINT/NON pill next to it | 80px center |
| Age | Age pill: green (fresh <1h), amber (1h-24h), red (24h+) | 60px center |
| Dispatch ★ | Dropdown: Dispatch (green) / Hold (red) / Cancel (gray). ★ = editable header color | 120px |
| Priority ★ | Dropdown: FIFO (default) / Urgent (red) / High (amber) | 100px |
| Ship Override ★ | Text showing override address or "—", + ✎ pencil icon button | 140px |
| Slot ★ | Dropdown: — / Morning / Afternoon / Evening / Night | 100px |

### Row states:
- **Pending** — full row, all dropdowns active, checkbox enabled
- **Dispatched** — dimmed (opacity 0.45), "DISPATCHED" green tag in Dispatch column, no dropdowns, checkbox disabled
- **Tinting** — dimmed (opacity 0.45), "TINTING" purple tag in Dispatch column, no dropdowns, checkbox disabled
- **Changed** — subtle indigo background tint when any dropdown is modified

### Row height: 56px
### No zebra striping — clean white rows
### Table wrapped in white card with rounded corners (12px) and subtle border

---

## 4. Main Tab Bar Design

**IMPORTANT: NOT dark/black background.**
Use white background with bottom border. Active tab has colored bottom border accent.

```
┌───────────────────────────────────────────────────────────┐
│  ⚠ Overdue [3]  │  📋 Today [42]  │  ⏸ Hold [4]         │
└───────────────────────────────────────────────────────────┘
```

- White/light background
- Tab text: font-weight 700, color var(--t2) inactive, var(--t1) active
- Overdue tab: red accent when active, red badge count
- Today tab: indigo accent when active, indigo badge count
- Hold tab: amber accent when active, amber badge count
- Active tab: colored bottom border (2.5px)
- Icons: small SVG icons before tab name

---

## 5. Sub Tab Bar (Slot Tabs — Today only)

Below main tabs, only visible when Today is active.

Each slot tab shows:
- Colored dot (orange Morning, blue Afternoon, purple Evening, green Night)
- Slot name
- Countdown timer (mono font, color-coded: green >3h, amber 1-3h, red <1h pulsing, gray "✓ Done" if past)
- Small meta text: "8 pend · 2 done"

Active sub-tab: colored bottom border matching slot color.

---

## 6. Action Bar

Single row with:
- **Submit Selected** button (indigo, disabled when nothing selected)
- **Select All** button (outlined)
- Separator
- Stat pills: "8 pending" (amber) · "2 done" (green) · "2 tinting" (purple)
- Spacer
- **Group by** dropdown: SMU (default) | Route | Del. Type | Customer | None
- Separator
- **Export** button (outlined, download icon)
- **Search** input field

---

## 7. SMU Group Headers

Collapsible rows spanning full table width:
- Chevron icon (rotates on collapse)
- Group name: "Retail Offtake" (bold)
- Count text: "6 pending · 2 dispatched" (gray)

Click to collapse/expand all rows in that group.

---

## 8. Floating Bulk Action Bar

When 2+ checkboxes are selected, a dark floating bar slides up from the bottom center of the table card:

- Dark background (#1c1e30), white text, rounded (12px), shadow
- Shows: "N Selected"
- Buttons: Set: Dispatch | Set: Hold | Set: Cancel
- Separator
- Priority dropdown, Slot dropdown (for bulk set)
- ✕ close button

---

## 9. Editable Dropdown Styling

All editable dropdowns:
- Height: 30px, border-radius: 6px
- Default: white bg, subtle border (#ededf3)
- Custom SVG chevron arrow
- On hover: slightly darker border
- On focus: indigo border + subtle shadow

**Dispatch Status colors:**
- Dispatch selected → green bg, green text, green border
- Hold selected → red bg, red text, red border
- Cancel selected → gray bg, gray text

**Priority colors:**
- FIFO → default (no color)
- Urgent → red bg, red text
- High → amber bg, amber text

**Slot when set:**
- Has value → indigo text, indigo border

---

## 10. Status Tags (for dispatched/tinting rows)

Replace dropdowns with status tags:
- **DISPATCHED**: green bg, green text, green border, small green dot before text
- **TINTING**: purple bg, purple text, purple border, small purple dot before text
- **HELD**: amber bg, amber text (for "held today" reference rows in slot view)

Font: 9px, weight 700, uppercase, padding 4px 10px, border-radius 5px

---

## 11. Ship-To Override

In the table row:
- Shows "—" (gray) if no override
- Shows override text in amber + bold if set (e.g., "Site B — Ring Rd")
- Small pencil (✎) icon button to the right

Clicking ✎ opens a modal (not side panel) with:
- Override Type dropdown: No override / Different customer / Different area+route / Free-text
- Conditional fields based on type
- Reason textarea
- Cancel + Save buttons

---

## 12. Detail Panel (Side Panel on Row Click)

Clicking any row body (not dropdowns/checkboxes) opens a right slide-in panel (380px):
- Header: OBD number in indigo chip + close button
- Sections: Order Details, Line Items, Audit History
- Each section has gray uppercase title

This uses existing data from the SupportOrder type — no new API needed.

---

## 13. Cancel Flow

When user selects "Cancel" in Dispatch Status dropdown:
- Cancel confirmation modal opens (reuse CancelOrderDialog)
- Requires reason selection + optional notes
- On confirm: order is cancelled

---

## 14. Color Palette

```css
--bg: #f5f6fa        /* page background */
--surface: #ffffff    /* cards, table */
--border: #ededf3     /* subtle borders */
--t1: #1c1e30         /* primary text */
--t2: #5a5d74         /* secondary text */
--t3: #8e91a7         /* tertiary text */
--tm: #c2c4d6         /* muted text */
--green: #10b981      /* dispatched, done */
--amber: #f59e0b      /* hold, high priority, age hours */
--red: #ef4444        /* overdue, urgent, cancel */
--purple: #8b5cf6     /* tinting */
--indigo: #6366f1     /* primary action, selected, editable headers */
```

---

## 15. Typography

- **UI font**: Plus Jakarta Sans (already loaded in the app)
- **Mono font**: JetBrains Mono — for OBD numbers, dates, times, quantities, countdowns, age pills
- **No Inter, no system fonts**

---

## 16. Fonts Loading

Add to `app/layout.tsx` or `globals.css` if not already present:
```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');
```

Plus Jakarta Sans should already be loaded. Verify.

---

## 17. Hold Tab — Table Columns

| Column | Content |
|--------|---------|
| Checkbox | For bulk release |
| OBD / Date | Same merged format |
| Customer | Same merged format |
| Route / Type | Same merged format |
| Qty | Number only |
| Original Slot | Which slot the order was in when held (text) |
| On Hold | Duration pill: amber (<24h), red (24h+) |
| Reason | Italic gray text (hold reason from order_status_logs) |
| Actions | Release (green btn) + Cancel (✕ ghost btn) |

---

## 18. Overdue Tab — Table Columns

Same as Today's table columns (OBD/Date, Customer, Route/Type, Qty, Age, Dispatch★, Priority★, Ship Override★, Slot★) but:
- Date shown in red color (since it's a previous day)
- Age pills always red/pulsing
- No SMU grouping (flat list)
- Sub-tabs filter by date: All | Yesterday | 2+ Days

---

## 19. API Changes Needed

**None for UI redesign.** All existing API routes work as-is.

However, the following data may need to be added to API responses:
- `holdDuration` — calculated from when dispatchStatus was set to 'hold' (from order_status_logs)
- `holdReason` — from order_status_logs notes field when action was hold
- These can be added later as enhancements

---

## 20. Implementation Notes

- support-page-content.tsx needs layout restructure: remove SupportLeftNav, add main tab state + sub tab state
- The "section" parameter to fetchOrders API already supports: overdue, hold, slot (with slotId)
- Group-by is client-side only — sort/group the orders array by SMU/route/type/customer
- Countdown timers: reuse existing computeCountdown logic from current support-left-nav.tsx
- Floating bulk bar: absolute positioned inside table card container
- All existing action handlers (dispatch, hold, release, cancel, assignSlot, bulk) remain unchanged
