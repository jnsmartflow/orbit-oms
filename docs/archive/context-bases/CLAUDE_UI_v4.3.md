# CLAUDE_UI.md — Orbit OMS UI Design System
# Load alongside CLAUDE_CONTEXT.md for all UI implementation sessions.
# This is the SINGLE SOURCE OF TRUTH for visual styling across all screens.
# Version: v4.3 · Teal Brand System · Universal Header · April 2026

---

## 1. Design Philosophy

- **Neutral first.** White backgrounds, gray borders, minimal color. Color is reserved for semantic meaning and brand actions only.
- **Teal is the brand color.** `teal-600` (#0d9488) is the single brand accent. It appears on CTAs, focus rings, active nav, sidebar accent bar, logo button, user avatars, active slot segment, and the login dot. Nowhere else.
- **The old indigo theme (#1a237e) is FULLY DEPRECATED.** Do not use indigo fills, indigo borders, or indigo text anywhere. No exceptions.
- **Three color roles — memorize these:**
  - **Teal** = brand action (CTA buttons, focus rings, toggles ON, nav active, avatars, logo, active slot segment)
  - **Gray** = structure (borders, text hierarchy, slot pills, filter chips, page bg, clock, search, shortcuts, date stepper)
  - **Semantic** = status only (green=done, red=urgent/error, amber=waiting — never for decoration)
- **Minimal chrome.** Maximize content area. Header + controls in 2 rows max. No stat cards unless explicitly requested.
- **Text hierarchy drives scannability.** Darkest = primary identifier, medium = data, lightest = context.
- **Smart Title Case for display.** All user-facing text from DB rendered with smartTitleCase(). See §19.
- **Universal header for ALL boards.** Every screen uses `<UniversalHeader />`. No custom headers. See §24.

---

## 2-5. [Unchanged from v4]

(Brand Color, Color Palette, Typography, Borders & Spacing — refer to v4 for full content)

---

## 6. Page Layout — Universal Header System (REWRITTEN v4.3)

ALL board screens use the shared `<UniversalHeader />` component from `components/universal-header.tsx`. No custom headers. No exceptions.

### Layout structure
```
Row 1 (52px, sticky top-0, z-30):
  LEFT:   Title (14px semibold) · Stats (11px gray-400, ml-3 spacing)
  RIGHT:  Clock | ⌨ Shortcuts | [Download] | Search bar

Row 2 (40px, sticky top-[52px], z-30):
  LEFT:   Segmented control (slots or status tabs) [+ leftExtra]
  RIGHT:  [rightExtra] | Filter ▾ | ‹ Date stepper ›

Content starts immediately after Row 2.
```

No stat cards. No separate filter bar. No collapsible workload bar.
No date in the title — date is shown in the stepper only.

### Row 1 — Title Bar (52px)

**Height:** 52px (matches sidebar logo area height).
**Background:** bg-white. **Border:** border-b border-gray-200.
**Sticky:** top-0 z-30. **Padding:** px-4.

**Left side:**
- Title: `text-[14px] font-semibold text-gray-900`
- Stats: `text-[11px] text-gray-400 ml-3`
  Format: "87 orders · 306 lines · 12 pending"
  Numbers in `font-semibold text-gray-900`

**Right side (flex items-center gap-2, separated by dividers):**

| Element | Style | Notes |
|---|---|---|
| Clock | `text-[11px] font-medium text-gray-400` fontVariantNumeric: tabular-nums | IST, HH:MM, updates every second |
| Divider | `w-px h-4 bg-gray-200` | Between each element |
| Shortcuts | `bg-gray-50 rounded-[5px] p-[4px_8px]` Keyboard icon 13px text-gray-400 | Click or ? key opens panel |
| Download | `bg-teal-600 hover:bg-teal-700 text-white text-[10px] font-medium rounded-[5px] px-[10px] py-[4px]` | TI Report ONLY |
| Search | `bg-gray-50 rounded-[6px] px-[10px] py-[4px] w-[180px] focus-within:w-[260px]` | / key hint, expands on focus |

**Search bar detail:**
```
Container: bg-gray-50 rounded-[6px] flex items-center gap-[6px]
           w-[180px] focus-within:w-[260px] transition-all duration-200
Icon:      Search 13px text-gray-400
Input:     bg-transparent border-none outline-none text-[11px]
           text-gray-900 placeholder:text-gray-400
Hint:      "/" in text-[9px] text-gray-400 bg-white border border-gray-200
           rounded-[3px] px-[4px] py-[1px] — hidden when focused
```

### Row 2 — Filter Bar (40px)

**Height:** 40px. **Background:** bg-white. **Border:** border-b border-gray-200.
**Sticky:** top-[52px] z-30. **Padding:** px-4.

#### Segmented Control (Left side)

The primary navigation element. Content varies by board type:

**Container:**
```
display: inline-flex
bg-gray-100 rounded-[7px] p-[3px] gap-[2px]
```

**Each segment:**
```
px-[11px] py-[4px] text-[11px] rounded-[5px] cursor-pointer transition-colors

Inactive: text-gray-500, no background, hover: bg-white/60
Active:   bg-teal-600 text-white font-medium
```

**Text format:** `"{label} · {count}"` when count is provided. Just `"{label}"` when count is omitted.

**Behavior:**
- Click inactive → activates (onSegmentChange(id))
- Click active → deselects (onSegmentChange(null)) → shows all
- NO "All" button — deselected state IS "all"
- Number keys 1-4 jump to segments

**Standard 4 slots (for slot-based boards):**
Morning, Afternoon, Evening, Night.
Filter out "Next Day Morning" (isNextDay === true).

**leftExtra:** Optional React node rendered after the segmented control with ml-2. Used by TI Report for its date range picker trigger.

#### Filter & Date (Right side)

**rightExtra:** Optional React node rendered before filter button. Used by TM for view toggle (card/table icons).

**View toggle style (when used as rightExtra):**
```
Active:   bg-gray-100 text-gray-900 p-1 rounded
Inactive: text-gray-400 hover:text-gray-600 p-1 rounded
```

**Filter button:**
```
Inactive:
  border border-gray-200 rounded-[5px] px-[7px] py-[3px]
  Filter icon 11px text-gray-500 + "Filter" text-[10px] text-gray-500

Active (filters applied):
  border border-gray-900 rounded-[5px] px-[7px] py-[3px]
  Filter icon 11px text-gray-900 + "Filter" text-[10px] font-medium text-gray-900
  Count badge: bg-gray-900 text-white text-[8px] font-medium
    min-w-[14px] h-[14px] rounded-full
```

**Filter dropdown panel:**
```
Position: absolute, right-aligned below button, z-50
Container: bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-[260px]
Close on outside click.

Group label:   text-[10px] font-bold uppercase tracking-wider text-gray-400
Inactive chip: bg-white text-gray-500 text-[10px] border border-gray-200 rounded-[4px]
               px-[8px] py-[2px] hover:border-gray-300
Active chip:   bg-gray-900 text-white text-[10px] border border-gray-900 rounded-[4px]
               px-[8px] py-[2px]
Clear all:     text-[11px] text-gray-400 hover:text-gray-600 border-t border-gray-100 pt-[6px] mt-[8px]
```

**Date stepper (when showDatePicker !== false):**
```
Container: inline-flex items-center gap-0

Left arrow:  px-[6px] py-[3px] text-[10px] text-gray-400
             border border-gray-200 rounded-l-[4px]
             cursor-pointer hover:bg-gray-50

Date label:  px-[10px] py-[3px] text-[10px] font-medium text-gray-900
             border-t border-b border-gray-200 cursor-pointer
             Shows: "Today · 04 Apr" / "Yesterday · 03 Apr" / "28 Mar"

Right arrow: Same as left, rounded-r-[4px]
             Disabled (opacity-40) when viewing today
```

### Color Hierarchy in Header — CRITICAL

**ONE RULE: Only the active slot segment gets teal. Everything else is gray.**

| Color | Usage in header |
|---|---|
| `bg-teal-600` | Active slot segment ONLY. Download button (TI Report only). |
| `text-gray-900` / border-gray-900 | Active filter badge. Date label text. Title text. |
| `text-gray-400` / gray-500 | Clock, shortcuts icon, search, inactive segments, filter (inactive), date arrows, stats, dividers. |
| No other colors | No blue, no amber, no semantic colors in the header. |

**No slot selected = no teal in Row 2 = fully neutral header.**

### Keyboard Shortcuts (Universal)

These are handled by the UniversalHeader component:

| Key | Action |
|---|---|
| `/` | Focus search bar (preventDefault) |
| `?` | Toggle shortcuts panel |
| `Esc` | Close search / close panels |
| `1`-`4` | Jump to slot segment (toggle) |

Board-specific shortcuts (↑↓, Enter, C, S, P, etc.) are handled by the board component and passed to the shortcuts panel via the `shortcuts` prop.

### Shortcuts Panel

```
Position: absolute top-[52px] right-4 z-50
Container: bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-[220px]
Close on outside click or Esc.

Title: "Keyboard shortcuts" text-[11px] font-semibold text-gray-900 mb-2

Each row: flex justify-between py-[3px]
  Key:   text-[11px] font-mono text-gray-500 bg-gray-50 border border-gray-200
         rounded px-[6px] py-[1px]
  Label: text-[11px] text-gray-600

Universal shortcuts shown first, then board-specific (with divider between).
```

### Per-Board Configuration

| Board | Segments | Filter Groups | Date | leftExtra | rightExtra |
|---|---|---|---|---|---|
| Support | Slots (4) | View, Status, Del Type, Priority | Stepper | — | — |
| Tint Manager | Slots (4) | Del Type, Priority, Type, Operator | Stepper | — | View toggle |
| Planning | Slots (4) | Del Type, Dispatch Status | Stepper | — | — |
| Warehouse | Slots (4) | Del Type, Pick Status | Stepper | — | — |
| Mail Orders | Slots (4) | Status, Match, Dispatch | Stepper | — | — |
| Tint Operator | Status tabs (3) | — | None | — | — |
| TI Report | Date presets (3) | Tinter Type [, Operator] | None | Date range picker | — |
| Shade Master | — | Tinter Type, Status | None | — | — |

### Adding a New Board

When creating a new board page:
1. Import `UniversalHeader` from `@/components/universal-header`
2. Configure props per the table above
3. Content starts immediately after the header — no gap, no custom rows
4. Board handles ↑↓, Enter, and board-specific shortcuts internally
5. Pass board-specific shortcuts via the `shortcuts` prop for display in the panel

**NEVER create a custom header.** If the universal header is missing a feature, add a prop to the component — don't build a one-off.

---

## 7-18. [Unchanged from v4]

(Sidebar, Cards, Forms, Buttons, IosToggle, Login, Modal, Date Range Picker, Interactions, Screen-Specific Notes, Palette Sweep, Deprecated — refer to v4 for full content)

---

## 19. Smart Title Case (NEW v4.2)

All text from the database is stored as ALL CAPS (SAP convention). For display, apply `smartTitleCase()` from `lib/mail-orders/utils.ts`.

### Rules

**Keep UPPERCASE always:**
CO, CO., LLP, PVT, LTD, PVT., LTD., II, III, IV, HW, H/W, JSW, SAP, OBD, IGT, UPC

**Keep lowercase (except first word):**
and, of, the, for, in, at, to, by, an, or, on, with

**Preserve special characters:**
Words with `/` or `&` that are ≤5 chars stay uppercase (e.g. "H/W", "HARD.&")

### Apply to
| Field | Apply? |
|---|---|
| Customer name | ✓ Yes |
| SO name | ✓ Yes (also strip "(JSW)" prefix first) |
| Remarks | ✓ Yes |
| Area, Route (subtext) | ✓ Yes |
| Candidate/search result names | ✓ Yes |
| Customer codes | ✗ No (numeric) |
| Badges, column headers | ✗ No |

### SO Name cleanup
```
soName?.replace(/^\(JSW\)\s*/i, '').trim()
```

---

## 20. Lock Column (NEW v4.2)

Replaces the former "OD/CI" / "Flag" column on Mail Orders. Uses lucide-react icons.

**Unlocked:** LockOpen 14px text-gray-300 hover:text-gray-400
**Locked:** Lock 14px text-red-500 bg-red-50 rounded p-1

Click toggles. Currently local state only (not persisted).

---

## 21. Mail Order Code Column (NEW v4.2)

Three states based on customerMatchStatus:

**Exact:** Monospace badge, click copies, teal flash 1.5s. Pencil icon on hover for re-pick.
**Multiple:** Amber "N found" badge, click opens candidate picker popover.
**Unmatched:** "Search" link, click opens search popover with typeahead.

See v4.2 for full styling details.

---

## 22. Delivery Type Dot — Normalization (NEW v4.2)

Always normalize with `.toUpperCase()` before matching:

```typescript
"LOCAL"        → bg-blue-600, title="Local"
"UPC"          → bg-orange-600, title="Upcountry"
"IGT"          → bg-teal-600, title="IGT"
"CROSS"/"CROSS DEPOT" → bg-rose-600, title="Cross Depot"
null/empty     → no dot
```

Dot size: `w-[5px] h-[5px] rounded-full flex-shrink-0`.

---

## 23. Mail Order Customer Subtext (NEW v4.2)

```
Line 1: [dot] Customer Name (bold, smart title case)
Line 2: {subjectCode font-mono} · {Area title case} · {Route title case}
```

Order: subject code first, then area, then route. Separator "·" in text-gray-300.

---

## 24. Universal Header — Quick Reference (NEW v4.3)

**When building ANY new page or modifying ANY existing board:**

1. Use `<UniversalHeader />` — never build a custom header
2. Pass board config via props — title, stats, segments, filters, shortcuts
3. Content starts immediately after Row 2 — no gap row
4. Active slot = only teal in header. Everything else neutral.
5. 4 slots max: Morning, Afternoon, Evening, Night
6. Filter button with dropdown — no exposed filter pills in the header
7. Date stepper for date navigation — no date in the title
8. Search bar always present, always same position, / to focus
9. Clock always visible, always same position

**If you need a new header feature:**
Add a prop to `components/universal-header.tsx`. Do NOT create a parallel header.

---

*Version: v4.3 · Teal Brand System · Universal Header · Context v46 · April 2026*
*Customer matching · Smart Title Case · Lock icons · Code column · Delivery dot normalization*
*Universal header: segmented slots, unified filter, search, clock, date stepper, shortcuts*
