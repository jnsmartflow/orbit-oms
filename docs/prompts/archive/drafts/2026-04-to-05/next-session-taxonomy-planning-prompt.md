# Next Session — Taxonomy + Family/Subgroup Analysis & Design

Session type: planning + analysis (NO code execution — pure design)
Estimated duration: one full session
Outcome: locked taxonomy spec for `mo_order_form_index_v2` (and dependent tables) + Claude Code prompts queued for execution in a follow-on session.

## CONTEXT TO LOAD AT START

1. Read all five canonical files: `CLAUDE.md`, `CLAUDE_CORE.md`, `CLAUDE_UI.md`, `CLAUDE_MAIL_ORDERS.md`, `CLAUDE_TINT.md`. Confirm schema version, parser version, UI version.

2. Read the most recent v4 ship draft: `docs/prompts/drafts/web-update-2026-05-12-place-order-v4-shipped.md`. The taxonomy work in this session builds on the section + subgroup foundation that was put in place there.

3. Read the existing taxonomy snapshot files referenced in earlier sessions:
   - `mo_sku_lookup_triples_2026-05-06.csv` — product / baseColour / sku_count rows (~560 entries)
   - `mo_order_form_index-backup-2026-05-06.json` — v2 catalog snapshot
   - `taxonomy-preview.json` — preview of intended taxonomy structure
   - Older planning docs: `stage-a-audit-report-2026-05-07.md`, `stage-b-design-2026-05-08.md`, `stage-c-design-2026-05-09.md`

4. Pull the live state of `mo_order_form_index_v2` and `mo_product_keywords` from Supabase. Specifically need:
   - Every unique (family, subProduct) pair currently in `mo_order_form_index_v2`
   - Their current `section` and `subgroup` assignments
   - Number of SKUs (variants × packs) per row
   - Cross-references to `mo_product_keywords` — which keywords match which (family, subProduct)
   - Any "compound product strings" that still exist in `mo_sku_lookup` waiting for Stage E migration

5. Pull the cross-listing audit data from the v4 search dedup work. Specifically: rerun the search-dedup logic against the live catalog to regenerate the collision hitlist (which sub-product names appear under multiple families). Example collisions noted during v4 testing: `PROMISE` family (in MULTI-USE) vs `PROMISE ENAMEL` family (in ENAMELS) — same physical product registered twice with different family names.

## SESSION GOALS

This is a design-only session. **No code is to be written.** Output is decision documents + drafted Claude Code prompts for the next execution session.

### Goal 1 — Family list audit & consolidation

Walk through every family in `mo_order_form_index_v2`. For each family decide:
- Is this family genuinely distinct, or is it a duplicate / cross-listing of another family?
- What should its canonical name be?
- Which section does it belong in? (current options: UTILITY, INTERIORS, EXTERIORS, ENAMELS, WOODCARE, MULTI-USE — or propose new sections if needed)
- Which subgroup does it belong in within that section?

Output: a "family canonical map" document — old name → new canonical name + section + subgroup.

Specific known-collisions to resolve in this session:
- `PROMISE` vs `PROMISE ENAMEL` — pick one model: family=PROMISE with subProduct=PROMISE ENAMEL OR family=PROMISE ENAMEL standalone. Not both.
- Any other cross-listed families surfaced by the audit hitlist.

### Goal 2 — Subgroup design within sections

Each section needs a clear subgroup taxonomy. Example WOODCARE subgroups already exist: LUXURIO, 2K PU, PU PRIME, NC, MELAMINE, WOOD STAIN, WOOD FILLER. Walk through the other 5 sections and propose their subgroups.

Sections to design subgroups for:
- UTILITY (likely: Primers, Putties, Sealers, Stainers, Solvents, Hardware)
- INTERIORS (likely: Premium emulsion, Standard emulsion, Distemper, Cement paint)
- EXTERIORS (likely: Premium exterior, Standard exterior, Cement paint, Textured)
- ENAMELS (likely: Premium enamel, Standard enamel, Industrial enamel)
- MULTI-USE (residual / cross-category items)

Each subgroup decision should be data-driven: based on the families currently in the section, what natural groupings emerge?

Output: a "section → subgroups → families" hierarchy document.

### Goal 3 — `/place-order` Browse-all-families layout impact

The Browse-all-families panel in v4 renders sections in this order: UTILITY → INTERIORS → EXTERIORS → ENAMELS → WOODCARE → MULTI-USE. Within each section, families are listed alphabetically. After the taxonomy redesign, verify this section order still reads naturally for operators. Consider: should section order be ordered by frequency (most-ordered first)?

Output: locked section order + intra-section family display order rule.

### Goal 4 — Speed dial v2 (post-taxonomy)

Speed dial v1 has 9 hard-coded tiles. After taxonomy cleanup, some tiles may need updating. For example, if `PROMISE ENAMEL` is consolidated under `PROMISE` family, the speed dial tile labelled "PROMISE ENAMEL" → does it stay as `subProduct` tile or upgrade to `family` tile?

Output: locked speed dial v2 spec — 9 tiles with their final type / family / subProduct targets after consolidation.

### Goal 5 — Stage E taxonomy migration alignment

Stage E (the 13-prompt queued migration that splits compound `product` strings into `product` + `subVariant` in `mo_sku_lookup`) was designed before this taxonomy redesign. Confirm: does the Stage E plan still hold? Or does the redesign change what Stage E needs to do?

If Stage E plan needs revision, draft the revised plan and queue new prompts for Claude Code execution.

### Goal 6 — Search keyword pipeline review

`mo_product_keywords` powers the search-on-mail-orders pipeline (different from /place-order's in-memory search). Walk through:
- Are any keywords pointing to families/sub-products that will be consolidated?
- Are there orphan keywords (pointing to nothing in the new taxonomy)?
- Are there missing keywords (new sub-products with no keyword entries)?

Output: a list of `mo_product_keywords` rows to add / update / delete.

### Goal 7 — Catalog data quality follow-ups from v4 build

The v4 build surfaced these data-quality items that need taxonomy-redesign attention:
1. YELLOW OXIDE and YOX recorded as separate productName values for the same colour. Consolidate keyword entries.
2. GLOSS at 1579 lines (3× next item) — suspiciously high; verify enrichment isn't fallback-classifying ambiguous orders as GLOSS.
3. STAINER fragmented across colour subProducts (YELLOW OXIDE 64, YOX 21, OXR 16). Should be consolidated under one STAINER family with colour as baseColour, not as separate subProducts.
4. mo_customer_keywords.customerCode is non-null String (not String?) — earlier dead `not: null` filters were no-ops; verify no other code paths rely on the wrong assumption.
5. ETERNA family was parked as "decide later" in earlier sessions. Resolve.

## DELIVERABLES FROM THIS SESSION

Save all under `docs/prompts/drafts/`:

1. `web-update-{date}-taxonomy-redesign-decisions.md` — locked decisions document covering Goals 1-7.
2. `web-update-{date}-family-canonical-map.md` — old family name → new canonical map (full table).
3. `web-update-{date}-section-subgroup-hierarchy.md` — section → subgroups → families tree.
4. `code-update-{date}-stage-e-revised-prompts.md` — revised Claude Code prompts for taxonomy migration (if Stage E plan changed).
5. `code-update-{date}-catalog-cleanup-prompts.md` — Claude Code prompts for keyword updates, family consolidation SQL, mo_product_keywords cleanup.

Each Claude Code prompt should follow the standard format: constraints block, file reading confirmation, "do not write code yet" gate before any fix, TypeScript compile check requirement, explicit git commit message.

## SESSION WORKFLOW

1. Start by reading all canonical files + previous taxonomy session docs (~15 minutes).
2. Pull live catalog state from Supabase (~10 minutes).
3. Walk Goals 1-7 sequentially with explicit approval gates between each. Smart Flow approves each section before moving to next.
4. HTML mockups if needed for browse-all-families display ordering visualisation.
5. End-of-session output: 5 draft files saved to `docs/prompts/drafts/`, ready to execute in follow-on Claude Code session.

## OUT OF SCOPE

- Actual code execution (separate session after this one).
- UI changes to /place-order beyond what taxonomy changes naturally require.
- Speed dial mode switching UI (operator picking by-data vs by-curation). Defer.
- Mail order parser changes (v6.5 stays as-is).
- Tint module changes.

## KEY CONSTRAINTS REMINDED

- All schema changes via Supabase SQL Editor + `npx prisma generate`. Never `prisma db push`.
- DB columns are camelCase. `@map` directives must match.
- No `prisma.$transaction` — sequential awaits only.
- API routes need `export const dynamic = 'force-dynamic'`.
- All new keywords must respect length ordering — long-and-specific before short-and-generic, otherwise the keyword pipeline misclassifies.
- Colour names cannot be used as product keywords (shared across multiple product families).

## OPENING MESSAGE TO PASTE INTO NEW SESSION

```
New planning session — taxonomy + family/subgroup redesign.

Session type: planning + analysis (no code execution).

Goals:
1. Family list audit & consolidation (resolve PROMISE vs PROMISE ENAMEL etc.)
2. Subgroup design within each of the 6 sections
3. Browse-all-families display order verification
4. Speed dial v2 spec post-taxonomy
5. Stage E migration alignment
6. mo_product_keywords pipeline review
7. Data quality follow-ups from v4 build

Before we start:
- Read all 5 canonical files (CLAUDE.md, CLAUDE_CORE.md, CLAUDE_UI.md, CLAUDE_MAIL_ORDERS.md, CLAUDE_TINT.md)
- Read docs/prompts/drafts/web-update-2026-05-12-place-order-v4-shipped.md for taxonomy foundation context
- Read previous taxonomy session docs: stage-a-audit-report-2026-05-07.md, stage-b-design-2026-05-08.md, stage-c-design-2026-05-09.md

Then I'll pull live catalog state from Supabase and we walk Goals 1-7 with section-by-section approval gates. Output is 5 draft files saved to docs/prompts/drafts/ for execution in a follow-on Claude Code session.

Start by confirming files read + versions, then propose how to pull the live catalog snapshot.
```
