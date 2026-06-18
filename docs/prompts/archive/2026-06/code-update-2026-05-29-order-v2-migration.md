# Session Notes — Public /order migrated to v2 catalog
# Date: 2026-05-29 · Prefix: code- · Status: SHIPPED to main + production
# Target canonical files on consolidation: CLAUDE_PLACE_ORDER.md (primary), CLAUDE_CORE.md §13 (minor)

Commit (main): `feat(order): switch public /order to v2 catalog, searchable base + area, rename to Purchase Order`
Files changed: `app/order/page.tsx`, `app/api/order/data/route.ts` (2 files only).
Verified on real device at orbitoms.in/order.

---

## 1. What shipped

The public mobile `/order` page now runs natively on the **v2 catalog**
(`mo_order_form_index_v2` + `mo_sku_lookup_v2`) — the same data as desktop
`/place-order`. Previously it read the legacy `mo_order_form_index` /
`mo_sku_lookup`.

- **`/api/order/data` rewritten** to query `mo_order_form_index_v2` (active) +
  `mo_sku_lookup_v2` + `mo_customer_keywords`. Returns the same v2 product shape
  as `/api/place-order/data`: `id, family, section, subgroup, subProduct, product,
  uiGroup, baseColour, displayName, searchTokens, tinterType, productType,
  packs[RawPack {packCode, unit}]`. Customers: `{ name, code, area }`.
  - Route stays **public** (`/api/order` whitelist unchanged in middleware).
  - Query was **replicated** from the desktop route, not extracted into a shared
    helper (zero-risk choice to avoid touching desktop). A shared
    `lib/place-order/` payload builder can be lifted later — see Deferred.
- **`productLabel(p)` helper** added in `app/order/page.tsx`: returns
  `displayName` plus `" — " + baseColour` when baseColour is set and not already
  in displayName. Restores the legacy "Name — Base" convention
  (e.g. "WS Max — 90 BASE"). Used at every product-name render site (search rows,
  selected product, cart line, picker header).
- **Search widened** so base/colour is searchable. Per-row haystack is now
  `` `${searchTokens ?? ""} ${productLabel(p)}`.toLowerCase() ``. Every-query-word
  must be a substring (AND), result cap 50. Rule: *what you see on the row is what
  you can type to find*. Fixes "MAX 95" / "GLOSS PH" / "GOL Y" returning nothing.
- **Cart identity keyed by v2 row `id`** (was the `subProduct + baseColour`
  composite). v2 rows can legitimately share (subProduct, baseColour) but differ
  by id; the old key collapsed two products into one cart line. Same fix desktop
  already had via productId.
- **Pack handling** updated for v2 `RawPack {packCode, unit}`. `formatPack` /
  `packToMl` / `packStep` now imported from `@/lib/place-order/pack` (in-page
  copies deleted). `sortPacksForDisplay` operates on RawPack[], KG anchored last.
  Renders L / ML / KG / GM correctly (25 KG no longer mislabelled "25L").
- **Customer area shown** in Bill To search rows AND Ship To search rows
  (`{c.area && <span> · {c.area}</span>}` suffix, gray, matching the desktop
  component). 638/638 customers carry a non-null area. Area was already in the
  payload — display-only change.
- **Heading renamed** "Place Order" → "Purchase Order" on `/order`
  (branding-state header + document title). Route `/order` and DB
  `pageKey = 'place_order'` UNCHANGED — visible text only.
- Email body: layout byte-identical; product line now sources from
  `l.product ?? l.subProduct` + baseColour (v2 names). Parser untouched (out of
  scope this session — owner accepts ~90% v2-name match for now).
- All `/order` mobile UX preserved (UI §47/§15): 3-state header, `--vvh` keyboard
  fix, no auto-keyboard on Set Quantities, dashed zero-qty cue, skip/next picker.

---

## 2. Corrections to CLAUDE_PLACE_ORDER.md (the docs were stale/contradictory)

- **§15 / §16** previously claimed `/order` already shared the v2-backed
  `/api/order/data`. That was FALSE at the time — but it is now TRUE as of this
  commit. Update the wording to state plainly: `/order` hits `/api/order/data`,
  which reads the v2 tables.
- **§17 files map** lists the desktop route group as
  `app/(billing-operator)/place-order/`. WRONG. The real group is
  `app/(place-order)/place-order/`. The desktop data route is
  `app/api/place-order/data/route.ts`. Fix the drift.
- **§18 landmine** "Public `/order` route still uses LEGACY `mo_order_form_index`"
  is now OUTDATED — delete it. Replace with the new landmine below.

---

## 3. New landmines to add (CLAUDE_PLACE_ORDER.md §18 and/or CORE §13)

- **Legacy `mo_order_form_index` + `mo_sku_lookup` are now ORPHANED by `/order`.**
  Nothing on `/order` (or `/place-order`) reads them anymore — both order-entry
  surfaces are on v2. BUT the **mail parser + enrichment still read the legacy
  tables**. Do NOT delete the legacy tables until the parser is migrated to v2.
- **`/api/order/data` and `/api/place-order/data` both build the v2 payload but
  via duplicated queries** (no shared helper yet). If you edit the v2 payload
  shape, edit BOTH or extract a shared builder. Keep desktop output identical if
  extracting.
- **v2 `baseColour` is sometimes a non-colour token** (e.g. "ROX", "93 BASE CLR",
  numbered "90 BASE"). `/order` shows it as-is after "— ". Acceptable; not a bug.

---

## 4. Deferred / parked (NOT done this session)

- **DATA ISSUE — duplicate litre packs in `mo_sku_lookup_v2`.** The same logical
  pack is stored under two unit spellings ("L" and "LT" / "LTR"), so the pack
  picker shows each litre size twice (1L, 4L, 10L, 20L all doubled). Cause is the
  data/source (likely SAP import), not the UI. Fix decision pending a dedicated
  data-analysis session: either (a) clean the table after confirming the "LT" rows
  are not distinct SAP materials needed by SKU lookup / order punching, or
  (b) display-layer dedup by normalised label. See the next-session kickoff prompt.
- **Shared v2 payload helper** — extract `lib/place-order/` builder used by both
  `/api/order/data` and `/api/place-order/data` (currently replicated).
- **Promise cross-listing** — same product appears under family `PROMISE` and
  `PROMISE ENAMEL`; surfaces as a near-duplicate in flat mobile search (family
  chip distinguishes). Intentional per §18. Left as-is; collapse only if asked.
- **Parser / enrichment migration to v2** — owner to handle separately; required
  before legacy tables can be dropped.
- **Working-tree housekeeping** — pre-existing uncommitted clutter (6 markdown
  drafts in `docs/prompts/drafts/`, loose SQL/scripts, `db/` folder, sampling
  xlsx). Tidy in a future session.

---

*Draft for consolidation into CLAUDE_PLACE_ORDER.md (bump to v1.2). Move to
docs/archive/drafts/ after consolidation.*
