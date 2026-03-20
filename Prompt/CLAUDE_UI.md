# CLAUDE_UI.md — Orbit OMS UI Patterns
# Load alongside CLAUDE_CONTEXT.md for all UI implementation sessions.
# Version: Phase 3 · March 2026

---

## 1. Color palette

| Token | Hex | Usage |
|---|---|---|
| Navy primary | `#1a237e` | Buttons, active states, links |
| Navy hover | `#283593` | Button hover |
| Navy light | `#e8eaf6` | Active pill bg, selected row bg |
| Navy border active | `#c5cae9` | Active pill border |
| Border default | `#e2e5f1` | Cards, dividers, inputs |
| Border hover | `#cdd1e8` | Card hover |
| Surface default | `#f7f8fc` | Input bg, info grid bg |
| Page bg | `#f0f2f8` | Body background |
| Text primary | `#111827` (gray-900) | Headings, card titles |
| Text secondary | `#6b7280` (gray-500) | Labels, subtitles |
| Text muted | `#9ca3af` (gray-400) | Timestamps, captions |

---

## 2. Typography

| Element | Class |
|---|---|
| Page title | `text-[17px] font-extrabold text-gray-900` |
| Card title | `text-[13.5px] font-bold text-gray-900 leading-snug` |
| Label (uppercase) | `text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400` |
| Meta value | `text-[12px] font-semibold text-gray-900` |
| Badge text | `text-[11px] font-semibold` |
| Timestamp | `text-[11px] text-gray-400` |
| Button text | `text-[12px] font-semibold` |
| Section header | `text-[10px] font-extrabold uppercase tracking-[.6px] text-gray-400` |

---

## 3. Border & spacing rules

- Card border radius: `rounded-xl` (12px)
- Column container border radius: `rounded-[14px]`
- Modal border radius: `rounded-[14px]`
- Card padding: `px-3.5 pt-3 pb-3`
- Info grid: `bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg p-2.5 grid grid-cols-2 gap-x-4 gap-y-2`
- Top accent bar on cards: `h-[3px] w-full` with stage-color gradient

---

## 4. Card top accent bar colors

| Stage | Class |
|---|---|
| pending_tint_assignment | `bg-gradient-to-r from-indigo-500 to-indigo-300` |
| tint_assigned | `bg-gradient-to-r from-amber-400 to-amber-300` |
| tinting_in_progress | `bg-gradient-to-r from-blue-500 to-blue-300` |
| completed / pending_support | `bg-gradient-to-r from-green-600 to-green-400` |

### Page layout
```
bg-[#f0f2f8] min-h-screen
  ↓
  Topbar (52px, bg-white, border-b border-[#e2e5f1]) ← sticky top-0 z-40
    Left: Title (font-extrabold) + count badge
    Right: search input (220px, expands to 260px on focus) + clock
  ↓
  Filter bar (44px, bg-white, border-b) ← sticky top-[52px] z-40
    Groups: SLOT | PRIORITY | DISPATCH | TYPE | active pill + Operator dropdown
  ↓
  Operator workload bar (bg-white, border-b, collapsible, collapsed by default)
  ↓
  Stat bar (px-3 py-2.5, grid grid-cols-4 gap-3)
  ↓
  Board (px-3 pb-6)
```

### Kanban layout
```
px-3 pb-6
  grid grid-cols-4 gap-2
    Column (bg-[#f7f8fc] border border-[#e2e5f1] rounded-[12px] overflow-hidden)
      Column header (bg-white border-b px-4 py-3)
      Card list (p-2 flex flex-col gap-2)
```

---

## 5. StatCard Component — compact v2

Padding: `10px 14px`. Icon: 32px circle. Layout: icon + right column.

```tsx
<div className="bg-white border border-[#e2e5f1] rounded-xl flex items-center gap-3"
  style={{ padding: '10px 14px' }}>
  <div className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
    iconBg, iconColor)}>
    {icon}
  </div>
  <div>
    <div className="flex items-baseline gap-2 mb-1">
      <span className="text-[20px] font-extrabold text-gray-900 leading-none">{value}</span>
      <span className="text-[10px] font-bold uppercase tracking-[.4px] text-gray-500">{label}</span>
    </div>
    <div className="text-[11px] text-gray-400">
      {volume} · {subLabel}
    </div>
  </div>
</div>
```

Volume format: `>= 1000` → `"1,234 L"` via `toLocaleString()`. `0 or null` → `"— L"`.
Two rows: count+label row (mb-1) then volume+sublabel row. Never single row.

---

## 6. Status badges

### StatusBadge (priority)
```tsx
<StatusBadge variant="urgent" size="sm" />  // red pill
<StatusBadge variant="normal" size="sm" />  // indigo pill
```
Used on ALL order and split cards in top-left badge group.

### DispatchStatusBadge
Inline component with Truck icon. Color map:
- `dispatch` → green-50 / green-700 / green-200
- `hold` → red-50 / red-700 / red-200
- `waiting_for_confirmation` → amber-50 / amber-700 / amber-200

### Card sections (top to bottom)
1. **Icon row** — `h-[24px]`, `justify-end`, `gap-1`, `mb-1.5`
   Order cards: 👁 Eye + + Plus + ··· MoreHorizontal
   Split cards: 👁 Eye (SKU sheet, split lines only)
               🗂 Layers (SplitDetailSheet + OBD history)
               + Plus (status popover)
               ··· MoreHorizontal
2. **Badge row** — `min-h-[22px]`, `flex-wrap`, `gap-1.5`, `mb-2`
   Priority badge (Normal/Urgent) + dispatch status badge (if set)
   Split cards also show Split #N badge
3. **Customer name** — `text-[13.5px] font-bold`, `mb-1`
4. **OBD row** — `OBDNo · Route · Date Time`, `mb-2.5`
5. **Meta grid** — 2×2 in `bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg p-2`, `mb-2`
6. **Split indicator** (Pending, when `hasSplits = true`) — amber pill, `mt-2 mb-0`
7. **Bottom section** — `mt-2.5 pt-2.5 border-t border-[#e2e5f1]`:
   - Pending (`hasSplits = false`): navy Assign button `py-3`
   - Pending (`hasSplits = true`): outlined Create Split button `py-3`
   - Assigned / In Progress / Completed: operator row `px-3 py-2`
   - Completed only: + status trail `mt-2 pt-2 border-t border-[#e2e5f1]`

**Icon row rule:** Icons are ALWAYS on their own row ABOVE badges.
Never combine icons and badges on the same flex row — 3+ badges push icons off screen.

### Split/Order card ··· menu
```
tint_assigned:
  ↑ Move Up   (ChevronUp icon)
  ↓ Move Down (ChevronDown icon)
  ─── divider ───
  Re-assign   (RefreshCw icon)
  Cancel      (X icon, destructive red)
tinting_in_progress / tinting_done: No actions available
```

### Two-badge status trail (Completed column)
Right badge color logic:
  dispatch                   → bg-[#eaf3de] border-[#97c459] text-[#27500a]
  hold                       → bg-[#fcebeb] border-[#f09595] text-[#791f1f]
  waiting_for_confirmation   → bg-[#faeeda] border-[#fac775] text-[#633806]
  null (no dispatch status)  → bg-[#eff6ff] border-[#bfdbfe] text-[#1e40af] label: "Pending Support"

Applies to BOTH KanbanCard (whole orders) and SplitKanbanCard in Completed column.
Previously this trail was SplitKanbanCard only — now on both card types.

---

## 7. Action button cluster (card top-right)

3 buttons in a row: `flex items-center gap-1`
Each button: `w-[26px] h-[26px] rounded-lg flex items-center justify-center transition-colors`

| Button | Icon | Default | Active |
|---|---|---|---|
| Eye (SKU sheet) | `Eye size={14}` | `text-gray-400 hover:text-violet-600 hover:bg-violet-50` | — |
| + (status popover) | `Plus size={14}` | `text-gray-400 hover:bg-gray-100` | `bg-[#1a237e] text-white` |
| ... (menu) | `MoreHorizontal size={14}` | `text-gray-400 hover:bg-gray-100` | — |

---

## 8. Status popover

Fixed-position portal (avoids overflow clipping). Width: 210px.
Anchor: bottom of + button + 4px gap. Right-aligned.
`zIndex: 9999`

Sections:
1. "SET STATUS" header — `text-[10px] font-extrabold uppercase tracking-[.6px] text-gray-400`
2. Priority toggle — 2 buttons: Normal | 🚨 Urgent
3. Divider
4. Dispatch toggle — compact 3-button strip: Dispatch | Hold | Waiting
5. Save button — disabled (gray) until change detected

Priority active states:
- urgent: `bg-red-50 border-red-300 text-red-700`
- normal: `bg-[#EEEDFE] border-[#AFA9EC] text-[#3C3489]`

Dispatch active states (inside strip):
- dispatch: `bg-green-50 border border-green-200 text-green-700`
- hold: `bg-red-50 border border-red-200 text-red-700`
- waiting_for_confirmation: `bg-amber-50 border border-amber-200 text-amber-700`

---

## 9. Operator row (bottom of assigned/in-progress/done cards)

```tsx
<div className="flex items-center gap-2.5 bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg px-3 py-2">
  <div className="w-7 h-7 rounded-full bg-[#1a237e] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
    {initials}
  </div>
  <span className="text-[12px] font-semibold text-gray-900 flex-1 truncate">{name}</span>
  <span className="text-[11px] text-gray-400 flex-shrink-0">{time}</span>
</div>
```

Avatar color by stage: assigned = navy `#1a237e` · in-progress = blue `#378ADD` · done = green `#639922`

---

## 10. Dropdown menu (... button)

```tsx
<div className="absolute right-0 top-8 z-50 bg-white border border-[#e2e5f1] rounded-xl shadow-lg py-1 min-w-[130px] max-w-[150px]">
  <button className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-[#f7f8fc] transition-colors whitespace-nowrap">
    <Icon size={12} className="text-gray-400 flex-shrink-0" />
    Label
  </button>
  <div className="mx-3 border-t border-[#f0f1f8]" />
  <button className="... text-red-600 hover:bg-red-50 ...">
    Cancel / destructive
  </button>
</div>
```

---

## 11. Modal pattern

```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
  <div className="absolute inset-0 bg-black/40" onClick={onClose} />
  <div className="relative bg-white rounded-[14px] shadow-xl w-[400px] overflow-hidden border border-[#e2e5f1]">
    {/* Header */}
    <div className="px-5 pt-5 pb-4 border-b border-[#e2e5f1]">
      <p className="text-[15px] font-bold text-gray-900">{title}</p>
      <p className="text-[12px] text-gray-400 mt-1">{subtitle}</p>
    </div>
    {/* Body */}
    <div className="px-5 pt-4 pb-2 max-h-[260px] overflow-y-auto">...</div>
    {/* Footer */}
    <div className="px-5 pb-5 pt-3 border-t border-[#e2e5f1] flex justify-end gap-2">
      <button className="... text-gray-600 border border-[#e2e5f1] ...">Cancel</button>
      <button className="... text-white bg-[#1a237e] hover:bg-[#283593] ...">Confirm</button>
    </div>
  </div>
</div>
```

### Full-width card CTA — Assign button (when hasSplits = false)
```
w-full flex items-center justify-center gap-2 bg-[#1a237e] text-white
rounded-lg py-3 text-[12px] font-semibold
hover:bg-[#283593] transition-colors
```

### Full-width card CTA — Create Split button (when hasSplits = true)
```
w-full flex items-center justify-center gap-2 bg-white border border-[#1a237e]
text-[#1a237e] rounded-lg py-3 text-[12px] font-semibold
hover:bg-[#e8eaf6] transition-colors
```
Same `py-3` height as Assign button. Used when `hasSplits = true` on Pending cards.

---

## 12. Operator selector (inside modals)

Each operator row in assignment/reassignment modals:
```tsx
<div className={cn(
  "flex items-center gap-3 p-3.5 border-[1.5px] rounded-xl mb-2 cursor-pointer transition-all",
  isSelected ? "border-[#1a237e] bg-[#e8eaf6]" : "border-[#e2e5f1] hover:border-[#c5cae9] hover:bg-[#f7f8fc]",
)}>
  <div className="w-9 h-9 rounded-full bg-[#1a237e] text-white flex items-center justify-center text-[12px] font-bold">
    {initials}
  </div>
  <div className="flex-1 min-w-0">
    <p className="text-[13px] font-semibold text-gray-900">{name}</p>
  </div>
  <div className={cn("w-5 h-5 rounded-full bg-[#1a237e] text-white flex items-center justify-center text-[10px]", isSelected ? "opacity-100" : "opacity-0")}>✓</div>
</div>
```

---

## 13. Error banner (inside modals)

```tsx
<div className="flex items-center gap-2.5 mx-5 mb-3 p-3.5 bg-red-50 border border-red-200 rounded-xl text-[12.5px]">
  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
  <span className="text-red-700 font-medium">{message}</span>
  <button className="ml-auto text-[12px] text-red-600 underline" onClick={retry}>Retry</button>
</div>
```

---

## 14. Topbar pattern

Height: `h-[52px]`. Background: `bg-white border-b border-[#e2e5f1] px-6 flex items-center`

Left side: `flex items-center flex-1`
- Title: `text-[17px] font-extrabold text-gray-900`
- Count pill: `bg-[#f7f8fc] border border-[#e2e5f1] text-[12px] text-gray-400 font-semibold px-2.5 py-0.5 rounded-full ml-2`

Right side: `flex items-center gap-3`
- Search bar (220px → 260px on focus)
- Clock: `font-mono text-[12px] text-gray-400`

---

## 15. Filter Bar (v2 — 4 groups)

Height: 44px. Bar: `bg-white border-b border-[#e2e5f1] px-4 h-[44px] flex items-center`.
Groups separated by: `<div style="width:0.5px;height:20px;background:#e2e5f1;flex-shrink:0" />`
Group container: `flex items-center gap-1 px-3 h-full`
Group label: `text-[9.5px] font-bold uppercase tracking-[.6px] text-[#ccc] mr-1`

Slot chip with count badge:
```tsx
<button className={cn(
  "flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-colors",
  active ? "bg-[#1a237e] text-white border-[#1a237e]"
         : "bg-white text-gray-500 border-[#e2e5f1] hover:border-[#1a237e] hover:text-[#1a237e]"
)}>
  {label}
  <span className={cn(
    "text-[9.5px] font-bold px-1 rounded-[3px]",
    active ? "bg-white/20 text-white" : "bg-[#f0f2f8] text-gray-400"
  )}>{count}</span>
</button>
```

Generic filter chip (Priority / Dispatch / Type):
```tsx
<button className={cn(
  "text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-colors",
  active ? activeClass : "bg-white text-gray-500 border-[#e2e5f1] hover:border-[#cdd1e8]"
)}>
  {label}
</button>
```

Active states per group:
  Priority — All: navy | Urgent: `bg-[#fcebeb] text-[#791f1f] border-[#f09595]` | Normal: `bg-[#eeedfe] text-[#3c3489] border-[#afa9ec]`
  Dispatch — All: navy | Dispatch: `bg-[#eaf3de] text-[#27500a] border-[#97c459]` | Hold: `bg-[#fcebeb] text-[#791f1f] border-[#f09595]` | Waiting: `bg-[#faeeda] text-[#633806] border-[#fac775]`
  Type — All: navy | Split/Whole: navy

Active filter summary pill (right side, only when filters non-default):
```tsx
<div className="flex items-center gap-1.5 bg-[#e8eaf6] border border-[#c5cae9] rounded-md px-2 py-1">
  <div className="w-1.5 h-1.5 rounded-full bg-[#1a237e] flex-shrink-0" />
  <span className="text-[10px] font-semibold text-[#1a237e]">{filterSummary}</span>
  <button onClick={clearAll}
    className="text-[#7986cb] hover:text-[#1a237e] text-[13px] leading-none ml-0.5">
    ×
  </button>
</div>
```

---

## 16. Filter group pattern

Bar height: 44px. Groups separated by: `width 0.5px height 20px bg-[#e2e5f1]`
Group label: `text-[9px] font-bold uppercase tracking-[.6px] text-[#ccc] mr-1`

Slot chip with count:
```tsx
<button className={cn(
  "flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-colors",
  active ? "bg-[#1a237e] text-white border-[#1a237e]"
         : "bg-white text-gray-500 border-[#e2e5f1] hover:border-[#1a237e] hover:text-[#1a237e]"
)}>
  {label}
  <span className={cn("text-[9.5px] font-bold px-1 rounded-[3px]",
    active ? "bg-white/20 text-white" : "bg-[#f0f2f8] text-gray-400"
  )}>{count}</span>
</button>
```

Active filter summary pill:
```tsx
<div className="flex items-center gap-1.5 bg-[#e8eaf6] border border-[#c5cae9] rounded-md px-2 py-1">
  <div className="w-1.5 h-1.5 rounded-full bg-[#1a237e]" />
  <span className="text-[10px] font-semibold text-[#1a237e]">{text}</span>
  <button onClick={clearAll} className="text-[#7986cb] hover:text-[#1a237e] text-[13px] leading-none ml-0.5">×</button>
</div>
```

---

## 18. Interaction patterns

| Interaction | Behaviour |
|---|---|
| Assign button (`hasSplits=false`) | Opens operator picker modal — title/button text determined by isReassign logic |
| Create Split button (`hasSplits=true`) | Opens Split Builder modal |
| `+` button click | Opens status popover (fixed position via getBoundingClientRect, stopPropagation) |
| Status popover save | PATCH `/api/tint/manager/orders/[id]/status` or `splits/[id]/status` then `fetchOrders()` |
| Move Up (··· menu, Assigned only) | PATCH `/api/tint/manager/reorder` direction=up then `fetchOrders()` |
| Move Down (··· menu, Assigned only) | PATCH `/api/tint/manager/reorder` direction=down then `fetchOrders()` |
| Slot chip click | Filters cards by dispatchSlot, count shown inside chip |
| Active pill × | Clears ALL filters simultaneously |
| Operator workload card click | Sets operatorFilter, click again deselects |
| 🗂 Layers icon (split cards) | Opens SplitDetailSheet — fetches /api/tint/manager/orders/[id]/splits |
| Re-assign (inside SplitDetailSheet) | Calls onReassign() + closes sheet → opens split reassign modal |

---

## 21. Status Popover (+ button)

Triggered by: + icon button on any card in any column.
Positioning: `position: fixed`, top/left computed from `getBoundingClientRect()` of trigger button.
Width: 200px. Opens on click, closes on outside click (50ms delay prevents immediate close on open).
z-index: 50 (above cards and modals).

```tsx
<div
  className="fixed z-50 bg-white border border-[#e2e5f1] rounded-xl shadow-lg p-3"
  style={{
    top: rect.bottom + 6,
    left: Math.min(rect.right - 200, window.innerWidth - 212)
  }}
>
  <p className="text-[9px] font-bold uppercase tracking-[.6px] text-gray-400 mb-2">
    Set Status
  </p>

  {/* Priority */}
  <p className="text-[9px] font-bold uppercase tracking-[.4px] text-gray-400 mb-1.5">Priority</p>
  <div className="flex gap-1 mb-3">
    <button className={cn("flex-1 py-1.5 rounded-lg border text-[10px] font-semibold",
      p === 'normal' ? "bg-[#eeedfe] text-[#3c3489] border-[#afa9ec]"
                     : "bg-white border-[#cdd1e8] text-gray-400")}>
      Normal
    </button>
    <button className={cn("flex-1 py-1.5 rounded-lg border text-[10px] font-semibold",
      p === 'urgent' ? "bg-[#fcebeb] text-[#791f1f] border-[#f09595]"
                     : "bg-white border-[#cdd1e8] text-gray-400")}>
      🚨 Urgent
    </button>
  </div>

  <hr className="border-t border-[#f0f1f8] mb-3" />

  {/* Dispatch Status */}
  <p className="text-[9px] font-bold uppercase tracking-[.4px] text-gray-400 mb-1.5">
    Dispatch Status
  </p>
  <div className="flex flex-col gap-1.5 mb-3">
    {[
      { val: 'dispatch',               label: '🚚 Dispatch', cls: 'bg-[#eaf3de] text-[#27500a] border-[#97c459]' },
      { val: 'hold',                   label: 'Hold',        cls: 'bg-[#fcebeb] text-[#791f1f] border-[#f09595]' },
      { val: 'waiting_for_confirmation', label: 'Waiting',   cls: 'bg-[#faeeda] text-[#633806] border-[#fac775]' },
    ].map(opt => (
      <button key={opt.val} className={cn(
        "w-full py-1.5 px-2.5 rounded-lg border text-[11px] font-semibold text-left",
        dispatch === opt.val ? opt.cls : "bg-white border-[#cdd1e8] text-gray-400"
      )}>
        {opt.label}
      </button>
    ))}
  </div>

  <button
    disabled={!hasChanges || isSaving}
    className={cn(
      "w-full py-1.5 rounded-lg text-[11.5px] font-semibold flex items-center justify-center gap-1.5",
      hasChanges && !isSaving
        ? "bg-[#1a237e] text-white hover:bg-[#1a237e]/90"
        : "bg-gray-100 text-gray-400 cursor-not-allowed"
    )}
  >
    {isSaving ? <Loader2 size={12} className="animate-spin" /> : null}
    {isSaving ? 'Saving…' : 'Save'}
  </button>
</div>
```

+ button active state when popover is open:
```
className="... bg-[#1a237e] text-white"  (pop-active state)
```

---

---

## 22. SplitDetailSheet

Fixed overlay portal (not shadcn Sheet). Width 420px, right-anchored, full height.
z-index: 50. Backdrop: bg-black/40, click to close.
```tsx
{splitSheetOpen && (
  <div className="fixed inset-0 z-50 flex items-end justify-end">
    <div className="absolute inset-0 bg-black/40"
      onClick={() => setSplitSheetOpen(false)} />
    <div className="relative bg-white h-full w-[420px] flex flex-col
      border-l border-[#e2e5f1] shadow-xl overflow-hidden">

      {/* Header */}
      <div className="px-6 py-5 border-b border-[#e2e5f1] flex-shrink-0">
        <p className="text-[11px] font-bold uppercase tracking-[.6px] text-gray-400 mb-1">
          Split #{splitNumber} · {obdNumber}
        </p>
        <h2 className="text-[15px] font-bold text-gray-900">{customerName}</h2>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-5">
        {/* sections */}
      </div>

      {/* Footer — Close only */}
      <div className="px-6 py-4 border-t border-[#e2e5f1] flex justify-end bg-white flex-shrink-0">
        <button onClick={() => setSplitSheetOpen(false)}
          className="text-[12.5px] font-semibold text-gray-600 border border-[#e2e5f1]
            bg-white hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors">
          Close
        </button>
      </div>
    </div>
  </div>
)}
```

Re-assign button style (inside body, tint_assigned only):
```
w-full flex items-center justify-center gap-2 bg-white border border-[#1a237e]
text-[#1a237e] rounded-lg py-2 text-[12px] font-semibold
hover:bg-[#e8eaf6] transition-colors mt-2
```

History split card style — current split highlighted:
```
border rounded-xl px-4 py-3
isCurrent:    border-[#1a237e] bg-[#e8eaf6]
not current:  bg-[#f7f8fc] border-[#e2e5f1]
```

Loading state while fetching:
```tsx
<div className="bg-gray-100 rounded-xl h-20 animate-pulse" />
<div className="bg-gray-100 rounded-xl h-20 animate-pulse" />
```
2 skeleton cards shown while API fetch is in progress.

---

*Version: Phase 3 · Kanban v4.3 · March 2026*
