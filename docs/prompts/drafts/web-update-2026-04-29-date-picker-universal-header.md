# Web Update — Date Picker in Universal Header

**Date:** 2026-04-29
**Type:** Feature (UI)
**Commit:** 997fce8f
**Status:** Shipped to production

---

## What changed

Replaced the date stepper in `components/universal-header.tsx` with
a click-to-open calendar popover. The previous stepper required
clicking ◀ repeatedly to jump back more than a few days — punishing
for any date more than ~3 days old. Calendar lets users jump to
any past date in one click.

Affects all 5 boards using the universal header date stepper:
- Support
- Planning
- Warehouse
- Mail Orders
- Delivery Challan

Boards passing `showDatePicker={false}` (Tint Manager kanban,
Tint Operator, TI Report, Shade Master) are unaffected.

---

## Files changed

- **NEW:** `components/ui/date-picker-popover.tsx` (~200 lines)
  - Custom calendar component, no external date library
  - Built on `@base-ui/react` Popover (already in project)
  - Self-contained: copies `todayIST` / `toISTDateStr` helpers
    from universal-header.tsx (4 lines, intentional duplication)
- **MODIFIED:** `components/universal-header.tsx`
  - Replaced stepper render block (was ~lines 484-512)
  - Middle date label now wraps in `<DatePickerPopover>` and gains
    a `▾` caret (ChevronDown size=10) for affordance
  - Outer ◀ ▶ arrow buttons unchanged (still step ±1 day)

**No consumer changes.** Date prop API on UniversalHeader is
identical: `currentDate?: Date; onDateChange?: (date: Date) => void`.
None of the 5 consumer pages (warehouse-page, support-page-content,
planning-page, mail-orders-page, challan-content) needed edits.

---

## Design decisions

- **Custom calendar, no new deps.** Considered `react-day-picker`
  but rejected — would have added ~50KB + a new dependency. Custom
  grid is ~120 lines of date math, fully under our control, and
  matches v5.1 colour rules without fighting library defaults.
- **Monday-first.** India + most of Europe convention. Computed
  via `(getDay() + 6) % 7`.
- **No future dates.** Matches existing stepper behaviour (▶ was
  always disabled on today). Future days rendered gray-300 +
  cursor-not-allowed. Next-month chevron disabled when next
  month starts in the future.
- **Teal-600 only on the selected date cell.** Honours UI v5.1 §6
  "ONE teal element per row" rule — the selected date is the only
  brand-coloured element inside the calendar. Today (when not
  selected) is differentiated by font-weight only, no ring/bg.
- **Caret `▾` on date label.** Signals click-to-open. Without it
  users wouldn't know the label is now interactive (it wasn't
  before — only arrows were clickable).
- **Separate file (`components/ui/date-picker-popover.tsx`).**
  universal-header.tsx was already 517 lines; adding 120 more
  pushed it past readable. Calendar is also reusable later
  (e.g. for TI Report date-range filter) if needed.
- **Keyboard arrow nav inside calendar grid: deferred.** Esc-to-close
  works (Popover primitive). Click-only for v1. Add later if anyone
  asks.

---

## How it behaves

- Click `Today · 29 Apr ▾` → calendar opens below, right-aligned
- Click any past date → fires `onChange(date)`, popover closes
- Click "Today" footer button → snaps to today, closes
- Click outside / Esc → closes (handled by `@base-ui/react` Popover)
- ◀ arrow → previous day, always enabled
- ▶ arrow → next day, disabled on today
- Reopening popover re-syncs viewMonth to currently selected date
  (browsing to Feb then closing doesn't strand the user there next
  open)

---

## Update for canonical context files

### `docs/CLAUDE_UI.md` §6 — Universal header system

The "Date stepper" subsection currently reads:

> ### Date stepper
> `‹ Today · 04 Apr ›` inline-flex. Right arrow disabled when
> viewing today.

Should become:

> ### Date picker
> `‹ Today · 04 Apr ▾ ›` inline-flex. Middle label opens a calendar
> popover (`components/ui/date-picker-popover.tsx`). Outer arrows
> step ±1 day; right arrow disabled on today. Calendar: 244px wide,
> Monday-first, no future dates, teal-600 only on selected day.

### `docs/CLAUDE_CORE.md` §12 — Universal header system

Reference to "Date stepper" in the per-board wiring table is fine
as a category name, but anywhere that explicitly describes the
stepper behaviour should be updated to "Date picker (calendar
popover)".

### Tech stack note (`docs/CLAUDE_CORE.md` §2)

No change. We did NOT add a date library. `@base-ui/react` Popover
was already locked in.

---

## Known follow-ups

- **Keyboard arrow nav inside calendar grid.** Deferred from v1.
  Currently click-only. If anyone (Deepanshu, Rahul) asks for
  arrow keys to navigate days, ~30 lines to add to
  `date-picker-popover.tsx`.
- **Date constraints API.** Component currently hardcodes "no
  future dates". If a future board needs unbounded dates (e.g.
  Dispatch Planning Phase 4 may need to plan for tomorrow), add
  a `maxDate?: Date` prop and thread it through. Not needed today.
- **No regression risk on hidden boards.** Tint Manager / Operator
  / TI Report / Shade Master pass `showDatePicker={false}` — picker
  never mounts on those screens. Verified visually on Tint Manager
  during smoke test.

---

## Smoke test record

Manual checks performed against dev server before push:

| # | Check | Result |
|---|---|---|
| 1 | Calendar opens, right-aligned to label | ✓ |
| 2 | Selecting past date updates board, closes popover | ✓ |
| 3 | Future days greyed and not clickable | ✓ |
| 4 | "Today" footer button works | ✓ |
| 5 | Esc closes popover | ✓ |
| 6 | Click outside closes popover | ✓ |
| 7 | ◀ ▶ arrows still work, ▶ disabled on today | ✓ |

Tested on `/mail-orders` and `/tint/manager/challans`. Tint Manager
kanban confirmed no calendar (showDatePicker={false} working).

`npx tsc --noEmit` — zero errors.
