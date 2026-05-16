# Claude Code Prompt — /place-order v5: No-Scroll Variant Grid (Variant A locked)

**Target branch:** `main` (single commit + push, triggers Vercel auto-deploy)
**Model recommendation:** Opus 4.7 (multi-component change: variant grid + speed dial mode + keyboard + customer pill move)
**Estimated tokens:** ~120-180K with file reads
**Mockup source of truth:** `docs/mockups/place-order/desktop-variant-grid-no-scroll-variants.html` (Variant A frame — top frame of the file)

═══════════════════════════════════════════════════════════════════════════════
## CONTEXT — WHAT WE'RE BUILDING
═══════════════════════════════════════════════════════════════════════════════

Operators report the v4 `/place-order` variant grid is too tall — even for sub-products with 12-13 bases (MAX, STAINER), they have to scroll down to see all bases during phone-order entry. Scrolling breaks keyboard rhythm. GLOSS (38 bases) is the worst case.

**Design decision: no vertical page scroll, ever.** The page is fixed to the viewport height. All bases must be visible inside the grid card without scrolling the page or the card itself. For the 2 outlier sub-products (GLOSS at 38 bases, WS·PROTECT at 16 bases) that don't fit even at compact sizing, the grid paginates with discrete pages instead of scrolling.

This is **Variant A** from the design session. Variant B and pagination-only options were considered and rejected. The locked decisions are documented inline below.

═══════════════════════════════════════════════════════════════════════════════
## STEP 1 — READ FILES FIRST (DO NOT WRITE CODE YET)
═══════════════════════════════════════════════════════════════════════════════

Read these files in order and confirm you've read each one before proceeding. Report file lengths and any concerns:

**Canonical context (5 files):**
1. `CLAUDE.md` (router)
2. `docs/CLAUDE_CORE.md` (engineering rules — §3 violations are non-negotiable)
3. `docs/CLAUDE_UI.md` (visual system, teal rules)
4. `docs/CLAUDE_MAIL_ORDERS.md` (place-order spec, keyboard model)
5. `docs/CLAUDE_TINT.md` (skim only — for awareness)

**Design source of truth:**
6. `docs/mockups/place-order/desktop-variant-grid-no-scroll-variants.html` — **read the Variant A frame** (top frame). This is the visual spec. All sizing, spacing, font sizes, and chrome dimensions come from this file. The GLOSS pagination frame (bottom) is the spec for the pagination treatment.

**Current implementation (read all to understand the patch surface):**
7. `app/(place-order)/place-order/page.tsx` (the route page — orchestrates layout)
8. `app/(place-order)/place-order/components/variant-grid.tsx` (the table — main change target)
9. `app/(place-order)/place-order/components/variant-cell.tsx` (cell component)
10. `app/(place-order)/place-order/components/sub-product-direct.tsx` (renders one sub-product with its variant grid)
11. `app/(place-order)/place-order/components/family-nav-with-tabs.tsx` (family-level with sub-product tabs)
12. `app/(place-order)/place-order/components/speed-dial-grid.tsx` (the 9-tile grid)
13. `app/(place-order)/place-order/components/speed-dial-tile.tsx` (single tile)
14. `app/(place-order)/place-order/components/active-product-panel.tsx` (the dispatcher)
15. `app/(place-order)/place-order/components/big-search-bar.tsx` (search)
16. `app/(place-order)/place-order/components/recently-used.tsx` (skim — checking for vertical-space competition)
17. `app/(place-order)/place-order/components/top-bar.tsx` OR wherever the customer pill currently lives (find via grep for "PARAM HARDWARE" or the customer-display component)
18. `lib/place-order/use-keyboard-routing.ts` (keyboard router)

**Recent context to understand what shipped most recently:**
19. `docs/prompts/drafts/web-update-2026-05-12-place-order-v4-shipped.md` (v4 ship summary — has the keyboard model table)

After reading: confirm schema version (v26.5/26.6), parser version (v6.5), UI version (v5.1/5.2), and the file paths above all exist. Flag any missing files.

**DO NOT WRITE CODE OR MAKE EDITS YET. Just report back with file confirmations and any questions.**

═══════════════════════════════════════════════════════════════════════════════
## STEP 2 — ROOT CAUSE CHECK (BEFORE TOUCHING CODE)
═══════════════════════════════════════════════════════════════════════════════

Before changing anything, confirm the current behaviour by inspection:

1. In `variant-grid.tsx`, what's the current cell height? (Mockup expects to find ~44px / `qty-cell` matching v4 styles.)
2. In `page.tsx` or the layout component, is `overflow-y: auto` set on the main content area? Is the page scroll currently active? (Answer should be yes — that's the bug we're fixing.)
3. Where does the customer pill currently render? Is it in the top bar, or a separate row below it? Confirm by reading the component.
4. Confirm the speed dial currently always renders as full tiles regardless of whether a sub-product is active. (Should be yes — that's what we're changing.)
5. Confirm `PageDown` / `PageUp` are currently bound to "next/prev sub-product" in `use-keyboard-routing.ts` or wherever cell-key-handling lives.

Report findings as a numbered list. Then proceed to Step 3.

═══════════════════════════════════════════════════════════════════════════════
## STEP 3 — IMPLEMENTATION ORDER (locked sequence, follow strictly)
═══════════════════════════════════════════════════════════════════════════════

Build in this order. Run `npx tsc --noEmit` after each phase. Do not skip ahead.

### Phase 3.1 — Customer pill moves into the top bar

**Goal:** Recover ~48px of vertical space by putting the locked customer chip inside the top bar instead of as a separate row.

- Find the customer pill component (likely a `<div>` showing customer name + customer code + dismiss `×`).
- Move its rendering into the top bar component, right after the "Place Order" title and before the right-side controls.
- Visual spec (from mockup Variant A header):
  - Background: `bg-teal-50`
  - Border: `border border-teal-200`
  - Padding: `px-2.5 py-1`
  - Border radius: `rounded-md`
  - Status dot (1.5px teal-600) + customer name (12px teal-800 medium) + customer code (10px mono teal-600) + dismiss × (teal-400 hover:teal-700, 14px leading-none)
  - Layout: `flex items-center gap-2`
- Remove the old separate customer-pill row from the page layout.
- Verify customer-lock state, auto-focus search behaviour, and Esc-to-unlock behaviour all still work — these existed in v4 and must not regress.

`npx tsc --noEmit` → must pass.

### Phase 3.2 — Speed dial gains a "collapsed" mode

**Goal:** When a sub-product is active (panel is open), the speed dial collapses to a 40px-tall pill strip. When no sub-product is active, the full 9-tile grid renders unchanged.

- In the parent component that renders `<SpeedDialGrid />` (likely `page.tsx` or an orchestrator), determine the "active sub-product" state. This already exists in v4 — it's what triggers the active panel render.
- Pass a `compact: boolean` prop to `<SpeedDialGrid />`. `compact = activeSubProduct != null`.
- In `speed-dial-grid.tsx`: if `compact` is true, render a horizontal flex row of 9 `<SpeedPill />` components. If false, render the existing 9-tile grid.
- **Do NOT delete or modify the existing full-tile render path.** It must continue to work for the no-active-sub-product case.
- Add a new component `<SpeedPill />` (can live in `speed-dial-grid.tsx` as a co-located component, or in a new `speed-dial-pill.tsx` file — your call). Visual spec from mockup Variant A:
  - Container: `inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-gray-200`
  - Active state: `border-teal-500 bg-teal-50 text-teal-700 font-semibold`
  - Hover: `border-teal-400 text-teal-700`
  - Font: 11.5px, weight 500 (or 600 when active)
  - Number prefix: 10px mono, gray-400 (or teal-600 when active)
  - Active marker: a small `▸` (single character) at the end of the active pill, teal-600
- Wire the pill `onClick` to the same handler that the full tile uses (open the sub-product).
- Layout: `flex items-center gap-1.5 flex-wrap` with a leading 10px gray-400 "Quick:" label.
- The collapsed strip total height should be ≤40px including the surrounding wrapper.

Click-to-expand / Esc-to-expand: when sub-product panel is closed (× button or Esc from page body), the speed dial returns to its full-tile mode automatically because `activeSubProduct` becomes null. No new state needed.

`npx tsc --noEmit` → must pass.

### Phase 3.3 — Variant grid: cell + chrome compression to Variant A specs

**Goal:** Compress the variant grid card so 13-15 bases fit without scroll.

Change the spec to match Variant A mockup exactly:

**Cell sizing (`qty-cell` styles):**
- Width: 56px (was 72px in v4)
- Height: 36px (was 44px in v4)
- Border radius: 5px (was 6px)
- Font size: 13.5px (was 15px)
- Font weight: 600 (unchanged)
- Other styles (empty / filled / focused) unchanged.

**Base name cell:**
- Padding: `px-4 py-1.5` (was `px-5 py-3`)
- Font: 12.5px / weight 600 (was 13px)
- Remove the SKU sub-text mono row (`5701XXX` shown in v4) — saves vertical space. (Confirm with grep: is this text actually rendered in current code, or is the v4 mockup more verbose than the actual implementation? If not rendered, no change needed.)
- Base name column width: 160px fixed (down from ~32% of card width)

**Pack column headers:**
- Combine title + "box of N" onto a tighter two-line stack but reduce padding: `px-1 py-2`
- Title: 11.5px / weight 600 (was 12px)
- Sub-line: 9px mono / gray-400 (was 9.5px)

**Card header:**
- Reduce vertical padding: `py-2.5` (was `py-3`)
- Title font: 14px (was 15px)
- Meta line: 10px (unchanged)
- Monogram: 28×28px (was 30×30px), 10.5px font

**Hint footer:**
- Reduce padding: `py-1.5` (was `py-2.5`)
- Font: 10px (was 10.5px)

**Card container:**
- Border radius: `rounded-xl` (unchanged)
- Border: `border border-gray-200` (unchanged)

Test by rendering MAX (12 bases) and STAINER (13 bases) — both must fit on a 1440×900 viewport with no scroll on the page or the card.

`npx tsc --noEmit` → must pass.

### Phase 3.4 — Page layout: lock to viewport height, no overflow

**Goal:** The page itself never scrolls vertically. Top bar + content area + cart all fit within `100vh`.

- In `page.tsx` (or the layout wrapper for `/place-order`), set the root container to `h-screen overflow-hidden`.
- The main content area becomes `h-[calc(100vh-52px)]` after the top bar. Inside it: `flex gap-6 overflow-hidden` for left content + right cart.
- The left content area gets `overflow-hidden` (NOT auto). The variant grid card sits inside without an inner scroll.
- The right cart panel keeps its own internal scroll (cart line list can grow). Cart container: `flex flex-col` with cart-line-list as `flex-1 overflow-y-auto`.
- Remove any existing `overflow-y: auto` from the left content scroll container.

Verify after this phase:
- Page does NOT scroll vertically on the body.
- Variant grid card does NOT have its own internal scroll.
- Cart panel CAN scroll internally if cart has many lines.

`npx tsc --noEmit` → must pass.

### Phase 3.5 — Pagination for >15-base sub-products

**Goal:** Sub-products with more bases than fit in the viewport paginate instead of scrolling. Today this affects GLOSS (38 bases, 3 pages) and WS·PROTECT (16 bases, 2 pages).

**Constants (introduce in `lib/place-order/constants.ts` or co-located in `variant-grid.tsx`):**

```ts
export const VARIANT_GRID_PAGE_SIZE = 13  // bases per page
export const VARIANT_GRID_PAGINATION_THRESHOLD = 15  // sub-products with >15 bases paginate
```

**State:** Add `currentPage: number` (default 0) to `variant-grid.tsx` local state, keyed by `viewKey` (the `${family}|${subProduct}` string from v4). When the viewKey changes, currentPage resets to 0. This avoids carrying GLOSS's page-2 state into a switch to SATIN.

**Sort:** Bases within the sub-product render in popularity order (most-ordered first). For the prompt scope: if `mo_order_form_index_v2` already has a `baseOrderRank` column, use it. If not, leave the existing sort untouched (alphabetical) — popularity ranking is a separate concern for a future migration. Hard-code GLOSS's top-13 manually if needed for visual demonstration, otherwise leave sort as-is and document it as a follow-up.

**Pagination header indicator** (renders in card header, right side, before the `×`):
- Visible only when `bases.length > VARIANT_GRID_PAGINATION_THRESHOLD`.
- Layout: `flex items-center gap-2 mr-3`
- Prev button: `<button>` with `‹` glyph, 16px, gray-400 hover:teal-600, disabled when on page 0
- Page dots: `flex items-center gap-1` containing N divs (one per page). Active dot: `w-[22px] h-[7px] bg-teal-600 rounded-[4px]`. Inactive dot: `w-[7px] h-[7px] bg-gray-300 rounded-full`. Smooth transitions.
- Next button: `<button>` with `›` glyph, gray-600 hover:teal-600, disabled when on last page
- Trailing text: `1 of 3` in 10px mono gray-400

**Pagination footer banner** (replaces the hint footer when paginated):
- Background: `bg-teal-50/40 border-t border-teal-100`
- Same hint shortcuts ((↓↑←→ nav, 0-9 qty)) plus the new `[` / `]` shortcuts (see Phase 3.6)
- Right-aligned label: `Showing bases X–Y of Z · Page N of M` in teal-700 weight 500

**Row rendering:**
- Take `bases.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)` and render those rows.
- All other render logic (cell focus, qty entry, cellRefs) operates on the visible slice — i.e. when switching pages, the cellRefs ref-array reset to the new visible rows.

### Phase 3.6 — Keyboard: pagination keys + reconciliation with existing model

**Goal:** Add page-flip keys that don't collide with the existing v4 keyboard model.

v4 keyboard model uses `PageDown / PageUp` for next/prev sub-product. We must NOT break that. Pagination needs different keys.

**Locked binding:** `[` (previous page) and `]` (next page). Both work when a variant cell is focused. Both no-op when the sub-product isn't paginated.

In the cell key handler (likely inside `variant-cell.tsx` or a shared hook):
- Add cases for `e.key === '['` and `e.key === ']'`
- Call a `onPageChange(direction: -1 | 1)` callback passed from the parent `variant-grid.tsx`
- `e.preventDefault()` and `e.stopPropagation()` to prevent the keypress falling through to the global router

In `variant-grid.tsx`:
- `onPageChange` clamps the new page to `[0, totalPages - 1]`
- After page change: focus first cell of the new page's first row (or preserve column index if possible). Use the existing focus-by-(row, col) pattern.
- If the sub-product isn't paginated, `onPageChange` is a no-op.

**Update the hint footer text** in non-paginated mode to NOT mention `[`/`]`. Only show them in the paginated mode's pagination banner.

**Update keyboard model table** in CLAUDE_MAIL_ORDERS.md (will be done in Phase 3.8 — context file update).

`npx tsc --noEmit` → must pass.

### Phase 3.7 — Search-to-base focus must respect pagination

**Goal:** When operator searches "GLOSS · Black" and Black is on page 2, the grid auto-flips to page 2 and focuses Black's row.

In `variant-grid.tsx`:
- The existing focusHint resolver receives `{ baseColour: string }` for `sub-product-base` search results.
- Before resolving the cell ref, compute which page the target base lives on: `targetPage = Math.floor(targetIndex / PAGE_SIZE)`.
- If `targetPage !== currentPage`, set `currentPage = targetPage`, then resolve focus on the next render (use the existing `prevFocusHintRef` guard pattern from v4 to avoid re-fire loops).

Test mentally: search GLOSS, click Black (rank 2 — page 1). Page stays 0, Black focuses. Search GLOSS, click Lavender (rank 32 — page 3). Page flips to 2, Lavender focuses.

`npx tsc --noEmit` → must pass.

### Phase 3.8 — Context file updates

Update these three canonical files (in `docs/` at repo root):

**`docs/CLAUDE_MAIL_ORDERS.md`:**
- Update the `/place-order` keyboard model table:
  - Add row: `[ / ]` → "Page prev / next (paginated sub-products only)"
- Add a brief section under the variant grid spec:
  > Variant grid pages at `VARIANT_GRID_PAGINATION_THRESHOLD = 15` bases; page size is `VARIANT_GRID_PAGE_SIZE = 13`. Page-flip keys are `[` and `]`. Today GLOSS (38 bases) and WS·PROTECT (16 bases) trigger pagination; all other 194 sub-products render single-page.
- Add a brief section noting the speed-dial collapsed mode:
  > When a sub-product is active, `<SpeedDialGrid />` renders in `compact: true` mode — a 40px pill strip instead of the full 9-tile grid. The full tile grid renders only when no sub-product panel is open.

**`docs/CLAUDE_UI.md`:**
- Bump version: v5.1 → v5.2.
- Add a "No-scroll grid" section under place-order specifics, documenting:
  - Page never scrolls vertically (`h-screen overflow-hidden` on root).
  - Variant grid card never scrolls internally.
  - Qty cell: 56×36px (was 72×44px in v4). Base name: 12.5px/600. Pack header: 11.5px/600 + 9px mono sub. Row stride ~40px.
  - Customer pill location moved into top bar.
  - Speed dial has two render modes: full (no active sub-product) and compact pill strip (sub-product active).
  - Pagination treatment: dots in card header, `[` / `]` keys, `Showing X–Y of Z · Page N of M` footer banner.

**`docs/CLAUDE_CORE.md`:**
- If the schema didn't change (no new column added in this work), no version bump. If you added a `baseOrderRank` column on `mo_order_form_index_v2`, bump v26.5 → v26.6 (a previous draft already proposed this bump for other reasons).
- Update §13 (or wherever place-order layout is referenced) with a one-liner: "Place-order page is fixed-height (`h-screen`); content does not page-scroll."

### Phase 3.9 — TypeScript check + browser smoke test

```
npx tsc --noEmit
```

Must pass with zero errors. If errors, fix in place — do NOT skip ahead.

Then check the dev server:

1. Open `/place-order` in browser at 1440×900 viewport.
2. Lock a customer. Verify customer pill renders in top bar.
3. Press `4` to open MAX (or whichever speed-dial slot it occupies). Verify:
   - Speed dial collapses to pill strip
   - All 12 MAX bases visible without page scroll or card scroll
   - First cell is focused (white background, teal outline)
4. Press `1` to open GLOSS. Verify:
   - 13 bases visible
   - Page dots show `● ○ ○` (page 1 of 3) in card header
   - Footer banner says "Showing bases 1–13 of 38 · Page 1 of 3"
5. Press `]` — verify page flips to 2, shows bases 14–26, dots show `○ ● ○`.
6. Press `]` again — page 3, bases 27–38.
7. Press `]` once more — no-op (clamped at last page).
8. Press `[` — back to page 2. Press `[` again — page 1.
9. Press `Esc` — sub-product panel closes, speed dial expands back to full tiles.
10. Type "lavender" in search bar, press Enter on the GLOSS·Lavender result. Verify page auto-flips to page 3 and Lavender row is focused.
11. Verify mailto email build still works end-to-end (send a test order). The `email.ts` and `pack.ts` files must be UNTOUCHED — git diff them after the commit to confirm zero-diff.

### Phase 3.10 — Commit and push

Single commit message:

```
feat(place-order): no-scroll variant grid + speed dial compact mode + pagination

- Variant grid cells compressed to 56×36px (was 72×44px) so 13-15 bases fit per
  viewport without scroll
- Speed dial collapses to a 40px pill strip when a sub-product is active; expands
  to the full 9-tile grid when no sub-product is open
- Customer pill moves into the top bar; recovers ~48px of vertical space
- Page locks to viewport height (`h-screen overflow-hidden`); no page or card
  vertical scroll under any sub-product
- Sub-products with >15 bases paginate at 13 per page with page dots in the card
  header and `[` / `]` keyboard shortcuts; today affects GLOSS (3 pages) and
  WS·PROTECT (2 pages); all other 194 sub-products render single-page
- Search-to-base focus auto-flips pagination to the target base's page
- Canonical files updated: CLAUDE_UI.md → v5.2, CLAUDE_MAIL_ORDERS.md keyboard
  model + place-order spec; CLAUDE_CORE.md layout note

Mockup source: docs/mockups/place-order/desktop-variant-grid-no-scroll-variants.html (Variant A frame)
Session plan: docs/prompts/drafts/web-update-2026-05-11-variant-grid-two-column-design.md
```

Push to `main`. Vercel auto-deploy will kick in.

═══════════════════════════════════════════════════════════════════════════════
## CONSTRAINTS (must not violate — see CLAUDE_CORE.md §3)
═══════════════════════════════════════════════════════════════════════════════

- **No `prisma.$transaction`.** Sequential awaits only. (Not expected to be needed in this change, but flagged.)
- **No `prisma db push`.** No schema changes in this prompt at all. Catalog table stays as-is.
- **All API routes** must have `export const dynamic = 'force-dynamic'`. (Not expected to add new routes, but flagged.)
- **DB columns are camelCase.** (Not expected to be a concern here.)
- **`email.ts` and `pack.ts` are ZERO-DIFF.** Mailto build must remain byte-identical to current behaviour. `EmailLine` strip on the page side must keep only subProduct/baseColour/packQtys — no additions. Verify with `git diff lib/place-order/email.ts lib/place-order/pack.ts` before committing.
- **No new npm dependencies.** Tailwind utility classes only. Native CSS where Tailwind doesn't reach.
- **No browser-storage of new state.** Pagination state (currentPage) lives in component state only, never persisted.
- **No teal additions outside the existing exception list.** Page dots use teal-600 (state indicator — allowed). Active pill teal background (active state — allowed). No new decorative teal.
- **Keyboard model from v4 is locked except for the additions.** Only `[` and `]` are new bindings. `PageDown`/`PageUp` keep their v4 meaning (next/prev sub-product). `Esc`, `Tab`, `↓↑←→`, `0-9`, `/`, `?`, `1-9` all unchanged.
- **Mobile redirect** (`/place-order` viewport < 1024px → `/order`) preserved verbatim.
- **No restructuring of the search code path.** Multi-token scoring, search result types, dedup logic, focusHint shape — all unchanged.

═══════════════════════════════════════════════════════════════════════════════
## OUT OF SCOPE FOR THIS PROMPT
═══════════════════════════════════════════════════════════════════════════════

- Stage E taxonomy migration (separate session).
- `baseOrderRank` column on `mo_order_form_index_v2` (separate session; sort stays alphabetical until that lands).
- `/order` + `/place-order` merge (future session).
- "Place Order" → "Purchase Order (PO)" rename (future session).
- Mobile responsive redesign.
- Recently-used panel changes.
- Cart panel changes (cart keeps its own scroll behaviour).
- Speed dial v2 modes (by-volume, by-filter, per-user) — only the compact-when-active toggle is in scope.

═══════════════════════════════════════════════════════════════════════════════
## ASK BEFORE PROCEEDING
═══════════════════════════════════════════════════════════════════════════════

After Step 1 file reads complete, before any code is written, report back with:

1. Confirmation of all 18 files read + their lengths.
2. Schema / parser / UI versions confirmed from the canonical files.
3. Findings from Step 2 root-cause inspection (the 5 numbered questions).
4. Any open questions or expected obstacles (e.g. if the customer pill is in a different component than expected, or if `use-keyboard-routing.ts` has a structure that makes `[`/`]` binding awkward).

**Do not write code until I confirm the inspection report and give the go-ahead.**

═══════════════════════════════════════════════════════════════════════════════
END OF PROMPT
═══════════════════════════════════════════════════════════════════════════════
