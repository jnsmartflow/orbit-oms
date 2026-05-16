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

## SECTION 2 — ENAMELS (locked)

### 2.1 New top-level categories produced

| # | Top-Level Category | Display Label | SKU Count | What's inside |
|---|---|---|---|---|
| 1 | GLOSS | Gloss | 171 | Single product, 38 base/colour variants |
| 2 | SATIN | Satin | 70 | Two sub-products: SUPER SATIN (Oil Satin / Satin Finish, 45 SKUs) + SATIN STAY BRIGHT (WB Satin, 25 SKUs) |
| 3 | LUSTRE | Lustre | 6 | Single product (low volume but real flow) |
| 4 | PROMISE ENAMEL | Promise Enamel | 45 | Cross-listed in PROMISE family |

### 2.2 Critical finding from mo_sku_lookup CSV audit

JSW marketing's 4 Gloss tiers (Gloss Premium, Stay Bright Gloss, Super Gloss 5-in-1, PU Enamel 12-in-1) **do NOT exist in Surat depot SKU master**:
- All 171 GLOSS SKUs share product = `GLOSS` with descriptions `DN GLOSS {colour/base} {pack}`.
- Zero descriptions contain "Premium", "Stay Bright", "5IN1", "12IN1", "PU ENAMEL", or "SUPER GLOSS".
- Earlier proposal to "collapse 4 tiers under GLOSS with parser default = Gloss Premium" was solving a non-existent problem.

Surat depot stocks ONE gloss line. The redesign is just promoting GLOSS from sub-product to top-level — no tier-collapse logic needed.

### 2.3 Sub-products per top-level (final)

#### GLOSS (171 SKUs)
Single product. 38 distinct base/colour variants:

White-side: `BRILLIANT WHITE`, `BLAZING WHITE`, `CLASSIC WHITE`, `OFF WHITE`
Bases: `90 BASE`, `92 BASE`, `93 BASE`, `94 BASE`, `GREEN BASE`
Colour shades: `BLACK`, `BUS GREEN`, `DARK BROWN`, `GOLDEN BROWN`, `GOLDEN YELLOW`, `LEAF BROWN`, `MAHOGANY`, `MINT GREEN`, `OXFORD BLUE`, `PHIROZA`, `PO RED`, `SIGNAL RED`, `SKY BLUE`, `SMOKE GREY`, `TRUCK BROWN`, `WILD PURPLE`, `DA GREY`, `DAWN`, `DEEP ORANGE`, `ROYAL IVORY`, `SAND STONE`, `LIGHT GREY`, `MIDDLE BUFF`, `PALE CREAM`, `AQUAMARINE`, `CHERRY`, `DEEP GREEN`, `CASCADE GREEN`, `OPALINE GREEN`.

#### SATIN (70 SKUs)
Two sub-products with chemistry split:

| Sub-product | SKU count | Description prefix | Operator vocabulary |
|---|---|---|---|
| SUPER SATIN | 45 | `DN SAT FIN ...` | "Satin finish", "Oil satin", "Super Satin" |
| SATIN STAY BRIGHT | 25 | `DN SATIN STAY BRIGHT ...` | "WB Satin", "Satin Stay Bright" |

SUPER SATIN base/colour variants: White, Black, Brown, Mahogany, Walnut, Rich Brown, Rich Mahogany, Special Teak, Timber Golden Brown, Teak, Rosewood; bases 90/92/94/97 (Red Base).

SATIN STAY BRIGHT base/colour variants: Brilliant White, plus bases 90/92/93/94, plus Black, Rich Brown, Mahogany.

#### LUSTRE (6 SKUs)
Single product. 6 SKUs covering White + bases (White Base, Intermediate Base, Accent Base, Yellow Base, Red Base, 93 Base). Low volume but real flow per Smart Flow.

#### PROMISE ENAMEL (45 SKUs) — CROSS-LISTED
Already exists as schema product `PROMISE ENML` in PROMISE family. Stays there + appears as own top-level on `/place-order` for operator discoverability.

White + Classic White + colour shades (Black, Bus Green, Golden Brown, Phiroza Blue, Smoke Grey, Dark Brown, Golden Yellow, PO Red) + Olive Green 20L.

### 2.4 Operator phrasing evidence

| Tier / Product | Sample SO phrases | Decision driven |
|---|---|---|
| Gloss | "Gloss black", "Gloss 90", "Gloss 92", "Gloss 93", "Gloss Brilliant white", "Gloss Phiroza", "Gloss Bus green", "Gloss Smk grey", "Gloss da grey", "Gloss Dark Brown", "Gloss Golden brown", "Gloss Sky blue", "Gloss Oxford blue", "Gloss signal red", "Gloss blk-1*30,500ml *24" | Bare "Gloss" + base/colour. No tier qualifier ever typed. Operators don't distinguish JSW tiers — and they don't have to, because Surat only stocks one. |
| Super Satin | "Satin finish 800", "Satin finish 90", "Satin finish 92", "Satin finish 93", "Satin finish Black", "Oil satin 90 white", "Oil satin black", "Oil satin 92", "Oil satin 93" | Two operator-language names: "Satin finish" + "Oil satin". Both alias to same product. |
| Satin Stay Bright | "Wb satin White", "Wb satin 90", "Wb satin 92", "Wb satin 93", "WB satin br white" | "WB Satin" is the depot-floor name. Confirmed by Smart Flow: "WB Satin is Satin Stay bright". |
| Lustre | (No samples in evidence batch) | Kept as own top-level per Smart Flow confirmation that it's ordered, just rare. |
| Promise Enamel | "Promise enamel Phiroza", "Promise enamel Black", "Promise enamel White", "Promise enamel PO Red", "Promise enamel golden yellow", "Promise enamel smoke grey" | Always "Promise enamel" — full phrase preserved, no abbreviation. Cross-list under both PROMISE and PROMISE ENAMEL on /place-order per Smart Flow request. |

### 2.5 What changes from current state

| Currently in OrbitOMS | Becomes |
|---|---|
| mo_order_form_index DULUX family with sub-products GLOSS / LUSTRE / SATIN STAY BRIGHT / SUPER SATIN / PU ENAMEL | DULUX family shrinks — these move out to GLOSS, SATIN, LUSTRE top-levels in the order form index |
| mo_sku_lookup categories GLOSS (171), SATIN (70), LUSTRE (6) already exist | Promote each to top-level in mo_order_form_index. SKU table category column unchanged for these 3 |
| Sub-product PU ENAMEL on order form (DULUX/PU ENAMEL) | No SKUs in Surat depot stock JSW's 12-in-1 tier. Removed from order form. If/when stocked, add as PU ENAMEL top-level then |
| Sub-product PROMISE ENML in PROMISE family (45 SKUs) | Stays in PROMISE family + cross-listed in new PROMISE ENAMEL bucket on /place-order |
| SATIN family already has 2 sub-products in mo_sku_lookup | Surface both as sub-products on the order form with operator-friendly display labels (Super Satin = "Oil Satin / Satin Finish", Stay Bright = "WB Satin") |

### 2.6 Cross-listing decisions

| Sub-product | Cross-listed in | Mechanism |
|---|---|---|
| PROMISE ENAMEL (all 45 SKUs) | PROMISE family + PROMISE ENAMEL section on `/place-order` | Display-only duplicate row in `mo_order_form_index`. Same SKU rows in `mo_sku_lookup` (single source). No category change in SKU table — index-table-only duplication |

### 2.7 Aliases / parser keywords (Phase 2 seeding)

| Sub-product / Family | Keywords / Aliases |
|---|---|
| GLOSS | GLOSS, DULUX GLOSS, GLOSS ENAMEL, ENAMEL GLOSS, GLOSS PREMIUM (legacy phrase) |
| SATIN — SUPER SATIN (Oil Satin) | SUPER SATIN, SATIN FINISH, OIL SATIN, SAT FIN, SUPER SB PU SATIN |
| SATIN — SATIN STAY BRIGHT (WB Satin) | WB SATIN, WB PU SATIN, SATIN STAY BRIGHT, STAY BRIGHT SATIN, STAY BRIGHT WB PU SATIN |
| LUSTRE | LUSTRE, LUSTRE FINISH, DULUX LUSTRE |
| PROMISE ENAMEL | PROMISE ENAMEL, PROMISE ENML, DULUX PROMISE ENAMEL |

**Global base alias (cross-family):** `800` → `90 BASE` (old SAP base code lingo, applies to gloss + satin per Smart Flow). To be added as a normalize rule in parser, not a keyword.

### 2.8 Migration risks (ENAMELS-specific)

#### Phase 1 risks (mo_order_form_index only)
- **Cross-listing PROMISE ENAMEL** — adds duplicate rows in `mo_order_form_index` (one under PROMISE family, one under PROMISE ENAMEL family). Verify the index table schema does NOT have a unique constraint on (material, category) that would block this. Likely it doesn't (display table) but confirm.
- **Tier name removal** from order form — removing the never-stocked `PU ENAMEL` sub-product from DULUX may cause a minor "where did it go?" moment for any operator who muscle-memoried the path. None used it (no SKUs), so impact ≈ zero.

#### Phase 2 risks (mo_sku_lookup + mo_product_keywords + code)
- **Pre-existing data hygiene issue (NOT created by this redesign):** 7 rows in `mo_sku_lookup` are mis-categorised — material codes `9058558-62` (5 Walnut variants) and `5867120` (93 BASE 9.25L) are filed under `category=SATIN, product=SATIN STAY BRIGHT` but their descriptions read `DN SAT FIN ...` (which is the SUPER SATIN naming pattern). Either the category is wrong or the descriptions are wrong. Flag for separate cleanup session — not blocking this taxonomy work. Proposed action: query original SAP master file to verify whether these are SUPER SATIN or SATIN STAY BRIGHT SKUs, then UPDATE category/product or update description accordingly.
- **GLOSS keywords** — `mo_product_keywords` likely has rows tagged `category=DULUX, product=GLOSS`. After redesign, these become `category=GLOSS, product=GLOSS`. Self-referential category=product when product family has no internal sub-products. Verify this doesn't trip enrichment ranking (combo key is `product|baseColour|packCode` so should be fine, but worth a regression test).
- **PROMISE ENML keywords** — keep current rows untouched. Cross-listing on order form does NOT change `mo_product_keywords` — keywords still resolve to `category=PROMISE, product=PROMISE ENML`. The cross-list is display-only.
- **Hardcoded `category === "DULUX"` references in code** — likely none of the current GLOSS/SATIN/LUSTRE traffic is gated on this string (since they're already separate categories in `mo_sku_lookup`), but grep before SQL.
- **Operator-language aliases (OIL SATIN, WB SATIN, SATIN FINISH)** — these likely already exist in `mo_product_keywords` (matching has been working). Verify before adding duplicates. If absent, add per 2.7.

### 2.9 Operator pushback notes

- **GLOSS as own top-level** — strict UX win. Today operator opens DULUX, scrolls past 14 other sub-products, finds GLOSS. After: opens GLOSS directly.
- **Cross-listing Promise Enamel** — strict UX win. SOs/operators can find it under either Promise OR Enamel family.
- **SATIN top-level with 2 sub-products** — operators currently see SATIN STAY BRIGHT and SUPER SATIN as separate sub-products under DULUX. After: both live under SATIN family, mental model matches "satin = WB or Oil". Improvement.
- **Lustre being kept despite low volume** — no impact, just stays visible.

### 2.10 Open follow-ups for ENAMELS

- During Phase 2, fix the 7 mis-categorised SAT FIN-described rows in SATIN STAY BRIGHT (see 2.8). Coordinate with depot to verify which way is correct (category fix vs description fix).
- Confirm `mo_order_form_index` has no unique constraint that blocks cross-listing PROMISE ENML under two categories.
- During Phase 2, regression-test enrichment after promoting GLOSS/SATIN/LUSTRE to top-level. Run Test 1 + Test 2 stress test pattern (per web-update-2026-04-23).

---

## SECTION 3 — EXTERIORS (locked)

### 3.1 New top-level categories produced

| # | Top-Level Category | Display Label | SKU Count | Sub-products inside |
|---|---|---|---|---|
| 1 | MAX | Dulux WS Max | 73 | MAX (single product, parser prefers newer 10YR generation) |
| 2 | POWERFLEXX | Dulux WS Powerflexx | 62 | POWERFLEXX (single, parser prefers newer 15YR) |
| 3 | PROTECT | Dulux WS Protect | 69 | PROTECT (50 SKUs) + PROTECT DUSTPROOF (19 SKUs) — 2 sub-products |
| 4 | RAINPROOF | Dulux WS Rainproof | 40 | PROTECT RAINPROOF (single, parser prefers newer 8YR) |
| 5 | HISHEEN | Dulux WS Hi-Sheen | 16 | HISHEEN (single product) |
| 6 | TILE | Dulux WS Tile | 8 | TILE (Base + Yellow Base only) |
| 7 | TEXTURE | Dulux WS Texture | 5 | TEXTURE (single, low volume) |
| 8 | METALLIC | Dulux WS Metallic | 6 | WS METALLIC (Silver, Gold) — moved from EMULSION |
| 9 | PROMISE EXTERIOR | Promise Exterior | 64 | PROMISE EXTERIOR (40) + PROMISE SHEEN EXTERIOR (20) + PROMISE SMARTCHOICE EXT (4) + PROMISE SMARTCHOICE EXT PRIMER (4) — CROSS-LISTED in PROMISE family |

### 3.2 Critical finding from CSV audit — WS ≡ WEATHERCOAT generation split

The `mo_sku_lookup` CSV reveals that WS (192 SKUs) and WEATHERCOAT (111 SKUs) are not separate product lines — they are **two SAP generations of the same products**, stocked in parallel:

| Product | WS rows | WEATHERCOAT rows | Description tier signal |
|---|---|---|---|
| MAX | 50 | 23 | WS/MAX = mix of 31 plain + 19 "10YR"; WEATHERCOAT/MAX = 14 "10YR" + 9 plain |
| PROTECT | 50 | 19 | WS/PROTECT = no tier; WEATHERCOAT/PROTECT = "DUSTPROOF" prefix (newer variant) |
| POWERFLEXX | 35 | 27 | WS/PF = no tier; WEATHERCOAT/PF = "15YR" prefix |
| PROTECT RAINPROOF | 31 | 9 | WS/RP = no tier; WEATHERCOAT/RP = newer "8YR" line |

Confirms the **T3 product rebadge issue** flagged in `web-update-2026-04-28-gloss-bw-generic-cleanup.md` — SAP issued new material codes for refreshed product lines (10YR / 15YR / 8YR), both old and new codes coexist in master.

**Operator language signal (Smart Flow confirmed):** SOs do NOT write warranty tiers. They say "WS Max" / "WS PF" / "WS Rainproof" without "10yr" / "15yr" / "8yr". Operator vocabulary doesn't distinguish old vs new generation.

### 3.3 Decision — Option A: taxonomy treats old + new as one product

**Approach:** at the operator-facing level, MAX/POWERFLEXX/PROTECT/RAINPROOF are single products. The two SAP generations are abstracted away.

**Parser scoring rule (deferred to Phase 2):** when both `WS/{product}` and `WEATHERCOAT/{product}` contain matching combo (`product|baseColour|packCode`), parser prefers WEATHERCOAT — newer generation, has explicit warranty signal in description. Documented as parser rule, not taxonomy decision.

**Rebadge cleanup runs as separate Phase 2 stream** (already in pending items per `web-update-2026-04-28-gloss-bw-generic-cleanup.md` T3 cleanup). Not blocking this taxonomy round. After cleanup marks losing-generation SKUs `isActive=false`, taxonomy display unchanged.

**Alternatives rejected:**
- Two sub-products per product family (e.g. `MAX 10YR` + `MAX old`) — operators don't write warranty tiers, so they can't pick. Defeats the point.
- Resolve rebadge first, then redo taxonomy — blocks order form delivery on a 10+ family business decision that depot side has not yet made.

### 3.4 Sub-products per top-level (final)

#### MAX (73 SKUs)
Single product. Parser prefers newer WEATHERCOAT/MAX (14 SKUs with "10YR" descriptions) over older WS/MAX (31 plain + 19 "10YR" mixed). Bases 90/92/93/94/95/96/97/98 + Brilliant White + WS MAX colour shades.

#### POWERFLEXX (62 SKUs)
Single product. Parser prefers newer WEATHERCOAT/POWERFLEXX (27 SKUs with "15YR" descriptions). Bases 90/92/93/94/95/96/97/98 + Brilliant White.

#### PROTECT (69 SKUs)
Two sub-products with chemistry/use case split:

| Sub-product | SKU count | Description signal | Operator vocabulary |
|---|---|---|---|
| PROTECT | 50 | `DN WS PROTECT ...` | "WS Protect" |
| PROTECT DUSTPROOF | 19 | `DN WS PROTECT DUSTPROOF ...` | "WS Dustproof", "Protect Dustproof" |

PROTECT (plain) carries the bases + colour shades + Electric Blue Plus + PO Red + Signal Red + Teracotta + Sunrise variants.
PROTECT DUSTPROOF carries newer Weathershield Readymade Shades.

#### RAINPROOF (40 SKUs)
Single product. Parser prefers newer WEATHERCOAT/PROTECT RAINPROOF (9 SKUs, 8YR generation). Bases 90/92/93/94/95/96/97 + Brilliant White.

#### HISHEEN (16 SKUs)
Dustproof Hi-Sheen variant. Brilliant White + bases 90/92/93. SAP descriptions = `DN WS Protect Dust Hi-Sheen ...`.

#### TILE (8 SKUs)
Base + Yellow Base only (4 sizes each). NO clear/coloured variants stocked at Surat. JSW catalog lists WS TILE CLEAR (1 SKU) but it's not in CSV → not stocked.

#### TEXTURE (5 SKUs)
Low volume. Currently 2 in WS + 3 in WEATHERCOAT.

#### METALLIC (6 SKUs)
**Currently filed under EMULSION/WS METALLIC in CSV** — JSW catalog places in EXTERIORS. Phase 2 SQL: `UPDATE mo_sku_lookup SET category='METALLIC' WHERE product='WS METALLIC';` Silver + Gold variants only, packs 200ml/0.5L/1L.

#### PROMISE EXTERIOR (64 SKUs) — CROSS-LISTED
Already exists across 3 schema categories. Stays in current categories + appears as own top-level on `/place-order` for operator discoverability.

| Sub-product | SKUs | Schema source |
|---|---|---|
| PROMISE EXTERIOR | 40 | `category=PROMISE, product=PROMISE EXTERIOR` |
| PROMISE SHEEN EXTERIOR | 20 | `category=PROMISE SHEEN, product=PROMISE SHEEN EXTERIOR` (16) + `category=PROMISE, product=PROMISE SHEEN EXTERIOR` (4 stragglers) |
| PROMISE SMARTCHOICE EXT | 4 | `category=PROMISE SMARTCHOICE, product=PROMISE SMARTCHOICE EXT` |
| PROMISE SMARTCHOICE EXT PRIMER | 4 | `category=PROMISE SMARTCHOICE, product=PROMISE SMARTCHOICE EXT PRIMER` |

### 3.5 Deferred / not stocked at Surat

- **WS SIGNATURE** (designer shades — Black Diamond, Royal Emerald, Ivory Pearl, Rustic Ruby, Imperial Topaz, Icy Sapphire, Rare Platinum, Precious Brownzite). 0 SKUs in CSV. Skip.
- **WS TILE CLEAR** — 0 SKUs in CSV. Skip.
- **Smaller WS specialty products** (ELASTOMERIC, FLASH, PRIMA E900, PROJECT, TR E2000, ULTRACLEAN — total 33 SKUs in WEATHERCOAT category) — defer to a separate "specialty exterior coatings" round to avoid clutter on the main exterior order form. Already noted in pending items per `web-update-2026-04-22-tier-a-reference-data.md`.

### 3.6 What changes from current state

| Currently in OrbitOMS | Becomes |
|---|---|
| `mo_order_form_index` WS family with sub-products HISHEEN, MAX, POWERFLEXX, PROTECT, PROTECT RAINPROOF, TEXTURE, TILE, ELASTOMERIC, FLASH, METALLIC, PRIMA E900, PROJECT, TR E2000, ULTRACLEAN | WS family is dissolved. Top 8 products become own top-levels. Smaller WS products (ELASTOMERIC, FLASH, PRIMA E900, PROJECT, TR E2000, ULTRACLEAN) deferred to a separate specialty round |
| `mo_sku_lookup` categories WS (192) + WEATHERCOAT (111) — same products, different SAP generations | Categories STAY as-is in `mo_sku_lookup`. Order form references the product (MAX/POWERFLEXX/etc.) regardless of category. Parser scoring rule (Phase 2) prefers WEATHERCOAT entries when both match |
| Sub-product MAX (in WS family) | MAX top-level. Both WS/MAX (50) + WEATHERCOAT/MAX (23) point to same display entry |
| Sub-product POWERFLEXX | POWERFLEXX top-level. Both WS/PF (35) + WEATHERCOAT/PF (27) |
| Sub-product PROTECT | PROTECT top-level with 2 sub-products: PROTECT (plain, 50) + PROTECT DUSTPROOF (19, newer) |
| Sub-product PROTECT RAINPROOF | RAINPROOF top-level. Both WS/RP (31) + WEATHERCOAT/RP (9) |
| `EMULSION/WS METALLIC` (6 SKUs in EMULSION) | Move to METALLIC top-level under EXTERIORS. Phase 2 SQL: UPDATE category from EMULSION to METALLIC |
| Promise Exterior variants (across PROMISE, PROMISE SHEEN, PROMISE SMARTCHOICE) | Stay in current schema categories + cross-listed in new PROMISE EXTERIOR top-level on `/place-order` |

### 3.7 Cross-listing decisions

| Sub-product | Cross-listed in | Mechanism |
|---|---|---|
| PROMISE EXTERIOR + PROMISE SHEEN EXTERIOR + PROMISE SMARTCHOICE EXT + PROMISE SMARTCHOICE EXT PRIMER (64 SKUs total) | PROMISE / PROMISE SHEEN / PROMISE SMARTCHOICE families + PROMISE EXTERIOR section on `/place-order` | Display-only duplicate rows in `mo_order_form_index`. Same SKU rows in `mo_sku_lookup` (no change). Operators can find Promise exteriors via either route |

### 3.8 Aliases / parser keywords (Phase 2 seeding)

| Sub-product / Family | Keywords / Aliases |
|---|---|
| MAX | WS MAX, MAX, MAX 10YR, WS MAX 10YR |
| POWERFLEXX | WS PF, PF, POWERFLEXX, WS POWERFLEXX, PF 15YR, WS PF 15YR |
| PROTECT | WS PROTECT, PROTECT |
| PROTECT DUSTPROOF | WS DUSTPROOF, DUSTPROOF, WS PROTECT DUSTPROOF, PROTECT DUSTPROOF |
| RAINPROOF | WS RP, RP, RAINPROOF, WS RAINPROOF, PROTECT RAINPROOF, RP 8YR |
| HISHEEN | HISHEEN, HI-SHEEN, WS HISHEEN, WS HI-SHEEN, PROTECT DUSTPROOF HI-SHEEN |
| TILE | WS TILE, TILE, WS TILE BASE |
| TEXTURE | WS TEXTURE, TEXTURE |
| METALLIC | WS METALLIC, METALLIC SILVER, METALLIC GOLD, WS METALLIC SILVER, WS METALLIC GOLD |
| PROMISE EXTERIOR | PROMISE EXTERIOR, PROMISE EXT, PROMISE SHEEN EXTERIOR, PROMISE SHEEN EXT, PROMISE SMARTCHOICE EXT, PROMISE SC EXT |

### 3.9 Migration risks (EXTERIORS-specific)

#### Phase 1 risks (mo_order_form_index only)
- **WS family dissolution affects most existing operator muscle memory.** Operators today may go to "WS" then pick MAX. After redesign, MAX is top-level. Brief adjustment period — strict UX win once learned.
- **Cross-listing 4 Promise Exterior variants** — adds duplicate rows in `mo_order_form_index`. Same constraint check as Promise Enamel applies.
- **Removing smaller WS products** (ELASTOMERIC etc.) from main view temporarily until specialty round runs. Risk: if these get ordered before specialty round lands, operator falls back to manual SAP punch.

#### Phase 2 risks (mo_sku_lookup + parser + code)
- **Parser scoring rule** must be added: prefer `WEATHERCOAT` over `WS` for matching combos. Needs Test 1 + Test 2 stress test pattern (per `web-update-2026-04-23-phase3-reference-data.md`) to verify no enrichment regression.
- **WS METALLIC category move (EMULSION → METALLIC)** — 6 row UPDATE. Verify no code grep refs `category=EMULSION` for these 6 SKUs.
- **Rebadge cleanup remains pending** — see `web-update-2026-04-28-gloss-bw-generic-cleanup.md` T3 cleanup for the per-family decision (which generation wins). When that runs, taxonomy doesn't change — only `isActive` flag flips on losing-generation rows.
- **Hardcoded `category === "WS"` references in code** — grep before any SQL. Suspect locations: Tint Manager filtering, dispatch reports, MIS rollups.
- **`category === "WEATHERCOAT"` references** — same grep concern. Lower likelihood since WEATHERCOAT was a recent SAP add.

### 3.10 Operator pushback notes

- **WS family dissolved into 8 top-levels** — biggest mental shift in this round. Operators going from "open WS, scroll" → "open MAX directly". Worth a 10-minute walkthrough at rollout. Include a printed cheat sheet on Deepanshu/Bankim's desk for the first week.
- **Cross-listing Promise Exterior** — strict UX win, no pushback expected.
- **WS METALLIC moves out of EMULSION** — affects ZERO operator workflow today (no one orders these from `/place-order` since the index doesn't surface them). After move, becomes discoverable.
- **Smaller WS products temporarily missing** — confirm with Deepanshu that no one orders these via `/place-order` today. If they do, defer dissolution until specialty round runs.

### 3.11 Open follow-ups for EXTERIORS

- **Confirm the parser scoring rule** (prefer WEATHERCOAT > WS) when next checking parser conditions per Smart Flow comment.
- **Specialty exterior coatings round** — separate session to handle ELASTOMERIC, FLASH, PRIMA E900, PROJECT, TR E2000, ULTRACLEAN (33 SKUs in WEATHERCOAT). Decision needed: separate top-levels or one EXTERIOR SPECIALTY bucket.
- **T3 rebadge cleanup** — per `web-update-2026-04-28-gloss-bw-generic-cleanup.md`, query last 30 days of `import_raw_line_items` per product family, present to Prakashbhai, decide which generation wins per family. Out of scope for this taxonomy session.
- **Add `isActive` column to mo_sku_lookup** (pre-requisite for rebadge cleanup) — already in pending items, not blocked by this round.
- **Verify `mo_order_form_index` schema** has no unique constraint that blocks cross-listing PROMISE EXTERIOR variants.

---

## SECTION 4 — INTERIORS · Round 4A (locked)
**Scope: SuperCover + SuperClean + VT only.** Promise Interior, 5IN1, distempers, single-row DULUX orphans, Duwel, primers — deferred to Round 4B / 4C.

**Structural revision:** earlier draft had VT bundled as a single top-level with 8 internal sub-products. Smart Flow revised: split VT into THREE separate top-levels (VT GLO, VT ETERNA, VT SPECIALTY). Round 4A now produces 5 top-levels instead of 3.

### 4.1 New top-level categories produced

| # | Top-Level Category | Display Label | SKU Count | What's inside |
|---|---|---|---|---|
| 1 | SUPERCOVER | SuperCover | 32+ | SUPERCOVER (plain, 26) + SUPERCOVER SHEEN (6) + SUPERCOVER ULTRA (per JSW PDF, stocked at Surat per Q2) |
| 2 | SUPERCLEAN | SuperClean | 71 | SUPERCLEAN (44 across two SAP generations) + SUPERCLEAN 3IN1 (37 across two generations). Parser prefers newer NEW / MR generation |
| 3 | VT GLO | VT Glo | 94 | PEARL GLO (42, **DEFAULT** for bare 'VT') + PLATINUM GLO (23) + DIAMOND GLO (29) |
| 4 | VT ETERNA | VT Eterna | 46+ | ETERNA Sheen (21) + ETERNA MATT (9) + ETERNA HI-SHEEN (16) + ETERNA BASECOAT (per JSW PDF, stocked) |
| 5 | VT SPECIALTY | VT Specialty (Ambiance) | 28+ | 9 specialty lines: VAF, VT FIN, LUXURY FINISHES, VT CONCRETE FINISH, VT METALLICS, AMBIANCE, VT CLEAR COAT, VT MARBLE, VELVETINO |

### 4.2 Critical decisions — Round 4A

#### Decision A: VT split into THREE parallel top-levels (not bundled)
Smart Flow revised earlier 'VT bundled as one family' decision. New structure: VT GLO, VT ETERNA, VT SPECIALTY are three separate top-level families. Reasoning:
- Operators distinguish all three product families clearly in SO emails (`Vt platinum glo`, `VT Eterna Matt`, `Vt finish Archi concrete`).
- Three separate top-levels reduces hunting time vs one top-level with 8 sub-products.
- Each VT product family has its own internal logic: GLO has 3 product tiers; ETERNA has 4 finish variants; SPECIALTY has 9 decorative lines that don't fit elsewhere.
- Bare 'VT' or 'Vt White' (rare but seen) routes via parser default to VT GLO → PEARL GLO. Maintains operator muscle memory.

**Parser default rule:** when SO writes bare `VT` or `Vt White`, parser routes to VT GLO → PEARL GLO (highest-volume VT line).

#### Decision B: VT SPECIALTY as own top-level (per Q3, kept from earlier draft)
9 low-volume decorative VT lines as sub-products of VT SPECIALTY top-level:
- VAF (3 SKUs)
- VT FIN (5)
- LUXURY FINISHES (10) — Marmorino, Clay
- VT CONCRETE FINISH (4) — incl. Archi Concrete per email evidence
- VT METALLICS (2)
- AMBIANCE (2)
- VT CLEAR COAT (1)
- VT MARBLE (1)
- VELVETINO (per JSW PDF, codes 5967833 / 5967836)

Total 28+ SKUs. Display label "VT Specialty (Ambiance)". If volume picks up on any one line, promote to own VT SPECIALTY sub-product display position later.

#### Decision C: SuperClean rebadge handled via Option A (same as WS round)
DULUX/SUPERCLEAN (21 SKUs, older) and SUPERCLEAN/SUPERCLEAN (23 SKUs, newer "SUPERCLEAN NEW") are two SAP generations of the same product. Operators write bare `Super clean white` / `Super clean 90` — no generation signal. Same problem as WS MAX/POWERFLEXX/RAINPROOF.

**Approach:** taxonomy treats SUPERCLEAN as one product. Parser prefers newer generation when same combo exists in both. SKU table category column unchanged.

Same logic for 3IN1: DULUX/3IN1 (10, original "SCN 3IN1") + SUPERCLEAN/3IN1 (27, newer "SCN 3IN1 MARK RESISTANT"). One sub-product `SUPERCLEAN 3IN1`. Parser prefers MR.

#### Decision D: Scope strictly bounded to JSW PDFs shared this round (per Q5)
Smart Flow confirmed: "Promise is a cross product, will come after interior is done. Don't add — just add what is in image I share."

This round covers ONLY the products in the 5 INTERIORS PDFs:
- Image 1: SUPERCOVER ULTRA
- Image 2: SUPERCLEAN 3IN1 MR + SUPERCLEAN 3IN1 + SUPERCLEAN NEW
- Image 3: VT PEARL GLO + VT PLATINUM GLO
- Image 4: VT AMBIANCE specialty + VT ETERNA MATT + VT ETERNA SHEEN
- Image 5: VT ETERNA SHEEN cont. + VT ETERNA BASECOAT + VT DIAMOND GLO

Plain SUPERCOVER (non-Ultra) and DULUX/SUPERCLEAN (older) are PRE-EXISTING SKUs — they fold into the new top-levels via Option A (no orphans, parser prefers newer).

### 4.3 Sub-products per top-level (final)

#### SUPERCOVER (32+ SKUs)
| Sub-product | SKU count | Notes |
|---|---|---|
| SUPERCOVER | 26 | Plain SuperCover line. Brilliant White + bases. |
| SUPERCOVER SHEEN | 6 | Sheen variant. |
| SUPERCOVER ULTRA | TBD per JSW PDF (image 1) | Brilliant White + bases 90/92/94/95/96/97. Confirmed stocked at Surat per Q2. Phase 2 SQL: seed in mo_sku_lookup if not already present under different naming. |

Email evidence: `Supercover Brilliant White`, `Supercover 93`, `Super cover ultra wht`, `Supercover ultra white`. Bare "Supercover" and "Supercover ultra" both used by operators.

#### SUPERCLEAN (71 SKUs)
| Sub-product | SKU count | Notes |
|---|---|---|
| SUPERCLEAN | 44 (21 DULUX/SUPERCLEAN + 23 SUPERCLEAN/SUPERCLEAN) | Single sub-product abstracts two SAP generations. Parser prefers newer "SUPERCLEAN NEW" descriptions. |
| SUPERCLEAN 3IN1 | 37 (10 DULUX/3IN1 + 27 SUPERCLEAN/3IN1) | Single sub-product abstracts two generations. Parser prefers Mark Resistant. |

Email evidence: `Super clean white`, `Super clean 90`. No "3in1" mentions in this round's samples — but JSW PDF and CSV both confirm 3in1 is a real distinct sub-product.

#### VT GLO (94 SKUs)
| Sub-product | SKU count | Default? | Notes |
|---|---|---|---|
| PEARL GLO | 42 | **DEFAULT** | Brilliant White + bases 90/92/93/94/95/96/97. Parser routes bare "VT" or "Vt White" here. |
| PLATINUM GLO | 23 | — | White + bases 90/92/93/94/95/96/97. |
| DIAMOND GLO | 29 | — | White + bases 90/92/93/94/95/96/97. |

#### VT ETERNA (46+ SKUs)
| Sub-product | SKU count | Notes |
|---|---|---|
| ETERNA | 21 | Eterna Sheen variant per JSW PDF. White/90 Base + bases 92/93/94. |
| ETERNA MATT | 9 | White/90 + bases 92/93/94. |
| ETERNA HI-SHEEN | 16 | Hi-Sheen variant. |
| ETERNA BASECOAT | TBD per JSW PDF (image 5) | Confirmed stocked per Q3. Phase 2 SQL: seed in mo_sku_lookup with JSW PDF code 58524 37-40. |

#### VT SPECIALTY (28+ SKUs across 9 sub-products)
| Sub-product | SKU count |
|---|---|
| VAF | 3 |
| VT FIN | 5 |
| LUXURY FINISHES | 10 |
| VT CONCRETE FINISH | 4 |
| VT METALLICS | 2 |
| AMBIANCE | 2 |
| VT CLEAR COAT | 1 |
| VT MARBLE | 1 |
| VELVETINO | per JSW PDF |

### 4.4 Operator phrasing evidence

| Product | SO phrases observed |
|---|---|
| VT bare (no tier) | `Vt White -1*6` |
| VT Pearl Glo | `Vt platinum glo white`, `Vt pearl br white`, `VT pearl glo white`, `VT Pearl Glow Brilliant White` (typo) |
| VT Platinum Glo | `Vt platinum glo white`, `Vt platinum glo 92`, `Vt platinum glo 93`, `VT platinum white` |
| VT Eterna | `VT Eterna Matt white`, `Vt Eterna base coat -10*1` |
| VT Concrete (Specialty) | `Vt finish Archi concrete - 25kgs@ 1 drums` |
| SuperCover Ultra | `Super cover ultra wht`, `Supercover ultra white` |
| SuperCover plain | `Supercover Brilliant White`, `Supercover 93` |
| SuperClean | `Super clean white`, `Super clean 90` |

**Typo guard:** "Glow" appears multiple times for "Glo". All three GLO sub-products need GLOW alias.

### 4.5 What changes from current state

| Currently in OrbitOMS | Becomes |
|---|---|
| mo_order_form_index VT family with PEARL GLO, PLATINUM GLO, DIAMOND GLO, ETERNA, ETERNA MATT, ETERNA HI-SHEEN, AMBIANCE, VAF, VT FIN, etc. all as flat sub-products under VT | VT family split into THREE separate top-levels: VT GLO (3 sub-products), VT ETERNA (4 sub-products), VT SPECIALTY (9 sub-products) |
| DULUX/SUPERCLEAN (21) + SUPERCLEAN/SUPERCLEAN (23) | Both surface under new SUPERCLEAN top-level as single sub-product. Parser prefers newer. SKU table category column unchanged |
| DULUX/3IN1 (10) + SUPERCLEAN/3IN1 (27) | Both surface under SUPERCLEAN top-level as sub-product 'SUPERCLEAN 3IN1'. Parser prefers MR variant |
| SUPERCOVER family with SUPERCOVER + SUPERCOVER SHEEN as sub-products | Promote to top-level. Add SUPERCOVER ULTRA as new sub-product |
| VT specialty products (VAF, AMBIANCE, etc.) as 9 separate sub-products under VT family | Move to new VT SPECIALTY top-level with 9 sub-products inside |
| VT ETERNA / ETERNA MATT / ETERNA HI-SHEEN as 3 sub-products under VT | Move to new VT ETERNA top-level + add ETERNA BASECOAT as 4th sub-product |
| VT PEARL GLO / PLATINUM GLO / DIAMOND GLO as 3 sub-products under VT | Move to new VT GLO top-level. PEARL GLO is parser default for bare 'VT' |
| VT ETERNA BASECOAT not currently in mo_sku_lookup | Add as new sub-product under VT ETERNA. Phase 2 SQL: seed with JSW PDF code 58524 37-40 |
| Default behaviour for bare 'VT' in SO emails | Parser default = VT GLO → PEARL GLO. Documented as parser rule |

### 4.6 Cross-listing decisions

**None for Round 4A.** No SKU appears in two top-level families. PROMISE INTERIOR cross-listing deferred to Round 4B per Q5.

### 4.7 Aliases / parser keywords (Phase 2 seeding)

| Sub-product / Family | Keywords / Aliases |
|---|---|
| SUPERCOVER | SUPERCOVER, SUPER COVER, DULUX SUPERCOVER |
| SUPERCOVER SHEEN | SUPERCOVER SHEEN, SUPER COVER SHEEN |
| SUPERCOVER ULTRA | SUPERCOVER ULTRA, SUPER COVER ULTRA, SC ULTRA, ULTRA |
| SUPERCLEAN | SUPERCLEAN, SUPER CLEAN, SCN, SUPERCLEAN NEW, DULUX SUPERCLEAN |
| SUPERCLEAN 3IN1 | 3IN1, 3-IN-1, SCN 3IN1, SUPERCLEAN 3IN1, 3IN1 MR, MARK RESISTANT, 3IN1 MARK RESISTANT, SCN 3IN1 MR |
| VT (bare → VT GLO → PEARL GLO) | VT, VELVET TOUCH, DULUX VT, DULUX VELVET TOUCH |
| VT GLO — PEARL GLO (default) | PEARL GLO, PEARL GLOW (typo guard), VT PEARL, PEARL, DULUX PEARL GLO |
| VT GLO — PLATINUM GLO | PLATINUM GLO, PLATINUM GLOW (typo guard), VT PLATINUM, PLATINUM |
| VT GLO — DIAMOND GLO | DIAMOND GLO, DIAMOND GLOW (typo guard), VT DIAMOND, DIAMOND |
| VT ETERNA — ETERNA (sheen) | ETERNA, VT ETERNA, ETERNA SHEEN |
| VT ETERNA — ETERNA MATT | ETERNA MATT, VT ETERNA MATT, ETERNA MAT |
| VT ETERNA — ETERNA HI-SHEEN | ETERNA HI-SHEEN, ETERNA HISHEEN, ETERNA HI SHEEN |
| VT ETERNA — ETERNA BASECOAT | ETERNA BASECOAT, ETERNA BASE COAT, VT ETERNA BASECOAT |
| VT SPECIALTY — VAF | VAF, VAF METALLIC, VAF TRENDS, GLITTER SILVER, GLITTER GOLD, NON-METALLIC |
| VT SPECIALTY — VT CONCRETE FINISH | CONCRETE FINISH, VT CONCRETE, ARCHI CONCRETE, VT FINISH ARCHI |
| VT SPECIALTY — LUXURY FINISHES | LUXURY FINISHES, MARMORINO, CLAY, VT LUXURY |
| VT SPECIALTY — VT FIN | VT FIN, FIN GOLD, FIN SILVER |
| VT SPECIALTY — VT METALLICS | VT METALLICS, METALLICS GOLD, METALLICS SILVER |
| VT SPECIALTY — AMBIANCE | AMBIANCE, VT AMBIANCE |
| VT SPECIALTY — VT CLEAR COAT | VT CLEAR COAT, CLEAR COAT MATT |
| VT SPECIALTY — VT MARBLE | VT MARBLE, MARBLE FINISH |
| VT SPECIALTY — VELVETINO | VELVETINO, VELVETINO GOLD, VELVETINO SILVER |

### 4.8 Migration risks (Round 4A specific)

#### Phase 1 risks (mo_order_form_index only)
- VT family in order form retired and replaced with 3 new top-levels (VT GLO, VT ETERNA, VT SPECIALTY). Big change for operators. Walkthrough at rollout will be needed: "VT is now three buckets — open VT GLO for Pearl/Platinum/Diamond, VT ETERNA for Eterna variants, VT SPECIALTY for decorative finishes."
- SUPERCOVER and SUPERCLEAN graduate from sub-products to top-levels.
- SUPERCOVER ULTRA and VT ETERNA BASECOAT need new entries in `mo_order_form_index` even before mo_sku_lookup seeding (otherwise won't appear on `/place-order`).

#### Phase 2 risks (mo_sku_lookup + mo_product_keywords + parser)
- **T3 rebadge for SUPERCLEAN and 3IN1** — same problem as WS MAX/PowerFlexx/Rainproof. Connects to existing pending item per `web-update-2026-04-28-gloss-bw-generic-cleanup.md`.
- **DULUX category in mo_sku_lookup loses SUPERCLEAN, 3IN1 SKUs effectively** — they're still in DULUX category in the SKU table (no change), but the order form abstracts them under SUPERCLEAN top-level. Same pattern as WEATHERCOAT in EXTERIORS round.
- **"GLOW" typo handling** — add to parser keyword list for all 3 GLO sub-products (PEARL/PLATINUM/DIAMOND).
- **VT category consolidation** — current `mo_sku_lookup` has 168 rows in VT category across 14 products. Three new order-form top-levels (VT GLO, VT ETERNA, VT SPECIALTY) abstract over the existing VT category — no SKU table changes required for this. Display layer alone groups them.
- **SUPERCOVER ULTRA seeding** — JSW PDF lists code 5853009/10/11/12/31 series. Confirm these exist in current SAP master before adding to mo_sku_lookup. May require Chandresh/Prakashbhai input.
- **VT ETERNA BASECOAT seeding** — same as Ultra. JSW PDF lists code 58524 37-40. Confirm SAP master.

### 4.9 Operator pushback notes

- **VT family split into three top-levels** — biggest visible UX change in this round. Operator muscle memory was "open VT, scroll to find Pearl/Platinum/Diamond/Eterna/Specialty". After: open the right VT bucket directly. Three separate buckets vs one with sub-products is faster but requires the operator to know which VT family they want. Walkthrough at rollout essential.
- **SUPERCOVER and SUPERCLEAN promoted from DULUX sub-products to own top-levels** — saves operators the "open DULUX, scroll" step. UX win.
- **VT SPECIALTY as own top-level (instead of nested under VT)** — slight friction. Operator who used to find AMBIANCE deep inside VT now opens "VT SPECIALTY" directly. Net win since fewer clicks, but needs muscle memory rebuild.
- **Default to PEARL GLO** — invisible to operator; they won't notice unless an SO writes bare "VT" without tier (rare per the email evidence we have).

### 4.10 Open follow-ups for Round 4A

- **Verify SUPERCOVER ULTRA stock at Surat** — JSW PDF codes 5853009 series. Smart Flow confirmed yes, but actual SAP material codes need confirmation by Chandresh before seeding `mo_sku_lookup`.
- **Verify VT ETERNA BASECOAT stock** — JSW PDF code 58524 37-40. Same confirmation flow.
- **Verify VELVETINO codes** — JSW PDF lists codes 5967833 (Gold Base) / 5967836 (Silver Base). Confirm in SAP master before seeding.
- **T3 rebadge cleanup for SUPERCLEAN + 3IN1** — connects to existing `isActive` column pending item. Out of scope for taxonomy round.
- **Round 4B scope** — Promise Interior + Promise Sheen Interior + Promise Smartchoice Interior + Promise Smartchoice Acrylic Distemper + 5IN1 + remaining DULUX-orphans (SMOOTHOVER, SILK FINISH, INTERIOR DISTEMPER, IAE PROJECT, ALKALI BLOC PRIMER). Cross-listing pattern for Promise Interior to be confirmed (likely same as Promise Enamel + Promise Exterior).
- **Round 4C scope** — DUWEL family + PRIMER family + STAINER/TINTER (incl. GVA from WOODCARE round) + AUTO + DUCO + M900 + SPRAY PAINT + AQUATECH (waterproofing) + FLOOR PLUS + PUTTY + TOOLS.

---

## SECTION 5 — INTERIORS · Round 4B (locked)
**Scope: Promise mid-tier interior products only.** Per JSW PDFs (MID-TIER images 1-2): Promise Interior, Promise Sheen Interior, Promise Smartchoice Interior + Int Primer + Acrylic Distemper. Plus Promise Freedom 2in1 Primer (already in CSV under PRIMER family).

### 5.1 New top-level categories produced

| # | Top-Level Category | Display Label | SKU Count | What's inside |
|---|---|---|---|---|
| 1 | PROMISE INTERIOR | Promise Interior | 64 | 7 sub-products. CROSS-LISTED in PROMISE family (per Q1=a) |

### 5.2 Critical decisions — Round 4B

#### Decision A: Single new top-level (PROMISE INTERIOR)
Symmetrical with Round 2 (PROMISE ENAMEL) and Round 3 (PROMISE EXTERIOR). Promise mid-tier brand splits across three functional buckets (ENAMEL / EXTERIOR / INTERIOR), each cross-listed back to the PROMISE umbrella family.

#### Decision B: PROMISE family stays as brand-aggregator (per Q1=a)
After all rounds, PROMISE family on `/place-order` displays ~12 sub-products visible (cross-listed from ENAMEL / EXTERIOR / INTERIOR top-levels). Operator who searches "Promise" sees everything Promise-branded in one place.

#### Decision C: Promise Smartchoice retired as own family
PROMISE SMARTCHOICE category in current OrbitOMS has 5 sub-products (INT, INT PRIMER, EXT, EXT PRIMER, ACRYLIC DISTEMPER). Across Rounds 3 + 4B, all 5 are absorbed into PROMISE EXTERIOR or PROMISE INTERIOR top-levels. Smartchoice is a sub-tier of Promise mid-tier, not its own brand.

#### Decision D: Promise Freedom Interior/Exterior PAINT variants deferred (per Q2=a)
JSW PDF (Image 1) shows Promise Freedom Interior codes 5909153/54/55, Promise Freedom Exterior codes 5909156/57/58, 5915663/64/65. **These codes are NOT in current `mo_sku_lookup`.** Per Q2(a): skip — assume not stocked at Surat, add later if confirmed stocked. Adding non-stocked products to `/place-order` would create dispatch failures.

#### Decision E: Promise Freedom 2in1 PRIMER included
This is the only Freedom product actually stocked at Surat — 4 SKUs in `category=PRIMER, product=PROMISE FREEDOM 2IN1`. Operator email evidence shows three different phrasings (`Promise Freedom primer`, `Promise 2in1 Int Ext Primer`, `Promise 2in1 Primer`) all resolving to this SKU set. Surfaced under PROMISE INTERIOR with all three phrasings as keyword aliases.

#### Decision F: Single-SKU PROMISE PRIMER orphan included with deactivation flag
1 SKU at IN84500023 = `DN PROMISE PRIMER 1L`. Likely superseded by Freedom 2in1 (same use case). Rather than orphan it from the order form (risk: dispatch failure if someone orders it), surface under PROMISE INTERIOR and flag for Phase 2 deactivation review with Chandresh.

### 5.3 Sub-products inside PROMISE INTERIOR (64 SKUs)

| Sub-product | SKU count | Source category in CSV | Operator phrasing |
|---|---|---|---|
| PROMISE INTERIOR | 26 | PROMISE/PROMISE INTERIOR | "Promise interior white", "Promise interior 90", "Promise interior 92" |
| PROMISE SHEEN INTERIOR | 22 (18 + 4 drift) | PROMISE SHEEN/PROMISE SHEEN INTERIOR + 4 drift in PROMISE/PROMISE SHEEN INTERIOR | "Promise Sheen Interior White" |
| PROMISE SMARTCHOICE INT | 4 | PROMISE SMARTCHOICE/PROMISE SMARTCHOICE INT | "promise int smart choice", "Smartchoice Interior" |
| PROMISE SMARTCHOICE INT PRIMER | 4 | PROMISE SMARTCHOICE/PROMISE SMARTCHOICE INT PRIMER | "Smartchoice Interior Primer" |
| PROMISE SMARTCHOICE ACRYLIC DISTEMPER | 3 | PROMISE SMARTCHOICE/PROMISE SMARTCHOICE ACRYLIC DISTEMPER | "Promise smart choice distemper", "Promise smart choice acrylic Distemper" |
| PROMISE FREEDOM 2IN1 PRIMER | 4 | PRIMER/PROMISE FREEDOM 2IN1 | "Promise Freedom primer", "Promise 2in1 Int Ext Primer", "Promise 2in1 Primer" |
| PROMISE PRIMER (orphan) | 1 | PROMISE/PROMISE PRIMER (IN84500023) | (no email samples — likely deactivation candidate) |

### 5.4 Cross-listing decisions (cumulative across all rounds)

After Round 4B locks, the **PROMISE umbrella family** on `/place-order` displays:

| Sub-product (in PROMISE family view) | Source top-level | Round locked |
|---|---|---|
| PROMISE ENAMEL (white + colours + olive green) | PROMISE ENAMEL | Round 2 (ENAMELS) |
| PROMISE EXTERIOR | PROMISE EXTERIOR | Round 3 (EXTERIORS) |
| PROMISE SHEEN EXTERIOR | PROMISE EXTERIOR | Round 3 |
| PROMISE SMARTCHOICE EXT | PROMISE EXTERIOR | Round 3 |
| PROMISE SMARTCHOICE EXT PRIMER | PROMISE EXTERIOR | Round 3 |
| PROMISE INTERIOR | PROMISE INTERIOR | Round 4B (this) |
| PROMISE SHEEN INTERIOR | PROMISE INTERIOR | Round 4B |
| PROMISE SMARTCHOICE INT | PROMISE INTERIOR | Round 4B |
| PROMISE SMARTCHOICE INT PRIMER | PROMISE INTERIOR | Round 4B |
| PROMISE SMARTCHOICE ACRYLIC DISTEMPER | PROMISE INTERIOR | Round 4B |
| PROMISE FREEDOM 2IN1 PRIMER | PROMISE INTERIOR | Round 4B |
| PROMISE PRIMER (orphan) | PROMISE INTERIOR | Round 4B |

Total ~12 sub-products visible under PROMISE family view. Operator searches "Promise" → finds everything Promise-branded.

### 5.5 Cross-listing mechanism
Display-only duplicate rows in `mo_order_form_index`:
- One row per SKU under PROMISE INTERIOR top-level
- Same SKU rows also listed under PROMISE family
- Single source of truth in `mo_sku_lookup` (no change to category column)
- Mechanism identical to Promise Enamel (Round 2) and Promise Exterior (Round 3)

### 5.6 What changes from current state

| Currently in OrbitOMS | Becomes |
|---|---|
| PROMISE family with PROMISE INTERIOR, PROMISE SHEEN INTERIOR, PROMISE PRIMER mixed in with EXTERIOR variants | PROMISE INTERIOR top-level created (cross-listed in PROMISE family). PROMISE family stays as brand-aggregator |
| PROMISE SHEEN INTERIOR split: 18 in PROMISE SHEEN, 4 drift in PROMISE | Both surface under PROMISE INTERIOR top-level. SKU table category column unchanged. Phase 2 cleanup task: re-categorise the 4 drift rows |
| PROMISE SMARTCHOICE family with INT, INT PRIMER, ACRYLIC DISTEMPER (interior variants) | All 3 absorbed as sub-products under PROMISE INTERIOR. PROMISE SMARTCHOICE family in order form retired (EXT variants already absorbed in Round 3) |
| PRIMER/PROMISE FREEDOM 2IN1 (4 SKUs) | Surfaces under PROMISE INTERIOR top-level as sub-product PROMISE FREEDOM 2IN1 PRIMER. SKU table stays in PRIMER category |
| PROMISE/PROMISE PRIMER (1 SKU orphan, IN84500023) | Surfaces under PROMISE INTERIOR. Flag as Phase 2 deactivation candidate |
| Promise Freedom Interior/Exterior PAINT (JSW PDF codes 5909153 series) | NOT seeded — not in CSV, not stocked at Surat. Add later if confirmed stocked |

### 5.7 Aliases / parser keywords (Phase 2 seeding)

| Sub-product | Keywords / Aliases |
|---|---|
| PROMISE INTERIOR | PROMISE INTERIOR, PROMISE INT, PROMISE INTR, PROMISE INTERIOR WHITE |
| PROMISE SHEEN INTERIOR | PROMISE SHEEN INTERIOR, PROMISE SHEEN INT, SHEEN INTERIOR |
| PROMISE SMARTCHOICE INT | PROMISE SMARTCHOICE INT, PROMISE SMARTCHOICE INTERIOR, SMARTCHOICE INT, SMARTCHOICE INTERIOR, PROMISE SMARTCH INT, PROMISE INT SMART CHOICE |
| PROMISE SMARTCHOICE INT PRIMER | PROMISE SMARTCHOICE INT PRIMER, SMARTCHOICE INT PRIMER, SMARTCHOICE INTERIOR PRIMER |
| PROMISE SMARTCHOICE ACRYLIC DISTEMPER | PROMISE SMARTCHOICE ACRYLIC DISTEMPER, SMARTCHOICE ACRYLIC DISTEMPER, PROMISE SMART CHOICE DISTEMPER, SMART CHOICE DISTEMPER, ACRYLIC DISTEMPER |
| PROMISE FREEDOM 2IN1 PRIMER | PROMISE FREEDOM PRIMER, PROMISE FREEDOM 2IN1, FREEDOM PRIMER, PROMISE 2IN1 PRIMER, PROMISE 2IN1 INT EXT PRIMER, 2IN1 INT EXT PRIMER, FREEDOM 2IN1 |
| PROMISE PRIMER (orphan) | PROMISE PRIMER (no other aliases — single SKU) |

### 5.8 Migration risks (Round 4B specific)

#### Phase 1 risks (mo_order_form_index only)
- **PROMISE family becomes the largest cross-list bucket** (~12 sub-products visible). May feel cluttered. Trade-off: operator can find anything Promise-branded in one place.
- **PROMISE SMARTCHOICE family in order form retired** — operators who used to open the SMARTCHOICE bucket now find these products under PROMISE INTERIOR / PROMISE EXTERIOR. Walkthrough at rollout.
- **Cross-listing creates duplicate rows in mo_order_form_index** — verify table schema doesn't have unique constraint on (material, category) that would block duplication. Same risk as Promise Enamel and Promise Exterior — likely fine, but worth confirming.

#### Phase 2 risks (mo_sku_lookup + mo_product_keywords + parser)
- **Data drift cleanup:** 4 rows of PROMISE SHEEN INTERIOR under `category=PROMISE` instead of `category=PROMISE SHEEN`. Phase 2 hygiene task — re-categorise these 4 rows.
- **PROMISE PRIMER orphan:** confirm with Chandresh whether IN84500023 is still active or superseded by Freedom 2in1. If superseded, mark inactive when `isActive` column lands.
- **Promise Freedom Interior/Exterior PAINT variants:** confirm with Chandresh whether to seed for future stocking, or leave out. Per Q2(a), defer for now.
- **Operator phrasing for FREEDOM PRIMER** — three different SO phrasings (`Promise Freedom primer`, `Promise 2in1 Primer`, `Promise 2in1 Int Ext Primer`). All resolve to same SKU. Aliases captured.
- **Heavy-volume SMARTCHOICE ACRYLIC DISTEMPER** — emails show big quantities (`20*10`, `10*10`, `5*20`). Make sure it's prominent in the PROMISE INTERIOR sub-product list (not buried below low-volume orphan PROMISE PRIMER).

### 5.9 Operator pushback notes

- **PROMISE family on /place-order becomes brand-aggregated bucket** — per Q1(a), this is intentional. Operator who thinks in brand terms gets one place to look.
- **PROMISE SMARTCHOICE family retired** — small UX adjustment. Walkthrough at rollout: "Smartchoice products now under Promise Interior / Promise Exterior."
- **Smartchoice Acrylic Distemper visibility** — high-volume product, must be prominent in PROMISE INTERIOR sub-product display order.

### 5.10 Open follow-ups for Round 4B

- **Confirm PROMISE PRIMER orphan status** with Chandresh (IN84500023 — `DN PROMISE PRIMER 1L`). Likely deactivation candidate.
- **Confirm Promise Freedom Interior/Exterior PAINT** stock at Surat with Chandresh. JSW PDF codes 5909153/54/55, 5909156/57/58, 5915663/64/65 not in CSV. Per Q2(a), defer for now.
- **Phase 2 data drift cleanup**: 4 PROMISE SHEEN INTERIOR rows mis-filed under `category=PROMISE`. Re-categorise to `PROMISE SHEEN`.
- **Round 4C scope** — DUWEL family + PRIMER family (other brands, NOT Promise Freedom 2in1 which is now under PROMISE INTERIOR) + STAINER/TINTER (incl. GVA from WOODCARE round) + AUTO + DUCO + M900 + SPRAY PAINT + AQUATECH (waterproofing) + FLOOR PLUS + PUTTY + TOOLS + 5IN1 + remaining DULUX-orphans (SMOOTHOVER, SILK FINISH, INTERIOR DISTEMPER, IAE PROJECT, ALKALI BLOC PRIMER).

---

## SECTION 6 — Round 4C (utility/prep families — application-grouped) — locked
**Scope:** all remaining categories. After this round, taxonomy redesign is COMPLETE pending operator review.

**Key strategic decision** (per Smart Flow): apply application-based grouping ONLY to utility/prep products that genuinely cross brands (PRIMER, DISTEMPER, PUTTY). Branded paint products (VT, WS lines, GLOSS, SATIN, PROMISE INTERIOR, etc.) keep their brand-line names because operators say the brand. Two-layer mental model: branded paints by brand, utility products by application.

### 6.1 New top-level categories produced

| # | Top-Level Category | Display Label | SKU Count | Type |
|---|---|---|---|---|
| 1 | AQUATECH | Aquatech (Waterproofing) | 70 | Application — existing structure |
| 2 | FLOOR PLUS | Floor Plus | 33 | Application — single product |
| 3 | TEXTURE | WS Texture | 5+ | Application — sub-products by texture variant |
| 4 | PRIMER | Primer | ~50 | **Application-based (NEW)** — cross-brand |
| 5 | DISTEMPER | Distemper | ~22 | **Application-based (NEW)** — cross-brand |
| 6 | PUTTY | Putty | 7 | **Application-based (NEW)** — cross-brand |
| 7 | STAINER | Stainer | ~69 | Stainer + Tinter merged. 5 sub-products |
| 8 | SMOOTHOVER | Smoothover | 1 | Operator-recognised noun |

### 6.2 Critical decisions — Round 4C

#### Decision A: Application-based grouping for utility products
PRIMER, DISTEMPER, PUTTY become application-based top-levels with sub-products organised by use-case/chemistry rather than brand. Operator language confirms ("Wood primer", "Acrylic distemper", "Polyputty" — application is the noun, not brand).

#### Decision B: DUWEL family retired
42 SKUs across 11 sub-products redistribute by application:
- DUWEL MAGIK (12) → DISTEMPER/MAGIK
- DUWEL ACRYLIC DISTEMPER (3) → DISTEMPER/ACRYLIC DISTEMPER
- DUWEL WOOD PRIMER (8) + DUWEL FARCO WHITE PRIMER (4) → PRIMER/WOOD PRIMER (Farco folded as white-tinted variant)
- DUWEL INTERIOR ACRYLIC PRIMER (5) → PRIMER/INTERIOR ACRYLIC PRIMER
- DUWEL RED OXIDE METAL PRIMER (2) → PRIMER/RED OXIDE METAL PRIMER
- DUWEL WB CEMENT PRIMER (2) → PRIMER/CEMENT PRIMER WB
- DUWEL ICI/IP SB CEMENT PRIMER (2) → PRIMER/CEMENT PRIMER SB
- DUWEL POLYPUTTY (3) → PUTTY/POLYPUTTY
- DUWEL ENAMEL (1) → SKIPPED (single-row orphan, no good fit)

#### Decision C: STAINER + TINTER merged with HP COLORANT inclusion
Single STAINER top-level, 5 sub-products: UNIVERSAL STAINER (10 colour shades collapsed into one), PU STAINER (12 GVA from Round 1), ACOTONE TINTER (14 SKUs), MACHINE TINTER (10 SKUs — renamed from "Dealer Tinter" per Smart Flow), HP COLORANT (3 SKUs from retired OTHER family).

#### Decision D: AUTO, DUCO, M900, SPRAY PAINT, 5IN1, TOOLS hidden from /place-order
129 SKUs total (58+16+12+11+26+6). Stay in `mo_sku_lookup`. Parser still recognises. Reversible. Smart Flow's call.

#### Decision E: Single-row DULUX orphans absorbed or skipped
- DULUX/INTERIOR DISTEMPER (1) → folds into DISTEMPER/ACRYLIC DISTEMPER
- DULUX/ALKALI BLOC PRIMER (1) → folds into PRIMER/ALKALI BLOC PRIMER
- DULUX/SILK FINISH (1), DULUX/IAE PROJECT (2) → SKIPPED from order form (parser still resolves)

#### Decision F: Cross-listing for primers
Promise primer variants live in BOTH the new PRIMER family (operator searches "primer") AND in PROMISE INTERIOR / PROMISE EXTERIOR (operator searches "promise"). Three cross-listed primer sub-products: PROMISE PRIMER, 2IN1 INTERIOR-EXTERIOR PRIMER, SMARTCHOICE INT/EXT PRIMER.

### 6.3 PRIMER family — sub-products

| Sub-product | Source SKUs | Count | Use case |
|---|---|---|---|
| WOOD PRIMER | DUWEL WOOD PRIMER (8) + DUWEL FARCO WHITE PRIMER (4) | 12 | Wood surface prep |
| RED OXIDE METAL PRIMER | DUWEL RED OXIDE METAL PRIMER (2) | 2 | Metal prep |
| ZINC YELLOW METAL PRIMER | PRIMER/ZINC YELLOW METAL PRIMER (4) | 4 | Metal prep |
| CEMENT PRIMER WB | DUWEL WB CEMENT PRIMER (2) + PRIMER/DULUX WB CEMENT PRIMER (3) | 5 | Water-based cement primer |
| CEMENT PRIMER SB | PRIMER/SB CEMENT PRIMER (4) + DUWEL ICI/IP SB CEMENT PRIMER (2) | 6 | Solvent-based cement primer |
| INTERIOR ACRYLIC PRIMER | DUWEL INTERIOR ACRYLIC PRIMER (5) | 5 | Interior wall prep |
| EXTERIOR ACRYLIC PRIMER | PRIMER/EXTERIOR ACRYLIC PRIMER (4) | 4 | Exterior wall prep |
| ALKALI BLOC PRIMER | PRIMER/ALKALI BLOC PRIMER (4) + DULUX/ALKALI BLOC PRIMER (1) | 5 | Alkalinity blocking |
| QUICK DRYING PRIMER (ROM) | PRIMER/ROM (5) | 5 | Quick-dry general primer |
| 2IN1 INTERIOR-EXTERIOR PRIMER | PRIMER/PROMISE 2IN1 (4, older) + PRIMER/PROMISE FREEDOM 2IN1 (4, newer) | 8 | CROSS-LISTED with PROMISE INTERIOR. T3 rebadge — parser prefers Freedom |
| SMARTCHOICE INT PRIMER | PROMISE SMARTCHOICE/PROMISE SMARTCHOICE INT PRIMER (4) | 4 | CROSS-LISTED with PROMISE INTERIOR |
| SMARTCHOICE EXT PRIMER | PROMISE SMARTCHOICE/PROMISE SMARTCHOICE EXT PRIMER (4) | 4 | CROSS-LISTED with PROMISE EXTERIOR |
| PROMISE PRIMER | PRIMER/PROMISE PRIMER (4) + PROMISE/PROMISE PRIMER (1, drift) | 5 | CROSS-LISTED with PROMISE INTERIOR. Drift cleanup in Phase 2 |

### 6.4 DISTEMPER family — sub-products

| Sub-product | Source SKUs | Count |
|---|---|---|
| ACRYLIC DISTEMPER | DUWEL/DUWEL ACRYLIC DISTEMPER (3) + PROMISE SMARTCHOICE/PROMISE SMARTCHOICE ACRYLIC DISTEMPER (3) + DULUX/INTERIOR DISTEMPER (1) | 7 |
| MAGIK | DUWEL/DUWEL MAGIK (12) | 12 |

ACRYLIC DISTEMPER cross-listed with PROMISE INTERIOR (Smartchoice variant).

### 6.5 PUTTY family — sub-products

| Sub-product | Source SKUs | Count |
|---|---|---|
| ACRYLIC PUTTY | PUTTY/ACRYLIC PUTTY (3) | 3 |
| WATERPROOF PUTTY | AQUATECH/WATERPROOF PUTTY (1) | 1 |
| POLYPUTTY | DUWEL/DUWEL POLYPUTTY (3) | 3 |

### 6.6 STAINER family — sub-products

| Sub-product | Source SKUs | Count | Notes |
|---|---|---|---|
| UNIVERSAL STAINER | STAINER category — 10 colour shades collapsed | 30 | Restructure: colour as variant inside one sub-product |
| PU STAINER | TINTER/GVA (12 SKUs) | 12 | From Round 1 WOODCARE |
| ACOTONE TINTER | TINTER Acotone codes (WH1, NO1, YE1, YE2, XY1, RE1, XR1, MA1, OR1, GR1, BU1, BU2, RE2, NO2) | 14 | Acotone machine system |
| MACHINE TINTER | TINTER JSW codes (YOX, LFY, GRN, TBL, WHT, MAG, FFR, BLK, OXR) | 10 | Renamed from "Dealer Tinter" |
| HP COLORANT | OTHER/COLORANT (3 HP SKUs — HEY, HER, COG) | 3 | OTHER family retires |

### 6.7 TEXTURE family — sub-products

| Sub-product | SKU count | Notes |
|---|---|---|
| RUSTIC | 2 (WS) + variants per JSW PDF | WS Texture Rustic 90/92/94 + PFR variants |
| DHOLPUR | 1+ | WS Texture Dholpur |
| SUPERFINE | 1+ | WS Texture Superfine |
| ULTRAFINE | 1+ | WS Texture Ultrafine |
| MATT (legacy) | 2 (WEATHERCOAT) | DN WS TEX MATT WHITE BASE/INTERMEDIATE — older texture line |

### 6.8 What changes from current state

| Currently in OrbitOMS | Becomes |
|---|---|
| DUWEL family (42 SKUs across 11 sub-products) as own top-level | RETIRED. Sub-products redistribute by application |
| PRIMER family (36 SKUs) with mixed brand-line sub-products | Reorganised into ~12 application-based sub-products |
| Distempers scattered across DUWEL/MAGIK + DUWEL/ACRYLIC + PROMISE SMARTCHOICE/ACRYLIC + DULUX/INTERIOR DISTEMPER | Unified under new DISTEMPER top-level |
| Putty scattered across PUTTY + AQUATECH + DUWEL | Unified under new PUTTY top-level |
| STAINER family with 10 single-shade sub-products | Restructured: 1 sub-product UNIVERSAL STAINER, colour as variant |
| TINTER family separate top-level (35 SKUs) | Merged into STAINER family. TINTER family retires |
| OTHER family with 3 HP colorant SKUs | RETIRED. SKUs move to STAINER/HP COLORANT |
| AQUATECH/WATERPROOF PUTTY | Moves out to PUTTY family |
| FLOOR PLUS (33 SKUs) | Stays as own top-level |
| TEXTURE (5 SKUs across WS + WEATHERCOAT) | Promoted to top-level. 4 sub-products per JSW PDF |
| SMOOTHOVER (1 SKU in DULUX) | Own top-level |
| AUTO, DUCO, M900, SPRAY PAINT, 5IN1, TOOLS | HIDDEN from /place-order. Parser still recognises |
| DULUX single-row orphans (SILK FINISH, IAE PROJECT, DUWEL ENAMEL) | Skipped from order form |
| PROMISE/PROMISE PRIMER (1 SKU drift) | Phase 2 cleanup: re-categorise to PRIMER/PROMISE PRIMER |

### 6.9 Migration risks (Round 4C specific)

#### Phase 1 risks (mo_order_form_index only)
- **DUWEL family retirement** is the largest single change. Operators familiar with "open DUWEL → find Magik" now go to "open DISTEMPER → find Magik". Walkthrough essential.
- **Application-based PRIMER family** — operators previously knew where each primer lived (some in DUWEL, some in PRIMER, some in PROMISE). Now all under one PRIMER family with use-case sub-products. UX win once learned.
- **STAINER family with 5 sub-products** — operators must know which tinter system they need (Universal vs PU vs Acotone vs Machine vs HP). One-line note at rollout.
- **6 hidden families** (AUTO, DUCO, M900, SPRAY PAINT, 5IN1, TOOLS) — verify with Deepanshu/Bankim that these are NOT actively ordered through /place-order before deployment. If any are active, surface them quickly.

#### Phase 2 risks (mo_sku_lookup + mo_product_keywords + parser)
- **PROMISE PRIMER drift cleanup** — re-categorise IN84500023 from PROMISE → PRIMER family. 1-row UPDATE.
- **HP COLORANT category move** — 3 rows from OTHER → STAINER. 1-row UPDATE.
- **AQUATECH WATERPROOF PUTTY** — move 1 SKU from AQUATECH → PUTTY. SKU table category column update.
- **DUWEL/POLYPUTTY** — move 3 SKUs from DUWEL → PUTTY. Phase 2 SQL.
- **Cross-listing for primers** — Promise primer variants visible in PRIMER family AND PROMISE INTERIOR/EXTERIOR families. Display-only duplication in `mo_order_form_index`. Same mechanism as Promise Enamel/Exterior/Interior cross-listing.
- **STAINER restructure** — 10 single-shade sub-products in STAINER category collapse into one UNIVERSAL STAINER sub-product with colour as variant. Verify enrichment scoring still works (combo key is `product|baseColour|packCode` — base colour was previously the product, now it's the variant).
- **Verify parser doesn't break** when DUWEL category disappears from order form. SKU table still has DUWEL category — only the order form layer abstracts.

### 6.10 Operator pushback notes

- **DUWEL family disappearing** — biggest mental-model change. Operators muscle-memoried "DUWEL = Duwel-branded products". After: products organised by application, brand visible only in SKU description. Walkthrough essential.
- **6 hidden families** — operators who used to access AUTO/DUCO/M900/SPRAY PAINT/5IN1/TOOLS from `/place-order` need to know these are now hidden. If they actually need to order them, alternative path required.
- **Application-based PRIMER family is a UX win** — searching "primer" finds all primers regardless of brand. Operators reported confusion previously about which family held which primer.
- **STAINER family consolidation** — operator who searched "stainer" used to find only Universal/Akzo. After: all 5 stainer types in one place. Win.

### 6.11 Open follow-ups for Round 4C

- **Verify Surat actually doesn't actively order AUTO/DUCO/M900/SPRAY PAINT/5IN1/TOOLS through /place-order** before hiding. If any are active, restore quickly.
- **Phase 2 data cleanups**: PROMISE PRIMER drift (1 row), HP COLORANT category move (3 rows), WATERPROOF PUTTY move (1 row), POLYPUTTY move (3 rows).
- **Verify FARCO WHITE PRIMER is genuinely a wood primer** (sub-product placement under PRIMER/WOOD PRIMER) — alternatively could be own sub-product. Confirm with Chandresh.
- **AQUATECH/FLOOR PLUS (8 SKUs) vs FLOOR PLUS top-level (33 SKUs)** — verify whether these are the same product or genuinely distinct. If same, consolidate.
- **TEXTURE sub-products** — JSW PDF shows 4 variants but CSV has 5 SKUs total. Verify which variants are actually stocked at Surat and adjust.
- **STAINER restructure regression test** — verify enrichment scoring still works after collapsing 10 colour-shade sub-products into one Universal Stainer with colour variant.
- **Round review** — after Place Order page is updated and operators use the new structure, collect feedback. Any product that's pending review or genuinely missing comes back through a separate session.

---

## FINAL SUMMARY — All Sections Locked

### Total top-level categories produced across all rounds

**WOODCARE (Round 1) — 7 top-levels**
1. LUXURIO (12 SKUs)
2. 2K PU (16)
3. PU PRIME (11)
4. NC (6)
5. MELAMINE (4)
6. WOOD STAIN (8)
7. WOOD FILLER (3)

**ENAMELS (Round 2) — 4 top-levels**
8. GLOSS (171)
9. SATIN (70)
10. LUSTRE (6)
11. PROMISE ENAMEL (45) — cross-listed in PROMISE family

**EXTERIORS (Round 3) — 9 top-levels**
12. MAX (73)
13. POWERFLEXX (62)
14. PROTECT (69)
15. RAINPROOF (40)
16. HISHEEN (16)
17. TILE (8)
18. TEXTURE (5) *— this becomes Round 4C top-level too; same family*
19. METALLIC (6)
20. PROMISE EXTERIOR (64) — cross-listed in PROMISE family

**INTERIORS Round 4A — 5 top-levels**
21. SUPERCOVER (32+)
22. SUPERCLEAN (71)
23. VT GLO (94)
24. VT ETERNA (46+)
25. VT SPECIALTY (28+)

**INTERIORS Round 4B — 1 top-level**
26. PROMISE INTERIOR (64) — cross-listed in PROMISE family

**Round 4C — 8 top-levels** (TEXTURE locked here in final form, was previewed in Round 3)
27. AQUATECH (70)
28. FLOOR PLUS (33)
29. TEXTURE (5+) *— same family as Round 3 #18*
30. PRIMER (~50)
31. DISTEMPER (~22)
32. PUTTY (7)
33. STAINER (~69)
34. SMOOTHOVER (1)

**Total unique top-levels = 33** (TEXTURE counted once)

Plus retained brand-aggregator family: PROMISE (cross-listed view of all Promise products across ENAMEL, EXTERIOR, INTERIOR top-levels — ~12 sub-products visible).

### Hidden from /place-order (kept in mo_sku_lookup)
- AUTO (58), DUCO (16), M900 (12), SPRAY PAINT (11), 5IN1 (26), TOOLS (6) = 129 SKUs

### Skipped from order form (low-volume orphans)
- DULUX/SILK FINISH (1), DULUX/IAE PROJECT (2), DUWEL/DUWEL ENAMEL (1) = 4 SKUs

### Retired families
- DUWEL (42 SKUs redistributed)
- TINTER (35 SKUs absorbed into STAINER)
- OTHER (3 SKUs absorbed into STAINER)

### Cross-listing summary (display-only duplications in mo_order_form_index)

| Cross-list family | Source top-levels | Cumulative SKU count visible |
|---|---|---|
| PROMISE family | PROMISE ENAMEL + PROMISE EXTERIOR + PROMISE INTERIOR + PROMISE primer variants in PRIMER family | ~12 sub-products / ~180 SKUs |

### Implementation phasing

**Phase 1 (low risk — Place Order page updates):**
- UPDATE `mo_order_form_index`: add 33 new top-level rows + their sub-product child rows + cross-list duplicates for Promise primer variants
- DELETE old order form rows for retired families (DUWEL, TINTER, OTHER) and hidden families (AUTO, DUCO, M900, SPRAY PAINT, 5IN1, TOOLS)
- No SKU table changes
- No parser changes
- Reversible — keep backup of pre-change order form rows

**Phase 2 (higher risk — SKU table + parser):**
- Cleanup tasks (counted): 8 data drift fixes + 7 cross-family moves
- Keyword table updates per the alias tables in each section
- Regression testing for enrichment after STAINER restructure
- Parser preference rules for T3 rebadges (WS≡WEATHERCOAT, SUPERCLEAN old/new, PROMISE 2IN1 old/Freedom)
- Code grep for hardcoded category strings (WS, DULUX, DUWEL, OTHER, TINTER)

### Open follow-ups across all rounds

- T3 rebadge cleanup (WS≡WEATHERCOAT, SUPERCLEAN, 3IN1, PROMISE 2IN1) — connects to existing pending `isActive` column work
- 7 Phase 2 data cleanups documented across sections
- Operator review after rollout — capture pending products for next iteration
- Verify SUPERCOVER ULTRA, VT ETERNA BASECOAT, VELVETINO codes in SAP master before seeding
- Promise Freedom Interior/Exterior PAINT variants (JSW PDF codes 5909153 series) — verify Surat stock with Chandresh

---

*Master taxonomy redesign · ALL 6 SECTIONS LOCKED · 33 top-levels produced · 2026-05-06 · Smart Flow + Claude*
