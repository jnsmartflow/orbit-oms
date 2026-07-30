# CLAUDE_UI.md — OrbitOMS UI Design System
# v5.16 · July 2026 · updated 2026-07-30 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md

Single source of truth for visual styling across all screens.

---

## 1. Design philosophy

- **Neutral first.** White bg, gray borders, minimal colour.
- **Teal is the brand.** `teal-600` (#0d9488) is the single brand accent.
- **Three colour roles:**
  - Teal = brand action (CTAs, focus, toggles ON, nav active, avatars, logo, active slot segment)
  - Gray = structure (borders, text hierarchy, slot pills, filter chips)
  - Semantic = status only (green=done, red=urgent/error/blocker, amber=waiting/timing)
- **Minimal chrome.** Header + controls in 2 rows max.
- **Smart Title Case for display.** All DB text rendered with `smartTitleCase()` (§19).
- **One teal element rule** — except Sampling Library (§22), which is exempted.
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

### Core
| Token | Tailwind | Usage |
|---|---|---|
| Page bg | `bg-white` | Body, sidebar |
| App bg | `bg-[#f9fafb]` | Login, full-page boards, Review View page tint |
| Surface | `bg-gray-50` | Info grids, column bgs, inputs |
| Border default | `border-gray-200` | Cards, dividers, rows |
| Text primary | `text-gray-900` | Customer names, headings |
| Text secondary | `text-gray-600` | Data values |
| Text muted | `text-gray-400` | Timestamps, labels |
| Text hint | `text-gray-300` | Placeholders, disabled |

### Semantic
| Purpose | Bg | Border | Text |
|---|---|---|---|
| Urgent | `bg-red-50` | `border-red-200` | `text-red-600` |
| Normal | `bg-gray-50` | `border-gray-200` | `text-gray-500` |
| Done/Dispatch | `bg-green-50` | `border-green-200` | `text-green-700` |
| Hold | `bg-red-50` | `border-red-200` | `text-red-700` |
| Waiting | `bg-amber-50` | `border-amber-200` | `text-amber-700` |
| Split | `bg-purple-50` | `border-purple-200` | `text-purple-700` |
| Voided / Removed | `bg-red-50` | `border-red-300` | `text-red-700` (with diagonal watermark on challan) |

### Delivery type dots
| Type | Colour |
|---|---|
| Local | `bg-blue-600` |
| UPC (Upcountry) | `bg-orange-600` |
| IGT | `bg-teal-600` |
| Cross | `bg-rose-600` |

Dot: `w-[5px] h-[5px] rounded-full flex-shrink-0`.

### Tinter type dots
TINTER = `bg-blue-600`. ACOTONE = `bg-orange-500`.

### Attendance status chips
| Status | Colour |
|---|---|
| PRESENT | emerald |
| LATE / HALF_DAY | amber |
| INCOMPLETE / ABSENT | red |
| HOLIDAY / ON_LEAVE | blue |
| NOT_IN_YET / EXEMPT | gray |

### OT outcome banners (post-checkout)
| Status | Banner |
|---|---|
| AUTO_CREDITED | green — "OT credited: N min" |
| AUTO_CREDITED_GRACE | amber — "OT credited under grace · N of M used this month" |
| PENDING | amber — "OT submitted for admin approval · grace limit reached" |
| NOT_CLAIMED | no banner |

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

### SKU table wrapper pattern (Review View)

When wrapping an existing scrollable component:
- Wrapper provides `flex flex-col` context AND height containment via `min-h-0`
- Wrapped component keeps its `flex-1 overflow-y-auto`
- Wrapper bg `bg-white border border-gray-200 rounded-lg`

If either layer is missing, scroll breaks. Took 2 iterations to land — don't touch without understanding all 5 classes (`flex`, `flex-col`, `min-h-0`, `flex-1`, `overflow-y-auto`).

---

## 6. Universal header system

All boards use `<UniversalHeader />` from `components/universal-header.tsx`. Never custom.

**Named exception — `/floor` (Floor Control) is hand-rolled, deliberately.** `app/(floor)/floor/page.tsx` → `components/floor/floor-page.tsx` renders its OWN two-row header (Row 1: "Floor Control" title + IST date/time; Row 2: delivery-type scope chips + one search box + one filter) — no `<UniversalHeader />` anywhere in the floor tree. Reason: an approved divergence hand-rolled to the locked mockup `docs/mockups/floor-control/01-board.html` (scope chips + search/filter, a different shape from UniversalHeader's segmented control). This is ONE named exception, not a loosening of the rule — every other board still uses `<UniversalHeader />`. The screen itself is documented in `CLAUDE_FLOOR.md`; do not restate its layout here. Do not "fix" `/floor` back to `<UniversalHeader />`.

### Row 1 (52px sticky top-0, z-30)
Title (14px semibold) · Stats (11px gray-400) — left.
Clock IST HH:MM | ⌨ Shortcuts | [Download] | Search bar (180→260px) — right.
Title accepts ReactNode (for view toggles).

### Row 2 (40px sticky top-[52px], z-30)
Segmented control [+ leftExtra] — left.
[rightExtra] | Filter ▾ | ‹ Date stepper › — right.

### Segmented control
Container: `inline-flex bg-gray-100 rounded-[7px] p-[3px] gap-[2px]`
Inactive: `text-gray-500`, hover `bg-white/60`
Active: `bg-teal-600 text-white font-medium`
Click active → deselects. No "All" button. 4 slots max.

### Filter dropdown
Inactive: `border border-gray-200 text-gray-500`
Active: `border-gray-900 text-gray-900` + count badge `bg-gray-900 text-white`
Panel: `bg-white border-gray-200 rounded-lg shadow-lg p-3 w-[260px]`

**Multi-select group shape (2026-07-09, Support Filter rework):** a panel can hold several
independent groups (e.g. View / SMU / Delivery Type / Priority), each rendering its own options as
toggleable chips — multiple chips per group may be active at once (options within a group OR
together; groups AND together). The header count badge sums selections across **all** groups, not
per-group. **"Clear all"** renders inside the panel only when the total badge count is **> 0** —
hidden entirely at zero selections. (The pattern originated on the retired Support board; the
behaviour reference is archived at `archive/2026-07-support/docs/CLAUDE_SUPPORT.md §4.21`.)

### Date control
Click-to-open calendar popover. Format `‹ Today · 04 Apr ›`. Right arrow disabled when viewing today.

### Colour rule
**ONE teal element: active slot segment.** Sampling Library exempted (§22).

Per-board wiring summary:

| Board | Segments | Filters | Date | Extras |
|---|---|---|---|---|
| Support | Slots (4) | View, SMU, Del Type, Priority | Stepper | Search |
| Tint Manager | Operator pills | Del Type, Priority, Type | None | View toggle, missing-customer badge |
| Planning | Slots (4) | Del Type, Dispatch | Stepper | — |
| Warehouse | Slots (4) | Del Type, Pick Status | Stepper | — |
| Mail Orders | Slots (5) | Status, Match, Dispatch, Lock | Stepper | Column toggle, Table/Review toggle |
| Tint Operator | Job pill (teal, dropdown) | — | None | Progress bar (rightExtra) |
| TI Report | Date presets | Tinter Type, Operator | None | Date range, Download |
| Shade Master | — | Tinter Type, Status | None | — |
| Delivery Challan | — | SMU, Route | Stepper | Search |
| Sampling Library | Type (TINTER/ACOTONE) | Pack, Status | None | Month picker |
| Admin Import | — | — | Stepper | Upload |
| OT Pending | — | — | None | Status filter |
| OT Audit | — | — | Month | — |
| **Floor Control** | Scope chips (+ slot tabs in body) | Status / Flags | None | Search · **⚠ HAND-ROLLED, NOT `<UniversalHeader />`** — named exception above; → `CLAUDE_FLOOR.md` |

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

Age badge (1+ days old, on tint manager card + table):
- 1 day: amber pill "1d" (`bg-amber-50 text-amber-700 border-amber-200`)
- 2+ days: red pill "Nd" (`bg-red-50 text-red-700 border-red-200`)
- IST-aware from `orderDateTime`.

---

## 9. Form inputs

Default: `h-[38px] px-3 text-[13px] border border-gray-200 rounded-lg`
Focus: `focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10`
Error: `border-red-300 ring-2 ring-red-500/6`

**Mobile rule:** all `<input>` elements that may surface a keyboard must be `text-[16px]` minimum on EVERY mobile surface (`/po`, and any future mobile page). iOS WebKit auto-zooms anything smaller. Android Chrome does not, but the rule applies for consistency. (Written as an `/order` rule until 2026-07-27; it was never specific to that page.)

---

## 10. Buttons

Primary CTA: `bg-teal-600 hover:bg-teal-700 text-white h-[38px] rounded-lg`
Secondary: `bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 h-7 rounded-md`
Modal save (gray): `bg-gray-900 hover:bg-gray-800 text-white` (NOT teal)
Tint Operator save CTAs: `bg-gray-900 text-white`
Tint Operator workflow CTAs: `bg-green-600 text-white`
Operator Pause CTA: `bg-amber-600 hover:bg-amber-700 text-white`
Skip CTA: `bg-gray-100 hover:bg-gray-200 text-gray-700` (passive — never primary)
Remove OBD destructive confirm: `bg-red-600 hover:bg-red-700 text-white`

---

## 11. IosToggle

ON: `bg-teal-600`. OFF: `bg-gray-300`. Sizes: 36×20px compact, 46×26px large.

---

## 12. Login page

Page bg `bg-[#f9fafb]`, max-w-[340px]. Orbit logo + wordmark. No "Sign in" heading. Card `rounded-xl`. WebkitBoxShadow autofill override. Tagline: "One system. Zero chaos."

Login field accepts email OR 10-digit mobile. Label "Email or Mobile Number". Input `type="text"` (not `email` — browser blocks digit-only). `autoComplete="username"`. Field `id`/`name` remains `email` (auth contract).

---

## 13. Modal pattern

Backdrop: `bg-black/40`. Panel: `bg-white rounded-lg shadow-xl w-[400px]`. Confirm button: `bg-gray-900` (not teal). Destructive confirm: `bg-red-600`.

### Two-stage confirm (used by Mark Done partial qty, Remove OBD)

Stage 1: `[Cancel] [Confirm Done]` — default action visible.
Stage 2 (only if partial/risky): amber banner explains consequence → `[Back] [Yes, mark done]`.

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
Auto-locks on OD, CI, Bill Tomorrow. Persisted via `isLocked` on `mo_orders`.

---

## 17. Mail Orders — code column

Exact: mono badge `text-gray-800 bg-gray-50 border-gray-200`. Click copies, teal flash 1.5s.
Multiple: `text-amber-700 bg-amber-50 border-amber-200` "N found". Click → picker.
Unmatched: `text-gray-400` "Search". Click → search popover.

---

## 18. Mail Orders — customer column

Line 1: [delivery dot] Customer Name (`text-[12.5px] font-semibold`).
Line 2: `text-[10px] text-gray-400` — Volume (mono, green/amber) · Area · Route.

---

## 19. Mail Orders — table column widths

Parent: `Time(68) | SO Name(120) | Customer(208) | Lines(68) | Dispatch(80) | Remarks(120) | Code(90) | SKU(82) | SO No.(110) | Lock(46) | Status(80) | Punched By(100)`

Expanded: `# (38) | Raw Text (30%) | SKU Code (130) | Description (30%) | Pk (48) | Qty (52) | Vol (56) | Status (76)`

---

## 20. Mail Orders — signal badges (SignalPill component)

Shared component: `components/mail-orders/signal-pill.tsx`. Single source of truth.

`OrderSignal` interface:
```ts
{
  label: string;
  type: "blocker" | "attention" | "info" | "split" | "bill" | "status" | "truck-order";
  card: "bill" | "ship";   // routes to BillToCard or ShipToCard
  dot?: string;
}
```

| Type | Style | Triggers |
|---|---|---|
| blocker | `bg-red-50 text-red-700 border-red-200` | OD, CI, Bounce |
| attention | `bg-amber-50 text-amber-700 border-amber-200` | Bill Tomorrow, Cross XYZ, Urgent |
| info | `bg-gray-50 text-gray-500 border-gray-200` | 7 Days, Extension, DPL, Challan |
| split | `bg-purple-50 text-purple-600 border-purple-200` | ✂ Bill X-Y |
| bill | `bg-blue-50 text-blue-700 border-blue-200` | Bill N |
| status | rendered by ShipToCard | Hold (red), Dispatch (green), any dispatchStatus |
| truck-order | `bg-violet-50 text-violet-700 border-violet-200` | Truck-icon-only pill |

**Truck-order pill:** Lucide `Truck` 12×12, stroke-width 2. Icon-only. Tooltip `"Truck Order — punch when material received"`. 18px height, 4px border-radius, 5px horizontal padding.

Routing rules — every signal carries `card: "bill" | "ship"`:

| Signal | Card |
|---|---|
| OD / CI / Bounce / Bill N / Bill Tomorrow / Cross / ✂ Split / 7 Days / Extension / DPL / Truck Order | bill |
| Urgent / Challan / Hold / Dispatch (any dispatchStatus) | ship |

**Removed entirely:** `→ Ship-to` signal — replaced by amber left-bar + captured pill on ShipToCard.

---

## 21. Mail Orders — view toggle (Table / Review)

Rendered inside UniversalHeader title (ReactNode).

Container: `border border-gray-300 rounded-[5px] overflow-hidden`
Active: `bg-gray-800 text-white` (DARK — navigation, NOT teal)
Inactive: `bg-white text-gray-500 hover:bg-gray-50`
% badge after separator: ≥50% `bg-green-50 text-green-600`, <50% `bg-amber-50 text-amber-600`
Completed slots: "✓ Morning" prefix.

---

## 22. Per-screen teal exemption — Sampling Library

The "one teal element" rule (§6) does NOT apply on `/tint/sampling-library`. Teal is used intentionally across multiple elements for visual hierarchy: segment pill (TINTER/ACOTONE), variant tabs, PRIMARY pill, pack pill, Export links, recipe-history active row.

Reason: Sampling Library is a deep-domain page (not a depot ops board). The teal density signals "this is a curated reference workspace" vs operational boards. No other page has the same exemption today.

Other Sampling Library deviations:
- Status pills, variant tabs, large tabular numerals: `font-semibold` or `font-medium` (drops one weight from `font-bold` originally specced) to match cousin convention.

---

## 23. Mail Orders — table row states

Normal pending: white. Focused: amber left border + bg-amber-50/70. Locked: red left border. Punched: teal left border + bg-teal-50/40 + opacity-75.

Punched orders separated to bottom per slot when slot selected. Collapsible "N punched ▸/▾" divider. `T` toggles globally.

---

## 24. Mail Orders — description toggle

In Review View SKU table header column, tiny `[long]` / `[short]` button. State `descMode: "long" | "short"` persisted to `localStorage` key `mo-review-desc-mode`. Default `"long"`.

---

## 25. Mail Orders — Bill N split labels

DB column `splitLabel` stays `A`/`B`. UI shows via `getSplitDisplayLabel(order)`:
- splitLabel `A` → "Bill 1"
- splitLabel `B` → "Bill 2"
- Compound: parent `Bill 2` + splitLabel `A` → `Bill 2-1`

---

## 26. Mail Orders — bill sort order

`receivedAt` ASC → bill number ASC → split label (A before B).

---

## 27. Fixed table layout standard

All data tables use `table-layout: fixed` with `<colgroup>` percentage widths.

### Pattern
```tsx
<table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
  <colgroup>
    <col style={{ width: "4%" }} />
    <col style={{ width: "24%" }} />
  </colgroup>
  ...
</table>
```

### Rules
- Always `table-layout: fixed`
- Always `<colgroup>`
- Always percentage widths (pixel only for padding/row height)
- Cell overflow: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`

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

### Header typography
`font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af`

### Data typography
- Primary: 11px, font-weight 500, #111827 — customer/product names
- Secondary: 11px, #4b5563 — data values
- Muted: 11px, #9ca3af — timestamps, line numbers
- Mono: 11px, "SF Mono"/ui-monospace/Menlo — SKU codes, material numbers

### Applies to
- Review View SKU table: 4/24/11/26/5.5/5.5/5.5/12/6.5%
- Mail Orders expanded table
- TM table view: 4/13/10/18/7/9/6/15/10/8%
- Challan line items: 5/13/35/15/8/12/12%
- Admin attendance roster
- Admin OT pending queue
- Admin OT audit user table
- Sampling Library recipe table
- Any future data table in any module

**Support does NOT belong on this list.** Support's tables are CSS Grid, not `<table>` — see the
Grid-native equivalent rule below and `§58`.

### Grid-native equivalent — percentage tracks on CSS Grid (2026-07-09)

When a table is built as **CSS Grid rows instead of `<table>`** (each row its own independent grid
instance, e.g. Support), `table-layout:fixed` + `<colgroup>` isn't available — but the same
content-blind column sync can still be achieved: **percentage grid-template-columns tracks**,
one shared string constant read by both the header and every row.

**Why this is the only scheme that works** (the reusable lesson — full narrative + measured drift
numbers are archived at `archive/2026-07-support/docs/CLAUDE_SUPPORT.md §4.19`):
- `fr` distributes *leftover* space, which depends on row content — one row's long value pools
  surplus into a column and shifts everything right, in that row only.
- `minmax(0, Nfr)` stops one value inflating its own track but doesn't fix the pooled surplus.
- `max-content` sizes each grid instance to its OWN content — two rows with different cell content
  land the same column at different pixel positions (measured drift up to ~67px). Structurally
  impossible to align across independent grid instances.
- Fixed `px` works but is content-blind by luck, not design, and leaves guessed/dead space.
- **Percentages resolve against the container width, never cell content** — since every row
  renders at the same container width, the same percentage string yields identical pixel columns
  across every independent instance. This is the Grid-native equivalent of `<table>` +
  `table-layout:fixed` + `<colgroup>` percentages — use it for any future per-row-grid table.

Rule: one shared percentage-string constant, read by header AND every row; never reintroduce `fr`,
`max-content`, or `auto` on such a table once percentages are locked in.

---

## 28. Review View — layout

Component: `review-view.tsx`. Master-detail third mode on `/mail-orders`.
Split panel: 320px left (order list) + flex-1 right.

Page background: `bg-gray-50`. Cards + SKU table sit as white islands.

### Layout structure

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌─────────────────┐   ┌─────────────────┐                      │
│  │ BILL TO         │   │ SHIP TO  [⚑]    │  ← amber bar         │
│  │ ● Customer Name │   │ ● Customer Name │    if override       │
│  │   [code] · area │   │   [code] · area │                      │
│  │   [bill pills]  │   │   [ship pills]  │                      │
│  └─────────────────┘   └─────────────────┘                      │
├─────────────────────────────────────────────────────────────────┤
│  SO name · time · vol · ✓ 7/7 · punched · actions · SO# · Punch│
├─────────────────────────────────────────────────────────────────┤
│  ● delivery — "leave at gate"   ← gray-200 attention band      │
│  ● bill     — "split into 2"                                   │
│  ● notes    — "spoke to Mahesh"                                │
├─────────────────────────────────────────────────────────────────┤
│  Manual split banner (if triggered)                            │
├─────────────────────────────────────────────────────────────────┤
│  [ SKU TABLE — inside white wrapper on gray-50 page ]          │
└─────────────────────────────────────────────────────────────────┘
```

### Left panel (320px)

- Search input: 28px height, 11px font
- Order rows: `px-3.5 py-2.5`, border-bottom gray-100, border-left 3px
- States: selected (`bg-teal-50 border-l-teal-600`), flagged (`border-l-amber-600`), punched (`opacity-40`), default (`border-l-transparent`)
- Line 1: delivery dot + customer name (13px semibold) + time (right, tabular-nums)
- Line 2: SO name (11px muted)
- Punched orders: third line `✓ {Name} {HH:MM}` (text-gray-400)
- Badges: Bill N (blue) + split (purple) only
- Sort: `receivedAt ASC → bill number ASC → split label ASC`. Punched section sort DESC.

### BillToCard component

Props:
```ts
{
  customerName, customerCode, customerArea,
  customerMatchStatus: "exact" | "multiple" | "unmatched" | null,
  deliveryType,
  signals: OrderSignal[],       // bill-class only
  onCodeClick?: () => void,
  popoverSlot?: React.ReactNode,
  chipFallbackLabel?: string,
}
```

Match status modifies code chip background:
- `exact` → gray (`bg-gray-100 border-gray-200 text-gray-700`)
- `multiple` → amber + `chipFallbackLabel="N found ▾"`
- `unmatched` → red + `chipFallbackLabel="Search…"`

Popover content (candidate list, search) is passed verbatim as `popoverSlot`.

### ShipToCard component

Props:
```ts
{
  shipToName, shipToCode, shipToArea, deliveryType,
  isOverride: boolean,
  signals: OrderSignal[],   // delivery-class only
}
```

- `isOverride=false` → mirrors Bill-to fully (code chip gray default, NOT match-modulated)
- `isOverride=true` → 3px amber left bar via `before:` pseudo + small amber `⚑ captured` pill inline with "SHIP TO" label

### MetaRibbon component

`px-5 pt-3 pb-[7px]`. SO name · time · vol · ✓ N/M · `✓ {Name} {HH:MM}` (if punched) · 4 icon-only action buttons (28×28: Copy/Reply/Flag/Printer) · SO Number input slot · Punch button slot.

### InstructionsStrip component

`bg-gray-50`, `border-top: 1px solid gray-200`, padding 8px 20px. Returns null when all three values are null/empty.

```
● delivery (amber dot)  — from deliveryRemarks minus [→ Name (Code)] suffix
● bill     (blue dot)   — from billRemarks
● notes    (gray dot)   — from remarks
```

### Active line highlight

Background `#fefce8` (yellow-50). First cell left border `3px solid #eab308` (yellow-500). `activeLineIndex` resets to 0 on order change.

### Manual split banner

Amber banner between detail header and SKU table when `!splitLabel && (totalVol > 1500 || lines > 20)`. Group A/B preview. Split button posts to `/api/mail-orders/{id}/split`. Pooler retry-poll loop (5 × 400ms) handles read-after-write lag.

### Print

4th icon-only action button (Printer, 28×28). Calls `window.print()`. Print CSS scoped under `#mo-print-area`. Nav footer + action buttons + SkuToggle hidden via `.mo-print-hide`. Print: A4 landscape, 10px base, footer `OrbitOMS · JSW Dulux Surat Depot · Printed {IST date time}`.

---

## 29. Review View — SKU row states

**Normal:** raw text #374151, SKU mono #6b7280, product bold #111827, qty bold #374151.

**Partial:** description + SKU in amber (#b45309 / #d97706). PARTIAL tag: `9px font-semibold, bg-amber-50 text-amber-700 border-amber-200`.

**Not-found (toggle OFF):** all text #d1d5db EXCEPT qty stays #374151. Status cell shows reason label.

**Unmatched:** description italic #9ca3af "No match found". UNMATCHED tag. "Resolve →" link: `10px teal-600 font-medium`.

---

## 30. Review View — toggle + reason dropdown

**Toggle:** 28×14px. ON `bg-green-600`. OFF `bg-gray-300`. Knob 10×10px white.

**Reason dropdown:** 148px wide, white bg, rounded-lg. Options numbered 1-5: `out_of_stock`, `wrong_pack`, `discontinued`, `other_depot`, `other`. API expects snake_case — never display labels.

---

## 31. Delivery Challan — split view

Left panel (320px): compact 3-line rows: OBD mono + challan badge / customer name / SMU dot + route + articles. Selected: `bg-teal-50 + border-l-teal-600`. No search in panel.

Right panel: action bar (challan ID mono + OBD + customer gray-400 | Edit outline + Print dark) + challan document on `#f9fafb`.

UniversalHeader: no segments. Filter groups: SMU + Route. Date stepper. Search.

### Voided challan rendering

When `delivery_challans.isVoided === true`:
- Diagonal red watermark across document body (`VOIDED` text, ~30% opacity, 45° rotation)
- Print button + PDF action disabled
- Red banner above document: `VOIDED · {voidReason} · {voidRemark} · by {name} on {DD MMM YYYY HH:MM}`
- Document still rendered (audit trail)

---

## 32. Delivery Challan — document (B&W print)

**Palette (document only):** #111827, #374151, #6b7280, #9ca3af, #d1d5db, #e5e7eb, #f0f0f0, #f9fafb, #fff. **NO teal. NO blue.**

**Logo:** `/jsw-dulux-logo.png` (800×193, 101 KB, transparent PNG-24). Height 34px on web AND print. Container `paddingRight: 24px`. **Web view: NO inline filter (full colour).** **Print view: `filter: grayscale(100%) brightness(0) !important` via `@media print`.**

**Header layout:** Logo · "DELIVERY CHALLAN" centred · Challan number + OBD date right column (`minWidth: 165`). Right column: bold mono challan number stacked over light `DD MMM YYYY`. Labels removed.

**Structure:** Header → dark address bar (#374151, only dark section) → SMU/OBD/Warehouse fields → Bill To / Ship To (with #f9fafb sub-headers, billToAddress lookup via billToCustomerId) → Customer/SO/Receiver (S5) → Line items table → Footer.

**S5 contact rendering:** Name line 1 (`fontSize 11, color #374151, marginTop 3`), phone line 2 (`fontSize 10, color #6b7280, marginTop 1, fontFamily SF Mono`). Fallback `<div height:20>` preserves row height.

**Bottom bar:** `Regd. Office: <addr> · www.akzonobel.co.in · JSW Dulux Limited (formerly Akzo Nobel India Limited)`.

**Table:** `<colgroup>` 5/13/35/15/8/12/12%. Header 28px #f9fafb. Data rows 32px. Blank rows to minimum 8. Totals row 2px top border.

**Print CSS:** `@page` rules MUST be top-level in `globals.css` — cannot nest in `@media print`. Use `visibility: hidden` on body + `visibility: visible` on print area (not `display: none`).

---

## 33. TM table

Columns: # / OBD / SMU / Site Name / Priority / Articles / Volume / Operator-Action / Time / Actions.
Widths: 4/13/10/18/7/9/6/15/10/8%.

First column `#`: 4% width, 1-based counter per section.
Column header pills (all 4 kanban columns): neutral `bg-gray-100 text-gray-700 border-gray-200`.

Soft-removed OBD pills (when admin views removed-orders list): red `Removed · {reason}`.
Paused OBD pill (stage-agnostic, both kanban + table): amber `⏸ Paused (N/3)`.
Skipped OBD pill (pending stage only): gray `↩ Skipped {N}×`.

---

## 34. Tint Operator v4 — layout

Business behaviour: `CLAUDE_TINT.md §3`.

- Row 1: UniversalHeader — title "My Jobs", stats, clock, search
- Row 2: Job filter as **teal-600 segment pill** (leftExtra). Click opens 400px dropdown with 3 labelled sections: CURRENT / PAUSED / UP NEXT. Progress bar (rightExtra): amber <25%, teal 25-75%, green >75%.
- Below Row 2: Bill To / Ship To as equal-width cards (`grid-cols-2`)
- Main: 320px SKU left panel + flex TI form right. Mobile: left hidden below md.

**Colour budget:**
- Teal: sidebar + job pill segment ONLY (shared universal-header segmented control stays teal)
- Gray-900: save CTAs + selected card border
- Green-600: workflow CTAs (start, done)
- Amber-600: Pause CTA + paused-card amber accents
- Pigment colours: shade grid cells ONLY
- **Fini/Generic + Tinter/Acotone toggles → white-pill on gray-100 track** (active `bg-white text-gray-900 shadow-sm`), NOT `bg-gray-900`.
- **Reuse-list "Use" buttons → soft grey** (`bg-gray-200 text-gray-800`), not `bg-gray-900`.
- Everything else: white, gray-50, gray-100, gray-200, gray-400

**Status badges removed:** "Assigned" job-header badge removed ("In Progress" retained); "Pending" line-card pill → plain `text-amber-700 font-semibold` text (no box).

**Left panel card states:**
- Selected: `bg-gray-100 border-l-[3px] border-l-gray-900`
- Unselected: `bg-white border-gray-200 hover:bg-gray-50`

**CTA rules:**
- Save (Save TI, Update TI Entry): `bg-gray-900 text-white`
- Workflow (Save TI & Start, Start Job, Mark as Done): `bg-green-600 text-white`
- Pause: `bg-amber-600 text-white`
- Skip: passive ghost `bg-gray-100 text-gray-700`

### Search-first sampling reuse list

Single search row at parent level: `[PACK ▾] [Search…] [+ Add shade]`. Below it, a single **flat** suggestion list (`flat-suggestion-list.tsx`) — not the old exact/reference two-section split. Per-entry view mode `browse | confirm | newshade` (collapses on pick so the TI form never sits under a long list). Behaviour: `CLAUDE_TINT.md` / `CLAUDE_SAMPLING_LIBRARY.md`.

- **Columns** (fixed-table, §27): Sampling · Shade · Site · PACK · LAST USED · FORMULA (chips only) · Use.
- **Exact row** pinned top: `bg-[#eef1f4]` wash + `border-l-[3px] border-l-gray-900` + grey EXACT chip; pigment chips white-bg.
- **Reuse heading:** `text-gray-900 font-semibold` "REUSE A SHADE — ANY SITE".
- **Tinter-type tag** per card: TINTER (grey) / ACOTONE (orange).
- **PACK filter dropdown** (defaults to the line's pack bucket): `All packs · {total}`, then `1 LT`, `4 LT`, `10 LT`, `20 LT` — each `{n} LT · {count}`, the line's bucket tagged `· LINE`, 0-count buckets disabled. Four **nominal buckets only** (1/4/10/20 via `packDoseLitres`; folds 3.6/3.7→4, 0.9/0.925→1, 9/9.25→10, 18/18.5→20); rare packs (0.5/15/22/30/40/null) appear only under "All packs".
- **PACK pill** shows the NOMINAL label (a 3.7L/18L shade reads "4 LT"/"20 LT"). **Green** = same bucket as the line (exact fit); **grey** = different bucket (formula auto-scales to the line pack on **Use**, TINTER only). The list shows **raw stored values** — it is a FILTER, not an auto-scaler.
  - ⚠️ Superseded: the earlier flat "scale-everything-to-line-pack with ✓ (exact) / ×N (scaled) markers" list and the `scalingEnabled` prop are **removed** — do not reintroduce.
- **"Same shade found" / reuse modal** (`formula-match-modal.tsx`): scaled matched rows; **Cancel / Esc / backdrop aborts with NO new sampling number** — only **Use** (reuse, scaled) and **Create new** mint/save.

---

## 35. Pigment shade cells (Tint Operator)

Each shade input has tinted background + 3px top border in actual pigment colour. `border-radius: 0 0 6px 6px` (flat top, rounded bottom).

Colour constants at top of `tint-operator-content.tsx`: `TINTER_SHADE_COLORS` and `ACOTONE_SHADE_COLORS` maps.

### TINTER pigments (13)
| Code | Pigment | Hex |
|---|---|---|
| YOX | Yellow Oxide | #b8860b |
| LFY | Light Fast Yellow | #cccc00 |
| GRN | Phthalocyanine Green | #2e7d32 |
| TBL | Thalo Blue | #1565c0 |
| WHT | Titanium White | #757575 |
| MAG | Magenta | #c2185b |
| FFR | Fast Fire Red | #d32f2f |
| BLK | Carbon Black | #37474f |
| OXR | Oxide Red | #8d3c1a |
| HEY | Hansa Yellow | #c9a800 |
| HER | Hansa Red | #e53935 |
| COB | Cobalt Blue | #283593 |
| COG | Cobalt Green | #00695c |

### ACOTONE shades (14)
YE2/YE1, XY1, XR1, WH1, RE2/RE1, OR1, NO2/NO1, MA1, GR1, BU2/BU1.

Toggle: "+ Show all 13" expands. "− Show active only" collapses.

---

## 36. PauseJobModal (Tint Operator)

Used when operator pauses a `tinting_in_progress` job.

- 5 vertical radios: `lunch_break / shift_end / machine_breakdown / material_shortage / urgent_priority`
- Optional remark with 500-char counter
- Per-SKU steppers (whole int, `0 ≤ doneQty ≤ assignedQty`)
- Soft-cap red banner shown when this would be pause #3 of 3 on this job
- Amber-600 CTA "Pause Job"
- Sonner toast on success

---

## 37. PauseHistoryModal + SkipHistoryModal (TM side)

Both use same shell: chronological list (oldest first), one row per event.

**PauseHistoryModal row:** date+time · paused-by name · reason chip · remark · progress snapshot · elapsedAtPause minutes · resumeAt or "still paused" badge.

**SkipHistoryModal row:** date+time · skipped-by name · reason chip · tinter-type (if `TINTER_FINISHED`) · out-of-stock colours (chips) · remark · "Reassigned by {name} at {time}" trailing line if applicable.

Modal trigger from 5 entry points: Kanban PAUSED pill, "View full pause history" link, Kanban kebab item, Table badge click, Table kebab item.

---

## 38. MarkDoneConfirmModal (Tint Operator)

Per-SKU steppers pre-filled with `assignedQty`. "Total tinting time" summary line (`accumulatedMinutes` + final segment).

Two-stage confirm:
1. `[Cancel] [Confirm Done]` — visible always
2. If any SKU `doneQty < assignedQty` → amber banner "Short by N tins. Continue?" → `[Back] [Yes, mark done]`

Server validates `0 ≤ doneQty ≤ unitQty` per SKU + writes `currentProgress` snapshot.

---

## 39. RemoveObdModal (TM)

Two predefined reasons (radios): `CUSTOMER_CANCELLED`, `WRONG_ORDER`.
Mandatory free-text remark (500-char limit).
Warning banner: "Linked delivery challan will be voided."
Destructive confirm: `bg-red-600 text-white`.

Only available when `workflowStage === 'pending_tint_assignment'`. Server returns 409 otherwise.

---

## 40. OT prompt screens (check-out)

Used in `/attendance/check-out` flow when current IST hour >= `otCutoffHourIST`.

### Choice screen
"Were you doing overtime work?" + amber callout with current time + trigger time.
Two buttons: "Yes, claim OT" (teal `bg-teal-600`) / "No, just clocking out" (white outline).
"Cancel and go back" link returns to camera (photo discarded).

### Reason screen
Textarea, amber callout showing "N min overtime so far".
Submit enabled when reason has non-whitespace content (1+ char).
Back link returns to choice (reason discarded).

### Success banners (DaySummaryView)

Per §3 OT outcome banners table.

---

## 41. Place Order — top bar

Sticky 52px. Logo+wordmark left · Customer pill centre (`px-2.5 py-1`, `max-w-full min-w-0 truncate`) · Send button + cart counter right. Wrapper around `<CustomerSearch>` must NOT have `overflow-hidden`.

Page title: "Purchase Order (PO)" (in sidebar nav + top bar).

---

## 42. Place Order — speed dial

9-tile fixed grid. Tiles in order:
`1 GLOSS · 2 Satin & PU · 3 PROMISE · 4 WS · 5 VELVET TOUCH · 6 SADOLIN · 7 STAINER · 8 Putty & Primer · 9 AQUATECH`

Some tiles are multi-family (one card, several families' tabs): "Satin & PU", "Putty & Primer". Spec: `CLAUDE_PLACE_ORDER.md §6/§23`.

Two render modes:
- **Browse mode** (`activeState.kind === "idle"`): full 9-tile grid
- **Work mode** (sub-product active): compact horizontal pill strip (~40px). Active pill teal-bordered + ▸ marker. Tabs never wrap (`whitespace-nowrap shrink-0` button + `overflow-x-auto` row).

Digit shortcuts 1-9. No Tab cycle.

---

## 43. Place Order — variant grid

Sub-product tabs · pack header row · base × pack matrix. Card never scrolls internally.

**Pack header:** single-line, 10.5px. Format `{pack} · {containerLabel}` (mono gray-400). Helper: `packContainerLabel()`. Desktop columns come from a fixed bucket set, not the raw pack union (`CLAUDE_PLACE_ORDER.md §24`).

**Pack columns:** explicit 80px width via `style={{ width: "80px" }}` on each `<col>`. `table-layout: fixed`.

**Pagination:** `VARIANT_GRID_PAGE_SIZE = 20`, threshold = 22 (page-size + 2 buffer; no 1-row trailing pages). >22-base sub-products paginate.

**Row label:** single-product tab → `baseColour`; multi-product tab → `displayName` (so stacked brands read "2K PU Gloss - 90 Base"); `multiProductTab` computed over the FULL tab. Rule + collisions: `CLAUDE_PLACE_ORDER.md §7`.

**Tab strip:** never wraps (`whitespace-nowrap shrink-0` + `overflow-x-auto`); single-uiGroup family hides the tab bar (flat list). `TAB_DISPLAY` render-map merges/relabels tabs (e.g. WS "Tile & Metallic").

**Cell sizing:** 56×32px, font 13px.

### Two-line result display (descriptor)

Result rows and product headers can show a **muted second line** under the primary label: `text-[12px] text-gray-400 truncate mt-0.5`. Static map `lib/place-order/sub-product-descriptors.ts` (family|subProduct → descriptor) — no schema/seed field. Primary line is composed `"{displayName} — {baseColour}" + " · {alias}"`; the descriptor is a separate `<p>`.
- e.g. Satin Finish primary `Satin Finish — <base> · <alias>`, descriptor `Super Satin · Oil Base`.
- **Single-base / variant-qualifier tabs** (Promise SmartChoice/Primer): the per-variant qualifier moves to the second line via `getSecondLine(family, subProduct, qualifier)` (folds `{descriptor} · {qualifier}`, omits qualifier when null) and the line-1 alias suffix is suppressed; when the variant name already contains the tab word ("Primer"), the headline is the variant's own name.
- `/po` search rows fall back to `?? p.family` so plain products still show a grey line.
- Render sites: mobile (`app/po/po-page.tsx`) search/selected/picked/active header; desktop `big-search-bar.tsx`, `variant-grid.tsx`, `sub-product-direct.tsx`. Cart has no family → no descriptor.

---

## 44. Place Order — variant cell

Cell stores **UNITS** in `cart.packQtys[pack]`.

**Keyboard inside cell:**
- 0-9 → write units
- `+` or `=` → `qty + boxSize`
- `-` or `_` → `Math.max(0, qty - boxSize)`
- All call `e.preventDefault()`

**Hover/focus +/− buttons:** 2 absolute buttons 16×14px. `+` top-right, `−` bottom-right. `opacity-0` default → `opacity-100` on group-hover/focus-within. `tabIndex={-1}` + `onMouseDown={e.preventDefault()}`.

---

## 45. Place Order — cart panel

340px right column. Card list grouped by product/base.

**Row name:** desktop cart labels by **`baseColour`**; an empty string (`""`) blanks the line (not nullish) → fall back to `emailLineLabel(product, baseColour, subProduct)`. `/po` cart labels by `displayName` and never blanks.

**Chip format:** primary `×{units}` (mono gray-700 semibold). Conditional `· {N} box` (gray-400 normal) when `step > 1 && units > 0 && units % step === 0`.

**Volume total:** `sum += units * packToLitres(pack)`. NO `packStep` multiplier.

**Recently used:** shown only in browse state. Driven by `touchedAt?: number` on `CartLine`.

### Bill bar + options panel (desktop parity with /po, 2026-06-09)

- **Bill bar always visible** once a customer is selected — Add / Duplicate / Delete + inline delete-confirm reachable from the single-bill state. `id === index+1` enforced by `renumberBills()` after every add/delete/duplicate AND on draft restore; `activeBillId` never dangling. Delete-confirm only when the bill has lines; empty deletes immediately; disabled at 1 bill. Duplicate deep-copies lines + nested `packQtys`.
- **Options always open** (no "More options" collapse): Ship-to / Dispatch / Remarks / Notes.
  - **Dispatch dots** Normal / Urgent / Call (teal / amber / red); clicking Call opens an SO/Dealer picker.
  - **Remarks** 2×2 Truck / Cross / Bounce / DTS (re-tap clears, no "None"); Cross opens a depot picker (Dahisar/Ahmedabad/Rajkot/Pune). Pickers render only while their parent option is active.
  - **Notes** free text + Quick-add presets. **Ship-to** autocompletes; omitted from email when "same as billing".
- **Landing recents grid** (desktop): 2-col, borderless soft-fill rows, neutral gray avatars, medium-weight names, relative recency; shows only when no customer selected AND search empty AND recents non-empty (else the "Type a customer name… N loaded" hint). `area` shown when present, code-only when null.

---

## 46. Place Order — page layout

Fixed-height, no vertical scroll. Root `h-screen overflow-hidden flex flex-col`. Top bar `flex-shrink-0`. Content `flex-1 overflow-hidden`.

Viewport guard: `< 1024px` redirects to `/po` on mount AND on `resize` (repointed from `/order` 2026-07-27, commit `9dce858b`).

---

## 47. /order public mobile patterns — RETIRED 2026-07-27

`/order` no longer exists; the page is archived at `archive/2026-07-order/`, and
`archive/2026-07-order/README.md` owns the retirement story. Do not restate it here.

**Most of this section was NOT `/order`-specific and has been MOVED, not deleted** — the
Visual Viewport `--vvh` keyboard fix, the app-wide `app/layout.tsx` viewport export, the
empty-state row, and the qty-input / desktop-autofocus rules are all still live in `/po`
and now live in **§55** under "Mobile viewport, keyboard + input patterns".

What was genuinely `/order`-only, and is gone with it: its 3-state sticky header (`/po`'s
merged customer header is a different design — §55), the `data-pack-row` +
`scroll-mt-[140px]` picker-scroll target, the picker's ghost **Skip** / teal **Next**
buttons, and the `BILL N · X products · Y units` summary chip. The archived page is the
reference if any of it is ever wanted back.

`/po`'s visual spec is **§55**. Its behaviour is `CLAUDE_PLACE_ORDER.md §25`.

---

## 48. Attendance — mobile PWA patterns

Full-screen, no sidebar. 480px max column, centred on tablet/desktop.

**Bottom nav (end users):** Today + History tabs. No Profile tab.

**Status chips:** per §3 colour map.

**Photo preview:** 240×320 face frame guide overlay. Compressed client-side to 640px Q70 JPEG.

**Admin photo viewer:** lazy fetch signed URL (5min expiry) from `GET /api/admin/attendance/photo?recordId=N`.

**PWA manifest:** start_url `/` (the real `public/manifest.json` says `/`, NOT `/attendance` — corrected 2026-07-22; the installed app launches at root and the auth/role redirect takes over. `CLAUDE_ATTENDANCE.md §14`). Icons: orbit logo on teal-600 bg, 192/512px PNG + apple-touch-icon.

---

## 49. Admin OT pending queue UI

Page `/admin/attendance/ot-pending`. UniversalHeader title "OT Pending Approvals" + status filter.

Per row: user · date · claim reason · total worked · OT minutes raw · `[Approve]` · `[Reject]`.

Approve modal: optional adjusted-minutes input + confirm.
Reject modal: user/date/reason quote · amber warning "Rejected days still consume monthly grace" · optional admin note (500-char limit with counter).
On 409 (already actioned by other admin): inline error "Already actioned. Closing…" + parent refetches.

Empty state: lucide CheckCircle2 in emerald circle, "Nothing pending" headline.

---

## 50. Admin attendance settings UI

Page `/admin/attendance/settings`. UniversalHeader title + "Last updated {date} by {name}".

6 sections (in order): Rollout · Work hours · Geofence · Photo policy · OT policy · Thresholds.

**OT kill switch:** `otPromptEnabled` toggle is PROMINENT at top of OT policy section. Toggling OFF opens a confirm modal first.

**Sticky save bar (bottom):** `position: sticky bottom-0`. Left: "Discard changes" link (only when dirty). Right: "{n} fields changed" + "Save changes" button (`bg-gray-900 text-white`, disabled when not dirty).

Dirty detection: only changed keys are sent in PATCH body.

Toast variants:
- 200 + `willForceReconsent: true` → amber "Re-consent triggered"
- 200 + `rolloutActivated: true` → teal "Rollout activated"
- 200 → gray-900 "Settings saved"
- 400 with errors → red, distribute errors to fields/sections
- 403/401 → "Session expired — refresh and re-login"

---

## 51. Admin OT audit UI

Page `/admin/attendance/ot-audit?month=YYYY-MM`. UniversalHeader title + month picker on right (`{Month} {YYYY} ▾`).

6-tile stats strip: Total OT credited · Auto credited · Grace credited · Admin approved · Pending (amber when >0) · Rejected.

User table: # · User · Days · Total OT · Auto · Grace · Approved · Pending · Rejected · expand chevron. Sort: Total OT DESC. Row click toggles expand (whole row hit target).

Expand panel: day-by-day rows with per-day breakdown.

---

## 52. Outlook email safety (mail order slot summary)

Non-negotiable for OWA paste survival:
- Zero `<div>`, zero `<p>`, zero margin
- `background-color` on `<td>` only (spans get stripped)
- `font-family` on every `<td>`
- No `border-radius`
- Nested `<table>` for layout
- Meta `format-detection` + `x-apple-disable-message-reformatting`

**Confirmed OWA behaviour:** paste strips `color:` on `<td>`. Only text suffixes survive.

---

## 53. ContactCard component (Customer Master + Missing Customer Resolver)

Component: `components/admin/contact-card.tsx`. Renders a single contact (Bill-to dealer or Ship-to site contact). Two states: auto-managed (synced from a Sales Officer) and manual.

### Layout

Three rows:
1. Avatar (40×40 circular, top-left) · name (13.5px semibold) · role chip · "Primary" toggle (right)
2. Phone (11px gray-500, mono) · Email (if present, 11px gray-500)
3. Auto/manual badge row (only when `linkedSalesOfficerId` is set)

### Auto-managed contact

When `contact.linkedSalesOfficerId` is non-null:
- Avatar background: teal-50, ring `teal-200`, icon teal-600
- Badge: `bg-teal-50 text-teal-700 border-teal-200`, label `Auto · {Role} SO` where Role is the SO's role on this customer (Primary / Backup / Junior). e.g. "Auto · Primary SO".
- Delete (×) button:
  - **Admin Customer Master** form: enabled, opens AutoContactDeleteDialog confirm modal
  - **Missing Customer Sheet** (TM Kanban / Support resolver): DISABLED with tooltip "Remove via Sales Officers tab" (create-only flow)
- Name + phone are NOT editable inline — single source is the SO master record. Refreshed on every save via the SoSync backend stages.

### Manual contact

When `linkedSalesOfficerId` is null:
- Avatar background: blue-50, ring `blue-200`, icon blue-600
- No badge in row 3
- Delete (×) button always enabled
- Name + phone editable inline

### Newly-converted (transient state — operator-typed contact that just got linked)

When a manual contact's phone matches a newly-added SO during reconcile (case-insensitive exact name + same phone):
- Avatar background: amber-50, ring `amber-200`, icon amber-600
- Badge: `bg-amber-50 text-amber-700 border-amber-200`, label `Auto · Linked` (transient, persists for that save cycle then becomes teal on next reload)

### Modal — AutoContactDeleteDialog

`components/admin/auto-contact-delete-dialog.tsx`. Confirms manual deletion of an auto-contact.

- Title: "Remove this auto-contact?"
- Body: "Removing {SO Name}'s auto-contact stops them from re-syncing here. To bring them back, re-add via Sales Officers."
- Buttons: `[Cancel]` (white outline) + `[Yes, remove]` (`bg-red-600 text-white`)
- On confirm, server stamps `customer_sales_officers.contactDismissed = true` and deletes the contact row.

---

## 54. Multi-SO list pattern (Customer Master)

`components/admin/sales-officers-list.tsx`. Sits in Sales & Classification section of customer form. Replaces the legacy single SO dropdown.

### Row anatomy (per assigned SO)

```
[avatar 32]  {SO Name}                    [Primary | Backup | Junior]  [×]
             {SO Phone — 11px gray-500}
```

- Avatar: teal-50, ring teal-200
- Role chip: segmented control. Active value highlighted `bg-teal-50 text-teal-700 border-teal-200`; inactive `text-gray-400 border-gray-200`. Tap to cycle PRIMARY → BACKUP → JUNIOR.
- `×` removes the SO (cascades: deletes the matching auto-contact unless `contactDismissed`).
- Exactly one Primary allowed at a time. Promoting a second SO to PRIMARY demotes the previous Primary to BACKUP (per the §3 reconcile pattern).

### Empty state

Single CTA card: "+ Add Sales Officer" centered. Body: "Add 1 or more sales officers to this customer".

### Add SO modal

Search box + result list filtered against `sales_officer_master`. Active SOs only (legacy inactive SOs surface only during data migration). Tap to add as BACKUP by default; promote to Primary via the chip after add.

---

## 55. Place Order — /po mobile (going-forward PO)

Behaviour + architecture: `CLAUDE_PLACE_ORDER.md §25`. Visual specifics:

- **Landing:** one elevated shadowed search field (rounded-16, shadow `0 8px 28px rgba(17,24,39,.09)`, `pt-8`) under the "Purchase Order" banner. No label/heading/recent list on the fresh page. Top gap (2026-07-14) tuned for taller phones (S20 Ultra, iPhone 12 Pro) to breathe under the header; on the shortest phones (Galaxy S8+, 740px) the 8th Favourites card needs a small scroll — accepted tradeoff, not a bug. Favourites cards themselves are unchanged.
- **Merged customer header:** once selected, the customer **name becomes the page title** (~16px), `code · area` below, single "New order" button (refresh icon + text, teal) top-right. The "Purchase Order" banner + gray customer block + "Change" button are gone (New order = full reset).
- **Bill + Multi:** one row — left `Bill {n}` + "+ Add bill" (collapses to "+" at 2+ bills); right "Multi" + switch.
- **Floating CTA pill** (`footerPill`): teal, rounded-full, padding ~`15px 34px`, white 15px bold, shadow `0 8px 22px rgba(13,148,136,.42)`, safe-area inset `max(env(safe-area-inset-bottom),16px)`. Renders "Review order" / "Send order" / "Set quantities (N)" / "Add N products" by state. **All floating footers gate on `keyboardOpen`** (real keyboard), never `inputFocused`.
- **Selected bill chip:** teal pill = label + 19px `bg-teal-600` circle with white ×. Inactive chips plain (no ×). × only renders at 2+ bills (last bill never shows one).
- **Bottom sheets** (Cross depot, Delete-bill confirm, Call SO/Dealer) share one pattern: `fixed inset-0 flex items-end`, `bg-black/40` backdrop, `max-w-[480px] bg-white rounded-t-[18px] p-5`, safe-area `paddingBottom`. The **Call sheet is a 1:1 clone of the Cross-depot sheet** (SO / Dealer buttons + × close).
- **Delete-bill confirm:** title "Delete Bill {n}?", body "{count} product(s)…", `[Cancel]` (`bg-gray-100 text-gray-700`) + `[Delete]` (`bg-red-600 text-white`). Empty bill → instant delete, no sheet.
- **Duplicate control:** quiet grey button in the review per-bill card header beside Edit (`<Copy 15px> Duplicate`, `text-[14px] text-gray-500`).
- **Dispatch pills** order **Normal · Urgent · Call** (Call last, red dot); label "Call" → "Call · SO" / "Call · Dealer" once a target is chosen.
- **Dispatch slot** section (date Today/Tomorrow/Pick + window 9–12/12–3/3–6) — **deferred/planned**, mockup only (`docs/mockups/dispatch-slot/`); not built.

### Mobile viewport, keyboard + input patterns [LIVE]

*Moved here from §47 on 2026-07-27 when `/order` retired. These were never
`/order`-specific — every one is live in `app/po/po-page.tsx` today, and the viewport
export is app-wide. Verified against the code at the time of the move.*

**Visual Viewport keyboard fix (Android Chrome).** `<main>` carries
`style={{ height: "var(--vvh, 100vh)" }}` + `overflow-y-auto`. A mount-effect listens to
`window.visualViewport` `resize`/`scroll` and writes the visible height into `--vvh` via
`documentElement.style.setProperty` — **never React state**, which would cause a render
storm. Live at `app/po/po-page.tsx:946` (writer) and `:2216` (consumer); the SSR fallback
`html { --vvh: 100vh }` is in `app/globals.css`. Full `/po` scroll-architecture rules
(the single `flex-1 min-h-0` scroll area, the `keyboardOpen` gate, the resize+scroll
double listener) are in `CLAUDE_PLACE_ORDER.md §25` — not restated here.

**`app/layout.tsx` viewport export — app-wide, not per-page:**

```ts
export const viewport: Viewport = {
  themeColor: "#0d9488",
  viewportFit: "cover",
  width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false,
  interactiveWidget: "resizes-content",
};
```

`interactiveWidget: "resizes-content"` tells Chromium 108+ to **shrink** the layout
viewport when the soft keyboard opens rather than overlay it — that is what pairs with
`--vvh`. iOS Safari already shrinks `visualViewport` natively. ⚠️ `themeColor` and
`viewportFit` were missing from this block until 2026-07-27; the code has always had them.

**Empty-state row.** Render gate is `inMultiSel && searchQuery.trim().length >= 2`. A
zero-match query shows an italic `"No products match {query}"` row rather than nothing
(`po-page.tsx:3229`).

**Input + tap patterns:**
- Qty input `text-[16px]` — iOS auto-zoom prevention (§ the general rule at §12).
- Qty input gets `border-b border-dashed border-gray-300` while its value is 0.
- Single-pack products render `py-[18px]` + `text-[16px]` label (vs the default
  `py-[10px]` + `text-[14px]`).
- Mount / mode-transition auto-focus is **desktop-only**, gated on
  `window.matchMedia("(min-width: 768px)").matches` (`po-page.tsx:991, :1004, :1773`) —
  focusing an input on a phone would spring the keyboard over the content.

### Favourites — replaces Recents on Home [LIVE, 2026-07-14]

- Home "Recent" section replaced by "Favourites" — section label the word "Favourites" + a small
  gold star (lucide `Star`, filled, `amber-500`, no background box — reused from the Mail Orders
  star, `review-view.tsx` StarGlyph). Listed **one column, sorted A-Z** by name.
- **Star toggle sits in the customer BUILD header** (right of the name row, `items-center` against
  the two-line name+meta block; glyph nudged ~3px right to correct its optical inset from the
  5-point star's shape vs its bounding box). Present the whole time an order is being built for that
  customer — persists across build/search/quantities. Filled gold = favourite, outline grey = not;
  tap toggles.
- **Cap 8.** A 9th add is BLOCKED, not silently evicted — calm amber "Favourites full (8 of 8) —
  remove one first" message near the header, auto-dismiss.
- Favourites card: neutral grey **rounded-square initials avatar** (not a circle — businesses, not
  people; not teal), name + `code · area`, chevron. Customer name `15px / 500 / #1d2939`.
- Empty state: soft icon + "No favourites yet" + prompt.

### Visual polish pass — palette discipline [LIVE, 2026-07-14]

Overall direction: soft and light (Things / Apple Notes feel), not bold or hard.
- **Teal = actions only** — primary buttons, active tab, the favourite star. NOT used for
  avatars/chips/decoration (was diluting the brand colour).
- Primary text `#1d2939` (softened from pure black `#111827`). Greys `#667085` / `#98a2b3` /
  `#d0d5dd` for everything secondary.
- Cards: soft two-layer low-opacity shadow, no hard border, radius 14, roomier padding, subtle
  pressed state on tap.

### Review & send — back affordance [LIVE, 2026-07-14]

Soft-grey rounded back arrow + "Review & send" label (left) · "Back to products" teal hint (right)
on the Review section row. Pure restyle of the existing back control — funnels through the same
`history.back()` → popstate → close-review flow as before (§25-safe, no new nav path).

### Launch — full feature set live [LIVE, 2026-07-14]

The feature set built behind the `?draft=on` gate this cycle is now live to all users on plain
`/po` (gate removed — see `CLAUDE_PLACE_ORDER.md §25`). Installed PWAs ("Add to Home Screen" strips
query params) now show the full set automatically without a reinstall.

---

## 56. Reports hub + print (`/reports`)

**Reports hub (Option C):** left rail (TINT group → Tint Summary + TI Report) · large live preview · top bar (date control + **Generate PDF** teal CTA) + Customise right-drawer. Generate opens `/reports/tint-summary?…&print=1` (auto-print); print route honours `hide` + filters so the PDF matches the preview. **Customise drawer:** 10 section IosToggles (teal ON), operator chips, Show Hold toggle, SMU chips, Area chips (dot colours), 7/14/30 trend; Done button = `bg-gray-900` (modal CTA rule). URL params (only non-defaults written): `r, date, hide(csv), operators, includeHold, smu, area, trendDays`.

**Print document (`tint-summary-document.tsx`):** 4-page A4 portrait, today-only, litres. Inter via `next/font`.
- **Brand blue `#1c3f93` accent — the one-teal rule does NOT apply to this print document** (a per-document exemption, like Sampling Library §22).
- **Progress-bar boards** (SMU / Area): grey track `#d1d5db` (width = litres/maxLitres), green fill `#16a34a` (width = completedCount/count), category dot, "N done" green `#15803d` (grey if 0). Count = full workload (open + completed).
- **Category dot colours** — Area: Local `#2563eb`, Upcountry `#ea580c`, IGT `#0d9488`, Cross `#e11d48`. SMU: Decorative Projects `#4f46e5`, Retail Offtake `#0891b2`, other → slate `#64748b`.
- **Print CSS:** `@page tint-report` (A4) rules **top-level in `globals.css`** (never nested in `@media print`); `visibility:hidden` isolation via `#tint-report-print-area`; `print-color-adjust: exact` so colours survive the PDF.

---

## 57. Settings › Hide (admin)

New admin area under a **Settings** section in `components/admin/admin-sidebar.tsx` (EyeOff icon). One "Hide" nav home with **three flat tabs** (`hide-settings-content.tsx`):

- **Rules** — list + "Add Rule" modal (HOLD, or older-than-N-days); toggle / edit / delete.
- **Hidden Orders** — every hidden order with *why*; manual hides get an **Un-hide** button; rule-hidden rows show **"Managed by rule"** (no per-order un-hide in v1).
- **Tags** — grouped on/off switches for Mail Order badges (app-wide); important tags (Hold / OD / CI) open a confirm before turning off.

**Manual hide:** admin-only "Hide OBD…" action on Tint Manager rows (card + table) via `HideObdModal.tsx` → reason required; order drops off all boards, appears in Hidden Orders. Default state (no rules, nothing hidden, all tags on) = app looks exactly as before. Backend/schema: later batch (CORE / MAIL_ORDERS).

---

## 58. Support board — RETIRED 2026-07-27

The Support board no longer exists; its visual spec (column order, ship-to override cell, stacked
VOL cell, Hold tab) is archived verbatim at `archive/2026-07-support/docs/CLAUDE_SUPPORT.md`.
The reusable lesson it carried — content-blind **percentage** `grid-template-columns` for
Grid-native tables — is owned by **§27**, which remains the live rule. Floor Control's own surfaces
are specified in `CLAUDE_FLOOR.md`; do not resurrect this section's prose there.

---

## 59. Mobile app shell — provider + slotted bottom bar [LIVE]

The mobile shell is **three separable pieces**, not one welded block (rebuilt 2026-07-19, Direction A, commits `5eb0fd7e` → `6bdaff19`). Entirely scoped `block md:hidden` — mobile only; the desktop sidebar (§7) stays `hidden md:flex`, completely untouched by any of this.

### 59.1 `MobileShellProvider` — the sheets [LIVE]

`components/shared/mobile-shell-context.tsx`. Owns the **Menu sheet, You sheet, sign-out confirm, and scrim**, plus their state (`sheet` / `confirmOpen` / `filter`). Mounted **once**, in `role-layout-client.tsx`, wrapping the whole role-shelled subtree.

- **Menu sheet** — `z-[60]`, `rounded-t-[22px]`, slides via `translate-y-full`→`translate-y-0`. Lists every page the user can view + a "Find a page…" filter (`text-[16px]`, iOS zoom guard). Active row `bg-teal-50 text-teal-700 border-l-teal-600`. Reuses the **exact same** `ICON_MAP` / `DEFAULT_ICON` (keyed by `pageKey`, exported from `role-sidebar.tsx`) as the desktop sidebar (§7) — icons always match between the two.
- **You sheet** — same `z-[60]` shape: teal avatar (initials) + userName + role label + red Sign out row → confirm dialog (`z-[70]`) → `signOut({ callbackUrl: "/login" })`.
- **Scrim** — `z-50`, closes whatever is open. One sheet open at a time.

**The point of the lift:** `useMobileShell()` exposes `openMenu()` / `openYou()` / `closeAll()` **to any descendant**, so a module's own header can open the same sheet instances without re-mounting a second copy of the markup. The context also carries read-only `role` / `userName` / `userInitials` so a module-native header can render the signed-in avatar with no new prop-drilling.

### 59.2 The three-way bottom-bar SLOT [LIVE]

`components/shared/mobile-shell.tsx` is now **only the bottom bar**. It renders exactly one of three things, checked in this order:

| # | Branch | Trigger | Renders |
|---|---|---|---|
| 1 | **Hidden** | `hideBar` prop is true | nothing — no bar at all |
| 2 | **Module tabs** | `workflowTabs` supplied AND non-empty | that module's `<WorkflowTabBar>` |
| 3 | **Default** | neither of the above | the standard **Home · Menu · You** `<nav>` |

Branch 3 is unchanged from the original shell: **Home** → `navItems[0]?.href ?? "/"` (active-teal when `pathname === that href`), **Menu** → `openMenu()`, **You** → `openYou()`.

**Threading:** all four props (`workflowTabs`, `activeTabKey`, `onTabChange`, `hideBar`) are optional pass-throughs on `<RoleLayoutClient>` — the same shape `navItems` already uses. Undefined on every call site that hasn't opted in, so **every existing page is pixel-identical by construction**.

**⚠️ LANDMINE — `workflowTabs={[]}` does NOT hide the bar.** An empty array is falsy in the `hasWorkflowTabs` check, so it falls through to the **default Home/Menu/You bar**, not to nothing. Hiding requires the explicit `hideBar` prop, which is deliberately a separate named prop checked *before* `hasWorkflowTabs`. Reusing the empty array for "hidden" would silently break the fallback semantic.

### 59.3 `WorkflowTabBar` — the reusable per-module primitive [LIVE]

`components/shared/workflow-tab-bar.tsx`. Generic and module-agnostic: `tabs: {key, label, count?, icon}[]` + `activeKey` + `onChange`.

- Icon-on-top layout, count badge top-right of the icon, teal underline pill on the active tab.
- **Count badge hides at 0** — a "0" badge is noise, not information. `>99` renders `99+`.
- **One-teal (§1):** only the ACTIVE tab's badge is teal; an inactive tab's badge stays `bg-gray-400`, matching its icon and label.

**⚠️ LANDMINE — its height is copied from the default nav ON PURPOSE.** It reuses the default `<nav>`'s exact classes (`fixed bottom-0 … z-40`, `flex-1 flex flex-col items-center gap-1 py-2 text-[11px] font-semibold`, `h-6 w-6` icon, bare `env(safe-area-inset-bottom)`) so the two bars are the same height **by construction**. An earlier `min-h-[58px]` guess was removed — **do not reintroduce a fixed height number**; it drifts out of sync with the real content and invalidates `MOBILE_NAV_CLEARANCE`.

### 59.4 How a future module plugs in [LIVE — sanctioned extension point]

Every future module (**Tint Operator, Support, Warehouse, Trip Report**) now has a supported way to mount its own bottom tabs. **Do not rebuild the shell** — the frame, both sheets, and the wiring already exist. A module supplies only its own tabs and its own page contents:

1. Supply `workflowTabs` + `activeTabKey` + `onTabChange` through `<RoleLayoutClient>`.
2. For a Direction-A header, call `openMenu()` / `openYou()` from `useMobileShell()` on the header's grid icon / avatar.
3. Pass `hideBar` when a full-screen sub-view (e.g. a detail screen) should own the whole viewport.

**Picking is the first consumer** — `components/picking/picking-mobile-shell.tsx`. Its `SupervisorPickingShell` is the reference implementation and the pattern to copy: tab state and the queue fetch that drives the live counts are **owned one level above the board** (they must reach `RoleLayoutClient`, which renders above the board in the tree), and are handed back down to the page via the module's own context. One fetch, so the cards and the tab counts can never drift. Picking's screen-level detail is `CLAUDE_PICKING.md §5` — not repeated here.

**⚠️ Label and key — CORRECTED 2026-07-30.** This warning used to read *"Picking's third tab reads **"Done"** but its key stays `"checked"`."* **That is false.** The live union is `"assign" | "picking" | "done"` (`components/picking/picking-mobile-shell.tsx`) — label == key on all three.

The real rule is the one the correction demonstrates: **a relabel and a re-key are separate decisions, and each has to be made on purpose.** On 2026-07-19 Picking relabelled its third tab "Checked"→"Done" and deliberately did NOT touch the key — correct, because a visible label is not a state identifier. On 2026-07-20 the board re-cut moved label AND key **together**, because by then the old keys had *inverted against their labels*: `"check"` would have held `pick_assigned` (nothing is checked there) while `"checked"` held the actual needs-check work. **A key that lies is worse than a key that is merely ugly.** Two things made that second move safe, and both must be checked before re-keying anything: the keys are a TypeScript union, so `tsc` flagged every stale comparison; and nothing persists them (plain `useState` — no localStorage, no URL param, and `WorkflowTab.key` is a bare `string`), so there was no stored value to migrate. Tab semantics are `CLAUDE_PICKING.md §5.1`-§5.2's, not this file's.

⚠ **This warning sat wrong HERE for ten days while `CLAUDE_PICKING.md §5.1` had it right the whole time.** The 2026-07-20 correction was written into the module file and never into the shell file, and nothing forced a re-read of the copy. **A stale claim is rarely in only one file** — when you correct one, grep the rest for the same sentence. This file was the copy nobody checked.

### 59.5 Per-ROLE tabs vs per-MODULE tabs — the distinction that matters

These are different ideas and only one was rejected. Read both lines before proposing either:

- **Per-ROLE bottom tabs — still REJECTED.** The bottom anchors must not change identity depending on who signed in. Variable pages live behind **Menu**, not as their own tabs. This was rejected in the original design and that decision stands.
- **Per-MODULE workflow tabs — SANCTIONED, and LIVE.** A module may replace the bottom bar with its own **workflow-stage** tabs (Picking's supervisor board: Assign · Picking · Done) for the duration of that module's screens. Opt-in per page; the default for every page that says nothing stays Home/Menu/You. *(This line said "Assign · Check · Done" until 2026-07-30 — the same 2026-07-20 rename, and the same ten-day miss, as §59.4's corrected warning above.)*

The difference is what the tabs *are*: a role is an identity (the bar must not fork per user), a workflow stage is a step in the task the user is currently doing (the bar is the right place for it — the thumb zone). **Menu/You are not lost** when a module takes the bar; they demote to the module's own header, because module-switching is the less frequent action.

**Design history:** rejected per-role bottom tabs → rejected drawer-only → fixed Home/Menu/You anchors → **(2026-07-19)** kept those as the default, added the per-module slot beside them. Direction A (module-native bottom bar) was chosen over Direction B (split bar) and Direction C (floating FAB).

### 59.6 Mounting, clearance, and mechanics

**One global insertion point:** `components/shared/role-layout-client.tsx` mounts `<MobileShellProvider>` around `<RoleSidebar>` + `<MobileShell>` + the page content. Every page that wraps itself in it inherits the shell with no per-page work — live on `/trips`, `/place-order`, `/picking`. **✅ Verified 2026-07-30** by reading the three call sites: `app/trips/page.tsx` and `app/(place-order)/layout.tsx` render `RoleLayoutClient` and pass **no** `workflowTabs`, so both take the default Home/Menu/You bar (branch 3); `/picking` supplies its own tabs through `picking-mobile-shell.tsx` (branch 2). Inheriting the shell and replacing the bar are different things — this list means the former.

- The page content wrapper carries `pb-[76px] md:pb-0` so mobile content clears the fixed bar; no effect on desktop.
- **Pages that don't route through `role-layout-client.tsx` don't inherit the shell.** Attendance has its own full-screen wrapper with no sidebar (`app/attendance/layout.tsx`, `CLAUDE_ATTENDANCE.md §13`) and is unaffected.
- **`/po` is NOT a consumer of this shell** — it builds its own Home/Drafts/Sent bar inline in `po-page.tsx`. Shell changes never touch `/po`; do not add "protect /po" guards, it is not on the circuit.

**`MOBILE_NAV_CLEARANCE`** (exported from `mobile-shell.tsx`) = `calc(76px + env(safe-area-inset-bottom, 0px))`. Single source of truth for "how much room the fixed bar needs" — every bottom-pinned sheet or CTA must reserve at least this much. It is an **empirical** figure, not computed from the nav's classes: if that JSX's sizing changes, update the constant by hand. It was hand-copied as a bare `76px` literal three times before centralization, each time producing a render-behind-the-nav bug — **import it, never retype the number**.

**Mechanics landmines — cross-ref §55, do not re-derive:**
- **Floating footers gate on `keyboardOpen` (measured Visual Viewport height drop), never `inputFocused`.** Android can dismiss the keyboard without blurring the input, so a footer gated on focus stays stuck hidden. §55.
- **Safe-area floors:** §55's convention for page-level footers and sheets is `max(env(safe-area-inset-…), Npx)` — **never a bare `env()`**. Both bars in this section (default nav and `WorkflowTabBar`) deliberately use a **bare** `env(safe-area-inset-bottom)` with no floor — they match each other by construction (59.3), which is the stronger constraint here. Known, intentional divergence: do not "fix" one bar to the §55 floor without the other, and do not use the bars as the precedent for new page-level footers.
- **Dual shadow tokens:** `SOFT_CARD_SHADOW` and `ENRICHED_ROW_SHADOW` read almost identically but are pixel-matched to two different approved mocks (plain cards vs. enriched rows). **Do not merge them.** §55.

**Reference mobile user:** Praveen (`logistics` role, primary landing → Trip Report — `CLAUDE_TRIP_REPORT.md §1`).

**Approved mockups:** `docs/mockups/mobile/index.html` (v3 — the default Home/Menu/You shell; its grey role-switcher is a demo aid, not shipped) and `docs/mockups/picking/mobile-shell-v1.html` (the approved Direction-A shell, 6 states).

**[DEFERRED]**
- **~~Shared minimal header — extraction~~ — DONE 2026-07-29, see §59.7.** Realized as Picking's Direction-A header, then extracted verbatim to `components/shared/module-mobile-header.tsx` (`a2fb6889`) when the picker face needed the same one. **The other half of this item survives and is still true:** every page outside Picking keeps its own header, which is why `/trips` still looks right and was never disturbed. Adopting the shared one elsewhere is opt-in, module by module — candidates in §59.7. The "big search" half was never built and is not part of §59.7.
- Shell rollout/polish across the other role pages.
- PWA install (add-to-home-screen). Manifest + icons + root-layout metadata already exist (`public/manifest.json`, `app/layout.tsx` metadata + `appleWebApp` + viewport); **no service worker exists** (never built). Do NOT reintroduce a middleware-level redirect toward `/attendance` (the retired attendance auto-check-in gate — see `CLAUDE_TRIP_REPORT.md §7`) when building this.

### 59.7 `ModuleMobileHeader` — the shared Direction-A header [LIVE, 2026-07-29]

`components/shared/module-mobile-header.tsx`. The fourth shared piece, alongside the provider (§59.1), the bar slot (§59.2) and `WorkflowTabBar` (§59.3). Extracted **verbatim** from `picking-board-mobile.tsx` (`a2fb6889`), where it had been the only implementation since Direction A shipped: every className, aria-label, tap target, icon size and the safe-area padding are byte-identical to the inline JSX it replaced. **Do not restyle it here** — a visual change belongs in its own commit, applied to every consumer at once.

**Layout:** avatar (left) · title (centre) · grid + optional search (right). Teal-600 band, `flex-shrink-0`. It does **not** position itself: the root is intended as a sibling of a `flex-1` scroll area inside a `fixed inset-0 flex flex-col` screen root, so the consumer keeps ownership of the surrounding frame.

| Prop | | Notes |
|---|---|---|
| `title` | `string` | The 19px extrabold centre label |
| `avatarInitials` | `string` | Rendered in the left circle |
| `onAvatarClick` | `() => void` | Required |
| `onMenuClick` | `() => void` | Required — the grid icon |
| `showSearch?` | `boolean` (default `true`) | When false the icon is omitted and **no gap is left behind**: it is the second child of a `gap-0.5` row, and a one-child flex row renders no gap, so the header stays balanced with no placeholder and no width change on the grid button |
| `searchActive?` | `boolean` | ⚠ **Accepted, but drives NO styling** — see below |
| `onSearchToggle?` | `() => void` | |

**⚠️ THE DESIGN RULE — handlers stay with the CALLER.** The header deliberately does **not** call `useMobileShell()` itself. Picking wires `onAvatarClick`→`openYou` and `onMenuClick`→`openMenu`, but that is Picking's choice, passed in. A future module can point the avatar and the grid at something else entirely without forking the component. Nothing module-specific is imported inside it, and nothing should be.

**⚠️ `searchActive` is inert — declared, never destructured, never read.** This is not an oversight and not a bug: the inline original rendered an identical search button in both states, and the extraction was pixel-for-pixel. Wiring an active-state look during that refactor would have smuggled a visual change into a commit whose entire claim was that nothing changed. It is a **one-className job** whenever the active treatment is actually designed — do it then, in its own commit, not as a side effect. A caller may pass its real state today; it just has no effect.

**Consumers today: both Picking faces, and nothing else** — `picking-board-mobile.tsx` (supervisor, `showSearch` default true + `searchActive`/`onSearchToggle` wired to its own filter row) and `picker-my-picks-board.tsx` (picker, `showSearch={false}` — that face has no search). Behaviour and per-face detail: `CLAUDE_PICKING.md §5.3`-§5.4.

**Future adopters — a swap, not a rebuild.** **Tint Operator mobile** and **Trip Report mobile** are the two named candidates (§59.4's "how a future module plugs in"); both already have a hand-rolled header, so adopting is replacing markup, not designing anything. Explicitly **NOT `/po`** — it builds its own Home/Drafts/Sent bar and header inline and is deliberately off this circuit (§59.6); do not add "protect /po" guards. Explicitly **NOT `/floor`** — desktop-first, with no mobile-shell usage at all (`CLAUDE_FLOOR.md` mentions none of this machinery, verified 2026-07-30).

---

## 60. Mobile card type scale + 390px viewport (reusable standard)

Records the /po-derived type discipline so this is never re-discovered. **Reusable across any mobile card**, not Picking-only. Shipped 2026-07-21.

**App font (shared everywhere):** `Plus Jakarta Sans` via `--font-sans` (`app/layout.tsx`, next/font). Mono = `JetBrains Mono` via `--font-mono` (OBD numbers only). Cards and `/po` share this font — **there is no family difference; WEIGHT is the "heavy vs refined" lever, not the typeface.**

**The /po refinement principle:** exactly ONE line carries weight (the hero); everything else stays light (400–500). Making every line heavy (700 name + 600 area + 700 volume + 700 chips) is what read dense.

**Mobile card type tokens (as shipped):**

| Element | Size | Weight | Colour | Notes |
|---|---|---|---|---|
| Customer name (hero) | 16px | 600 | `#1d2939` | letter-spacing ~0 (NOT negative), line-height 1.25, `truncate` |
| Slot / time | 15px | 600 | `#475467` | keep `tabular-nums` |
| Area | 12px | 500 | `#667085` | |
| Volume count | 12px | 600 | `#667085` | `tabular-nums` |
| Volume "L" unit | 10.5px | 500 | `#98a2b3` | |
| Caption date | 11.5px | 400 | `#98a2b3` | middot `#d8dce1` |
| Caption OBD | 11.5px | 400 | `#98a0aa` | **mono** |
| Family chips | 10.5px | 600 | `#667085` on `#eef1f5` | |
| Route dot | 8px | — | Local `#2563eb` / Upcountry `#ea580c` / Cross `#e11d48` / else grey | colour only, no text |

**Hard rules (so discovery isn't needed again):**
- **Never CSS-uppercase customer names** — uppercase comes from SAP source data, not `text-transform` (would break `smartTitleCase`, §15).
- **Keep `tabular-nums`** on slot + volume (numbers align across stacked cards).
- **Weight, not colour, is the "heavy" dial.** If a card reads heavy, drop weights (700→600/500) and remove negative tracking before touching colour. Nothing on the card is 700; only the hero name is 600; chips/volume/area cap at 600.

**Viewport:** design + phone-verify target **390px** wide (iPhone reference); must stay **320px-safe** — hero name uses `truncate min-w-0`, slot + arrow are `shrink-0` and never clip. Tap targets **min 44–48px** for interactive controls.

---

## 61. Picking — desktop board — RETIRED 2026-07-28

The desktop `/picking` table no longer exists. `components/picking/picking-queue.tsx` was archived to
`archive/2026-07-picking-desktop/`; **`/picking` itself STAYS LIVE** and renders the mobile card
board (§62) at every screen width. Its story — why it went, what replaced it, what moved out first —
belongs to that folder's `README.md`. *(That README is written in a later step of this retirement; if
it is not there yet, the discovery report
`docs/prompts/drafts/code-discovery-2026-07-28-picking-desktop-retirement.md` is the record.)*

**Why:** Floor Control (`/floor`) was built to replace it, the floor team works on Android phones
only, and a desk operator who needs a board uses `/floor`. Picking is also hidden from the desktop
sidebar now — the phone Menu sheet keeps it, and no permission changed.

**What was NOT desktop-only was moved out BEFORE this collapsed, and is still live** — do not look
for it here:

| Rule | Now owned by |
|---|---|
| Age tags `1d` / `{n}d`, from `row.ageDays`, + the §8 Tint pill-styling provenance | **§62.1** |
| Locked / Upcoming visual treatment | **§62.2** |
| Route as plain text, no route dot, and why (`RouteDot` keys on `deliveryType`) | **§62.3** |
| The rejected-feature list + its reason | **§62.4** |
| "Status pill is never teal" | **§1** |

What collapsed with the section was genuinely desktop-only: the 8-column
`4/3/19/27/14/7/9/17%` table layout, the four status-pill hex values, the List ⇄ By Route toggle
styling, the slot-band styling, the UniversalHeader filter-panel wiring note, and the
temporary-inline-Undo note. The archived file is the reference if any of it is ever wanted back.

Behaviour, tab semantics and date-zone scope were always `CLAUDE_PICKING.md`'s, not this file's.

---

## 62. Picking — mobile card visual states (tap-select · arrow-to-detail)

**Visual treatment only** — the interaction behaviour (what a tap does, variant gating) lives in `CLAUDE_PICKING.md`. Shipped 2026-07-21. Type scale is §60.

- **Selected (Assign card):** card teal tint (`bg-teal-50` / `border-teal-600`) + a small **teal check badge, top-left corner**, only when selected. Unselected = clean, no box, no placeholder.
- **Arrow-to-detail:** a **soft round arrow** to the right of the family chips — `~30px` circle, `bg #eceff3`, chevron `#8b93a0`. Pinned; families scroll to its left; **always rendered on Assign cards even with zero families** (detail is always reachable).
- **One-teal on the card:** the only teal is the selected tint/check; the arrow and family chips are slate. (Locked/Upcoming + the `1d`/`{n}d` age treatment are stated directly in §62.1-§62.2 below — they used to be a pointer at §61.)

### 62.1 Age tags — `1d` / `{n}d` [module-wide]

Moved here from §61 on 2026-07-28 (Picking desktop retirement, step 1). The rule was never
desktop-only: **both** mobile boards render this badge from the same field, through one shared
component — **`AgeBadge` in `components/picking/card-atoms.tsx`** (extracted 2026-07-29 when the
picker card gained the same signals). The days→colour scale lives inside that component and **nowhere
else**; never re-map days to colour at a call site.

*(This pointer named `picking-board-mobile.tsx:588-628` until 2026-07-30. Line numbers have rotted
twice on this section alone — name the file and the symbol, never the line.)*

**Age tags** next to the OBD for `ageDays >= 1`: **`1d`** amber, **`{n}d`** red (2+). Uses
`row.ageDays` from the payload — **not** recomputed from creation date (the §8 Tint age-badge
PILL STYLING is reused; its day math is not).

### 62.2 Locked / Upcoming treatment [module-wide]

Moved here from §61 on 2026-07-28, same reason: the mobile Assign board has its own locked zone —
the `assignLocked` card variant and its `UpcomingDayBadge`, both in
`components/picking/picking-board-mobile.tsx`. Supervisor-only, so unlike `AgeBadge` above these did
**not** move to `card-atoms.tsx`: the picker never sees a locked bill.

*(Line numbers dropped here too, 2026-07-30 — same reason as §62.1.)*

Rows muted, **lock glyph instead of checkbox**, `—` for `#`, and a `for {Day} {DD} {Mon} · {time}`
chip in the Status cell. ⚠ The **time** half of that chip is a desktop detail — the mobile
`UpcomingDayBadge` and Floor's Upcoming strip both render the day only.

### 62.3 Route renders as plain text — no route dot

Moved here from §61 on 2026-07-28. This is a fact about the **payload** and about the **mobile**
`RouteDot`, so it survives the desktop board.

No route→colour data exists in the payload (`RouteDot` on mobile keys on `deliveryType`, not
route). Add a route-master colour later if wanted.

### 62.4 Rejected on the Picking module — do not reintroduce

Moved here from §61 on 2026-07-28. This is **decision history for the Picking module**, not for one
file, so it must outlive the desktop board.

Header "% ready for dispatch" bar · per-route progress roll-up · auto "Ready to load" status ·
header status-count stats. **Reason:** loading depends on vehicle/space, which the system does not
know.

⚠ **Scoped to PICKING deliberately — Floor is NOT bound by it, and on one item Floor went the other
way.** Floor Control ships a four-segment per-route/per-band progress roll-up
(`components/floor/progress-bar.tsx`, used by `route-row.tsx` and `slot-band.tsx`) and sorts routes
worst-first by completion (`components/floor/floor-board.tsx:201-208`). Only the last item —
header status-count stats — matches Floor's own removal of the stats line (`CLAUDE_FLOOR.md §8`).
Do not read this list as an app-wide ban.

---

**⚠ OPEN — this file carries NO `Schema` stamp, at either end.** `CLAUDE_CORE.md`, `CLAUDE_PICKING.md`
and `CLAUDE_FLOOR.md` all carry `Schema v27.12` in their header; this file carries none in the header
or the footer. That may well be *right* — a design-system file has no schema to be in step with — but
it has never been decided, and `CLAUDE.md`'s session procedure tells every reader to check a file's
header against CORE's schema stamp, which for this file silently checks nothing. **Deliberately left
as-is on 2026-07-30 rather than quietly adding one:** a stamp creates an obligation to keep it
current, and omitting one should be a decision on the record, not a drift nobody noticed. Resolve in
whichever pass owns the doc-header convention.

*UI v5.16 · OrbitOMS · updated 2026-07-30*
