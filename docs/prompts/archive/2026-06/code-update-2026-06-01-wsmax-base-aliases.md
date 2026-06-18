# code-update · 2026-06-01 · WS Max base-name aliases (display + search)

**Repo destination:** `docs/prompts/drafts/code-update-2026-06-01-wsmax-base-aliases.md`
**Fold into:** `CLAUDE_PLACE_ORDER.md` (new "Base-name aliases" section) at next consolidation.
**Status:** Live in production. WS Max only (first product of the per-product rollout).

---

## What this adds

Friendly aliases on WS Max numbered bases, in two parts:

1. **Display** — a faint alias shown after the base number on screen (e.g. `WS Max — 94 Base · Accent`). Number stays dominant; alias is muted gray.
2. **Search** — the alias words are findable when typed (e.g. `accent`, `rox`, `red oxide` → the matching base), on both mobile `/order` and desktop `/place-order`.

The order **email is untouched** — it still emits raw `WS MAX 94 BASE`, so the mail parser is unaffected.

---

## Alias map (WS Max)

| Base | Display alias | Search words |
|------|---------------|--------------|
| 90 BASE | White | white, white base |
| 92 BASE | Intermediate | intermediate, intermediate base |
| 94 BASE | Accent | accent, accent base |
| 95 BASE | Deep | deep, deep base |
| 96 BASE | YOX | yox, yellow oxide, yellow oxide base |
| 97 BASE | ROX | rox, red oxide, red oxide base |
| 98 BASE | Vibrant Yellow | vibrant yellow, vibrant yellow base |
| 93 BASE | *(none)* | *(none)* |
| BRILLIANT WHITE | *(none)* | *(none)* |

---

## New module

**`lib/place-order/base-aliases.ts`** — single source of truth for both display and search.

```ts
export type BaseAlias = { display: string; search: string[] };
// keyed: product (SAP-clean name, e.g. "WS MAX") -> baseColour ("90 BASE") -> BaseAlias
export const BASE_ALIASES: Record<string, Record<string, BaseAlias>> = { ... };
export function getBaseAliasDisplay(product, baseColour): string | null;
```

- Lives under `lib/` (no React) so it is importable by **both** the frontend components (display) **and** the seed script (search words).
- Keyed by **product then baseColour**, so each product opts in explicitly — adding a new product = a new block, no surprise auto-application.

---

## Display (frontend-only — deploys on push, no reseed)

A muted `· {display}` span (`text-gray-400 font-normal`) rendered **after** the base, only when `getBaseAliasDisplay` is non-null. Never concatenated into `productLabel`'s string.

| Screen | File |
|--------|------|
| Mobile search results, picker header, cart lines, selected list | `app/order/page.tsx` (via new `aliasSuffix` helper) |
| Desktop search results | `big-search-bar.tsx` |
| Desktop variant-grid base column | `variant-grid.tsx` |
| Desktop cart line | `cart-panel.tsx` |

`productLabel`'s returned string is **unchanged** (the mobile search haystack depends on it).

**Commit:** `9ae9a048`

---

## Search (seed + one desktop tweak — needs a menu reseed)

**Mobile** search haystack already includes `searchTokens`, so baking alias words into `searchTokens` makes them findable.
**Desktop** search (`searchProducts` in `lib/place-order/queries.ts`) did **not** read `searchTokens` — it only scored family / sub-product / baseColour. Fixed by including `searchTokens` in the desktop haystack.

1. **Seed** `scripts/v2-catalog-seed-from-preview.ts` — new step **7.8**: imports `BASE_ALIASES`, appends each WS Max base's `.search` words to that row's `searchTokens` via the existing `mergeSearchTokens` (same `, ` delimiter, case-insensitive dedupe, existing tokens kept). Only `product === "WS MAX"` rows with a mapped base.
2. **Desktop** `lib/place-order/queries.ts` (`searchProducts`) — the sub-product-base aggregate now carries `searchTokens` and the scored haystack appends it.

**Commit:** `99b773a8`

> ⚠️ **Behavior note:** the desktop change makes desktop search consider `searchTokens` for **all** products, not just WS Max. This is an intended broadening / improvement. If any future product's desktop search starts matching too loosely, this haystack is the lever.

---

## Live menu reseed (2026-06-01)

- **Backup:** `mo_order_form_index_v2_bak_20260601c` = 400 rows (pre-reseed menu copy).
- **Reseed:** menu only (`v2-catalog-seed-from-preview.ts`, DRY_RUN off). SKU seed **not** run.
- **Verify:** 400 rows; exactly **7** WS Max base rows (90/92/94/95/96/97/98) got alias words in live `searchTokens`; 93 + Brilliant White unchanged; non-WS-Max rows unchanged (diff vs backup = 7 changed, 0 added, 0 removed); stock `mo_sku_lookup_v2` = **1631 rows, untouched**.
- **Result:** PASS. No rollback needed.

**Rollback (if ever needed):**
```sql
BEGIN; TRUNCATE mo_order_form_index_v2; INSERT INTO mo_order_form_index_v2 SELECT * FROM mo_order_form_index_v2_bak_20260601c; COMMIT;
```

---

## Suggested CLAUDE_PLACE_ORDER.md edits (at consolidation)

- New section **"Base-name aliases"** documenting `lib/place-order/base-aliases.ts` as the single source, the display-vs-search split, and the email-stays-raw rule.
- Note in the search section that **desktop `searchProducts` now reads `searchTokens`** (catalogue-wide).
- Note that `searchTokens` is the durable home for searchable aliases — baked in the seed, takes effect on menu reseed.

---

## Rollout pattern for the next products (Protect, Dustproof, Powerflexx, Rainproof, …)

The plumbing is built once; each new product is now a small loop:

1. Add the product's block to `BASE_ALIASES` in `base-aliases.ts` (display + search words).
2. Display works automatically (frontend reads the map) — deploys on push.
3. Add the product to the seed's step-7.8 condition (or generalize it to "any product in `BASE_ALIASES`").
4. DRY_RUN menu rehearse → menu reseed → verify the new rows' `searchTokens`.
5. Email stays raw `baseColour` — never touch it.
