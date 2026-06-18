# code-update · 2026-06-14 · Stainer shade-codes + Machine→Tinter rename + tab reorder

**Repo destination:** `docs/prompts/drafts/code-update-2026-06-14-stainer-shade-codes-tinter-rename.md`
**Fold into:** `CLAUDE_PLACE_ORDER.md` (+ a `base-aliases` label note) at next consolidation.
**Status:** Live in production. Commit `ae9115df` (`820f6377..ae9115df`).

---

## Goal

For the STAINER family on /place-order (desktop) and /po (mobile):

1. Show the **shade code** after each colour name and make the code **searchable** — for Universal Stainer, Machine, and GVA. (Acotone skipped — no code scheme.)
2. Rename **Machine Stainer → Machine Tinter** (product, tab, email).
3. **Sort each tab by code** and **reorder the desktop tabs**: Universal · Machine Tinter · Acotone · GVA / PU.
4. Machine's colours are stored as cryptic abbreviations (YOX, LFY…). Keep the abbreviation as the visible name + code (`YOX · 101`), but surface the **full name** two ways: baked into searchTokens, and shown in **lighter grey on the mobile /po subtitle** beside "Dramatone" (`Dramatone · Fast Red`).

---

## Mechanism (how the code rides without touching the join)

The grid (`variant-grid.tsx`) labels each STAINER row by `baseColour`, then renders ` · {getBaseAliasDisplay(product, baseColour)}` inline. So **the base-alias is the carrier**:

```
BASE_ALIASES[product][baseColour] = { display: "108", search: ["108"] }
```

→ renders **"Black · 108"** and (via the §7.8 bake) appends `"108"` into `searchTokens`. **One map, no baseColour change, join untouched.**

Caveat that shaped the build: `getBaseAliasDisplay` + the §7.8 bake are **gated on non-null product**. GVA and Machine already had `product` set; **UNIVERSAL STAINER had `product = NULL`** (joined via the subProduct fallback) → it needed a `CONFIRMED_SUBPRODUCT_MAP` **identity key** (`"UNIVERSAL STAINER": "UNIVERSAL STAINER"`) first, same as the PU Enamel / VT pattern, before its alias could fire.

**Codes come from a baked map, not live data.** The menu seed reads `taxonomy-preview.json` only (subProduct / baseColour / displayName / searchTokens) — no `material`, no `description` at build time. So the codes were decoded once (tables below) and baked into the alias blocks.

**Mobile full-name subtitle** uses a new optional `label` on the alias (single source — also the same words go into `search`). Mobile reads `getBaseAliasLabel(product, baseColour)`; if present, appends ` · {label}` in a span one shade lighter than the subtitle. Universal/GVA carry no label (their title already shows the full name), so nothing appends for them.

---

## Decode tables (baked map: baseColour → code)

**UNIVERSAL STAINER** (code = `material.substring(5,8)`, the `1XX` in `IN650**1XX**57`):

| baseColour | code |  | baseColour | code |
|---|---|---|---|---|
| YELLOW OXIDE | 101 | | FAST RED | 107 |
| FAST YELLOW | 102 | | BLACK | 108 |
| FAST GREEN | 103 | | FAST ORANGE | 110 |
| FAST BLUE | 104 | | FASTYELLOWGREEN | 111 |
| FAST VIOLET | 106 | | BURNT SIENNA | 112 |

**MACHINE → MACHINE TINTER** (code = `material.substring(5,8)` of `IN680**1XX**72`; baseColour is an abbreviation; full name from description for label + search):

| baseColour | code | full name |
|---|---|---|
| YOX | 101 | Yellow Oxide |
| LFY | 102 | Light Fast Yellow |
| GRN | 103 | Green |
| TBL | 104 | Pthalo Blue |
| WHITE | 105 | White |
| MAG | 106 | Magenta |
| FFR | 107 | Fast Red |
| BLACK | 108 | Black |
| OXR | 109 | Red Oxide |

**GVA** (code = number in description, e.g. "DPP-GVA 124 BLUE" → 124):

| baseColour | code |  | baseColour | code |
|---|---|---|---|---|
| RED OXIDE | 122 | | ORGANIC LEMON YELLOW | 146 |
| BLUE | 124 | | BRILLIANT WHITE | 147 |
| BLACK | 126 | | GREEN | 149 |
| YELLOW OXIDE | 127 | | FAST RED | 322 |
| ORGANIC ORANGE | 140 | | ORGANIC RED VIOLET | 480 |
| ORGANIC VIOLET | 142 | | | |
| ORGANIC MIDDLE YELLOW | 145 | | | |

ACOTONE skipped — bases (XY1, NO1, NO2…) stay as-is, no code.

---

## Files edited (5)

- **`lib/place-order/base-aliases.ts`** — extended the alias type with optional `label?: string`; added 3 blocks: `UNIVERSAL STAINER` and `GVA` as `{ display: code, search: [code] }`, `MACHINE TINTER` as `{ display: code, search: [code, fullname-lowercased], label: "Full Name" }`.
- **`scripts/v2-catalog-seed-from-preview.ts`** (menu seed, `CONFIRMED_SUBPRODUCT_MAP`) — added `"UNIVERSAL STAINER": "UNIVERSAL STAINER"` (identity, was null) and `"MACHINE STAINER": "MACHINE TINTER"` (rename). GVA already set.
- **`scripts/v2-sku-seed-from-legacy.ts`** (stock) — scoped rename `MACHINE STAINER → "MACHINE TINTER"`, **gated `category === "STAINER"`** (VT pattern) so both join sides move together; an unrelated non-STAINER "MACHINE STAINER" was verified left untouched.
- **`taxonomy-preview.json`** — Machine sub-product `uiGroup`; `sortOrder` per row = **tab base + code** (Universal 1000+code · Tinter 2000+code · Acotone 3000+running-index preserving internal order · GVA 4000+code) → sets **both** tab order and within-tab row order. GVA tab label kept "GVA / PU".
- **`app/po/po-page.tsx`** — mobile search-result subtitle: appends ` · {label}` in `text-gray-300` (lighter than the `text-gray-400` "Dramatone") at **both** result render sites (multi-select + pick-button); Machine only.

> **uiGroup note:** the live tab label is set in `STAINER_UI` (seed §7.7), **not** the preview's `uiGroup` (the transform ignores that). Used **uppercase `MACHINE TINTER`** to match siblings (UNIVERSAL STAINER, ACOTONE).

---

## Reseed + verify (live, all PASS)

No backup taken — every change is rebuildable from the seed/CSV + git, and the dry-run was clean (per the skip-backup policy).

**Reseed** (pooler 6543, sequential, **stock first**): stock wiped/inserted 1657→1657; menu validated (warnings=0) wiped/inserted 431→431.

| Check | Result |
|---|---|
| totals | stock 1657, menu 431, 0 dupes |
| Machine join | product `MACHINE TINTER` on stock(9) + menu(9); 9 bases → 9 packs join |
| Universal join | product `UNIVERSAL STAINER` on menu; 10 bases → 30 packs |
| searchTokens | Universal Black 108 · Machine FFR 107 + "fast red" · GVA Blue 124 |
| tab order | Universal · Machine Tinter · Acotone · GVA / PU |

Live grid renders "Black · 108", "YOX · 101", "Blue · 124"; mobile "Tinter — FFR / Dramatone · Fast Red". Email line now reads "MACHINE TINTER FFR …".

---

## Learnings

- **The base-alias is the single hook for a "name · X" suffix + a searchable token** — `display` drives the grid suffix, `search` bakes into searchTokens, both gated on non-null product. A null-product sub-product (UNIVERSAL STAINER) needs a `CONFIRMED_SUBPRODUCT_MAP` identity key before the alias fires.
- **New pattern — `label` on the alias** as the single source for a human full name shown in a *different place* from the grid suffix (here, the mobile subtitle). Keeps display/search/label in one block; readers pull whichever they need.
- **`sortOrder = tab-base + code` does double duty** — the offset (1000/2000/3000/4000) sets the **desktop tab order** (tabs = uiGroup first-appearance), the `+code` sets the **row order within a tab**. One scheme, both jobs — so tab reorder + row sort ship together, never fighting.
- **Product rename is a paired, two-sided move** — gate the stock rename to the family (`category === "STAINER"`) so a same-named product elsewhere is spared, and rename the menu side (`CONFIRMED_SUBPRODUCT_MAP`) + the alias key in the same paired reseed, or the join orphans.
- **Keep the cryptic stored name, add meaning around it** — when a baseColour is an operator abbreviation (YOX), don't re-key it (join cost). Show `abbrev · code`, push the full name into searchTokens + a `label`. No baseColour change, full searchability.
- **Menu dry-run shows 0 packs for a renamed/identity-keyed product** because it joins *live* (old) stock — expected; resolves after the stock-first paired reseed.

---

## Suggested CLAUDE_PLACE_ORDER.md edits (at consolidation)

- STAINER tabs (desktop order): **Universal Stainer · Machine Tinter · Acotone · GVA / PU**. Machine Stainer is renamed **Machine Tinter** everywhere (product, tab, email).
- Universal/Machine/GVA rows show a trailing shade code (`name · code`); the code is searchable. Acotone has none.
- Document the **`label?` field** on `base-aliases.ts` and `getBaseAliasLabel` (mobile subtitle full-name carrier).
- Document **`sortOrder = tab-base + code`** as the joint tab-order / row-order scheme for code-bearing families.
