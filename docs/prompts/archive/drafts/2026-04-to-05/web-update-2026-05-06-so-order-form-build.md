# Planning Update — SO Order Form Full Build + Multi-SKU Picker
Session date: 2026-05-06
Session type: planning / design / implementation
Target files: CLAUDE_CORE.md, CLAUDE_MAIL_ORDERS.md
Implementation status: partially built — core form live, multi-SKU picker live, parser compatibility pending

## DECISION SUMMARY
Built a public mobile order form at orbitoms.in/order for Sales Officers to place orders via email. Form generates a mailto: email that lands in surat.order@outlook.com for parser processing. Multi-SKU picker flow built — SO searches, selects multiple products via checkboxes with horizontal swipe pagination, then steps through pack quantities one by one. Parser/enrichment compatibility not yet verified — needs review before form is officially handed to SOs.

## CONTEXT CHANGES

- New public page: `orbitoms.in/order` — SO order form, no login required
- New public page: `orbitoms.in/demo` — animated tutorial demo, no login required
- New table: `mo_order_form_index` (481 rows) — flat product catalog for order form search. Separate from enrichment engine tables (mo_product_keywords, mo_base_keywords, mo_sku_lookup) — enrichment engine never reads this table
- mo_order_form_index schema: id, family, subProduct, baseColour, displayName, searchTokens, tinterType, productType, sortOrder, isActive, createdAt. UNIQUE(subProduct, baseColour)
- productType values: BASE_VARIANT (numbered bases), COLOUR (named colours), PLAIN (no base)
- 481 rows: 250 BASE_VARIANT + 118 COLOUR + 113 PLAIN across 15 families
- Search uses searchTokens ILIKE matching — 1-2 words finds correct product
- Pack format in email: `MAX 92 BASE 4L*10, 10L*2` using formatPack() helper (50→50ML, 1→1L etc.)
- middleware.ts updated: `/order`, `/api/order`, `/demo`, `/order-demo.html` all public. Static file matcher tightened to exclude extensions (.*\..*)
- next.config.mjs: rewrite `/demo` → `/order-demo.html`, Permissions-Policy changed `microphone=()` → `microphone=(self)`
- Prisma model `mo_order_form_index` added to schema.prisma between mo_learned_customers and import_shadow_log
- API route: `app/api/order/data/route.ts` — queries mo_order_form_index + joins mo_sku_lookup for packs. Returns `{ customers, products }`
- Bill card has 3 modes: `search` | `multi-select` | `picking`
- Multi-select: horizontal swipe pagination (6 per page), selected items pinned at top, selection persists across query edits, Set Quantities bar sticky at bill card level
- Single search result → skip checkbox, go straight to pack counters
- Picking mode: progress dots, Next → {product name} button, Skip button, Add All to Bill on last product
- Recently added lines highlighted teal during/after picking journey
- iOS zoom issue pending fix — inputs need font-size 16px audit + viewport meta maximum-scale=1

## NEW PENDING ITEMS

- Parser/enrichment compatibility review | me + Claude Code | need to share parser .ps1 and enrichment route files — BLOCKER before handing to SOs
- iOS zoom fix | Claude Code | viewport meta + 16px input audit on app/order/page.tsx
- App-like feel (Add to Home Screen) | Claude Code | apple-mobile-web-app-capable meta tags
- Scroll jump fix in bill card post line-add | Claude Code | minor UX polish
- focus-mode-view.tsx deletion | Claude Code | existing backlog item
- Update mo_order_form_index searchTokens if parser review reveals keyword gaps | me | after parser review
- Animate HTML demo (orbitoms-order-demo.html) needs voice — Eleven Labs script ready | me | optional enhancement
- Hand form to Sales Officers | depot team first, then SOs | after parser compatibility confirmed

## MOCKUPS / ARTEFACTS PRODUCED

- `docs/mockups/order-form-multi-sku-mockup.html` | Multi-SKU checkbox picker with pagination — approved design
- `public/order-demo.html` | Animated SO order form tutorial demo — live at orbitoms.in/demo

## PROMPTS DRAFTED FOR CLAUDE CODE

All saved to docs/prompts/drafts/:

- `web-update-2026-05-05-so-order-form.md` | Initial form build
- `web-update-2026-05-05-so-order-form-full-rebuild.md` | Full picker UI rebuild
- `web-update-2026-05-05-order-api-use-index.md` | Wire to mo_order_form_index
- `code-update-2026-05-05-mo-order-form-index-schema.md` | Prisma model
- `code-update-2026-05-05-basecolour-schema-api-fix.md` | baseColour + composite pack lookup
- `web-update-2026-05-05-remove-base-chips-flat-model.md` | Remove BASE chips
- `web-update-2026-05-05-v8-design-rebuild.md` | v8 layout — cart top, search visible, inline suggestions
- `web-update-2026-05-05-ux-fixes-pack-labels.md` | ML/L pack labels + numeric keyboard
- `web-update-2026-05-05-multi-sku-picker.md` | Multi-SKU select + picking flow
- `web-update-2026-05-06-multisku-pagination.md` | Horizontal swipe pagination
- `web-update-2026-05-06-multisku-swipe.md` | Swipe touch events + dot indicators
- `web-update-2026-05-05-host-order-demo.md` | Host demo at /demo

## CONSOLIDATION NOTES

- CLAUDE_CORE.md §4 (Schema) — add mo_order_form_index table spec (schema v27)
- CLAUDE_CORE.md §5 (All Screens) — add /order and /demo public pages
- CLAUDE_CORE.md §3 (Engineering Rules) — note PUBLIC_PATHS includes /order, /api/order, /demo, /order-demo.html
- CLAUDE_MAIL_ORDERS.md — add new §18: SO Order Form section covering: URL, mo_order_form_index architecture, email format, parser compatibility status, multi-SKU picker flow, deployment notes
- CLAUDE_UI.md — add order form to screens index, note 3-mode bill card (search/multi-select/picking)
