# Next Session — Variant Grid Layout Fix (no-scroll qty entry)

Session type: planning + design (light implementation allowed if a clear path emerges)
Estimated duration: one session
Outcome: locked design for a scroll-free variant grid + Claude Code prompts queued for execution.

## CONTEXT TO LOAD AT START

1. Read all five canonical files: `CLAUDE.md`, `CLAUDE_CORE.md`, `CLAUDE_UI.md`, `CLAUDE_MAIL_ORDERS.md`, `CLAUDE_TINT.md`. Confirm schema version, parser version, UI version.

2. Read the v4 redesign ship draft for context on what was just built:
   - `docs/prompts/drafts/web-update-2026-05-12-place-order-v4-shipped.md`
   - `docs/mockups/place-order/desktop-order-redesign-v4.html`

3. Read the current variant grid implementation:
   - `app/(place-order)/place-order/components/variant-grid.tsx`
   - `app/(place-order)/place-order/components/variant-cell.tsx`
   - `app/(place-order)/place-order/components/sub-product-direct.tsx`
   - `app/(place-order)/place-order/components/family-nav-with-tabs.tsx`

4. Pull the live catalog state from Supabase. Specifically: for each (family, subProduct) pair in `mo_order_form_index_v2`, count base colours AND count packs. Identify which sub-products have the longest grids (most rows). Expected outlier: GLOSS sub-products with 38+ bases.

## THE PROBLEM

After v4 ships, operators report the variant grid is too tall for products with many base colours. When the operator opens a sub-product like GLOSS, they see:

- Sub-product header (~52px)
- Pack column header row (~32px)
- 38 base rows × ~44px each = ~1672px
- Hint footer (~32px)

Total: ~1800px of grid height. On a 1440×900 laptop screen with the top bar (52px) + page padding consumed, the visible viewport for the grid is roughly 500-600px. That means **operator can see only ~12-14 base rows at once.** The other 24+ rows are below the fold, accessible only by scrolling.

During phone-order entry, operator's eyes follow what the customer is saying. If customer asks for "Brilliant White" (row 1) and then "Signal Red" (row 28), the operator has to scroll to find Signal Red. Scrolling steals focus, breaks keyboard rhythm, and slows down the order.

## WHAT WE WANT

The variant grid should fit in the available vertical viewport without scrolling for the vast majority of sub-products. Operator's eyes stay in one visual region throughout qty entry. Keyboard nav (↓↑ arrows, PageDown/PageUp) still works the same way regardless of layout.

## DESIGN GOALS (priorities in order)

1. **No scroll needed for sub-products with up to ~30 base colours.** Even GLOSS at 38 bases should fit by reorganising the layout. Sub-products with ≤20 bases should fit comfortably on a 13-inch laptop screen.
2. **All bases visible at once** — operator's eyes scan the grid like a printed price list, no hidden rows.
3. **Pack columns still clearly aligned** — operator can see qty per pack at a glance.
4. **Keyboard nav semantics preserved** — ↓↑←→ still navigates between cells, PageDown/PageUp switches sub-product, Tab moves to next pack, etc.
5. **Cell click target still big enough for mouse use** — current 72×44px cells work; can compress moderately if needed (~64×36px is the floor for finger taps on hybrid devices, but this is desktop-only so even smaller is OK).
6. **Mailto byte-identical preserved** — layout changes do not affect email build. EmailLine strip stays unchanged.

## DESIGN EXPLORATIONS TO EVALUATE

The session should walk through these layout options, evaluate each against the goals, and pick a winner:

### Option A — Two-column base layout
Split the 38 bases into two columns side by side. Each column has 19 rows. Pack columns repeat per column.

```
| Base name          | 1L | 4L | 20L |  | Base name          | 1L | 4L | 20L |
| Brilliant White    |  · |  · |  ·  |  | Aquamarine         |  · |  · |  ·  |
| 90 Base            |  · |  · |  ·  |  | Middle Buff        |  · |  · |  ·  |
| 92 Base            |  · |  · |  ·  |  | Cherry             |  · |  · |  ·  |
| ...                |    |    |     |  | ...                |    |    |     |
```

Pros: visually familiar, all bases visible
Cons: more horizontal density, may push cart panel off-screen at 1280px viewport; pack columns duplicated takes more horizontal space

### Option B — Compact rows + reduced cell height
Cells shrink from 44px to ~28-32px tall. Smaller font. Tighter padding. 38 rows × 32px = 1216px — still over viewport but closer.

Pros: minimal layout disruption, just smaller
Cons: harder to tap with mouse / pointer; less visual breathing room; still requires scrolling for the longest grids

### Option C — Horizontal-scrolling base list with vertical packs
Flip the axis: bases become columns, packs become rows. With 4 packs × 38 bases, the grid is 4 rows tall (super short) but very wide — operator scrolls horizontally to find their base.

Pros: short vertical grid
Cons: horizontal scrolling on phone-order is worse than vertical; operator loses the "column of qty entries" mental model

### Option D — Virtualised grid with sticky-headers
The grid is conceptually long but only renders visible rows. Sticky pack-column header + sticky base-name column. Operator scrolls inside the grid panel, not the whole page.

Pros: scales to any number of bases; familiar pattern from spreadsheets
Cons: still requires scrolling; complex implementation; keyboard ↓↑ nav needs careful focus-scroll-into-view handling

### Option E — Categorised/grouped layout
Group base colours by hue (Whites, Greys, Reds, Blues, etc.). Each group is a collapsible section. Common bases (top 5-10 by order frequency for this sub-product) shown above the groups, always expanded.

```
COMMON BASES
  Brilliant White    | · | · | · |
  Black              | · | · | · |
  Signal Red         | · | · | · |
  ...top 5...
  
▾ WHITES (8 bases)
  Off White          | · | · | · |
  Classic White      | · | · | · |
  ...
▸ REDS (5 bases) — collapsed
▸ BLUES (7 bases) — collapsed
▾ NEUTRALS (12 bases)
  ...
```

Pros: addresses the real problem (operator doesn't need ALL 38 bases visible at once — only the 5-8 they actually order frequently)
Cons: groups need a colour-categorisation data model that doesn't exist today; collapse state adds keyboard complexity

### Option F — Two-pane grid (split inside the variant grid)
The grid splits into a "favorites" top section (top 5-10 bases by recent use across all customers OR for this customer) and a "rest" lower section. Favorites always visible, rest scrolls.

Pros: matches operator usage patterns (Pareto — top 5 bases cover most orders)
Cons: needs "popular bases" data; "rest" still scrolls (just less of it)

### Option G — Search-within-grid
Add a small filter input at the top of the variant grid: "Filter bases..." Operator types "red" → only Red, Signal Red, Cherry, etc. show. Combined with keyboard nav.

Pros: leverages search muscle memory operators already have from the main search bar
Cons: adds a UI element; operator needs to learn another input; doubles up with the global search to some degree

### Option H — Two-column with intelligent sort
Two columns (Option A) but sorted so popular bases are at the TOP of column 1 (eye-tracking starts top-left), less-common at the bottom of column 2. Combine A + F.

This is probably the strongest synthesis option.

## SESSION GOALS

This session is design + analysis. **No final implementation in this session** unless a clear winner emerges and is small (under 100 lines).

### Goal 1 — Data analysis
Pull base-colour counts per (family, subProduct). Identify:
- How many sub-products have >20 bases? >30? >40?
- What's the distribution? (most sub-products may have ≤10 bases; a few outliers dominate)
- Are there sub-products with 50+ bases that even two-column won't fit?
- For each outlier (GLOSS, STAINER, etc.), how many bases account for 80% of order volume? (Pareto check — would "popular bases on top" actually help?)

### Goal 2 — Mockups for each viable option
Build HTML mockups (in `docs/mockups/place-order/`) for the top 3 candidate options. Use real data — GLOSS with 38 bases is the stress test.

### Goal 3 — Decision: pick a winner
Walk through each mockup. Compare against the 6 design goals. Smart Flow makes the final call.

### Goal 4 — Detailed component spec
For the chosen option, document:
- Updated `VariantGrid` component structure (how the JSX changes)
- Updated keyboard nav handlers (how ↓↑←→ map across the new layout)
- Updated focus-hint logic (when search lands on "Signal Red", which cell focuses?)
- Updated `cellRefs` data structure (2D? 3D for grouped?)
- Updated visual specs (cell size, gaps, header styling)

### Goal 5 — Claude Code prompt drafted
A single Claude Code prompt that takes the spec and ships the change. Include:
- File list to read first (variant-grid, variant-cell, sub-product-direct, family-nav-with-tabs)
- Constraints (no email.ts changes, no pack.ts changes, mailto byte-identical, viewKey pattern preserved)
- Step-by-step implementation order
- Test checklist (no-scroll on common sub-products, keyboard nav still works, search-to-base focus still works)
- tsc + browser smoke checkpoints

## CONSTRAINTS

- Desktop-only — don't optimise for mobile here; `/order` (mobile) is a separate codebase, and the merge with `/order` is a future session.
- Cart panel stays 340px wide — variant grid must fit in the remaining left pane (~920px max-width content area).
- No new dependencies. Native CSS Grid / Flexbox only.
- Tailwind utility classes only — no inline `<style>` blocks beyond what already exists.
- Visual style stays consistent with v4 mockup (teal accents, gray-200 borders, etc.).
- Keyboard model from v4 is locked — any layout change must work within the existing PageDown/PageUp / Tab / ↓↑←→ / 0-9 / Esc rules.

## OUT OF SCOPE

- Mobile layout (separate codebase, separate session).
- Cart panel changes.
- Search behaviour changes.
- Taxonomy / data model changes (separate planning session).
- Speed dial changes.
- Add/edit/delete bases or packs — read-only catalog assumption.

## OPENING MESSAGE TO PASTE INTO NEW SESSION

```
New planning session — variant grid layout fix.

Problem: variant grid is too tall for sub-products with many base colours (GLOSS has 38 bases). Operator has to scroll to find / enter qty for bases below the fold. Scrolling breaks keyboard rhythm during phone orders.

Goal: redesign the variant grid layout so qty entry doesn't require scrolling for the vast majority of sub-products. All bases visible at once. Keyboard nav semantics preserved.

Before we start:
- Read all 5 canonical files (CLAUDE.md, CLAUDE_CORE.md, CLAUDE_UI.md, CLAUDE_MAIL_ORDERS.md, CLAUDE_TINT.md)
- Read the v4 ship draft: docs/prompts/drafts/web-update-2026-05-12-place-order-v4-shipped.md
- Read the v4 mockup: docs/mockups/place-order/desktop-order-redesign-v4.html
- Read the current grid implementation: app/(place-order)/place-order/components/variant-grid.tsx and variant-cell.tsx

Then I'll pull the live base-count distribution from Supabase. We walk through 7-8 layout options (two-column, compact rows, grouped, search-within-grid, etc.), build HTML mockups for the top 3, pick a winner, and draft the Claude Code implementation prompt.

Constraints: desktop-only (mobile is a separate codebase), cart panel stays 340px, no new dependencies, Tailwind utilities only, keyboard model from v4 is locked.

Start by confirming files read + versions, then propose the data-pull query.
```
