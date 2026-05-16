# Web update · 2026-05-12 · /place-order UI/UX redesign — v4 LOCKED

**Type:** Planning / design lock (precedes a code update)
**Status:** Design locked, awaiting Smart Flow approval to proceed to Claude Code execution prompt
**Branch:** `feat/place-order-page` (already pushed to origin with v2 catalog + v2 SKU + uncommitted section/subgroup work)
**Mockup:** `docs/mockups/place-order/desktop-order-redesign-v4.html` (to be copied from `/mnt/user-data/outputs/`)
**Supersedes:** v1, v2, v3 mockups — all design iterations from earlier in the 2026-05-12 session

---

## TL;DR

Three weeks of iteration on `/place-order` produced a 4-pane navigation layout (v2) that solved the wrong problem — operators don't want to *navigate* a 33-family catalog, they want to *type the thing they heard the customer say*. v4 replaces 4-pane navigation with a search-first 2-pane layout backed by a 9-tile speed dial.

---

## Why we threw out v1/v2/v3

**v1 & v2 (4-pane navigation):** section rail + family list + variant grid + cart. Looked impressive. Failed for tele-operators because:
- Forced operators to think in sections (UTILITY/INTERIORS/EXTERIORS) and pick before doing anything
- 4 panes = too many places focus could be at any moment
- Required learning a new keyboard model (`Esc` to navigate up, `[` `]` for sub-products, digit-as-family conflicting with digit-as-qty)
- Tele-operators don't memorise — they look or type

**v3 (sub-product tabs above the grid):** correct shift to search-driven, but assumed operators think in family→sub-product hierarchy. Real data showed operators (and customers) talk in sub-products directly — "Promise Enamel", "Pearl Glo" — not in family terms.

**v4 (search + speed dial + sub-product tabs only when needed):** matches operator mental model. Search handles long tail. Speed dial handles the 9 most-reached-for products. Tabs appear only when navigating into a multi-sub-product family.

---

## Locked design — v4

### Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Top bar: logo · Place Order · customer pill · operator                   │
├──────────────────────────────────────┬───────────────────────────────────┤
│                                      │                                   │
│  Big search bar (primary input)      │  Cart (340px, persistent)         │
│                                      │                                   │
│  Speed dial (9 tiles, top-9 labels)  │  Customer header                  │
│                                      │                                   │
│  Active panel:                       │  Lines grouped by sub-product     │
│  - Sub-product header                │  Hover line → × clear button      │
│  - Tab bar (only if family open)     │                                   │
│  - Variant grid (base × pack)        │  More options (collapsed)         │
│  - Hint footer                       │  Total                            │
│                                      │  Send Email button                │
│  Recently used (this order)          │                                   │
│  Last order recall (Repeat button)   │                                   │
│  Browse all 33 (collapsed)           │                                   │
│                                      │                                   │
└──────────────────────────────────────┴───────────────────────────────────┘
```

Left pane = `flex-1`, right cart = `w-[340px]`. Both inside `h-[calc(100vh-52px)]`. Left pane scrollable, max-width `920px` centered. Cart non-scrollable footer with scrollable line area.

### Speed dial — v1 locked configuration

```
Tile  Label                Type         Behaviour on click
──────────────────────────────────────────────────────────────────
1     GLOSS                family       → sub-product tabs → variant grid
2     SATIN                family       → sub-product tabs → variant grid
3     PROMISE ENAMEL       sub-product  → variant grid directly (no tabs)
4     MAX                  family       → sub-product tabs → variant grid
5     VT GLO               family       → sub-product tabs → variant grid
6     WOODCARE             section      → 7 woodcare families → tabs → grid
7     STAINER              family       → sub-product tabs → variant grid
8     PRIMER               family       → sub-product tabs → variant grid
9     AQUATECH             family       → sub-product tabs → variant grid
```

**Tile entity types:**
- `sub-product` (1 entity): opens variant grid directly
- `family` (7 entities): opens family page with sub-product tabs above variant grid
- `section` (1 entity, WOODCARE): opens section landing — shows 7 woodcare families as a mini speed-dial; user picks one which then opens with sub-product tabs

**Tile content:** number badge top-left (1-9), main label centered bold, parent/section subtitle in tiny grey below, in-cart dot top-right when any line for that tile exists in cart.

**Tile rendering:** `grid-cols-9 gap-2`, each tile `~98px wide × 78px tall`, white bg, gray-200 border. Active tile = teal-600 border + teal-50 bg + teal-shadow. Hover = teal-600 border + teal-50 bg + 1px lift.

### Navigation flows

#### Flow A — speed dial → sub-product (1 entity, no tabs)
1. Customer says "Promise Enamel BW 1L 5 box"
2. Operator presses `3` → PROMISE ENAMEL variant grid loads, focus on first cell
3. Operator arrows to BW × 1L → types `5` → cart updates
4. Customer continues; operator arrows to next cell or presses `Esc` to switch product

**Total keystrokes for one line:** 3-4. Time: ~2 seconds.

#### Flow B — speed dial → family (7 entities, with tabs)
1. Customer says "VT Glo Pearl Brilliant White 4L 3 box"
2. Operator presses `5` → VT GLO family page loads with tab bar `[1 PEARL] [2 PLATINUM] [3 DIAMOND]`, first tab auto-active, focus on first cell
3. Operator presses `1` → Pearl tab confirmed (or already active by default)
4. Operator arrows to BW × 4L → types `3` → cart updates

**Total keystrokes for one line:** 4-5. Time: ~3 seconds.

If customer says "Pearl Glo" by itself, operator types "pearl" in search → search picks the specific sub-product → variant grid loads directly (Flow A behaviour).

#### Flow C — speed dial → section (Woodcare, 1 entity)
1. Customer says "Luxurio PU Matt Brilliant White 4L 2 box"
2. Operator presses `6` → Woodcare section page loads with mini speed-dial showing 7 families: `[1 LUXURIO] [2 2K PU] [3 PU PRIME] [4 NC] [5 MELAMINE] [6 WOOD STAIN] [7 WOOD FILLER]`
3. Operator presses `1` → LUXURIO family page loads with sub-product tabs (LUXURIO PU MATT, LUXURIO PU GLOSS, etc.)
4. Operator presses `1` again or arrows → tab + variant grid → types qty

**Total keystrokes for one line:** 5-7. Time: ~4-5 seconds.

Acceptable because Woodcare ordering frequency is lower than other 8 tiles (no woodcare family cracked top 25 by line count). Most woodcare orders will go through search instead.

#### Flow D — search → sub-product
1. Customer says "Hisheen 20L 1 box"
2. Operator types "hi" in search → results list appears: HISHEEN, HISHEEN PRIME, etc.
3. Operator presses Enter on first result → variant grid loads
4. Arrow to 20L cell → type `1`

**Total keystrokes:** 4-5. Time: ~3 seconds.

#### Flow E — search → family with tabs
1. Customer says "promise" but ambiguous which one
2. Operator types "promise" → results list: PROMISE family, PROMISE ENAMEL, PROMISE INTERIOR, etc.
3. Operator highlights PROMISE family (top result) → Enter → family page loads with tabs
4. Operator presses tab digit → grid → qty

**Total keystrokes:** 6-8. Time: ~5 seconds.

#### Flow F — recently-used / last-order recall
1. Operator already typed something into PROMISE INTERIOR earlier this order
2. Recently-used list below the variant grid shows "PROMISE INTERIOR · 1 line in cart · click to edit"
3. Click → that sub-product's variant grid loads with existing qty cells filled

OR

1. Customer says "same as last time"
2. Operator clicks "Repeat order" button on Last-order-recall card
3. Cart populates with last order's lines (operator can adjust before sending)

### Keyboard model — final, simplified

| Focus location | Key | Behaviour |
|---|---|---|
| (page load) | — | Search box auto-focused |
| Search box | letters/digits | Filter results live |
| Search box | `↓` `↑` | Move highlight in results |
| Search box | `Enter` | Open highlighted result |
| Search box | `Esc` | Clear search, blur (or focus stays for next type) |
| Anywhere not in cell or search | `1`–`9` | Open speed-dial tile by number |
| Anywhere not in cell or search | `/` | Send Email |
| Variant grid cell | `0`–`9` | Type qty |
| Variant grid cell | `←` `→` `↑` `↓` | Navigate cells |
| Variant grid cell | `Tab` / `Shift+Tab` | Next/prev pack column (wraps to next/prev base row at edges) |
| Variant grid cell | `Enter` | Move to next base, same pack column |
| Variant grid cell | `Backspace` | Clear cell |
| Variant grid cell | `Esc` | Exit cell, focus returns to search box |
| Family-nav with tabs | `1`–`9` (sub-product tab range only) | Switch tab |
| Family-nav with tabs | tab arrow keys | Switch tab |

**No `[` `]`. No `*`. No modifier-key combos.** Eight key behaviours total. Operator who has used WhatsApp can use this.

### Visual language (from CLAUDE_UI.md v5.1)

- **Neutral aesthetic.** Gray-50/100 backgrounds. White surfaces. Black text. Refined minimalism.
- **Teal budget (the "ONE teal element" rule, applied loosely):**
  - Active speed-dial tile (teal-600 border, teal-50 bg, teal-shadow)
  - Focused qty cell (teal-600 outline, teal shadow ring)
  - Filled qty cells (teal-50 bg, teal-700 text)
  - In-cart dot indicators (teal-600)
  - Send Email primary CTA (teal-600 bg, white text)
  - Logo
  - Search bar focus state border (teal-500)
- **Gray-900 dark for the modal/secondary-active pattern:**
  - Active sub-product tab (gray-900 text, gray-900 bottom border)
  - Active dispatch/marker chip (gray-900 bg, white text)
- **Sub-products section subtitle font** uses `text-[10px] uppercase tracking-wider text-gray-400` consistently
- **Mono font** (`ui-monospace`) for SKU codes, qty values, line counts, timestamps

### Component anatomy (for the Claude Code prompt later)

**`<SpeedDialGrid>`** — renders the 9 tiles. Reads tile config from API.
**`<SpeedDialTile>`** — single tile, props: `number, label, parentLabel, type, hasCartLines, isActive, onClick`.
**`<ActiveProductPanel>`** — wraps either:
  - `<SubProductDirect>` (no tabs, just the variant grid) when tile type is `sub-product`
  - `<FamilyNavWithTabs>` (tab bar + variant grid) when tile type is `family`
  - `<SectionLanding>` (mini speed-dial of N families) when tile type is `section`
**`<VariantGrid>`** — base × pack table with editable qty cells, focus management, keyboard nav. Used inside both `<SubProductDirect>` and `<FamilyNavWithTabs>`.
**`<SubProductTabBar>`** — horizontal tabs with number badges + in-cart dots. Used inside `<FamilyNavWithTabs>`.
**`<RecentlyUsed>`** — list of sub-products this order has touched, ordered by most-recent.
**`<LastOrderRecall>`** — card showing customer's last order summary + Repeat button.
**`<BrowseAllFamilies>`** — collapsed `<details>` showing 33 families grouped by 6 sections.
**`<CartPanel>`** — right-side panel, sub-product-grouped lines, hover-clear, total, send button.

### Data contracts (API endpoints)

#### `GET /api/place-order/quick-tiles`
Returns array of 9 tile configurations.

```typescript
type QuickTile = {
  position: number;          // 1-9
  type: 'sub-product' | 'family' | 'section';
  label: string;             // "GLOSS", "VT GLO", "WOODCARE", etc.
  parentLabel: string | null;// "ENAMELS" for sub-product, null for sections
  // For sub-product: target sub-product key
  subProductId?: number;
  // For family: target family
  familyName?: string;
  // For section: target section, will resolve to N families
  sectionName?: string;
};
```

**Source for v1:** hardcoded array in `lib/place-order/quick-tiles-config.ts` matching the 9 above. Future: switchable to DB-backed query (by line volume, by user preference, by family filter).

#### `GET /api/place-order/family/:familyName`
Returns family + its sub-products + each sub-product's base × pack matrix.

```typescript
type FamilyResponse = {
  family: string;
  section: string;
  subProducts: Array<{
    subProduct: string;
    skuCount: number;
    bases: Array<{
      baseColour: string | null;
      skuCodeStub: string;          // "5921XXX"
      packs: Array<{
        packCode: string;           // "1L", "4L", "20L"
        packLabel: string;          // "1L"
        boxOf: number | null;       // 6, 4, 1
        skuCode: string | null;
        exists: boolean;            // false → grey-out / hide cell
      }>;
    }>;
  }>;
};
```

#### `GET /api/place-order/sub-product/:subProductId`
Same shape as family response but with single `subProducts` array of length 1. Used for direct sub-product opens (Promise Enamel tile, search-result direct hits).

#### `GET /api/place-order/section/:sectionName/families`
Returns the families belonging to a section (Woodcare-specific use case).

```typescript
type SectionFamiliesResponse = {
  section: string;
  families: Array<{
    family: string;
    subProductCount: number;
    skuCount: number;
  }>;
};
```

#### `GET /api/place-order/last-order/:customerCode`
Returns the customer's most recent mail order's lines (within 30 days), for "Repeat order" feature.

#### `GET /api/place-order/search?q=...`
Full-text search across families and sub-products. Returns array of either-or:

```typescript
type SearchResult =
  | { type: 'family'; family: string; section: string; subProductCount: number; skuCount: number }
  | { type: 'sub-product'; subProductId: number; subProduct: string; family: string; section: string; skuCount: number };
```

### What stays unchanged (DO NOT TOUCH)

- The mailto: email body output → must remain byte-identical to current `/place-order` output (parser depends on consistency)
- Cart panel mailto: build, dispatch chips, marker chips, ship-to override logic → preserve exactly
- All v2 catalog and v2 SKU table data → no schema changes
- The parser (`lib/mail-orders/*`) → untouched
- The `/order` public mobile page → untouched
- Mail Orders board → untouched
- Engineering rules (CLAUDE_CORE.md §3): no `prisma.$transaction`, all API routes `export const dynamic = 'force-dynamic'`, schema changes only via Supabase SQL editor
- Sidebar already hidden on `/place-order` via `(place-order)` route group → no change needed
- The uncommitted section + subgroup work on `feat/place-order-page` → must be bundled into the same commit as the redesign

### Section/subgroup work bundling note

The 2026-05-11 session left these changes uncommitted on `feat/place-order-page`:

- `mo_order_form_index_v2` schema additions (section + subgroup columns)
- Seed-script updates with `FAMILY_TO_SECTION` + `FAMILY_TO_SUBGROUP` + coverage assertion
- API/types changes threading both fields
- `category-grid.tsx` reworked to render sectioned + per-subgroup nested grids

In the v4 redesign, the **section + subgroup data is consumed differently**:

- `category-grid.tsx` becomes legacy / deletable since it's replaced by the search + speed-dial + recently-used + browse layout
- Section data is used by `<BrowseAllFamilies>` (the collapsed disclosure at the bottom of the page) to group the 33 families
- Subgroup data is used by the section landing flow (Woodcare) to organise the 7 woodcare families if they have meaningful subgroups
- The data foundation stays — we just route it to different components

The Claude Code prompt (next deliverable) will explicitly instruct: keep all section/subgroup DB+API+types work, delete `category-grid.tsx` and `expanded-panel.tsx` since they belong to the discarded v1/v2 layout, build the new components.

### Known data-quality follow-ups (not blocking redesign)

These were discovered during the speed-dial decision process. Park them, address later:

1. **YELLOW OXIDE and YOX recorded as separate `productName` values** for what is the same product. Should consolidate via `mo_product_keywords` so they roll up. Doesn't block redesign — search will still find both.

2. **GLOSS at 1,579 lines is suspiciously high** (3× the next item). Possibilities:
   - GLOSS is genuinely the depot's killer product
   - "GLOSS" being used as fallback `productName` when enrichment can't disambiguate
   - All gloss sub-products being collapsed into "GLOSS" by parser
   
   Worth a sample inspection of recent GLOSS-typed lines to see if this is real volume or aggregation noise.

3. **Stainers are recorded by colour** (Yellow Oxide, YOX, OXR), not by family — fragmenting the count. The taxonomy redesign (master taxonomy doc) intends STAINER as the family. Once the v2 catalog is fully populated, the redesign will show STAINER tile → tabs for each colour, which is the right model.

### Future modes for the speed dial

The implementation reads from `lib/place-order/quick-tiles-config.ts` for v1. The endpoint contract (`GET /api/place-order/quick-tiles`) is designed to support all of these without frontend changes:

- **Manual list (now):** hardcoded array
- **By order volume:** swap source to a SQL query result + scheduled refresh
- **By family filter:** filter to a specific section or family group (e.g. interiors-only operator)
- **Per-user preference:** join to a `user_quick_tiles` table for personalised dials

When Smart Flow asks "make the dial show Bankim's frequently-used products" the change is server-side only.

---

## Approval gate

This document captures the locked design. **Smart Flow approval needed before:**

1. The Claude Code execution prompt is written
2. Any code is touched on `feat/place-order-page`
3. The HTML mockup `desktop-order-redesign-v4.html` is copied into `docs/mockups/place-order/`

If approved as-is, next deliverable is the Claude Code prompt.

If revisions needed, list them and the doc updates.

---

*Web update · 2026-05-12 · /place-order UI/UX redesign v4 LOCKED · Smart Flow + Claude*
