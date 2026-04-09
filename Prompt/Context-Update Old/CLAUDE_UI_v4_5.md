# CLAUDE_UI.md — Orbit OMS UI Design System
# Load alongside CLAUDE_CONTEXT.md for all UI implementation sessions.
# This is the SINGLE SOURCE OF TRUTH for visual styling across all screens.
# Version: v4.5 · Teal Brand System · Universal Header · Signal Badges · April 2026

---

## 1. Design Philosophy

- **Neutral first.** White backgrounds, gray borders, minimal color. Color is reserved for semantic meaning and brand actions only.
- **Teal is the brand color.** `teal-600` (#0d9488) is the single brand accent. It appears on CTAs, focus rings, active nav, sidebar accent bar, logo button, user avatars, active slot segment, and the login dot. Nowhere else.
- **The old indigo theme (#1a237e) is FULLY DEPRECATED.** Do not use indigo fills, indigo borders, or indigo text anywhere. No exceptions.
- **Three color roles — memorize these:**
  - **Teal** = brand action (CTA buttons, focus rings, toggles ON, nav active, avatars, logo, active slot segment)
  - **Gray** = structure (borders, text hierarchy, slot pills, filter chips, page bg, clock, search, shortcuts, date stepper)
  - **Semantic** = status only (green=done, red=urgent/error/blocker, amber=waiting/timing — never for decoration)
- **Minimal chrome.** Maximize content area. Header + controls in 2 rows max. No stat cards unless explicitly requested.
- **Text hierarchy drives scannability.** Darkest = primary identifier, medium = data, lightest = context.
- **Smart Title Case for display.** All user-facing text from DB rendered with smartTitleCase(). See §19.
- **Universal header for ALL boards.** Every screen uses `<UniversalHeader />`. No custom headers. See §24.

---

## 2-5. [Unchanged from v4]

(Brand Color, Color Palette, Typography, Borders & Spacing — refer to v4 for full content)

---

## 6. Page Layout — Universal Header System (REWRITTEN v4.3 — unchanged in v4.5)

(Refer to v4.3 for full Universal Header layout documentation)

---

## 7-18. [Unchanged from v4]

(Sidebar, Cards, Forms, Buttons, IosToggle, Login, Modal, Date Range Picker, Interactions, Screen-Specific Notes, Palette Sweep, Deprecated — refer to v4 for full content)

---

## 19. Smart Title Case (NEW v4.2 — unchanged in v4.5)

(Refer to v4.2 for full smartTitleCase documentation)

---

## 20. Lock Column (UPDATED v4.5)

Lock icon triggers automatically via `isOdCiFlagged(order)` using **word-boundary regex** patterns:

```typescript
const OD_CI_PATTERNS = [
  /\bOD\b/i,
  /\bCI\b/i,
  /\bcredit\s*hold\b/i,
  /\bblock\b/i,
  /\boverdue\b/i,
  /\bbill\s*tomorrow\b/i,
];
```

Checks `remarks`, `subject`, and `billRemarks` fields. Word-boundary (`\b`) prevents false positives from substrings like "Plywood", "Khodiyar", "Acrylic".

Manual lock is still local state only (not persisted to DB).

---

## 21. Mail Order Code Column (NEW v4.2 — unchanged in v4.5)

(Refer to v4.2 for Code column three-state styling)

---

## 22. Delivery Type Dot — Normalization (NEW v4.2 — unchanged in v4.5)

(Refer to v4.2 for delivery type dot colors and normalization)

---

## 23. Mail Order Customer Subtext (NEW v4.2 — unchanged in v4.5)

(Refer to v4.2 for customer subtext styling)

---

## 24. Universal Header — Quick Reference (NEW v4.3 — unchanged in v4.5)

(Refer to v4.3 for universal header quick reference)

---

## 25. Mail Order Table — Column Widths (unchanged from v4.4)

### Parent table colgroup (12 columns)

```
Time(68) | SO Name(120) | Customer(220) | Lines(56) | Dispatch(80) |
Remarks(120) | Code(90) | SKU(82) | SO No.(110) | Lock(46) | Status(80) | Punched By(100)
```

### Expanded view inner table colgroup (8 columns)

```
# (38) | Raw Text (30%) | SKU Code (130) | Description (30%) | Pk (48) | Qty (52) | Vol (56) | Status (76)
```

---

## 26. Mail Order Lines Cell — Stacked Volume Display (unchanged from v4.4)

(Refer to v4.4 for Lines cell stacked layout)

---

## 27. Mail Order Split Pair Styling (unchanged from v4.4)

(Refer to v4.4 for split pair left borders, customer name suffix, sort order)

---

## 28. Mail Order Batch Copy Button (unchanged from v4.4)

(Refer to v4.4 for batch copy button styling and states)

---

## 29. Mail Order View Original Toggle (unchanged from v4.4)

(Refer to v4.4 for toggle button and OriginalLinesTable styling)

---

## 30. Mail Order Split Suggestion Banner (unchanged from v4.4)

(Refer to v4.4 for split suggestion banner styling)

---

## 31. Mail Order Expanded View — Line Sort (unchanged from v4.4)

(Refer to v4.4 for sort logic and future paintType grouping)

---

## 32. Mail Order Remarks Column — Signal Badges (NEW v4.5)

### Overview

The Remarks column displays **compact signal badges** instead of raw text. Each badge represents one actionable signal extracted from `remarks`, `billRemarks`, and `deliveryRemarks`. Full raw text is available on hover (title attribute).

### Signal types and colours

| Type | Colour | Triggers | Example Badge |
|------|--------|----------|---------------|
| blocker | `bg-red-50 text-red-700 border-red-200` | OD, CI, Bounce | `[OD]` `[CI]` `[Bounce]` |
| timing | `bg-amber-50 text-amber-700 border-amber-200` | Bill Tomorrow, 7 Days | `[Bill Tomorrow]` `[7 Days]` |
| bill | `bg-gray-50 text-gray-600 border-gray-200` | Bill N (from bill splitting) | `[Bill 3]` |
| context | `bg-gray-50 text-gray-500 border-gray-200` | DPL, Challan attachment | `[DPL]` `[📎 Challan]` |
| cross | `bg-purple-50 text-purple-600 border-purple-200` | Cross billing | `[Cross Q45D]` |
| shipto | `bg-orange-50 text-orange-600 border-orange-200` | Ship-to override | `[→ Ship-to]` |

### Badge styling

```tsx
<span className="text-[9px] font-medium px-1.5 py-0.5 rounded border {typeClasses}">
  {label}
</span>
```

Badges wrap in `flex flex-wrap gap-0.5`.

### Deduplication rules

- **Extension hidden when Bill Tomorrow present** — same signal, Bill Tomorrow is more specific
- **Customer code stripped** — "Code: 678709" removed from display (redundant with Code column)
- **No raw text shown** — only badges. Full text on hover via `title` attribute

### Signal extraction

`extractSignals(order)` function in mail-orders-table.tsx:
- Combines `remarks + billRemarks + deliveryRemarks` into one lowercase string
- Applies regex patterns for each signal type
- Returns typed array of `{ label, type }` objects
- Deduplicated — each signal appears once

---

## 33. Mail Order Expanded View Footer (UPDATED v4.5)

Previously 4 columns. Now 3:

```
DELIVERY REMARKS | BILL REMARKS | RECEIVED
```

**Body Remarks removed** — content already shown as signal badges in collapsed row.

Styling unchanged: `text-[10px] font-medium text-gray-400` for headers, `text-[11px] text-gray-600` for values.

---

## 34. Mail Order Bill Sort Order (NEW v4.5)

Bill-split orders sort by bill number within the same `receivedAt` timestamp.

Full sort order in `groupOrdersBySlot()`:
1. `receivedAt` (earliest first)
2. Bill number (Bill 1 → Bill 2 → Bill 3...)
3. Split label (A before B)

`getBillNumber(order)` extracts number from `order.remarks` matching `^Bill\s+(\d+)$`. Returns 0 if no bill number.

---

*Version: v4.5 · Teal Brand System · Universal Header · Signal Badges · April 2026*
