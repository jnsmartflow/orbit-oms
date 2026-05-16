# Context Update v1 — /place-order bucket-column variant grid + customer area dropdown
Session date: 2026-05-13
Target files: CLAUDE_CORE.md §7 (schema), CLAUDE_UI.md §51 (place-order layout), CLAUDE_MAIL_ORDERS.md (new sub-section for place-order pack buckets)

Companion drafts authored elsewhere this session — consolidator should merge in order:
1. `code-update-2026-05-13-ot-workflow-backend.md` (OT/overtime backend, attendance schema)
2. `code-update-2026-05-13-phase3-taxonomy-cutover.md` (product + uiGroup cutover)
3. `web-update-2026-05-13-place-order-grid-visibility-and-scroll.md` (Option B/3 visual fixes)
4. `web-update-2026-05-13-prisma-db-pull-fallback.md` (Supabase P1001 workflow)
5. **This draft** — bucket-column layout, cart UX, customer area

## SCHEMA CHANGES
None. All work in this draft is application-layer. Schema additions earlier in the session (OT tables + columns, taxonomy `product`/`uiGroup`) are documented in their respective companion drafts.

## NEW/MODIFIED FILES

| File | Purpose |
|---|---|
| `lib/place-order/pack-buckets.ts` (new) | Pack-bucket mapping table + helpers (`packToBucket`, `bucketColumnsForTab`, `bucketDisplayLabel`, `packNeedsHint`, `packHintLabel`); exports `RawPack` and `BucketColumn` types |
| `lib/place-order/pack.ts` | `formatPack(packCode, unit?)` extended — KG packs render as `"<n>KG"`; `packToMl/packToLitres` return 0 for KG/GM; new `packToKg`, `packKey`, `parsePackKey`; `sortPacks` handles composite keys |
| `lib/place-order/email.ts` | Email builder parses composite cart keys, formats with unit so KG SKUs emit real units (`WRP 5KG*4`) |
| `app/api/place-order/data/route.ts` | Selects `mo_sku_lookup_v2.unit`, `mo_order_form_index_v2.id`, `mo_customer_keywords.area`; packs returned as `Array<{packCode, unit}>`; customer dedupe rewritten as a Map with first-non-null area carry |
| `app/(place-order)/place-order/types.ts` | `Product` gains `id`, `product`, `uiGroup`, packs as `RawPack[]`; `CartLine` gains `productId?`, `product?`, `uiGroup?`; `Customer` gains `area?` |
| `app/(place-order)/place-order/place-order-page.tsx` | Cart identity by `productId` (with legacy `(subProduct,baseColour)` fallback); `setQty`/`qtyAt`/`handleRemovePack` take `RawPack`; composite cart keys with legacy bare-key fallback + auto-migration on write |
| `app/(place-order)/place-order/components/variant-grid.tsx` | Column header switched from packCode-derived to bucket-based; per-row × column cell picks canonical SKU; hint label below cell when real pack differs from bucket |
| `app/(place-order)/place-order/components/cart-panel.tsx` | Sections grouped by `(family, uiGroup ?? subProduct)`, header reads `"FAMILY · TAB"`; line label uses `baseColour ?? displayName ?? product ?? subProduct`; total line splits L vs KG |
| `app/(place-order)/place-order/components/customer-search.tsx` | Dropdown rows render `CODE · AREA` when area present (font-mono code, font-sans area, same muted line) |
| `app/(place-order)/place-order/components/active-product-panel.tsx`, `family-nav-with-tabs.tsx`, `sub-product-direct.tsx`, `section-landing.tsx` | Prop signatures updated (`qtyAt`/`onSetQty` take `RawPack`) |

## NEW API ENDPOINTS
None. `/api/place-order/data` is the only data route touched and only its SELECT + return shape changed.

## BUSINESS RULES ADDED

- **Pack buckets — fixed-column variant grid.** /place-order's variant grid renders a fixed-bucket column header: `50 ML · 100 ML · 200 ML · 500 ML · 1 L · 4 L · 10 L · 20 L · 25 KG · 30 KG · 40 KG`. Only buckets with at least one mapping SKU in the active tab are shown. KG ≤ 20 collapses into the nearest L bucket (5 KG → 4 L); KG > 20 lives in its own column. The mapping table is in `lib/place-order/pack-buckets.ts` — unknown pack/unit combos return `null` and trigger no column.
- **Cell hint label.** When a row's real SAP pack differs from its bucket, a small font-mono `text-[9px] text-gray-400` label sits under the qty input ("900ML" in a 1L column, "5KG" in a 4L column, "18L" in a 20L column). Non-interactive.
- **Cart-line identity by catalog id.** `CartLine.productId = Product.id` is the dedup key. `cartLineMatches(line, product)` uses productId when present, falls back to `(subProduct, baseColour)` for pre-Phase-3 localStorage drafts. Fixes a real bug for filled families where multiple catalog rows share `(subProduct, baseColour)` but differ in `product` (e.g. AQUATECH PREP crackfillers).
- **Composite cart keys with unit.** `CartLine.packQtys` keys are `"<packCode>|<unit>"`. Legacy bare `packCode` keys read via fallback in `qtyAt`; `setQty` deletes the legacy key on the same write to auto-migrate. Necessary so KG and L SKUs that share a packCode never collapse onto the same cart entry.
- **Email body uses real SAP unit.** `formatPack(packCode, unit?)` returns `"5KG"` / `"500GM"` for KG/GM packs and falls back to magnitude inference otherwise. Email body for a KG SKU now reads `WRP 5KG*4` (was previously mis-rendered as `5L*4`). Parser is unaffected — it only reads inbound mail, never outbound depot emails.
- **Cart total: L excludes KG; KG surfaced separately.** Totals line reads `N lines · X L` and appends `· Y KG` only when `totalKg > 0`. `packToLitres` and `packToMl` return 0 for KG; `packToKg` is the dedicated reader.
- **Cart line label fallback chain** (matches variant-grid row label): `baseColour ?? displayName ?? product ?? subProduct`. Filled families with `baseColour=null` (e.g. METAL PRIMER, AQUATECH PREP) now show their descriptive `displayName` instead of `"Plain"`.
- **Cart sections grouped by (family, tab).** Tab = `uiGroup ?? subProduct`. Section header reads `"FAMILY · TAB"`; when family equals tab the header collapses to just family. GLOSS COLOUR and WS MAX stay in separate sections even if tab names ever collide.
- **Customer area in /place-order dropdown.** Customer rows in the search dropdown render `CODE · AREA` in muted secondary text when `area` is present. API dedupe carries the first non-null area per customerCode so customers with a null area on their first keyword row still surface their locality if a later keyword row has it set.
- **React row key for variant-grid `<tr>`** now includes `product` (`"${subProduct}|||${baseColour ?? ""}|||${product ?? ""}"`) so filled families where multiple rows share `(subProduct, baseColour)` don't collide on the React key — non-unique keys produced stale-DOM reuse across tab switches.

## BUSINESS RULES CHANGED / SUPERSEDED

- **Variant grid column header.** Was: "every distinct packCode is its own column, sorted by ML". Now: fixed bucket columns from a master list, filtered to those with mapping SKUs. `CLAUDE_UI.md §51` "/place-order v5" no-scroll spec stays — the bucket layout layers on top.
- **`formatPack` signature.** Was `formatPack(pack: string)`. Now `formatPack(packCode: string, unit?: string | null)`. Legacy callers passing only packCode keep working (unit defaults to undefined → magnitude inference path).
- **`qtyAt` / `onSetQty` signatures.** Were `(subProduct, baseColour, pack)` / `(product, pack, qty)` with `pack: string`. Now both take `(product, pack: RawPack[, qty])`. Prop chain through `ActiveProductPanel` → `FamilyNavWithTabs`/`SubProductDirect`/`SectionLanding` → `VariantGrid` updated.
- **Cart `lineKey` semantics.** Was `(subProduct, baseColour)`. Now `id:<productId>` for new lines, legacy fallback retained for stored drafts. `handleRemovePack` takes `productId` as the first arg and parses the cart key string for `packCode`/`unit`.
- **Customer payload shape** from `/api/place-order/data`: was `{name, code}[]`. Now `{name, code, area: string | null}[]`. `Customer` type updated to match.

## BUSINESS RULES REMOVED / DEPRECATED
None. Legacy bare-key cart paths and legacy `(subProduct, baseColour)` cart-line matching both remain in place as fallbacks until pre-Phase-3 localStorage drafts age out organically.

## PENDING ITEMS

**New pendings raised this session:**
- ROOF COAT rows display `BRILLIANT WHITE / GREY / TERACOTTA` as the row label (baseColour wins per the chain). User to null those baseColours via SQL so `displayName="Aquatech Roof Coat (White)"` etc. surface as the label. Not a code change — flagged for a one-off SQL fix.
- Edge case: a single catalog row holding BOTH a 1 L and 900 ML SKU. Canonical pick is the exact match (1 L) and the 900 ML becomes inaccessible via the bucket layout. No catalog row currently has this collision; flagged for separate design if it appears.
- Bucket helper has a deliberate `15KG` gap — not yet in the mapping table per the original spec ("special — defer"). Add when a 15 KG SKU appears.
- `packStep` for KG packs defaults to 1 (single bag). If a future KG SKU ships in a multi-pack carton the map needs an entry.
- Search-by-area in the customer dropdown was scoped out of this session ("uiGroup-aware / area-aware search is a later task"). Filter still matches on name substring or code prefix only.
- Mobile `/order` route + its `/api/order/data` endpoint are still on the legacy `mo_order_form_index` + `mo_sku_lookup` v1 tables. /place-order's v2 cutover hasn't been backported. Deferred until v1 is decommissioned.

**Pendings from earlier in the session that are now done:**
- ✅ Phase 1 schema (product + uiGroup nullable on mo_order_form_index_v2) — committed `ef3a56fc`
- ✅ Phase 3 cutover (frontend + API + email read product/uiGroup with subProduct fallback) — committed `077e5cf6`
- ✅ +/- bug for filled families (cart-line collision on shared subProduct+baseColour) — fixed via productId identity, committed `077e5cf6`
- ✅ Bucket-column variant grid + KG unit threading — committed `077e5cf6`
- ✅ Cart UX (displayName labels, family·uiGroup grouping, KG total split) — committed `077e5cf6`
- ✅ Customer area in dropdown — committed `5ed0d216`

## CHECKLIST UPDATES
Add to CLAUDE_CORE.md §14 session-start checklist:

- /place-order's variant grid uses **fixed bucket columns** from `lib/place-order/pack-buckets.ts`. New pack/unit combinations not in the mapping table return `null` from `packToBucket` and render no column — extend the table, don't bypass it.
- /place-order's cart-line identity is **`Product.id`**, not `(subProduct, baseColour)`. Code paths that look up cart lines must use `cartLineMatches(line, product)` (with legacy fallback) — never a manual `subProduct+baseColour` compare.
- `formatPack` now takes an optional `unit` arg. **KG SKUs require unit** to render correctly; bare-packCode callers will silently produce `"5L"` for a 5 KG SKU.

## CONSOLIDATION NOTES

- **CLAUDE_UI.md §51** ("No-scroll page layout — /place-order v5") — extend with a sub-section on bucket-column layout: STANDARD_COLUMNS list, hint-label spec, cart-section header format `"FAMILY · TAB"`. The §51 "row stride ≈ 40px" still holds; hint rows add ~12px when present.
- **CLAUDE_MAIL_ORDERS.md** — needs a new sub-section "Place Order — pack buckets" covering the mapping table location, `formatPack(packCode, unit?)` rule, composite cart keys, and the KG-excluded total. Could live under existing /place-order content (~§19) or as its own.
- **CLAUDE_CORE.md §7** (schema) — no rule change needed for this draft; bucketing is application-only. Cross-reference the companion drafts for the schema additions.
- **CLAUDE_CORE.md §15** (cross-module pending items) — add the ROOF COAT baseColour SQL fix and the 15 KG bucket gap.
- ❓ Customer-search dropdown area display: rises to UI rule level since it changes how a high-traffic component reads. Consider noting under CLAUDE_UI.md or CLAUDE_MAIL_ORDERS.md customer-search spec.
- ❓ The `RawPack` type (`{packCode, unit}`) is now the canonical SAP-pack identity at the place-order layer. Worth a one-liner in CLAUDE_CORE so future modules don't reinvent `pack: string` shapes.
