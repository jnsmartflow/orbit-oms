# CLAUDE_PLACE_ORDER.md — Place Order Module
# v1.1 · Schema v27.4
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Depot-facing phone-order entry page (desktop) + public mobile equivalent. Operator builds an order on screen and sends as an email to `surat.order@outlook.com`. Email is then picked up by the mail order pipeline.

Routes:
- `/place-order` (desktop, auth'd) — sidebar nav label "Purchase Order (PO)"
- `/order` (public mobile, no login) — Sales Officers and ad-hoc mobile use

DB `pageKey` stays `place_order`.

Primary users: admin, billing_operator, tint_manager.
Restricted-view users: support, dispatcher (`/place-order` is their only authorised page until real support/dispatch screens go live).

---

## 1. What this page is

Operator types out a phone order quickly while a dealer is on the line. No DB write — output is a `mailto:surat.order@outlook.com` link with the order in the body, byte-identical to what the public mobile `/order` page produces. The email lands back in OrbitOMS and is parsed by `Parse-MailOrders-v6_5.ps1`.

Keep the page fast — no scroll, no nested popovers, keyboard-first on desktop, thumb-first on mobile.

---

## 2. Database — v2 tables

Parallel to legacy `mo_order_form_index` and `mo_sku_lookup` to avoid disturbing the live mail order pipeline.

### mo_order_form_index_v2 (~481 rows)

```
id              SERIAL PK
family          TEXT — e.g. "GLOSS", "PROMISE ENAMEL", "WS"
product         TEXT — sub-product / bucket name (Path A repurpose)
baseColour      TEXT — variant name (Path A repurpose)
displayName     TEXT — UI display
searchTokens    TEXT — space-separated tokens for search
tinterType      TEXT — TINTER | ACOTONE | null
productType     TEXT — Emulsion | Enamel | Stainer | Primer | Putty | etc.
sortOrder       INT  — within-family rank
isActive        BOOLEAN
section         TEXT — UTILITY, INTERIORS, EXTERIORS, ENAMELS, WOODCARE, MULTI-USE
subgroup        TEXT — within-section subgroup label

UNIQUE (family, product, baseColour)
```

**Path A taxonomy state.** The columns `product` and `baseColour` were repurposed at the v2 table cut to carry bucket+variant identifiers instead of clean product + colour. This was tactical to ship the page without a full taxonomy migration. The `description` column on the legacy form-index table still holds the original compound product string. Stage E will replace this with a proper `subVariant` column.

### mo_sku_lookup_v2 (1,642 rows)

Parallel clean-name version of `mo_sku_lookup`. `material` UNIQUE. Used by speed-dial backend lookup.

### Sections

Six top-level sections, in this order: **UTILITY, INTERIORS, EXTERIORS, ENAMELS, WOODCARE, MULTI-USE**.

UTILITY first. FLOOR PLUS and SMOOTHOVER moved from UTILITY → EXTERIORS on 2026-05-08 rebalance.

Within each section, sub-product order is **hardcoded** in `lib/place-order/constants.ts` as `WITHIN_SECTION_ORDER`. Not driven by `sortOrder` column. Reorder = code edit + deploy.

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

Schema: `users.phone TEXT` with `CHECK (phone IS NULL OR phone ~ '^[0-9]{10}$')` and partial unique index `WHERE phone IS NOT NULL`. Field `id`/`name` stays `email` (auth contract). See `CLAUDE_CORE.md §5`.

---

## 5. Page layout

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

---

## 7. Search

Multi-token scoring, top 10 results.

| Match type | Weight |
|---|---|
| Prefix on a search token | 100 |
| Word-boundary inside a token | 20 |
| Inner substring | 5 |
| Multi-token base bonus | +50 (added when 2+ query tokens both match) |

Result list: subproduct + base preview + product family chip. Click → activates target subproduct + scrolls base into view.

---

## 8. Variant grid card

Sub-product tabs (top) → pack header row → base × pack matrix.

**Pack header:** single-line, 10.5px. Format `{pack} · {containerLabel}`. Container label mono gray-400.

**Pack columns:** explicit 80px width via `style={{ width: "80px" }}` on each `<col>` in colgroup. `table-layout: fixed`.

**Pagination:** `VARIANT_GRID_PAGE_SIZE = 15`, `VARIANT_GRID_PAGINATION_THRESHOLD = 17`. Sub-products with `bases.length > 17` paginate at 15 per page. Page dots in card header for mouse. `Shift+PageDown`/`Shift+PageUp` for keyboard. Unshifted `PageDown`/`PageUp` cycle sub-products within family. Page state in parent, resets to 0 on subProductName/activeSubProduct change.

**Cell sizing:** 56×32px, font 13px (fixed pixels).

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

2 absolute `<button>` elements inside wrapper. Width 16px, height 14px. `+` top-right (`right-[1px] top-[1px]`), `−` bottom-right (`right-[1px] bottom-[1px]`). Style: `text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-[2px] text-[11px] leading-none`. Visibility: `opacity-0` default → `opacity-100` on `group-hover` OR `[.group:focus-within_&]`. `tabIndex={-1}` + `onMouseDown={e.preventDefault()}` to keep focus on input.

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

Shown only in browse mode (`activeState.kind === "idle"`). Driven by `touchedAt?: number` on `CartLine`, set to `Date.now()` on every `setQty` path. Sorts by `touchedAt DESC`, shows up to 6 most recently touched.

---

## 11. Email builder

Plain text output, byte-identical to mobile `/order` output:

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

---

## 12. Last-order recall

`POST /api/place-order/last-order?customerCode=...` returns the most recent mail order for that customer, normalised into units.

Shape per entry: `RepeatOrderEntry { product, base, pack, units }`.

**Units-based.** Earlier `unitsToBoxes` helper deleted. Cart imports recall entries directly as units.

---

## 13. Draft persistence

`localStorage` key: `orbitoms_place_order_draft_v2`.

TTL: 24h. Drafts older than 24h discarded silently on next mount.

On every cart change: full cart object serialised. On mount: deserialise + validate TTL + hydrate state.

**One-shot cleanup:** on first load after deploy, old v1 key (`orbitoms_place_order_draft`) read, ignored, removed.

---

## 14. Customer search

`<CustomerSearch>` component renders the customer pill in the top bar. Hits `mo_customer_keywords` via `/api/mail-orders/customers/search`.

---

## 15. Public mobile route — /order

Public, no login. Whitelisted in middleware. Same `/api/order/data` payload as desktop `/place-order`. Generates mailto on Send.

Path note: lives at **`app/order/page.tsx`**, NOT `app/(public)/order/page.tsx`. Whitelist in middleware, not in a route group.

### 15.1 Unified sticky header — 3 states

Single edge-to-edge header element that swaps content based on state. See `CLAUDE_UI.md §47`.

| State | Trigger | Content |
|---|---|---|
| 1 — Branding | `selectedCust === null` | `[logo] Place Order / JSW Dulux · Surat Depot` |
| 2 — Customer locked, browsing | `selectedCust && !anyBillInPicking` | `{customerName}` (16px semibold) / `{customerCode}` (12px gray) / `Change` button |
| 3 — Customer locked, picking | `selectedCust && anyBillInPicking` | Row A: `{customerName}` · `N of M` · Row B: `{productName}` (17px semibold, with `border-b border-gray-200`) · Row C: `[Skip ghost] [Next →]` |

Header is `sticky top-0 z-30`, `bg-white border-b border-gray-200`, edge-to-edge (no margin, no rounded corners).

**Key rule:** once a customer is locked, the page header ("Place Order · JSW Dulux · Surat Depot") disappears. The customer header IS the page identity from that point.

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
- `overflow-y-auto` on `<main>` so scrolling happens inside `<main>` (keyboard-aware), not on document body
- Don't pin the search input with sticky/fixed — creates a second scroll surface
- Pick ONE viewport mechanism — typed export OR raw `<meta>` — never both

### 15.3 Empty-state row

Synchronous in-memory filter. Render gate uses `inMultiSel && bill.searchQuery.trim().length >= 2`. Zero-match queries render italic `"No products match {query}"` row instead of nothing.

Mode flip logic: flip to `multi-select` whenever `query.trim().length >= 2`, regardless of match count.

User input escaped via React text nodes — never `dangerouslySetInnerHTML`.

### 15.4 Other mobile patterns

- Qty input: `text-[16px]` (iOS auto-zoom prevention).
- Mode-transition auto-focus to first qty input is desktop-only: `window.matchMedia("(min-width: 768px)").matches`. Mobile users get a calm Set Quantities screen with no keyboard. They tap +/− buttons OR tap the qty number to bring up keyboard on demand.
- Pack row has `data-pack-row` attribute + `scroll-mt-[140px]` for picker-entry auto-scroll target.
- Picker Skip button: ghost (`text-gray-500 text-[13px] font-medium`, no bg). Next button: primary (teal/green).
- Single-pack products: `py-[18px]` + `text-[16px]` label (vs default `py-[10px]` + `text-[14px]`).
- Qty input: `border-b border-dashed border-gray-300` when value is 0. Dashed underline disappears when user enters a value. Subtle "tap to type" cue.
- Bill summary chip: `BILL N · X products · Y units` when cart non-empty. `X products` = `cart.length` (pluralised). `Y units` = sum of all `packQtys` across all cart lines.
- Auto-scroll on picker entry/advance: useEffect inside BillCard listens to `bill.mode === "picking" && bill.activeProduct?.id` changes. Calls `target.scrollIntoView({ block: "start", behavior: "smooth" })`. NO focus call.

### 15.5 Mobile UX rules established (lessons)

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
| GET | `/api/place-order/quick-tiles` | Returns 9-tile config + counts |
| GET | `/api/order/data` | Returns hydrated v2 form index + SKU lookup (shared `/order` + `/place-order`) |
| POST | `/api/place-order/last-order` | Returns last order normalised to units for given customerCode |

All routes: `export const dynamic = 'force-dynamic'`.

---

## 17. Files map

```
app/(billing-operator)/place-order/
  page.tsx                          force-dynamic, hydrates from /api/order/data
  place-order-page.tsx              client root
  speed-dial.tsx                    9-tile grid + pill strip
  variant-grid.tsx                  base × pack matrix
  variant-cell.tsx                  cell with hover/focus +/− buttons
  cart-panel.tsx                    340px right column
  recently-used.tsx                 browse-mode only panel
  customer-search.tsx               pill + dropdown
  send-button.tsx                   builds mailto

app/order/
  page.tsx                          public mobile route (single-file)

lib/place-order/
  constants.ts                      WITHIN_SECTION_ORDER, sections list
  quick-tiles-config.ts             9-tile operator-curated config
  pack.ts                           PACK_STEP_MAP, packToLitres, packContainerLabel
  cart.ts                           CartLine type, setQty, volume reducer, touchedAt tracking
  draft.ts                          localStorage hydrate/save, TTL
  email.ts                          cartToMailtoBody (pure pass-through)
  search.ts                         multi-token scoring

api/place-order/quick-tiles/route.ts
api/place-order/last-order/route.ts
api/order/data/route.ts             shared with /order public route
```

---

## 18. Landmines

- **v2 tables are parallel.** Legacy `mo_sku_lookup` + `mo_order_form_index` still live. Parser and enrichment for incoming mail orders read the LEGACY tables, not v2. Diverging product/base names between the two will cause mail order enrichment misses on Place Order-originated emails. Spot-check after any taxonomy edit.
- **`product` and `baseColour` in v2 carry bucket+variant info, not real colour.** A row may have `baseColour="MATT"` or `baseColour="SEALER"` (e.g. LUXURIO PU MATT cut). Treat as opaque variant key. `description` on legacy form-index has original.
- **PROMISE appears cross-listed in two sections** (ENAMELS + MULTI-USE). Intentional. Sort dedup at the section render level if needed.
- **WITHIN_SECTION_ORDER is hardcoded** in `lib/place-order/constants.ts`, NOT driven by `sortOrder` column on v2. Reorders require code edit + deploy.
- **Cart volume total uses units × packToLitres, NOT × packStep.** Earlier bug double-counted boxes-and-units. Don't reintroduce a `packStep` multiplier.
- **`PACK_STEP_MAP[10L] = 1`.** Drums ship as singles. Don't change to 2 ("box of 2 drums") — depot has never shipped them grouped.
- **Path A is tactical.** Stage E migration (proper `subVariant` column) is planned in roadmap. Until then, do not assume `product` or `baseColour` in v2 are clean dimensions.
- **Public `/order` route still uses LEGACY `mo_order_form_index`** (not v2). Two parallel taxonomies during the migration window.
- **Phase 3 `visualViewport` JS fight failed** on the qty card sticky bar. Don't fight iOS's sticky-position quirks with JS math. Move the bar to a place that doesn't need lifting in the first place. (Skip auto-focus on mobile is the right pattern.)

---

*Place Order v1.1 · Schema v27.4 · OrbitOMS*
