# Planning Update — /place-order v5: No-Scroll Grid + Pagination (shipped to main)

Session date: 2026-05-11
Session type: planning + design + implementation oversight
Target files: CLAUDE_MAIL_ORDERS.md §19, CLAUDE_UI.md §51, CLAUDE_CORE.md §13
Implementation status: **Shipped to main (commit `0330da46`). Vercel auto-deploy in flight. Awaiting depot smoke-test on 22-24" monitor for the responsive-sizing follow-up decision.**

## DECISION SUMMARY

The `/place-order` page is locked to viewport height — no vertical page scroll, ever. The variant grid card displays 15 base rows fixed per page; sub-products with more than 17 bases paginate at 15 per page (today affects GLOSS at 38 and STAINER · UNIVERSAL STAINER at 30; everything else fits single-page). Pagination is mouse-driven via page dots in the card header, and keyboard-driven via `Shift+PageDown` / `Shift+PageUp` (unshifted PageDown/PageUp keep their v4 behaviour of next/prev sub-product). Cell sizing is currently fixed in pixels (56×32, font 13px) — responsive scaling for larger monitors is deferred to a follow-up session pending depot user feedback.

The session began with an over-scoped design exercise (8 layout options, two-column GLOSS treatment) but converged on a simpler shape after the actual catalog data showed only ONE sub-product (GLOSS, 38 bases) exceeds the no-scroll threshold of 15-16 visible bases. The shipped solution is a fixed-page-size pagination model that ships as a mechanism today; popularity-ranked base ordering will follow once a separate `baseOrderRank` migration lands on `mo_order_form_index_v2`.

## CONTEXT CHANGES

- **Page layout is fixed-height.** Root container is `h-screen overflow-hidden flex flex-col`. Top bar is `flex-shrink-0`. Content section is `flex-1 overflow-hidden`. No vertical page scroll path exists anywhere on `/place-order`. Variant grid card never scrolls internally either.
- **Variant grid is paginated.** `VARIANT_GRID_PAGE_SIZE = 15` and `VARIANT_GRID_PAGINATION_THRESHOLD = 17` are exported constants from `variant-grid.tsx`. Sub-products with `bases.length > 17` paginate at 15 bases per page. Page state lives in the parent panels (`sub-product-direct.tsx` and `family-nav-with-tabs.tsx`), resets to 0 on `subProductName` / `activeSubProduct` change.
- **Speed dial has two render modes.** When `activeState.kind === "idle"` it renders as the full 9-tile grid (browse mode). When a sub-product is active it renders as a compact horizontal pill strip (~40px tall, work mode). The compact strip preserves the 1-9 digit shortcuts and pill click-to-switch; the active pill gains a teal-bordered visual + ▸ marker.
- **Customer pill lives in the top bar.** Padding-based sizing (`px-2.5 py-1`), `max-w-full min-w-0` + `truncate` on the name span so long customer names ellipsis-truncate instead of pushing right-side chrome off-screen. **Critical**: the wrapper around `<CustomerSearch>` must NOT have `overflow-hidden` — that clips the absolute-positioned dropdown when typing customer queries (this bug was caught and fixed mid-session; the fix is preserved with an inline comment).
- **RecentlyUsed + LastOrderRecall panels** are conditionally hidden when `activeState.kind !== "idle"`. They render only in the no-sub-product browse state. This is what recovers the vertical space required for the 15-row grid.
- **Pack header is single-line.** Format: `1L · box 6` at 10.5px (title in default colour, `· box N` portion in mono gray-400). Saves ~8-10px vertical vs the v4 two-line stack.
- **Pack columns have explicit 80px width.** Set via `style={{ width: "80px" }}` on each `<col>` in the `colgroup`. With `table-layout: fixed`, this prevents the auto-distribute behaviour that caused excessive horizontal whitespace between cells in early smoke-test screenshots.
- **Keyboard model gains one new binding:** `Shift+PageDown` (next page) and `Shift+PageUp` (prev page) for paginated sub-products. Unshifted `PageDown` / `PageUp` keep their v4 binding (next/prev sub-product within a family). The cell key handler checks `!e.shiftKey` on the unshifted path to disambiguate cleanly.
- **Search-to-base auto-flips to target page.** When a `sub-product-base` search result resolves to a base on page N, the panel sets `currentPage = N` before slicing, then `variant-grid`'s existing auto-focus effect finds the target cell in the new slice and focuses it. The viewKey extension to include first-row baseColour is what makes the focus effect re-fire after a page change.
- **Mailto byte-identical.** `lib/place-order/email.ts` and `lib/place-order/pack.ts` are zero-diff from the pre-v5 commit. Verified in the pre-push checklist (`git diff` showed 0 bytes).
- **Branch strategy locked: direct-to-main.** No feature branches, no PRs. Workflow is: build locally → `tsc --noEmit` passes → local browser smoke test → commit + push to main → Vercel auto-deploys. Production currently has only Smart Flow as an active user, so direct-to-main is safe.

## RENDER-STATE MATRIX (locked)

| `activeState.kind` | SpeedDial | ActivePanel | RecentlyUsed | LastOrderRecall | BrowseAll |
|---|---|---|---|---|---|
| `idle` | full 9-tile grid | hidden | shown | shown | shown |
| `sub-product` / `family` / `section` | compact pill strip | shown | hidden | hidden | shown |

## NEW PENDING ITEMS

| Title | Owner | Blocker |
|---|---|---|
| Depot smoke-test on 22-24" monitor | Smart Flow | Vercel deploy completion |
| Responsive cell sizing (Tier 2 / Tier 3) for larger viewports | Future session | Depot feedback on whether fixed pixels feel too small on big monitors |
| `baseOrderRank` column migration on `mo_order_form_index_v2` | Future session | None (mechanism is in place; just needs the schema + data) |
| Embedded-mode pagination indicator (drilled WOODCARE) | Dormant | No woodcare family currently exceeds 17 bases; revisit if/when one does |
| Add `"postinstall": "prisma generate"` to `package.json` | Future small session | None (1-line ergonomic fix) |
| Stage E taxonomy migration | Claude Code session | Already queued |
| Move workspace out of OneDrive | Smart Flow | None (quality-of-life) |

## SUPERSEDED DECISIONS

- **Two-column variant grid for GLOSS** (proposed in earlier session draft `web-update-2026-05-11-variant-grid-two-column-design.md`). Rejected in favour of single-column pagination after data analysis showed only one sub-product exceeds the no-scroll threshold and a long-tail of slow-moving bases makes the visual split less valuable than originally framed.
- **`[` and `]` keys for pagination.** Built and tested mid-session, then removed in favour of `Shift+PageDown` / `Shift+PageUp` per operator preference.
- **`PAGE_SIZE = 13` and `THRESHOLD = 15`** (initial draft values). Bumped to 15 / 17 so STAINER · UNIVERSAL STAINER paginates into clean 2 pages of 15 and WS·PROTECT (16 bases) fits single-page.
- **Cell size 72×44px** (v4 baseline). Compressed to 56×32px to fit 15 rows on a 13" laptop viewport.
- **Speed dial always-visible-as-tiles.** Now renders in two modes based on `activeState`.

## MOCKUPS / ARTEFACTS PRODUCED

- `docs/mockups/place-order/desktop-variant-grid-no-scroll-variants.html` — v5 mockup showing Variant A (collapsed speed dial + bigger cells) and Variant B (full speed dial + compact cells) side-by-side, plus the GLOSS pagination treatment. Variant A was selected as the locked design and was the source of truth for the implementation.

## PROMPTS DRAFTED FOR CLAUDE CODE

- `docs/prompts/drafts/code-update-2026-05-11-place-order-v5-no-scroll-grid.md` — 10-phase Claude Code prompt that drove the implementation. Phases 3.1 through 3.10 covered customer pill polish, speed-dial compact mode, cell compression, page overflow lock, pagination chrome + state, keyboard bindings, search-to-page flip, context file updates, smoke test, and commit. All phases shipped under commit `0330da46`.

## KEY LEARNINGS FROM THIS SESSION

- **Frame from data, not intuition.** The initial session-opener assumed a long tail of fat sub-products (>20, >30, >40 bases). The actual distribution showed n=1 outlier (GLOSS at 38). The 8-option design exercise was correctly narrowed to a single targeted fix once the data was checked. Mockup work without data pull was wasted effort.
- **Over-scoping a prompt is more expensive than re-prompting.** The original 10-phase Claude Code prompt was over-scoped; phases 3.6/3.7/3.8 were arguably nice-to-haves that could have shipped as a follow-up. Shipped anyway because Claude Code was already mid-stream; future sessions should resist building all the polish in one pass.
- **`overflow-hidden` is dangerous.** It clips absolute-positioned descendants regardless of nested positioning context. Bug 1's `overflow-hidden` fix for top-bar push-off broke the customer-search dropdown completely. Future Claude work touching layout should treat `overflow-hidden` as a tightly-scoped tool, never a "just add it everywhere" fix. Inline comment now documents the deliberate absence on the customer-search wrapper.
- **Defensive keyboard handler patterns.** Using `e.code` ("BracketLeft" / "BracketRight") as a fallback to `e.key` handles non-US keyboard layouts cleanly. Worth the 2 extra lines whenever a key handler depends on a specific character.
- **`!e.shiftKey` guards on unshifted handlers** prevent the same physical key combo from firing two handlers when modifiers change the intended action. Cleaner than relying on handler order.
- **Direct-to-main with single-user production is safe.** No-PR workflow only works because the only active user (Smart Flow) is also the one shipping. When depot users come online, may need to reintroduce some lightweight review gate. Until then, ship velocity wins.

## CONSOLIDATION NOTES

To merge into canonical files at next consolidation cycle:

- **CLAUDE_CORE.md §13** — already updated in Phase 3.8 with the layout lock + cross-reference to MAIL_ORDERS §19. Schema unchanged (no new columns this session). Document the direct-to-main branch strategy explicitly in an "Engineering workflow" or §3 update so future Claude doesn't propose feature branches.
- **CLAUDE_UI.md §51** — already added as "No-scroll page layout (place-order v5)" with all sizing specs. Version bumped to v5.2. Next consolidation pass: review whether §1 ("one teal element" rule) needs updating to formally acknowledge the v5 exception list (active speed-dial pill, page dots, focused cell, filled cells, customer pill, Send button — all teal, none decorative).
- **CLAUDE_MAIL_ORDERS.md §19** — new section already added with component tree, render-state matrix, keyboard model table (now includes `Shift+PageDown`/`PageUp` row), pagination spec, search hand-off, mailto byte-identical guarantee. Drift to flag: §19 was the only `/place-order` spec in the file; older sections may reference the pre-v4 category-grid layout. Consolidation should sweep older sections for stale references and remove or update them.
- **CLAUDE_TINT.md** — no changes required.

---

STATUS: shipped. Decisions are locked unless depot smoke-test on the 24" monitor surfaces real pain. Revisit only if real-world feedback warrants. Save to `docs/prompts/drafts/web-update-2026-05-11-place-order-v5-shipped.md` and commit. Consolidation will merge it into canonical files next cycle.
