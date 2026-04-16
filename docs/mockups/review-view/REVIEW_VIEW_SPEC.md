# REVIEW_VIEW_SPEC.md — Mail Orders Review View
# Implementation specification for Claude Code sessions
# Created: April 2026 · Design approved by Smart Flow
# Read alongside: CLAUDE_CONTEXT_v61.md + CLAUDE_UI_v5.md + context-update-v62.md

---

## 1. WHAT IS THE REVIEW VIEW

A third view mode for /mail-orders (alongside Table and Focus).
Master-detail split panel optimised for Deepanshu's daily SKU
confirmation and punching workflow.

**Why it exists:** The enrichment engine is new. Deepanshu needs to
visually confirm that each SKU was mapped correctly before punching
into SAP. He cross-checks enriched SKU against raw text the SO sent.

**It is ADDITIONAL — not a replacement.** Table view (mail-orders-table.tsx)
must NOT be touched. Both coexist. Toggle: Table | Review | Focus.

---

## 2. LAYOUT — SPLIT PANEL

```
┌──────────────────────────────────────────────────────────────┐
│ Universal Header (Row 1 + Row 2) — same as existing          │
├──────────┬───────────────────────────────────────────────────┤
│ LEFT     │ RIGHT PANEL                                       │
│ PANEL    │ ┌─────────────────────────────────────────────────┤
│ 320px    │ │ Detail Header (2 rows, sticky)                  │
│          │ ├─────────────────────────────────────────────────┤
│ Order    │ │ SKU Table (scrollable, 36px rows)               │
│ List     │ │ # | Raw Text | SKU Code | Description |         │
│          │ │   | Pk | Qty | Vol | Status | Toggle            │
│          │ ├─────────────────────────────────────────────────┤
│          │ │ Remarks Footer (sticky bottom)                  │
│          │ ├─────────────────────────────────────────────────┤
│          │ │ Nav Footer (← Prev | 1 of 8 | Next →)          │
└──────────┴───────────────────────────────────────────────────┘
```

---

## 3. LEFT PANEL (320px)

### Content
- Search/filter input at top (same 19-field search as existing)
- Order rows — 2 lines each:
  - Line 1: delivery dot + customer name (13px bold) + time (right-aligned, 11px muted)
  - Line 2: SO name (11px muted)
- NO badges, NO line counts, NO signal tags — pure identification
- Punched orders collapsed behind "▸ N punched" divider

### Slot filtering
- When slot selected in header → only that slot's orders show
- When no slot selected → all orders across all slots with slot dividers

### Row states
- Selected: `bg-brand-tint + border-left: 3px solid brand`
- Pending: white, normal
- Flagged: `border-left: 3px solid amber-600`
- Punched: `opacity: 0.4`

### Interaction
- Click order → loads in right panel
- ↑↓ keyboard → navigates (only when no input focused)
- N key → jumps to next unmatched order

---

## 4. RIGHT PANEL — DETAIL HEADER (2 rows)

### Row 1 — Identity + Order No. input
LEFT side (flex, wraps):
```
[delivery dot 6px] · Customer Name (17px bold) · Code chip · Match chip · Dispatch badge · Signal badges
```

**Sequence matters:** Name → Code → Match → Dispatch → Signals

RIGHT side (flex-shrink: 0):
```
[Order No. ________] [Punch]
```

**Order No. input group:**
- Label "Order No." inside the group (10px muted, left of input)
- Input: 120px wide, 30px tall, mono 14px font, neutral border
- Focus: teal border + ring (same as all inputs)
- Punch button: 32px tall, dimmed (gray) when empty, teal when 10 digits entered
- Enter key punches when input focused

### Row 2 — Meta + Secondary actions
LEFT:
```
SO name · time · area · delivery type · volume · lines count
```
All 11px muted gray.

RIGHT:
```
[📋 Copy Ctrl+C] [✉ Reply R] [⚑ Flag F]
```
Buttons: 24px tall, 10px font, gray borders, muted.

### Customer code states

**Exact match:** `549434` mono chip. Click copies. Hover: teal tint.

**Multiple match:** `3 found ▾` amber chip. Click opens customer picker
dropdown (reuse existing CodeCell picker popover from mail-orders-table.tsx).
Copy button dimmed until resolved.

**Unmatched:** Amber search input (130px, 24px tall). Deepanshu types to
find customer. Reuse existing customer search API + popover. Copy dimmed.

### Match chip
- Green `10/10` when all matched
- Amber `8/10` when partial/unmatched lines exist
- Clickable — scrolls to first problem line in table

### Signal badges (in header row 1)
Same signal badge system from existing table:
- Blocker (red): OD, CI, Bounce
- Attention (amber): Bill Tomorrow, Cross, Ship-to, Urgent
- Info (gray): Truck, Challan, DPL
- Remark preview: e.g. "Bill tomorrow" as amber chip

### Punched state
When order is punched, Row 1 right side changes:
```
✓ 1045373141 [✏] [Punched]
```
- SO number as static mono text with green checkmark
- Small edit icon (18px, bordered) — click turns back into input for editing
- "Punched" green label badge
- Reply button activates (teal color) — dimmed when pending

---

## 5. SKU TABLE

### Layout
- `table-layout: fixed` with `<colgroup>` percentage widths
- Container: `padding: 0 6px` for edge breathing room
- First/last row: `border-top/bottom: 4px solid transparent`

### Column widths (percentage, total ~100%)
```
#: 4%  |  Raw Text: 24%  |  SKU Code: 11%  |  Description: 26%
Pk: 5.5%  |  Qty: 5.5%  |  Vol: 5.5%  |  Status: 12%  |  Toggle: 6.5%
```

### Row sizing (from production mail-orders-table.tsx)
- Header: `height: 32px`, `bg-gray-50`, border `1px solid #ebebeb`
- Data rows: `height: 36px`, border `1px solid #f0f0f0`
- Cell padding: `padding-left: 14px; padding-right: 14px` (px-3.5)
- First column (#): `padding-left: 10px; padding-right: 4px; text-align: center`
- Last column (toggle): `padding-right: 12px; text-align: center`

### Header typography
```
font-size: 10px; font-weight: 500; text-transform: uppercase;
letter-spacing: 0.05em; color: gray-400;
```

### Data cell typography
```
#:           11px, gray-400
Raw Text:    11px, gray-700 (#374151)
SKU Code:    11px, mono, gray-500 (#6b7280)
Description: 11px, gray-500. Product name: font-weight 500, gray-900
Pk:          11px, gray-500, center
Qty:         11px, font-weight 500, gray-700, right
Vol:         11px, gray-400, right, tabular-nums
Status:      (see below)
Toggle:      (see below)
```

### Column details

**Raw Text:** Exactly what the SO typed. Plain text, no formatting.

**SKU Code:** Mono font.
- Matched: shows material code e.g. `IN5860142`
- Partial: shows code in amber-600
- Unmatched: shows `Fix` button (amber, same style as current ⚠ Fix)
  - Click opens resolve popover (see §7)

**Description:** `Product Name · Base Colour`
- Product name in bold (font-weight 500, gray-900)
- Base in regular weight, gray-500
- Partial: `PARTIAL` tag after description (amber-50 bg, amber-700 text, amber-200 border, 9px)
- Unmatched: italic "No match found" + `UNMATCHED` tag (gray) + `Resolve →` link (teal)

**Status:** Empty when found. When toggle is off (not-found):
- Shows reason label: "Out of stock", "Wrong pack", etc.
- Label style: 10px, gray-500, gray-50 bg, gray-200 border, rounded
- Clickable to change reason

**Toggle:** 28×14px, border-radius 7px
- ON: green-600 bg, knob at right
- OFF: gray-300 bg, knob at left
- Knob: 10×10px white circle with subtle shadow

### Row states

**Found (default):** Normal styling. Status empty. Toggle on.

**Not found (toggle off):**
- All text in row turns to gray-300 (#d1d5db) — muted but readable
- NO strikethrough
- Status cell shows reason label
- Qty stays normal color (still relevant for SO communication)

**Partial match:**
- Description text: amber-700
- SKU Code text: amber-600
- PARTIAL tag after description

**Unmatched:**
- Description: gray-400, italic, "No match found"
- SKU Code: `—` or `Fix` button
- UNMATCHED tag + Resolve link

### Toggle → Reason dropdown flow
1. Deepanshu clicks toggle OFF
2. Inline dropdown appears anchored to Status cell (position: absolute)
3. Dropdown: 148px wide, white bg, rounded-lg, shadow
4. Options: Out of stock | Wrong pack | Discontinued | Other depot | — | Other
5. Click option → saves via `saveLineStatus()` API, closes dropdown, shows label
6. Escape → closes without saving, toggle reverts to ON

---

## 6. REMARKS FOOTER

Sticky at bottom of right panel, above nav footer.
4 columns in a flex row, `bg-gray-50`, `border-top: 1px solid gray-200`.

```
DELIVERY          | BILL        | NOTES                    | RECEIVED
Truck delivery... | —           | [del] Call before...     | 09:15
```

Labels: 9px, uppercase, gray-400. Values: 11px, gray-600.
"Received" column: fixed 60px width.

---

## 7. RESOLVE POPOVER (for unmatched/partial lines)

When user clicks `Fix` button or `Resolve →` link:

- Popover anchored below the row, 400px wide
- Reuses existing resolve-line-panel.tsx logic but in popover container
- Content:
  - Left: Raw text + detected product/base/pack/qty (from line data)
  - Right: SKU search input (pre-filled) + pack filter + results + save/cancel
- API: `searchSkus()` and `resolveLine()` from lib/mail-orders/api.ts
- On resolve: update line in local state, close popover
- Escape: close popover

---

## 8. NAVIGATION — COMPLETE MAP

### Between orders
| Action | Method | Guard |
|---|---|---|
| Next order | `↓` key | Not when input/textarea focused |
| Prev order | `↑` key | Not when input/textarea focused |
| Click order | Mouse on left panel | Always works |
| Next unmatched | `N` key | Not when input focused |
| Auto-advance | 8s after punch | Same grace period as Focus mode |

### Within an order
| Action | Method | Guard |
|---|---|---|
| Focus Order No. | Click or Tab | — |
| Punch | Enter (in Order No. input) | Only when 10 digits |
| Copy code | Ctrl+C (1st) | Not when input focused, not when text selected |
| Copy SKUs | Ctrl+C (2nd) | Same |
| Reply | `R` key | Not when input focused. Only when punched. |
| Flag | `F` key | Not when input focused |
| Customer picker | `P` key | Not when input focused |
| Toggle line status | Click toggle | Mouse only |
| Select reason | Click dropdown | Mouse only |
| Fix unmatched | Click Fix/Resolve | Mouse only |

### Ctrl+V behavior
| State | Behavior |
|---|---|
| No input focused | Auto-focus Order No. input, let native paste happen |
| Order No. focused | Normal paste |
| Other input focused | Normal paste |

### Ctrl+C smart copy (unchanged from existing)
1. First press → copy customer code, flash code chip, toast
2. Second press → copy SKU batch (20 max), flash, toast
3. Third press (if >20 SKUs) → next batch
4. After all batches → reset
5. Focus changes to different order → reset

### Screen switching (Alt+Tab)
- visibilitychange event triggers data refresh (existing)
- Ctrl+V auto-focuses Order No. input when returning to Orbit
- No state lost during Alt+Tab

### Slot transitions
- Click segment → left panel filters to that slot
- Click active segment → deselect (show all)
- `E` key → slot completion modal
- `1-4` keys → jump to slot

---

## 9. VIEW TOGGLE

Header title changes from current 2-button to 3-button toggle:
```
[Table] [Review] [Focus]
```
Same styling as existing: gray-800 active, white inactive.
`viewMode` state: `"table" | "review" | "focus"`

Switching views preserves:
- Selected date
- Active slot
- Focused order ID (selected order carries over between views)
- Search query
- Filter state

---

## 10. FILES TO CREATE / MODIFY

### NEW FILE
`app/(mail-orders)/mail-orders/review-view.tsx`
— Main Review View component. ~800-1200 lines estimated.

### MODIFY (minimal changes)
`app/(mail-orders)/mail-orders/mail-orders-page.tsx`
— Add `viewMode === "review"` render branch
— Add "Review" button to view toggle
— Wire all existing handlers (same props as Table/Focus)

### DO NOT TOUCH
- `mail-orders-table.tsx` — existing table view
- `focus-mode-view.tsx` — existing focus mode
- `resolve-line-panel.tsx` — reuse as-is (or adapt for popover)
- `line-status-panel.tsx` — reuse saveLineStatus API
- `lib/mail-orders/*` — all utils, API helpers, types unchanged

---

## 11. IMPLEMENTATION ORDER — CLAUDE CODE PROMPTS

### Prompt 1: View toggle + empty Review View shell
- Add "Review" to viewMode type
- Add third button to header toggle
- Create review-view.tsx with empty shell
- Wire in mail-orders-page.tsx
- `tsc --noEmit` clean

### Prompt 2: Left panel
- Order list with slot filtering
- Selected state, flagged state, punched state
- Punched divider (collapsible)
- Search/filter integration
- ↑↓ keyboard navigation between orders

### Prompt 3: Detail header
- 2-row layout with all identity elements
- Order No. input group + Punch button
- Customer code 3 states (exact/multiple/unmatched)
- Match chip (green/amber)
- Signal badges from remarks
- Meta row + action buttons (Copy, Reply, Flag)

### Prompt 4: SKU table
- Table with colgroup percentages
- All cell typography matching production
- Row states: normal, partial, not-found, unmatched
- Toggle component (28×14px)
- Status column (empty / reason label)

### Prompt 5: Toggle → reason dropdown
- Toggle off → inline dropdown appears
- Reason selection → saveLineStatus API
- Auto-close on select
- Escape to cancel

### Prompt 6: Fix/Resolve popover
- Fix button on unmatched SKU Code cells
- Resolve popover (400px, anchored below row)
- Reuse searchSkus + resolveLine API
- Pack filter chip
- Remember match checkbox

### Prompt 7: Punched state + Reply
- Header transforms: static SO + edit icon + Punched label
- Reply button activates (teal)
- R key copies reply template + opens mailto
- Auto-advance to next pending (8s grace)

### Prompt 8: Smart copy + keyboard
- Ctrl+C state machine (reuse from page-level)
- Ctrl+V auto-focus Order No. input
- All single-key shortcuts (E, R, F, N, P, T, /)
- Escape cascading close

### Prompt 9: Remarks footer + nav
- 4-column footer
- ← Prev / Next → buttons
- Position counter "1 of 8"
- Keyboard hints

### Prompt 10: Polish + test
- tsc --noEmit clean
- Edge cases: empty orders, all punched, unmatched customer
- Preserve state when switching views
- Auto-refresh integration (30s polling + visibilitychange)

---

## 12. APPROVED MOCKUP REFERENCE

File: `review-view-FINAL.html` in project outputs.
Open in browser to reference exact spacing, colors, typography.

Key measurements locked:
- Left panel: 320px
- Table rows: 36px data, 32px header
- Cell padding: 14px (px-3.5)
- Toggle: 28×14px
- Column widths: 4/24/11/26/5.5/5.5/5.5/12/6.5 %
- Row borders: #f0f0f0 data, #ebebeb header
- Header: 12px top padding, 10px bottom padding per row

---

## 13. CONSTRAINTS (from original brief)

- mail-orders-table.tsx must NOT be touched
- All existing functionality preserved — nothing removed
- Reuse existing components — do not rebuild logic
- Follow CLAUDE_UI_v5.md exactly
- No new libraries
- Dev branch only — not main until approved
- tsc --noEmit clean after every prompt
