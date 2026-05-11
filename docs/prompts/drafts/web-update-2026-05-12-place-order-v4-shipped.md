# Planning Update — /place-order v4 redesign shipped to feat/place-order-page

Session date: 2026-05-12
Session type: design + implementation review + post-build keyboard polish
Target files: CLAUDE_MAIL_ORDERS.md, CLAUDE_UI.md, CLAUDE_CORE.md
Implementation status: Built. Branch pushed. PR opened. Awaiting Vercel preview test by Deepanshu / Bankim before merge to main.

## DECISION SUMMARY

The /place-order page is rebuilt around a search-first model with a 9-tile speed dial of the most-ordered families, replacing the legacy category-grid + expanded-panel composition. The keyboard model is locked: customer-lock auto-focuses search bar, Esc-from-cell returns focus to page body (not search), digits 1-9 always open speed-dial tiles, "/" focuses search from body. The taxonomy foundation (section + subgroup columns on `mo_order_form_index_v2`) is in place but the underlying data still has cross-listed families (Promise appearing in both ENAMELS and MULTI-USE) that need cleanup in a future session. Tab-cycle through tiles was considered, built, and removed in favour of digit shortcuts only — keyboard model simplicity won over scan-friendliness.

## FUTURE DIRECTION (planned, not yet started)

- **Merge `/order` and `/place-order` into a single responsive page.** Currently `/place-order` is desktop-only (1024px+ redirects to `/order` for mobile) and `/order` is the mobile-only legacy form. Future state: one unified URL, one component tree, responsive layout that adapts to desktop (full v4 layout: search + speed dial + active panel + cart) and mobile (compact form-driven flow). Eliminates the parallel-codebase maintenance burden of `/order` and `/place-order`.
- **Rename the module from "Place Order" to "Purchase Order (PO)"** across all surfaces: sidebar label, top-bar title, route path (likely `/purchase-order` or `/po`), permission key (currently `place_order`), email subject lines if applicable, and all references in the canonical context files. Operator-facing change to align with the business terminology actually used in the depot (PO is how invoices reference these). Keep `/place-order` and `/order` URLs as redirect aliases for backward compatibility during transition.

These two changes are linked — the merge + rename should happen together in one effort so route migration + label change land in a single coordinated PR. Plan as a dedicated session after the taxonomy redesign session lands.

## CONTEXT CHANGES

- Speed dial v1 contains 9 fixed tiles (operator-curated, not auto-data-derived): GLOSS, SATIN, PROMISE ENAMEL, MAX, VT GLO, WOODCARE (section tile), STAINER, PRIMER, AQUATECH. Order is data-informed but Smart Flow override-locked. Future modes (by-order-volume, by-family-filter, per-user) supported by `/api/place-order/quick-tiles` endpoint shape but not yet activated.
- The 4-pane layout (categories, sub-products, variants, cart) is abandoned. v4 is 2-pane: left content + 340px right cart.
- `mo_order_form_index_v2` now has `section` (TEXT) and `subgroup` (TEXT) columns. Section values used: UTILITY, INTERIORS, EXTERIORS, ENAMELS, WOODCARE, MULTI-USE. Subgroup is finer-grained sub-section taxonomy (e.g. inside WOODCARE: LUXURIO, 2K PU, PU PRIME, NC, MELAMINE, WOOD STAIN, WOOD FILLER).
- `CartLine` type gains `touchedAt?: number` field — set to Date.now() on every setQty path. Drives the "Recently used in this order" panel and just-added cart-flash animation. Field is optional so existing localStorage drafts without it survive load.
- Search uses multi-token scoring: prefix-match=100, word-boundary=20, inner-substring=5, plus +50 multi-token-base bonus when a baseColour token matches. Top 10 results returned.
- Search result types: `family`, `sub-product`, and the new `sub-product-base` (e.g. "GLOSS · Black") which triggers focusHint to land cell focus on the specific base row.
- Search dedup is family-agnostic for sub-product and sub-product-base scopes — cross-listed catalog entries collapse to one row in results. Family-scope results stay distinct.
- Mailto byte-identical with pre-v4 baseline maintained. `email.ts` and `pack.ts` are zero-diff from commit 05ef5aae. `EmailLine` strip on page side keeps only subProduct/baseColour/packQtys — no contamination from touchedAt or any other CartLine additions.
- `/place-order` mobile redirect (viewport < 1024px) preserved verbatim from pre-v4 build. **Will be removed when the merge with /order happens (above).**
- Send Email shortcut "/" was removed as a keyboard binding. "/" now focuses the search bar. Send is mouse-click only via the cart Send button.
- Sub-product tab nav inside a cell uses **PageDown / PageUp** (newly added). Tab/Shift+Tab inside a cell remains pack-column nav (preserved).
- The cart-flash animation lives in `tailwind.config.ts` as a `cart-flash` keyframe + `animate-cart-flash` utility class. 1.2s ease-out, 0% `#f0fdfa` → 100% transparent.

## KEYBOARD MODEL (locked)

| Context | Keys | Behaviour |
|---|---|---|
| Customer locked | (auto) | Search bar focused |
| Search bar focused | letters, digits, all punctuation | Query input — no passthroughs |
| Search bar (with query) | ↓ ↑ / Tab / Shift+Tab / Enter / Esc | Navigate results / select / clear |
| Page body | 1-9 | Open speed dial tile |
| Page body | / | Focus search bar |
| Page body | ? | Toggle help overlay |
| Page body | Esc | Close active panel |
| Variant cell | 0-9 | Qty input |
| Variant cell | Tab / Shift+Tab | Pack column nav |
| Variant cell | ←→↑↓ | Cell-to-cell nav |
| Variant cell | PageDown / PageUp | Next / prev sub-product |
| Variant cell | Esc | Back to page body (panel closes, tile de-highlights) |
| Mouse | Send button | Open send confirm overlay |

## NEW PENDING ITEMS

| Title | Owner | Blocker |
|---|---|---|
| Vercel preview testing on real phone-order workflow | Deepanshu / Bankim | None — preview URL on PR |
| Merge feat/place-order-page → main | Smart Flow | Pending depot confirmation |
| Stage E taxonomy migration execution (13 queued prompts) | Claude Code (new session) | None |
| Catalog cleanup — cross-listed families | Stage E session | Audit hitlist regeneration |
| SKU grouping + family / subgroup taxonomy refinement | Next planning session | None — to be designed |
| **Merge /order + /place-order into one responsive page** | Future session | Taxonomy redesign should land first |
| **Rename "Place Order" → "Purchase Order (PO)" across UI + routes + permission keys** | Future session (paired with /order merge) | Coordinate label changes across sidebar, top-bar, email subjects, canonical files |
| Update `CLAUDE_MAIL_ORDERS.md` to reflect v4 layout (remove category-grid references, document new component tree) | Consolidation pass | None |
| Update `CLAUDE_UI.md` with v4 design decisions (teal exception list, cart-flash, focus-visible) | Consolidation pass | None |
| `use-cell-focus.ts` skeleton was deleted as unused — note removed from CORE if listed | Consolidation pass | None |
| Move workspace out of OneDrive (file-lock bugs caused `.next` cache corruption during this session) | Smart Flow | None — quality-of-life issue |

## SUPERSEDED DECISIONS

- Old category-grid + expanded-panel layout in `/place-order` (pre-v4). Files deleted: `category-grid.tsx`, `expanded-panel.tsx`, `product-search.tsx`.
- Old `app/(place-order)/place-order/hooks/use-keyboard-routing.ts` — replaced by `lib/place-order/use-keyboard-routing.ts` with simplified routeDigit (digit 1-9 always = top-level speed dial, no state-dependent cascade).
- Send Email "/" keyboard shortcut. Cart Send button is mouse-only.
- Tab-cycle through speed dial tiles. Built then reverted — operators prefer digit shortcuts; Tab in cell stays as pack-nav.
- Esc-from-cell focusing the search bar. Now focuses page body so digit shortcuts work in one keystroke.
- A-Z prefill on search via category-grid letter shortcuts (legacy).
- **Separate /order (mobile) and /place-order (desktop) URLs.** Marked for merge into single responsive page in future session.
- **Module name "Place Order".** Will be renamed to "Purchase Order (PO)" in future session.

## MOCKUPS / ARTEFACTS PRODUCED

- `docs/mockups/place-order/desktop-order-redesign-v4.html` — v4 mockup, source of truth for colour/spacing/typography. Read at start of every implementation step.
- `docs/prompts/drafts/web-update-2026-05-12-place-order-ui-redesign.md` — design doc with locked decisions.
- `docs/prompts/drafts/code-update-2026-05-12-place-order-v4-redesign.md` — implementation prompt for Claude Code execution.

## CONSOLIDATION NOTES

To merge into canonical files at next consolidation cycle:

- **CLAUDE_CORE.md** — header still says schema v26.5 in §7 but footer reads v72; CLAUDE.md router says v26.5. Drift exists. Bump to v26.6 (this session added section + subgroup to `mo_order_form_index_v2`). Update §13 mobile redirect note — preserved as before. Document the `lib/place-order/use-keyboard-routing.ts` location change. **Add a "Roadmap" or "Planned" section noting the /order + /place-order merge and Place Order → Purchase Order rename so future Claude sessions know not to over-invest in the current naming or in the parallel-page structure.**
- **CLAUDE_UI.md** — v5.1 → v5.2 candidate. Document the v4 teal exception list (17 distinct teal usages classified as brand / CTA / state / data signal — none decorative). Add `cart-flash` keyframe + `:focus-visible` pattern note.
- **CLAUDE_MAIL_ORDERS.md** — replace category-grid + expanded-panel section with v4 layout (BigSearchBar + SpeedDialGrid + ActiveProductPanel dispatcher + supporting panels). Add keyboard model table verbatim from above.
- **CLAUDE_TINT.md** — no changes required.

STATUS: shipped. Decisions are locked unless depot testing surfaces operator pain. Revisit only if real-world feedback warrants.

## KEY LEARNINGS

- Auto-focus effects in React must depend on stable identities, not recreated references. `viewKey = `${family}|${subProduct}`` (string) is stable across re-renders; `products` array reference is not. The viewKey pattern is reusable.
- Once a parent state-clear callback (`onFocused?.()`) is wired into an effect, the effect must guard against the resulting `prop: value → null` re-fire. The `prevFocusHintRef` pattern (4 lines: track prev value, bail if prev != null && current == null) solves it cleanly.
- Event propagation traps: a focused element's keydown handler must call `e.stopPropagation()` AND `e.nativeEvent.stopPropagation()` when the same key has a global listener. Cell Esc → propagation race with window-level keyboard router → focus ping-pong.
- "ONE teal element" rule from CLAUDE_UI.md §1 is loosened in v4 — the rule was a guideline for decorative use, not for state/brand/CTA/data-signal contexts. Document the exception list to avoid future confusion.
- Auto-passthrough magic (digit in empty search bar opens speed dial) is operator-hostile when catalog has digit-starting product names (`2K PU`, `90 BASE`, `5MM`). Esc-then-digit is honest, predictable, and operators learn it fast.
- OneDrive + Windows + Next.js `.next/` cache is a chronic source of file-lock errors. Workspace should not live inside OneDrive sync folders.

---

Save to `docs/prompts/drafts/web-update-2026-05-12-place-order-v4-shipped.md` and commit. Consolidation will merge it into canonical files next cycle.
