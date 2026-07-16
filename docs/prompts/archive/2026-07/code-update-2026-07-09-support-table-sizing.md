# code-update-2026-07-09-support-table-sizing.md

Session output — Support table column rework.
Two commits to `main`. Frontend only, no API or schema change.
Destination on consolidation: `CLAUDE_SUPPORT.md` (§4.19, §6, §7) and `CLAUDE_UI.md` (§27 / §58).

---

## 1. Column sequence — changed

Support board is now **11 columns + checkbox** (was 12 + checkbox).

| # | Column | Note |
|---|---|---|
| 1 | checkbox | — |
| 2 | OBD | header shortened from "OBD / DATE" |
| 3 | CUSTOMER | — |
| 4 | SHIP-TO | header shortened from "SHIP-TO OVERRIDE" |
| 5 | AGE | **moved up** from position 9 |
| 6 | ROUTE | header shortened from "ROUTE / TYPE"; stays merged, not split |
| 7 | VOL | header shortened from "VOL (L)"; **materialType now renders as a muted sub-line inside this cell** |
| 8 | ARTICLE | — |
| 9 | STATUS | — |
| 10 | SLOT | header shortened from "DISPATCH SLOT" |
| 11 | PRIORITY | — |

MATERIAL TYPE is no longer its own column. Nothing was removed from the board;
nothing was renamed at the data level. Header labels are display strings only.

### Corrections to existing canon

- **`CLAUDE_SUPPORT.md` §4.19 is stale.** It documents 11 columns and omits AGE
  entirely. The real pre-session board was 12 columns including AGE. Fix on
  consolidation.
- **`CLAUDE_SUPPORT.md` §6 is wrong.** It states "Priority is NOT a Support
  concern — Planning owns it." Smart Flow confirmed Priority *is* used at
  Support and must stay on the board. Correct this line.
- **MATERIAL TYPE is operationally important**, not decoration. It distinguishes
  paint from gift items. Gift items *do* carry a volume (typically 500 or 1000),
  but that volume is **excluded from load calculation**. The Vol cell therefore
  stacks volume over material type so the two can never be read apart.
  Downstream load-calc handling of gift volume is **not yet streamlined** —
  parked deliberately, see §5 below.

---

## 2. Column sizing — the important lesson

Four sizing schemes were tried on the Support board this session. Three failed.
Record why, or they will be tried again.

**Structural fact:** the Support table is CSS Grid, and **the header and every
body row are separate, independent grid instances**, each applying the same
shared `GRID` constant via `style={GRID}`. There is no shared column model
between them.

| Scheme | Result | Why |
|---|---|---|
| `fr` everywhere | **Failed** | `fr` distributes *leftover* space. Leftover depends on content. Gaps pooled into one column; a long customer name widened that row's tracks and shifted every column right, in that row only. |
| `minmax(0, Nfr)` | Partial | Wrapping tracks in `minmax(0,…)` plus `min-w-0` + `truncate` stops long text inflating a track. Fixes drift. Does **not** fix pooled surplus — the gaps just move. |
| `max-content` | **Failed hard** | Sizes each track to its own instance's content. Two rows with different Dispatch Slot content ("pick slot" vs a filled `9 Jul · 12:30` pill) landed that column **66.6px apart**. Priority drifted 30.2px. Structurally impossible with per-row grids. |
| Fixed `px` | Worked, ugly | Content-blind, so alignment held. But the values were guessed, and capping Customer at `28rem` left a large dead channel. |
| **Percentages** | **Correct** | Content-blind *and* self-balancing. |

### Why percentages are the answer

Percentage grid tracks resolve against **the container's width**, never against
cell content. Support's header wrapper and every row wrapper already render at
the same container width (same `px-5` page wrapper). So percentage tracks
resolve to identical pixel widths across every independent grid instance.

This is the same mechanism the **Tint Manager** table gets natively — TM is a
real `<table>` with `table-layout: fixed` and `<colgroup>` percentage widths
(`4/13/10/18/7/9/6/15/10/8%`, per `CLAUDE_UI.md` §27/§33). The browser's table
algorithm synchronises columns across header and body for free. Support cannot
have that guarantee without the `<table>` rewrite already rejected as scope
creep (`CLAUDE_SUPPORT.md` §7) — **but it does not need it.** Percentages give
the same content-blindness on Grid.

### The locked GRID

```
"3% 9% 19% 11% 5% 9% 5% 9% 9% 13% 8%"
```

checkbox 3 · OBD 9 · Customer 19 · Ship-To 11 · Age 5 · Route 9 · Vol 5 ·
Article 9 · Status 9 · Slot 13 · Priority 8 — **sums to 100**.

Verified by headless measurement at 1280 / 1366 / 1440 / 1920px: header, a
sparse row, and a fully-populated row land every column on an **identical
x-position to the sub-pixel**. No overflow at any viewport.

**Rules:**
- `GRID` is ONE shared constant. Header and body both read it. Change it once.
- Any future column change must keep the percentages summing to 100.
- Do **not** reintroduce `fr`, `max-content`, or `auto` on this table.
- Inter-column spacing comes from **per-cell padding** (`CLAUDE_UI.md` §27
  standard, 14px L/R), not from the grid `gap`. Gap is `0`.

### Alignment rule (final)

- **Checkbox:** centre
- **AGE:** centre (it is a pill; pills centre)
- **VOL:** right — *both* stacked lines and the header label. Digits must stack
  by place value (6 / 128 / 500 / 3000) because this is a load-planning screen.
  This deliberately differs from Tint Manager, which left-aligns Volume — TM's
  volumes are `"60 L"`-style strings, not bare numbers compared across rows.
- **Everything else:** left

---

## 3. Article pack abbreviation

`articleTag` (from `import_obd_query_summary`, via `orders.querySnapshot`) is a
comma-separated list of `"{integer} {word}"` groups. It is abbreviated at
**render time only**. Stored data and the import pipeline are untouched.

**Discovery result (live DB, 1,553 non-null rows):**

| Word | Count |
|---|---|
| Drum | 991 |
| Carton | 743 |
| Tin | 368 |
| **Bag** | **34** |

Smart Flow's assumption of three pack words was wrong — **Bag exists.** A
hardcoded three-word map would have rendered blank on 34 live rows, silently.
Max 4 groups on one row. Longest stored value:
`"23 Drum, 20 Bag, 5 Carton, 8 Tin"` (32 chars). No case variants. Every group
parses cleanly as integer + space + word.

**Map:** `Drum → D` · `Carton → C` · `Tin → T` · `Bag → B`
**Join:** `" · "` (space, middot, space) — matches the Dispatch Slot separator.
**Order:** preserved from the stored string. Never sorted.

**Fallbacks — non-negotiable, all three must hold:**
1. A word **not** in the map renders its **full original word**. Never blank,
   never a guessed letter.
2. A group not matching `/^(\d+)\s+(\S.*)$/` → the helper returns the **raw
   stored string verbatim** rather than partially formatting a broken value.
3. `articleTag === null` → `"—"` (pre-existing behaviour, unchanged).

The `title` tooltip on the cell carries the **full original** string.

Helper: `formatArticleTag` in `support-orders-table.tsx`. Pure, total, no throws.

Side-effect worth noting: single-letter abbreviation shrank the 4-group worst
case (`"23 D · 20 B · 5 C · 8 T"`) enough that it fits without ellipsis at wide
viewports and ellipsises cleanly at 1280–1440px without overflowing the row.

---

## 4. Landmines confirmed this session

- **`ship-to-override-cell.tsx` must never sit inside an `overflow-hidden`
  wrapper.** Its search-results dropdown is absolutely positioned and overflows
  the cell on purpose. `min-w-0` on the wrapper is fine; `truncate` is not.
  The "set" pill state truncates its own text internally
  (`ship-to-override-cell.tsx:179`).
- **The dispatch-slot picker popover is portal-rendered** to `document.body`
  (`createPortal` + `position:fixed` + `getBoundingClientRect`,
  `dispatch-slot-picker.tsx:304`, `updatePosition()` lines 102–118). It escapes
  the cell, so the Slot column's track width does not constrain it. Confirmed —
  shrinking that column is safe.
- **`isResolved` is scoped to the ship-to / route context.** Do not reach for it
  inside the Vol cell.
- **Tailwind `truncate` is inert on an inline element.** A `<span>` sub-line
  needs `block` added alongside it.
- **OneDrive + Next.js:** a stale `.next` produces
  `Error: Cannot find module './NNNN.js'` and
  `missing required error components, refreshing...`. Fix: stop the dev server,
  `taskkill /F /IM node.exe`, `rmdir /s /q .next`, restart. Pause OneDrive sync
  if `rmdir` hits a permission error.
- **Stop the dev server before any git operation** in this repo, for the same
  lock reason.

---

## 5. Open / parked

- **Gift-item volume is excluded from load calculation, but nothing downstream
  enforces this yet.** If `querySnapshot.totalVolume` or the header/export
  totals sum all volume regardless of `materialType`, that is a real number
  problem, not a display problem. Deliberately parked — "we will streamline when
  we build." Needs its own session.
- **`materialType` nulls are expected**, not a bug. Some orders genuinely carry
  no material type. The cell renders `"—"`. No investigation needed.
- **`lib/dispatch/dispatch-engine.ts`** was dirty in the working tree throughout
  this session (in-progress auto-assign work). Never staged. Still uncommitted.
- **Ship-To column at 11%** holds only a faint "Set ship-to" placeholder on most
  rows. Cosmetically generous. Left alone — widths have been changed enough.
- **Status column at 9%** holds a small pill. Same note.

---

## 6. Docs to correct on consolidation

1. `CLAUDE_SUPPORT.md` §4.19 — column list is stale (11 cols, no AGE). Replace
   with the 11-column table in §1 above.
2. `CLAUDE_SUPPORT.md` §6 — delete or correct "Priority is NOT a Support
   concern."
3. `CLAUDE_SUPPORT.md` §7 — add the sizing lesson from §2 above as a landmine.
   The `<table>` rewrite stays rejected; percentages make it unnecessary.
4. `CLAUDE_UI.md` §58 — Support board visual spec needs the new column order,
   the stacked Vol cell, the shortened header labels, and the percentage GRID.
5. `CLAUDE_UI.md` §27 — note that percentage tracks are the Grid-native
   equivalent of `<table>` + `table-layout:fixed` + `<colgroup>` percentages,
   and are the correct choice for any per-row-grid table.
