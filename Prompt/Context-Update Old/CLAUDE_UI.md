# CLAUDE_UI.md — Orbit OMS UI Design System
# Load alongside CLAUDE_CONTEXT.md for all UI implementation sessions.
# This is the SINGLE SOURCE OF TRUTH for visual styling across all screens.
# Version: v3 · Neutral Theme · April 2026

---

## 1. Design Philosophy

- **Neutral first.** White backgrounds, gray borders, minimal color. Color is reserved for semantic meaning only.
- **Match the Support board and TM v39 aesthetic.** All new screens and redesigns follow this palette.
- **The old indigo theme (#1a237e) is DEPRECATED.** Do not use indigo fills, indigo borders, or indigo text for buttons, cards, or filter controls. Only exception: semantic status colors that predate this guide (status popover priority/dispatch options).
- **Minimal chrome.** Maximize content area. Header + controls in 2 rows max. No stat cards unless explicitly requested.
- **Text hierarchy drives scannability.** Darkest = primary identifier, medium = data, lightest = context.

---

## 2. Color Palette — Neutral Theme

### Core colors (use everywhere)
| Token | Tailwind | Usage |
|---|---|---|
| Page background | `bg-white` | Body, page wrapper |
| Surface | `bg-gray-50` | Info grids, column backgrounds, input backgrounds |
| Border default | `border-gray-200` | Cards, dividers, inputs, table rows |
| Border hover | `border-gray-300` | Card hover, input focus |
| Border active | `border-gray-900` | Active filter pill, active slot, active toggle |
| Text primary | `text-gray-900` | Customer names, headings, active states |
| Text secondary | `text-gray-600` | SMU, articles, volume, operator names, data values |
| Text muted | `text-gray-400` | Timestamps, slots, dates, labels, placeholders |
| Text hint | `text-gray-300` | Placeholder text, disabled states |

### Semantic colors (use only for meaning)
| Purpose | Background | Border | Text |
|---|---|---|---|
| Urgent priority | `bg-red-50` | `border-red-200` | `text-red-600` |
| Normal priority | `bg-gray-50` | `border-gray-200` | `text-gray-500` |
| Done / Dispatch | `bg-green-50` | `border-green-200` | `text-green-700` |
| Hold | `bg-red-50` | `border-red-200` | `text-red-700` |
| Waiting | `bg-amber-50` | `border-amber-200` | `text-amber-700` |
| Customer Missing | — | — | `text-amber-500` (icon only) |
| Split indicator | — | — | `text-amber-600` (text only) |
| Split badge | `bg-purple-50` | `border-purple-200` | `text-purple-700` |
| SMU badge (table) | plain text | — | `text-gray-600 font-medium` |
| Active status | `bg-green-50` | `border-green-200` | `text-green-700` |
| Inactive status | `bg-gray-50` | `border-gray-200` | `text-gray-500` |

### Delivery type dot colors
| Type | Tailwind | Hex |
|---|---|---|
| Local | `bg-blue-600` | #2563eb |
| Upcountry (UPC) | `bg-orange-600` | #ea580c |
| IGT | `bg-teal-600` | #0d9488 |
| Cross Depot | `bg-rose-600` | #e11d48 |
| Unknown/null | no dot shown | — |

Dot size: 5px (`w-[5px] h-[5px] rounded-full`). Placed before OBD number in both card and table views.

### Tinter type dot colors (TI Report)
| Type | Tailwind |
|---|---|
| TINTER | `bg-blue-600` |
| ACOTONE | `bg-orange-500` |

Same 5px dot pattern. Placed before OBD number in TI Report table.

### Operator avatar colors
| Stage | Color |
|---|---|
| Assigned | `bg-gray-700` |
| In Progress | `bg-gray-700` |
| Completed | `bg-green-600` |

### Column header dots (kanban)
| Column | Color |
|---|---|
| Pending | `bg-amber-500` (or stage-specific) |
| Assigned | `bg-blue-500` |
| In Progress | `bg-purple-500` |
| Completed | `bg-green-500` |

These are the ONLY non-semantic colors allowed. 6px dots in column headers for visual identification only.

---

## 3. Typography

| Element | Classes |
|---|---|
| Page title | `text-[14px] font-semibold text-gray-900` |
| Inline stats (header) | `text-[11px] text-gray-400` with `text-gray-900 font-semibold` for numbers |
| Card customer name | `text-[13.5px] font-bold text-gray-900` |
| Card info grid label | `text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400` |
| Card info grid value | `text-[12px] font-semibold text-gray-600` |
| OBD code (card) | monospace, `text-[10.5px] text-gray-800` (or purple mono if existing convention) |
| OBD code (table) | `font-mono text-[11px] text-gray-800` |
| Table header | `text-[10px] font-medium text-gray-400 uppercase tracking-wider` |
| Table data (primary) | `text-[11px] text-gray-900 font-medium` (customer name) |
| Table data (secondary) | `text-[11px] text-gray-600` (SMU, articles, volume, operator) |
| Table data (muted) | `text-[11px] text-gray-400` (slot, time, date) |
| Badge text | `text-[10.5px] font-semibold` |
| Button text | `text-[11px] font-medium` (table) or `text-[12px] font-semibold` (card) |
| Section header | `text-[13px] font-semibold text-gray-900` |
| Section volume | `text-[13px] font-semibold text-gray-700` (right-aligned) |
| Timestamp / clock | `text-[11px] text-gray-400` |

### Text color hierarchy (table view)
| Priority | Color | Examples |
|---|---|---|
| Darkest | `text-gray-900 font-medium` | Customer name |
| Dark | `text-gray-800 font-mono` | OBD number |
| Medium | `text-gray-600` | SMU, Articles, Volume, Operator name |
| Light | `text-gray-400` | Slot, Time, Date, Priority "Normal" |
| Semantic | red/amber/green/purple | Urgent, Missing, Done, Split |

---

## 4. Borders & Spacing

| Element | Classes |
|---|---|
| Card border | `border border-gray-200 rounded-lg` |
| Card hover | `hover:border-gray-300` |
| Card padding | `p-[10px_12px]` or `px-3.5 pt-3 pb-3` |
| Column container | `bg-gray-50 border border-gray-200 rounded-lg` |
| Column header | `bg-white border-b border-gray-200 px-[14px] py-[10px]` |
| Info grid | `bg-gray-50 border border-gray-200 rounded-md p-[7px_10px]` |
| Modal border | `border border-gray-200 rounded-lg` |
| Table row | `border-b border-gray-50 hover:bg-gray-50/50` |
| Table header row | `border-b border-gray-100` |
| Table wrapper | `rounded-lg border border-gray-200 overflow-hidden` with `px-4 py-3` outer spacing |
| Section divider | `border-b border-gray-200` |
| Dropdown panel | `border border-gray-200 rounded-lg shadow-lg` |

### NO accent bars
Cards do NOT have colored top accent bars. No `h-[3px]` gradient divs.

### NO zebra striping
Table rows are white (`bg-white`). No alternating row colors. Hover only: `hover:bg-gray-50/50`.

---

## 5. Page Layout — 2 Row Header

All board screens should follow this layout:

```
Row 1 (42px, sticky top-0):
  Left:  Title · Count stats
  Right: Clock OR Download button OR Search (screen-specific)

Row 2 (36–40px, sticky top-[42px]):
  Left:  Primary filter (slot pills OR date range picker OR search)
  Right: [Filter ▾] dropdown

Content starts immediately after Row 2.
```

No stat cards. No separate filter bar row. No collapsible workload bar row.

### Row 1 height: 42px
### Row 2 height: 36px (slot pills) or 40px (filter controls)

### Slot pills (Row 2)
```
Style: px-2.5 py-0.5 border rounded-md text-xs h-7
Active: border-gray-900 text-gray-900 font-medium
Inactive: border-gray-200 text-gray-500 hover:border-gray-300
Closed: bg-gray-50 border-gray-100 text-gray-400
Done (0 pending): checkmark icon + slot name
```

### Filter dropdown
- Button: `border border-gray-200 rounded-md text-[11px] font-medium h-7`
- Active: `border-gray-900 text-gray-900` with count badge (`bg-gray-900 text-white rounded-full w-4 h-4`)
- Panel: `bg-white border-gray-200 rounded-lg shadow-lg z-50 p-3`
- Groups: labeled sections with `text-[10px] font-bold uppercase tracking-wider text-gray-400`
- Active chip: `bg-gray-900 text-white border-gray-900`
- Inactive chip: `bg-white text-gray-500 border-gray-200 hover:border-gray-300`
- Clear all: `text-[11px] text-gray-400 hover:text-gray-600 border-t border-gray-100 pt-1`
- Close on outside click via `useRef` + `mousedown` listener

### Workload dropdown
- Same button style as Filter
- Panel: `w-[300px]` with operator chips

---

## 6. Card Components

### Card structure (top to bottom)
```
1. Icon row — h-[24px], justify-between
   Left: split indicator (if applicable): "✂ 1 · 6 left" in text-amber-600
   Right: action icons [Eye] [+] [⋯]

2. Badge row — flex-wrap gap-1.5 mb-[6px]
   Priority badge (Normal=gray / Urgent=red)
   + any semantic badges (Split #N, Done, Dispatch)

3. Customer name — text-[13.5px] font-bold text-gray-900
   + inline ⚠ icon (AlertCircle 14px, text-amber-500) if customerMissing

4. OBD row — text-[11px] text-gray-400
   [delivery type dot 5px] OBD · Area · Date

5. Info grid — 2×2, bg-gray-50 border-gray-200
   SMU | Sales Officer | Articles | Volume

6. Footer — border-t border-gray-200
   Pending: [Create Split] or [Assign] button (uniform height)
   Assigned/InProgress: operator row (avatar + name + time)
   Completed: operator row + status trail
```

### Button styles
```
CTA (Assign/Create Split):
  bg-white border border-gray-200 text-gray-700 rounded-lg py-2.5
  text-[12px] font-semibold hover:bg-gray-50 hover:border-gray-300

Action icons:
  w-[22px] h-[22px] rounded text-gray-400
  hover:text-gray-600 hover:bg-gray-100
```

### Badge styles
```
Normal:   bg-gray-50 border-gray-200 text-gray-500
Urgent:   bg-red-50 border-red-200 text-red-600
Done:     bg-green-50 border-green-200 text-green-700
Split:    bg-purple-50 border-purple-200 text-purple-700
Active:   bg-green-50 border-green-200 text-green-700
Inactive: bg-gray-50 border-gray-200 text-gray-500
```

---

## 7. Table Components

### Grid template (10 columns, all fr, fills 100%)
```typescript
const TABLE_GRID = "1fr 1.2fr 1.8fr 0.7fr 0.7fr 1.1fr 0.6fr 1.6fr 0.8fr 0.5fr";
//                  OBD  SMU    CUST   SLOT  PRIO  ART    VOL   STAGE  TIME   ACTIONS
```

All sections use the SAME grid. 10 columns. Fills full width.

### Column sequence
OBD NO. → SMU → CUSTOMER → SLOT → PRIORITY → ARTICLES → VOLUME → STAGE → TIME → ACTIONS

### Stage column (col8) per section
- Pending: CTA button (Assign or Create Split + "N left" amber text)
- Assigned/InProgress/Completed: Operator avatar + name

### Time column (col9) per section
- Pending: empty
- Assigned: Assigned At
- In Progress: Elapsed time
- Completed: Completed At

### Section headers
```
● Section Name  count                                volume L
```
Left: colored dot + name + count badge. Right: total volume in `text-[13px] font-semibold text-gray-700`.

### CTA buttons (Pending section)
Both Assign and Create Split: `min-w-[120px] justify-center` for uniform size.
"N left" shown as separate `text-amber-600` text beside Create Split button.

### Expandable rows (inline shade detail)
- Click row → expand row appears immediately below
- Expand row: `bg-gray-50 border-b border-gray-100`
- Use `<React.Fragment key={key}>` wrapper (not `<>`) to ensure correct DOM position
- Shade label: `text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400`
- Non-zero value: `text-[12px] font-semibold text-gray-900`
- Zero value: `text-[12px] font-semibold text-gray-200`
- Type label (TINTER/ACOTONE): `text-[10px] font-bold uppercase text-blue-600` / `text-orange-500`

---

## 8. Customer Missing Indicator

**Card view:** Inline ⚠ icon (AlertCircle 14px) next to customer name. `text-amber-500 hover:bg-amber-50 rounded p-0.5`. Clickable → opens CustomerMissingSheet.

**Table view:** Same inline icon next to customer name in the Customer cell.

NOT a full pill/badge. NOT a separate row.

---

## 9. Delivery Type Dots

5px colored dot (`w-[5px] h-[5px] rounded-full`) placed BEFORE the OBD number.

| Type | Class | When to show |
|---|---|---|
| Local | `bg-blue-600` | deliveryTypeName === "Local" |
| Upcountry | `bg-orange-600` | deliveryTypeName === "Upcountry" |
| IGT | `bg-teal-600` | deliveryTypeName === "IGT" |
| Cross Depot | `bg-rose-600` | deliveryTypeName === "Cross Depot" |
| null | no dot | deliveryTypeName is null/undefined |

Add `title={deliveryTypeName}` for tooltip on hover.

Color choices avoid clash with: amber (Missing/Split), purple (Split badge), red (Urgent), green (Done).

---

## 10. Order Detail Panel

Shared component: `components/shared/order-detail-panel.tsx`
API: `GET /api/orders/[id]/detail`

Props: `{ orderId: number | null, onClose: () => void }`

Triggered by: Eye icon on cards, order click in table.

Replaces SkuDetailsSheet in TM (v39). SkuDetailsSheet file kept for other screens.

---

## 11. Status Popover (+ button)

Fixed-position portal. Width 210px. zIndex 9999.
Anchor: bottom of + button + 4px gap.

Contains:
1. Priority toggle: Normal (gray) | 🚨 Urgent (red) — keep semantic colors
2. Dispatch toggle: Dispatch (green) | Hold (red) | Waiting (amber) — keep semantic colors
3. Save button: `bg-gray-900 text-white` when changes detected, `bg-gray-100 text-gray-400` when disabled

---

## 12. Modal Pattern

```
Container: fixed inset-0 z-50, centered
Backdrop: bg-black/40, click to close
Panel: bg-white border border-gray-200 rounded-lg shadow-xl w-[400px]
Header: px-5 pt-5 pb-4 border-b border-gray-200
Footer: px-5 pb-5 pt-3 border-t border-gray-200 flex justify-end gap-2
Cancel button: border border-gray-200 text-gray-600 hover:bg-gray-50
Confirm button: bg-gray-900 text-white hover:bg-gray-800
```

---

## 13. Interaction Patterns

| Interaction | Behaviour |
|---|---|
| Eye icon click | Opens OrderDetailPanel (not SkuDetailsSheet) |
| Assign button | Opens operator picker modal |
| Create Split button | Opens Split Builder modal |
| + button | Opens status popover (fixed position) |
| ⋯ button | Opens dropdown menu |
| Slot pill click | Filters board by slotId. Click again deselects. |
| Filter dropdown | Opens panel with filter groups |
| Workload dropdown | Opens panel with operator chips |
| Customer ⚠ icon click | Opens CustomerMissingSheet |
| Delivery type dot | Tooltip on hover (title attribute) |
| Table row click (TI Report) | Toggles inline shade expand row |
| Date range button click | Opens DateRangePicker dropdown |

---

## 14. iPhone-style Toggle

Replace shadcn `Switch` with custom `IosToggle` component for clear visual affordance.

```tsx
function IosToggle({ checked, onChange, disabled }: {
  checked:  boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[20px] w-[36px] flex-shrink-0 cursor-pointer
        rounded-full border-2 border-transparent transition-colors duration-200
        focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed
        ${checked ? "bg-green-500" : "bg-gray-300"}`}
    >
      <span className={`pointer-events-none inline-block h-[16px] w-[16px] transform
        rounded-full bg-white shadow-md transition-transform duration-200
        ${checked ? "translate-x-[16px]" : "translate-x-0"}`}
      />
    </button>
  );
}
```

- On: `bg-green-500`, thumb at right
- Off: `bg-gray-300`, thumb at left
- Size: 36×20px (compact). Use 46×26px for larger contexts.
- Used in: Shade Master active toggle

---

## 15. Date Range Picker

Standalone dropdown component for date range selection. Used in TI Report.

### Trigger button
```
h-7 px-3 border border-gray-200 rounded-md text-[11px] font-medium
Shows: "02 Apr" (single day) or "25 Mar – 02 Apr" (range)
Active: border-gray-900 text-gray-900
```

### Dropdown panel (240px wide)
```
Section 1 — Presets (border-b border-gray-100):
  Today / Yesterday / This Week / This Month
  Active preset: bg-gray-900 text-white rounded-md
  Inactive: text-gray-600 hover:bg-gray-50

Section 2 — Calendar:
  Month nav: ChevronLeft / Month Year / ChevronRight
  Day headers: Su Mo Tu We Th Fr Sa — text-[9.5px] font-bold text-gray-400
  Day cells: h-7, rounded-md
    Selected (from/to): bg-gray-900 text-white font-semibold
    In range: bg-gray-100 text-gray-700
    Today: font-semibold text-gray-900
    Future: text-gray-200 cursor-not-allowed disabled
    Normal: text-gray-700 hover:bg-gray-50
  Hint when selecting end date: "Now pick end date" text-[10px] text-gray-400
```

### Interaction
1. Click trigger → dropdown opens
2. Click preset → applies immediately, closes
3. Click first calendar date → "selecting to" state, hint shows
4. Click second calendar date → applies range, closes
5. Click outside → closes, resets selection state

### Download button with range label
When paired with a download action, show active range inline:
```
[↓ Download Excel  |  02 Apr]        ← single day
[↓ Download Excel  |  25 Mar – 02 Apr]   ← range
```
Separator: `w-px h-3 bg-white/30 mx-0.5` divider inside button.
Range text: `text-white/70 text-[10px]`

---

## 16. Screen-Specific Notes

### Tint Manager (REDESIGNED v39)
- Full neutral theme applied
- 2-row header layout
- OrderDetailPanel instead of SkuDetailsSheet
- Delivery type dots on all cards and table rows
- Split indicator in icon row (not separate amber bar)

### Shade Master (REDESIGNED v40)
- Full neutral theme applied
- 2-row header: Row 1 title + stats, Row 2 search + Filter ▾
- Filter dropdown: Type (All/TINTER/ACOTONE) + Pack + Status
- iPhone-style toggle for active/inactive
- Column sequence: `# · Shade Name · Customer ID · Type · SKU Code · Pack · Status · Active · Added By · Added At`
- Type column: 5px dot (blue=TINTER, orange=ACOTONE) + muted label
- Added At: date primary (`text-gray-900 font-medium`), time secondary (`text-gray-400`) stacked
- Table wrapped in `rounded-lg border border-gray-200` with `px-4 py-3` outer spacing
- page.tsx: bare `<ShadeMasterContent />` — no wrapper div, no title

### TI Report (REDESIGNED v40)
- Full neutral theme applied
- 2-row header: Row 1 title + stats + Download Excel button with active range label
- Row 2: DateRangePicker + Search OBD + Filter ▾ (Operator + Type)
- Summary tab removed — single transaction view only
- 9 columns: chevron · Date · OBD No. · Dealer · Site · Base · Pack · Tins · Operator·Time
- Click row → inline shade expand (TINTER or ACOTONE shades, non-zero highlighted)
- Tins: no `.toFixed(2)` — show clean number (`2` not `2.00`)
- page.tsx: bare `<TIReportContent />` for both routes

### Support Board
- Already uses neutral slot pills and filter pills
- Needs neutral card/row styling pass (queued)

### Planning Board
- Needs neutral palette pass (queued)
- OrderDetailPanel integration (queued)

### Warehouse Board
- Already partially neutral
- Needs full pass (queued)

### Tint Operator
- Needs neutral palette pass (queued)
- May need delivery type dots

---

## 17. DEPRECATED — Do Not Use

These patterns are from the old indigo theme and should NOT be used in new code:

| Deprecated | Replacement |
|---|---|
| `bg-[#1a237e]` (buttons) | `bg-gray-900` or `bg-white border-gray-200` |
| `bg-[#e8eaf6]` (active bg) | `bg-gray-50` |
| `border-[#e2e5f1]` | `border-gray-200` |
| `bg-[#f7f8fc]` | `bg-gray-50` |
| `bg-[#f0f2f8]` (page bg) | `bg-white` |
| `text-[#1a237e]` | `text-gray-700` or `text-gray-900` |
| `text-[#3C3489]` | `text-gray-700` |
| `border-[#AFA9EC]` | `border-gray-300` |
| `bg-[#EEEDFE]` (normal badge) | `bg-gray-50 border-gray-200 text-gray-500` |
| Card accent bars (`h-[3px]` gradients) | Removed — no accent bars |
| Filled indigo buttons | Outlined neutral buttons |
| StatusBadge variant="normal" (indigo) | Custom gray badge span |
| shadcn `Switch` | Custom `IosToggle` component |
| Zebra striping (`bg-[#f8f9ff]`) | White rows, hover only |
| `bg-[#f8f9ff]` odd rows | `bg-white` — no zebra |
| `hover:bg-[#eef0fb]` | `hover:bg-gray-50/50` |
| shadcn `Badge` variant="default/secondary" | Custom inline `span` with semantic classes |
| `text-slate-*` | `text-gray-*` equivalent |
| `border-slate-*` | `border-gray-*` equivalent |
| `bg-slate-*` | `bg-gray-*` equivalent |

---

*Version: v3 · Neutral Theme · Context v40 · April 2026*
