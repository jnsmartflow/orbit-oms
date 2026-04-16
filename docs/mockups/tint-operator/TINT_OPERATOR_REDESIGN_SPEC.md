# TINT_OPERATOR_REDESIGN_SPEC.md
# Reference: TINT_OPERATOR_REDESIGN_v4.html (mockup)
# Load alongside CLAUDE_CONTEXT + CLAUDE_UI for implementation sessions.

---

## Layout — Outlook SKU Split

Two-panel split (same pattern as Mail Orders Review View and Delivery Challans):

- **Left panel (320px):** SKU tinting lines for the current job
- **Right panel (flex):** TI form for the selected line

Job queue is NOT a panel. It lives in a **dropdown popover** triggered by clicking the job pill in UniversalHeader Row 2.

---

## UniversalHeader Row 2 — Job Context Bar

```
[Job Pill] | [Bill To pill] [Ship To pill]           [Queue · N] [Done · N]
```

### Job Pill (clickable → opens queue dropdown)
- Shows: `#seq · customerName · obdNumber · statusBadge · [miniProgressBar N/M] ▾`
- Mini progress bar: 40px wide, 4px tall, rounded
  - Color: amber-600 (<25%), teal-600 (25-75%), green-600 (>75%)
  - Fraction text: `N/M` in 9px font-weight 600
- Click → opens queue dropdown below
- Open state: teal-50 bg, teal-600 border, chevron rotates 180°

### Bill To / Ship To Inline Pills
- Compact pills: `[BILL TO label] name · code` and `[SHIP TO label] [delivery dot] name · area · route`
- Same gray-50 bg, gray-200 border as current design system pills

### Segments (right side)
- `Queue · N` (active teal) and `Done · N` (inactive)
- Queue = remaining jobs count, Done = completed today count

---

## Queue Dropdown

- Width: 380px, border-radius 10px, shadow `0 8px 24px rgba(0,0,0,0.1)`
- **Scoreboard header** (gray-50 bg):
  - "Today's Target" title + "Assigned by Chandresh" subtitle
  - Large fraction: `N of M` (18px bold number, 13px "of M")
  - Progress bar: 6px tall, same colour rules as mini bar
- **Body** (max-height 480px, scroll):
  - "Remaining (N jobs)" label
  - Job cards: `#seq · customerName · obdNumber · TI badge · meta line`
  - Current job: teal-50 bg, teal left border, "Current" badge (teal-600 bg white text)
  - Future jobs: dimmed at 0.45 opacity
- **No completed section** — done count is in header stats
- Click card → switch job, dropdown closes
- ↑↓ keyboard navigation
- Click outside / Esc → close

---

## Left Panel — SKU Lines (320px)

### Header
- "SKU Lines" title + meta: `N Drum · N L · N tinting`

### SKU Line Cards
- Shows: code (mono) · TINT badge · description · qty · volume · pack · TI status badge
- Selected: teal-50 bg + teal-600 left border (3px)
- Pending (no TI entry): amber-200 left border, faint amber bg
- Done (has TI entry): green-200 left border
- Non-tinting lines: separate section below, compact rows, gray text

### Coverage Footer (pinned)
- Text: `N of M covered` (amber if incomplete, green if all done)
- Progress bar: 4px tall, fills proportionally

---

## Right Panel — TI Form

### TI Header (pinned)
- Left: `Line N of M` + TINT badge + mono detail (code · description · qty)
- Right: TINTER / ACOTONE toggle (same gray-900 active style)

### Suggestion Strip
- Horizontal scrollable row of shade cards (not vertical list)
- Each card: shade name (12px bold) + pack + last used date
- Applied shade: teal-600 border + teal-50 bg
- "All shades…" card at end opens full browse popover
- Takes ~50px height instead of 150px+

### TI Form Card
- **Applied shade indicator** (when shade selected): gray-50 bar with shade name pill + "Clear ×"
- **Qty row**: Tin Qty input + Pack Size display + Save shade toggle (IosToggle) — all inline
- **Shade name input**: appears below qty row when save toggle is ON
- **Shade grid**: 
  - After shade applied: show only active columns (values > 0) + 2 empty
  - `+ Show all N` link to expand full grid
  - New manual entry: show all 13/14 columns
  - Green-50 bg + green-200 border on inputs with values

### Footer (pinned)
- Left: ← → line navigation arrows + line position text OR timer badge (in progress)
- Right (state-dependent):
  - **Assigned, TI not submitted:** single teal `Submit TI & Start`
  - **In Progress:** teal `Add TI Entry` + green `Mark as Done`
  - **Assigned, TI submitted, another active:** gray text "Another job is in progress — TI submitted ✓"
  - **Assigned, TI submitted, no active:** teal `Start Job`

---

## CTA Colours

- **Primary action (Submit TI, Add TI, Start Job):** `bg-teal-600 hover:bg-teal-700` (brand CTA per §2)
- **Completion (Mark as Done):** `bg-green-600 hover:bg-green-700` (semantic: done)
- **NOT gray-900** — teal is the correct brand primary CTA

---

## API Changes Required

`/api/tint/operator/my-orders` must additionally return:

1. **Per order/split:** `billToCustomerId`, `billToCustomerName` (from `import_raw_line_items`)
2. **Per order/split:** `areaName`, `routeName`, `deliveryTypeName` (from `customers → areas → primaryRoute / deliveryType`)
3. **Top-level counts:** `totalAssignedToday` (all jobs assigned to this operator today, including completed), `totalDoneToday` (completed count)

These feed the progress bar: done/total = progress fraction.

---

## Files to Modify

1. `app/api/tint/operator/my-orders/route.ts` — add bill-to, area/route/delivery, progress counts
2. `components/tint/tint-operator-content.tsx` — full layout rewrite (5 prompts)

## Files NOT Modified

- All TI API routes (submit, start, done, patch) — unchanged
- Shade API routes — unchanged  
- `order-detail-panel.tsx` — not used in operator screen
- `middleware.ts`, `layout.tsx`, `page.tsx` — unchanged

---

*Design locked: April 2026 · Reference mockup: TINT_OPERATOR_REDESIGN_v4.html*
