# CLAUDE_UI.md — Orbit OMS UI Design System
# Load alongside CLAUDE_CONTEXT.md for all UI implementation sessions.
# This is the SINGLE SOURCE OF TRUTH for visual styling across all screens.
# Version: v5.0 · Teal Brand System · Universal Header · Focus Mode · April 2026
# Consolidated from v4 + v4.2 + v4.3 + v4.4 + v4.5 + v4.6 + v4.7

---

## 1. Design Philosophy

- **Neutral first.** White backgrounds, gray borders, minimal color. Color is reserved for semantic meaning and brand actions only.
- **Teal is the brand color.** `teal-600` (#0d9488) is the single brand accent. Appears on: CTAs, focus rings, active nav, sidebar accent bar, logo, user avatars, active slot segment, login dot. Nowhere else.
- **The old indigo theme (#1a237e) is FULLY DEPRECATED.** No exceptions.
- **Three color roles:**
  - **Teal** = brand action (CTAs, focus rings, toggles ON, nav active, avatars, logo, active slot segment)
  - **Gray** = structure (borders, text hierarchy, slot pills, filter chips, page bg, clock, search, shortcuts, date stepper)
  - **Semantic** = status only (green=done, red=urgent/error/blocker, amber=waiting/timing — never decoration)
- **Minimal chrome.** Header + controls in 2 rows max. No stat cards unless explicitly requested.
- **Text hierarchy drives scannability.** Darkest = primary identifier, medium = data, lightest = context.
- **Smart Title Case for display.** All user-facing text from DB rendered with smartTitleCase(). See §19.
- **Universal header for ALL boards.** Every screen uses `<UniversalHeader />`. No custom headers. See §6.

---

## 2. Brand Color — Teal System

| Token | Tailwind | Hex | Usage |
|---|---|---|---|
| Brand | `teal-600` | #0d9488 | CTAs, focus borders, active nav, sidebar accent, logo, avatars, active slot segment, IosToggle ON |
| Brand dark | `teal-700` | #0f766e | Hover state on brand elements |
| Brand tint bg | `teal-50` | #f0fdfa | Active nav bg, input focus ring wash |
| Brand tint border | `teal-200` | #99f6e4 | Active nav border accent |
| Brand text | `teal-700` | #0f766e | Active nav text, active tab text |

### Logo mark — Orbit symbol
```svg
White (on teal bg): circle r=7 stroke, circle r=2.2 fill centre, circle r=2 fill at cx=18 (orbiting dot)
Teal (on white bg): Same shapes, stroke/fill="#0d9488"
ViewBox: 0 0 22 22. Size: 22×22 (sidebar) or 18×18 (mobile).
```

### Brand rules
- ONE primary CTA per screen — always teal-600
- Focus ring: `focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10`
- IosToggle ON: `bg-teal-600`
- Operator avatars: `bg-teal-600` (done=`bg-green-600`)
- Sidebar logo: `bg-teal-600 hover:bg-teal-700` with orbit SVG
- Sidebar accent: `borderLeft: "3px solid #0d9488"`
- OBD numbers: `text-gray-800 font-mono` (NOT teal)

---

## 3. Color Palette

### Core colors (structure)
| Token | Tailwind | Usage |
|---|---|---|
| Page bg | `bg-white` | Body, sidebar |
| App bg | `bg-[#f9fafb]` | Login page, full-page boards |
| Surface | `bg-gray-50` | Info grids, column bgs, inputs |
| Border default | `border-gray-200` | Cards, dividers, inputs, rows |
| Text primary | `text-gray-900` | Customer names, headings |
| Text secondary | `text-gray-600` | Data values |
| Text muted | `text-gray-400` | Timestamps, labels |
| Text hint | `text-gray-300` | Placeholders, disabled |

### Semantic colors (status only)
| Purpose | Background | Border | Text |
|---|---|---|---|
| Urgent | `bg-red-50` | `border-red-200` | `text-red-600` |
| Normal | `bg-gray-50` | `border-gray-200` | `text-gray-500` |
| Done/Dispatch | `bg-green-50` | `border-green-200` | `text-green-700` |
| Hold | `bg-red-50` | `border-red-200` | `text-red-700` |
| Waiting | `bg-amber-50` | `border-amber-200` | `text-amber-700` |
| Split | `bg-purple-50` | `border-purple-200` | `text-purple-700` |

### Delivery type dots
| Type | Color | Normalize with `.toUpperCase()` |
|---|---|---|
| Local | `bg-blue-600` | |
| UPC | `bg-orange-600` | |
| IGT | `bg-teal-600` | |
| Cross | `bg-rose-600` | |
Dot: `w-[5px] h-[5px] rounded-full flex-shrink-0`

### Tinter type dots
TINTER = `bg-blue-600`, ACOTONE = `bg-orange-500`. Same 5px pattern.

---

## 4. Typography

| Element | Classes |
|---|---|
| Page title | `text-[14px] font-semibold text-gray-900` |
| Inline stats | `text-[11px] text-gray-400`, numbers `text-gray-900 font-semibold` |
| Card customer name | `text-[13.5px] font-bold text-gray-900` |
| OBD code | `font-mono text-[11px] text-gray-800` |
| Table header | `text-[10px] font-medium text-gray-400 uppercase tracking-wider` |
| Table data primary | `text-[11px] text-gray-900 font-medium` |
| Table data secondary | `text-[11px] text-gray-600` |
| Table data muted | `text-[11px] text-gray-400` |
| Badge text | `text-[10.5px] font-semibold` |
| Button (table) | `text-[11px] font-medium` |
| Button (card/primary) | `text-[13px] font-medium` |
| Timestamp / clock | `text-[11px] text-gray-400` |
| Form label | `text-[11px] font-medium text-gray-500` |

---

## 5. Borders & Spacing

| Element | Classes |
|---|---|
| Card | `border border-gray-200 rounded-lg`, hover: `border-gray-300` |
| Table wrapper | `rounded-lg border border-gray-200 overflow-hidden` with `px-4 py-3` |
| Table row | `border-b border-gray-50 hover:bg-gray-50/50` |
| Sidebar | `bg-white` + `borderLeft: "3px solid #0d9488"` + right `border-gray-200` |

NO accent bars on cards. NO zebra striping.

---

## 6. Universal Header System

ALL boards use `<UniversalHeader />` from `components/universal-header.tsx`. NEVER create custom headers.

### Row 1 (52px, sticky top-0, z-30)
```
LEFT:   Title (14px semibold) · Stats (11px gray-400)
RIGHT:  Clock (IST HH:MM) | ⌨ Shortcuts | [Download] | Search bar (180→260px)
```
Title accepts ReactNode (for Table/Focus toggle). No date in title.

### Row 2 (40px, sticky top-[52px], z-30)
```
LEFT:   Segmented control [+ leftExtra]
RIGHT:  [rightExtra] | Filter ▾ | ‹ Date stepper ›
```

### Segmented Control
Container: `inline-flex bg-gray-100 rounded-[7px] p-[3px] gap-[2px]`
Inactive: `text-gray-500`, hover `bg-white/60`
Active: `bg-teal-600 text-white font-medium`
Click active → deselects (show all). NO "All" button. 4 slots: Morning, Afternoon, Evening, Night. Filter out Next Day Morning.

### Filter Button + Dropdown
Inactive: `border border-gray-200`, text-gray-500
Active: `border-gray-900 text-gray-900` + count badge `bg-gray-900 text-white`
Panel: `bg-white border-gray-200 rounded-lg shadow-lg p-3 w-[260px]`
Active chip: `bg-gray-900 text-white`. Inactive: `bg-white text-gray-500 border-gray-200`

### Date Stepper
`‹ Today · 04 Apr ›` — arrows + label in compact inline-flex. Right arrow disabled when viewing today.

### Color Rule — CRITICAL
**ONE teal element: active slot segment.** Everything else gray. No slot = no teal in Row 2.

### Per-Board Config
| Board | Segments | Filters | Date | Extras |
|---|---|---|---|---|
| Support | Slots (4) | View, Status, Del Type, Priority | Stepper | — |
| Tint Manager | Slots (4) | Del Type, Priority, Type, Operator | Stepper | View toggle |
| Planning | Slots (4) | Del Type, Dispatch | Stepper | — |
| Warehouse | Slots (4) | Del Type, Pick Status | Stepper | — |
| Mail Orders | Slots (4) | Status, Match, Dispatch, Lock | Stepper | Column toggle, Table/Focus toggle in title |
| Tint Operator | Status tabs | — | None | — |
| TI Report | Date presets | Tinter Type, Operator | None | Date range (leftExtra), Download |
| Shade Master | — | Tinter Type, Status | None | — |

---

## 7. Sidebar — White + Teal Accent

Shell: `bg-white` + 3px teal left accent + right gray-200 border
Logo button: `bg-teal-600 hover:bg-teal-700` with orbit SVG
Active nav: `bg-teal-50 text-teal-700 font-semibold border-l-2 border-teal-600`
Inactive: `text-gray-500 hover:bg-gray-50 hover:text-gray-900`
User avatar: `bg-teal-600 hover:bg-teal-700`

---

## 8. Card Components

Structure: Icon row → Badge row → Customer name → OBD row → Info grid → Operator row
NO accent bars. Customer missing: inline ⚠ icon (AlertCircle 14px amber).

---

## 9. Form Inputs
Default: `h-[38px] px-3 text-[13px] border border-gray-200 rounded-lg`
Focus: `focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10`
Error: `border-red-300 ring-2 ring-red-500/6`

---

## 10. Buttons
Primary CTA: `bg-teal-600 hover:bg-teal-700 text-white h-[38px] rounded-lg`
Secondary: `bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 h-7 rounded-md`
Modal save: `bg-gray-900 hover:bg-gray-800 text-white` (NOT teal)

---

## 11. IosToggle
ON: `bg-teal-600`. OFF: `bg-gray-300`. Size: 36×20px (compact) or 46×26px (large).

---

## 12. Login Page
Page: `bg-[#f9fafb]`, max-w-[340px]. Orbit logo + wordmark. No "Sign in" heading. Card: `rounded-xl`. WebkitBoxShadow autofill override. Tagline: "One system. Zero chaos."

---

## 13. Modal Pattern
Backdrop: `bg-black/40`. Panel: `bg-white rounded-lg shadow-xl w-[400px]`. Confirm: `bg-gray-900` (not teal).

---

## 14. Date Range Picker
Used in TI Report. Presets: Today/Yesterday/This Week/This Month with `bg-teal-600` active. Calendar: `bg-teal-600` selected, `bg-teal-50` range. Download: `bg-teal-600`.

---

## 15-18. Interactions, Screen Notes, Palette Sweep, Deprecated

All palette sweep completed (v41). All indigo/slate fully replaced. See v4 for deprecated mapping table if needed.

---

## 19. Smart Title Case

Apply `smartTitleCase()` from `lib/mail-orders/utils.ts` to all DB text for display.
Keep UPPERCASE: CO, LLP, PVT, LTD, HW, H/W, JSW, SAP, OBD, IGT, UPC
Keep lowercase (except first): and, of, the, for, in, at, to, by
Apply to: customer name, SO name (strip "(JSW)" first), remarks, area, route, candidate names
NOT: codes, badges, column headers

---

## 20. Lock Column (Mail Orders)

Unlocked: LockOpen 14px `text-gray-300 hover:text-gray-400`
Locked: Lock 14px `text-red-500 bg-red-50 rounded p-1`
Auto-locks on OD, CI, Bill Tomorrow (word-boundary regex). Persisted to DB (isLocked).

---

## 21. Code Column (Mail Orders)

Exact: mono badge `text-gray-800 bg-gray-50 border-gray-200`. Click copies, teal flash 1.5s. Pencil on hover.
Multiple: `text-amber-700 bg-amber-50 border-amber-200` "N found". Click → picker popover.
Unmatched: `text-gray-400` "Search". Click → search popover (320px, typeahead).

---

## 22. Delivery Type Dot Normalization

Always `.toUpperCase()` before matching. See §3 for color table. Applies to all boards.

---

## 23. Customer Column (Mail Orders)

Line 1: [delivery dot] Customer Name (`text-[12.5px] font-semibold`). Split suffix "(A)"/"(B)".
Line 2: `text-[10px] text-gray-400` — Volume (mono, green/amber) · Area · Route

---

## 24. Universal Header Quick Reference

1. Use `<UniversalHeader />` — never custom headers
2. Title accepts ReactNode (for toggles)
3. Active slot = only teal. Everything else neutral.
4. 4 slots max. NO "All" button.
5. Add features via props, never parallel headers.

---

## 25. Mail Order Table — Column Widths

Parent: `Time(68) | SO Name(120) | Customer(208) | Lines(68) | Dispatch(80) | Remarks(120) | Code(90) | SKU(82) | SO No.(110) | Lock(46) | Status(80) | Punched By(100)`

Expanded: `# (38) | Raw Text (30%) | SKU Code (130) | Description (30%) | Pk (48) | Qty (52) | Vol (56) | Status (76)`

---

## 26. Lines Cell (Mail Orders)

Match count only: `{matched}/{total}`. Green if all matched, amber if not. Volume, split, warning all moved out.

---

## 27-31. Split Pair, Batch Copy, View Original, Split Banner, Line Sort

Split pairs: purple-400 left border, "✂ A/B" badge, "(A)"/"(B)" suffix.
Batch copy: BATCH_COPY_LIMIT=20. Progressive button "📋 1-20 (1/2)".
View Original: toggle fetches both split halves. OriginalLinesTable with Group A/B pills.
Sort: productName alphabetical → packSize DESC (>5 lines only).

---

## 32. Signal Badges (Mail Orders Remarks)

| Type | Style | Triggers |
|---|---|---|
| blocker | `bg-red-50 text-red-700 border-red-200` | OD, CI, Bounce |
| attention | `bg-amber-50 text-amber-700 border-amber-200` | Bill Tomorrow, Cross, Ship-to, Urgent, ⚠ Split |
| info | `bg-gray-50 text-gray-500 border-gray-200` | Truck, Challan, DPL, Bill N, 7 Days, Extension |
| split | `bg-purple-50 text-purple-600 border-purple-200` | ✂ A/B |

Badge: `text-[9px] font-medium px-1.5 py-0.5 rounded border`. Flex wrap gap-0.5. Hover for full text.

---

## 33. Expanded Footer (Mail Orders)

4 columns: `DELIVERY REMARKS | BILL REMARKS | ORDER NOTES | RECEIVED`
ORDER NOTES: remark type badges — billing(amber), delivery(blue), contact(gray), instruction(gray), cross(purple), customer(teal), unknown(amber).

---

## 34. Bill Sort Order

receivedAt (earliest first) → bill number → split label (A before B). No dispatch weight.

---

## 35. Focus Mode Card

Container: `max-w-2xl mx-auto`. Card: `bg-white border border-gray-200 rounded-xl` padding 20-24px.
Customer name: `text-xl font-bold text-gray-900`
Meta: `text-[11px] text-gray-500`. Code chip: `px-1.5 py-0.5 rounded bg-gray-100 font-mono text-[10px]`
Q/W buttons: `grid-cols-2 gap-8 py-10 rounded-lg border border-gray-200`
SO input: `h-44 border-[1.5px] border-gray-200 rounded-lg font-mono text-lg` focus: `border-teal-500`
Action: Dimmed `bg-gray-100 text-gray-400` → Active `bg-teal-600 text-white`
SKU summary: `border-t border-gray-100 py-3 mt-3 cursor-pointer`

Slide animation: 150ms ease-out translateX(±40px) + opacity. Direction-aware.

Card states: Active (pending), Flagged (amber border), Just Done (8s grace, teal border, countdown), Punched (browsing).

---

## 36. Focus Mode Progress Bar

Single bar for all queue sizes:
Container: `flex-1 h-1.5 bg-gray-200 rounded-full relative` (NO overflow-hidden)
Green fill: `absolute inset-y-0 left-0 bg-green-400 rounded-full` width=(punched/total)%
Teal dot: `absolute bg-teal-500 w-2.5 h-2.5 ring-2 ring-white` left=clamp(5px, position%, calc(100%-5px))
Text: "N/M" left, "N done" center-right, "List L" button right.

---

## 37. Focus Mode Navigation

Inline below card: `flex items-center justify-center gap-4 py-4 max-w-2xl mx-auto`
Prev/Next: `text-xs font-medium px-3.5 py-2 rounded-lg border`
Active: `text-gray-600 border-gray-200 bg-white hover:bg-gray-50`
Disabled: `text-gray-300 border-gray-100`
Position: `text-xs text-gray-400 font-medium "N of M"`

---

## 38. Focus Mode SKU Panel

Right panel. activeLineId: null=closed, -1=list, >0=detail.
Panel: `w-[360px] bg-white border-l border-gray-200 h-full overflow-y-auto`
Toggle: `w-7 h-4 rounded-full` green-500 (found) / red-500 (not found). Dot: w-3 h-3 bg-white.
Not found rows: `bg-red-50 hover:bg-red-100`. Reason badge (red). ALT badge (teal).

---

## 39. Table/Focus Toggle (Header)

Rendered inside UniversalHeader title (ReactNode):
Container: `border border-gray-300 rounded-[5px] overflow-hidden`
Active: `bg-gray-800 text-white` (DARK — navigation, NOT teal)
Inactive: `bg-white text-gray-500 hover:bg-gray-50`
% badge after separator: ≥50% `bg-green-50 text-green-600`, <50% `bg-amber-50 text-amber-600`
Completed slots: "✓ Morning" prefix.

---

*Version: v5.0 · Teal Brand System · Universal Header · Focus Mode · April 2026*
