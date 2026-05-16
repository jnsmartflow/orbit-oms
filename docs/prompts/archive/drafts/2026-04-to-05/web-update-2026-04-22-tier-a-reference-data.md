# Planning Update — Tier A reference data inserted into mo_sku_lookup and keyword tables
Session date: 2026-04-22
Session type: planning + data load + enrichment audit
Target files: docs/CLAUDE_MAIL_ORDERS.md §17 (pending items), §2 (table counts), §4 (enrichment engine notes)
Implementation status: complete — 128 rows inserted, re-enrichment ran successfully

## DECISION SUMMARY
Loaded Tier A reference data (products with ≥10 existing rows) into mo_sku_lookup, mo_base_keywords, and mo_product_keywords from three reference files: Gen___base_code_data.xlsx, Sales_BOM_-_MAY_-_25.xlsx, and Sales_BOM_-_23_01_2025.XLSX. Scope was deliberately narrow — only added rows for product families already well-represented in the lookup (e.g. WS MAX, VT PEARL GLO, GLOSS), to minimise enrichment-engine risk. WEATHERCOAT category, VT CLEAR COAT, and 16 other small/new product families were deferred to Tier B. Ran a full audit of proposed inserts against enrich.ts v3.1 before execution — this caught 9 combo clashes that would have created alt-SKU ties and 2 misclassified VT Clear Coat rows.

## CONTEXT CHANGES

### mo_sku_lookup row count is now 1,566 (up from 1,459)
- Added 107 new rows across 17 products
- Every row has unique (product, baseColour, packCode_rounded) combo — zero overlap with existing byCombo map
- Product distribution: GLOSS 21, SUPERCLEAN/3IN1 13, VT/PEARL GLO 12, SATIN STAY BRIGHT 9, VT/PLATINUM GLO 9, WS/MAX 9, DULUX/5IN1 7, VT/ETERNA 5, WS/PROTECT 5, FLOOR PLUS 4, WS/POWERFLEXX 3, WS/PROTECT RAINPROOF 3, DUWEL MAGIK 2, PROMISE INTERIOR 2, SUPERCLEAN 2, VT/DIAMOND GLO 1

### Seven new baseColour values exist in the taxonomy
- GREEN BASE, PASTEL BASE, PRO BASE — numbered-style bases (used by MAX, 3IN1, SUPERCLEAN)
- RARE PEARL COPPER, RARE PEARL GREEN — shade family for VT PEARL GLO
- TRUCK BROWN, WILD PURPLE — named shade bases for GLOSS
- Plus reused existing: WALNUT, CLASSIC WHITE (already in taxonomy, now have SKU coverage for more products)

### mo_base_keywords has 13 new keyword rows
- 'GREEN BASE', 'PASTEL BASE', 'PRO BASE' (self-named keywords)
- 'RARE PEARL COPPER' / 'PEARL COPPER' / 'COPPER PEARL' (3 aliases)
- 'RARE PEARL GREEN' / 'PEARL GREEN' / 'GREEN PEARL' (3 aliases)
- 'TRUCK BROWN' / 'TBROWN' (2 — abbreviation support)
- 'WILD PURPLE'
- 'CLS WHITE' (abbreviation alias for existing CLASSIC WHITE baseColour)

### mo_product_keywords has 8 new keyword rows (all synonyms for existing products)
- 'VT PLATINUM GLO NEW' → VT/PLATINUM GLO
- 'DULUX GLOSS' → GLOSS/GLOSS
- 'SCN 3IN1', '3IN1 MARK RESISTANT' → SUPERCLEAN/3IN1
- 'SUPERCLEAN NEW' → SUPERCLEAN/SUPERCLEAN
- 'SAT FIN' → SATIN/SATIN STAY BRIGHT
- 'DULUX WS FLOORPLUS', 'FLOORPLUS' → FLOOR PLUS/FLOOR PLUS
- No new products introduced — all keywords point to existing products

### Enrichment engine combo key is product|baseColour|packCode — NOT category|product|base|pack
This is a critical finding that must be enforced in every future keyword/SKU audit. The buildSkuMaps() function at enrich.ts L276 keys by product only. If two rows share (product, baseColour, packCode) but differ on category, they collide in byCombo. First-seen wins, second becomes byComboAlt → ties in scoring → `partial` status.

Our v4 candidate set had 9 such clashes (e.g. existing DULUX/3IN1 vs new SUPERCLEAN/3IN1 both with 95 BASE/1L). These were dropped in v5. Future audits must use the product-only combo key when dedup-checking against existing data.

### Pack rounding convention confirmed and locked
- 0.9 / 0.925 / 0.975 L → 1 LT
- 3.6 / 3.7 L → 4 LT
- 9 / 9.25 L → 10 LT
- 18 / 18.5 / 22 L → 20 LT
- 500 ML stays as 500 ML with unit=ML (enrich appends "ML" suffix via resolvedPackCode())
- Descriptions preserve verbatim text from SAP (e.g. "18.5L") even when packCode is rounded to 20
- Applies to all new reference-data loads going forward

### Base colour normalisation map used in ETL
- WHITE BASE / WHT / BW / Br White → BRILLIANT WHITE
- INT / INTERMEDIATE → 92 BASE
- MEDIUM / MID → 93 BASE
- ACCENT → 94 BASE
- DEEP → 95 BASE
- YELLOW (as base code) → 96 BASE
- RED (as base code) → 97 BASE
- YOX → YELLOW OXIDE
- ROX → RED OXIDE

### SQL run order is 3 steps, never combined
- Step 1: base keywords (no FK dependency)
- Step 2: product keywords (no FK dependency)
- Step 3: SKU lookup (uses baseColour values that must exist conceptually)
- Combining INSERTs in one transaction causes silent rollback on any duplicate — loses all inserts. Keep separate batches.

### Keyword table idempotency uses WHERE NOT EXISTS, not ON CONFLICT
- mo_base_keywords and mo_product_keywords have no UNIQUE constraint on keyword+baseColour or keyword+product
- Native ON CONFLICT has no target to match
- Use `INSERT INTO ... SELECT ... FROM (VALUES ...) WHERE NOT EXISTS (SELECT 1 FROM ... WHERE UPPER(TRIM(...)) = UPPER(TRIM(...)))`
- mo_sku_lookup.material has UNIQUE → native ON CONFLICT (material) DO NOTHING works

### Post-insert workflow
1. Run SQL in 3 steps in Supabase SQL Editor
2. `npx prisma generate` (even if no schema change — muscle memory)
3. Trigger `/api/mail-orders/re-enrich` from logged-in browser console (POST, session auth)
4. Response shape: `{ total, updated, unchanged, ordersRecalculated }` — only upgrades match status

### This load upgraded 20 of 406 recent lines (~5%)
- 12 orders recalculated (matchedLines counter refreshed)
- Promise Enamel Classic White lines (50+ in last 7 days) all now correctly match the CLASSIC WHITE baseColour variant (IN5948784-IN5948788) — previously fell back to BRILLIANT WHITE, silent wrong match. CLASSIC WHITE keyword existed in mo_base_keywords but operators needed it connected to PROMISE ENML product — the existing SKU rows were always there, just not reaching the scoring winner.

## NEW PENDING ITEMS

### Tier B reference data load — 16 products with <10 existing rows | owner: next Claude.ai planning session | blocker: need demand signal
Candidate product families to audit against ref files:
- VT: AMBIANCE, CLEAR COAT, METALLICS, FREEDOM
- WS: ULTRACLEAN, ELASTOMERIC, FLASH, TILE, PRIMA E900, PROJECT
- SUPERCOVER: SHEEN, ULTRA
- PROMISE: PRIMER, 2IN1 (if exists)
- DUWEL: LUSTRE

Recommended approach — demand-driven not bulk. Query `mo_line_status.reason='not_found'` over last 30 days, group by extracted product term, rank by frequency. Only add SKUs/keywords for products operators actually write. Skips dead taxonomy.

### Phase 3 — new product families not currently in mo_sku_lookup at all | owner: next Claude.ai + Chandresh confirmation | blocker: product taxonomy decision
These need NEW product entries in mo_product_keywords + NEW rows in mo_sku_lookup:
- VT Codex, Metallics, Freedom, Elastomeric, Ambiance
- SS Silk Finish
- Promise 2in1
- VT Velvetino, Desert, Fin Gold/Silver, Luxury Finishes, Marble
- CIC Polyputty
- Rare Pearls (we added Copper + Green for PEARL GLO — rest of Rare Pearls family pending)

Must confirm with Chandresh which of these actually ship from Surat depot before adding — some may be other-depot only.

### WS ≡ WEATHERCOAT consolidation audit | owner: next Claude.ai planning | blocker: none
Pre-existing data issue (not from Tier A): 5 products duplicated across both categories — MAX, POWERFLEXX, PROTECT, PROTECT RAINPROOF, TEXTURE. Need to decide: merge into one category, keep both (and which one wins at enrichment scoring), or split by commercial intent (WS = retail, WEATHERCOAT = premium/long-warranty line). Second option is what current data suggests — WEATHERCOAT holds PF 15YR, RP 8YR, 10YR MAX, PROTECT DUSTPROOF variants.

### 902 orphan SKUs audit | owner: next Claude.ai planning | blocker: none
Rows in mo_sku_lookup that don't appear in Gen_base_code_data.xlsx or Sales_BOM_MAY_25. Likely categories: stainers, tinters, manual seeds, deprecated SKUs. Needs classification — anything deprecated should be soft-deleted (add isActive flag) or moved to an archive table.

### paintType column backfill | owner: Claude Code session | blocker: feature not yet live
All 107 new Tier A rows have paintType=NULL. Most existing rows also NULL. When warehouse zone-sort feature goes live, this blocks picker walk-optimisation. Task: bulk UPDATE paintType via product→paintType map (water/oil/stainer) for all ~1,566 rows.

### Task 2 — dual-code genericMaterial mapping | owner: Claude Code session | blocker: requires schema change via Supabase SQL Editor
Never started. Scope:
1. ALTER TABLE mo_sku_lookup ADD COLUMN genericMaterial TEXT
2. Parse Gen_base_code_data.xlsx for Generic↔Base pairings
3. UPDATE ~600 existing rows that have a matching Generic code in the file
4. Update enrich.ts to also match genericMaterial when direct material code lookup fails

Gen file has 9 sheets: PEE(WS), PIE(Super), SPIE(VT), Mass, DST, Enamel, Project, JSW code, Export. Drop JSW code + Export (Nepal/branded, out of scope).

### Stainer pack extraction from rawText | owner: parser session | blocker: needs real test emails
Parser v6.5 currently handles `50-100-200ML` digit-dash with stainer-code guard (23 hardcoded codes). Partial coverage. Full fix needs: extract pack from "50ML/100ML/200ML" context in stainer lines where no pack*qty separator exists.

### Historical carton backfill | owner: Claude Code session | blocker: none
Orders created before isCarton+cartonCount columns have wrong quantities (raw carton count stored, not multiplied by piecesPerCarton). Task: UPDATE mo_order_lines SET quantity = quantity * piecesPerCarton WHERE isCarton=true AND cartonCount IS NULL. Requires join to mo_sku_lookup on skuCode.

## SUPERSEDED DECISIONS

- None. This session added new scope; did not override prior decisions.
- Note: docs/CLAUDE_MAIL_ORDERS.md §17 lists "M900 SKU entries needed" and similar deferred SKU work. These are still pending — Tier A scope was explicitly limited to products with ≥10 existing rows, which excluded M900 (new product family, goes in Phase 3).

## MOCKUPS / ARTEFACTS PRODUCED

- `Tier_A_reference_additions_v5.xlsx` — final deliverable with 3 sheets (SKU/base-kw/prod-kw) + README. Stored locally, not in repo. Kept as reference in case re-load needed.
- `step1_base_keywords.sql`, `step2_product_keywords.sql`, `step3_sku_lookup.sql` — the 3 SQL files run in Supabase. Stored locally, not in repo.
- No HTML mockups, no UI work this session.

## PROMPTS DRAFTED FOR CLAUDE CODE

- None. This session was data-only — SQL was generated for manual run in Supabase SQL Editor, not executed via Claude Code. The re-enrich endpoint was called from browser devtools.

## CONSOLIDATION NOTES

When next consolidating canonical files:

- **docs/CLAUDE_MAIL_ORDERS.md §2** — Update table row counts:
  - mo_sku_lookup: ~1,400+ → 1,566
  - mo_base_keywords: ~215 → 228 (+13)
  - mo_product_keywords: ~809 → 817 (+8)

- **docs/CLAUDE_MAIL_ORDERS.md §4** — Add note to enrichment engine section: "Combo key is `product|baseColour|packCode` — category is NOT part of the key. This is important for reference-data audits: two rows with same (product, base, pack) under different categories WILL collide in byCombo."

- **docs/CLAUDE_MAIL_ORDERS.md §17 (Enrichment / data)** — Remove:
  - "M900 SKU entries needed" (still pending — but note updated scope)
  - "BW → 90 BASE fallback for products with 90 BASE but no BW SKU (2KPU MATT/GLOSS)" (unchanged, still pending)
  - Move "Historical carton backfill" and "Stainer pack extraction" above Phase 3 bullets for priority visibility

- **docs/CLAUDE_MAIL_ORDERS.md §17 (Infrastructure)** — Add:
  - Tier A reference load completed 2026-04-22 — see web-update-2026-04-22-tier-a-reference-data.md
  - Tier B pending — demand-driven approach preferred over bulk
  - Phase 3 (new product families) pending Chandresh confirmation on Surat depot scope

- **docs/CLAUDE_MAIL_ORDERS.md §18 (Keyword management — SQL batch rules)** — Add rule:
  - "Keyword table idempotency: use WHERE NOT EXISTS (subquery on UPPER(TRIM(...))) not ON CONFLICT — neither keyword table has a UNIQUE constraint on keyword columns."

*End of planning update.*
