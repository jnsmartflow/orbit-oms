# code-update-2026-07-09-support-table-rework.md

Session output — Support board + Hold tab table rework.
Two commits to `main`. Frontend only. **No API, schema, or SQL change.**

Destination on consolidation: `CLAUDE_SUPPORT.md` (§4.9, §4.19, §6, §7) and
`CLAUDE_UI.md` (§27, §58).

---

## 1. Main Support board — column sequence

Now **11 columns + checkbox** (was 12 + checkbox).

| # | Column | Header label | Note |
|---|---|---|---|
| 1 | checkbox | — | |
| 2 | OBD | `OBD` | shortened from "OBD / DATE" |
| 3 | CUSTOMER | `CUSTOMER` | |
| 4 | SHIP-TO | `SHIP-TO` | shortened from "SHIP-TO OVERRIDE" |
| 5 | AGE | `AGE` | **moved up** from position 9 |
| 6 | ROUTE | `ROUTE` | shortened from "ROUTE / TYPE"; stays merged, not split |
| 7 | VOL | `VOL` | shortened from "VOL (L)"; **materialType now a muted sub-line inside this cell** |
| 8 | ARTICLE | `ARTICLE` | |
| 9 | STATUS | `STATUS` | |
| 10 | SLOT | `SLOT` | shortened from "DISPATCH SLOT" |
| 11 | PRIORITY | `PRIORITY` | |

MATERIAL TYPE is no longer its own column. Nothing was removed from the board.
Header labels are **display strings only** — no variable, field, or data key
was renamed.

### Corrections to existing canon

- **`CLAUDE_SUPPORT.md` §4.19 is stale.** It documents 11 columns and omits
  AGE. The real pre-session board was 12 columns *including* AGE. Fix.
- **`CLAUDE_SUPPORT.md` §6 is wrong.** It states *"Priority is NOT a Support
  concern — Planning owns it."* Smart Flow confirmed Priority **is** used at
  Support and stays on the board. Delete or correct that line.
- **MATERIAL TYPE is operationally important**, not decoration. It distinguishes
  paint from gift items. Gift items **do** carry a volume (typically 500 or
  1000), but that volume is **excluded from load calculation**. The Vol cell
  stacks volume over material type so the two can never be read apart.

### Vol cell rule

Renders `orders.materialType` **raw**, whatever the value. No mapping, no
matching, no per-value styling, no hardcoded list of "what counts as paint."
`null` renders `—`. A new material type appearing tomorrow just shows up.

---

## 2. Column sizing — the expensive lesson

Four schemes were tried. Three failed. Record why, or they will be tried again.

**Structural fact:** the Support tables are CSS Grid, and **the header and every
body row are separate, independent grid instances**, each applying the same
shared constant via `style={GRID}`. There is no shared column model between them.
`<table>` gives that for free; Grid does not.

| Scheme | Result | Why |
|---|---|---|
| `fr` everywhere | **Failed** | `fr` distributes *leftover* space. Leftover depends on content. Surplus pooled into one column as a dead channel; a long customer name widened that row's tracks and shifted every column right, **in that row only**. |
| `minmax(0, Nfr)` | Partial | Wrapping tracks in `minmax(0,…)` + `min-w-0` + `truncate` stops long text inflating a track, fixing drift. Does **not** fix pooled surplus — the gap just moves. |
| `max-content` | **Failed hard** | Sizes each track to *its own instance's* content. Two rows with different Slot content (`"pick slot"` vs a filled `9 Jul · 12:30` pill) landed that column **66.6px apart**. Priority drifted 30.2px. Structurally impossible with per-row grids. |
| Fixed `px` | Worked, ugly | Content-blind, so alignment held. But values were guessed, and capping Customer at `28rem` left a large dead channel; at 1920px Customer ballooned to 1034px. |
| **Percentages** | **Correct** | Content-blind *and* self-balancing. |

### Why percentages are the answer

Percentage grid tracks resolve against **the container's width**, never against
cell content. The header wrapper and every row wrapper already render at the
same container width (same `px-5` page wrapper). So percentage tracks resolve to
**identical pixel widths across every independent grid instance**.

This is the same mechanism the **Tint Manager** table gets natively. TM is a real
`<table>` with `table-layout: fixed` and `<colgroup>` percentage widths
(`4/13/10/18/7/9/6/15/10/8%`, per `CLAUDE_UI.md` §27/§33); the browser's table
algorithm synchronises columns across header and body for free.

Support cannot have that guarantee without the `<table>` rewrite already
rejected as scope creep (`CLAUDE_SUPPORT.md` §7) — **but it does not need it.**
Percentages give the same content-blindness on Grid.

### Locked GRID strings

Both live in `components/support/shared/table-cells.tsx` so they cannot drift.

```
SUPPORT_GRID_COLUMNS       "3% 9% 19% 11% 5% 9% 5% 9% 9% 13% 8%"     (main board)
SUPPORT_HOLD_GRID_COLUMNS  "3% 9% 20% 11% 6% 9% 5% 9% 13% 7% 8%"     (hold tab)
```

Both sum to **100**.

**Rules:**
- Each GRID is ONE shared constant. Header and body both read it. Change once.
- Any future column change must keep the percentages summing to 100.
- Do **not** reintroduce `fr`, `max-content`, or `auto` on these tables.
- Inter-column spacing comes from **per-cell padding** (`CLAUDE_UI.md` §27,
  14px L/R), not from the grid `gap`. Gap is `0`.

### Alignment rules (final)

**Main board:**
- checkbox — centre
- AGE — centre (it is a pill; pills centre)
- VOL — right, *both* stacked lines and the header label
- everything else — left

**Hold:**
- checkbox — centre
- HOLD SINCE — centre (pill)
- VOL — right, both lines + header
- ACTION — right (trailing buttons anchor to the row's trailing edge)
- everything else — left

**Why VOL is right-aligned** and TM's Volume is not: Support's Vol is a bare
number compared *across rows* for load planning, so digits must stack by place
value (6 / 128 / 500 / 3000). TM's volumes are `"60 L"`-style strings — a
different job.

---

## 3. Article pack abbreviation

`articleTag` (from `import_obd_query_summary`, via `orders.querySnapshot`) is a
comma-separated list of `"{integer} {word}"` groups. Abbreviated at **render
time only**. Stored data and the import pipeline untouched.

### Discovery result (live DB, 1,553 non-null rows)

| Word | Count |
|---|---|
| Drum | 991 |
| Carton | 743 |
| Tin | 368 |
| **Bag** | **34** |

**Smart Flow's assumption of three pack words was wrong — Bag exists.** A
hardcoded three-word map would have rendered blank on 34 live rows, silently.
This is the case for read-only discovery before any hardcoded mapping.

Max **4 groups** on one row. Longest stored value:
`"23 Drum, 20 Bag, 5 Carton, 8 Tin"` (32 chars). No case variants. Every group
parses cleanly as integer + space + word.

### The map

`Drum → D` · `Carton → C` · `Tin → T` · `Bag → B`

- **Join:** `" · "` (space, middot, space) — matches the Slot separator.
- **Order:** preserved from the stored string. Never sorted.
- **Tooltip:** `title` carries the **full original** string.

### Fallbacks — non-negotiable, all three must hold

1. A word **not** in the map renders its **full original word**. Never blank,
   never a guessed letter.
2. A group not matching `/^(\d+)\s+(\S.*)$/` → the helper returns the **raw
   stored string verbatim** rather than partially formatting a broken value.
3. `articleTag === null` → `"—"` (pre-existing, unchanged).

Helper `formatArticleTag` lives in the shared module. Pure, total, no throws.

Side-effect: single-letter abbreviation shrank the 4-group worst case
(`"23 D · 20 B · 5 C · 8 T"`) enough that it fits without ellipsis at wide
viewports and ellipsises cleanly at 1280–1440px without overflowing the row.

---

## 4. Hold tab — rebuilt

### Sibling, not reuse — and why

Hold is now its own component, `components/support/support-hold-table.tsx`,
extracted from `support-page-content.tsx` (it was inline JSX, ~lines 607-832).
It was **deliberately NOT merged** into `support-orders-table.tsx`.

**The deciding argument:** the dispatch-slot picker has a genuinely different
contract on each board.

- **Main board:** picking a slot **commits immediately** (`onSingleDispatch`).
- **Hold:** picking a slot **stages** into a local `holdSlots` Map; the write
  happens only on an explicit **Release** click.

Sharing one component around two contracts is how a held order gets silently
auto-dispatched the instant a slot is picked. That is a behavioural regression,
not a visual one.

Supporting evidence: forcing Hold through `OrderRow` would need **7 guard
branches**, including two full cell-content swaps (Status→Action, Age→Hold Since)
and a different `onChange` contract on the Slot cell — layered onto a component
already carrying five pieces of main-board-only state (`dispatchIntentIds`,
tint-stage locking, done-group collapse + `footprintType`, `bulkStatus`
threading, undo-dispatch/undo-cancel).

### Hold columns (11 + checkbox)

`OBD · CUSTOMER · SHIP-TO · HOLD SINCE · ROUTE · VOL · ARTICLE · SLOT ·
PRIORITY · ACTION`

Swaps versus the main board, and the reasoning:

- **STATUS dropped.** Every Hold row's status is `hold`. A column where every
  cell is identical carries zero information.
- **AGE → HOLD SINCE.** `AGE` counts from arrival; `HOLD SINCE` counts from
  `heldAt`. On this board the release decision is driven by time-since-held.
  Showing both invites reading the wrong one.
- **ACTION moved to last.** Actions belong at the row's trailing edge, after
  the data that informs them.
- **SHIP-TO, VOL, ARTICLE, PRIORITY added.** When releasing, the operator is
  committing a dispatch slot; these are the inputs that shape it. An order can
  also sit on hold for days while its delivery point changes.

Nine of eleven columns now sit in the same position with the same meaning as the
main board. Muscle memory is preserved.

### Behaviour change — call this out to the team

**Hold's VOL column now reads `orders.importVolume` (LITRES).** It previously
read `querySnapshot.totalUnitQty` (a unit **COUNT**). These are different
metrics. The number on screen has changed meaning for anyone used to the old
column. This was a correction, not a restyle.

### Other Hold changes

- **`Overdue Nd` badge removed** from Hold's OBD cell — it duplicated
  `HOLD SINCE` with a slightly different number. The main board **keeps** its
  badge (that board has no Hold Since column).
- **Group by SMU / Route added**, mirroring the main board.
- **Bulk bar offset fixed:** `left-14` → `left-[72px]`. The sidebar is 72px, so
  the bar was tucking 16px underneath it. The main board's bar already used
  `left-[72px]` (§4.13). This was a real bug, not cosmetic.
- **`heldAt` null fallback added:** `null → "—"`, grey pill. Necessary because
  `heldAt` is nullable on legacy rows (the Sree Milap landmine, §7), unlike the
  `updatedAt` the old column read.
- **Customer badges suppressed on Hold** (`showBadges={false}`) — Hold has no
  wired Missing-resolution dialog to back a click. `onMissing` is a real no-op.

### Held tint orders — Smart Flow's decision

**"Hold means hold."** A held tint order renders as an **ordinary held row**: no
purple pill, no locked cells, no `getRowType()` call anywhere in the Hold table.
Release works on it normally.

Rationale: §4.9 already forbids holding a mid-mix order (`tint_assigned`,
`tinting_in_progress` are rejected with 409). So anything sitting on Hold is
either pre-mix or post-mix, and safe to release.

### No backend work was needed

`ORDER_INCLUDE` in `app/api/support/orders/route.ts` is **one shared const** used
by the single `findMany` regardless of section. `section === "hold"` only narrows
the `where` clause. Every field the new layout needs — `materialType`,
`querySnapshot.articleTag`, `shipToOverrideCustomer`, `priorityLevel`, `heldAt`,
`dispatchTargetDate`, `dispatchWindowId`, `customer.area`, `route` — was already
in the hold arm's payload.

**Double-edged:** because `ORDER_INCLUDE` is shared with no section-specific
carve-out, any future narrowing of it for a main-board reason would silently
change Hold's payload too.

---

## 5. Shared module

`components/support/shared/table-cells.tsx` — created this session.

Exports, imported by **both** boards so they cannot drift apart:

- `SUPPORT_GRID_COLUMNS` / `SUPPORT_HOLD_GRID_COLUMNS`
- `ARTICLE_WORD_ABBR` + `formatArticleTag`
- `getPriLabel`
- `VolCell` — stacked volume + raw materialType sub-line, both right-aligned
- `CustomerCell` — name + code + optional Missing/tinting badges (`showBadges` prop)
- `groupOrders`, `getSmuGroup`, `GroupBy`, `OrderGroup` — pure grouping helpers

**Deliberately NOT extracted:** the group-header bar JSX (chevron + checkbox +
name + count). It lives inside `GroupRows`, which computes its selectable-ids
list via an internal `getRowType()` call. Hoisting the ~15-line block would mean
refactoring heavily-tested main-board code. It is **duplicated** in the Hold
table instead, sitting on top of the shared `groupOrders` — so the *behaviour*
of "SMU" can never drift even though the markup is written twice.

`ShipToOverrideCell` and `DispatchSlotPicker` were already standalone. Both
boards import them directly. Neither was modified.

**Known parity quirk:** the group-header row is a plain flex row
(`flex items-center gap-2 py-2 px-1`), not a grid row, so its checkbox does not
land on the same x as a data row's checkbox (96px vs 106px at 1280–1440px).
This was copied verbatim from the main board's existing `GroupRows` header. It is
**exact parity with an intentional existing design**, not a Hold regression.
Changing it would mean changing both boards.

---

## 6. Landmines confirmed this session

- **`ship-to-override-cell.tsx` must never sit inside an `overflow-hidden`
  wrapper.** Its search-results dropdown is absolutely positioned and overflows
  the cell **on purpose**. `min-w-0` on the wrapper is fine; `truncate` is not.
  The "set" pill state truncates its own text internally (line 179).
- **The dispatch-slot picker popover is portal-rendered** to `document.body`
  (`createPortal` + `position:fixed` + `getBoundingClientRect`,
  `dispatch-slot-picker.tsx:304`, `updatePosition()` lines 102–118). It escapes
  the cell, so the Slot column's track width does not constrain it. Shrinking
  that column is safe.
- **`isResolved` is scoped to the ship-to / route context.** Do not reach for it
  inside the Vol cell.
- **Tailwind `truncate` is inert on an inline element.** A `<span>` sub-line
  needs `block` added alongside it.
- **OneDrive + Next.js:** a stale `.next` produces
  `Error: Cannot find module './NNNN.js'` and
  `missing required error components, refreshing...`. Fix: stop the dev server,
  `taskkill /F /IM node.exe`, `rmdir /s /q .next`, restart. Pause OneDrive sync
  if `rmdir` hits a permission error.
- **Stop the dev server before any git operation** in this repo, same lock reason.
- **Inherited, not fixed:** Hold's new SHIP-TO column writes through
  `app/api/support/orders/[id]/route.ts`, which rides an existing
  `prisma.$transaction` (CORE §3 violation, §7/§8). Pre-existing. A second UI
  surface now hits the same fragile route.

---

## 7. Open / parked

- **Gift-item volume is excluded from load calculation, but nothing downstream
  enforces this.** If `querySnapshot.totalVolume`, the header tiles, or the CSV
  export sum all volume regardless of `materialType`, that is a real number
  problem, not a display problem. Deliberately parked — *"we will streamline
  when we build."* Needs its own session.
- **`materialType` nulls are expected**, not a bug. Some orders carry no
  material type. The cell renders `"—"`. No investigation needed.
- **`lib/dispatch/dispatch-engine.ts`** was dirty in the working tree throughout
  this session (in-progress auto-assign work). Never staged. Still uncommitted.
- **Group-header checkbox x-offset** (§5 above) — matches the main board's
  existing design. Fixing it means changing both boards. Not urgent.
- **Ship-To at 11% and Status at 9%** hold small content. Cosmetically generous.
  Left alone — widths have been changed enough.

---

## 8. Docs to correct on consolidation

1. `CLAUDE_SUPPORT.md` §4.19 — column list is stale (11 cols, no AGE). Replace
   with the table in §1 above.
2. `CLAUDE_SUPPORT.md` §6 — delete or correct *"Priority is NOT a Support
   concern."*
3. `CLAUDE_SUPPORT.md` §7 — add the sizing lesson (§2 above) as a landmine. The
   `<table>` rewrite **stays rejected**; percentages make it unnecessary.
4. `CLAUDE_SUPPORT.md` — new subsection for the Hold tab rebuild (§4 above),
   including the sibling-vs-reuse reasoning and the
   `totalUnitQty → importVolume` correction.
5. `CLAUDE_UI.md` §58 — Support board visual spec needs the new column order,
   the stacked Vol cell, the shortened header labels, and both percentage GRIDs.
6. `CLAUDE_UI.md` §27 — note that **percentage grid tracks are the Grid-native
   equivalent** of `<table>` + `table-layout:fixed` + `<colgroup>` percentages,
   and are the correct choice for any per-row-grid table.
