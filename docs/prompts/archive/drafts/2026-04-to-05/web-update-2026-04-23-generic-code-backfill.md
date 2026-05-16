# Planning Update — Generic Code backfill into mo_sku_lookup.refMaterial + refDescription
Session date: 2026-04-23
Session type: planning + data audit + schema addition + data UPDATE
Target files: docs/CLAUDE_MAIL_ORDERS.md §2 (schema/column list), §17 (pending items), §18 (SQL batch rules), prisma/schema.prisma
Implementation status: complete — 425 rows populated, 29 rows cleared, all verified

## DECISION SUMMARY
Populated `mo_sku_lookup.refMaterial` with Generic (master) SAP codes for 425 rows using the Gen___base_code_data.xlsx mapping. Added a new column `refDescription String?` to the schema in the same pass to store the paired Generic description (previously there was no column for it — only the code had a home). Also wiped 29 rows whose existing refMaterial values were wrong (sibling Fini codes mistakenly typed into the Generic column — same bad-data pattern as the 63 conflicts). Verified Gen file accuracy before the UPDATE by cross-checking against last 7 days of Auto-Import tint-order SAP codes: 16 of 16 overlapping codes lined up exactly. Two Gen-file data-entry errors dropped before UPDATE (Fini IN55009671, IN55009672 — LUSTRE YELLOW rows where Gen file had pack mismatch + 5IN1 desc against LUSTRE Fini). Zero impact on enrichment matching — refMaterial is not part of combo key.

## CONTEXT CHANGES

### New column `refDescription String?` added to mo_sku_lookup
Stores the Generic/master description from SAP, paired with the existing `refMaterial` (Generic code). Nullable TEXT, no constraint. Schema added via `ALTER TABLE mo_sku_lookup ADD COLUMN "refDescription" TEXT;` in Supabase SQL Editor, then mirrored in `prisma/schema.prisma` and `npx prisma generate` run. `npx tsc --noEmit` passed silently — no TypeScript errors from the addition.

### Production refMaterial state is now clean
- Before: 1,511 rows NULL + 92 rows populated (0 verified correct, 63 confirmed wrong, 29 unverifiable)
- After: 1,178 rows NULL + 425 rows populated (all 425 sourced from Gen file, descriptions paired)
- Coverage: 26.5% of mo_sku_lookup rows now have verified Generic code + description

### Fini vs Generic terminology is locked in
- `material` = Fini code (the actual shipping SKU) — UNIQUE, NOT NULL
- `description` = Fini description
- `refMaterial` = Generic/master code (SAP's tinted umbrella) — nullable
- `refDescription` = Generic description — nullable (new this session)

Column names were NOT renamed despite being confusing. Rename deferred because `material` is depot's working terminology, and because `material` is referenced across enrich.ts, /api/mail-orders/skus, resolve dropdown, Shade Master, Delivery Challan, TI Report, and more — rename blast radius is 15-20 files and isn't worth mixing with a data load. Documented naming convention in consolidation notes instead.

### The 63 "conflict" and 29 "already populated" rows were all the same bad-data pattern
Existing refMaterial values in both groups were OTHER Fini codes from mo_sku_lookup (not Generic codes). Example: GLOSS Brilliant White 1L Fini `IN28301072` had refMaterial `IN28401072` (another Fini code, not a Generic). Someone historically filled refMaterial with "a related Fini pack" thinking that was the right concept. All such values were either overwritten (63) or cleared (29) in this session. Clean slate going forward.

### Gen file mapping was verified against live SAP Auto-Import data
Queried last 7 days of `import_raw_line_items` where `isTinting = true` — 30 distinct SAP codes seen on tint orders. Of those:
- 16 codes found in Gen file → ALL 16 matched our proposed Generic↔Fini mapping exactly (descriptions aligned on product+base+pack)
- 14 codes not in Gen file → genuine Gen file gaps (WS Prima E900 20L, WS TR E2000 20L, WS E1000, WS PU Elastomeric, PS Exterior E700, WS PU TR E2000, VT PG 4090 Base, SAT FIN 0790 Base)
- 3 of the 16 matched codes were CONFLICT rows — SAP was sending the CORRECT Generic, our Gen file agreed, and the mo_sku_lookup.refMaterial had the WRONG code. This validated the overwrite decision with live production evidence.

### Gen file has 6 "Generic → multiple Fini" mappings (informational)
E.g. Generic IN70129072 maps to three Finis IN28129472/IN28129272/IN28129072 (all SATIN STAY BRIGHT 1L but different bases — 94/92/90). This is legitimate: one master tint covers multiple tinted-base variants. Not a duplication bug. Fini→Generic direction is always 1:1 — zero Fini codes had multiple Generic candidates, so our "flag multiples for review" rule had nothing to trigger.

### Two Gen file data-entry errors identified, flagged, not fixed
Dropped from UPDATE but worth noting for depot correction:
- Enamel sheet row 84: Generic IN70450472 description "LUSTRE 0096 BASE 1LT" paired with Fini IN55009671 "LUSTRE YELLOW BA 3.6LT" — pack mismatch (1L vs 4L).
- Enamel sheet row 85: Generic IN70450471 description "DN 5IN1 GENRIC TINT 0090 BASE 4LT" paired with Fini IN55009672 "LUSTRE YELLOW BASE 0.9LT" — wrong Generic description entirely (5IN1 instead of LUSTRE); IN70450471 also appears at row 14 correctly paired with a 5IN1 Fini.
Both rows excluded from this UPDATE. Depot should verify correct LUSTRE YELLOW Generic codes in SAP.

### Schema change workflow validated
ALTER TABLE first (Supabase SQL Editor) → mirror in prisma/schema.prisma → `npx prisma generate` → `npx tsc --noEmit`. For additive nullable columns this is fully safe and doesn't require prisma migrate. Pattern reusable for future additions.

### refMaterial is still informational-only — no enrich.ts change required
Confirmed at enrich.ts buildSkuMaps (L276): combo key is product|baseColour|packCode. Adding/changing refMaterial or refDescription has ZERO impact on matching or scoring. No re-enrich needed post-update. Downstream UI toggle (Tint Manager + Tint Operator "Show generic codes") is a future session and will use these values for display only.

## NEW PENDING ITEMS

### 29 rows still have empty refMaterial where a sibling-Fini was wiped | owner: next reference-data session | blocker: Gen file doesn't cover these products
Products affected (all wiped clean, awaiting correct Generic codes from depot):
- SUPERCLEAN (5 rows — white base 1L/4L/20L, deep 95 base 1L, yellow 96 base 1L)
- WS MAX (5 rows — BW 1L, ROX 0.9L, WB 1L, 98 VYB 1L, 10YR BW 20L)
- GLOSS (4 rows — Brilliant White 1L/4L/20L/500ML)
- SADOLIN INT CLR 2KPU SEALER (3 rows — 1L/4L/20L)
- 12 other singletons across DUWEL, PRIMER, PROMISE, SUPERCOVER, VT, WS PROTECT
Next session should source these from a supplementary depot file or confirm with Chandresh whether Generic codes exist for these specific Fini variants.

### 14 SAP codes seen on recent tint orders have no Gen file entry | owner: depot verification | blocker: need Gen file extension
Products seeing live tint traffic but Gen file has gaps:
- WS Prima E900 (4 codes: 20L Accent/Int/White/ROX bases) — Project sheet only has 1L variants
- WS TR E2000 20L, WS E1000 White/Int 20L — Project sheet has 1L only
- WS UltraClean 92 Base 20L, WS Elastomeric 12 92 Base 20L — Project sheet has 1L only
- WS PU Elastomeric 92, PS Exterior E700 White 20L, WS PU TR E2000 93 20L — not in Gen file at all
- VT PG 4090 Base 20L — SPIE sheet gap
- SAT FIN 0790 Base 20L — Enamel sheet gap
Next session should escalate to Chandresh — either request extended Gen file from depot, or accept 20L variants stay NULL.

### Two Gen file data-entry errors to fix at source | owner: Chandresh → depot | blocker: none
- Enamel sheet row 84: LUSTRE YELLOW 3.6L Fini paired with 1L Generic description (pack mismatch)
- Enamel sheet row 85: LUSTRE YELLOW 0.9L Fini paired with "DN 5IN1" Generic description (wrong product description)
Report to depot for correction in the master file. Once corrected, re-run the backfill to pick up these 2 rows.

### TM/Operator "Show generic codes" toggle UI | owner: next Claude Code session | blocker: none
Now that refMaterial + refDescription are populated for 425 rows, the downstream toggle can be built. Default OFF shows Fini code (current behaviour), toggle ON shows Generic code + description. Rows with NULL refMaterial should fall back to Fini (gracefully — no blank cells). Scope separately.

### CLAUDE_MAIL_ORDERS.md needs column-naming glossary
Add to §2 or a new §2.1: a 4-line table mapping `material` / `description` / `refMaterial` / `refDescription` to "Fini code" / "Fini desc" / "Generic code" / "Generic desc" so future sessions and new Claude sessions aren't confused by the generic-sounding column names.

### Rename `material` → `finiMaterial` + `refMaterial` → `genericMaterial` (if ever pursued) | owner: dedicated future session | blocker: 15-20 file blast radius
Not done this session. If ever pursued, scope for the rename session: (1) add `@map()` directives in prisma first to keep DB names stable while TS names change, (2) sweep all code references, (3) `tsc --noEmit` as gate, (4) separate DB column rename as final step. Do not combine with any data work.

## SUPERSEDED DECISIONS

- `docs/prompts/drafts/next-session-generic-code-backfill.md` Step 0 question 1 ("multiple Generics for same Fini") — no longer relevant: Gen file parsing showed zero Finis with multiple Generic candidates. Rule was locked as "flag for review" but had nothing to flag.
- Original Step 0 question 3 (existing populated refMaterial — leave untouched) was SUPERSEDED mid-session after live SAP Auto-Import verification proved existing values were objectively wrong. User switched to OVERWRITE after seeing evidence that SAP agrees with Gen file, not with existing refMaterial. Final scope: 425 UPDATE_BOTH (includes 63 overwrites) + 29 CLEAR_TO_NULL.
- The prompt's plan to store only refMaterial was SUPERSEDED by adding refDescription column. User requested "add both sku and description" — column added same session.

## MOCKUPS / ARTEFACTS PRODUCED

- `mo_sku_generic_backfill_v2_FINAL.csv` — 1,603-row review CSV with columns: id, material, description, category, product, baseColour, packCode, unit, current_refMaterial, proposed_refMaterial, proposed_refDescription, match_status, action, gen_sheet, notes. Saved locally. Used for spot-check approval before SQL generation.
- `step4_generic_code_backfill.sql` — executed in Supabase SQL Editor. Contains: pre-update baseline SELECT, UPDATE #1 (425 rows populate), UPDATE #2 (29 rows clear), post-update verification SELECT, 10-row random spot-check SELECT. 33 KB, 545 lines. Kept locally for audit.
- Python simulator extracting Gen file mapping and verifying against live SAP Auto-Import codes. In-memory, not saved.

## PROMPTS DRAFTED FOR CLAUDE CODE

- Schema update prompt — short, scoped to one model edit + prisma generate + tsc check. Executed in-session by user. Diff returned clean, zero TS errors. Template-worthy for any future additive nullable column on existing models.

No other code files changed. enrich.ts untouched. No API routes changed. No migrations run (additive column only).

## CONSOLIDATION NOTES

When next consolidating canonical files:

- **docs/CLAUDE_MAIL_ORDERS.md §2 (or new §2.1)** — Add mo_sku_lookup column glossary:
  - `material` = Fini code (actual shipping SKU, UNIQUE, NOT NULL)
  - `description` = Fini description
  - `refMaterial` = Generic/master code (tinted umbrella in SAP, nullable)
  - `refDescription` = Generic description (nullable, added 2026-04-23)
  - Auto-Import lands Generic codes on TM/Operator screens; Mail Orders enrichment lands Fini codes in `mo_sku_lookup.material`.

- **docs/CLAUDE_MAIL_ORDERS.md §2** — Update schema summary: mo_sku_lookup now has 14 columns (was 13). Add `refDescription` after `refMaterial`.

- **docs/CLAUDE_MAIL_ORDERS.md §4** — Add note under enrichment engine: "refMaterial and refDescription are informational fields (for TM/Operator display). Not used in matching or combo-key logic. Backfilling or updating these fields requires no enrich.ts change and no re-enrich."

- **docs/CLAUDE_MAIL_ORDERS.md §17 (Pending items)**:
  - Remove: "Generic code backfill to refMaterial pending" (done).
  - Add: "29 rows in mo_sku_lookup have refMaterial + refDescription cleaned to NULL — need correct Generic codes from depot supplementary data (products: SUPERCLEAN white/deep bases, WS MAX BW/ROX/98VYB, GLOSS BW, SADOLIN 2KPU SEALER, assorted singletons). See web-update-2026-04-23-generic-code-backfill.md."
  - Add: "14 SAP codes seen on live tint orders not in Gen file — gap in depot reference data, need extension for 20L variants of WS Prima E900 / TR E2000 / E1000 / UltraClean / Elastomeric 12, plus VT PG 4090, SAT FIN 0790, PS Exterior E700, WS PU variants."
  - Add: "Two Gen file data-entry errors (LUSTRE YELLOW rows on Enamel sheet, rows 84+85) — report to depot for source correction."
  - Add: "TM/Operator 'Show generic codes' toggle UI pending — data is ready for 425 rows."

- **docs/CLAUDE_MAIL_ORDERS.md §18 (SQL batch rules)** — Add rules:
  - "Additive nullable columns: ALTER TABLE in Supabase SQL Editor first, mirror in prisma/schema.prisma, run `npx prisma generate`, verify with `npx tsc --noEmit`. No prisma migrate required."
  - "refMaterial + refDescription are informational — updating either requires NO re-enrich call."
  - "For UPDATE statements with VALUES-derived CTE over many rows, keep all comments OUTSIDE the VALUES block (per existing rule). Use a WHERE clause scoping to the expected Finis as a safety bound."

- **prisma/schema.prisma** — Already updated this session:
  ```
  model mo_sku_lookup {
    ...
    refMaterial     String?
    refDescription  String?  // ← added
    ...
  }
  ```

- **Production table counts unchanged** (no INSERTs this session):
  - mo_sku_lookup: 1,603 rows (no change)
  - mo_product_keywords: 1,076 (no change)
  - mo_base_keywords: 267 (no change)
  - NEW: mo_sku_lookup.refMaterial has 425 populated rows (was effectively 0 correct), refDescription has 425 populated rows (was 0 — column didn't exist).

*End of planning update.*
