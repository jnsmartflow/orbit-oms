# Planning Update — Master product category taxonomy redesign
Session date: 2026-05-06
Session type: design / taxonomy
Target files: mo_order_form_index, mo_sku_lookup, mo_product_keywords, /place-order, /order
Implementation status: design only — not yet executed

## DECISION SUMMARY
Redesigning the master `category` (family) taxonomy that governs product display across `/place-order`, `/order`, mail-order parsing, tint screens, dispatch reports and MIS. The current 15 SADOLIN/DULUX/WS/VT/etc. families are uneven — SADOLIN alone holds 40 sub-products while smaller families hold 1. Operator/SO email phrasing diverges from official JSW Dulux marketing structure in several places, so the new taxonomy is anchored to depot-floor language rather than brand hierarchy.

Scope of this doc: per-section decisions, captured one image at a time. Each section locks before the next begins. Final session adds master mapping + SQL plan + migration risk.

Implementation phasing:
- **Phase 1 (low risk):** Update `mo_order_form_index` only. Drives `/place-order` and `/order` pages. No enrichment impact, no historical data, no parser regression.
- **Phase 2 (higher risk, separate planning):** Apply same taxonomy to `mo_sku_lookup`, `mo_product_keywords`, and any hardcoded `category` references in code. Needs regression testing because keyword tables drive parser product detection.

---

## SECTION 1 — WOODCARE (locked)

### 1.1 New top-level categories produced

| # | Top-Level Category | Display Label | SKU Count | What's inside |
|---|---|---|---|---|
| 1 | LUXURIO | Luxurio | 12 | Premium PU — Matt, Gloss, Sealer |
| 2 | 2K PU | Sadolin 2K PU | 16 | 2K PU — Matt, Gloss, Sealer, Primer Surfacer, Thinner |
| 3 | PU PRIME | PU Prime | 11 | Entry PU — Matt, Gloss, Sealer, Multi Purpose Thinner |
| 4 | NC | Sadolin NC | 6 | NC Lacquer, Opaque, Synthetic Varnish, 1KPU Gloss, Sanding Sealer, Wood Thinner |
| 5 | MELAMINE | Sadolin Melamine | 4 | Melamine Gloss, Matt, Sealer, Thinner |
| 6 | WOOD STAIN | Wood Stain | 8 | Coloured wood stains — Teak, Walnut, Mahogany, Oak Yellow, Red Brown, Rosewood, Charcoal, Wenge |
| 7 | WOOD FILLER | Wood Filler | 3 | Teak, Walnut, White |

Plus:
- **STAINER (shared, deferred):** 12 GVA SKUs move into the existing STAINER family as a new sub-product `PU STAINER`. Final STAINER family layout locked in a later round when we address the existing STAINER/TINTER family.
- **EPOXY INSULATOR (deferred):** 1 SKU. Not a wood coating chemically (anti-corrosion / metal primer). Catalog-grouped under WOODCARE by JSW but operator usage is industrial. Defer to industrial/metal coatings round; if no such round emerges, becomes own top-level.

### 1.2 Sub-products per top-level (final)

#### LUXURIO (12 SKUs)
| Sub-product | Variants / Notes |
|---|---|
| MATT | Clear, White, Black, Base 90, Base 93 |
| GLOSS | Clear, White, Black, Base 90, Base 93 |
| SEALER | White Sealer, Clear Sealer |

#### 2K PU (16 SKUs)
| Sub-product | Variants / Notes |
|---|---|
| MATT | Exterior Clear, Interior Clear, Opaque White, Opaque Black, Base 90, Base 93 |
| GLOSS | Exterior Clear, Interior Clear, Opaque White, Opaque Black, Base 90, Base 93 |
| SEALER | Exterior Clear Sealer, Interior Clear Sealer |
| PRIMER SURFACER | Opaque 2KPU Primer Surfacer |
| 2K PU THINNER | Single SKU |

#### PU PRIME (11 SKUs)
| Sub-product | Variants / Notes |
|---|---|
| MATT | Clear, White, White Base 90, Clear Base 93 |
| GLOSS | Clear, White, White Base 90, Clear Base 93 |
| SEALER | White Sealer, Clear Sealer |
| MULTI PURPOSE THINNER | Single SKU. Co-orders with PU Prime in emails — kept inside PU PRIME family rather than a unified THINNER bucket |

#### NC (6 SKUs)
| Sub-product | Variants / Notes |
|---|---|
| NC LACQUER | NC Clear Lacquer |
| NC OPAQUE | NC Opaque Finish |
| SYNTHETIC VARNISH | Synthetic Clear Varnish — chemistry is alkyd not nitrocellulose, but JSW catalog-groups it under NC and operators have no separate phrasing. Kept inside NC. Promote to top-level if email evidence later shows operators searching by "varnish" alone |
| NC 1KPU GLOSS | Interior Clear 1KPU Gloss |
| NC SANDING SEALER | Single SKU — confirmed high volume (500*12 / 500*8 / 500*6 in sample emails) |
| NC WOOD THINNER | Single SKU |

#### MELAMINE (4 SKUs)
| Sub-product | Variants / Notes |
|---|---|
| MELAMINE GLOSS | Interior Clear Melamine Gloss |
| MELAMINE MATT | Interior Clear Melamine Matt |
| MELAMINE SEALER | Interior Clear Melamine Sealer |
| MELAMINE THINNER | Single SKU |

#### WOOD STAIN (8 SKUs)
| Sub-product | Variants / Notes |
|---|---|
| WOOD STAIN | 8 wood-shade colours: Teak, Walnut, Mahogany, Oak Yellow, Red Brown, Rosewood, Charcoal, Wenge |

Renamed from current `WOOD STAINER` to kill the operator-vocabulary collision with GVA/Universal stainers (machine colorants). "Wood Stain" = coloured finish for wood; "Stainer" = tinting machine colorant.

#### WOOD FILLER (3 SKUs)
| Sub-product | Variants / Notes |
|---|---|
| WOOD FILLER | Teak, Walnut, White |

#### STAINER family — PU STAINER sub-product (deferred to STAINER round)
| Sub-product | Variants / Notes |
|---|---|
| PU STAINER | 12 GVA codes — Red Oxide, Blue, Tinting Black, Yellow Oxide, Organic Orange, Organic Violet, Organic Middle Yellow, Organic Lemon Yellow, White, Green, Fast Red, Organic Red Violet |

Operator phrasing: section header `PU Stainer` followed by line items `GVA Black:1*1 tin`, `GVA White:1*2 tin`, etc. Akzo `Universal stainer` co-occurs in same orders — they coexist, parser must distinguish.

### 1.3 Operator phrasing evidence (anchors the decisions)

| Tier / Product | Sample SO phrases | Decision driven |
|---|---|---|
| Luxurio | "Luxurio Matt 90base", "Luxurio Gloss Clear", "Luxurio White Sealer", "Luxurio Matt Black" | Tier is the noun. "Sadolin" implicit. Top-level. |
| 2K PU | "Sadolin 2K PU 90 mat", "Sadolin 2K PU Thinner", "Sadolin interior 2KPU clear gloss" | Top-level. Both "2K PU" and "2KPU" written. |
| PU Prime | "PU Prime Matt 90base", "PU Prime White Sealer", "PU Prime 90 glossy", "PU Prime Matt Clear" | Top-level. Heavy volume. |
| Multi Purpose Thinner | "Multi Purpose Thinner:1*6,5*1 tin" — co-orders with PU Prime | Stays inside PU PRIME family, NOT a top-level THINNER bucket |
| NC Sanding Sealer | "NC Sanding Sealer:500*12 tin" (4× across 3 emails) | NC promoted to top-level. Sanding Sealer is highest-volume NC sub-product. |
| Melamine | "Melamine sealer- 4*1", "Melamine Gloss- 1*1", "Sadolin Melamine Sealer- 4*2", "Melamine Matt Clear:4*2", "Sadolin Melamine Int Clr mat 4*2" | Melamine promoted to top-level. 5 mentions / 4 separate orders confirms genuine flow. |
| Epoxy Insulator | "Epoxy Insulator:1*6 tin" (1 mention, co-orders with NC) | Real flow but single SKU. Deferred to industrial round. |
| Wood Filler | "Wood filler white:1*12 tin", "Wood filler Teak:1*12 tin" | Top-level. Pure noun phrase, no brand, no tier. |
| GVA / PU Stainer | Section header "PU Stainer" + line items "GVA Black:1*1 tin", "GVA White:1*2 tin" | Sub-product label = `PU STAINER`. GVA is keyword/alias. Lives under STAINER family. |

### 1.4 What changes from current state

| Currently in OrbitOMS | Becomes |
|---|---|
| Single SADOLIN family with 40 sub-products | Split into 7 new top-level families + 1 deferred (Epoxy) + 1 shared (GVA → STAINER) |
| Sub-product LUXURIO PU MATT / GLOSS | LUXURIO family → MATT, GLOSS, SEALER |
| Sub-product 2KPU MATT / GLOSS / etc. | 2K PU family → MATT, GLOSS, SEALER, PRIMER SURFACER, 2K PU THINNER |
| Sub-product PU PRIME (any variants) | PU PRIME family → MATT, GLOSS, SEALER, MULTI PURPOSE THINNER |
| Sub-products NC LACQUER / NC OPAQUE / etc. | NC family (own top-level) → 6 sub-products incl. SYNTHETIC VARNISH |
| Sub-products MELAMINE GLOSS / MATT / SEALER | MELAMINE family (own top-level) → 4 sub-products |
| Sub-product WOOD STAINER (8 wood-colour SKUs) | WOOD STAIN family (renamed to avoid GVA confusion) |
| Sub-product WOOD FILLER (3 SKUs) | WOOD FILLER family (own top-level) |
| Sub-product EPOXY INSULATOR (1 SKU) | Deferred — revisit during industrial/metal coatings round |
| Sub-product TINTING COLORANT (12 GVA SKUs) | Moves to STAINER family as sub-product PU STAINER (later round) |

### 1.5 Cross-listing decisions

**None for WOODCARE.** Every operator phrasing pattern points to a single bucket. No SKU appears in two categories. Clean partition.

### 1.6 Aliases / parser keywords (Phase 2 seeding)

These ensure the parser/enrichment finds the right product regardless of SO phrasing. To be added to `mo_product_keywords` when Phase 2 runs.

| Sub-product | Keywords / Aliases |
|---|---|
| LUXURIO MATT | LUXURIO MATT, LUXURIO PU MATT, SADOLIN LUXURIO MATT |
| LUXURIO GLOSS | LUXURIO GLOSS, LUXURIO PU GLOSS, SADOLIN LUXURIO GLOSS |
| LUXURIO SEALER | LUXURIO WHITE SEALER, LUXURIO CLEAR SEALER, LUXURIO SEALER |
| 2K PU MATT | 2KPU MATT, 2K PU MATT, SADOLIN 2K PU MATT, SADOLIN 2KPU MATT |
| 2K PU GLOSS | 2KPU GLOSS, 2K PU GLOSS, SADOLIN 2K PU GLOSS |
| 2K PU THINNER | 2KPU THINNER, 2K PU THINNER, SADOLIN 2K PU THINNER, SADOLIN 2KPU THINNER |
| PU PRIME MATT | PU PRIME MATT, PRIME MATT, PU PRIME MAT (typo guard) |
| PU PRIME GLOSS | PU PRIME GLOSS, PU PRIME GLOSSY, PRIME GLOSS |
| PU PRIME SEALER | PU PRIME SEALER, PU PRIME WHITE SEALER, PU PRIME CLEAR SEALER |
| MULTI PURPOSE THINNER | MULTI PURPOSE THINNER, MP THINNER, MULTIPURPOSE THINNER |
| NC LACQUER | NC LACQUER, NC CLEAR LACQUER, SADOLIN NC LACQUER |
| NC OPAQUE | NC OPAQUE, NC OPAQUE FINISH |
| SYNTHETIC VARNISH | SYNTHETIC VARNISH, SYNTHETIC CLEAR VARNISH, VARNISH, SADOLIN SYNTHETIC |
| NC 1KPU GLOSS | NC 1KPU GLOSS, 1KPU GLOSS, INTERIOR 1KPU GLOSS |
| NC SANDING SEALER | NC SANDING SEALER, NC SEALER, SANDING SEALER |
| NC WOOD THINNER | NC WOOD THINNER, NC THINNER, WOOD THINNER |
| MELAMINE GLOSS | MELAMINE GLOSS, SADOLIN MELAMINE GLOSS, MELAMINE INT CLR GLOSS |
| MELAMINE MATT | MELAMINE MATT, MELAMINE MATT CLEAR, SADOLIN MELAMINE MATT, MELAMINE INT CLR MAT |
| MELAMINE SEALER | MELAMINE SEALER, SADOLIN MELAMINE SEALER |
| MELAMINE THINNER | MELAMINE THINNER, SADOLIN MELAMINE THINNER |
| WOOD STAIN | WOOD STAIN, WOOD STAINER (legacy), SADOLIN WOOD STAIN |
| WOOD FILLER | WOOD FILLER, WOODFILLER |
| PU STAINER | PU STAINER, GVA, GVA STAINER |
| EPOXY INSULATOR (deferred) | EPOXY INSULATOR, SADOLIN EPOXY INSULATOR |

Notes for keyword load:
- "VARNISH" alone is risky — could collide with future varnish products from other brands. If/when other varnishes appear, scope this keyword more tightly.
- "SANDING SEALER" alone is a catch — currently only NC has a sanding sealer SKU, so the bare keyword is safe today.
- "WOOD THINNER" alone may collide with future wood-thinning products from other brands — monitor.

### 1.7 Migration risks (WOODCARE-specific)

#### Phase 1 risks (mo_order_form_index only)
- **None significant.** Index table is display-only. Risk is limited to operator UX surprise on `/place-order` — see operator pushback note below.

#### Phase 2 risks (mo_sku_lookup + mo_product_keywords + code)
- **Existing SADOLIN rows in mo_sku_lookup** — 40 sub-products will need their `category` updated. One-shot UPDATE. Per Phase 3 notes (web-update-2026-04-23-phase3-reference-data.md), enrichment combo key is `product|baseColour|packCode` — category is NOT in the key, so combo collision behaviour will not change. **But:** the `category` value is used for category-scoped pre-filtering in `customer-match.ts` and possibly elsewhere. Needs grep audit before SQL.
- **mo_product_keywords rows tagged category=SADOLIN** — must be re-categorised by sub-product. Riskier than mo_sku_lookup because keywords drive parser product detection. Plan: dump current keywords filtered to SADOLIN family, map per sub-product to new family, re-run Test 1 + Test 2 stress test pattern (per web-update-2026-04-23) before SQL.
- **Hardcoded `SADOLIN` references in code** — grep `category === "SADOLIN"`, `category: "SADOLIN"`, `'SADOLIN'`, `"SADOLIN"` across repo before applying. Suspect locations: `lib/mail-orders/enrich.ts`, any category-scoped report routes, customer-match boost logic. Output a list during Phase 2 planning.
- **Historical mo_order_lines** — if `category` is persisted in line records (it is via `mo_sku_lookup` join only — verify), historical orders will read the new category on re-enrichment but display the old category if a snapshot was taken. Verify no report joins on the live `category` for historical analytics.
- **Tint Manager / Tint Operator screens** — if any tint screen filters or groups by `category`, it will reflect the new family names after Phase 2. Audit `tint-manager-content.tsx` and `tint-operator-content.tsx`.

### 1.8 Operator pushback notes

- **Splitting SADOLIN into 7 families** is the bigger change for Deepanshu/Bankim. Mental search shifts from "open SADOLIN, scroll 40 items" → "open the right family, pick from 3-6 items". Faster once learned. Plan a 5-minute walkthrough at rollout.
- **Renaming WOOD STAINER → WOOD STAIN** disambiguates from GVA stainers. One-line note to operators sufficient. Most will not notice the change.
- **EPOXY INSULATOR temporarily missing from `/place-order`** during deferral period. Deepanshu's workflow: if an Epoxy Insulator order arrives before industrial round, fall back to manual SAP punch. Confirm acceptable before Phase 1 rollout — alternative is to seed it as own top-level immediately and re-home later.

### 1.9 Open follow-ups for WOODCARE

- Confirm with Deepanshu that EPOXY INSULATOR can be deferred (see 1.8) — or seed as own top-level now.
- Pull SO phrasing samples for SYNTHETIC VARNISH if available — would unlock a future decision to promote it to top-level (currently bundled inside NC by default).
- During Phase 2 planning, confirm `category` is NOT part of any unique constraint or UNIQUE-on-(category, product) index in mo_sku_lookup. Already noted as safe per Phase 3 audit but re-verify before SQL.

---

## SECTION 2 onwards — pending
Subsequent JSW Dulux category sections to be locked one image at a time per round protocol. This file is appended to per section.

---

*Master taxonomy redesign · WOODCARE locked · 2026-05-06 · Smart Flow + Claude*
