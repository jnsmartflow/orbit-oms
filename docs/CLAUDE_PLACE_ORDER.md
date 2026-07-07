# CLAUDE_PLACE_ORDER.md — Place Order Module
# v1.4 · Schema v27.9 · June 2026
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Depot-facing phone-order entry (desktop + going-forward mobile) + public mobile equivalent. All surfaces output a `mailto:` link with the order body — same email path back to the mail order pipeline. No DB writes on submit.

Routes:
- **`/place-order`** — desktop, auth'd. Sidebar nav label: "Purchase Order (PO)". Brought to full `/po` feature parity 2026-06-09 (recents, multi-bill, options panel, unified email).
- **`/po`** — **going-forward** depot mobile PO page (Orbit bar, multi-bill, recents, browser-history back-nav). See §25.
- **`/order`** — public mobile, no login. Reads v2, same payload. Treated as a **frozen backup** since the `/po` build began (no new features land here; `/po` will eventually be renamed over it). ⚠️ Authoritative-status contradiction unresolved: this section historically called `/order` the "~99% of orders" page; both currently look live to different audiences — confirm with owner before any cutover.

**Order recipient (live):** `/po` and `/place-order` send to **`surat.depot@akzonobel.com`** (AkzoNobel inbox auto-forwards to `surat.order@outlook.com`, which the Mail Orders parser still watches). The frozen `/order` page still sends to the old `surat.order@outlook.com` until cutover. See §11.

DB `pageKey` stays `place_order`.

Primary users: admin, billing_operator, tint_manager. Restricted-view users: support, dispatcher (`/place-order` is their only authorised page until real dispatch/support screens go live).

---

## 1. What this page is

Operator types a phone order quickly while a dealer is on the line. Output is a `mailto:` link. Desktop `/place-order` and public `/order` keep a byte-identical plain order body; `/po` intentionally diverges (carries Dispatch / Remark / Note / conditional Ship-to lines — §25). The email lands back in OrbitOMS and is parsed by `Parse-MailOrders-v6_5.ps1`.

Keep the page fast — no scroll, no nested popovers, keyboard-first on desktop, thumb-first on mobile.

---

## 2. Database — v2 tables

Both surfaces read the v2 catalog: `mo_order_form_index_v2` (menu) + `mo_sku_lookup_v2` (stock).

**`/order` switched to v2 on 2026-05-29.** Before that it read the legacy `mo_order_form_index` / `mo_sku_lookup`. Both legacy tables are now ORPHANED by both order-entry surfaces but are STILL read by the mail parser + enrichment — do NOT delete them until the parser is migrated (Stage 3 of the v2 single-source plan, §19).

### mo_order_form_index_v2 (~454 active rows after the full catalog restructure)

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
region          TEXT? — optional grey-line qualifier (TOOLS 4" brushes: Delhi NCR /
                        UP Punjab / South). Null on every paint row. Selected by BOTH
                        data routes; rendered as an optional grey line (desktop grid +
                        /order + /po). Added via Supabase SQL ALTER + hand-edited
                        `schema.prisma` + `npx prisma generate` (never db push/pull).

UNIQUE (family, product, baseColour)
```

### mo_sku_lookup_v2 (~1,680 rows after the full catalog restructure)

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

Top-level sections: **UTILITY · INTERIORS · EXTERIORS · ENAMELS · WOODCARE · MULTI-USE**, plus a dedicated **PROMISE** section (the cross-section Promise family is modelled as its own section + speed-dial tile — see §23).

UTILITY first. FLOOR PLUS and SMOOTHOVER are under EXTERIORS (moved from UTILITY on 2026-05-08 rebalance). **Deferred** (final CORE section pass): SMOOTHOVER EXTERIORS→UTILITY + the broader UTILITY/INTERIORS/EXTERIORS relabel + the 96/97 YOX-vs-Yellow alias standardisation — all done together, not piecemeal.

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

Operator-curated. **Final tile order (grid is locked at 9):**

`1 GLOSS · 2 Satin & PU · 3 PROMISE · 4 WS · 5 VELVET TOUCH · 6 SADOLIN · 7 STAINER · 8 Putty & Primer · 9 AQUATECH`

Config: `lib/place-order/quick-tiles-config.ts`.

**Tile shape:** `{ position, type: "family"|"section", label, parentLabel, familyName }`, plus an optional **`familyNames: string[]`** for a **multi-family tile** (one tile that combines several families' products under one card).

- Single-family tile: `familyName` selects `family === tile.familyName`.
- **Multi-family tile** (`familyNames`): the 3 desktop filter sites resolve `tile.familyNames ?? [tile.familyName]` and flat-map the filter; `familyName` stays for the highlight. The combined card's tabs come for free from the uiGroup-tab engine across the combined product set — no new tab/grid code. `headerLabel` shows the combined name. **Mobile (`/po`, `/order`) is search-first and ignores this** (untouched).
  - **Tile 2 "Satin & PU"** = `["SATIN","PU ENAMEL"]` (+ a Lustre tab) → tabs: Satin Finish · Satin Stay Bright · PU Enamel · Lustre.
  - **Tile 8 "Putty & Primer"** = `["PRIMER","DISTEMPER","TEXTURE","PUTTY"]` → tabs: Primers · Distemper · Texture & Putty. Each family stays its own family in data; the grouping is UI/nav only.

Two render modes:
- **Browse mode** (`activeState.kind === "idle"`): full 9-tile grid
- **Work mode** (sub-product active): compact horizontal pill strip (~40px tall)

Digit shortcuts 1-9 always trigger their tile. No Tab cycle.

**Search-only families (no tile — grid is full):** reachable by search only, via `keyword-family-map.ts` promotion (§13) — **TOOLS** (rollers/brushes), **SPRAY PAINT**, **SMOOTHOVER**, **VT SPECIALTY** (Concrete Finish / Marble / Clear Coat — NOT folded into a tile; current state is search-only).

**Important:** if a speed-dial tile points at a family that doesn't exist in the data (e.g. WS tile when WS family was flattened), the card renders empty. This was the root cause of the May-13 WS card outage; recovery required baking the grouping back into the seed.

---

## 7. Variant grid card

Sub-product tabs (top) → pack header row → base × pack matrix.

**Tab list and order come from menu rows + `sortOrder`** (NOT from a `WITHIN_SECTION_ORDER` constant — that file does not exist; an earlier doc reference was stale).

**Tab label** = `uiGroup ?? subProduct` in `family-nav-with-tabs.tsx`, then run through an optional **`TAB_DISPLAY` render-map** that merges/relabels tabs at the render layer (no `uiGroup` change, no reseed, search/mobile untouched). Used to merge **WS Tile + WS Metallic → one "Tile & Metallic" tab** (the Set dedups) and drop "Protect" → Dustproof / Rainproof / Hi-Sheen. Tabs never wrap: `whitespace-nowrap shrink-0` on the button + `overflow-x-auto` on the row (scroll if needed). One-teal rule intact.

**Flat-list families (no tab bar):** a family with exactly one `uiGroup` auto-hides the tab strip — `showTabs = subProductNames.length > 1` in `family-nav-with-tabs.tsx`. No grid change needed (e.g. PRIMER flat list).

**Row label rule (`variant-grid.tsx`, `tabHasMultipleProducts` over the FULL tab):**
- **Single-product tab** → row labelled by **`baseColour`** (e.g. WS, Promise emulsion tabs). ⇒ a single-product family's `baseColour` can't be casually renamed (it IS the label) — bake the name into `displayName` only when the tab is single-product and you need to distinguish rows; otherwise use an `emailLineLabel` override (§11).
- **Multi-product tab** → row labelled by **`displayName`** (e.g. SADOLIN's stacked brands "2K PU Gloss - 90 Base", Aquatech). So flat/multi rows must carry the base in `displayName` ("Texture - 90 BASE", "Magik - 90 Base"), or two rows look identical.
- **Cross-family combined tab** builds rows via `families.flatMap(f => products.filter(p => p.family === f))` → **row order across families follows the tile's `familyNames` sequence**, NOT menu `sortOrder` (sortOrder only orders *within* a family).
- **Same product + same base = collision** (both rows grab both packs). Keep variants distinct by a distinct product key (e.g. grains as separate products Texture / Texture 2MM / Texture 3MM; M900 GLOSS vs GLOSS).

**Family card selection:** speed-dial tile maps to `family === tile.familyName` (or any of `familyNames`). Grouping is data-only — no rendering code change needed to reshape a family. Tiles missing a matching family → empty card.

**Pack header:** single-line, 10.5px. Format `{pack} · {containerLabel}`. Container label mono gray-400.

**Pack columns:** explicit 80px width via `style={{ width: "80px" }}` on each `<col>` in colgroup. `table-layout: fixed`.

**Pagination:** `VARIANT_GRID_PAGE_SIZE = 20`, `VARIANT_GRID_PAGINATION_THRESHOLD = 22` (page-size + 2 buffer so an 18-row tab isn't paginated and there are no 1-row trailing pages). GLOSS (38) still paginates. `multiProductTab` is computed over the FULL tab in `family-nav-with-tabs.tsx`, not the paginated slice. Page dots in card header for mouse. `Shift+PageDown`/`Shift+PageUp` for keyboard. Unshifted `PageDown`/`PageUp` cycle sub-products within family.

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

**`product ?? subProduct` is the fallback chain for THREE consumers:** the pack-join (route), the email name (`email.ts`/`emailLineLabel`), and search. So when `product` is null, a `subProduct` that doesn't match the stock `product` silently **mis-bills, mis-joins, AND mis-searches** while the cart (which labels by `displayName`) still looks correct.

**Alignment rule (Primer Int/Ext fix, 2026-06-09):** for any multi-product family that joins via the `subProduct` fallback (Int/Ext, variants), `subProduct` MUST equal the stock `product` for the intended side. Verify cart label ↔ `subProduct` ↔ `stock.product` alignment whenever such a family is built or rebuilt. (The 2026-06-08 Primer rebuild shipped the two PRIMER rows with `subProduct` swapped vs `displayName` → Int cards joined Exterior stock and emailed the wrong SAP, invisible because both share 1/4/10/20L. Operational audit of Primer orders in that window is open — ROADMAP.)

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

Helper `packContainerLabel(pack)` returns `"box 12" | "box 6" | "box 4" | "drum" | "bag" | "can" | null`.

`formatPack`, `packToMl`, `packStep`, `sortPacksForDisplay` are all in `lib/place-order/pack.ts`. The mobile `/order` page imports from there too (in-page copies removed in the 2026-05-29 v2 migration).

**Carton/box size is a SHARED per-pack constant** (`PACK_STEP_MAP` + `PACK_CONTAINER_MAP`), keyed by pack LABEL — NOT per-SKU. Changing one label ripples to every product carrying that pack — check blast radius first. (`100ML` carton is 24, set 2026-06-02.) The `piecesPerCarton` column on `mo_sku_lookup_v2` exists but is dead weight (no route selects it, grid never reads it); if cartons ever diverge for the same pack, the fix is to prefer `piecesPerCarton` with the map as fallback ("Option B", parked).

**Piece/box packs (TOOLS, 2026-06-08):** `unit="PC"`, `packCode="25"` (rollers) / `"12"` (brushes) → distinct lookup keys `25PC`/`12PC`. `formatPack` PC → **"1 pc"**; `PACK_CONTAINER_MAP` `25PC`→"box of 25", `12PC`→"box of 12". New helper **`packStepForPack(packCode, unit)`** (with `PIECE_BOX_STEP { "25PC":25, "12PC":12 }`) **delegates to the label-keyed `packStep` for every non-PC pack** (paint byte-identical); used by desktop `variant-grid.tsx` AND both mobile renderers. Distinct keys are what let two carton sizes coexist (the label-keyed map couldn't carry both).

**New pack step defaults to 1** when the label isn't in `PACK_STEP_MAP` — so a per-unit pack like the Spray Paint **400 ml can** (`formatPack(400,ML)→"400 ml"`, `PACK_CONTAINER_MAP["400ML"]="can"`) needs no `packStepForPack` edit.

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

Plain-text body, units written directly (no box conversion). Send opens `mailto:{recipient}?subject=...&body=...` (URL-encoded). No POST, no DB row.

**Recipient (live constants `ORDER_TO`):** `/po` (`app/po/po-page.tsx`) and `/place-order` (`lib/place-order/email.ts`) → **`surat.depot@akzonobel.com`** (AkzoNobel auto-forwards to the `surat.order@outlook.com` parser inbox — the parser `OutlookAccount` is unchanged). Frozen `/order` keeps `surat.order@outlook.com`. No env/config indirection.

**THREE builders, ONE name source.** `lib/place-order/email.ts` (desktop), `app/po/po-page.tsx` (inline), `app/order/page.tsx` (inline) all route the product-line NAME through the shared exported helper **`emailLineLabel(product, baseColour, subProduct)`** for byte-parity. Edit the name once. (The pack/qty suffix is built per-surface.)

`emailLineLabel` rules, in order:
1. **PROMISE PRIMER special-case:** `product==="PROMISE PRIMER" && baseColour` → `baseColour.startsWith("Promise") ? baseColour : "Promise "+baseColour"` (avoids "PROMISE PRIMER Promise Primer"; grid still labels by baseColour so a data rename was rejected).
2. **General de-double:** `name = product ?? subProduct`; if `baseColour` ⊇ `name` (case-insensitive) → return `baseColour` (fixes product-name-in-base doubling, e.g. Duwel "ACRYLIC DISTEMPER DUWEL ACRYLIC DISTEMPER").
3. Else `"{name} {baseColour}"`.

**`emailCase()` — proper-case product names [LIVE 2026-06-19]:**

Applied inside `renderOrderBody` to the output of `emailLineLabel(...)` only — the per-line product name. Composition: `emailCase(emailLineLabel(product, baseColour, subProduct))`. All other email elements (header lines `Bill To:` / `Dispatch:` / etc., customer name, pack string) are untouched. Email-display only; no data change, no reseed.

**Rule — split on non-alphanumeric separator runs; for each token:**
1. Contains a digit → **UPPERCASE** (`5IN1`, `M900`, `3IN1`, `2K`, `1K`, `10MM`, `BU1`…)
2. ≤2 letters → **UPPERCASE** (`WS`, `VT`, `PU`, `NC`, `UP`, `DA`…)
3. Uppercase form in `KEEP_CAPS_3` → **UPPERCASE**
4. Else → title-case

```
KEEP_CAPS_3 = ["GVA","FBC","IBC","WBC","FFR","GRN","LFY","MAG","OXR","TBL","YOX","NCR","VAF","WRP"]
```

The 2-letter and digit-bearing codes are handled by the rule itself (no list to maintain). `KEEP_CAPS_3` holds only 3-letter, no-digit codes that collide with real 3-letter words — derived from a full audit of 464 distinct email names. Real 3-letter words correctly go proper: Red, Oak, Int, Ext, Max, Gun, Neo, Off, Pro, Sky, Bus, Glo. **If a new 3-letter code appears in the catalog later, add it to `KEEP_CAPS_3`; run a before→after name dump first — `NCR` looked like a code but is "Delhi NCR" (region) and must stay caps.**

**Line-number alignment — figure space ` ` [LIVE 2026-06-19]:**

```ts
padWidth = String(bill.lines.length).length
`${String(i + 1).padStart(padWidth, " ")}. ${emailCase(line.name)} - ${line.packString}`
```

- Serial number restarts per bill; `padWidth` is per-bill (its own line count). ≤9 lines → no pad; 10+ → pads to 2; 100+ → 3.
- **Pad character MUST be ` ` (FIGURE SPACE), NOT a regular space.** A regular space lines up in the in-app preview (monospace font) but fails in the actual mail client — email bodies render in a proportional font (Outlook/Gmail) where a space is narrower than a digit, so ` 9.` never reaches the `10.` column. Figure space is exactly one digit wide and non-collapsing. **Always test column alignment in a real mail client, not the preview.** All three mailto builders URL-encode the body so ` ` → `%E2%80%87` and survives the handoff.

**`renderOrderBody` is the single builder for all three surfaces:** `emailCase` + figure-space padding apply uniformly. Desktop `/place-order` goes via `buildEmail` → `renderOrderBody` → `buildMailtoUrl`; mobile `/po` goes via `buildEmailParts` → `renderOrderBody`; public `/order` goes via its local `buildEmail` closure → `renderOrderBody`. If `/po` looks unchanged after an email-format deploy, suspect **PWA cache** (force-close / reinstall), not the code.

**Two ways to fix an email name — pick by side-effect:**
- **Product rename (structural):** bakes the name everywhere (email, recall, search subtitle, alias key). Needs the rename on **both** join sides (stock source CSV/overrides + `CONFIRMED_SUBPRODUCT_MAP`) **+ paired reseed**; and if the product carries numeric-base aliases, **re-key its `base-aliases.ts` block in the same change** (aliases are keyed on `product`) or the friendly names silently vanish. Use when the new name is the real product name (WS Tile/Metallic, VT ranges, Interior WBC).
- **`emailLineLabel` override (code-only):** email-only, no reseed, reversible. Use when a data rename would break the grid (Promise Primer labels by baseColour) or only the email needs it.

**Unified `/po`-format lines (desktop now uses the shared `buildEmail`):** emitted only when set — `Dispatch: Urgent` / `Dispatch: Call to SO|Dealer`; a remark line (`Truck order` / `Cross billing from {depot}` / `Bounce order` / `DTS order`); a Notes line; a Ship To line (omitted when "same as billing"). A plain order (Normal + no remark + no notes + ship-to same) is byte-identical to the prior output.

**Email body is RAW.** Display aliases / shade codes (§12) are NEVER inserted. The mail parser sees `WS MAX 94 BASE`, not `WS Max · Accent`. Parser owner accepts ~90% v2-name match — full cutover is Stage 3 (§19).

---

## 12. Base-name aliases (display + search)

**Module:** `lib/place-order/base-aliases.ts` — single source of truth.

```ts
export type BaseAlias = { display: string; search: string[]; label?: string };
// keyed: product (SAP-clean name, e.g. "WS MAX") -> baseColour ("90 BASE") -> BaseAlias
export const BASE_ALIASES: Record<string, Record<string, BaseAlias>> = { ... };
export function getBaseAliasDisplay(product, baseColour): string | null; // -> .display
export function getBaseAliasLabel(product, baseColour): string | null;   // -> .label
```

Lives under `lib/` (no React) so it is importable by BOTH the frontend (display) AND the seed script (search words).

**The alias is a single hook for a "name · X" suffix + a searchable token + an optional full-name `label`:**
- `display` → the muted grid/result suffix (`Black · 108`, `90 BASE · Intermediate`).
- `search` → baked into `searchTokens` (§7.8 token-bake) so the alias/code words are findable.
- **`label?`** (2026-06-14) → a human full name shown in a *different place* from the grid suffix — currently the mobile `/po` subtitle one shade lighter than "Dramatone" (`getBaseAliasLabel`). Used for STAINER Machine Tinter (abbrev `YOX · 101` in the grid, full "Yellow Oxide" in the subtitle + searchTokens). Families whose title already shows the full name carry no `label`.

### Product-join-key requirement (the gating rule)

`getBaseAliasDisplay`/`getBaseAliasLabel` and the §7.8 token-bake are **all gated on a non-null `product`**. Families that join via the `subProduct` fallback have `product = NULL` → aliases are **dormant**.

**Dormant-alias recipe (reusable):** add an **identity key** to `CONFIRMED_SUBPRODUCT_MAP` (`"PRODUCT": "PRODUCT"` → self) so `product = subProduct` (non-null), ensure the `base-aliases.ts` block exists, then menu reseed. The join is unchanged (product == subProduct = same key string), packs still resolve, count is steady. Free bonus: setting `product` also fires the §7.8 bake → alias words become searchable. (Used to light up VT ranges, PU Enamel, Universal Stainer, SuperCover/SuperClean, etc.)

### Coverage + canonical base→name map

Most colour-bearing families now carry alias blocks (WS family, Satin, Promise emulsions, Velvet Touch 6 ranges, SuperCover/SuperClean incl. Pastel/Pro, Lustre, the STAINER code maps, …). **Canonical numeric base → name (reuse this):**

| Base | Name | | Base | Name |
|---|---|---|---|---|
| 90 | White | | 96 | Yellow / YOX |
| 92 | Intermediate | | 97 | Red / ROX |
| 94 | Accent | | 98 | Vibrant Yellow |
| 95 | Deep | | 99 | Vibrant Red |

93 / Brilliant White / named shades (Pastel, Rare Pearl Copper/Green, Basecoat) → no alias. **⚠️ 96/97 naming is inconsistent across the codebase** — WS + Satin use "YOX/ROX" (oxide names); SuperCover and the VT/Lustre ranges use plain "Yellow/Red". Standardise in the final consistency pass (deferred — ROADMAP).

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

**Rule:** what you see on the row is what you can type to find. If a product looks like "WS Max — Accent" the search should accept "accent". Bake any new alias into `searchTokens` via the seed. ⚠️ Display renames change search — `displayName` is in the haystack, so dropping a brand prefix can demote a product (this is why dropping "VT " from Velvet Touch displayNames demoted it under "VT" until the keyword-family map below fixed it).

### Keyword → family-default map

**NEW `lib/place-order/keyword-family-map.ts`** (pure TS, no React — like `base-aliases.ts`, so both rankers share one module → mobile == desktop, no drift). `KEYWORD_FAMILY` maps a word → family; `getFamilyDefaultForQuery(query)` normalises (trim → lowercase → collapse spaces) and returns the family **only on a whole-query match** (so "vt pearl" / "vt clear coat" fall through to normal ranking). Both rankers call it after normal ranking: on a hit `F`, result = `[F-rows by sortOrder asc] ++ [all other matches in normal order]`, sliced to limit — **promote-only, nothing dropped/hidden**. This is the §19 universal-keyword-layer precursor. Both search payloads + both `Product` types carry `sortOrder` so the promoted family orders by tab order. Current promotions include: vt/velvet touch → VELVET TOUCH; sadolin/woodcare → SADOLIN; supercover/superclean/3in1; distemper/magik/duwel; putty/texture/rustic; tools/roller/brush → TOOLS; spray/aerosol → SPRAY PAINT; m900; etc.

### Variant-qualifier tabs are NOT colours

SmartChoice / Primer tabs carry a use-case label in `baseColour` ("Interior", "Int Primer"…), not a colour. The scorer's colour-base bonus (`+50` when a query word is a substring of `baseColour`) wrongly promoted them ("int" matched SmartChoice's "Interior"). Fix: **exempt `isVariantQualifierTab` rows from the colour-base bonus** in BOTH `mobile-search.ts` and `queries.ts` — surgical, zero blast radius on other families. (`isVariantQualifierTab` lives in `sub-product-descriptors.ts`, §UI two-line display.)

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

### `loadXMap()` CSV-authoritative loader (Sadolin / Tools / SuperCover / SuperClean / Distemper / Texture+Putty / Remaining-5)

For a family rebuilt from a reviewed CSV, add a per-family `loadXMap()` to `v2-sku-seed-from-legacy.ts` reading `docs/SKU/review/{family}-final.csv` (quote-aware parse). **The CSV wins** over NAME_OVERRIDES and legacy on `category / product / baseColour / isPrimary / pack` — and, for Sadolin onward, **`description`** too (Path B: `description: csv ? csv.description : legacy.description`, a no-op for rows whose CSV col matches legacy). The CSV is the durable source — any direct live SQL edit must be mirrored back into the CSV (and the menu JSON regenerated) or the next reseed reverts it.

**Three ways a CSV controls family membership:**
- **stray-demote** (SuperCover/SuperClean): any family stock row NOT in the CSV → `isPrimary=false` (hidden, kept in DB). Best practice: also add the stray to the CSV as an explicit hidden row.
- **allowlist-DROP** (Distemper): the CSV is the *complete* allowlist; any family row not in the CSV is **physically dropped** (`category===X && !allowlist.has(material) → continue`). Use when a family should lose SKUs on reseed.
- **build-from-CSV:** KEEP materials absent from legacy are constructed straight from the CSV (product/base/pack/desc/isPrimary), via a per-family build loop (the Sadolin "2f" / Tools "2g" pattern). Creates net-new SKUs.

### MAP-vs-INJECT pre-check (mandatory before adding ANY SKUs)

1. Check if the materials already exist in **legacy** (even hidden by `HIDDEN_BY_CATEGORY`).
2. **If present → MAP** (un-hide + translate). Remove the category from `HIDDEN_BY_CATEGORY` **and** add a `cat === "X" → row(family, subProduct, baseColour)` branch in `mapLegacyToNew` (removing from the hidden set alone falls through to `null`). Stock writes `category = family` and `product = subProduct`, so the family set + product re-key happen for free, legacy base kept. Never hand-write a CSV for these — it duplicates SAP data and drifts (e.g. `White` vs real `BRILLIANT WHITE`).
3. **If genuinely absent → INJECT** (the Tools build-from-CSV path).

Spray Paint + M900 Gloss were both MAP (already hidden in legacy). **`HIDDEN_BY_CATEGORY` is seed-only** (imported by seed/preview scripts, NOT the live v1 PowerShell parser) — current contents **`{AUTO, DUCO, TOOLS}`**. Un-hiding affects the v2 catalog + outgoing email only; making the parser agree is a separate legacy `mo_sku_lookup` re-key (rides the parser→v2 migration).

### `EXPECTED_TOTAL_NEW_ROWS` (source) ≠ live menu table (deduped)

`EXPECTED_TOTAL_NEW_ROWS` counts SOURCE rows pre-dedup; the live `mo_order_form_index_v2` is the deduped count (~454). They are different numbers — cleaning duplicate source rows drops the counter without changing the live table. Don't conflate.

### New-family checklist

1. **Stock:** `loadXMap()` + build loop in `v2-sku-seed-from-legacy.ts` (or the MAP branch) + bump `EXPECTED_TOTAL_NEW_ROWS`.
2. **Menu rows** into `taxonomy-preview.json` (hand-maintained — keep `taxonomy-mapping.ts` in step).
3. **`FAMILY_TO_SECTION[…]` AND `FAMILY_TO_SUBGROUP[…]` — HARD GATE.** Missing either crashes the LIVE insert mid-seed and the dry-run does NOT catch it. (Folding a sub-product into an existing family skips this.)
4. **uiGroup assign loop** in §7.7 — tabs (per-row uiGroup) vs flat (single uiGroup); for code-bearing/abbrev families use `sortOrder = tab-base + code` (the offset sets tab order, `+code` sets within-tab row order — one scheme, both jobs).
5. `CONFIRMED_SUBPRODUCT_MAP` identity/rename keys (unlocks aliases + bake).
6. `keyword-family-map.ts` promotion (§13).
7. Speed-dial (`quick-tiles-config.ts`) — locked at 9; swap a tile or stay search-only.
8. If a new pack type: `pack.ts` (`formatPack`, `packStepForPack`/`PIECE_BOX_STEP`) + `pack-buckets.ts` disjoint bucket + `PACK_CONTAINER_MAP`.

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
  page.tsx                          public mobile route (single-file) — FROZEN backup
app/po/
  po-page.tsx                       going-forward depot mobile PO (§25) — single-file

lib/place-order/
  constants.ts
  quick-tiles-config.ts             9-tile config (+ optional familyNames multi-family tile)
  pack.ts                           PACK_STEP_MAP, PACK_CONTAINER_MAP, packToLitres,
                                    formatPack, packToMl, sortPacksForDisplay,
                                    packStepForPack/PIECE_BOX_STEP (PC packs)
  pack-buckets.ts                   desktop column buckets — STANDARD_COLUMNS,
                                    PACK_TO_BUCKET, FAMILY_BUCKET_OVERRIDES,
                                    packToBucket, bucketColumnsForTab/ForRows (§24)
  cart.ts                           CartLine type, setQty, volume reducer, touchedAt
  draft.ts / draft-storage.ts       localStorage hydrate/save, TTL, DraftSnapshot
  email.ts                          buildEmail + renderOrderBody + emailLineLabel (shared name source) + emailCase()
  recents.ts                        desktop device-local recent customers (§25)
  search.ts                         legacy multi-token scoring (still used in places)
  queries.ts                        searchProducts (desktop) — reads searchTokens
  base-aliases.ts                   single source: display + search + label aliases
  mobile-search.ts                  rankProductsForQuery scoring
  keyword-family-map.ts             whole-query word→family promotion (shared) (§13)
  sub-product-descriptors.ts        two-line descriptors + isVariantQualifierTab +
                                    getSecondLine / isVariantQualifierTab (§UI)

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

**Backup tables convention:** `mo_order_form_index_v2_bak_YYYYMMDD[suffix]`, `mo_sku_lookup_v2_bak_YYYYMMDD[suffix]`.

**Backup policy (refined 2026-06-09):** ONE backup at session start as a catastrophe fallback. **Skip per-change backups** for changes that are dry-run-verified AND fully reproducible from the committed seed/CSV — the real recovery is *re-running the seed* (git/seed is source of truth), not a snapshot (an early snapshot can't cleanly undo one later change anyway). **Keep a backup only** for non-reproducible / risky ops (schema changes, anything not seed-driven).

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
- **THREE mobile/desktop order pages — change all the relevant ones.** `/order` (frozen public, no buckets), `/po` (going-forward depot, own `PackRows`, no buckets), `/place-order` (desktop, bucket columns). Each mobile page has its OWN `PackRows` + step call sites; a pack/render change must be repeated on every live surface. Mobile renders every pack straight from the API (no buckets); buckets are desktop-only.
- **Desktop columns are a fixed bucket set, not the pack union** (§24). A pack whose `packCode+unit` key is missing from `PACK_TO_BUCKET` is **silently dropped on desktop only** — looks like "works on phone, blank on desktop". Two packs on one product that map to the same bucket **collide** (one hidden).
- **Base aliases / shade codes / token-bake are gated on non-null `product`** (§12). Null-product families (join via `subProduct`) show no aliases until given a `CONFIRMED_SUBPRODUCT_MAP` identity key.
- **Aliases are keyed on `product`.** A product rename that carries numeric-base aliases must re-key the `base-aliases.ts` block in the same change, or the friendly names silently vanish.
- **`product ?? subProduct` mis-bills silently** (§8). On a null-`product` family, a `subProduct` ≠ stock `product` mis-joins, mis-emails, AND mis-searches while the cart (labels by `displayName`) looks fine. Verify cart ↔ subProduct ↔ stock.product on any multi-product family.
- **Desktop cart labels by `baseColour`; empty string (`""`) blanks the line** (not nullish, so `"" ?? x` returns `""`). Fall back to `emailLineLabel`. `/po` cart labels by `displayName` and never blanks.
- **Email name is single-source via `emailLineLabel`** across all 3 builders (§11). Fix names there once; don't diverge a single builder.
- **Family-scoped pack placement, not global** (§24). KG sizes are shared across AQUATECH/PUTTY/SADOLIN/VT SPECIALTY/PROMISE/DISTEMPER (most fold KG→litre columns). A global KG remap breaks them all — scope via `FAMILY_BUCKET_OVERRIDES`.
- **iOS/Android keyboard work writes height only** — §22-of-old reaffirmed: never use `visualViewport` offset / `translateY` / per-scroll-tick math to place sticky bars; write the measured height to `--vvh` behind a height-change guard; `scrollIntoView` is the only allowed focus mechanism (§25).
- **`scripts/_*` excluded from typecheck.** `tsconfig.json` `exclude` contains `"scripts/_*.ts"` and `"scripts/_tmp/**"` — scratch scripts from old sessions had type errors that blocked `next build` ~3 times. Convention going forward: underscore-prefixed scripts = scratch = excluded from the typecheck gate. Do not delete scratch files; they stay but are ignored by tsc.
- **Keep reports lean / time-box.** A CSV-gen run once rabbit-holed ~53 min on a cosmetic distemper-report regex while the CSV was already correct — keep verification reports lean, time-box, STOP and report.

---

## 23. Catalog families — current structure

Speed-dial tiles and their tabs (desktop). Mobile is search-first (ignores tabs/uiGroup).

| Tile | Family / familyNames | Tabs |
|---|---|---|
| 1 GLOSS | GLOSS (carries 2 products: Gloss + M900 Gloss) | BASE · COLOUR · M900 |
| 2 Satin & PU | SATIN + PU ENAMEL | Satin Finish · Satin Stay Bright · PU Enamel · Lustre |
| 3 PROMISE | PROMISE (own dedicated section) | Enamels · Int · Ext · Sheen Int · Sheen Ext · SmartChoice · Primer (7) |
| 4 WS | WS | Max · Powerflexx · Dustproof · Rainproof · Hi-Sheen · Tile & Metallic · Floor Plus (7) |
| 5 VELVET TOUCH | VELVET TOUCH | Pearl · Platinum · Diamond · Eterna · Eterna Matt · Eterna Hi-Sheen (6) |
| 6 SADOLIN | SADOLIN (WOODCARE section) | Gloss · Matt · Sealer · Thinner · Lacquer/Varnish · Filler/Stain (6) |
| 7 STAINER | STAINER | Universal Stainer · Machine Tinter · Acotone · GVA / PU |
| 8 Putty & Primer | PRIMER + DISTEMPER + TEXTURE + PUTTY | Primers · Distemper · Texture & Putty |
| 9 AQUATECH | AQUATECH | (multi-product; KG/GM packs — §24) |

**Family-shape patterns:**
- **WS** = one branded line with finish-grade sub-products (Max / Powerflexx / Protect Dustproof / Rainproof / Hi-Sheen) authored by `WS_CONSOLIDATE` / `CONFIRMED_SUBPRODUCT_MAP` / `WS_TAB_LABEL` in the **menu seed** (`v2-catalog-seed-from-preview.ts`), NOT the SKU seed. "Protect" is the conceptual parent; Dust/Rain/Hi-Sheen are flat siblings (the shared "Protect" lives only in the tab label). Tile/Metallic/Floor Plus folded in 2026-06-14.
- **ENAMELS** are each their own family (Gloss, Satin, Promise Enamel, PU Enamel) — the *section* is the grouping. Only WS uses the nested-sub-product pattern.
- **Cross-section brand family = its own section + family tile** (PROMISE). The tile is the real entry; the section is just the browse-all bucket.
- **SADOLIN** (ex-WOODCARE): brand-scoped products (`2K PU GLOSS`, `LUXURIO MATT`, `HYDRO PU GLOSS`…) so finish labels don't pool across brands; multi-product tabs label rows by `displayName`; short base values `Int Clear`/`Ext Clear` kept byte-identical between both v2 tables (mobile `productLabel` appends `baseColour` only if `displayName` doesn't already contain it).
- **M900 Gloss** = a 2nd product folded into GLOSS via a `subProduct → uiGroup` sub-case in the family's §7.7 branch (5 files; no section/subgroup, no new pack). Same family-of-products shape as WS.

**Single-base / variant tabs** (Promise SmartChoice, Promise Primer): no colour range → the *variant* goes in the `baseColour` slot, the qualifier renders on the **second line** (not a line-1 alias suffix); when the variant name already contains the tab word ("Primer"), drop the tab prefix (show the variant's own name). Helpers: `isVariantQualifierTab()` + `getSecondLine()` in `sub-product-descriptors.ts`. These tabs are exempt from the colour-base search bonus (§13).

---

## 24. Desktop pack buckets — `pack-buckets.ts`

The desktop variant grid builds columns from a **fixed bucket set**, not the raw pack union (the route only sorts/dedups raw packs; bucketing is entirely frontend). Mobile `/order` + `/po` do NOT import this file — they render every pack via `formatPack`, which is why a missing bucket looks like "works on phone, blank on desktop".

- **`STANDARD_COLUMNS`** — fixed ordered set (`50ML … 20L, 25KG, 30KG, 40KG`, plus disjoint `400ML`, `25PC`, `12PC`).
- **`PACK_TO_BUCKET`** — **global** map `packCode+normalisedUnit` → a standard column. A key NOT in the map returns `null` → **no column, no cell, silently dropped on desktop.** Global additions are safe only when the size belongs to a narrow set of products (e.g. `400GM→500ML`, `3KG→4L`, `15KG→20L`). Disjoint/identity buckets (`25PC`, `12PC`, `400ML`) map to themselves (lookupKey == bucket, no stray hint) so two carton sizes can coexist.
- **`FAMILY_BUCKET_OVERRIDES`** — family-scoped placement, checked **before** the global map. `packToBucket(pack, family?)` / `bucketColumnsForTab(packs, family?)` take an optional family. Use this (not a global edit) when placement must differ by family — e.g. AQUATECH `25KG→20L` (VT Concrete Finish keeps its own 25KG column, no collision), and DISTEMPER's KG columns (1/2/5/10/20 KG are also carried by AQUATECH/PUTTY/SADOLIN/VT SPECIALTY/PROMISE which deliberately fold KG→litre — a global remap would break them all).
- **`bucketColumnsForRows(rows {packs, family})`** — for **multi-family combined tabs**: buckets each row by its OWN family and unions the columns; cell placement uses `product.family`, not a single tab-family. Single-family tabs are byte-identical. (Built for Texture+Putty; VT Specialty would reuse it.)
- The grid is **derived-from-present-packs** (`STANDARD_COLUMNS.filter(present)`) → columns never appear empty.

**Two packs on one product mapping to the same bucket collide** — one is silently hidden. Watch any product carrying two sizes that land in one column. A pack with an empty `packCode` is dropped by the route before bucketing (hidden everywhere incl. mobile — a data fix, not a bucket fix).

---

## 25. `/po` — going-forward depot mobile PO

All work in **`app/po/po-page.tsx`** (single file). `/order` is the frozen reference. `/po` email intentionally diverges (§11). Eventual cutover: rename `/po` → `/order`.

### Bills model
`bills: Bill[]` where `Bill = { id, lines }`; `activeBillId`; `billCounter`. **Invariant: `id === position + 1`.** Anything touching the bills array must preserve it.
- **Add / Delete / Duplicate** bill from an always-visible bill bar (desktop `/place-order` matched this 2026-06-09 via `renumberBills()`). Delete: renumber 1..n (no gaps), repoint `activeBillId`; confirm sheet only when the bill has lines (empty deletes instantly); disabled at 1 bill. Duplicate: **deep-copy** each line + its nested `packQtys` (`CartLine` is scalars + one nested map — spread both), insert after source.

### Review & options
Order-level (one set per multi-bill send): **Dispatch** (Normal · Urgent · **Call**, Call last; "Call" requires an SO/Dealer target via a sheet → email "Call to SO/Dealer"), **Remarks** 2×2 (Truck / Cross / Bounce / DTS, re-tap clears; Cross opens a depot picker Dahisar/Ahmedabad/Rajkot/Pune), **Notes** (free text + Quick-add presets), **Ship-to** (autocomplete; omitted from email when "same as billing"). "Hold" dispatch is removed (stale drafts coerce to "Normal" on restore). Desktop options panel is always-open (no "More options" collapse).

### Browser-history back-nav (the single back authority)
Android hardware Back and iPhone edge-swipe step *back through screens* instead of exiting. **Every forward screen and every overlay pushes exactly one `pushState` entry; every back (hardware/swipe/in-app button) goes through `history.back()` → one popstate handler closes the topmost layer.** Refs: `depthRef` (entries above base), `suppressPopRef` (ignore programmatic pops), `navStateRef` (live screen state so the handler never reads a stale closure). Initial load = base entry = landing (never pushed). **Adding any new screen/overlay MUST: push on open, close via `history.back()`, and be added to both the popstate branch and `navStateRef`** — or Back skips/strands. (The Call sheet is the worked example.) Back-on-build-with-lines raises the change-customer discard confirm (Cancel re-pushes a build entry; Discard → landing).

### iOS / Android keyboard (height-only — §22-safe)
- `<main>` is `height: var(--vvh); flex flex-col overflow-hidden` with ONE `flex-1 min-h-0 overflow-y-auto` scroll area + ONE `flex-shrink-0` footer sibling. `--vvh` updater listens to `visualViewport` resize **+ scroll** behind a height-change guard (`lastH`) so a plain scroll is a no-op (no search drift) but the keyboard's late re-measure is captured.
- **`keyboardOpen` state** (derived from height: `fullH - h > 120`, debounced ~100ms) gates ALL floating footers — never `inputFocused` (Android keyboard-dismiss doesn't blur the input). `inputFocused` is still set but read by nothing.
- On qty/field focus: scroll the whole `[data-product-section]` / `[data-field-section]` to the top of the scroll area on a double-rAF (the top is always above the keyboard regardless of iOS timing). Hide the Add/Send pill while a qty/field is focused.
- **Send-path ordering:** `window.location.href = mailto:` must fire FIRST in the tap gesture; a synchronous `history.go()` in the same tick cancels the external handoff on mobile → defer any history reset via `setTimeout(…, 0)` (`depthRef`/`suppressPopRef` still set synchronously to absorb the deferred pop).

### Recents
Device-local localStorage, saved **on Send** (not on select), dedupe by code, newest-first, cap 10. Desktop key `place_order_recent_customers`; `/po` key `po_recent_customers` (distinct). Grid shows only when no customer selected AND search empty AND recents non-empty. Server-side per-user recents deferred (ROADMAP).

### Android shell / polish
Manifest `display_override: ["standalone"]`; `html,body { overscroll-behavior: none }` (kills pull-to-refresh); scroll container `overscroll-behavior: contain`; reset scroll on `[mode, view]` change; `.po-page` scoped `touch-action: manipulation` (tap-delay, scoped so the rest of the app incl. `/order` is untouched). Android "browser-feel/zoom" was a stale-install symptom — a clean PWA reinstall fixed it, not config.

---

*Place Order v1.4 · Schema v27.9 · OrbitOMS*
