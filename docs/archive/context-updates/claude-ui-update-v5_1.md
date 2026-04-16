# CLAUDE_UI Update — v5.1 additions
# Merge into CLAUDE_UI_v5.md after §39

---

## 40. Fixed Table Layout Standard — ALL Data Tables

All data tables in Orbit OMS use `table-layout: fixed` with `<colgroup>` percentage widths. This is the ONLY approved table pattern. Never use auto-layout or pixel-width columns.

### Pattern
```tsx
<table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
  <colgroup>
    <col style={{ width: "4%" }} />
    <col style={{ width: "24%" }} />
    {/* ... percentage widths totaling ~100% */}
  </colgroup>
  <thead>...</thead>
  <tbody>...</tbody>
</table>
```

### Rules
- **Always `table-layout: fixed`** — predictable column widths, no content-driven reflow
- **Always `<colgroup>`** — column widths defined once, not repeated per cell
- **Always percentage widths** — responsive to container, derived from fr-unit technique (e.g. 4fr = 4%)
- **Never pixel widths on columns** — use percentage. Pixel values only for cell padding and row height.
- **Cell overflow:** `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` on all `<td>` and `<th>`

### Standard Row Sizing
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
| Header background | `bg-gray-50` (#f9fafb) |
| Row hover | `bg-gray-50` (#f9fafb) |

### Standard Header Typography
```
font-size: 10px; font-weight: 500; text-transform: uppercase;
letter-spacing: 0.05em; color: #9ca3af (gray-400);
```

### Standard Data Typography
```
Primary: 11px, font-weight 500, #111827 (gray-900) — customer names, product names
Secondary: 11px, #4b5563 (gray-600) — data values
Muted: 11px, #9ca3af (gray-400) — timestamps, line numbers, volumes
Mono: 11px, "SF Mono"/ui-monospace/Menlo — SKU codes, material numbers
```

### Applies To
- Review View SKU table (review-view.tsx) — 9 columns: 4/24/11/26/5.5/5.5/5.5/12/6.5%
- Mail Orders expanded table (mail-orders-table.tsx) — 8 columns: # (38px) then percentages
- Any future data table in any module

---

## 41. Review View — Layout

**Component:** `review-view.tsx` — third view mode for /mail-orders.

Split panel: 320px left (order list) + flex-1 right (detail + table + footer).

### Left Panel (320px)
- Search input: 28px height, 11px font, gray-200 border, teal focus ring
- Order rows: `px-3.5 py-2.5`, border-bottom gray-100, border-left 3px
- Row states: selected (`bg-teal-50 border-l-teal-600`), flagged (`border-l-amber-600`), punched (`opacity-40`), default (`border-l-transparent`)
- Line 1: delivery dot (5px) + customer name (13px semibold) + time (11px muted, right-aligned, tabular-nums)
- Line 2: SO name (11px muted)
- Sort: ascending by receivedAt (earliest first)
- Punched divider: "▸ N punched", 10px text, bg-gray-50, collapsible

### Right Panel — Detail Header
**Row 1** (`px-5 pt-3 pb-[7px]`): delivery dot (6px) → customer name (17px bold tracking-tight) → code chip (3 states) → match chip → dispatch badge → signal badges → Order No. input group + Punch button

**Row 2** (`px-5 pb-2.5`): meta (11px muted, dot-separated) → 3 icon-only action buttons (28×28, no text, title tooltip)

### Right Panel — SKU Table
Fixed layout per §40. Columns: # / Raw Text / SKU Code / Description / Pk / Qty / Vol / Status / Toggle.

### Right Panel — Remarks Footer
`bg-gray-50`, `border-top: 1px solid gray-200`, `padding: 8px 20px`.
4 sections: Delivery / Bill / Notes / Received (60px fixed).
Labels: 9px uppercase gray-400. Values: 11px gray-600.

### Right Panel — Nav Footer
36px height, border-top gray-200. ← Prev / "N of M" / Next → (26px buttons). Keyboard hints text (9px muted).

---

## 42. Review View — SKU Table Row States

**Normal:** raw text #374151, SKU mono #6b7280, product bold #111827 + base #6b7280, qty bold #374151

**Partial:** description + SKU in amber (#b45309/#d97706). PARTIAL tag: `9px font-semibold, bg-amber-50 text-amber-700 border-amber-200`

**Not-found (toggle OFF):** all text #d1d5db EXCEPT qty stays #374151. Status cell shows reason label (`10px, bg-gray-50, border-gray-200`). No strikethrough.

**Unmatched:** description italic #9ca3af "No match found". UNMATCHED tag: `9px, bg-gray-50 text-gray-400 border-gray-200`. "Resolve →" link: `10px teal-600 font-medium`.

---

## 43. Review View — Toggle + Reason Dropdown

**Toggle:** 28×14px, border-radius 7px. ON: `bg-green-600`. OFF: `bg-gray-300`. Knob: 10×10px white, `box-shadow: 0 1px 2px rgba(0,0,0,0.08)`, transition left 0.12s.

**Reason dropdown:** 148px wide, white bg, rounded-lg, `shadow: 0 4px 16px rgba(0,0,0,0.1)`, padding 3px. Options numbered 1-5 (mono 9px muted digit prefix): out_of_stock, wrong_pack, discontinued, other_depot, other. Divider before "Other". Options: 6px/10px padding, 11px font-medium, rounded-[5px], hover bg-gray-50.

---

## 44. Review View — Active Line Highlight

Background: `#fefce8` (yellow-50). First cell left border: `3px solid #eab308` (yellow-500). No outline. Warm cursor-row feel that doesn't fight amber/yellow status badges.

---

## 45. View Toggle (Updated from §39)

Now 3 buttons: `Table | Review | Focus`. Same styling:
Container: `border border-gray-300 rounded-[5px] overflow-hidden`
Active: `bg-gray-800 text-white`
Inactive: `bg-white text-gray-500 hover:bg-gray-50`

---

*Version: v5.1 · Fixed Table Standard · Review View · April 2026*
