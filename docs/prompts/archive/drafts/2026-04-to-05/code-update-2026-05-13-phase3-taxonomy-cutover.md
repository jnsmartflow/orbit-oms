# Claude Code prompt — Phase 3 taxonomy cutover (with subProduct fallback)

Read CLAUDE.md, docs/CLAUDE_CORE.md, docs/CLAUDE_UI.md, and
docs/CLAUDE_MAIL_ORDERS.md fully and silently before doing anything.

─── GOAL ────────────────────────────────────────────────────────────────────
Switch /place-order from reading `subProduct` to reading the new
`product` + `uiGroup` fields on mo_order_form_index_v2, with safe
fallback for families that haven't been migrated yet.

After this ships:
- Filled families (GLOSS, PRIMER, AQUATECH, WS, STAINER, SATIN) use the
  clean new data — email shows real product names, tabs use uiGroup
- Unfilled families fall back to subProduct as today — zero disruption

─── CRITICAL CONSTRAINTS ────────────────────────────────────────────────────
- DO NOT touch the database. No SQL, no migrations.
- DO NOT run `prisma db pull`, `prisma db push`, or `prisma migrate`.
- All TypeScript code must compile clean: `npx tsc --noEmit` zero errors at end.
- Sequential awaits only — no prisma.$transaction (per CLAUDE_CORE.md §3).
- All API routes must keep `export const dynamic = 'force-dynamic'`.
- DO NOT remove subProduct from any read path yet — only ADD fallback logic.
- DO NOT change displayName logic — operators rely on it as-is.
- DO NOT delete or deprecate any existing tests; update them if behaviour
  changes for filled families.

─── BACKGROUND CONTEXT ──────────────────────────────────────────────────────
On 2026-05-13 we added 2 nullable columns to mo_order_form_index_v2:
- product (real product name — for email body, parser, dispatch)
- uiGroup (tab label on /place-order — frontend only)

For 6 families we've also filled the columns and reverted the SKU
table's product field to real product names. Those families are:
GLOSS, PRIMER, AQUATECH, WS, STAINER, SATIN.

The remaining ~25 families still have product=NULL and uiGroup=NULL.
For those, mo_sku_lookup_v2.product still holds the bucket-style value
that matches mo_order_form_index_v2.subProduct.

So the fallback logic is:
- uiGroup ?? subProduct   (for tab grouping)
- product ?? subProduct   (for SKU join + email + display)

─── FILES TO READ FIRST (in this order) ─────────────────────────────────────

1. app/(mail-orders)/place-order/page.tsx
2. app/(mail-orders)/place-order/place-order-page.tsx
3. app/api/order/data/route.ts
4. Wherever the SKU-join logic lives (likely a lib helper)
5. The email builder / mailto composer (likely in place-order-page.tsx
   or a sibling file — search for "mailto:" or "Order — " in the codebase)
6. prisma/schema.prisma — confirm MoOrderFormIndexV2 has product + uiGroup
   already (Phase 1 added these on 2026-05-13)

After reading, summarise back to me in 6-8 lines:
- Where the API joins index to SKU today (file + key lines)
- Where the frontend groups cards into tabs today
- Where the mailto body is composed today
- Whether product + uiGroup are already present in the Prisma client

Do NOT write code yet. Wait for my "go" before any edits.

─── SCOPE OF WORK ───────────────────────────────────────────────────────────

### Change 1: API /api/order/data/route.ts
- Add `product` and `uiGroup` to the SELECT from mo_order_form_index_v2
- Update the SKU join to use `(c.product ?? c.subProduct)` as the match
  key against mo_sku_lookup_v2.product
- Keep `subProduct` and `family` in the SELECT (still used by callers)
- Return product + uiGroup in the API response payload

### Change 2: Frontend /place-order/place-order-page.tsx
- Group cards by `(row.uiGroup ?? row.subProduct)` instead of subProduct
- Use that same value as the tab label
- Inside each card, the displayName logic stays unchanged
- Search / speed-dial logic: no changes (still matches family + subProduct
  for now — uiGroup-aware search is a later task)

### Change 3: Email builder (mailto body)
- For each line in the order, render as:
  `(row.product ?? row.subProduct) + (baseColour ? ' ' + baseColour : '') + ' ' + packLabel + '*' + qty`
- Find every place the mailto body is constructed and apply the same rule
- Confirm the email opens correctly in the modal preview (shown in
  screenshot earlier — "Send order email" dialog)

### Change 4 (small): TypeScript types
- Wherever the MoOrderFormIndexV2 type is consumed, add product + uiGroup
  as optional fields (`string | null`)
- Resolve any type errors that surface from this

─── WHAT NOT TO DO ──────────────────────────────────────────────────────────
- Do not drop or rename the subProduct column or field anywhere
- Do not change the join logic for category vs family (already correct)
- Do not modify mo_product_keywords pipeline (parser still reads from
  legacy keys — separate session)
- Do not modify the tint module, dispatch module, or challan module
- Do not modify schema.prisma except if adding the optional fields
  requires a type-only adjustment (which it shouldn't — they were added
  in Phase 1)
- Do not touch displayName logic — it works
- Do not introduce prisma.$transaction batches
- Do not add new dependencies

─── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────

Local smoke test:
1. `npx tsc --noEmit` — zero errors
2. Run `npm run dev`, log in as Deepanshu (id=25)
3. Open /place-order, click GLOSS family
   - Tabs: BASE, COLOUR (from uiGroup)
   - Click BASE → cards appear with packs
   - Add 1 item to cart, open email modal
   - Email body should read: `GLOSS BRILLIANT WHITE 1L*1`
4. Click PRIMER family
   - Tabs: WOOD, METAL, CEMENT, ACRYLIC, ALKALI BLOC, PROMISE
   - METAL tab → cards: Red Oxide, Zinc Yellow, Epoxy, Quick Drying
   - Add Red Oxide 4L*4, open email modal
   - Email body should read: `RED OXIDE METAL PRIMER 4L*4`
5. Click LUXURIO family (NOT yet migrated)
   - Tabs and cards should look IDENTICAL to today (fallback active)
   - Email body should read as today (using subProduct)
6. Click VT GLO (not migrated)
   - Same — looks identical to today
7. Click SATIN family
   - Tabs: SATIN STAY BRIGHT (WB), SUPER SATIN (Oil)
   - Add Super Satin Brown 4L*4, email reads: `SUPER SATIN BROWN 4L*4`
8. Click STAINER family
   - Tabs: UNIVERSAL STAINER, MACHINE STAINER, ACOTONE, GVA / PU, HP
   - GVA / PU tab → add Red Oxide 1L*3, email reads: `GVA RED OXIDE 1L*3`
9. Click WS family
   - Tabs: MAX, PROTECT, DUSTPROOF, RAINPROOF, POWERFLEXX
   - Add Max Brilliant White 20L*2, email reads:
     `WS MAX BRILLIANT WHITE 20L*2`

If all 9 pass, commit and push to main.

─── COMMIT MESSAGE ──────────────────────────────────────────────────────────

feat(place-order): cutover to product + uiGroup with subProduct fallback

Switches /api/order/data, /place-order, and email builder to read the new
taxonomy columns (product, uiGroup) added in Phase 1 on 2026-05-13.

Filled families (GLOSS, PRIMER, AQUATECH, WS, STAINER, SATIN) now use the
clean new data — email shows real product names, tabs grouped by uiGroup.

Unfilled families fall back to subProduct so they keep working as today.
Fallback can be removed in Phase 4 after all families are filled and
subProduct column is dropped.

No schema changes. No DB writes. tsc --noEmit clean.

─── DO NOT WRITE CODE YET ───────────────────────────────────────────────────

First:
1. View the files in "FILES TO READ FIRST" order
2. Summarise back in 6-8 lines (per the spec above)
3. Flag any surprise — e.g. if the mailto body is built in more than one
   place, if displayName is consumed in unexpected ways, or if the SKU
   join logic looks different from what I described
4. Wait for my "go" before making any edits
