We're iterating the /place-order section grouping based on operator-aligned ordering. Phase 6 of the previous prompt shipped sections cleanly; now we apply your CSV-reviewed changes. Three classes of change:

1. Section ordering (UTILITY moves to top)
2. Family reassignments (FLOOR PLUS, SMOOTHOVER → EXTERIORS)
3. New subgroup column for subtle visual clustering within sections + custom within-section ordering (overrides skuCount-DESC default)

──── DECISIONS LOCKED — DO NOT REOPEN ─────────────────────────────

1. Section order top-to-bottom (CHANGED): UTILITY, INTERIORS, EXTERIORS, ENAMELS, WOODCARE, MULTI-USE.
2. Family-to-section reassignments: FLOOR PLUS (UTILITY → EXTERIORS), SMOOTHOVER (UTILITY → EXTERIORS).
3. New subgroup field: TEXT NOT NULL column on mo_order_form_index_v2. Stored in DB (data-driven, scales to future surfaces — MIS reports, /order mobile migration, search/filter, analytics).
4. Custom within-section ordering: hardcoded WITHIN_SECTION_ORDER constant in category-grid.tsx. Overrides the previous skuCount-DESC sort. Constant lives in code (not DB) because it's purely render-time presentation, not data classification.
5. Subgroup visual treatment: Option C with sub-option (a) — subgroups separated by row-break on subgroup change. New subgroup always starts a fresh row. No subgroup text label rendered. Cards within a subgroup flow continuously with default gap-3.
6. Within-subgroup ordering: respect WITHIN_SECTION_ORDER index. If a subgroup spans non-adjacent positions in WITHIN_SECTION_ORDER (shouldn't happen with correct data, but be defensive), still respect the explicit order — don't auto-sort.
7. Live mo_order_form_index, /api/order/data, /order mobile, mo_sku_lookup, mo_sku_lookup_v2, parser, enrichment, lib/mail-orders/*: UNTOUCHED.

──── FAMILY-LEVEL DATA (LOCKED) ────────────────────────────────────

Section + subgroup + within-section order for all 34 families. Use this as the source of truth for both the seed FAMILY_TO_SECTION/FAMILY_TO_SUBGROUP constants AND the SQL backfill CASE block AND the WITHIN_SECTION_ORDER constant in category-grid.tsx.

UTILITY (5 families):
  1. STAINER       | Tinting
  2. PRIMER        | Prep – primers
  3. DISTEMPER     | Mass distemper
  4. AQUATECH      | Waterproofing & decorative
  5. PUTTY         | Prep – putty

INTERIORS (6 families):
  1. PROMISE INTERIOR  | Promise (use-case interior)
  2. VT GLO            | VT (Dulux Velvet Touch)
  3. VT ETERNA         | VT (Dulux Velvet Touch)
  4. VT SPECIALTY      | VT (Dulux Velvet Touch)
  5. SUPERCLEAN        | Mass-market emulsion
  6. SUPERCOVER        | Mass-market emulsion

EXTERIORS (11 families):
  1. PROMISE EXTERIOR  | Mid Tier Exterior Emulsion
  2. MAX               | Mass exterior emulsion
  3. PROTECT           | Mass exterior emulsion
  4. POWERFLEXX        | Mass exterior emulsion
  5. RAINPROOF         | Mass exterior emulsion
  6. HISHEEN           | Specialty exterior
  7. FLOOR PLUS        | Floor coatings
  8. TILE              | Specialty exterior
  9. SMOOTHOVER        | Prep – putty
  10. METALLIC         | Specialty exterior
  11. TEXTURE          | Specialty exterior

ENAMELS (4 families):
  1. GLOSS             | Enamel finish (gloss)
  2. SATIN             | Enamel finish (satin)
  3. PROMISE ENAMEL    | Promise (use-case enamel)
  4. LUSTRE            | Enamel finish (lustre)

WOODCARE (7 families):
  1. LUXURIO           | Sadolin Premium PU
  2. 2K PU             | Sadolin Premium PU
  3. PU PRIME          | Sadolin Premium PU
  4. NC                | Sadolin Standard Woodcare
  5. MELAMINE          | Sadolin Standard Woodcare
  6. WOOD FILLER       | Wood finishing
  7. WOOD STAIN        | Wood finishing

MULTI-USE (1 family):
  1. PROMISE           | Promise umbrella

Note on subgroup names: use the strings exactly as written above (en-dash "–" in "Prep – primers" / "Prep – putty"). If your tooling has issues with Unicode en-dash, fall back to ASCII hyphen "-" but flag the substitution before proceeding.

──── READ FIRST — DO NOT WRITE CODE YET ────────────────────────────

Read fully and silently:

1. CLAUDE.md (router)
2. docs/CLAUDE_CORE.md (especially §3 engineering rules)
3. docs/CLAUDE_UI.md (neutral aesthetic, ONE teal element rule)
4. prisma/schema.prisma — find model mo_order_form_index_v2 (around line 1199, currently has section String field)
5. scripts/v2-add-section-column.sql — for SQL pattern reference
6. scripts/v2-catalog-seed-from-preview.ts — current state with FAMILY_TO_SECTION
7. app/api/place-order/data/route.ts — current state with section in select + return
8. app/(place-order)/place-order/types.ts — Product type with section: string
9. app/(place-order)/place-order/components/category-grid.tsx — current state with SECTION_ORDER, sectioned render, row-aware expanded panel insertion

After reading, confirm in one short message:

- "Files read"
- Current SECTION_ORDER value (paste it)
- Current Product type definition
- One-line confirmation that none of the subgroup-related code paths exist yet (we're adding net-new)
- A one-line statement of deliverables for this prompt

Then STOP. Wait for "go".

──── PHASE 1 — Supabase SQL ────────────────────────────────────────

Generate scripts/v2-update-section-and-add-subgroup.sql.

Two operations in this script:

1A. UPDATE existing rows where family is FLOOR PLUS or SMOOTHOVER:
    UPDATE mo_order_form_index_v2 
    SET "section" = 'EXTERIORS' 
    WHERE "family" IN ('FLOOR PLUS', 'SMOOTHOVER');

1B. ADD COLUMN subgroup, then backfill via CASE on family, then SET NOT NULL:

    ALTER TABLE mo_order_form_index_v2 ADD COLUMN IF NOT EXISTS "subgroup" TEXT;
    
    UPDATE mo_order_form_index_v2 SET "subgroup" = CASE
      WHEN "family" = 'STAINER'           THEN 'Tinting'
      WHEN "family" = 'PRIMER'            THEN 'Prep – primers'
      WHEN "family" = 'DISTEMPER'         THEN 'Mass distemper'
      WHEN "family" = 'AQUATECH'          THEN 'Waterproofing & decorative'
      WHEN "family" = 'PUTTY'             THEN 'Prep – putty'
      WHEN "family" = 'PROMISE INTERIOR'  THEN 'Promise (use-case interior)'
      WHEN "family" = 'VT GLO'            THEN 'VT (Dulux Velvet Touch)'
      WHEN "family" = 'VT ETERNA'         THEN 'VT (Dulux Velvet Touch)'
      WHEN "family" = 'VT SPECIALTY'      THEN 'VT (Dulux Velvet Touch)'
      WHEN "family" = 'SUPERCLEAN'        THEN 'Mass-market emulsion'
      WHEN "family" = 'SUPERCOVER'        THEN 'Mass-market emulsion'
      WHEN "family" = 'PROMISE EXTERIOR'  THEN 'Mid Tier Exterior Emulsion'
      WHEN "family" = 'MAX'               THEN 'Mass exterior emulsion'
      WHEN "family" = 'PROTECT'           THEN 'Mass exterior emulsion'
      WHEN "family" = 'POWERFLEXX'        THEN 'Mass exterior emulsion'
      WHEN "family" = 'RAINPROOF'         THEN 'Mass exterior emulsion'
      WHEN "family" = 'HISHEEN'           THEN 'Specialty exterior'
      WHEN "family" = 'FLOOR PLUS'        THEN 'Floor coatings'
      WHEN "family" = 'TILE'              THEN 'Specialty exterior'
      WHEN "family" = 'SMOOTHOVER'        THEN 'Prep – putty'
      WHEN "family" = 'METALLIC'          THEN 'Specialty exterior'
      WHEN "family" = 'TEXTURE'           THEN 'Specialty exterior'
      WHEN "family" = 'GLOSS'             THEN 'Enamel finish (gloss)'
      WHEN "family" = 'SATIN'             THEN 'Enamel finish (satin)'
      WHEN "family" = 'PROMISE ENAMEL'    THEN 'Promise (use-case enamel)'
      WHEN "family" = 'LUSTRE'            THEN 'Enamel finish (lustre)'
      WHEN "family" = 'LUXURIO'           THEN 'Sadolin Premium PU'
      WHEN "family" = '2K PU'             THEN 'Sadolin Premium PU'
      WHEN "family" = 'PU PRIME'          THEN 'Sadolin Premium PU'
      WHEN "family" = 'NC'                THEN 'Sadolin Standard Woodcare'
      WHEN "family" = 'MELAMINE'          THEN 'Sadolin Standard Woodcare'
      WHEN "family" = 'WOOD FILLER'       THEN 'Wood finishing'
      WHEN "family" = 'WOOD STAIN'        THEN 'Wood finishing'
      WHEN "family" = 'PROMISE'           THEN 'Promise umbrella'
      ELSE NULL
    END;
    
    ALTER TABLE mo_order_form_index_v2 ALTER COLUMN "subgroup" SET NOT NULL;

Verification queries at the bottom:
    SELECT "section", COUNT(*) FROM mo_order_form_index_v2 GROUP BY "section" ORDER BY "section";
    SELECT "subgroup", COUNT(*) FROM mo_order_form_index_v2 GROUP BY "subgroup" ORDER BY "subgroup";
    SELECT COUNT(*) FROM mo_order_form_index_v2 WHERE "subgroup" IS NULL;

The third query MUST return 0 — any NULL means a family slipped through unmapped.

Idempotency: ADD COLUMN IF NOT EXISTS, UPDATE re-applies cleanly, ALTER ... SET NOT NULL no-ops when constraint already exists. Commented-out rollback block at top with DROP COLUMN "subgroup" + revert section assignments.

After producing the SQL, STOP. Show me the file. I will run it in Supabase and paste back all 3 verification query results. Wait for confirmation before Phase 2.

──── PHASE 2 — Prisma model ────────────────────────────────────────

Add subgroup String field to mo_order_form_index_v2 model in prisma/schema.prisma — immediately after section. No @default, no @map.

Then run npx prisma generate. Show clean output.

STOP. Show diff and prisma generate output. Wait for "go".

──── PHASE 3 — Seed script update ──────────────────────────────────

Edit scripts/v2-catalog-seed-from-preview.ts:

1. Update FAMILY_TO_SECTION constant — move FLOOR PLUS and SMOOTHOVER from UTILITY to EXTERIORS.
2. Add new FAMILY_TO_SUBGROUP: Record<string, string> constant immediately below FAMILY_TO_SECTION. Same family entries (34 total), values from the locked subgroup table above.
3. Extend the family-coverage assertion (currently checks FAMILY_TO_SECTION) to ALSO check FAMILY_TO_SUBGROUP coverage. Single combined check that throws if any family is missing from EITHER map.
4. Add subgroup: FAMILY_TO_SUBGROUP[r.family]! to the row data mapping, immediately after section.

Show diff. STOP. Wait for "go" before re-running seed.

──── PHASE 4 — Re-run seed ─────────────────────────────────────────

I will run npx tsx scripts/v2-catalog-seed-from-preview.ts manually. Expected: 455 rows, both section and subgroup populated, family-section and family-subgroup coverage assertions both pass.

──── PHASE 5 — API endpoint ────────────────────────────────────────

Edit app/api/place-order/data/route.ts to add subgroup to:
- Prisma SELECT for indexRows
- Per-product return object (immediately after section)

Show diff (~2 lines). STOP. Wait for "go".

──── PHASE 6 — Product type + render logic ─────────────────────────

6A. Update app/(place-order)/place-order/types.ts:
  - Add subgroup: string to Product type, immediately after section.

6B. Update app/(place-order)/place-order/components/category-grid.tsx:

  i. Reorder SECTION_ORDER constant to: ["UTILITY", "INTERIORS", "EXTERIORS", "ENAMELS", "WOODCARE", "MULTI-USE"] as const

  ii. Add new WITHIN_SECTION_ORDER constant — Record<string, number> mapping family → integer index within section. Use the locked within-section numbers (1-N per section). Example structure:
    const WITHIN_SECTION_ORDER: Record<string, number> = {
      // UTILITY
      "STAINER": 1, "PRIMER": 2, "DISTEMPER": 3, "AQUATECH": 4, "PUTTY": 5,
      // INTERIORS
      "PROMISE INTERIOR": 1, "VT GLO": 2, "VT ETERNA": 3, "VT SPECIALTY": 4, "SUPERCLEAN": 5, "SUPERCOVER": 6,
      // EXTERIORS
      "PROMISE EXTERIOR": 1, "MAX": 2, "PROTECT": 3, "POWERFLEXX": 4, "RAINPROOF": 5, "HISHEEN": 6, "FLOOR PLUS": 7, "TILE": 8, "SMOOTHOVER": 9, "METALLIC": 10, "TEXTURE": 11,
      // ENAMELS
      "GLOSS": 1, "SATIN": 2, "PROMISE ENAMEL": 3, "LUSTRE": 4,
      // WOODCARE
      "LUXURIO": 1, "2K PU": 2, "PU PRIME": 3, "NC": 4, "MELAMINE": 5, "WOOD FILLER": 6, "WOOD STAIN": 7,
      // MULTI-USE
      "PROMISE": 1,
    };

  iii. Add subgroup: string to CategoryEntry type. Derive from products[0].subgroup in categories useMemo (every Product in a family shares the same subgroup).

  iv. Update categoriesBySection useMemo so within each section's bucket, categories are sorted by WITHIN_SECTION_ORDER[family] ASC (NOT skuCount DESC anymore). Defensive: if a family is missing from WITHIN_SECTION_ORDER, sort it to the end.

  v. Subgroup-aware row-break rendering — the core visual change for Option C sub-option (a). Within each section's grid:
     - Iterate sectionCats in their already-sorted order
     - When the current card's subgroup differs from the previous card's subgroup, FORCE A NEW ROW before the current card
     - Implementation suggestion: use CSS grid's grid-column-start: 1 to break to a new row, OR insert an empty <div /> with col-span-full at the row break, OR split sectionCats into subgroup buckets and render each bucket as its own grid wrapper inside the section
     - Pick whichever approach makes the row-aware expanded-panel insertion logic still work cleanly. Document your choice with a comment.
     - The expanded panel insertion math (active card row, COLS_DEFAULT = 4) must still work within the subgroup boundaries — clicking a card in subgroup X inserts the panel after that card's row within subgroup X's grid, not bleeding into subgroup Y.

  vi. Per locked decision #5 — NO subgroup text label is rendered. The visual cue is purely the row break + slightly larger vertical gap (suggest mt-3 or mt-4 on the first row of each subgroup if not already row-aligned, but tune for the gap-3 baseline so it reads as "different cluster" not "broken layout").

6C. Run npx tsc --noEmit. Must pass clean.

After producing diffs, STOP. Show me:
  - types.ts diff (1 line)
  - category-grid.tsx diff — full new render block, plus SECTION_ORDER/WITHIN_SECTION_ORDER/CategoryEntry changes
  - Walk through the row-aware expanded panel logic with a worked example: in EXTERIORS, click PROTECT (subgroup "Mass exterior emulsion", within-section index 3) — confirm the expanded panel inserts after the row containing PROTECT WITHIN the "Mass exterior emulsion" subgroup grid, and not bleeding into "Specialty exterior" subgroup below.
  - tsc --noEmit output

Wait for "go" before Phase 7.

──── PHASE 7 — Final summary ───────────────────────────────────────

If tsc clean:

- Files created (1): scripts/v2-update-section-and-add-subgroup.sql
- Files modified: prisma/schema.prisma, scripts/v2-catalog-seed-from-preview.ts, app/api/place-order/data/route.ts, app/(place-order)/place-order/types.ts, app/(place-order)/place-order/components/category-grid.tsx
- Untouched: live mo_order_form_index, mo_sku_lookup, mo_sku_lookup_v2, /api/order/data, /order mobile, parser, enrichment, lib/mail-orders/*, expanded-panel.tsx, place-order-page.tsx, middleware.ts, lib/permissions.ts, all orders/import/dispatch/pick/tint/attendance tables
- Operations: zero npm install, zero prisma db push/migrate, zero $transaction
- v2 catalog rows: 455 (unchanged), now with both section (updated for FLOOR PLUS/SMOOTHOVER) and subgroup populated

Do NOT commit. I commit manually after smoke testing.

──── ENGINEERING RULES (CLAUDE_CORE.md §3) ─────────────────────────

- Schema changes via Supabase SQL Editor only — NEVER prisma db push or migrate
- Sequential awaits only — no $transaction
- All API routes export const dynamic = 'force-dynamic'
- camelCase columns, double-quoted in SQL, no @map
- tsc --noEmit must pass before Phase 7
- One teal element rule (CLAUDE_UI.md): no teal anywhere in subgroup styling
- Single-step approval gates between every phase
- "Do not write code yet" gate at Phase 0

──── START ────────────────────────────────────────────────────────

Begin with Phase 0: read the 9 files, confirm in one short message, then wait for "go".