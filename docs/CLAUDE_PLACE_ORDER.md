# CLAUDE_PLACE_ORDER.md — Place Order Module
# v1.0 · Schema v27.2
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Depot-facing phone-order entry page. Operator builds an order on screen and sends as an email to `surat.order@outlook.com`. The email is then picked up by the mail order pipeline (`CLAUDE_MAIL_ORDERS.md`).

Route: `/place-order` (URL kept). Sidebar nav label: **"Purchase Order (PO)"**. DB `pageKey` stays `place_order`. Mobile-only public `/order` route kept as "Place Order" for Sales Officers.

Primary users: admin, billing_operator, tint_manager.
Restricted-view users: support, dispatcher (`/place-order` is their only authorized page until the real support/dispatch screens go live).

---

## 1. What this page is

Operator types out a phone order quickly while a dealer is on the line. No DB write — output is a `mailto:surat.order@outlook.com` link with the order in the body, byte-identical to what the public mobile `/order` page produces. The email lands back in OrbitOMS and is parsed by `Parse-MailOrders-v6_5.ps1`.

Keep the page fast — no scroll, no nested popovers, keyboard-first.

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
section         TEXT — top-level category bucket (UTILITY, INTERIORS, EXTERIORS, ENAMELS, WOODCARE, MULTI-USE)
subgroup        TEXT — within-section subgroup label

UNIQUE (family, product, baseColour)
```

**Path A taxonomy state.** The columns `product` and `baseColour` were repurposed at the v2 table cut to carry bucket+variant identifiers instead of clean product + colour. This was a tactical decision to ship the page without a full taxonomy migration. The `description` column on the legacy form-index table still holds the original compound product string. Stage E will replace this with a proper `subVariant` column.

### mo_sku_lookup_v2 (1,642 rows)

Parallel clean-name version of `mo_sku_lookup`. `material` UNIQUE. Used by the speed-dial backend lookup.

### Sections

Six top-level sections, in this order: **UTILITY, INTERIORS, EXTERIORS, ENAMELS, WOODCARE, MULTI-USE**.

UTILITY first (was earlier ordered differently). FLOOR PLUS and SMOOTHOVER moved from UTILITY → EXTERIORS on 2026-05-08 rebalance.

Within each section, sub-product order is **hardcoded** in `lib/place-order/constants.ts` as `WITHIN_SECTION_ORDER`. Not driven by `sortOrder` column on v2 table. To reorder, edit the constant.

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

Login redirect (`lib/rbac.ts`): support → `/place-order`. dispatcher → `/place-order`. (Was `/support` / `/planning`.)

---

## 4. Mobile login (10-digit phone)

NextAuth credentials provider accepts email OR 10-digit phone. Login page label: **"Email or Mobile Number"**. Input `type="text"` (not `email`). `autoComplete="username"`.

Routing logic: `if (/^\d{10}$/.test(identifier)) lookup by phone else lookup by email`. Strict — no `+91`, dashes, spaces.

Schema: `users.phone TEXT` with `CHECK (phone IS NULL OR phone ~ '^[0-9]{10}$')` and partial unique index `WHERE phone IS NOT NULL`. Field `id`/`name` stays `email` (auth contract). See `CLAUDE_CORE.md §5`.

---

## 5. Page layout

Sticky 52px top bar. Below: content + 340px right cart column. No vertical scroll anywhere on the page (`h-screen overflow-hidden flex flex-col`).

```
┌─────────────────────────────── Top bar (52px) ────────────────────────────────┐
│ [Orbit logo + wordmark]        [Customer pill]              [Send] [Cart: N]  │
├──────────────────────────────────────────────┬────────────────────────────────┤
│                                              │                                │
│ Browse mode: 9-tile speed dial               │  Cart panel                    │
│ Work mode: pill strip + variant grid card    │  (340px right)                 │
│                                              │                                │
│                                              │                                │
└──────────────────────────────────────────────┴────────────────────────────────┘
```

Visual spec: `CLAUDE_UI.md §38-43`.

Viewport guard: width `< 1024px` redirects to `/order` (mobile public form) on mount AND on `resize`.

Sidebar: same sidebar pattern as other admin screens. No longer full-bleed (older versions hid sidebar — now standard).

---

## 6. Speed dial — 9-tile config

Config file: `lib/place-order/quick-tiles-config.ts`. Plain TS constant, operator-curated, no DB.

```
position 1 → GLOSS           parentLabel "GLOSS"           familyName "GLOSS"
position 2 → SATIN           parentLabel "SUPER SATIN"     familyName "SUPER SATIN"
position 3 → PROMISE ENAMEL  parentLabel "PROMISE ENAMEL"  familyName "PROMISE ENAMEL"
position 4 → WS              parentLabel "WS"              familyName "WS"
position 5 → VT GLO          parentLabel "VT GLO"          familyName "VT GLO"
position 6 → WOODCARE        parentLabel "WOODCARE"        familyName "WOODCARE"
position 7 → STAINER         parentLabel "STAINER"         familyName "STAINER"
position 8 → PRIMER          parentLabel "PRIMER"          familyName "PRIMER"
position 9 → AQUATECH        parentLabel "AQUATECH"        familyName "AQUATECH"
```

Position 4 was previously "MAX" and renamed to "WS" at the Path A cut.

Each tile entry: `{ position, type: "family", label, parentLabel, familyName }`.

Two render modes — see `CLAUDE_UI.md §39`.

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

**Pagination:** `VARIANT_GRID_PAGE_SIZE = 15`, `VARIANT_GRID_PAGINATION_THRESHOLD = 17`. Sub-products with `bases.length > 17` paginate at 15 per page. Page dots in card header for mouse. `Shift+PageDown`/`Shift+PageUp` for keyboard. Unshifted `PageDown`/`PageUp` cycle sub-products within family. Page state in parent, resets to 0 on subProductName / activeSubProduct change.

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
| Esc | Blur (deselect) |
| PageUp/PageDown | Cycle sub-product within family |
| Shift+PageUp/Down | Page within base list |

All four shortcut keys (`+`, `=`, `-`, `_`) call `e.preventDefault()` to suppress native browser behaviour. Native key-repeat handles hold-to-repeat.

### Hover/focus +/− buttons

2 absolute `<button>` elements inside wrapper. Width 16px, height 14px.
- `+` top-right (`right-[1px] top-[1px]`)
- `−` bottom-right (`right-[1px] bottom-[1px]`)
Style: `text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-[2px] text-[11px] leading-none`.
Visibility: `opacity-0` default → `opacity-100` on `group-hover` OR `[.group:focus-within_&]`.
`tabIndex={-1}` + `onMouseDown={(e) => e.preventDefault()}` to keep focus on input.

### Empty vs NA cells

Distinguishable visually. NA cells have different bg + `cursor: not-allowed`.

### Pack step map

`PACK_STEP_MAP` in `lib/place-order/pack.ts`. Examples:
- 1L → step 12 (box of 12)
- 4L → step 6 (box of 6)
- 10L → **step 1** (drum, NOT box of 2 — drums ship as singles, never grouped)
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

Conditional rule for box suffix: `step > 1 && units > 0 && units % step === 0`.

Examples:
- `×12 · 1 box` (12 units of pack-step-12)
- `×13` (non-clean multiple)
- `×24 · 2 box`
- `×5` (10L drum, step=1, no suffix)

### Volume total formula

```
volume = sum across lines of: units * packToLitres(pack)
```

DO NOT multiply by `packStep` (that would double-count under unit semantics). Volume formula bug fixed at the units-not-boxes cutover.

### Recently used panel

Shown only in browse mode (`activeState.kind === "idle"`). Driven by `touchedAt?: number` field on `CartLine`, set to `Date.now()` on every `setQty` path. Recently-used list sorts by `touchedAt DESC`, shows up to 6 most recently touched items.

---

## 11. Email builder

Output is plain text, byte-identical to mobile `/order` page output, formatted as a clipboard-copy of the cart followed by a customer line.

```
Customer: {customerName} ({customerCode})

{productLine}
  4L ×6
  10L ×2
  20L ×1
{productLine}
  ...
```

The builder is a pure no-op pass-through on units — `cartToMailtoBody(cart)` writes units directly (no box conversion).

Send button opens `mailto:surat.order@outlook.com?subject=...&body=...` (URL-encoded). User's default mail client launches. No POST, no DB row.

---

## 12. Last-order recall

`POST /api/place-order/last-order?customerCode=...` returns the most recent mail order for that customer, normalised into units.

Shape per entry: `RepeatOrderEntry { product, base, pack, units }`.

**Units-based.** The earlier `unitsToBoxes` helper that converted units back to boxes for display was deleted. Cart imports recall entries directly as units.

---

## 13. Draft persistence

`localStorage` key: `orbitoms_place_order_draft_v2`.

TTL: 24h. Drafts older than 24h are discarded silently on next mount.

On every cart change: full cart object serialised to localStorage. On mount: deserialise + validate TTL + hydrate state.

**One-shot cleanup:** on first load after deploy, the old v1 key (`orbitoms_place_order_draft`) is read, ignored, and `localStorage.removeItem`'d.

---

## 14. Customer search

`<CustomerSearch>` component renders the customer pill in the top bar. Search hits `mo_customer_keywords` via `/api/mail-orders/customers/search`. Selected customer stored in cart state.

Wrapper around the dropdown trigger MUST NOT have `overflow-hidden` — clips the dropdown panel. Use `min-w-0 truncate` on the pill name span instead.

---

## 15. Keyboard map (summary)

| Key | Action |
|---|---|
| 1–9 | Trigger speed-dial tile by position |
| `/` | Focus search |
| 0–9 (in cell) | Write units |
| `+` / `=` | Bump up one box |
| `-` / `_` | Bump down one box |
| Arrow keys | Move between cells |
| Tab / Shift+Tab | Next/prev cell |
| Enter | Confirm + advance |
| Esc | Blur cell / close modal / clear |
| PageDown / PageUp | Cycle sub-product within family |
| Shift+PageDown / Shift+PageUp | Page within base list |

Digit shortcuts 1-9 always trigger tile. No Tab-cycle through tiles.

---

## 16. API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/place-order/quick-tiles` | Returns 9-tile config + counts |
| GET | `/api/order/data` | Returns hydrated v2 form index + SKU lookup payload |
| POST | `/api/place-order/last-order` | Returns last order normalised to units for given customerCode |

All routes: `export const dynamic = 'force-dynamic'`.

---

## 17. Files map

```
app/(billing-operator)/place-order/
  page.tsx                          force-dynamic, hydrates from /api/order/data
  place-order-page.tsx              client root component
  speed-dial.tsx                    9-tile grid + pill strip
  variant-grid.tsx                  base × pack matrix with paginated sub-products
  variant-cell.tsx                  cell with hover/focus +/− buttons
  cart-panel.tsx                    340px right column
  recently-used.tsx                 browse-mode only panel
  customer-search.tsx               pill + dropdown
  send-button.tsx                   builds mailto

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
- **PROMISE appears cross-listed in two sections** (ENAMELS + MULTI-USE). Intentional. Sort dedup at the section render level if needed — not at SQL level.
- **WITHIN_SECTION_ORDER is hardcoded** in `lib/place-order/constants.ts`, NOT driven by `sortOrder` column on v2. Reorders require code edit + deploy.
- **Cart volume total uses units × packToLitres, NOT × packStep.** Earlier bug double-counted boxes-and-units. Don't reintroduce a `packStep` multiplier in the volume reducer.
- **`PACK_STEP_MAP[10L] = 1`.** Drums ship as singles. Don't change to 2 ("box of 2 drums") — depot has never shipped them grouped.
- **Path A is tactical.** Stage E migration (proper `subVariant` column) is planned in roadmap. Until then, do not assume `product` or `baseColour` in v2 are clean dimensions.
- **Public `/order` route still uses LEGACY `mo_order_form_index`** (not v2). Two parallel taxonomies during the migration window.

---

*Place Order v1.0 · Schema v27.2 · OrbitOMS*
