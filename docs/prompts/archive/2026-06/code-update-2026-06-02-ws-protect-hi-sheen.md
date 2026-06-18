# code-update · 2026-06-02 · WS Protect Hi-Sheen — 5th WS sub-product

**Repo destination:** `docs/prompts/drafts/code-update-2026-06-02-ws-protect-hi-sheen.md`
**Fold into:** `CLAUDE_PLACE_ORDER.md` at next consolidation.
**Status:** Live in production. Product #5 of the WS family (after Max, Powerflexx, Protect Dustproof, Protect Rainproof).

---

## Goal

Move 16 "WS Protect Dust Hi-Sheen" SAP materials (`5963118`–`5963133`; bases Brilliant White / 90 / 92 / 93; packs 1/4/10/20L) out of their standalone "Dulux WS Hi-Sheen" family into the **WS family as a 5th flat sibling sub-product, "WS Protect Hi-Sheen"** — peer to Dustproof / Rainproof / Max / Powerflexx.

---

## Taxonomy decision

**Protect** is the conceptual parent; **Dust / Rain / Hi-Sheen** are its siblings. Named **"Protect Hi-Sheen"** (NOT "Protect Dustproof Hi-Sheen") — it is a sibling of Dustproof, not a finish nested under it. Implemented as a flat WS sub-product (the shared "Protect" lives only in the tab label). No new nesting level, no "finish" dimension across cart/email/parser.

---

## Where it was (diagnosis)

- **Stock** (`mo_sku_lookup_v2`): 16 rows, family/product/baseColour = `HISHEEN/HISHEEN/{base}`, `isPrimary=true`. Legacy category `WS`, legacy product `HISHEEN`.
- **Menu** (`mo_order_form_index_v2`): standalone family `HISHEEN`, displayName "Dulux WS Hi-Sheen", section EXTERIORS, subgroup "Specialty exterior", `product=NULL` / `uiGroup=NULL`. Hydrated only by the `product ?? subProduct` fallback (joinName `HISHEEN`).
- Driven by `mapLegacyToNew` (WS/HISHEEN branch) + `taxonomy-preview.json` minting HISHEEN as its own family.
- **Universe = exactly 16** (BW/90/92/93). No 94–99, no colour SKUs. VT Eterna Hi-Sheen is a separate interior product (out of scope).

---

## Final shape (live)

| Field | Value |
|---|---|
| family | WS |
| subProduct | HI-SHEEN |
| uiGroup (desktop tab) | Protect Hi-Sheen |
| displayName (mobile) | WS Protect Hi-Sheen |
| product join-key (menu + 16 stock rows) | WS PROTECT HI-SHEEN |
| section / subgroup | EXTERIORS / WS (Weather Shield) |
| bases | Brilliant White, 90, 92, 93 (white/light only — correct, narrow line) |
| base aliases | 90 → White, 92 → Intermediate (BW & 93 none, same as Dustproof) |
| searchTokens | HI-SHEEN / HISHEEN / PROTECT HI-SHEEN / WS HI SHEEN / WS PROTECT HI-SHEEN. **No "dustproof"** (sibling, not child). |

---

## How it was built (clone, not invent)

WS sub-products are produced by the **`WS_CONSOLIDATE` transform in the menu seed** (`scripts/v2-catalog-seed-from-preview.ts`): raw preview families (PROTECT / RAINPROOF / MAX / POWERFLEXX) fold into family WS, `product` set by `CONFIRMED_SUBPRODUCT_MAP`, tab by `WS_TAB_LABEL`. Hi-Sheen was made the exact analog of Dustproof: raw preview family HISHEEN → renamed HI-SHEEN, family → WS, product WS PROTECT HI-SHEEN.

**Files edited:**
- `lib/place-order/base-aliases.ts` — added `WS PROTECT HI-SHEEN` block (90 White, 92 Intermediate).
- `scripts/v2-catalog-seed-from-preview.ts` (menu seed) — `CONFIRMED_SUBPRODUCT_MAP += HISHEEN → WS PROTECT HI-SHEEN`; `WS_CONSOLIDATE += HISHEEN`; `WS_TAB_LABEL += HI-SHEEN → "Protect Hi-Sheen"`; §7.7 rename HISHEEN/HISHEEN → subProduct HI-SHEEN; §7.85 removed the obsolete HISHEEN protect-token strip.
- `docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json` — 4 HISHEEN rows: displayName → "WS Protect Hi-Sheen", searchTokens updated; family/subProduct kept HISHEEN so the consolidation redirects them (old standalone tab no longer minted).
- `lib/mail-orders/taxonomy-mapping.ts` — HISHEEN/HISHEEN searchTokens + displayName updated (source-of-truth consistency for any preview regen). Raw intermediate branch retained.
- `scripts/data/sku-name-overrides.json` — 16 entries `5963118`–`5963133` → product WS PROTECT HI-SHEEN, category WS, baseColour BW/90/92/93 (sets the stock join-key; identical mechanism to Dustproof's 16).
- `scripts/v2-sku-seed-from-legacy.ts` — added WS PROTECT HI-SHEEN to the DRY_RUN rehearsal TARGETS (visibility only; no logic change).

---

## Reseed (live, verified)

**Backups taken before any write (restore points):**
- `mo_sku_lookup_v2_bak_20260602_hisheen` — 1625 rows
- `mo_order_form_index_v2_bak_20260602_hisheen` — 392 rows

**Stock reseed:** WS PROTECT HI-SHEEN 0 → 16 (re-key, total 1625 → 1625).
**Menu reseed:** WS family = DUSTPROOF(15) / HI-SHEEN(4) / MAX(9) / POWERFLEXX(9) / RAINPROOF(8); standalone HISHEEN gone; desktop families 30 → 29.

**Verification — all PASS:**
- 16 packs hydrate (4 bases × 4 packs 1/4/10/20L) — the dry-run "ZERO packs" artifact resolved once both tables re-keyed.
- Menu attributes correct (subProduct / uiGroup / section / subgroup / displayName / product).
- searchTokens correct; no "dustproof"; 90/92 carry white/intermediate aliases.
- 0 rows family HISHEEN; 0 displayName "Dulux WS Hi-Sheen".
- Untouched: Dustproof 15/62, Rainproof 8/40, Max 9/62, Powerflexx 9/62.

---

## Commit

`feat(catalog): WS Protect Hi-Sheen as 5th WS sub-product (16 SKUs BW/90/92/93)` — committed direct to `main` and pushed to `origin/main`. (Commit hash not captured in this planning session.)

---

## Learnings

- **WS sub-products are authored in the MENU seed** (`v2-catalog-seed-from-preview.ts`) via `WS_CONSOLIDATE` / `CONFIRMED_SUBPRODUCT_MAP` / `WS_TAB_LABEL` — NOT the SKU seed. The section/subgroup/uiGroup maps live there.
- **Cloning an existing migrated sibling** (Dustproof) is the safe pattern for a new WS member — no new code path, no new nesting level.
- **Reconcile the preview JSON when re-homing a family**, or a wipe-and-reseed re-mints the old standalone family.
- **"ZERO packs" in a menu dry-run is expected** when stock isn't re-keyed yet (the menu dry-run joins live stock). Reseed both tables — stock first — to resolve.
- **Per-product WS rollout template** confirmed: review CSV → diagnose → converter + dry-run + reseed → menu + aliases → commit + push → verify.

---

## Suggested CLAUDE_PLACE_ORDER.md edits (at consolidation)

- WS family sub-product list is now **5**: Max, Powerflexx, Protect Dustproof, Protect Rainproof, **Protect Hi-Sheen**.
- Document the WS authoring mechanism (`WS_CONSOLIDATE` / `CONFIRMED_SUBPRODUCT_MAP` / `WS_TAB_LABEL` in `v2-catalog-seed-from-preview.ts`).
- Note the menu seed is `v2-catalog-seed-from-preview.ts` (not the SKU seed) for section/subgroup/uiGroup maps.
