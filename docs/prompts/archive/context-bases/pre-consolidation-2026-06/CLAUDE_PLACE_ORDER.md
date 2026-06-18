# CLAUDE_PLACE_ORDER.md — Place Order Module
# v1.2 · Schema v27.5
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Depot-facing phone-order entry (desktop) + public mobile equivalent. Both surfaces output a `mailto:surat.order@outlook.com` link with the order body — same email path back to the mail order pipeline. No DB writes on submit.

Routes:
- **`/place-order`** — desktop, auth'd. Sidebar nav label: "Purchase Order (PO)".
- **`/order`** — public mobile, no login. Sales Officers and ad-hoc mobile users. **~99% of orders come through here.**

DB `pageKey` stays `place_order`.

Primary users: admin, billing_operator, tint_manager. Restricted-view users: support, dispatcher (`/place-order` is their only authorised page until real dispatch/support screens go live).

---

## 1. What this page is

Operator types a phone order quickly while a dealer is on the line. Output is a `mailto:` link — byte-identical between desktop and mobile. The email lands back in OrbitOMS and is parsed by `Parse-MailOrders-v6_5.ps1`.

Keep the page fast — no scroll, no nested popovers, keyboard-first on desktop, thumb-first on mobile.

---

## 2. Database — v2 tables

Both surfaces read the v2 catalog: `mo_order_form_index_v2` (menu) + `mo_sku_lookup_v2` (stock).

**`/order` switched to v2 on 2026-05-29.** Before that it read the legacy `mo_order_form_index` / `mo_sku_lookup`. Both legacy tables are now ORPHANED by both order-entry surfaces but are STILL read by the mail parser + enrichment — do NOT delete them until the parser is migrated (Stage 3 of the v2 single-source plan, §19).

### mo_order_form_index_v2 (~405 active rows post-WS-Protect restructure)

```
id              SERIAL PK
family          TEXT — e.g. "GLOSS", "PROMISE ENAMEL", "WS"
product         TEXT — SAP-clean stock name, the JOIN KEY into mo_sku_lookup_v2.product.
                       May be null on rows the seed couldn't resolve;
                       those rows render with NO PACK BUTTONS.
baseColour      TEXT — variant name (Path A repurpose; sometimes a non-colour token)
displayName     TEXT — UI display label
searchTokens    TEXT — space-separated tokens for the search box
tinterType      TEXT — TINTER | ACOTONE | null
productType     TEXT — Emulsion | Enamel | Stainer | Primer | Putty | etc.
sortOrder       INT  — drives tab order within a family
isActive        BOOLEAN
section         TEXT — UTILITY, INTERIORS, EXTERIORS, ENAMELS, WOODCARE, MULTI-USE
subgroup        TEXT — within-section subgroup label
uiGroup         TEXT? — desktop tab label (e.g. "Max", "Protect Dustproof")
mobileFamily    TEXT? — v27.5. Collapses Promise-family variants for mobile labelling.
                        Declared + populated but NOT currently used as the label
                        (mobile labels by `family`). Ready if a single-PROMISE label
                        is ever wanted.

UNIQUE (family, product, baseColour)
```

### mo_sku_lookup_v2 (~1,625 rows post-restructure)

```
material        TEXT UNIQUE — SAP material code (the join key the parser will eventually use)
product         TEXT — SAP-clean stock name (joins to mo_order_form_index_v2.product)
baseColour      TEXT
packCode        PackCode  — enum
unit            TEXT — "L" | "ML" | "KG" | "GM" | "PC"
description     TEXT — full product description
category        TEXT
isPrimary       BOOLEAN NOT NULL DEFAULT true  — v27.5. False on confirmed duplicate twins
                                                  (130 rows). /api/order/data filters
                                                  WHERE isPrimary = true. Desktop
                                                  /api/place-order/data currently
                                                  unfiltered (out of scope for this cut).
```

Index: `material UNIQUE`. Used by the catalog payload routes.

### Sections

Six top-level sections, in this order: **UTILITY · INTERIORS · EXTERIORS · ENAMELS · WOODCARE · MULTI-USE**.

UTILITY first. FLOOR PLUS and SMOOTHOVER are under EXTERIORS (moved from UTILITY on 2026-05-08 rebalance).

Family→section + family→subgroup mapping lives in the seed (`scripts/v2-catalog-seed-from-preview.ts`). When introducing a NEW family, you MUST add it to `FAMILY_TO_SECTION` and `FAMILY_TO_SUBGROUP` or the seed will crash mid-insert (the dry-run does NOT catch this; insert fails on the live DB).

---

## 3. Roles + permissions

| Role | Access |
|---|---|
| admin | Full access. |
| billing_operator | Full access. |
| tint_manager | Full access. |
| support | `place_order` only. `role_permissions.canView = true` for `pageKey='place_order'`, all others `false`. |
| dispatcher | `place_order` only. Same restriction as support. |

`role_permissions` reset SQL for support/dispatcher:
```sql
UPDATE role_permissions
SET "canView" = false, "canImport" = false, "canExport" = false, "canEdit" = false, "canDelete" = false
WHERE "roleSlug" IN ('support', 'dispatcher')
  AND "pageKey" <> 'place_order';

INSERT INTO role_permissions ("roleSlug", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
VALUES
  ('support', 'place_order', true, false, false, true, false),
  ('dispatcher', 'place_order', true, false, false, true, false)
ON CONFLICT ("roleSlug", "pageKey") DO UPDATE
SET "canView" = EXCLUDED."canView", "canEdit" = EXCLUDED."canEdit";
```

Login redirect (`lib/rbac.ts`): support → `/place-order`. dispatcher → `/place-order`.

---

## 4. Mobile login (10-digit phone)

NextAuth credentials provider accepts email OR 10-digit phone. Login page label: **"Email or Mobile Number"**. Input `type="text"` (not `email`). `autoComplete="username"`.

Routing logic: `if (/^\d{10}$/.test(identifier)) lookup by phone else lookup by email`. Strict — no `+91`, dashes, spaces.

Schema: `users.phone TEXT` with `CHECK (phone IS NULL OR phone ~ '^[0-9]{10}$')` and partial unique index `WHERE phone IS NOT NULL`. Field `id`/`name` stays `email` (auth contract).

---

## 5. Desktop layout — /place-order

Sticky 52px top bar. Below: content + 340px right cart column. No vertical scroll anywhere on the page (`h-screen overflow-hidden flex flex-col`).

Visual spec: `CLAUDE_UI.md §41-46`.

Viewport guard: `< 1024px` width redirects to `/order` mobile page on mount AND on `resize`.

---

## 6. Speed dial (9-tile fixed grid)

Operator-curated. Tiles in order: GLOSS · SATIN · PROMISE ENAMEL · WS · VT GLO · WOODCARE · STAINER · PRIMER · AQUATECH.

Config: `lib/place-order/quick-tiles-config.ts`. Each tile: `{ position, type: "family", label, parentLabel, familyName }`.

Two render modes:
- **Browse mode** (`activeState.kind === "idle"`): full 9-tile grid
- **Work mode** (sub-product active): compact horizontal pill strip (~40px tall)

Digit shortcuts 1-9 always trigger their tile. No Tab cycle.

**Important:** if a speed-dial tile points at a family that doesn't exist in the data (e.g. WS tile when WS family was flattened), the card renders empty. This was the root cause of the May-13 WS card outage; recovery required baking the grouping back into the seed.

---

## 7. Variant grid card

Sub-product tabs (top) → pack header row → base × pack matrix.

**Tab list and order come from menu rows + `sortOrder`** (NOT from a `WITHIN_SECTION_ORDER` constant — that file does not exist; an earlier doc reference was stale).

**Tab label** = `uiGroup ?? subProduct` in `family-nav-with-tabs.tsx`. Tabs let TM/operator switch between sub-products inside one family (e.g. WS → Max / Powerflexx / Protect Dustproof / Protect Rainproof).

**Family card selection:** speed-dial tile maps to `family === tile.familyName`. So grouping is data-only — no rendering code change needed to reshape a family. Tiles missing a matching family → empty card.

**Pack header:** single-line, 10.5px. Format `{pack} · {containerLabel}`. Container label mono gray-400.

**Pack columns:** explicit 80px width via `style={{ width: "80px" }}` on each `<col>` in colgroup. `table-layout: fixed`.

**Pagination:** `VARIANT_GRID_PAGE_SIZE = 15`, `VARIANT_GRID_PAGINATION_THRESHOLD = 17`. Sub-products with `bases.length > 17` paginate at 15 per page. Page dots in card header for mouse. `Shift+PageDown`/`Shift+PageUp` for keyboard. Unshifted `PageDown`/`PageUp` cycle sub-products within family.

**Cell sizing:** 56×32px, font 13px (fixed pixels).

---

## 8. Pack join mechanism

`/order` and `/place-order` both resolve packs the same way:

```
join key = (form_index.product ?? form_index.subProduct) + "|||" + form_index.baseColour
match    = mo_sku_lookup_v2 row where row.product === join-key segment 1
                                 AND row.baseColour === join-key segment 2
                                 AND row.isPrimary === true (mobile only today)
```

`product` must be filled with the **SAP-clean stock name** for this to work. When `product` is null, the join falls back to `subProduct` (a UI name) which usually diverges from stock → row renders with no pack buttons.

Phase 1 (2026-05-31) of the v2 single-source plan filled `product` on 92 broken rows using:
- 7 confirmed family→stock-name locks (MAX→WS MAX, POWERFLEXX→WS POWERFLEXX, RAINPROOF→WS PROTECT RAINPROOF, PROTECT→WS PROTECT, PROTECT DUSTPROOF→WS PROTECT DUSTPROOF, PU STAINER→GVA, MACHINE TINTER→MACHINE STAINER)
- 17 high-confidence auto-matches (inlined as `HIGH_PRODUCT_MAP` in the seed)

~13 oddball rows + 8 mapped-but-unstocked rows still pending (§19 Stage 1 touch-ups).

---

## 9. Variant cell — semantics

Cell stores **UNITS** in `cart.packQtys[pack]`. Typing digits writes units directly.

### Keyboard inside cell

| Key | Action |
|---|---|
| 0-9 | Write units (replaces value) |
| `+` or `=` | `qty + boxSize` (one box up) |
| `-` or `_` | `Math.max(0, qty - boxSize)` (one box down) |
| Arrow keys | Move between cells |
| Tab | Next cell |
| Enter | Confirm + move to next |
| Esc | Blur |
| PageUp/PageDown | Cycle sub-product within family |
| Shift+PageUp/Down | Page within base list |

All four shortcut keys (`+`, `=`, `-`, `_`) call `e.preventDefault()` to suppress native browser behaviour.

### Hover/focus +/− buttons

2 absolute `<button>` elements inside wrapper. Width 16px, height 14px. `+` top-right, `−` bottom-right. Style: `text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-[2px] text-[11px] leading-none`. Visibility: `opacity-0` default → `opacity-100` on `group-hover` OR `[.group:focus-within_&]`. `tabIndex={-1}` + `onMouseDown={e.preventDefault()}` to keep focus on input.

### Empty vs NA cells

Distinguishable visually. NA cells have different bg + `cursor: not-allowed`.

### Pack step map

`PACK_STEP_MAP` in `lib/place-order/pack.ts`. Examples:
- 1L → step 12 (box of 12)
- 4L → step 6 (box of 6)
- 10L → **step 1** (drum, NOT box of 2 — drums ship as singles)
- 20L → step 4 (box of 4) for putty bags, etc.
- 200ML → step 12

Helper `packContainerLabel(pack)` returns `"box 12" | "box 6" | "box 4" | "drum" | "bag" | null`.

`formatPack`, `packToMl`, `packStep`, `sortPacksForDisplay` are all in `lib/place-order/pack.ts`. The mobile `/order` page imports from there too (in-page copies removed in the 2026-05-29 v2 migration).

---

## 10. Cart panel (340px right)

Card list grouped by product/base. Pack chips per line.

### Chip format

```
×{units}           — primary: text-gray-700 font-mono font-semibold
· {N} box          — secondary (conditional): text-gray-400 font-normal ml-1
```

Conditional rule: `step > 1 && units > 0 && units % step === 0`.

Examples:
- `×12 · 1 box`
- `×13` (non-clean multiple)
- `×24 · 2 box`
- `×5` (10L drum, step=1, no suffix)

### Volume total formula

```
volume = sum across lines of: units * packToLitres(pack)
```

DO NOT multiply by `packStep` (would double-count under unit semantics).

### Recently used panel

Shown only in browse mode (`activeState.kind === "idle"`). Driven by `touchedAt?: number` on `CartLine`, set to `Date.now()` on every `setQty` path.

### Cart identity

Cart lines keyed by **v2 row `id`** (was `subProduct + baseColour` composite). v2 rows can legitimately share (subProduct, baseColour) but differ by id; the old key collapsed two products into one cart line. Same fix that desktop already had via productId.

---

## 11. Email builder

Plain text output, byte-identical between desktop and mobile:

```
Customer: {customerName} ({customerCode})

{productLine}
  4L ×6
  10L ×2
  20L ×1
{productLine}
  ...
```

Builder is a pure no-op pass-through on units — `cartToMailtoBody(cart)` writes units directly (no box conversion).

Send button opens `mailto:surat.order@outlook.com?subject=...&body=...` (URL-encoded). No POST, no DB row.

**Product line sources** from `l.product ?? l.subProduct` + baseColour (v2 names). Parser owner accepts ~90% v2-name match for now — full parser cutover is Stage 3 of the v2 single-source plan (§19).

**Email body is RAW.** Display aliases (§13) are NEVER inserted into the email. The mail parser sees `WS MAX 94 BASE`, not `WS Max · Accent`.

---

## 12. Base-name aliases (display + search)

**Module:** `lib/place-order/base-aliases.ts` — single source of truth.

```ts
export type BaseAlias = { display: string; search: string[] };
// keyed: product (SAP-clean name, e.g. "WS MAX") -> baseColour ("90 BASE") -> BaseAlias
export const BASE_ALIASES: Record<string, Record<string, BaseAlias>> = { ... };
export function getBaseAliasDisplay(product, baseColour): string | null;
```

Lives under `lib/` (no React) so it is importable by BOTH the frontend (display) AND the seed script (search words).

### Current coverage

WS MAX + WS PROTECT DUSTPROOF + WS PROTECT RAINPROOF + WS POWERFLEXX:

| Base | Display alias | Search words |
|------|---------------|--------------|
| 90 BASE | White | white, white base |
| 92 BASE | Intermediate | intermediate, intermediate base |
| 94 BASE | Accent | accent, accent base |
| 95 BASE | Deep | deep, deep base |
| 96 BASE | YOX | yox, yellow oxide, yellow oxide base |
| 97 BASE | ROX | rox, red oxide, red oxide base |
| 98 BASE | Vibrant Yellow | vibrant yellow, vibrant yellow base |
| 99 BASE | Vibrant Red (Dustproof/Rainproof/Powerflexx only) | vibrant red |
| 93 BASE | *(none)* | *(none)* |
| BRILLIANT WHITE | *(none)* | *(none)* |

### Display

A muted `· {display}` span (`text-gray-400 font-normal`) rendered AFTER the base, only when `getBaseAliasDisplay` is non-null. NEVER concatenated into `productLabel`'s string (the mobile search haystack depends on `productLabel` staying clean).

| Screen | File |
|--------|------|
| Mobile search results, picker header, cart lines, selected list | `app/order/page.tsx` (via `aliasSuffix` helper) |
| Desktop search results | `big-search-bar.tsx` |
| Desktop variant-grid base column | `variant-grid.tsx` |
| Desktop cart line | `cart-panel.tsx` |

### Search

**Mobile** haystack already includes `searchTokens`, so baking alias words into `searchTokens` makes them findable.

**Desktop** search (`searchProducts` in `lib/place-order/queries.ts`) was extended to also read `searchTokens` for ALL products (not just WS Max). This is an intended broadening. If a future product's desktop search starts matching too loosely, this haystack is the lever.

**Seed step 7.8** (`scripts/v2-catalog-seed-from-preview.ts`): imports `BASE_ALIASES`, appends each product+base's `.search` words to that row's `searchTokens` via `mergeSearchTokens` (case-insensitive dedupe, existing tokens kept). Gated on `product in BASE_ALIASES` so each new product opts in explicitly.

### Adding a new product

1. Add the product's block to `BASE_ALIASES` in `base-aliases.ts` (display + search words).
2. Display works automatically (frontend reads the map) — deploys on push.
3. Add the product to the seed's step-7.8 condition (or generalise to "any product in `BASE_ALIASES`").
4. DRY_RUN menu rehearse → menu reseed → verify the new rows' `searchTokens`.
5. Email stays raw `baseColour` — never touch.

---

## 13. Search ranking

**Module:** `lib/place-order/mobile-search.ts` (NEW 2026-06-01). Exports `rankProductsForQuery`.

Same AND-substring filter as before (so result SETS unchanged), PLUS scoring:

| Match type | Weight |
|---|---|
| Prefix on a search token | 100 |
| Word-boundary inside a token | 20 |
| Inner substring | 5 |
| Multi-token base bonus | +50 (added when 2+ query tokens both match) |
| Sub-product-prefix boost | configured per-tiebreak |
| Token-start signal | small bump |
| Stable secondary sort | catalog index |

Mobile `getProductSuggestions` (in `app/order/page.tsx`) AND desktop `searchProducts` (`queries.ts`) both use the scoring.

**Live behaviour:**
- `protect` → Dustproof first, then Rainproof, then Damp Protect (DP/RP tokens *start* with "protect" = high; "Damp Protect" has it mid-name = lower)
- `rainproof` / `protect rainproof` → Rainproof first, then Dustproof (sub-product-prefix boost keeps Rainproof on top despite weak `RAINPROOF` token on Dustproof)
- `ws` → all WS, Dustproof boosted first

**Mobile search haystack** per row: `` `${searchTokens ?? ""} ${productLabel(p)}`.toLowerCase() ``. Every query word must be a substring (AND). Result cap 50.

**Rule:** what you see on the row is what you can type to find. If a product looks like "WS Max — Accent" the search should accept "accent". Bake any new alias into `searchTokens` via the seed.

---

## 14. CSV-as-source SKU seed (per-product rollout pattern)

For per-product SKU revisions, the **reviewer CSV is the single editable source**. Started 2026-06-01 with WS Protect Dustproof / Rainproof / Powerflexx.

CSVs live at `docs/SKU/review/{product}-review.csv`. Each row marked **KEEP** or **HIDE**.

Script: `scripts/v2-sku-seed-from-legacy.ts`. Reads the CSVs each reseed, layered on the legacy→v2 translation.

### Converter rules

- **Key on `material`** (unique). `baseColour / packCode / unit / description / category` come from legacy (authoritative). Auto-collapses multi-base collision listings and makes CSV base typos (e.g. "Brillant White") irrelevant.
- **isPrimary** = `true` if the material is marked KEEP anywhere in its CSV, else `false`.
- **Build-from-CSV** for KEEP materials with no legacy source: row constructed from CSV fields (packCode/unit/category copied from a same-product/same-pack sibling). HIDE-no-legacy materials stay absent.
- Touches only the target products (+ explicit exclusions). All other products untouched.

### Next-product loop

1. Reviewer marks the product's CSV (KEEP/HIDE).
2. Diagnose CSV vs live (deltas, collisions, missing-from-legacy, leftovers).
3. Build via the converter → DRY_RUN rehearse → reseed SKU.
4. Menu: rename/add rows so the menu covers all primary stock bases → reseed menu.
5. Add `BASE_ALIASES` entries (display + search) → reseed menu.
6. Commit AND `git push origin main` → verify live.

### Menu must cover stock

Every primary stock base needs a menu row, or stock rows render nowhere. Discovered during WS Protect Dustproof restructure when Dustproof had missing bases (90, 96, Brilliant White, 99, 93, 5 colour rows) and the cells were blank. Now part of the per-product checklist.

---

## 15. Public mobile route — /order

Public, no login. Whitelisted in middleware. Same `/api/order/data` payload as desktop (now v2-backed).

Path: **`app/order/page.tsx`** (NOT under `app/(public)/`). Whitelist in middleware, not in a route group.

### 15.1 Unified sticky header — 3 states

Single edge-to-edge header element that swaps content based on state. See `CLAUDE_UI.md §47`.

| State | Trigger | Content |
|---|---|---|
| 1 — Branding | `selectedCust === null` | `[logo] Purchase Order / JSW Dulux · Surat Depot` |
| 2 — Customer locked, browsing | `selectedCust && !anyBillInPicking` | `{customerName}` (16px semibold) / `{customerCode}` (12px gray) / `Change` button |
| 3 — Customer locked, picking | `selectedCust && anyBillInPicking` | Row A: `{customerName}` · `N of M` · Row B: `{productName}` (17px semibold, with `border-b border-gray-200`) · Row C: `[Skip ghost] [Next →]` |

Header is `sticky top-0 z-30`, `bg-white border-b border-gray-200`, edge-to-edge (no margin, no rounded corners).

Page heading text is **"Purchase Order"** (renamed from "Place Order" 2026-05-29). Route `/order` and DB `pageKey = 'place_order'` UNCHANGED — visible text only.

**Key rule:** once a customer is locked, the page header disappears. The customer header IS the page identity from that point.

### 15.2 Visual Viewport keyboard fix

`<main>` has `style={{ height: "var(--vvh, 100vh)" }}` + `overflow-y-auto`. Mount-effect listens to `window.visualViewport.resize/scroll` and writes the visible height to `--vvh` via `documentElement.style.setProperty` (NOT React state — would cause render storm).

`app/globals.css` fallback: `html { --vvh: 100vh; }` so it's never unset before JS runs.

`app/layout.tsx` Viewport export uses Next.js 14.2.29 typed `Viewport`:
```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: "resizes-content",
};
```

Rules:
- Write `--vvh` directly to DOM, not React state
- No rate-limiting needed (iOS URL-bar collapse fires resize too — cosmetic only)
- `overflow-y-auto` on `<main>` so scrolling happens inside `<main>` (keyboard-aware), not document body
- Don't pin search input with sticky/fixed — creates a second scroll surface
- Pick ONE viewport mechanism — typed export OR raw `<meta>` — never both

### 15.3 Empty-state row

Synchronous in-memory filter. Render gate uses `inMultiSel && bill.searchQuery.trim().length >= 2`. Zero-match queries render italic `"No products match {query}"` row instead of nothing.

Mode flip logic: flip to `multi-select` whenever `query.trim().length >= 2`, regardless of match count.

User input escaped via React text nodes — never `dangerouslySetInnerHTML`.

### 15.4 Other mobile patterns

- Qty input: `text-[16px]` (iOS auto-zoom prevention).
- Mode-transition auto-focus to first qty input is **desktop-only**: `window.matchMedia("(min-width: 768px)").matches`. Mobile users get a calm Set Quantities screen with no keyboard. They tap +/− or tap the qty number to bring up keyboard on demand.
- Pack row has `data-pack-row` attribute + `scroll-mt-[140px]` for picker-entry auto-scroll target.
- Picker Skip button: ghost (`text-gray-500 text-[13px] font-medium`, no bg). Next button: primary teal/green.
- Single-pack products: `py-[18px]` + `text-[16px]` label (vs default `py-[10px]` + `text-[14px]`).
- Qty input: `border-b border-dashed border-gray-300` when value is 0. Dashed underline disappears when user enters a value. Subtle "tap to type" cue.
- Bill summary chip: `BILL N · X products · Y units` when cart non-empty.
- Auto-scroll on picker entry/advance: useEffect inside BillCard listens to `bill.mode === "picking" && bill.activeProduct?.id` changes. Calls `target.scrollIntoView({ block: "start", behavior: "smooth" })`. NO focus call.
- Customer search rows show area: `{c.area && <span> · {c.area}</span>}` (gray suffix). Both Bill To and Ship To. 638/638 customers carry non-null area.

### 15.5 Mobile UX rules (lessons banked)

1. **Header collapses when customer locked.** Header chrome is only useful as page identity for first-time visitors.
2. **No keyboard auto-open on Set Quantities (mobile).** Forcing keyboard up breaks the "tap to interact" promise.
3. **Auto-scroll on picker entry/advance is scroll-only, not focus.** Avoids iOS scrollIntoView + keyboard race.
4. **Sticky bar lives at page level (inside `<header>`), not inside cards.** Pinning to card top fails when card scrolls off-screen.
5. **Edge-to-edge header, no rounded corners.** Rounded = content tiles. Edge-to-edge = app chrome.
6. **Skip button is intentionally low-visual-weight.** Used <5% of the time. Next is primary action.
7. **Dashed underline only on zero qty.** Subtle "tap to type" affordance that disappears once filled.

---

## 16. API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/place-order/quick-tiles` | Returns 9-tile config + counts (desktop) |
| GET | `/api/order/data` | Returns hydrated v2 form index + SKU lookup (used by `/order` mobile). Public. Filters `isPrimary = true` on SKU lookup. |
| GET | `/api/place-order/data` | Returns same shape (used by `/place-order` desktop). Session-auth'd. Currently unfiltered on `isPrimary` (out of scope for this cut). |
| POST | `/api/place-order/last-order` | Returns last order normalised to units for given customerCode |

All routes: `export const dynamic = 'force-dynamic'`.

**Duplicated payload queries:** `/api/order/data` and `/api/place-order/data` both build the v2 payload via duplicated queries. No shared helper yet. If you edit the v2 payload shape, edit BOTH or extract a shared builder. CORE §13 landmine.

---

## 17. Files map

```
app/(place-order)/place-order/
  page.tsx                          force-dynamic, hydrates from /api/place-order/data
  place-order-page.tsx              client root
  speed-dial.tsx                    9-tile grid + pill strip
  variant-grid.tsx                  base × pack matrix
  variant-cell.tsx                  cell with hover/focus +/− buttons
  cart-panel.tsx                    340px right column
  recently-used.tsx                 browse-mode only panel
  customer-search.tsx               pill + dropdown
  family-nav-with-tabs.tsx          tabs + uiGroup rendering
  big-search-bar.tsx                desktop search results
  send-button.tsx                   builds mailto

app/order/
  page.tsx                          public mobile route (single-file)

lib/place-order/
  constants.ts
  quick-tiles-config.ts             9-tile operator-curated config
  pack.ts                           PACK_STEP_MAP, packToLitres, packContainerLabel,
                                    formatPack, packToMl, sortPacksForDisplay
  cart.ts                           CartLine type, setQty, volume reducer, touchedAt
  draft.ts                          localStorage hydrate/save, TTL
  email.ts                          cartToMailtoBody (pure pass-through)
  search.ts                         legacy multi-token scoring (still used in places)
  queries.ts                        searchProducts (desktop) — now reads searchTokens
  base-aliases.ts                   v27.5. Single source for display + search aliases
  mobile-search.ts                  v27.5. rankProductsForQuery scoring

api/place-order/quick-tiles/route.ts
api/place-order/data/route.ts       desktop catalog payload
api/place-order/last-order/route.ts
api/order/data/route.ts             public mobile catalog payload — reads v2, isPrimary filter

scripts/
  v2-catalog-seed-from-preview.ts   menu reseed (wipe-and-reseed from taxonomy-preview.json)
  v2-sku-seed-from-legacy.ts        SKU reseed using CSV-as-source converter
  Reviewer CSVs in docs/SKU/review/
```

`taxonomy-preview.json` location: `docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json`. The seed reads from this path — moving it breaks the seed.

---

## 18. Backups + seed-is-source-of-truth rule

**Rule:** any structural/taxonomy/grouping change applied directly in the live DB will be wiped by the next wipe-and-reseed, because the seed rebuilds from JSON. Direct-to-DB ALTERs are acceptable only when paired with the matching seed edit.

This was the root cause of the May-13 grouping outage (WS card went blank): the original WS grouping was applied as live SQL only, not baked into the seed, so the May-30 Promise dedup reseed erased it. Recovery required lifting the grouping out of the backup table and baking it into the seed.

**Backup tables convention:** `mo_order_form_index_v2_bak_YYYYMMDD[suffix]`, `mo_sku_lookup_v2_bak_YYYYMMDD[suffix]`. Keep all of them — restore points are cheap insurance.

**Reseed flow:** backup → DRY_RUN → live. Never `prisma db push` or `prisma db pull`. Schema via Supabase SQL Editor + `npx prisma generate`.

**Dry-run limitation:** the seed's dry-run returns BEFORE the DB insert, so it cannot catch insert-time failures (e.g. missing family in `FAMILY_TO_SECTION` map). When introducing a NEW family, also add it to the section/subgroup maps in the seed.

**Commit ≠ deploy.** Vercel builds from `origin/main`. A local commit is NOT live until `git push origin main`. DB reseeds run against Supabase directly and are independent of code deploy — easy to land schema/data changes without the code that uses them. Always finish a session with both code push AND production verification.

---

## 19. v2 as single source of truth — 3-stage plan

**Goal:** make the v2 menu + stock the single source of truth for BOTH humans AND the parser, so an email order can be looked up reliably and the desktop/mobile pages stay clean.

**Architecture (plain English):**
- **The stable key (backend only):** every product+variant links menu→stock by a stable key (SAP `material` for per-pack codes; product name one level up). Never shown on the frontend.
- **Friendly names + search on top:** `displayName` for people; `searchTokens` for the search box.
- **One universal keyword brain:** a single curated word→product + word→colour layer, used by BOTH the search box AND the parser — so a word is taught once and both stay in step (no drift).
- **Two doors, one catalogue:** `/order` orders arrive already clean (skip the parser); messy emails go through the keyword brain to be tidied; both then use the same catalogue → SAP code.

### Stage 1 — urgent fix (production-safe) — IN PROGRESS

Make `/order` packs work + restore `/place-order` grouping. **Mostly DONE.**

**Stage 1 remaining touch-ups (next session before Stage 2 starts):**
- ~13 oddball rows still showing no packs (left with `product = null` on purpose):
  - AQUATECH: PU Coat, Interior WBC, Roof Coat (BW/Grey/Teracotta), Crackfiller (5/10/20mm), Flexible Coat (Advance/Neo), IBC Advance
  - DISTEMPER: Acrylic Distemper / Interior Distemper
  - PRIMER: 2in1 Interior-Exterior Primer
  - STAINER: HP Colorant
- 8 "mapped-but-base-unstocked" rows — `product` set correctly but that base colour has no SKU in `mo_sku_lookup_v2`. Likely genuine stock gaps:
  - **WS Protect Brilliant White** (flagged — plain WS Protect has no BW SKU though Dustproof/Max cousins do)
  - WS Max Yellow Base; WS Protect 90/93/96/97 Base; WS Protect Dustproof Yellow Base / ROX
- Stock-side gap: Acrylic Distemper / Interior Distemper SKU missing its `packCode` in `mo_sku_lookup_v2`
- Optional cosmetic: WS rows carry `mobileFamily = MAX/POWERFLEXX/PROTECT/RAINPROOF`. Harmless on `/order` (it labels by `family = "WS"`); normalise to "WS" only if desired.

### Stage 2 — make v2 parser-ready (frontend lives on v2; legacy parser still runs untouched)

Build everything the parser will eventually need, without switching it over:
1. Fill the canonical key (`product`) on all remaining rows (full hygiene).
2. Build the one universal keyword layer in v2 (word→product + word→colour), seeded from the legacy keyword tables (`mo_product_keywords`, `mo_base_keywords`).
3. Point `/order` + `/place-order` search at the shared layer.
4. Readiness check — confirm v2 carries everything the parser needs (packs, colour strategies DIRECT/FIXED/NUMBERED/COLOUR, carton multiply, no-match handling).
5. Verify search + readiness.

### Stage 3 — migrate the parser to v2 (only on explicit go-ahead)

1. Switch parser resolution to read v2 + the shared keyword layer instead of the legacy tables.
2. Carry over the no-match / zero-skip rule + the operator "fix-it" resolve loop + the `mo_line_status` audit surface.
3. Test on real sample emails.
4. Run old (legacy) and new (v2) side by side, confirm they agree, then cut over — retire legacy tables LAST.

**Note on parser today:** legacy parser resolves an email product name via scored keyword matching (`mo_product_keywords` longest-first + `mo_base_keywords` + Levenshtein fuzzy fallback), then looks up `product|base|pack` in `mo_sku_lookup` → `material`. It enforces zero-skip (every email line is inserted even if unmatched). Stage 3 must preserve all of this on v2.

**Current state:** in Stage 1 (touch-ups pending). Stage 2 and Stage 3 are sequential and require explicit go-ahead each. Do NOT delete legacy tables until Stage 3 completes.

---

## 20. Last-order recall

`POST /api/place-order/last-order?customerCode=...` returns the most recent mail order for that customer, normalised into units.

Shape per entry: `RepeatOrderEntry { product, base, pack, units }`.

**Units-based.** Earlier `unitsToBoxes` helper deleted. Cart imports recall entries directly as units.

---

## 21. Draft persistence

`localStorage` key: `orbitoms_place_order_draft_v2`.

TTL: 24h. Drafts older than 24h discarded silently on next mount.

On every cart change: full cart object serialised. On mount: deserialise + validate TTL + hydrate state.

**One-shot cleanup:** on first load after deploy, old v1 key (`orbitoms_place_order_draft`) read, ignored, removed.

---

## 22. Landmines

- **v2 tables are parallel to legacy.** `/order` + `/place-order` read v2; mail parser + enrichment read LEGACY. Diverging product/base names between the two will cause mail order enrichment misses on Place Order-originated emails. Spot-check after any taxonomy edit.
- **`product` and `baseColour` in v2 carry bucket+variant info, not real colour.** A row may have `baseColour="MATT"` or `baseColour="SEALER"` or numbered "90 BASE". Treat as opaque variant key.
- **PROMISE appears cross-listed** — historically dropped to 1 spot per family via 2026-05-30 dedup. Watch for resurfacing on future reseeds.
- **Tab order is `sortOrder`-driven** — NOT from any `WITHIN_SECTION_ORDER` constant. Earlier doc reference to that file was stale; it does not exist.
- **Cart volume total uses units × packToLitres, NOT × packStep.** Earlier bug double-counted boxes-and-units. Don't reintroduce a `packStep` multiplier.
- **`PACK_STEP_MAP[10L] = 1`.** Drums ship as singles. Don't change to 2.
- **Path A is tactical.** Stage E migration (proper `subVariant` column) was planned in earlier roadmap; superseded by the 3-stage v2 single-source plan (§19) which goes farther.
- **`/api/order/data` filters `isPrimary = true`. `/api/place-order/data` does not.** Desktop will show duplicate twins until the filter is added there too (intentional — out of scope for the current cut).
- **`mobileFamily` is declared but unused as a label.** Populated by the seed, ready if a single-PROMISE mobile label is ever wanted. Today mobile labels by `family`.
- **Promise cross-listing risk** — if a product appears under both family `PROMISE` and `PROMISE INTERIOR/EXTERIOR/ENAMEL`, surfaces as a near-duplicate in flat mobile search. Family chip distinguishes.
- **Phase 3 `visualViewport` JS fight failed** on the qty card sticky bar. Don't fight iOS's sticky-position quirks with JS math. Move the bar to a place that doesn't need lifting (skip auto-focus on mobile is the right pattern).
- **Working-tree clutter risk** — pre-existing uncommitted drafts/SQL/scripts can sit in the working tree for days. Always `git status` at session start; commit clean before pushing the actual feature.

---

*Place Order v1.2 · Schema v27.5 · OrbitOMS*
