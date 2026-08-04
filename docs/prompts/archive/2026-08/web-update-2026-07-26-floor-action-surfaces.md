# Floor Control — action surfaces redesign

**File:** `docs/prompts/drafts/web-update-2026-07-26-floor-action-surfaces.md`
**Date:** 26 July 2026
**Session type:** Design + build (Claude.ai design/prompts → Claude Code execution)
**Status:** BUILT 26 Jul 2026, committed 27 Jul 2026. The earlier "SHIPPED" claim in this file was wrong — the code was written but never committed until the Support-retirement step 1 commit.
**Schema:** untouched (v27.12 at session start, no migration)
**UI version at session start:** v5.11 — recommend bump on consolidation

---

## 1. Scope

Three surfaces on Floor Control (`/floor`) were redesigned and rebuilt:

1. **Assign bar** (bulk action bar, `components/floor/assign-bar.tsx`)
2. **Detail panel header** (`components/floor/detail-panel.tsx`)
3. **Dispatch slot picker** (`components/support/dispatch-slot-picker.tsx`) — shared with `/support`

Interaction patterns were preserved throughout. No API route, no payload and no
schema changed in the entire session.

**Mockups:** `docs/mockups/floor-control/`
- `bulk-bar-v2.html` (5 states)
- `panel-header-v2.html` (6 states)
- `slot-picker-v2.html` (3 variants — **variant A shipped**)

Mockups contain elements that were deliberately **not** built. See §7.

---

## 2. Design rules established

These are new canon and should land in `CLAUDE_UI.md`.

**One teal per surface, and it goes to the state's real job.**
Not to a fixed button. The Floor detail panel proves the rule: Ship-to is teal in
most states because it is the only action that exists nowhere else in OrbitOMS —
slot and picker can both be driven from the table below. But on a held bill the
operator came to release, so Release takes the teal and Ship-to drops to neutral.
Exactly one teal button per state, never zero, never two.

**Disabled buttons are grey, never faded primary.**
`bg-gray-100 / border-gray-200 / text-gray-400 / cursor-not-allowed`. A faded teal
button reads as broken rather than waiting. Box model must be identical in both
states so the button does not shift when it becomes enabled — a border is present
in both states even when invisible against the fill.

**An editable value gets a pencil, not a label.**
A grey caption reading "Slot" followed by a chip reads as display-only, and
operators do not discover it. A chip carrying a small pencil icon is unambiguous.

**Facts live in the header, jobs live in the action row.**
The slot is a property of the bill in the same way its date and number are, so it
belongs on the identity line. The action row holds only things the operator
*does*.

**Selection summaries name what was selected.**
One row selected shows the customer name; multiple rows show volume and a route
count. Both are derived from data already in the component — no extra fetch.

---

## 3. What shipped

### 3.1 Assign bar — eight controls down to three

**Removed:**
- `Mark urgent` — the per-row ⚡ is already live in the floor table next to the
  customer name, so bulk urgent was redundant
- `Hold` — the detail panel's ⋯ menu already carries Hold for a floor bill
- `Unassign` — dropped as a consequence of the four-control layout (see §4)
- The duplicated `Change slot` label + separate `pick slot` trigger — this was the
  known duplication flagged in `CLAUDE_FLOOR.md §8`, now collapsed to one button

**Final layout:**

```
[ N selected ][✕]  summary          [Change slot] │ [picker ▾][Assign]
```

- Left: count, an inline ✕ clear button, then a muted summary line
  - 1 row → `{customer} · {vol} L`
  - 2+ rows → `{total} L · {n} routes`
  - any already assigned → appends ` · {n} already assigned`
- Right: `Change slot` (secondary) and a joined `[picker ▾][Assign]` unit where
  the dropdown and button touch and read as one control
- Assign button label flips to `Reassign all {n}` when every selected row already
  has a picker
- Assign is the only teal element on the surface, grey while disabled

The `Clear` text button moved from the far right into the selection summary as a
small ✕. It could not be deleted outright — see §5.1.

### 3.2 Detail panel header

- Slot moved **out of the action row** and up to the right end of the identity
  line, as a chip: clock icon, `DD-MM · HH:MM`, thin divider, pencil. Dashed
  border reading "No slot" when unset. Hidden on cancelled bills.
- The separate grey "Slot" label was deleted.
- `Change ship-to` → **`Ship-to`** with `whitespace-nowrap`. The old label wrapped
  onto two lines at the panel's 472px width. Teal variant ~93px (was ~131px),
  neutral ~74px (was ~112px).
- The string *"This bill is closed — ship-to still editable"* was deleted. The
  Done chip two lines above already carries that meaning.
- The ⋯ menu is byte-identical to before: Unassign (floor + assigned), Hold +
  Cancel (floor/rail), Cancel (hold), none (cancelled).

**Teal per state (verified, exactly one each):**

| State | Teal | Neutral |
|---|---|---|
| Waiting (floor) | Ship-to | picker ▾ + Assign, ⋯ |
| Assigned (floor) | Ship-to | picker ▾ + Reassign, ⋯ |
| Done / Checked | Ship-to | ⋯ |
| Held | Release | Ship-to, ⋯ |
| Rail | Release | Ship-to, ⋯ |
| Cancelled | Restore | Ship-to |

Rail and Cancelled were **not** part of the design review — Claude Code found them
in the code and applied the rule itself. They were smoke-tested but never
mockup'd.

Widest state is Assigned at ~340px against a ~440px content budget. No state
overflows 472px.

### 3.3 Slot picker restyle (shared component)

Pure restyle plus one honest-highlight fix. Commit-on-tap was preserved — there is
**no confirm button**, see §7.1.

- Unselected day tiles lost their grey fill; the strip is now one bordered
  container with hairline dividers between days
- Selected day is `bg-gray-900` with white text — near-black, **not teal**
- Selected window pill is likewise `bg-gray-900`
- The uppercase `WINDOW` caption label was deleted
- The repeated `Jul` month line was removed from every tile; a 3-letter month tag
  now appears only on tiles that cross into a new month
- The trigger pill (the everyday slot control on the Support board) was
  neutralised from `bg-teal-50 / border-teal-200` to `bg-gray-100 /
  border-gray-300`
- **No teal remains anywhere in the component**

Rationale for zero teal: with no confirm button there is no control in the popover
that writes. Teal marks the action button on the parent surface. A Support board
rendering 40 teal trigger pills was showing 40 things claiming to be the primary
action, when each is stating a fact.

### 3.4 Popover auto-flip

`popoverDir` became a **preference rather than a command**. On open — and on
scroll and resize while open — the popover measures the trigger rect and its own
height, uses the preferred direction if it fits, flips if it does not, and falls
back to the roomier side with `maxHeight` + internal scroll if neither fits. 8px
viewport-edge gap. Horizontal position is clamped so it never crosses a viewport
edge.

No portal was added — the component was **already** portalled to `document.body`
with `position: fixed`, so ancestor overflow was never the cause. The bug was
purely the fixed-in-advance direction.

No call site was edited.

---

## 4. Capabilities deliberately retired

Recorded here so a future session knows these were removed on purpose and does not
rediscover them as bugs.

| Capability | Replacement |
|---|---|
| **Bulk mark urgent** | Per-row ⚡ toggle, already live in the floor table |
| **Bulk hold** | Per-bill Hold in the detail panel ⋯ menu |
| **Bulk unassign** | Reassign on the bar; per-bill Unassign in the panel ⋯ |

Bulk unassign is the weakest of the three. It was not on the removal list — it
fell out of the four-control layout and was accepted after the fact. The scenario
it loses is "pull N bills back into the pool with nobody to hand them to," which
is rare on a depot floor. If it turns out to be needed, this is why it is missing.

Handlers `bulkMarkUrgent`, `bulkHold` and `bulkUnassign` were deleted from
`floor-page.tsx` after a repo-wide grep confirmed each was referenced only at the
old AssignBar call site. `rowMarkUrgent`, `railHold`, `detailActions.onHold` and
`detailActions.onUnassign` were kept — they have separate consumers.

---

## 5. Architectural facts discovered

### 5.1 The floor table header checkbox is a toggle-all, not a clear

`lib/floor/selection.ts` `toggleAll()`:

- **All** rows in the group selected → clicking clears that group
- **Some** rows selected (partial) → clicking **selects all**, it does not clear
- There is no indeterminate state, so the header renders unchecked on partial and
  reads as "select all"
- It is **per group**. Flat view has one; All view has one per slot band; By route
  has one per route. A selection spanning bands or created by a search auto-tick
  cannot be cleared by any single header checkbox.

This is why the Clear affordance could not be deleted and had to be relocated
instead. Any future proposal to remove a global clear must solve this first.

### 5.2 Esc ownership moved to floor-page.tsx

`detail-panel.tsx` previously registered its own window-level Esc → onClose. It has
been **removed**, and `floor-page.tsx` is now the single Esc owner for the whole
floor tree, because it is the only component holding both `detailOpen` and
`selection`.

Guard order:

```
Esc pressed
 → slot popover open  ([data-slot-popover="open"] present)  → nothing
 → focus in input / textarea / select / contentEditable     → nothing
 → detail panel open                                        → close panel
 → rows selected                                            → clear selection
 → else                                                     → nothing
```

Exactly one branch runs per keypress. The panel still closes via its ✕ and
backdrop.

**Do not add a second Esc listener anywhere in `components/floor/`.** Two
window-level keydown listeners race in registration order, which is exactly the
bug this replaced.

### 5.3 `data-slot-popover="open"` marker

The shared slot picker's portalled root carries `data-slot-popover="open"` while
open. It is an attribute only — no prop, no handler, no listener, no styling — and
exists solely so `floor-page.tsx`'s Esc guard can detect an open popover without
reaching into a shared component.

The picker itself does **not** close on Esc. Click-outside still dismisses it.

---

## 6. Cross-module impact — `/support`

`components/support/dispatch-slot-picker.tsx` is shared. Grepped call sites:

| Screen | File | Lines |
|---|---|---|
| Support main board | `support-orders-table.tsx` | 752, 1220, 1296 |
| Support Hold tab | `support-hold-table.tsx` | 350, 411 |
| Floor rail card | `floor/rail-card.tsx` | 128 |
| Floor detail panel | `floor/detail-panel.tsx` | 327, 386 |
| Floor bulk bar | `floor/assign-bar.tsx` | 72 |
| Floor Hold-tab bar | `floor/hold-bar.tsx` | 42 |

Support therefore received, without any Support file being edited:

- the quieter popover styling
- the neutralised trigger pill
- auto-flip positioning
- **the highlight behaviour change below**

### 6.1 Behaviour change — highlight now follows the bill, not today

**This is the most significant change of the session and the one to watch.**

Previously `activeDate` was reset to `""` on every open and fell back to `today`,
so the picker always opened with today highlighted regardless of the bill's actual
slot. A bill sitting on 25-07 · 16:00, opened on the 26th, showed the 26 tile
black with no window lit — the popover contradicted the chip above it.

Now:

- Bill's slot **is** in the visible 6-day rail → that day and window highlight
- Bill's slot is **not** in the rail (past date, or far future) → **nothing
  highlights**. No black tile, no lit pill. The operator picks fresh and nothing on
  screen states a falsehood.

**Consequence for a single tap:** tapping only a *time*, with no day tap, used to
move the bill to **today** at that time. It now keeps the bill on **its own day**
at the new time. This is the more correct behaviour — "move this from 16:00 to
12:30" should not silently drag the date as well — but it is a real change to what
one tap does, on a control Support operators use continuously.

The change is display-only. `handleSelect` is byte-identical; nothing is written on
open, on highlight change, or by the fallback. A stored value changes only when
the operator taps a window.

---

## 7. Mockup elements NOT built

Anyone reading the mockups later will find these drawn but absent from the code.
All four were dropped **after** the code audit, deliberately.

### 7.1 Confirm button + caption line in the slot picker

`slot-picker-v2.html` shows a caption ("Move 3 bills to") and a named confirm
button ("Move to 12:30"). The shipped picker commits on tap with no confirm step.

Dropped because the component is shared: adding a confirm would force Support
operators, who set slots all day, into a second click on their most frequent
action. The cost landed on someone else's workflow to tidy a Floor popover.

Knock-on effect: with no confirm button there was nowhere for teal to go, which is
why the picker now carries no teal at all — a better outcome than what was drawn.

### 7.2 Mixed-slot amber warning

`bulk-bar-v2.html` state 5 shows *"These 3 bills are not all on the same slot."*

Dropped. It requires threading each selected bill's current slot into the shared
picker as new data. Smart Flow's call: operators select bills within one slot in
practice, and the rare case is better handled by telling the operator directly
than by building a sentence for it.

### 7.3 "Print pick list" and "Copy OBD number" in the ⋯ menu

`panel-header-v2.html` state 6 shows both. **Neither exists.** They were invented
during design; there is no route or handler for a pick-list print. The ⋯ menu ships
unchanged.

### 7.4 The urgent bolt column

The mockup added a new narrow table column for a per-row ⚡, costing ~3% of the
fixed-percentage column budget (to be taken from Status at 20%).

Not built — **the ⚡ is already live** in the floor table beside the customer name,
and a second appears on row hover alongside ⋯. The floor table's column widths
`[4,4,14,20,10,7,12,9,20]` are **unchanged**.

---

## 8. Consolidation routing

Suggested destinations when this draft is merged.

| Content | Destination |
|---|---|
| §2 design rules | `CLAUDE_UI.md` — one-teal rule, disabled-state rule, pencil affordance |
| §3.1 assign bar spec | `CLAUDE_FLOOR.md` §4 |
| §3.2 panel header spec + teal-per-state table | `CLAUDE_FLOOR.md` §4.6 |
| §3.3 picker styling | `CLAUDE_SUPPORT.md` §4.10 (owner) — cross-reference from FLOOR |
| §3.4 auto-flip | `CLAUDE_SUPPORT.md` §4.10 |
| §4 retired capabilities | `CLAUDE_FLOOR.md` §4 |
| §5.1 header checkbox behaviour | `CLAUDE_CORE.md` landmines |
| §5.2 Esc ownership | `CLAUDE_FLOOR.md` §5 + `CLAUDE_CORE.md` engineering rules |
| §5.3 popover marker | `CLAUDE_SUPPORT.md` §4.10 |
| §6.1 highlight behaviour change | `CLAUDE_SUPPORT.md` §4.10 — **flag prominently** |
| §7.2 mixed-slot warning | `ROADMAP.md` (deferred) |

**Stale canon to fix during consolidation:**
`CLAUDE_FLOOR.md` §8 lists the "Change slot label + separate pick slot button"
duplication as an open item. It is resolved — grep every canonical file for that
phrasing, not just this one.

**Ownership boundary to state explicitly:**
`dispatch-slot-picker.tsx` lives in `components/support/` and is owned by
`CLAUDE_SUPPORT.md §4.10`. Floor is a caller from four places and documents none of
its internals. The ship-to search + PATCH route is likewise owned by
`CLAUDE_SUPPORT.md §4.18`; Floor calls it only.

---

## 9. Build sequence (for reference)

| # | Prompt | Files | Outcome |
|---|---|---|---|
| 1 | Audit | none (read-only) | Found 4 mockup items unbuildable as drawn |
| 2 | Slot picker restyle | picker | Styling only, no behaviour change |
| 3 | Popover auto-flip | picker | Already portalled; direction math only |
| 4 | Assign bar rebuild | assign-bar, floor-page | 8 controls → 4, 3 handlers deleted |
| 4b | Esc chip + disabled colour | assign-bar | Faded teal → grey |
| 4c | Clear relocation + gated Esc | assign-bar, floor-page | Checkbox check failed → moved not removed |
| 4d | Esc vs open popover | picker, floor-page | `data-slot-popover` marker |
| 5 | Panel header | detail-panel | Slot chip, teal per state |
| 5b | Ship-to label + honest highlight | detail-panel, picker | Behaviour change, see §6.1 |

The read-only audit at step 1 is what caught the confirm-button problem, the
invented menu items and the already-live bolt — before any file was touched. The
header-checkbox check at 4c stopped a change that would have left operators with no
way to clear a multi-group selection. Both were cheap; both prevented rework.
