# CLAUDE_UI.md — Orbit OMS UI Design System
# Load alongside CLAUDE_CONTEXT.md for all UI implementation sessions.
# This is the SINGLE SOURCE OF TRUTH for visual styling across all screens.
# Version: v4.4 · Teal Brand System · Universal Header · Mail Order Enrichment · April 2026

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

## 6. Page Layout — Universal Header System (REWRITTEN v4.3 — unchanged in v4.4)

(Refer to v4.3 for full Universal Header layout documentation)

---

## 7-18. [Unchanged from v4]

(Sidebar, Cards, Forms, Buttons, IosToggle, Login, Modal, Date Range Picker, Interactions, Screen-Specific Notes, Palette Sweep, Deprecated — refer to v4 for full content)

---

## 19. Smart Title Case (NEW v4.2 — unchanged in v4.4)

(Refer to v4.2 for full smartTitleCase documentation)

---

## 20. Lock Column (NEW v4.2 — unchanged in v4.4)

(Refer to v4.2 for Lock icon styling)

---

## 21. Mail Order Code Column (NEW v4.2 — unchanged in v4.4)

(Refer to v4.2 for Code column three-state styling)

---

## 22. Delivery Type Dot — Normalization (NEW v4.2 — unchanged in v4.4)

(Refer to v4.2 for delivery type dot colors and normalization)

---

## 23. Mail Order Customer Subtext (NEW v4.2 — unchanged in v4.4)

(Refer to v4.2 for customer subtext styling)

---

## 24. Universal Header — Quick Reference (NEW v4.3 — unchanged in v4.4)

(Refer to v4.3 for universal header quick reference)

---

## 25. Mail Order Table — Column Widths (UPDATED v4.4)

### Parent table colgroup (12 columns)

```
Time(68) | SO Name(120) | Customer(220) | Lines(56) | Dispatch(80) |
Remarks(120) | Code(90) | SKU(82) | SO No.(110) | Lock(46) | Status(80) | Punched By(100)
```

Changes from v4.3: Remarks 140→120, SKU 60→82, Lock 70→46, Status 100→80, Punched By 120→100, Lines 54→56.

### Expanded view inner table colgroup (8 columns)

```
# (38) | Raw Text (30%) | SKU Code (130) | Description (30%) | Pk (48) | Qty (52) | Vol (56) | Status (76)
```

New columns added in v4.4: Description (fills dead space with skuDescription), Vol (per-line volume).

---

## 26. Mail Order Lines Cell — Stacked Volume Display (NEW v4.4)

The Lines cell in the collapsed row uses a vertical stack layout:

```tsx
<div className="flex flex-col items-center leading-tight">
  <span>3/3</span>           {/* fraction: green-600 or amber-600 */}
  <span>480L</span>          {/* volume: green-500 or amber-400, text-[10px] */}
  <span>✂ A</span>           {/* split badge: purple-500, text-[9px] — only if split */}
  <span>⚠ 1,620L</span>      {/* volume warning: amber-600, text-[9px] — only if > threshold */}
</div>
```

**Volume warning badge appears when:**
- Order has no splitLabel (not already split)
- Order is not punched
- Total volume > 1500L OR total lines > 20

**Split badge:** `✂ A` or `✂ B` in `text-[9px] text-purple-500 font-medium`

---

## 27. Mail Order Split Pair Styling (NEW v4.4)

### Left border
Split orders get `3px solid #a78bfa` (purple-400) left border. Priority order for left borders:
1. Flagged (red): `3px solid #f87171`
2. Focused (amber): `3px solid #f59e0b`
3. Punched (teal): `3px solid #0d9488`
4. Split (purple): `3px solid #a78bfa`
5. None

### Customer name
Append split label: `"Mistry Brothers (A)"`, `"Mistry Brothers (B)"`

### Sort order
Split pairs sort by `receivedAt` time like normal orders, A before B within same time.

---

## 28. Mail Order Batch Copy Button (NEW v4.4)

### Normal orders (≤20 matched lines)
```
📋 4                           {/* Copy icon + count */}
```
Styling: `inline-flex items-center gap-1 border rounded-md text-[11px] font-medium px-2 h-[28px]`

### Large orders (>20 matched lines)
```
📋 1-20 (1/2)                  {/* Copy icon + range + counter */}
```
Range: `text-[10px]`, counter: `text-[8px] text-gray-400`, icon: `Copy size={10}`

Click advances to next batch. S key follows same cycle.

### States
- Default: `border-gray-200 text-gray-600 hover:bg-gray-50`
- Copied (teal flash): `bg-green-50 border-green-200 text-green-700`
- Disabled: `border-gray-100 text-gray-300 cursor-not-allowed`

---

## 29. Mail Order View Original Toggle (NEW v4.4)

### Toggle button (appears above line items table)

**Only shown when:** order has >5 lines (split or non-split).

**Styling:**
- Inactive: `text-[10px] font-medium px-2.5 py-1 rounded border bg-white border-gray-200 text-gray-500 hover:bg-gray-50`
- Active: `bg-purple-50 border-purple-200 text-purple-700`

**Button text:**
- Split orders: "📧 Original Order" / "✂ Split View"
- Non-split orders: "📧 Email Order" / "📦 Sorted View"

### OriginalLinesTable (split orders only)

Same column layout as normal expanded view plus Group column:
```
# | Raw Text | SKU Code | Description | Pk | Qty | Vol | Group
```

Group column shows colored pills:
- Group A: `text-[9px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-200`
- Group B: `text-[9px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200`

Current group lines at full opacity, other group at `opacity: 0.5`.

### # column behavior
- Sorted view (default): shows `idx + 1` (sorted position)
- Original/email view: shows `originalLineNumber` (email sequence)

---

## 30. Mail Order Split Suggestion Banner (NEW v4.4)

Appears inside expanded view when resolving lines pushes volume above threshold.

```tsx
<div className="mx-4 mt-3 mb-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
  <p className="text-[12px] font-semibold text-amber-800">
    ⚠ Large order — split recommended
  </p>
  <p className="text-[11px] text-amber-600 mt-1">
    Group A: 9 lines · 1034L | Group B: 34 lines · 1034L
  </p>
  <button className="text-[10px] text-gray-500">Dismiss</button>
  <button className="text-[10px] font-semibold text-white bg-amber-600 rounded px-3 py-1.5">
    ✂ Split Order
  </button>
</div>
```

---

## 31. Mail Order Expanded View — Line Sort (NEW v4.4)

### Sort logic for orders >5 lines

Lines sorted by `sortLinesForPicker()`:
1. **Primary:** `productName` alphabetical (groups same product together)
2. **Secondary:** pack volume DESC (largest pack first: 20L → 10L → 4L → 1L → 500ml → 200ml)
3. **Unknown/zero-volume packs:** sort to end

### Orders ≤5 lines
No sort applied. Lines show in email/database order.

### SKU copy follows sort order
When copy button is clicked, clipboard text uses sorted line order (not email order). SAP paste matches the picker-friendly sequence.

### Future: paintType grouping
When `paintType` column is added to `mo_sku_lookup`, sort becomes three-level:
`paintType → productName → packSize DESC`
This will group oil-paint and water-paint SKUs into warehouse zones.

---

*Version: v4.4 · Teal Brand System · Universal Header · Mail Order Enrichment · April 2026*
