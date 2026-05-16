# Planning Update — Phase 3 reference data load (37 new SKUs) + typo hotfix
Session date: 2026-04-23
Session type: planning + data load + enrichment audit + stress test
Target files: docs/CLAUDE_MAIL_ORDERS.md §2 (table counts), §4 (enrichment engine notes), §17 (pending items), §18 (SQL batch rules)
Implementation status: complete — 65 rows loaded in production, re-enrichment ran successfully

## DECISION SUMMARY
Loaded Phase 3 reference data into production covering 6 brand-new product families not previously in mo_sku_lookup: SADOLIN/EPOXY 1K PRIMER, VT/ETERNA HI-SHEEN, VT/LUXURY FINISHES, VT/VT FIN (Gold+Silver variants), VT/VT METALLICS, VT/VT MARBLE. Scope was demand-driven and narrowed down from 52 candidate rows to 37 after Sales BOM verification + 7-check audit + stress test revealed 15 rows would cause combo clashes or duplicate existing SKUs. Four typo keywords (METALIC, VT METALIC, CONCREATE, VT CONCREATE) were added post-load after production order OBD 109346 (Asian Colour Home) exposed operator-spelling gaps.

## CONTEXT CHANGES

### Production table counts are now
- mo_sku_lookup: 1,603 rows (was 1,566; +37)
- mo_product_keywords: 1,076 rows (was 1,053; +19 from Phase 3 + 4 from typo hotfix)
- mo_base_keywords: 267 rows (was 262; +5)

### New products and their enrichment strategies
- SADOLIN / EPOXY 1K PRIMER — DIRECT (no base). 4 SKUs at 1L/4L/20L/500ML.
- VT / ETERNA HI-SHEEN — NUMBERED. 16 SKUs across 90/92/93 BASE + BRILLIANT WHITE at 1L/4L/10L/20L.
- VT / LUXURY FINISHES — COLOUR. 10 SKUs across MARMORINO/CLAY/LIME WASH bases.
- VT / VT FIN — GOLD/SILVER variants added (existing product, now COLOUR strategy). 4 new SKUs.
- VT / VT METALLICS — COLOUR. 2 SKUs at 200ML only.
- VT / VT MARBLE — DIRECT. Single 5KG SKU.

### New baseColour values in taxonomy
MARMORINO, CLAY, LIME WASH. GOLD and SILVER already existed from Velvetino. 5 total base keyword rows including "LIME" and "LIMEWASH" abbreviations.

### mo_sku_lookup.baseColour is NOT NULL
Schema is `baseColour String` (not `String?`). DIRECT products (primers, thinners, clears, putty, tinters) store baseColour as empty string `''` — NEVER as NULL. CSV export renders both `''` and NULL as blank, which makes them indistinguishable on inspection, but Postgres enforces the constraint. Discovered when first step3 attempt failed with 23502 null-value violation. Any future SKU insert must use `''` for DIRECT products, not NULL.

### SQL inline comments break PostgreSQL VALUES blocks
Pattern `VALUES ('a', 'b'), ('c', 'd')  -- comment,\n('e', 'f')` fails with 42601 syntax error because the comma after the comment continues the tuple list on the next physical line but the parser sees the whole comment as part of the previous tuple. Fix: keep all comments OUTSIDE the VALUES block, or use `/* block comments */` inline. External comments are cleaner.

### Fuzzy-match limitation with bare 2-char keywords
enrich.ts v3.1 fuzzy correction only fires when ZERO product keywords match. When bare "VT" or "WS" keyword matches, the line gets a partial on the generic match and fuzzy never runs. This means typos in product names (e.g. "metalic" vs "METALLIC", "Concreate" vs "CONCRETE") don't auto-correct even though the edit distance is within threshold. Workaround: add typo variants as explicit keywords reactively when spotted in production.

### Combo key for dedup is product|baseColour|packCode (category excluded)
Confirmed at enrich.ts L276 (buildSkuMaps). Category is informational only. This means two rows with same (product, base, pack) under different categories WILL collide in byCombo, with first-seen winning and second dropped to byComboAlt (causing ambiguous ties in scoring). Applies to every future audit: never include category in dedup checks.

### Sales BOM (May 2025 snapshot) cannot validate new material codes
9-series codes (9058xxx, 9079xxx, 9295xxx, etc.) are post-May-2025 additions to SAP. Sales BOM only has 33% coverage of current mo_sku_lookup. For new loads, audit proceeds without Sales BOM validation — rely on Gen file structure + enrich.ts audits instead.

### VT FIN is a SAP umbrella product
Sales BOM shows VT FIN covers multiple variants: non-metallic, Silver, Gold, Persian Silk (Gold/Silver), Irish Linen, Glitter Tintable Silver, NY Metallics-Silver, Pure Silver, Italian Marble (1kg/5kg). The Gen file splits these into presentational sections ("VT Fin Gold & Silver", "VT Marble", "VT Metallics") that are NOT the true SAP structure. For now VT MARBLE and VT METALLICS remain separate products in mo_sku_lookup because coverage is too thin to consolidate (1 marble SKU, 2 metallics SKUs). Revisit when more marble/metallics SKUs appear — potential future work to fold all under VT FIN.

### Stress test pattern — Test 1 + Test 2 — is now the standard
Before any SKU/keyword SQL, run two simulations against a faithful Python port of enrich.ts:
- Test 1: rawText samples for new products (expect matches to new SKUs)
- Test 2: regression samples for adjacent existing products (expect UNCHANGED behaviour)
Proved value in this session — Test 1 caught the "HI SHEEN" bare keyword conflict (removed from v3), Test 2 proved 3 apparent "failures" were pre-existing (not caused by the load).

### Zero code changes required in enrich.ts for Phase 3
buildProductProfiles() auto-classifies products at runtime from SKU data. No DIRECT/FIXED/NUMBERED/COLOUR list to maintain. Combo key logic is generic. Any new product just needs SKU rows + keyword rows — enrichment picks it up on next API call.

## NEW PENDING ITEMS

### Generic code backfill to mo_sku_lookup.refMaterial | owner: next Claude.ai planning session | blocker: none
Current state: 94.1% of mo_sku_lookup rows have refMaterial=NULL. Gen file (7 usable sheets) contains Generic↔Fini code pairs that can populate refMaterial on ~400-600 existing rows. Next session will plan the mapping extraction, matching logic, and UI impact. Downstream goal: Tint Manager + Tint Operator screens get a "Show generic codes" toggle — default OFF (pack code, current behaviour), toggle ON flips displayed material codes to refMaterial value. Separate session prompt drafted.

### Tier B demand-driven load | owner: next Claude.ai planning session | blocker: need fresh unmatched/partial export
Remaining candidate products with <5 SKU rows (~131 products). Original Tier B prompt template from 2026-04-22 still applies. Requires fresh mo_line_status/mo_order_lines export filtered to last 30 days unmatched+partial for demand signal.

### Remaining Phase 3 product families (deferred this session) | owner: Chandresh confirmation | blocker: depot scope verification needed
These were in the original Phase 3 list but skipped this session:
- VT CODEX (0 SKUs, 0 keywords)
- VT DESERT (0/0)
- DUWEL LUSTRE (0/0)
- SS SILK FINISH (0/0 — separate from existing DULUX/SILK FINISH)
- CIC POLYPUTTY (0/0)
- PU INTERIOR GLOSSY (0/0)
- WS METALLIC SILVER/GOLD (keyword only, no SKU — could be covered by new VT METALLICS but needs verification)
- SUPERCOVER ULTRA (2 keywords, no SKUs)
Chandresh confirmation needed per family: does Surat depot actually ship this? Some may be other-depot only (Nepal, Kerala, project-only).

### East CIC combo clashes exposed pre-existing WS ≡ WEATHERCOAT inconsistency
Confirmed during Phase 3 audit: WS MAX 10YR (19 SKUs) and WEATHERCOAT MAX (14 SKUs) are the same product in SAP but split across 2 categories in mo_sku_lookup. Same for WS/MAX 10yr vs WEATHERCOAT/MAX, WS/PROTECT RAINPROOF vs WEATHERCOAT/PROTECT RAINPROOF, etc. Already flagged in docs/CLAUDE_MAIL_ORDERS.md §17 "WS ≡ WEATHERCOAT consolidation audit". This session's data reinforces it's a real issue but deferred as out of scope.

### Proactive fix for fuzzy-match limitation (not urgent)
enrich.ts could be modified so fuzzy correction ALSO fires when only 2-char "generic" keywords (VT, WS, HW) match — not just zero keywords. Requires defining "generic keyword" threshold (probably length ≤3 or a maintained list). Defer until typo hotfixes become frequent. Workaround (adding typo variants reactively) is sustainable short-term.

### Asian Colour Home OBD 109346 line 1 still partial
"VT metalic gold 1L" stays partial because VT METALLICS only has 200ML pack. Either operator wrote wrong pack size OR meant VT FIN Gold 1L (which now exists at material 9061163). Cannot auto-resolve without product-domain decision from depot. Operator can manually resolve. Leave as-is.

## SUPERSEDED DECISIONS

- docs/CLAUDE_MAIL_ORDERS.md §17 lists "VT Velvetino — not in mo_sku_lookup" and "WS Metallic Silver/Gold — not in mo_sku_lookup" as pending. VT METALLICS (with Gold/Silver bases) is now loaded. VT Velvetino still has only 2 rows (thin) — partial supersession, item should be updated not removed.

## MOCKUPS / ARTEFACTS PRODUCED

- `Phase3_reference_additions_v3.xlsx` — audit deliverable with 4 sheets (README, new_mo_sku_lookup, new_mo_base_keywords, new_mo_product_keywords). Saved locally, not in repo. Reference in case re-load needed.
- `step1_base_keywords.sql`, `step2_product_keywords.sql`, `step3_sku_lookup_v4_1_FIXED.sql`, `hotfix_typo_keywords_v2.sql` — the 4 SQL files executed in Supabase SQL Editor. Kept locally for audit trail.
- Python simulator for enrich.ts v3.1 (faithful port for stress tests) — in-memory, not saved as file. Useful template for future pre-load audits.

## PROMPTS DRAFTED FOR CLAUDE CODE

None this session — all work was SQL + browser console. No code files changed in the repo.

Next-session prompt drafted separately for Generic Code Backfill + Tint Screen Toggle planning (to be run in Claude.ai, not Claude Code). See `docs/prompts/drafts/next-session-generic-code-backfill.md`.

## CONSOLIDATION NOTES

When next consolidating canonical files:

- **docs/CLAUDE_MAIL_ORDERS.md §2** — Update table row counts:
  - mo_sku_lookup: 1,566 → 1,603
  - mo_product_keywords: 1,053 → 1,076
  - mo_base_keywords: 262 → 267

- **docs/CLAUDE_MAIL_ORDERS.md §4** — Add note under enrichment engine: "Fuzzy correction only fires when ZERO product keywords match. Bare 2-char keywords (VT, WS) matching prevents fuzzy from firing, so typos in product names don't auto-correct. Add typo variants as explicit keywords when spotted."

- **docs/CLAUDE_MAIL_ORDERS.md §17 (Enrichment / data, Pending items)**:
  - Update: "VT Velvetino — not in mo_sku_lookup" → thin coverage (2 rows), not full Phase 3 load yet
  - Remove: "WS Metallic Silver/Gold" (now covered by VT METALLICS Gold/Silver 200ML)
  - Add: "Tier B demand-driven load pending — see web-update-2026-04-23-phase3-reference-data.md"
  - Add: "Remaining Phase 3 families pending Chandresh depot scope: VT CODEX, VT DESERT, DUWEL LUSTRE, SS SILK FINISH, CIC POLYPUTTY, PU INTERIOR GLOSSY, SUPERCOVER ULTRA"
  - Add: "Generic code backfill to refMaterial pending — see next-session-generic-code-backfill.md"
  - Add: "Asian Colour Home line VT metalic gold 1L stays partial — VT METALLICS has no 1L pack; unclear if operator meant VT FIN. Flag for depot confirmation."

- **docs/CLAUDE_MAIL_ORDERS.md §18 (Keyword management — SQL batch rules)** — Add rules:
  - "mo_sku_lookup.baseColour is NOT NULL — DIRECT products must use `''` (empty string) in INSERTs, never NULL. CSV export renders both as blank; schema enforces constraint."
  - "SQL line-comments (-- ...) inside VALUES blocks break parsing when followed by a comma-separated tuple. Keep comments OUTSIDE VALUES or use /* */ block comments inline."
  - "Combo dedup key is product|baseColour|packCode — category is NEVER part of the key. Enforced at enrich.ts buildSkuMaps (L276)."
  - "Before any SKU/keyword SQL load, run stress test Test 1 (new product routing) + Test 2 (regression on adjacent existing products). Python port of enrich.ts is the reference simulator."

- **docs/CLAUDE_CORE.md §3 (Engineering rules — non-negotiable)** — Consider adding:
  - "mo_sku_lookup.baseColour is NOT NULL. Use `''` for DIRECT products."

*End of planning update.*