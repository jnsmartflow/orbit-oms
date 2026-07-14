# CLAUDE_UI.md — OrbitOMS UI Design System
# v5.7 · July 2026 · Lives in: orbit-oms/docs/
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

### Date control
Click-to-open calendar popover. Format `‹ Today · 04 Apr ›`. Right arrow disabled when viewing today.

### Colour rule
**ONE teal element: active slot segment.** Sampling Library exempted (§22).

Per-board wiring summary:

| Board | Segments | Filters | Date | Extras |
|---|---|---|---|---|
| Support | Slots (4) | View, Status, Del Type, Priority | Stepper | Search |
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

**Mobile rule:** all `<input>` elements that may surface a keyboard must be `text-[16px]` minimum on `/order`. iOS WebKit auto-zooms anything smaller. Android Chrome doesn't but the rule applies for consistency.

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
- `/po` + `/order` search rows fall back to `?? p.family` so plain products still show a grey line.
- Render sites: mobile (`app/order/page.tsx`, `app/po/po-page.tsx`) search/selected/picked/active header; desktop `big-search-bar.tsx`, `variant-grid.tsx`, `sub-product-direct.tsx`. Cart has no family → no descriptor.

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

Viewport guard: `< 1024px` redirects to `/order` on mount AND on `resize`.

---

## 47. /order public mobile patterns

Single unified sticky header with 3 states:

| State | Trigger | Content |
|---|---|---|
| 1 — Branding | `selectedCust === null` | `[logo] Place Order / JSW Dulux · Surat Depot` |
| 2 — Customer locked, browsing | `selectedCust && !anyBillInPicking` | `{customerName}` (16px semibold) / `{customerCode}` (12px gray) / `Change` button |
| 3 — Customer locked, picking | `selectedCust && anyBillInPicking` | Row A: `{customerName}` (small gray) · `N of M` · Row B: `{productName}` (17px semibold) · Row C: `[Skip ghost] [Next →]` |

**Header is edge-to-edge** (no margin, no rounded corners), `sticky top-0 z-30`, `bg-white border-b border-gray-200`.

### Visual Viewport keyboard fix (Android Chrome)

`<main>` has `style={{ height: "var(--vvh, 100vh)" }}` + `overflow-y-auto`. Mount-effect listens to `window.visualViewport.resize/scroll` and writes the visible height to `--vvh` via `documentElement.style.setProperty` (NOT React state — would cause render storm).

`app/layout.tsx` Viewport export:
```ts
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false,
  interactiveWidget: "resizes-content",
};
```

### Empty-state row

Render gate uses `inMultiSel && bill.searchQuery.trim().length >= 2`. Zero-match queries show italic `"No products match {query}"` row instead of nothing.

### Other patterns

- Qty input: `text-[16px]` (iOS auto-zoom prevention).
- Mode-transition auto-focus is desktop-only: `window.matchMedia("(min-width: 768px)").matches`.
- Pack row has `data-pack-row` attribute + `scroll-mt-[140px]` for picker-entry auto-scroll target.
- Picker Skip button: ghost (`text-gray-500 text-[13px] font-medium`, no bg). Next button: primary teal/green.
- Single-pack products: `py-[18px]` + `text-[16px]` label (vs default `py-[10px]` + `text-[14px]`).
- Qty input: `border-b border-dashed border-gray-300` when value is 0.
- Bill summary chip: `BILL N · X products · Y units` when cart non-empty.

---

## 48. Attendance — mobile PWA patterns

Full-screen, no sidebar. 480px max column, centred on tablet/desktop.

**Bottom nav (end users):** Today + History tabs. No Profile tab.

**Status chips:** per §3 colour map.

**Photo preview:** 240×320 face frame guide overlay. Compressed client-side to 640px Q70 JPEG.

**Admin photo viewer:** lazy fetch signed URL (5min expiry) from `GET /api/admin/attendance/photo?recordId=N`.

**PWA manifest:** start_url `/attendance`. Icons: orbit logo on teal-600 bg, 192/512px PNG + apple-touch-icon.

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

## 58. Support board — ship-to override cell + Material Type/Article columns (2026-07-07)

Business behaviour: `CLAUDE_SUPPORT.md §4.18` (ship-to override), `§4.19` (Material Type/Article).

**Note on structure:** the Support board is **CSS Grid, not `<table>`** (`CLAUDE_SUPPORT.md §7` landmine — a full rewrite to the §27 fixed-table standard was proposed and rejected as scope creep). This spec is Grid-native, kept visually consistent with §27 (same typography, row heights) but structurally separate — do not conflate the two, and do not add Support to §27's "applies to" list.

### Ship-to override cell (`components/support/ship-to-override-cell.tsx`)

Inserted immediately after the CUSTOMER column. Three states:

- **Empty** (no override) — faint gray "Set ship-to" text-only affordance (`text-gray-400`), no border/pill. Click enters editing.
- **Editing** — autofocused text input (matches §9 form-input sizing), ~250ms-debounced search (skipped under 2 characters). Dropdown below the input lists ≤8 results: customer name as the primary line, area as a muted secondary line underneath (same two-line pattern as §18 Mail Orders customer column). Click a result commits the save and exits editing; Esc, blur (with a short delay to allow the click), or backdrop cancels with no save.
- **Set** — compact **teal** pill (matches the brand-action usage in §2, not a semantic status colour) showing **customer name ONLY** — no area, per approved refinement — plus a small × to clear. Saving state disables the input/pill (matches the existing `savingSlot` optimistic-disable pattern used by the Dispatch Slot picker, `CLAUDE_SUPPORT.md §4.13`).

Failure surfaces a toast (sonner, already used elsewhere on this board) — no inline error state.

### Material Type + Article columns

Plain display-only text cells — no edit affordance, no hover state, no click target. Styled identically to the existing ROUTE/TYPE text cell: `text-[11px] text-gray-600` data, `text-gray-400` for the empty `"—"` fallback. Positioned between ROUTE/TYPE and VOL(L).

### Column order (11 total, Grid tracks)

`OBD/Date · Customer · [Ship-To Override] · Route/Type · [Material Type] · [Article] · Vol(L) · Status · Dispatch Slot · Priority` + row-selection checkbox. Bracketed columns are new this session.

---

## 59. Mobile app shell — shared bottom bar (Home / Menu / You) [LIVE]

A shared, role-aware mobile app shell: a fixed bottom bar with three anchors **identical for every user** — **Home · Menu · You**. Not a per-role tab bar (rejected mid-design — see design history below); the bottom anchors themselves never change, only the Menu list's contents do.

- **Home** — navigates to `navItems[0]?.href ?? "/"` (the user's primary page). Active-teal when `pathname === that href`.
- **Menu** (center) — slide-up sheet listing every page the user can view, with a "Find a page…" filter (`text-[16px]`). Active row: `bg-teal-50 text-teal-700 border-l-teal-600`. Reuses the **exact same** `ICON_MAP` / `DEFAULT_ICON` (keyed by `pageKey`, exported from `role-sidebar.tsx`) as the desktop sidebar (§7) — icons always match between the two.
- **You** — slide-up sheet: teal avatar (initials) + userName + role label + red Sign out row → confirm dialog → `signOut({ callbackUrl: "/login" })` (reuses the sidebar's existing sign-out, not reinvented).

One sheet open at a time; scrim closes. Safe-area padding via `env(safe-area-inset-bottom)`.

**Component:** `components/shared/mobile-shell.tsx`. Entirely scoped `block md:hidden` — mobile only.

**Mounting — one global insertion point:** `components/shared/role-layout-client.tsx` mounts `<MobileShell>` as a sibling to `<RoleSidebar>`. `role-layout-client.tsx` is the single shared wrapper for every role-shelled page, so every page that wraps itself in it inherits the shell automatically with no per-page work — confirmed live on `/trips` and `/place-order`; other role pages are "future adopters" of the same wrapper.

**Desktop untouched, mobile-only split:**
- The existing desktop sidebar (§7) stays `hidden md:flex` — completely unchanged.
- The page content wrapper gets `pb-[76px] md:pb-0` so mobile content clears the fixed bottom bar; no effect on desktop.
- **Pages that don't route through `role-layout-client.tsx` don't inherit the shell.** Attendance, for instance, has its own full-screen wrapper with no sidebar (`app/attendance/layout.tsx`, `CLAUDE_ATTENDANCE.md §13`) and is unaffected by this shell.

**Design history:** rejected per-role bottom tabs → rejected drawer-only → landed on the fixed Home/Menu/You anchors (variable pages live behind Menu, not as their own tabs).

**Reference mobile user:** Praveen (`logistics` role, primary landing → Trip Report — `CLAUDE_TRIP_REPORT.md §1`).

**Approved mockup:** `docs/mockups/mobile/index.html` (v3 — the Home/Menu/You version). The grey role-switcher shown in that mockup is a demo aid only, not part of the shipped app.

**[DEFERRED]**
- Shared minimal header + big search component (from the mockup) — to be rolled in page by page; each page currently keeps its own header (why `/trips` still looks right and wasn't disturbed).
- Shell rollout/polish across other role pages.
- PWA install (add-to-home-screen). Manifest + icons + root-layout metadata already exist (`public/manifest.json`, `app/layout.tsx` metadata + `appleWebApp` + viewport); **no service worker exists** (never built). Do NOT reintroduce a middleware-level redirect toward `/attendance` (the retired attendance auto-check-in gate — see `CLAUDE_TRIP_REPORT.md §7`) when building this.

---

*UI v5.7 · OrbitOMS*
