# Next-session opener — /place-order UI/UX redesign (multi-pane layout)

**Save as:** `docs/prompts/drafts/next-session-opener-2026-05-12-place-order-ui-redesign.md`

**Use:** paste contents into a fresh Claude.ai chat at the start of the next session.

---

## OPENER PROMPT (paste this into the new chat)

```
We're redesigning the /place-order frontend. Current state: the page works correctly with the v2 catalog + v2 SKU + section + subgroup data foundation, but the UI/UX is hard to navigate. Operators struggle to find products and add them to cart efficiently. Goal this session: design (and then implement) a 2 or 3-pane layout that makes navigation fast and adding products natural.

This is primarily a DESIGN session followed by implementation. We will produce HTML mockups before any React code is written. Smart Flow's process: mockup → review → approve → Claude Code implementation.

─── READ THESE FILES FIRST — NO OUTPUT UNTIL DONE ──────────────────

Read fully and silently:

1. CLAUDE.md (repo root, auto-loaded)
2. docs/CLAUDE_CORE.md (especially §3 engineering rules + §6 universal header system + §13 sidebar behaviour)
3. docs/CLAUDE_UI.md (full file — neutral aesthetic, ONE teal element rule, fixed table standard, all component specs)
4. docs/CLAUDE_MAIL_ORDERS.md (the existing /mail-orders board uses some patterns we may want to inherit or improve on)
5. docs/prompts/drafts/session-end-2026-05-11-v2-stack-and-section-grouping.md (THIS is the primary context — what shipped, what's uncommitted, what the data foundation looks like)
6. docs/prompts/drafts/web-update-2026-05-06-master-taxonomy-redesign.md (33-family taxonomy + 6 sections — read FINAL SUMMARY block)
7. app/(place-order)/place-order/place-order-page.tsx — the current page composition
8. app/(place-order)/place-order/components/category-grid.tsx — sectioned grid component (currently uncommitted with section + subgroup work)
9. app/(place-order)/place-order/components/expanded-panel.tsx — variant grid panel that expands inline within the category grid
10. app/(place-order)/place-order/components/product-search.tsx (or wherever the typeahead is) — current search overlay implementation
11. docs/mockups/place-order/desktop-order-mockup-v4.html (if it exists in the repo) — original v4 mockup that the current page implements

After reading, confirm in one short message:

- "Files read"
- Schema version, parser version, UI version
- One-line description of the CURRENT layout (how many panes, what's in each, what operator clicks first)
- One-line summary of what's uncommitted on feat/place-order-page (section + subgroup work waiting to land alongside redesign)
- The 5 decisions locked in the 2026-05-11 session (from session-end TL;DR)

Then wait. Do NOT propose any redesign until I say "go".

─── WHAT'S WORKING (DON'T BREAK) ──────────────────────────────────

These are the assets we keep, regardless of layout choice:

- v2 catalog + v2 SKU + section + subgroup data foundation (uncommitted but complete)
- 6-section navigation order: UTILITY, INTERIORS, EXTERIORS, ENAMELS, WOODCARE, MULTI-USE
- 20 subgroup labels for visual clustering
- 33 family cards rendering with photos for ~11 (the rest are letter monograms)
- Customer typeahead at the top
- Cart panel on the right (Ship To, Dispatch chips, Marker chips, Send Email button)
- Variant grid (the "expanded panel") with base × pack matrix, qty inputs, sub-product tabs
- Keyboard shortcuts: 1-9 to jump to top-9 families, ? for help

─── WHAT'S BROKEN (THE WHY OF THIS SESSION) ────────────────────────

Smart Flow's complaints (paraphrased from chat — confirm in person before designing):

- "UI/UX is very difficult and bad to navigate"
- "Hard to add product to cart"
- The current single-column 4-card grid (5 at >1700px) means scrolling through 33 family cards in a long vertical list. Section headers + subgroup row breaks help cluster visually but the page is still tall and operators need to scroll a lot.
- Adding a product requires: scroll to find family card → click family → expanded panel pushes everything down → click sub-product tab → click pack cell → type qty → repeat. Many context shifts per product.

─── DESIGN GOAL ───────────────────────────────────────────────────

Multi-pane layout. Probably:

- LEFT PANE — section + subgroup navigation rail (always visible, click to scroll/filter to section)
- CENTER PANE — family card grid filtered/scrolled to active section, OR active sub-product's variant grid (replacing the inline expanded panel)
- RIGHT PANE — cart (already exists, keep)

OR a 2-pane variant where left pane is sections+families combined and center pane is the variant grid.

OR something else entirely if there's a better idea. Don't anchor on these — operators benefit from whatever lets them complete an order in fewest clicks.

Constraints:
- Must work on desktop (1280px minimum, optimised for 1440-1920px)
- No mobile responsive design — /order mobile is the mobile path; /place-order is desktop-only
- CLAUDE_UI.md neutral aesthetic — gray dominant, ONE teal element per view
- Keyboard-first workflow preserved: number keys, search, esc-to-close
- Cart must stay visible and persistent (operators are taking phone orders live; never want to lose context)
- Sidebar (the global Orbit OMS sidebar) is already hidden on /place-order via the (place-order) route group — no change needed
- Section + subgroup data already in API response — design uses them, doesn't redesign them

─── SESSION OUTPUT (the deliverables) ──────────────────────────────

This session produces THREE artefacts in order:

1. ELICITATION — short conversation between us where you ask Smart Flow questions about operator workflow:
   - Typical order shape (1 product? 5? 20+ line items?)
   - Phone-order context: caller speed, interruptions, talking through line items
   - Frequent product-finding patterns (operator opens the page knowing what family they want vs browsing?)
   - Speed targets (current ~90s mobile, target <60s desktop)
   - Pain points operators have actually voiced (Smart Flow is the proxy here)

2. DESIGN DOC — `docs/prompts/drafts/web-update-2026-05-12-place-order-ui-redesign.md` (a planning update, not code update). Contains:
   - 1-2 layout proposals with ASCII wireframes
   - Recommendation between them
   - Approval gate before mockup work begins

3. HTML MOCKUP — once layout locked, produce `docs/mockups/place-order/desktop-order-redesign-v1.html` (Tailwind CDN standalone file). Embedded sample data for 5-6 families across 3-4 sections so the layout breathes. Switchable states via simple JS toggle if needed (default state, expanded state, multi-product cart state).

After mockup is approved, ONE Claude Code prompt covering:
- Implement the new layout in /place-order
- Preserve all existing functionality (search, keyboard, cart, variant grid)
- tsc --noEmit clean
- Commit BOTH the redesign AND the uncommitted section/subgroup work as a single bundle on feat/place-order-page
- Push to origin → Vercel preview rebuilds

─── HARD CONSTRAINTS — DO NOT VIOLATE ─────────────────────────────

- All engineering rules from CLAUDE_CORE.md §3 (no $transaction, all API routes export const dynamic = 'force-dynamic', schema changes via Supabase only, etc.)
- No edits to lib/mail-orders/* (parser/enrichment untouched)
- No edits to live mo_order_form_index, live mo_sku_lookup, mo_product_keywords, or any orders table
- No edits to /order public mobile page
- No schema changes — the data foundation is locked from the prior session
- The cart panel functionality (mailto: build, dispatch chips, marker chips, ship-to override) stays exactly as is — only its visual placement might change
- The mailto: email body output must remain byte-identical to the current /place-order output (operators rely on the parser receiving consistent output)
- Single teal element rule (CLAUDE_UI.md) — choose carefully where teal lands in the new layout

─── WHAT NOT TO DO ─────────────────────────────────────────────────

- Do not propose changes to the 6 sections, 20 subgroups, or 33 families
- Do not propose changes to the v2 catalog or v2 SKU table schema
- Do not propose changes to the parser or enrichment pipeline
- Do not propose mobile-responsive design for /place-order (desktop-only)
- Do not start writing React code before the HTML mockup is approved
- Do not commit the section/subgroup work separately — bundle it with the redesign
- Do not propose moving /order mobile to the new layout in this session — that's a separate future session

─── ENVIRONMENT REMINDERS ──────────────────────────────────────────

- Branch: feat/place-order-page (already pushed to origin with v2 catalog + SKU commits)
- Vercel preview building green; production untouched on main
- /place-order remains operator-invisible — branch-only, preview URL only
- Backup: full working copy at C:\Users\HP\OneDrive\VS Code\orbit-oms-backup-2026-05-10-1104 (older but kept)
- Smart Flow runs on Windows + PowerShell; remember single-quote any path containing parentheses (e.g. 'app/(place-order)/...')
- Prisma generate occasionally hits Windows file-lock (EPERM); recover via Get-Process node | Stop-Process -Force then retry

─── WHAT TO DO FIRST ───────────────────────────────────────────────

1. Read the 11 files listed above silently.
2. Confirm with: "Files read · v72/v5.1/v1.0 confirmed · current layout summary · uncommitted state acknowledged · 5 prior locks understood."
3. Wait for me to say "go".
4. I'll either:
   (a) Answer elicitation questions about operator workflow
   (b) Tell you to skip elicitation and dive into layout proposals based on session-end context
5. Produce the design doc with 1-2 layout proposals.
6. Wait for layout approval before any mockup HTML.

That's the path. Don't start designing before "go".
```

---

## NOTES FOR FUTURE-SMART-FLOW

- **The uncommitted state is critical context.** The section + subgroup render in `category-grid.tsx` is on disk but not in any commit. If the next session starts on a different machine, run `git status` first — if the working tree doesn't show the uncommitted changes, the redesign session needs to either re-do the section/subgroup work first OR pull from a backup. The 2026-05-10-1104 backup has the working tree.
- **The redesign is non-trivial.** Likely 2-3 sessions: (1) elicitation + design doc, (2) HTML mockup + iteration, (3) Claude Code implementation. Don't compress into one session.
- **The "operator can complete order in <60s" target is from the original /place-order spec** (`docs/prompts/drafts/code-update-2026-05-26-place-order-page.md`, dated 2026-05-06 despite the filename typo). Worth re-reading that file early in the next session — has detailed keyboard model that the redesign must preserve or improve on.
- **Mail Orders board is the closest existing pattern** — it has table view + review view + focus view (the third one was discarded in April). Operators are familiar with that paradigm. The /place-order redesign might inherit similar pane semantics.
- **Reasonable layout starting points** worth proposing during elicitation:
  - 3-pane: left rail (sections) + center (active section's families OR active family's variant grid) + right (cart)
  - 2-pane with bottom drawer: left (families collapsed by section) + right (cart), variant grid as a bottom drawer that slides up
  - Compact card list with hover-to-preview: dense vertical list of all families (one line each, family + subgroup + product count + skuCount), hover shows the variant grid in a tooltip-like panel
- **Don't underestimate the variant grid disruption.** Currently it's an inline expanded panel inside the section grid — clicking a card pushes everything below it down. Operators don't love this. The redesign almost certainly needs to take the variant grid out of the inline flow and put it in its own pane or modal.
- **Cart panel is sacred.** Phone-order operators talk through line items live. Losing the cart from view mid-order = bad. Keep it visible, persistent, and never below-the-fold.

---

*Next-session opener · 2026-05-11 · /place-order UI redesign*
