# web-update-2026-05-13-place-order-grid-visibility-and-scroll

**Date:** 2026-05-13
**Type:** UI fix (visibility + scroll behaviour)
**Module:** Place Order (`/place-order`)
**Branch:** main (5 commits, pushed to production)
**Risk level:** Low — visual + layout only, no logic / state / API changes

---

## What shipped

Two UX problems on `/place-order` (depot operator phone-order entry surface):

1. **Catalog grid was too faded** — operators couldn't see cell boundaries, couldn't tell which row/column they were on, couldn't distinguish empty cells from NA cells.
2. **Page was scroll-locked** — `<main>` fixed at `h-[calc(100vh-52px)]` + `overflow-hidden` on the catalog section meant any content below the fold (Recently Used, Last Order, Browse All Families) was clipped and unreachable on shorter viewports.

Both fixed across 5 commits, all on main.

---

## Final visual outcome

### Cells (variant-cell.tsx)

| State | Background | Border | Mark |
|---|---|---|---|
| NA (—) | transparent | dashed gray-200 | em-dash gray-300 |
| Empty entry | gray-200 (#e5e7eb) | solid gray-300 | "·" dot gray-600 |
| Empty hover | gray-300 (#d1d5db) | solid gray-300 | "·" dot gray-600 |
| Filled (qty > 0) | teal-50 | solid gray-300 | bold teal-700 number |
| Focused | (overrides) | amber-500 + halo | (whatever above) |

NA cells **recede** (dashed, transparent), entry cells **advance** (solid border, darker fill). Clear semantic separation.

### Rows (variant-grid.tsx)

| State | Behaviour |
|---|---|
| Default | white bg, base name gray-900 semibold |
| Mouse hover | row tints `bg-amber-50/30` (faint amber preview) |
| Cell focus-within | row tints `bg-amber-50/70` + 3px amber-500 left bar on base column + base label goes **bold** |
| Row divider | `border-gray-200` (was invisible `border-gray-50`) |
| Header | `bg-gray-100` + `border-b-2 border-gray-300` (was gray-50 + 1px gray-200) |
| Row stride | ~40px (was ~34px) |

CSS-only — `:focus-within` does row highlight, no extra state.

### Scroll behaviour

- `<main>` switched from `h-[calc(100vh-52px)]` to `min-h-[calc(100vh-52px)]` — page grows past one screen when content overflows
- Removed `overflow-hidden` from the left `<section>`
- CartPanel's `<aside>` made sticky: `sticky top-[52px] h-[calc(100vh-52px)]` — pinned at the right edge while main column scrolls
- Cart's internal `overflow-y-auto` preserved — long carts still scroll independently

---

## Commit log

| Commit | Description | Files |
|---|---|---|
| `86284760` | Phase 1 — scroll lock removed, cart sticky | `place-order-page.tsx`, `cart-panel.tsx` |
| `87935cf2` | Phase 2 — cell visibility (Option 3) | `variant-cell.tsx` |
| `84ebd4b4` | Phase 2 hotfix — widen NA vs entry contrast | `variant-cell.tsx` |
| `d77f1efb` | Phase 3 — row focus highlight + header | `variant-grid.tsx` |
| `31830fa7` | Phase 3 hotfix — hover to faint amber | `variant-grid.tsx` |

All on main, all pushed, Vercel auto-deployed to orbitoms.in.

---

## Design decisions made this session

1. **Option B (row highlight) + Option 3 (cell visibility)** — chose both rather than one. Row highlight alone didn't fix the "what is this cell" problem; cell visibility alone didn't fix the "where am I in the row" problem.
2. **Amber, not yellow** — UI v5.1 §44 (Review View active line) uses yellow-50 + yellow-500. Place Order went with amber per Mail Orders Focus view reference. Both are warm "this is the active row" colors; amber felt slightly softer for the entry-grid context where amber is also used as the focus halo on the cell itself.
3. **NA cells dashed + transparent (Option C)** — initial Phase 2 had NA at `bg-gray-50` and entry at `bg-gray-100`. One shade apart was too subtle. Hotfix widened to: NA dashed/transparent (recedes), entry gray-200 + solid border (advances).
4. **Hover = preview of focus** — initial Phase 3 had `hover:bg-gray-50` which was lighter than the gray-200 cell bgs inside the row, so the hover disappeared. Hotfix switched to `hover:bg-amber-50/30` — same amber hue as focus at half opacity. Reads as "you could land here" vs focus "you are here."
5. **CSS-only row highlight** — `group/row` named-group + `group-focus-within/row:` rather than tracking focused row in React state. Zero extra logic, no re-render churn.
6. **Cart panel made sticky preemptively in Phase 1** — without this, removing `overflow-hidden` would have let the cart stretch with the growing page (flex parent + default `align-items: stretch`). Sticky pins it at viewport-top:52px so it stays visible during scroll.

---

## What to merge into CLAUDE_UI.md at next consolidation

Section to add (around §48 or as a new §51 for Place Order patterns):

```
## 51. Place Order — catalog grid pattern

Catalog grid (variant-grid.tsx) uses focus-within row highlight + bordered
cells. Pattern reused for any future cell-matrix data entry.

**Row states:**
- Default: white bg
- Hover: bg-amber-50/30 (faint preview)
- Focus-within: bg-amber-50/70 + 3px amber-500 left bar on first cell + bold first-column label
- Divider: border-b border-gray-200

**Cell states (variant-cell.tsx):**
- NA: bg-transparent + dashed border-gray-200 + em-dash gray-300
- Empty: bg-gray-200 + solid border-gray-300 + placeholder "·" gray-600
- Empty hover: bg-gray-300
- Filled (qty > 0): bg-teal-50 + solid border-gray-300 + bold teal-700 number
- Focused: amber-500 border + 3px amber halo (inset 1px #f59e0b + outer 3px rgba(245,158,11,0.18))

**Header row:**
- bg-gray-100 + border-b-2 border-gray-300
- Text gray-500 uppercase tracking-wider

**Hover preview ≠ focus locked** rule — same hue (amber), different
opacity. Applies anywhere a row/cell can be "previewed" then "selected."

**Sticky cart pattern (place-order-page.tsx):**
- Main wrapper: min-h-[calc(100vh-52px)] (NOT h-)
- Left section: no overflow-hidden — content drives height
- Right aside: sticky top-[52px] h-[calc(100vh-52px)] — pinned during scroll
- Cart's internal middle: overflow-y-auto for long line lists
```

Also update §35-38 (deprecated Focus Mode) to cross-reference §51 for the focus-within row pattern, which now has a Place Order example in addition to Review View (§44).

---

## Known follow-ups (not blocking)

- **Pagination footer styling** — currently `bg-teal-50/40 border-t border-teal-100` with teal-700 text. Sits adjacent to the new amber row highlights. Visually fine in isolation but introduces a second accent colour at the bottom of the grid. If future cleanup wants strict "one colour family per screen," recolour pagination footer to gray/amber. Not urgent.
- **Keyboard hint bar (non-paginated)** — `bg-gray-50/60` still on family-nav-with-tabs.tsx and sub-product-direct.tsx. Could be strengthened to `bg-gray-50` (full opacity) for consistency with the new visual weights. Skipped this session — original prompt scoped to grid only.
- **OneDrive + .next conflict** — EBUSY errors during `npm run dev` are a known infrastructure issue (CORE §15). Repo path is under OneDrive. Doesn't block dev but adds noise. Long-term fix: move repo out of OneDrive.
- **Row focus on touch devices** — `:focus-within` works on click/keyboard. Mobile redirect to `/order` handles tablets/phones so this isn't a concern for `/place-order`, but worth noting if mobile gets its own grid later.

---

## Tests run (all passed)

| Test | Result |
|---|---|
| Page scrolls when content overflows viewport | ✓ |
| Cart panel stays pinned at right edge during scroll | ✓ |
| Cart internal overflow still works for long line lists | not regression-tested this session — pattern preserved |
| Mouse hover row → faint amber tint | ✓ |
| Click into cell → strong amber row + bar + bold label | ✓ |
| NA cells visually distinct from entry cells | ✓ |
| Keyboard nav (1-9, arrows, +/-, Esc) unchanged | not regression-tested — code paths untouched |
| `npx tsc --noEmit` clean | ✓ (all 5 commits) |

---

## Files touched this session

- `app/(public)/order/place-order-page.tsx` — scroll lock removal
- `app/(public)/order/components/cart-panel.tsx` — sticky positioning
- `app/(public)/order/components/variant-cell.tsx` — cell visibility (Phase 2 + hotfix)
- `app/(public)/order/components/variant-grid.tsx` — row highlight (Phase 3 + hotfix)

Total: 4 files, 5 commits, 0 logic changes, 0 schema changes.

---

*Session by Smart Flow (developer) + Claude.ai (planning) + Claude Code (implementation). May 2026.*
