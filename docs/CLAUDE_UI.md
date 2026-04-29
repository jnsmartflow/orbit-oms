# CLAUDE_UI.md — Orbit OMS UI Design System
# v5.1 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md · April 2026
# Single source of truth for visual styling across all screens.

---

## 1. Design philosophy

- **Neutral first.** White bg, gray borders, minimal colour. Colour is reserved for semantic meaning and brand actions.
- **Teal is the brand.** `teal-600` (#0d9488) is the single brand accent. CTAs, focus rings, active nav, sidebar accent, logo, avatars, active slot segment, login dot. Nowhere else.
- **Old indigo theme (#1a237e) fully deprecated.**
- **Three colour roles:**
  - Teal = brand action (CTAs, focus, toggles ON, nav active, avatars, logo, active slot segment)
  - Gray = structure (borders, text hierarchy, slot pills, filter chips, page bg, clock, search, shortcuts, date stepper)
  - Semantic = status only (green=done, red=urgent/error/blocker, amber=waiting/timing)
- **Minimal chrome.** Header + controls in 2 rows max. No stat cards unless requested.
- **Smart Title Case for display.** All DB text rendered with `smartTitleCase()`. See §19.
- **Universal header on ALL boards.** See §6.

---

## 2. Teal brand system

| Token | Tailwind | Hex | Usage |
|---|---|---|---|
| Brand | `teal-600` | #0d9488 | CTAs, focus borders, active nav, sidebar accent, logo, avatars, active slot segment, IosToggle ON |
| Brand dark | `teal-700` | #0f766e | Hover on brand elements |
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
- ONE primary CTA per screen — teal-600
- Focus ring: `focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10`
- IosToggle ON: `bg-teal-600`
- Operator avatars: `bg-teal-600` (done = `bg-green-600`)
- Sidebar logo: `bg-teal-600 hover:bg-teal-700` with orbit SVG
- Sidebar accent: `borderLeft: "3px solid #0d9488"`
- OBD numbers: `text-gray-800 font-mono` (NOT teal)

---

## 3. Colour palette

### Core (structure)
| Token | Tailwind | Usage |
|---|---|---|
| Page bg | `bg-white` | Body, sidebar |
| App bg | `bg-[#f9fafb]` | Login, full-page boards |
| Surface | `bg-gray-50` | Info grids, column bgs, inputs |
| Border default | `border-gray-200` | Cards, dividers, rows |
| Text primary | `text-gray-900` | Customer names, headings |
| Text secondary | `text-gray-600` | Data values |
| Text muted | `text-gray-400` | Timestamps, labels |
| Text hint | `text-gray-300` | Placeholders, disabled |

### Semantic (status only)
| Purpose | Bg | Border | Text |
|---|---|---|---|
| Urgent | `bg-red-50` | `border-red-200` | `text-red-600` |
| Normal | `bg-gray-50` | `border-gray-200` | `text-gray-500` |
| Done/Dispatch | `bg-green-50` | `border-green-200` | `text-green-700` |
| Hold | `bg-red-50` | `border-red-200` | `text-red-700` |
| Waiting | `bg-amber-50` | `border-amber-200` | `text-amber-700` |
| Split | `bg-purple-50` | `border-purple-200` | `text-purple-700` |

### Delivery type dots
Always `.toUpperCase()` before matching.
| Type | Colour |
|---|---|
| Local | `bg-blue-600` |
| UPC (Upcountry) | `bg-orange-600` |
| IGT | `bg-teal-600` |
| Cross | `bg-rose-600` |

Dot: `w-[5px] h-[5px] rounded-full flex-shrink-0`.

### Tinter type dots
TINTER = `bg-blue-600`. ACOTONE = `bg-orange-500`. Same 5px pattern.

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

## 5. Borders and spacing

| Element | Classes |
|---|---|
| Card | `border border-gray-200 rounded-lg`, hover `border-gray-300` |
| Table wrapper | `rounded-lg border border-gray-200 overflow-hidden` with `px-4 py-3` |
| Table row | `border-b border-gray-50 hover:bg-gray-50/50` |
| Sidebar | `bg-white` + `borderLeft: "3px solid #0d9488"` + right `border-gray-200` |

No accent bars on cards. No zebra striping.

---

## 6. Universal header system

All boards use `<UniversalHeader />` from `components/universal-header.tsx`. Never custom.

### Row 1 (52px sticky top-0, z-30)
```
LEFT:  Title (14px semibold) · Stats (11px gray-400)
RIGHT: Clock IST HH:MM | ⌨ Shortcuts | [Download] | Search bar (180→260px)
```
Title accepts ReactNode (for view toggles). No date in title.

### Row 2 (40px sticky top-[52px], z-30)
```
LEFT:  Segmented control [+ leftExtra]
RIGHT: [rightExtra] | Filter ▾ | ‹ Date stepper ›
```

### Segmented control
Container: `inline-flex bg-gray-100 rounded-[7px] p-[3px] gap-[2px]`
Inactive: `text-gray-500`, hover `bg-white/60`
Active: `bg-teal-600 text-white font-medium`
Click active → deselects (show all). No "All" button. 4 slots max: Morning, Afternoon, Evening, Night. Filter out Next Day Morning.

### Filter button + dropdown
Inactive: `border border-gray-200 text-gray-500`
Active: `border-gray-900 text-gray-900` + count badge `bg-gray-900 text-white`
Panel: `bg-white border-gray-200 rounded-lg shadow-lg p-3 w-[260px]`
Active chip: `bg-gray-900 text-white`. Inactive chip: `bg-white text-gray-500 border-gray-200`.

### Date stepper
`‹ Today · 04 Apr ›` inline-flex. Right arrow disabled when viewing today.

### Colour rule (critical)
**ONE teal element: active slot segment.** Everything else gray. No slot = no teal in Row 2.

---

## 7. Sidebar — white + teal accent

Shell: `bg-white` + 3px teal left accent + right gray-200 border.
Logo button: `bg-teal-600 hover:bg-teal-700` with orbit SVG.
Active nav: `bg-teal-50 text-teal-700 font-semibold border-l-2 border-teal-600`.
Inactive: `text-gray-500 hover:bg-gray-50 hover:text-gray-900`.
User avatar: `bg-teal-600 hover:bg-teal-700`.

Behaviour spec: see `CLAUDE_CORE.md §13`.

---

## 8. Card components

Structure: Icon row → Badge row → Customer name → OBD row → Info grid → Operator row.
No accent bars. Customer missing: inline ⚠ (AlertCircle 14px amber).

---

## 9. Form inputs

Default: `h-[38px] px-3 text-[13px] border border-gray-200 rounded-lg`
Focus: `focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10`
Error: `border-red-300 ring-2 ring-red-500/6`

---

## 10. Buttons

Primary CTA: `bg-teal-600 hover:bg-teal-700 text-white h-[38px] rounded-lg`
Secondary: `bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 h-7 rounded-md`
Modal save: `bg-gray-900 hover:bg-gray-800 text-white` (NOT teal)
Tint Operator save CTAs: `bg-gray-900 text-white` (gray-900, not teal)
Tint Operator workflow CTAs: `bg-green-600 text-white` (start, done)

---

## 11. IosToggle

ON: `bg-teal-600`. OFF: `bg-gray-300`. Sizes: 36×20px compact, 46×26px large.

---

## 12. Login page

Page bg `bg-[#f9fafb]`, max-w-[340px]. Orbit logo + wordmark. No "Sign in" heading. Card `rounded-xl`. WebkitBoxShadow autofill override. Tagline: "One system. Zero chaos."

---

## 13. Modal pattern

Backdrop: `bg-black/40`. Panel: `bg-white rounded-lg shadow-xl w-[400px]`. Confirm button: `bg-gray-900` (not teal).

---

## 14. Date range picker

Used in TI Report. Presets: Today/Yesterday/This Week/This Month with `bg-teal-600` active. Calendar: `bg-teal-600` selected, `bg-teal-50` range. Download: `bg-teal-600`.

---

## 15-18. Interactions, screen notes, palette sweep, deprecated

Palette sweep complete (v41). All indigo/slate replaced.

---

## 19. Smart Title Case

Apply `smartTitleCase()` from `lib/mail-orders/utils.ts` to all DB text for display.

**Keep UPPERCASE:** CO, LLP, PVT, LTD, HW, H/W, JSW, SAP, OBD, IGT, UPC
**Keep lowercase (except first):** and, of, the, for, in, at, to, by

Apply to: customer name, SO name (strip "(JSW)" first), remarks, area, route, candidate names.
Do NOT apply to: codes, badges, column headers.

---

## 20. Lock column (Mail Orders)

Unlocked: LockOpen 14px `text-gray-300 hover:text-gray-400`
Locked: Lock 14px `text-red-500 bg-red-50 rounded p-1`
Auto-locks on OD, CI, Bill Tomorrow (word-boundary regex). Persisted to DB via `isLocked` on `mo_orders`.

---

## 21. Code column (Mail Orders)

Exact: mono badge `text-gray-800 bg-gray-50 border-gray-200`. Click copies, teal flash 1.5s. Pencil on hover.
Multiple: `text-amber-700 bg-amber-50 border-amber-200` "N found". Click → picker popover.
Unmatched: `text-gray-400` "Search". Click → search popover (320px, typeahead).

---

## 22. Delivery type dot normalization

Always `.toUpperCase()` before matching. Colours in §3.

---

## 23. Customer column (Mail Orders)

Line 1: [delivery dot] Customer Name (`text-[12.5px] font-semibold`). Split suffix "(A)"/"(B)".
Line 2: `text-[10px] text-gray-400` — Volume (mono, green/amber) · Area · Route.

---

## 24. Universal header quick reference

1. Use `<UniversalHeader />` — never custom
2. Title accepts ReactNode (for toggles)
3. Active slot = only teal. Everything else neutral.
4. 4 slots max. No "All" button.
5. Add features via props, never parallel headers.

---

## 25. Mail Order table column widths

Parent: `Time(68) | SO Name(120) | Customer(208) | Lines(68) | Dispatch(80) | Remarks(120) | Code(90) | SKU(82) | SO No.(110) | Lock(46) | Status(80) | Punched By(100)`

Expanded: `# (38) | Raw Text (30%) | SKU Code (130) | Description (30%) | Pk (48) | Qty (52) | Vol (56) | Status (76)`

---

## 26. Lines cell (Mail Orders)

Match count only: `{matched}/{total}`. Green if all matched, amber if not. Volume, split, warning moved out.

---

## 27-31. Split pair, batch copy, view original, split banner, line sort

- **Split pairs:** purple-400 left border, "✂ A/B" badge, "(A)"/"(B)" suffix
- **Batch copy:** `BATCH_COPY_LIMIT=14`. Progressive button "📋 1-14 (1/2)"
- **View Original:** toggle fetches both split halves. OriginalLinesTable with Group A/B pills
- **Line sort:** productName alphabetical → packSize DESC (>5 lines only)

---

## 32. Signal badges (Mail Orders remarks)

Shared builder: `getOrderSignals()` in `lib/mail-orders/utils.ts`. Single source of truth for Table View + Review View. Never build signal logic inline.

| Type | Style | Triggers |
|---|---|---|
| blocker | `bg-red-50 text-red-700 border-red-200` | OD, CI, Bounce |
| attention | `bg-amber-50 text-amber-700 border-amber-200` | Bill Tomorrow, Cross {CODE}, → Ship-to, Urgent, ⚠ Split |
| info | `bg-gray-50 text-gray-500 border-gray-200` | 7 Days, Extension, DPL, Challan, Truck |
| split | `bg-purple-50 text-purple-600 border-purple-200` | ✂ A/B |
| bill | `bg-blue-50 text-blue-700 border-blue-200` | Bill N (multiple captured, dedupe, sort ascending) |

Badge: `text-[9px] font-medium px-1.5 py-0.5 rounded border`. Flex wrap gap-0.5. Hover for full text.

Helper: `getBillLabel()` returns `"Bill N"` or `""` — used in email template and reply customer-name suffix.

---

## 33. Expanded footer (Mail Orders)

4 columns: `DELIVERY REMARKS | BILL REMARKS | ORDER NOTES | RECEIVED`
ORDER NOTES remark type badges: billing(amber), delivery(blue), contact(gray), instruction(gray), cross(purple), customer(teal), unknown(amber).

---

## 34. Bill sort order

`receivedAt` ASC (earliest first) → bill number ASC → split label (A before B). No dispatch weight.

---

## 35-38. (Reserved — formerly Focus Mode; deprecated April 2026)

Focus Mode view was discarded. Review View replaced it. Section numbers kept to preserve cross-references from older prompts. See §41-44 for current Review View spec and §43 for the current found/not-found toggle.

---

## 39. View toggle (Table / Review)

Rendered inside UniversalHeader title (ReactNode).

Container: `border border-gray-300 rounded-[5px] overflow-hidden`
Active: `bg-gray-800 text-white` (DARK — navigation, NOT teal)
Inactive: `bg-white text-gray-500 hover:bg-gray-50`
% badge after separator: ≥50% `bg-green-50 text-green-600`, <50% `bg-amber-50 text-amber-600`
Completed slots: "✓ Morning" prefix.

Two-button variant: `Table | Review`.

---

## 40. Fixed table layout standard — ALL data tables

All data tables use `table-layout: fixed` with `<colgroup>` percentage widths. This is the only approved pattern. Never auto-layout. Never pixel-width columns.

### Pattern
```tsx
<table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
  <colgroup>
    <col style={{ width: "4%" }} />
    <col style={{ width: "24%" }} />
    {/* percentages totalling ~100% */}
  </colgroup>
  <thead>...</thead>
  <tbody>...</tbody>
</table>
```

### Rules
- Always `table-layout: fixed` — predictable widths
- Always `<colgroup>` — widths defined once
- Always percentage widths — responsive, derived from fr-unit technique (4fr = 4%)
- Never pixel widths on columns — percentages only. Pixels allowed for cell padding and row height.
- Cell overflow: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` on all `<td>` and `<th>`.

### Standard row sizing
| Element | Value |
|---|---|
| Header row height | 32px |
| Data row height | 36px |
| Cell padding L/R | 14px (`px-3.5`) |
| First column padding | `pl-[10px] pr-[4px]`, text-align center |
| Last column padding | `pr-[12px]`, text-align center |
| Header border bottom | `1px solid #ebebeb` |
| Data row border bottom | `1px solid #f0f0f0` |
| First data row | `border-top: 4px solid transparent` |
| Last data row | `border-bottom: 4px solid transparent` |
| Header bg | `bg-gray-50` (#f9fafb) |
| Row hover | `bg-gray-50` (#f9fafb) |

### Standard header typography
```
font-size: 10px; font-weight: 500; text-transform: uppercase;
letter-spacing: 0.05em; color: #9ca3af (gray-400);
```

### Standard data typography
```
Primary: 11px, font-weight 500, #111827 (gray-900) — customer/product names
Secondary: 11px, #4b5563 (gray-600) — data values
Muted: 11px, #9ca3af (gray-400) — timestamps, line numbers, volumes
Mono: 11px, "SF Mono"/ui-monospace/Menlo — SKU codes, material numbers
```

### Applies to
- Review View SKU table (review-view.tsx) — 9 columns: 4/24/11/26/5.5/5.5/5.5/12/6.5%
- Mail Orders expanded table — 8 columns: # (38px) then percentages
- TM table view — 9 columns: #/OBD/SMU/Site Name/Priority/Articles/Volume/Operator/Time/Actions: 4/13/10/18/7/9/6/15/10/8%
- Any future data table in any module

---

## 41. Review View — layout

Component: `review-view.tsx`. Third view mode on `/mail-orders`.
Split panel: 320px left (order list) + flex-1 right (detail + table + footer).

### Left panel (320px)
- Search input: 28px height, 11px font, gray-200 border, teal focus ring
- Order rows: `px-3.5 py-2.5`, border-bottom gray-100, border-left 3px
- States: selected (`bg-teal-50 border-l-teal-600`), flagged (`border-l-amber-600`), punched (`opacity-40`), default (`border-l-transparent`)
- Line 1: delivery dot (5px) + customer name (13px semibold) + time (11px muted, right-aligned, tabular-nums)
- Line 2: SO name (11px muted)
- Badges: Bill N (blue) only. No blockers in left panel.
- Sort: `receivedAt ASC → bill number ASC → split label ASC`
- Punched divider: "▸ N punched", 10px text, bg-gray-50, collapsible

### Right panel — detail header
**Row 1** (`px-5 pt-3 pb-[7px]`): delivery dot (6px) → customer name (17px bold tracking-tight) → code chip (exact/multiple/unmatched) → match chip (green/amber) → dispatch badge → signal badges (all 5 types) → Order No. input group + Punch button.

**Row 2** (`px-5 pb-2.5`): meta (SO name · time · area · del type · volume · lines, 11px muted, dot-separated) → 3 icon-only action buttons (28×28, Copy/Reply/Flag, title tooltip).

### Right panel — SKU table
Fixed layout per §40. Columns: # / Raw Text / SKU Code / Description / Pk / Qty / Vol / Status / Toggle.

### Right panel — remarks footer
`bg-gray-50`, `border-top: 1px solid gray-200`, padding 8px 20px.
4 sections: Delivery / Bill / Notes / Received (60px fixed).
Labels 9px uppercase gray-400. Values 11px gray-600.
Notes section shows remark type badges (contact/instruction/cross/customer/unknown).

### Right panel — nav footer
36px height, border-top gray-200. ← Prev / "N of M" / Next → (26px buttons). Keyboard hints text (9px muted).

---

## 42. Review View — SKU table row states

**Normal:** raw text #374151, SKU mono #6b7280, product bold #111827 + base #6b7280, qty bold #374151.

**Partial:** description + SKU in amber (#b45309 / #d97706). PARTIAL tag: `9px font-semibold, bg-amber-50 text-amber-700 border-amber-200`.

**Not-found (toggle OFF):** all text #d1d5db EXCEPT qty stays #374151. Status cell shows reason label (`10px, bg-gray-50, border-gray-200`). No strikethrough.

**Unmatched:** description italic #9ca3af "No match found". UNMATCHED tag: `9px, bg-gray-50 text-gray-400 border-gray-200`. "Resolve →" link: `10px teal-600 font-medium`.

---

## 43. Review View — toggle and reason dropdown

**Toggle:** 28×14px, border-radius 7px. ON `bg-green-600`. OFF `bg-gray-300`. Knob: 10×10px white, `box-shadow: 0 1px 2px rgba(0,0,0,0.08)`, transition left 0.12s.

**Reason dropdown:** 148px wide, white bg, rounded-lg, `shadow: 0 4px 16px rgba(0,0,0,0.1)`, padding 3px. Options numbered 1-5 (mono 9px muted digit prefix): `out_of_stock`, `wrong_pack`, `discontinued`, `other_depot`, `other`. Divider before "Other". Options: 6px/10px padding, 11px font-medium, rounded-[5px], hover bg-gray-50.

API expects snake_case reason values — never display labels.

---

## 44. Review View — active line highlight

Background: `#fefce8` (yellow-50). First cell left border: `3px solid #eab308` (yellow-500). No outline.
`activeLineIndex` resets to 0 on order change.

---

## 45. Delivery Challan — split view

Left panel (320px): same pattern as Mail Orders Review View. Compact 3-line rows: OBD mono + challan badge / customer name / SMU dot + route + articles. Selected: `bg-teal-50 + border-l-teal-600`. No search in panel — handled by UniversalHeader.

Right panel: action bar (challan ID mono + OBD + customer gray-400 | Edit outline + Print dark) + challan document on #f9fafb background.

UniversalHeader: no segments. Filter groups: SMU (Retail Offtake / Decorative Projects) + Route. Date stepper. Search.

---

## 46. Delivery Challan — document (B&W print)

**Palette (document only):** #111827, #374151, #6b7280, #9ca3af, #d1d5db, #e5e7eb, #f0f0f0, #f9fafb, #fff. **NO teal. NO blue.**

**Logo:** CSS filter `grayscale(100%) brightness(0)` for pure black print.

**Structure:** Header (logo grayscale + DELIVERY CHALLAN centred + challan no.) → dark address bar (#374151, only dark section) → SMU/OBD/Warehouse fields → Bill To / Ship To (with #f9fafb sub-headers, billToAddress lookup via billToCustomerId) → Customer/SO/Receiver → Line items table → Footer (terms + transport + signatures) → bottom bar (regd office + GSTIN).

**Table:** `table-layout: fixed` with `<colgroup>`: 5/13/30/22/8/10/12%. Header 28px #f9fafb. Data rows 32px. Blank rows to minimum 8. Totals row with 2px top border.

---

## 47. TM table — §40 compliance

Columns: # / OBD / SMU / Site Name / Priority / Articles / Volume / Operator-Action / Time / Actions.
Widths: 4/13/10/18/7/9/6/15/10/8%.
Header: 9px 14px padding, `bg-gray-50`, border #ebebeb.
Data rows: 10px 14px padding, hover #fafafa, border #f0f0f0.
OBD cell: vertical-align top, two lines (OBD + date + age badge).
Operator avatar: 22×22px.
Section spacing: `mb-4` (16px between Pending/Assigned/In Progress/Completed sections).

First column `#`: 4% width, 1-based counter per section.

Age badge (both card + table views, all orders 1+ days old):
- 1 day: amber pill "1d" (`bg-amber-50 text-amber-700 border-amber-200`)
- 2+ days: red pill "Nd" (`bg-red-50 text-red-700 border-red-200`)
- IST-aware from `orderDateTime` (fallback to `obdEmailDate`).

Column header pills (all 4 kanban columns): neutral `bg-gray-100 text-gray-700 border-gray-200`.

---

## 48. Tint Operator v4 — layout

See `CLAUDE_TINT.md §3` for business behaviour. Visual spec here.

**Layout:**
- Row 1: UniversalHeader — title "My Jobs", stats (queue/active/done), clock, search
- Row 2: Job filter as **teal-600 segment pill** (leftExtra). Click opens 400px dropdown with scoreboard + queue cards. Progress bar (rightExtra): amber <25%, teal 25-75%, green >75%.
- Below Row 2: Bill To / Ship To as equal-width cards (`grid-cols-2`). Full customer names, no truncation.
- Main: 320px SKU left panel + flex TI form right. Mobile: left hidden below md.

**Colour budget (entire screen):**
- Teal: sidebar + job pill segment ONLY (navigation/identity)
- Gray-900: save CTAs + TINTER/ACOTONE toggle + selected card border
- Green-600: workflow CTAs (start, done)
- Amber: pending status accents (left border, coverage text, progress bar <25%)
- Pigment colours: shade grid cells ONLY (visual centrepiece)
- Everything else: white, gray-50, gray-100, gray-200, gray-400

**Left panel card states (final):**
- Selected: `bg-gray-100 border-l-[3px] border-l-gray-900`
- Unselected (all statuses): `bg-white border-gray-200 hover:bg-gray-50` — status via ✓ checkmark or Pending badge only, no coloured left borders

**CTA rules:**
- Save actions (Save TI, Update TI Entry): `bg-gray-900 text-white`
- Workflow actions (Save TI & Start, Start Job, Mark as Done): `bg-green-600 text-white`
- No teal on any CTA button. Buttons use natural width, `whitespace-nowrap`, `flex-shrink-0`. Never truncate.

---

## 49. Pigment shade cells (Tint Operator)

Each shade input has tinted background + 3px top border in actual pigment colour. `border-radius: 0 0 6px 6px` (flat top, rounded bottom). Filled cells (value > 0): deeper background + darker border.

Colour constants at top of `tint-operator-content.tsx`: `TINTER_SHADE_COLORS` and `ACOTONE_SHADE_COLORS` maps with `bg/bgFill/border/top/topFill/label` hex values per shade code.

### TINTER pigments (13 shades)
| Code | Pigment | Hex |
|---|---|---|
| YOX | Yellow Oxide PY42 | #b8860b |
| LFY | Light Fast Yellow PY3 | #cccc00 |
| GRN | Phthalocyanine Green PG7 | #2e7d32 |
| TBL | Thalo Blue PB15 | #1565c0 |
| WHT | Titanium White PW6 | #757575 |
| MAG | Magenta PR122 | #c2185b |
| FFR | Fast Fire Red PR254 | #d32f2f |
| BLK | Carbon Black PBk7 | #37474f |
| OXR | Oxide Red PR101 | #8d3c1a |
| HEY | Hansa Yellow PY1 | #c9a800 |
| HER | Hansa Red PR9 | #e53935 |
| COB | Cobalt Blue PB28 | #283593 |
| COG | Cobalt Green PG50 | #00695c |

### ACOTONE shades (14)
Naming: two-letter colour + strength number (2=strong, 1=standard).
YE2/YE1=yellows, XY1=amber, XR1=deep red, WH1=white, RE2/RE1=reds, OR1=orange, NO2/NO1=blacks, MA1=magenta-violet, GR1=green, BU2/BU1=blues.

---

## 50. Outlook email safety (mail order slot summary)

Non-negotiable for OWA paste survival:
- Zero `<div>`, zero `<p>`, zero margin
- `background-color` on `<td>` only (spans get stripped)
- `font-family` on every `<td>`
- No `border-radius`
- Nested `<table>` for layout
- Meta `format-detection` + `x-apple-disable-message-reformatting`

**Confirmed OWA behaviour:** paste strips `color:` on `<td>`. Hold order dimming (`#cbd5e1`) does not render. Only text suffixes survive.

**Rule:** All email additions must be plain text. No `<span>` styling for content. Use `zwsp()` to break iOS auto-link detection, `fmtTime()` for IST.

Sign-off: "Billing Team" (not Desk/Department). Phone hardcoded `+91 7435065023`.

---

*UI v5.1 · Fixed table standard · Review View · Challan B&W · Tint Operator v4 · Signal badges · April 2026*
