# CLAUDE_UI.md — OrbitOMS UI Design System
# v5.2 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md

Single source of truth for visual styling across all screens.

---

## 1. Design philosophy

- **Neutral first.** White bg, gray borders, minimal colour. Colour is reserved for semantic meaning and brand actions.
- **Teal is the brand.** `teal-600` (#0d9488) is the single brand accent. CTAs, focus rings, active nav, sidebar accent, logo, avatars, active slot segment, login dot.
- **Three colour roles:**
  - Teal = brand action (CTAs, focus, toggles ON, nav active, avatars, logo, active slot segment)
  - Gray = structure (borders, text hierarchy, slot pills, filter chips, page bg, clock, search, shortcuts, date stepper)
  - Semantic = status only (green=done, red=urgent/error/blocker, amber=waiting/timing)
- **Minimal chrome.** Header + controls in 2 rows max. No stat cards unless requested.
- **Smart Title Case for display.** All DB text rendered with `smartTitleCase()` (§19).
- **Universal header on ALL boards** (§6).

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

```
White (on teal bg): circle r=7 stroke, circle r=2.2 fill centre, circle r=2 fill at cx=18
Teal (on white bg): same shapes, stroke/fill="#0d9488"
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

### Attendance status chips
| Status | Colour |
|---|---|
| PRESENT | emerald |
| LATE / HALF_DAY | amber |
| INCOMPLETE / ABSENT | red |
| HOLIDAY / ON_LEAVE | blue |
| NOT_IN_YET / EXEMPT | gray |

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
Click active → deselects. No "All" button. 4 slots max.

### Filter button + dropdown
Inactive: `border border-gray-200 text-gray-500`
Active: `border-gray-900 text-gray-900` + count badge `bg-gray-900 text-white`
Panel: `bg-white border-gray-200 rounded-lg shadow-lg p-3 w-[260px]`
Active chip: `bg-gray-900 text-white`. Inactive chip: `bg-white text-gray-500 border-gray-200`.

### Date control
Click-to-open calendar popover. Format `‹ Today · 04 Apr ›` in trigger. Right arrow disabled when viewing today. Calendar lets users jump to any past date in one click. Boards passing `showDatePicker={false}` (Tint Manager, Tint Operator, TI Report, Shade Master) hide the date control entirely.

### Colour rule (critical)
**ONE teal element: active slot segment.** Everything else gray. No slot = no teal in Row 2.

---

## 7. Sidebar — white + teal accent

Shell: `bg-white` + 3px teal left accent + right gray-200 border.
Logo button: `bg-teal-600 hover:bg-teal-700` with orbit SVG.
Active nav: `bg-teal-50 text-teal-700 font-semibold border-l-2 border-teal-600`.
Inactive: `text-gray-500 hover:bg-gray-50 hover:text-gray-900`.
User avatar: `bg-teal-600 hover:bg-teal-700`.

Behaviour spec: `CLAUDE_CORE.md §11`.

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
Tint Operator save CTAs: `bg-gray-900 text-white`
Tint Operator workflow CTAs: `bg-green-600 text-white`

---

## 11. IosToggle

ON: `bg-teal-600`. OFF: `bg-gray-300`. Sizes: 36×20px compact, 46×26px large.

---

## 12. Login page

Page bg `bg-[#f9fafb]`, max-w-[340px]. Orbit logo + wordmark. No "Sign in" heading. Card `rounded-xl`. WebkitBoxShadow autofill override. Tagline: "One system. Zero chaos."

Login field accepts email OR 10-digit mobile. Label "Email or Mobile Number". Input `type="text"` (not `email` — browser blocks digit-only). `autoComplete="username"`. Field `id`/`name` remains `email` (auth contract).

---

## 13. Modal pattern

Backdrop: `bg-black/40`. Panel: `bg-white rounded-lg shadow-xl w-[400px]`. Confirm button: `bg-gray-900` (not teal).

---

## 14. Date range picker

Used in TI Report. Presets: Today/Yesterday/This Week/This Month with `bg-teal-600` active. Calendar: `bg-teal-600` selected, `bg-teal-50` range. Download: `bg-teal-600`.

---

## 15. Smart Title Case

Apply `smartTitleCase()` from `lib/mail-orders/utils.ts` to all DB text for display.

**Keep UPPERCASE:** CO, LLP, PVT, LTD, HW, H/W, JSW, SAP, OBD, IGT, UPC
**Keep lowercase (except first):** and, of, the, for, in, at, to, by

Apply to: customer name, SO name (strip "(JSW)" first), remarks, area, route, candidate names.
Do NOT apply to: codes, badges, column headers.

---

## 16. Mail Orders — lock column

Unlocked: LockOpen 14px `text-gray-300 hover:text-gray-400`
Locked: Lock 14px `text-red-500 bg-red-50 rounded p-1`
Auto-locks on OD, CI, Bill Tomorrow (word-boundary regex). Persisted via `isLocked` on `mo_orders`.

---

## 17. Mail Orders — code column

Exact: mono badge `text-gray-800 bg-gray-50 border-gray-200`. Click copies, teal flash 1.5s. Pencil on hover.
Multiple: `text-amber-700 bg-amber-50 border-amber-200` "N found". Click → picker popover.
Unmatched: `text-gray-400` "Search". Click → search popover (320px, typeahead).

---

## 18. Mail Orders — customer column

Line 1: [delivery dot] Customer Name (`text-[12.5px] font-semibold`). Split suffix removed from UI display (preserved in email text only).
Line 2: `text-[10px] text-gray-400` — Volume (mono, green/amber) · Area · Route.

---

## 19. Mail Orders — table column widths

Parent: `Time(68) | SO Name(120) | Customer(208) | Lines(68) | Dispatch(80) | Remarks(120) | Code(90) | SKU(82) | SO No.(110) | Lock(46) | Status(80) | Punched By(100)`

Expanded: `# (38) | Raw Text (30%) | SKU Code (130) | Description (30%) | Pk (48) | Qty (52) | Vol (56) | Status (76)`

---

## 20. Mail Orders — lines cell

Match count only: `{matched}/{total}`. Green if all matched, amber if not. Volume, split, warning moved out.

---

## 21. Mail Orders — split + batch copy

- **Split pairs:** purple-400 left border, "✂ Bill X-Y" badge. Display label rule: `splitLabel "A"→Bill 1`, `B→Bill 2`. Compound for sub-splits of parser-level bills: parent `Bill 2` + splitLabel `A` → `Bill 2-1`. DB `splitLabel` column unchanged. Helper: `getSplitDisplayLabel(order)` in `lib/mail-orders/utils.ts`.
- **Batch copy:** `BATCH_COPY_LIMIT=14`. Progressive button "📋 1-14 (1/2)"
- **View Original:** toggle fetches both split halves. OriginalLinesTable with Group A/B pills
- **Line sort:** productName alphabetical → packSize DESC (>5 lines only)

---

## 22. Mail Orders — signal badges

Shared builder: `getOrderSignals()` in `lib/mail-orders/utils.ts`. Single source of truth for Table View + Review View.

| Type | Style | Triggers |
|---|---|---|
| blocker | `bg-red-50 text-red-700 border-red-200` | OD, CI, Bounce |
| attention | `bg-amber-50 text-amber-700 border-amber-200` | Bill Tomorrow, Cross {CODE}, → Ship-to, Urgent, ⚠ Split |
| info | `bg-gray-50 text-gray-500 border-gray-200` | 7 Days, Extension, DPL, Challan, Truck |
| split | `bg-purple-50 text-purple-600 border-purple-200` | ✂ Bill X-Y |
| bill | `bg-blue-50 text-blue-700 border-blue-200` | Bill N |

Badge: `text-[9px] font-medium px-1.5 py-0.5 rounded border`. Flex wrap gap-0.5. Hover for full text.

Helper `getBillLabel()` returns `"Bill N"` or `""` — used in email template and reply customer-name suffix. `getOrderSignals` does NOT emit parent Bill N blue badge when `splitLabel` is set (purple ✂ badge already carries the info).

---

## 23. Mail Orders — expanded footer

4 columns: `DELIVERY REMARKS | BILL REMARKS | ORDER NOTES | RECEIVED`
ORDER NOTES remark type badges: billing(amber), delivery(blue), contact(gray), instruction(gray), cross(purple), customer(teal), unknown(amber).

---

## 24. Mail Orders — bill sort order

`receivedAt` ASC (earliest first) → bill number ASC → split label (A before B). No dispatch weight.

---

## 25. Mail Orders — view toggle (Table / Review)

Rendered inside UniversalHeader title (ReactNode).

Container: `border border-gray-300 rounded-[5px] overflow-hidden`
Active: `bg-gray-800 text-white` (DARK — navigation, NOT teal)
Inactive: `bg-white text-gray-500 hover:bg-gray-50`
% badge after separator: ≥50% `bg-green-50 text-green-600`, <50% `bg-amber-50 text-amber-600`
Completed slots: "✓ Morning" prefix.

Two-button variant: `Table | Review`.

---

## 26. Mail Orders — table row states

Normal pending: white. Focused: amber left border + bg-amber-50/70. Locked: red left border. Punched: teal left border + bg-teal-50/40 + opacity-75.

Punched orders separated to bottom per slot when slot selected. Collapsible "N punched ▸/▾" divider. `T` toggles globally.

---

## 27. Mail Orders — description toggle

In Review View SKU table header column, tiny `[long]` / `[short]` button. State `descMode: "long" | "short"` persisted to `localStorage` key `mo-review-desc-mode`. Default `"long"`. Long = `skuDescription` from SAP master. Short = `productName · baseColour`. Falls back to short when `skuDescription` is null.

---

## 28. Fixed table layout standard — ALL data tables

All data tables use `table-layout: fixed` with `<colgroup>` percentage widths. Only approved pattern.

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
- Always `table-layout: fixed`
- Always `<colgroup>`
- Always percentage widths
- Pixel widths only for cell padding and row height
- Cell overflow: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` on all `<td>` and `<th>`

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
`font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af`

### Standard data typography
- Primary: 11px, font-weight 500, #111827 — customer/product names
- Secondary: 11px, #4b5563 — data values
- Muted: 11px, #9ca3af — timestamps, line numbers, volumes
- Mono: 11px, "SF Mono"/ui-monospace/Menlo — SKU codes, material numbers

### Applies to
- Review View SKU table: 4/24/11/26/5.5/5.5/5.5/12/6.5%
- Mail Orders expanded table
- TM table view: 4/13/10/18/7/9/6/15/10/8%
- Challan line items: 5/13/35/15/8/12/12%
- Admin attendance roster
- Any future data table in any module

---

## 29. Review View — layout

Component: `review-view.tsx`. Master-detail third mode on `/mail-orders`.
Split panel: 320px left (order list) + flex-1 right (detail + table + footer).

### Left panel (320px)
- Search input: 28px height, 11px font, gray-200 border, teal focus ring
- Order rows: `px-3.5 py-2.5`, border-bottom gray-100, border-left 3px
- States: selected (`bg-teal-50 border-l-teal-600`), flagged (`border-l-amber-600`), punched (`opacity-40`), default (`border-l-transparent`)
- Line 1: delivery dot (5px) + customer name (13px semibold) + time (11px muted, right-aligned, tabular-nums)
- Line 2: SO name (11px muted)
- Punched orders: third line `✓ {Name} {HH:MM}` (text-gray-400)
- Badges: Bill N (blue) + split (purple) only
- Sort: `receivedAt ASC → bill number ASC → split label ASC`. Punched section sort DESC (most recent first).
- Punched divider: "▸ N punched", 10px text, bg-gray-50, collapsible

### Right panel — detail header
**Row 1** (`px-5 pt-3 pb-[7px]`): delivery dot (6px) → customer name (17px bold tracking-tight) → code chip → match chip → dispatch badge → signal badges → Order No. input group + Punch button.

**Row 2** (`px-5 pb-2.5`): on punched orders, prepended `✓ {name} {HH:MM}` as first meta item (gray-400). Then meta (SO name · time · area · del type · volume · lines, 11px muted, dot-separated) → 4 icon-only action buttons (28×28, Copy/Reply/Flag/Printer, title tooltip).

### Right panel — SKU table
Fixed layout per §28. Columns: # / Raw Text / SKU Code / Description / Pk / Qty / Vol / Status / Toggle.

### Right panel — remarks footer
`bg-gray-50`, `border-top: 1px solid gray-200`, padding 8px 20px.
4 sections: Delivery / Bill / Notes / Received (60px fixed).
Labels 9px uppercase gray-400. Values 11px gray-600.

### Right panel — nav footer
36px height, border-top gray-200. ← Prev / "N of M" / Next → (26px buttons). Keyboard hints text (9px muted).

### Active line highlight
Background: `#fefce8` (yellow-50). First cell left border: `3px solid #eab308` (yellow-500). No outline.
`activeLineIndex` resets to 0 on order change.

### Manual split banner
Amber banner between detail header and SKU table when `!splitLabel && (totalVol > 1500 || lines > 20)`. Shows Group A/B line-count + volume preview. Split button posts to `/api/mail-orders/{id}/split`. Dismiss is local state (resets on focus change).

---

## 30. Review View — SKU table row states

**Normal:** raw text #374151, SKU mono #6b7280, product bold #111827 + base #6b7280, qty bold #374151.

**Partial:** description + SKU in amber (#b45309 / #d97706). PARTIAL tag: `9px font-semibold, bg-amber-50 text-amber-700 border-amber-200`.

**Not-found (toggle OFF):** all text #d1d5db EXCEPT qty stays #374151. Status cell shows reason label (`10px, bg-gray-50, border-gray-200`). No strikethrough.

**Unmatched:** description italic #9ca3af "No match found". UNMATCHED tag: `9px, bg-gray-50 text-gray-400 border-gray-200`. "Resolve →" link: `10px teal-600 font-medium`.

---

## 31. Review View — toggle and reason dropdown

**Toggle:** 28×14px, border-radius 7px. ON `bg-green-600`. OFF `bg-gray-300`. Knob: 10×10px white, `box-shadow: 0 1px 2px rgba(0,0,0,0.08)`, transition left 0.12s.

**Reason dropdown:** 148px wide, white bg, rounded-lg, `shadow: 0 4px 16px rgba(0,0,0,0.1)`, padding 3px. Options numbered 1-5 (mono 9px muted digit prefix): `out_of_stock`, `wrong_pack`, `discontinued`, `other_depot`, `other`. Divider before "Other". Options: 6px/10px padding, 11px font-medium, rounded-[5px], hover bg-gray-50.

API expects snake_case reason values — never display labels.

---

## 32. Review View — print

4th icon-only action button (Printer, 28×28) in Row 2 action cluster. Calls `window.print()`. Print CSS scopes everything under `#mo-print-area`. Nav footer, action buttons, SkuToggle hidden via `.mo-print-hide` class. Print: A4 landscape, table-layout auto, overflow visible, 10px base / 9px headers (prevents truncation). Print footer: `OrbitOMS · JSW Dulux Surat Depot · Printed {IST date time}`. All rules scoped under `#mo-print-area` to avoid leaking into challan print.

---

## 33. Delivery Challan — split view

Left panel (320px): same pattern as Mail Orders Review View. Compact 3-line rows: OBD mono + challan badge / customer name / SMU dot + route + articles. Selected: `bg-teal-50 + border-l-teal-600`. No search in panel — handled by UniversalHeader.

Right panel: action bar (challan ID mono + OBD + customer gray-400 | Edit outline + Print dark) + challan document on #f9fafb background.

UniversalHeader: no segments. Filter groups: SMU + Route. Date stepper. Search.

---

## 34. Delivery Challan — document (B&W print)

**Palette (document only):** #111827, #374151, #6b7280, #9ca3af, #d1d5db, #e5e7eb, #f0f0f0, #f9fafb, #fff. **NO teal. NO blue.**

**Logo:** `/jsw-dulux-logo.png` (800×193, 101 KB, transparent PNG-24). Height 34px on web AND print. Container `paddingRight: 24px`. **Web view: NO inline filter (full colour).** **Print view: `filter: grayscale(100%) brightness(0) !important` via `@media print`.**

**Header layout:** Logo left · "DELIVERY CHALLAN" centred · Challan number + OBD date right column (`minWidth: 165`). Right column shows two stacked values: bold mono challan number, then small light date subtitle `DD MMM YYYY` (e.g. `29 Apr 2026`). Labels "CHALLAN NO." and "CHALLAN DATE" removed. Date source: `import_raw_summary.obdEmailDate`. Helper `formatObdDate(iso)` uses UTC getters.

**Structure:** Header → dark address bar (#374151, only dark section) → SMU/OBD/Warehouse fields → Bill To / Ship To (with #f9fafb sub-headers, billToAddress lookup via billToCustomerId) → Customer/SO/Receiver (S5) → Line items table → Footer (terms + transport + signatures) → bottom bar.

**S5 contact rendering:** When a contact resolves, name renders on line 1 (`fontSize 11, color #374151, marginTop 3`), phone on line 2 (`fontSize 10, color #6b7280, marginTop 1, fontFamily SF Mono`). If no contact, fallback `<div height:20>` preserves row height. Blank columns are valid output.

**Bottom bar:** `Regd. Office: <addr> · www.akzonobel.co.in · JSW Dulux Limited (formerly Akzo Nobel India Limited)`. Entity name hardcoded in `challan-document.tsx`.

**Table:** `table-layout: fixed` with `<colgroup>`: 5/13/35/15/8/12/12%. Header 28px #f9fafb. Data rows 32px. Blank rows to minimum 8. Totals row with 2px top border.

**Print CSS:** `@page` rules MUST be top-level in `globals.css` — cannot nest in `@media print`. Use `visibility: hidden` on body + `visibility: visible` on print area (not `display: none`).

---

## 35. TM table — §28 compliance

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

## 36. Tint Operator v4 — layout

Business behaviour: `CLAUDE_TINT.md §3`.

**Layout:**
- Row 1: UniversalHeader — title "My Jobs", stats (queue/active/done), clock, search
- Row 2: Job filter as **teal-600 segment pill** (leftExtra). Click opens 400px dropdown with scoreboard + queue cards. Progress bar (rightExtra): amber <25%, teal 25-75%, green >75%.
- Below Row 2: Bill To / Ship To as equal-width cards (`grid-cols-2`). Full customer names, no truncation.
- Main: 320px SKU left panel + flex TI form right. Mobile: left hidden below md.

**Colour budget (entire screen):**
- Teal: sidebar + job pill segment ONLY
- Gray-900: save CTAs + TINTER/ACOTONE toggle + selected card border
- Green-600: workflow CTAs (start, done)
- Amber: pending status accents
- Pigment colours: shade grid cells ONLY
- Everything else: white, gray-50, gray-100, gray-200, gray-400

**Left panel card states:**
- Selected: `bg-gray-100 border-l-[3px] border-l-gray-900`
- Unselected (all statuses): `bg-white border-gray-200 hover:bg-gray-50` — status via ✓ checkmark or Pending badge only, no coloured left borders

**CTA rules:**
- Save (Save TI, Update TI Entry): `bg-gray-900 text-white`
- Workflow (Save TI & Start, Start Job, Mark as Done): `bg-green-600 text-white`
- No teal on any CTA button. Buttons use natural width, `whitespace-nowrap`, `flex-shrink-0`.

---

## 37. Pigment shade cells (Tint Operator)

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

Toggle: "+ Show all 13" expands to full grid. "− Show active only" collapses back.

---

## 38. Place Order — top bar

Sticky 52px top bar. Layout: Logo+wordmark (left) · Customer pill (centre, `px-2.5 py-1`, `max-w-full min-w-0 truncate` on name) · Send button + cart counter (right). Wrapper around `<CustomerSearch>` must NOT have `overflow-hidden` (clips dropdown).

Page title: "Purchase Order (PO)" (in sidebar nav + top bar).

---

## 39. Place Order — speed dial

9-tile fixed grid (operator-curated). Tiles in order:
1. GLOSS · 2 SATIN · 3 PROMISE ENAMEL · 4 WS · 5 VT GLO · 6 WOODCARE · 7 STAINER · 8 PRIMER · 9 AQUATECH

Config: `lib/place-order/quick-tiles-config.ts`. Each tile: `{ position, type: "family", label, parentLabel, familyName }`.

Two render modes:
- **Browse mode** (`activeState.kind === "idle"`): full 9-tile grid
- **Work mode** (sub-product active): compact horizontal pill strip (~40px tall). Active pill gets teal-bordered visual + ▸ marker.

Digit shortcuts 1-9 always trigger their tile. No Tab cycle.

---

## 40. Place Order — variant grid card

Layout: subproduct tabs (top) · pack header row · base × pack matrix. Card never scrolls internally.

**Pack header:** single-line, 10.5px. Format `{pack} · {containerLabel}` where containerLabel is `box 12 | box 6 | box 4 | drum | bag` or null. Container label is mono gray-400. Helper: `packContainerLabel()` in `lib/place-order/pack.ts`.

**Pack columns:** explicit 80px width via `style={{ width: "80px" }}` on each `<col>` in colgroup (with `table-layout: fixed`).

**Pagination:** `VARIANT_GRID_PAGE_SIZE = 15`, `VARIANT_GRID_PAGINATION_THRESHOLD = 17`. Sub-products with `bases.length > 17` paginate at 15 per page. Page dots in card header (mouse). `Shift+PageDown`/`Shift+PageUp` (keyboard). Unshifted `PageDown`/`PageUp` cycle sub-products within family. Page state in parent, resets to 0 on subProductName/activeSubProduct change.

**Cell sizing:** 56×32, font 13px (fixed pixels).

---

## 41. Place Order — variant cell

Cell stores **UNITS** in `cart.packQtys[pack]`. Typing digits writes units directly.

**Keyboard inside cell:**
- 0-9 → write units (replaces value)
- `+` or `=` → `qty + boxSize` (one box up)
- `-` or `_` → `Math.max(0, qty - boxSize)` (one box down)
- All four `e.preventDefault()`. Native key-repeat handles hold-to-repeat.
- Arrow keys, Tab, Enter, Esc, PageUp/Down preserved

**Hover/focus +/− buttons:** 2 absolute `<button>` elements inside wrapper. Width 16px, height 14px. Position: `+` top-right (`right-[1px] top-[1px]`), `−` bottom-right (`right-[1px] bottom-[1px]`). Style: `text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-[2px] text-[11px] leading-none`. Visibility: `opacity-0` default, `opacity-100` on `group-hover` OR `[.group:focus-within_&]`. `tabIndex={-1}`. `onMouseDown={(e) => e.preventDefault()}` (keeps focus on input).

**Empty vs NA cells:** distinguishable visually (NA cells have different bg + cursor).

---

## 42. Place Order — cart panel

340px right column. Card list grouped by product/base. Pack chips per line.

**Chip format:** primary `×{units}` in `text-gray-700 font-mono font-semibold`. Conditional secondary `· {units / step} box` in `text-gray-400 font-normal ml-1` when `step > 1 && units > 0 && units % step === 0`. Examples: `×12 · 1 box` (clean), `×13` (non-clean), `×5` (step=1 drum, no suffix).

**Volume total formula:** `sum += units * packToLitres(pack)`. Do NOT multiply by `packStep` (that would double-count under unit semantics).

**Recently used:** shown only in browse state (`activeState.kind === "idle"`). Conditional on `touchedAt?: number` field on `CartLine` (set to `Date.now()` on every setQty path).

---

## 43. Place Order — page layout

Fixed-height, no vertical scroll anywhere. Root `h-screen overflow-hidden flex flex-col`. Top bar `flex-shrink-0`. Content `flex-1 overflow-hidden`. No internal scroll on variant grid card.

Viewport guard: `< 1024px` width redirects to `/order` mobile page on mount and resize.

---

## 44. Attendance — mobile PWA patterns

Full-screen, no sidebar. 480px max column, centred on tablet/desktop.

**Bottom nav (end users):** Today + History tabs. No Profile tab.

**Status chips:** per §3 colour map.

**Photo preview:** 240×320 face frame guide overlay during capture. Compressed client-side to 640px Q70 JPEG via `lib/attendance/photo.ts` canvas helper.

**Admin photo viewer:** lazy fetch signed URL (5min expiry) from `GET /api/admin/attendance/photo?recordId=N`. Never expose Supabase Storage bucket publicly.

**PWA manifest:** start_url `/attendance`. Icons: orbit logo on teal-600 bg, 192/512px PNG + apple-touch-icon. Source SVG at `public/icon-source.svg`. Generator `scripts/generate-icons.mjs` (@resvg/resvg-js, idempotent).

---

## 45. Outlook email safety (mail order slot summary)

Non-negotiable for OWA paste survival:
- Zero `<div>`, zero `<p>`, zero margin
- `background-color` on `<td>` only (spans get stripped)
- `font-family` on every `<td>`
- No `border-radius`
- Nested `<table>` for layout
- Meta `format-detection` + `x-apple-disable-message-reformatting`

**Confirmed OWA behaviour:** paste strips `color:` on `<td>`. Hold order dimming (`#cbd5e1`) does not render. Only text suffixes survive.

**Rule:** All email additions must be plain text. No `<span>` styling for content. Use `zwsp()` to break iOS auto-link detection, `fmtTime()` for IST.

Sign-off: "Billing Team". Phone hardcoded `+91 7435065023`.

---

*UI v5.2 · Fixed table standard · Review View · Challan B&W · Tint Operator v4 · Signal badges · Place Order · Attendance*
