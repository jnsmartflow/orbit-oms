# Planning Update — /place-order desktop page built through Phase 7, awaiting product categorisation
Session date: 2026-05-06
Session type: planning + design + Claude Code execution oversight
Target files: docs/CLAUDE_CORE.md §5, §6, docs/CLAUDE_UI.md (new section for /place-order), new docs/CLAUDE_PLACE_ORDER.md (proposed)
Implementation status: code complete on feat/place-order-page branch (uncommitted), blocked from merge by product categorisation cleanup

## DECISION SUMMARY

A new authenticated desktop page `/place-order` was built end-to-end across 7 phases for depot phone-order entry. It targets ~30s order entry vs the current ~90s mobile path by leaning on numpad-only keyboard navigation, a photo-first category grid, real-time direct-to-cart writes, and a `mailto:` submit that matches the existing mobile `/order` parser output byte-for-byte. Code is complete on `feat/place-order-page` branch but **deliberately not yet committed** — the live `mo_order_form_index.family` taxonomy has 15 uneven families (some with 40 sub-products, some with 1) and needs cleanup before the page is exposed to depot operators. Multi-bill keyboard shortcuts (`b` / `Shift+B`) were added in Phase 7 and then removed by request — multi-bill is mouse-only via the `[+ Add]` cart tab.

## CONTEXT CHANGES

- **New route**: `/place-order` (action-verb naming, distinct from `/order` public mobile and `/mail-orders` inbound resolution board). Lives at `app/(place-order)/place-order/*` with its own route group and minimal layout (no sidebar, full-bleed for grid).
- **Roles allowed**: `admin`, `billing_operator`, `tint_manager`, `support`, `dispatcher`. Roles denied: `tint_operator`, `floor_supervisor`, `picker`, `operations`. Wired via 5 rows in `role_permissions` table with `pageKey = 'place_order'`, all `canView=true canEdit=true`. Sidebar surfaces "Place Order" entry via existing `buildNavItems()` helper — no per-layout edit needed.
- **`role_permissions` table column convention** confirmed during this session: `roleSlug` (text), `pageKey` (text), `canView` / `canImport` / `canExport` / `canEdit` / `canDelete` (booleans), `updatedAt` (timestamp). All camelCase, must be quoted in SQL. Reinforces CORE §3 rule.
- **`public.users` schema** (clarified during testing): `id integer`, `email text`, `name text`, `roleId integer` (no slug column on users — joins through... actually users live without a roles table; `roleId` is a numeric reference resolved via app code). RoleId map: 1 admin, 2 dispatcher, 3 support, 4 tint_manager, 5 tint_operator, 6 floor_supervisor, 7 picker, 12 operations, 13 billing_operator. M900 / SPRAY PAINT etc. are family values not role values — different table.
- **Cell semantics for `/place-order`**: cell qty represents **box count** (not unit count). Email body emits **unit count** via `qty * packStep(formatPack(pack))` multiplication at email-build time only. Operator UI thinks in boxes ("send me 6 boxes of 1L"); parser sees units identical to mobile output. Saved to project memory at `place_order_cell_vs_email_units.md` indexed in `MEMORY.md`. Mobile `/order` keeps unit-thinking (qty = units). Both pages emit byte-identical email bodies.
- **`mo_order_form_index.family` ground truth confirmed**: 15 distinct families — DULUX, WS, VT, SADOLIN, PROMISE, AQUATECH, TINTER, M900, DUWEL, SPRAY PAINT, AUTO, STAINER, DUCO, PRIMER, TOOLS. Earlier planning docs assumed 12 (with GLOSS, WEATHERCOAT, SATIN, SUPERCLEAN, PROMISE_ENML as top-level). Those 5 are sub-products under DULUX or PROMISE. Page now groups by real 15.
- **Photo files at `public/category-images/`**: 11 real Dulux photos in place (vt, ws, gloss, satin, weathercoat, superclean, promise, promise_enml, dulux, sadolin, aquatech). 4 of these (gloss, satin, superclean, promise_enml) are unused at top level today — they remain on disk for future sub-product display. Monogram fallback handles AUTO, M900, SPRAY PAINT, STAINER, TINTER, DUCO, PRIMER, DUWEL, TOOLS — 9 categories on monograms is acceptable for v1.
- **Keyboard model finalised**: numpad-primary with letter-search escape hatch. Customer pill is the only place letters are typed. After customer lock, focus jumps to grid. `1`-`9` opens top categories. Inside grid: arrows / Tab / Enter for movement, `0`-`9` for qty (box count), `+`/`-` for box delta, `Backspace` clears, `*` closes panel context-aware (panel open → close panel; panel closed → focus search), `/` opens send-confirm overlay, `?` opens keymap help. Multi-bill keys (`b`, `Shift+B`) were added then removed — multi-bill is mouse-only.
- **Send flow**: `/` opens confirm overlay with email body preview, `Enter` or `/` confirms and triggers `mailto:` to `surat.order@outlook.com`. Subject `Order — <Customer Name> <Code>`. Body matches mobile parser format. Cart clears on send (customer kept), 3-second toast confirms.
- **Drafts**: `localStorage` per customer under key `orbitoms_place_order_draft_v1`, 24h TTL, auto-evicted on stale read. Restores on customer re-select. Cleared on send. Cross-PC drafts deliberately out of scope.
- **Viewport guard**: < 1024px width redirects to `/order` mobile page on mount and resize.

## NEW PENDING ITEMS

| Item | Owner | Blocker |
|---|---|---|
| Product taxonomy cleanup — design 8-15 well-balanced top-level categories from current 15 uneven families + ~150 sub-products | me (Smart Flow), separate fresh Claude.ai session | none — prompt drafted (see below) |
| Apply taxonomy via SQL update on `mo_order_form_index.family` and possibly `mo_sku_lookup.category` | me + Claude Code follow-up session | depends on taxonomy decision |
| Real depot test with Deepanshu — one full phone order on `/place-order`, target <60s with no mouse after customer pick | depot | depends on taxonomy cleanup (can't test on confusing categories) |
| Parser equivalence byte-diff against mobile `/order` output | me, side-by-side browser test | not blocking — math verified visually in Phase 6 (1L*36, 4L*16, 10L*20, 20L*10 all correct) |
| Phase 6 follow-up: cart panel topbar count label — "boxes" vs "units" — currently sums raw cell qtys (= boxes per locked decision) | Claude Code in cleanup session | none |
| AUTO category photo source from Dulux marketing | me | low priority, monogram works |
| Source photos for DUWEL (12 rows), STAINER (10), DUCO (9), PRIMER (5), if those families remain top-level after taxonomy cleanup | me | depends on taxonomy decision |
| Commit feat/place-order-page branch as 3 logical commits and push | me, after taxonomy + Deepanshu live test pass | depot live test pass |
| Update `lib/permissions.ts` PAGE_NAV_MAP — verify "Place Order" surfaces above "Mail Orders" in sidebar order for billing_operator | me, visual check | none |
| Server-side draft persistence (cross-PC) — explicitly out of scope this session, revisit if depot moves to multi-PC workflow | future session | depends on operator feedback |
| Recent customer list / "duplicate last order" shortcut — explicitly out of scope, revisit after live use | future session | depot feedback |
| Topbar count label decision (cart: N lines · M units vs M boxes) flagged by Claude Code at Phase 6 — needs settle | me | revisit at next code session |

## SUPERSEDED DECISIONS

- The earlier 12-family planning assumption (with GLOSS / WEATHERCOAT / SATIN / SUPERCLEAN / PROMISE_ENML as top-level) is superseded. Live DB has 15 families; those 5 are sub-products. The `code-update-2026-05-06-place-order-page.md` planning doc §6.2 photo list reflects the 12-family error — when consolidating, fix the planning doc OR mark it deprecated and reference this update.
- `b` / `Shift+B` keyboard shortcuts for multi-bill cycle / add (added in Phase 7 first pass) are removed. Multi-bill is mouse-only via `[+ Add]` tab.

## MOCKUPS / ARTEFACTS PRODUCED

| File | Purpose |
|---|---|
| `docs/mockups/place-order/desktop-order-mockup-v4.html` | v4.1 photo-first cards, locked design, 11 real Dulux photos embedded base64, switchable State 2 (empty) and State 3 (variant grid open) views |
| `docs/mockups/place-order/keyboard-storyboard.html` | 8-frame walkthrough of a 22-keystroke order in 30 seconds (locked keyboard model — note multi-bill keys shown here are now removed) |
| `docs/prompts/drafts/code-update-2026-05-06-place-order-page.md` | 15-section implementation plan that drove all 7 phases. Contains: route + access wiring, data feed, submit flow, customer search rules, category grid spec, variant grid Excel-style spec, full keyboard map (with bill keys that were later removed), cart panel spec, constraints, 25-item testing checklist, 7-phase build plan |
| `place_order_cell_vs_email_units.md` (Claude Code project memory) | Locks the cell-stores-boxes / email-emits-units convention. Indexed in MEMORY.md so future Claude Code sessions inherit the rule across context boundaries |

## PROMPTS DRAFTED FOR CLAUDE CODE

- The 7-phase implementation prompt at `docs/prompts/drafts/code-update-2026-05-06-place-order-page.md` is fully consumed — Phases 1-7 executed, code complete on `feat/place-order-page` branch.
- Follow-up prompt for taxonomy SQL update: not drafted yet. Wait for taxonomy decision from the parallel categorisation session, then draft.
- Follow-up prompt for committing the branch as 3 logical commits is implicit in the current Claude Code session — re-issue when ready: "commit phases 1-3 / phases 4-5 / phases 6-7 separately, then push to feat/place-order-page".

## PROMPT FOR PARALLEL TAXONOMY SESSION (paste into fresh Claude.ai chat)

```
You are helping me design a MASTER product category taxonomy for OrbitOMS — an internal depot operations management system at JSW Dulux Surat depot.

SCOPE
This taxonomy will be applied SYSTEM-WIDE across all SKU-related tables. It is not for one page. It governs:
- mo_order_form_index (drives /place-order and /order pages)
- mo_sku_lookup (drives mail order parsing and enrichment)
- Tint manager / operator displays
- Future dispatch reports, MIS rollups, sales reports
- Anywhere a "family" or "category" column lives

This is a one-time foundational decision.

CURRENT STATE
Live mo_order_form_index has 15 families: DULUX, WS, VT, SADOLIN, PROMISE, AQUATECH, TINTER, M900, DUWEL, SPRAY PAINT, AUTO, STAINER, DUCO, PRIMER, TOOLS.

Sub-product distribution is uneven:
- DULUX has 15 sub-products: 3IN1, 5IN1, ALKALI BLOC PRIMER, GLOSS, IAE PROJECT, INTERIOR DISTEMPER, LUSTRE, PU ENAMEL, SATIN STAY BRIGHT, SILK FINISH, SMOOTHOVER, SUPER SATIN, SUPERCLEAN, SUPERCOVER, SUPERCOVER SHEEN
- SADOLIN has 40 sub-products: mostly wood/metal coatings, PU finishes, melamines, NC lacquers
- VT has 15: AMBIANCE, DIAMOND GLO, ETERNA, ETERNA HI-SHEEN, ETERNA MATT, LUXURY FINISHES, PEARL GLO, PLATINUM GLO, VAF, VT CLEAR COAT, VT CONCRETE FINISH, VT FIN, VT MARBLE, VT METALLICS, VT VELVETINO
- WS has 14: HISHEEN, MAX, POWERFLEXX, PROTECT, PROTECT RAINPROOF, TEXTURE, TILE, WS ELASTOMERIC, WS FLASH, WS METALLIC, WS PRIMA E900, WS PROJECT, WS TR E2000, WS ULTRACLEAN
- PROMISE has 13: PROMISE 2IN1, PROMISE ENML, PROMISE EXTERIOR, PROMISE FREEDOM 2IN1, PROMISE INTERIOR, PROMISE PRIMER, PROMISE SHEEN EXTERIOR, PROMISE SHEEN INTERIOR, PROMISE SMARTCHOICE ACRYLIC DISTEMPER, PROMISE SMARTCHOICE EXT, PROMISE SMARTCHOICE EXT PRIMER, PROMISE SMARTCHOICE INT, PROMISE SMARTCHOICE INT PRIMER
- AQUATECH has 16, mostly waterproofing
- Smaller families: TINTER (24), M900 (1), DUWEL (11), SPRAY PAINT (1), AUTO (1), STAINER (10), DUCO (9), PRIMER (5), TOOLS (2)

KEY TENSION
The official JSW Dulux marketing structure (which I will share via screenshots) organises products by brand line. But operators and customers don't always speak that language. Examples:
- Customer: "weather paint 20L" → could be Weathershield, WS Protect, Promise Exterior
- Customer: "Velvet Touch Diamond" → official: VT Diamond Glo
- Customer: "Promise white" → could be Promise Interior, Promise Exterior, or Promise Enamel
- Customer: "PU finish for cabinet" → Sadolin 2KPU vs VT PU vs Duco PU

ROUND PROTOCOL
1. I share an image (official JSW Dulux category structure, or a section of it) — typically going one section at a time from largest to smallest
2. You analyse the marketing logic
3. You ask me 2-3 questions about depot operator vocabulary and customer language for that section
4. I answer
5. You propose a re-categorisation that:
   - Stays close to official where customer language matches
   - Re-groups or re-names where customer language diverges  
   - Flags candidates for cross-listing (same SKU appearing in 2 categories)
   - Notes which sub-products should be promoted to top-level / demoted
6. We iterate, then move to the next image

After all rounds, you produce a final master taxonomy with:
- 8-15 top-level categories
- Mapping table: (existing 15 families × ~150 sub-products) → new category
- SQL update plan to apply across mo_order_form_index AND mo_sku_lookup
- Migration risks (any tables/code that hardcode current family names)

CONSTRAINTS
- No code changes, no SQL execution. We're only designing the taxonomy.
- Use depot operator vocabulary, not marketing-speak
- Don't rename depot codes operators already memorise (WS, VT, etc.)
- Recommend cross-listing only when truly justified by customer phrasing
- Keep proposals short and tabular

OUTPUT TABLE FORMAT (per round)

| Section | Official structure | Sub-products | Customer phrasing patterns | Proposed category | Cross-list? | Notes |

START BY ASKING ME TO SHARE THE FIRST IMAGE — top-level JSW Dulux category page from dulux.in.
```

## CONSOLIDATION NOTES

- **CLAUDE_CORE.md §5 (Roles and users)** — add note: `place_order` page key, allowed roles `admin / billing_operator / tint_manager / support / dispatcher`. RoleId map confirmed during session: 1=admin, 2=dispatcher, 3=support, 4=tint_manager, 5=tint_operator, 6=floor_supervisor, 7=picker, 12=operations, 13=billing_operator. Worth pinning in §5 for future role-permission queries.
- **CLAUDE_CORE.md §6 (Frontend files / routes index)** — register new route `/place-order` with file path `app/(place-order)/place-order/*`, allowed roles, status (built but uncommitted pending taxonomy cleanup).
- **CLAUDE_CORE.md §3 (Engineering rules)** — add: "When writing SQL referencing `role_permissions`, columns are `roleSlug`, `pageKey`, `canView`, `canImport`, `canExport`, `canEdit`, `canDelete`, `updatedAt` — all camelCase, must be quoted." Caught Claude Code generating `role` / `page_key` SQL twice this session.
- **CLAUDE_UI.md** — proposed new section: `/place-order` design system. Captures: 4-col photo card grid (170×200px, uniform `#fafbfc` photo zone, 110×110 max-image rule for tin consistency), variant grid Excel cell semantics (empty/active/focused/NA states), cart panel spec (360px sticky), confirm overlay pattern. Defer until after taxonomy cleanup so the section reflects final category list.
- **New file proposed: docs/CLAUDE_PLACE_ORDER.md** — domain doc for the page, parallel to CLAUDE_MAIL_ORDERS.md and CLAUDE_TINT.md. Captures: keyboard map, cell-vs-email-units rule, draft schema, role gating, photo folder convention, parser-equivalence requirement, taxonomy dependency. Create when committing the branch.
- **Parallel taxonomy session output** when complete will produce its own draft (web-update format) — that draft is the input to a second Claude Code session that runs the SQL update and any code adjustments.
- **Mockup `keyboard-storyboard.html` is now stale** on the multi-bill keys (`b`, `Shift+B` shown but no longer wired). Update or annotate before next consolidation cycle.
- **Photo folder note**: `public/category-images/` has 11 photos. Files for unused-at-top-level categories (gloss, satin, superclean, promise_enml) deliberately retained — will be reused if those promote to top-level after taxonomy cleanup, or if a future enhancement displays sub-product icons.

*End of planning update.*
