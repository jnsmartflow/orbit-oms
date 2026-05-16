# Claude Code prompt — Phase 1 Prompt 1: taxonomy mapping function + dry-run preview

**Goal of this prompt:** generate a TypeScript mapping function that translates current `mo_sku_lookup (category, product, baseColour)` tuples into the new taxonomy's `(family, subProduct, displayName, baseColour, sortOrder, tinterType, productType, searchTokens)` rows. Apply the function against `mo_sku_lookup` and print a preview file. **No database writes in this prompt.**

The locked taxonomy lives at `docs/prompts/drafts/web-update-2026-05-06-master-taxonomy-redesign.md` — read it first; it is the authoritative source.

---

## CONSTRAINTS — read carefully before doing anything

1. **No database writes.** This prompt does NOT call `prisma.create`, `prisma.update`, `prisma.delete`, `prisma.executeRaw`, or `prisma.$transaction` against any table. The only allowed Prisma calls are `prisma.findMany`/`findUnique`/`count` against existing tables.
2. **No schema changes.** Do not modify `prisma/schema.prisma`. Do not run `prisma migrate` or `prisma db push`.
3. **No `prisma.$transaction([...])` arrays.** This codebase uses sequential awaits per CLAUDE_CORE.md. Even though this prompt has no writes, do not introduce the pattern.
4. **Do not edit `mo_order_form_index` rows or any other catalog tables.**
5. **TypeScript must compile.** Run `pnpm tsc --noEmit` at the end and confirm zero errors before finishing.
6. **Do not write code yet.** First, view the files listed below and confirm understanding. Wait for the explicit "go" instruction at the bottom of this prompt before generating code.

---

## FILES TO READ FIRST (in this exact order)

1. `docs/prompts/drafts/web-update-2026-05-06-master-taxonomy-redesign.md` — the locked taxonomy. Source of truth for all 33 top-level families and their sub-products.
2. `prisma/schema.prisma` — confirm the columns of `mo_order_form_index` and `mo_sku_lookup`.
3. `app/api/order/data/route.ts` — confirm how `mo_order_form_index` is currently queried (so the mapping output stays compatible).
4. Any existing TypeScript file under `lib/mail-orders/` that defines display labels or sort orders (for naming consistency).

After viewing, summarise back to me in 6-8 lines what you've understood. Do NOT yet write the mapping function.

---

## SCOPE OF WORK

### Step A — Create the mapping module

Create a new file `lib/mail-orders/taxonomy-mapping.ts` exporting a single function:

```ts
export type LegacyKey = {
  category: string;     // mo_sku_lookup.category
  product: string;      // mo_sku_lookup.product
  baseColour: string;   // mo_sku_lookup.baseColour
};

export type NewRow = {
  family: string;
  subProduct: string;
  displayName: string;
  searchTokens: string;     // comma-separated keyword list
  baseColour: string | null;
  productType: 'PLAIN' | 'BASE_VARIANT' | 'COLOUR';
  tinterType: string | null;
  sortOrder: number;
  isActive: boolean;
};

export function mapLegacyToNew(legacy: LegacyKey): NewRow[] | null;
```

The function returns:
- `null` if the legacy SKU should be SKIPPED from the order form (the 6 hidden families: AUTO, DUCO, M900, SPRAY PAINT, 5IN1, TOOLS, plus orphans SILK FINISH, IAE PROJECT, DUWEL ENAMEL)
- `NewRow[]` of length 1 in normal cases
- `NewRow[]` of length 2 for cross-listed Promise primer variants (one row under PRIMER family, one under PROMISE INTERIOR/EXTERIOR family)

### Step B — Mapping rules per family

Refer to the master `.md` for full detail. Summary of the transformations:

**Section 1 — WOODCARE (SADOLIN category retires)**
- SADOLIN/LUXURIO PU MATT, GLOSS, SEALER → LUXURIO family
- SADOLIN/2KPU \* → 2K PU family
- SADOLIN/PU PRIME \*, MULTI PURPOSE THINNER → PU PRIME family
- SADOLIN/NC \*, SYNTHETIC VARNISH → NC family
- SADOLIN/MELAMINE \* → MELAMINE family
- SADOLIN/WOOD STAINER → WOOD STAIN family (rename)
- SADOLIN/WOOD FILLER → WOOD FILLER family
- SADOLIN/EPOXY INSULATOR → SKIP (deferred to industrial round)
- TINTER/GVA (12 SKUs) → STAINER family, sub-product PU STAINER, tinterType=`PU_STAINER`

**Section 2 — ENAMELS (DULUX category partly retires)**
- DULUX/GLOSS → GLOSS family (already application-based)
- DULUX/LUSTRE → LUSTRE family
- DULUX/SATIN STAY BRIGHT → SATIN family, sub-product SATIN STAY BRIGHT
- DULUX/SUPER SATIN → SATIN family, sub-product SUPER SATIN
- DULUX/PU ENAMEL → folded into GLOSS family
- PROMISE/PROMISE ENML → PROMISE ENAMEL family + cross-list to PROMISE family

**Section 3 — EXTERIORS (WS + WEATHERCOAT abstracted)**
- WS/MAX + WEATHERCOAT/MAX → MAX family
- WS/POWERFLEXX + WEATHERCOAT/POWERFLEXX → POWERFLEXX family
- WS/PROTECT → PROTECT family, sub-product PROTECT
- WEATHERCOAT/PROTECT (Dustproof) → PROTECT family, sub-product PROTECT DUSTPROOF
- WS/PROTECT RAINPROOF + WEATHERCOAT/PROTECT RAINPROOF → RAINPROOF family
- WS/HISHEEN → HISHEEN family
- WS/TILE → TILE family
- WS/TEXTURE + WEATHERCOAT/TEXTURE → TEXTURE family (Round 4C handles sub-products RUSTIC/DHOLPUR/SUPERFINE/ULTRAFINE)
- EMULSION/WS METALLIC → METALLIC family (data drift fix)
- PROMISE/PROMISE EXTERIOR + PROMISE SHEEN/PROMISE SHEEN EXTERIOR + PROMISE SMARTCHOICE/PROMISE SMARTCHOICE EXT + PROMISE SMARTCHOICE/PROMISE SMARTCHOICE EXT PRIMER → PROMISE EXTERIOR family + cross-list to PROMISE family

**Section 4A — INTERIORS (Round 4A)**
- SUPERCOVER/* → SUPERCOVER family
- DULUX/SUPERCLEAN + SUPERCLEAN/SUPERCLEAN → SUPERCLEAN family, sub-product SUPERCLEAN (parser prefers newer)
- DULUX/3IN1 + SUPERCLEAN/3IN1 → SUPERCLEAN family, sub-product SUPERCLEAN 3IN1
- VT/PEARL GLO → VT GLO family, sub-product PEARL GLO
- VT/PLATINUM GLO → VT GLO family, sub-product PLATINUM GLO
- VT/DIAMOND GLO → VT GLO family, sub-product DIAMOND GLO
- VT/ETERNA + VT/ETERNA MATT + VT/ETERNA HI-SHEEN → VT ETERNA family
- VT/AMBIANCE + VT/VAF + VT/VT FIN + VT/LUXURY FINISHES + VT/VT METALLICS + VT/VT CLEAR COAT + VT/VT MARBLE + VT/VT VELVETINO + VT/VT CONCRETE FINISH → VT SPECIALTY family

**Section 4B — INTERIORS (Round 4B — PROMISE INTERIOR)**
- PROMISE/PROMISE INTERIOR → PROMISE INTERIOR family + cross-list to PROMISE
- PROMISE SHEEN/PROMISE SHEEN INTERIOR (+ 4 drift in PROMISE/PROMISE SHEEN INTERIOR) → PROMISE INTERIOR family + cross-list
- PROMISE SMARTCHOICE/PROMISE SMARTCHOICE INT → PROMISE INTERIOR family + cross-list
- PROMISE SMARTCHOICE/PROMISE SMARTCHOICE INT PRIMER → PROMISE INTERIOR family + cross-list (also appears in PRIMER family per Round 4C — triple-listed)
- PROMISE SMARTCHOICE/PROMISE SMARTCHOICE ACRYLIC DISTEMPER → PROMISE INTERIOR family + cross-list (also DISTEMPER family per Round 4C)
- PRIMER/PROMISE FREEDOM 2IN1 → PROMISE INTERIOR family + cross-list (also PRIMER family per Round 4C)
- PROMISE/PROMISE PRIMER (1-row drift, IN84500023) → PROMISE INTERIOR family + cross-list (also PRIMER family per Round 4C)

**Section 4C — UTILITY/PREP (DUWEL retires; PRIMER/PUTTY restructured; STAINER+TINTER merged)**
- AQUATECH/* → AQUATECH family (existing structure preserved EXCEPT WATERPROOF PUTTY)
- AQUATECH/WATERPROOF PUTTY → PUTTY family, sub-product WATERPROOF PUTTY
- FLOOR PLUS/FLOOR PLUS → FLOOR PLUS family
- WS/TEXTURE + WEATHERCOAT/TEXTURE → TEXTURE family (sub-products RUSTIC, DHOLPUR, SUPERFINE, ULTRAFINE based on description parsing — see master .md section 6.7)
- DUWEL/DUWEL WOOD PRIMER + DUWEL/DUWEL FARCO WHITE PRIMER → PRIMER family, sub-product WOOD PRIMER
- DUWEL/DUWEL RED OXIDE METAL PRIMER → PRIMER family, sub-product RED OXIDE METAL PRIMER
- PRIMER/ZINC YELLOW METAL PRIMER → PRIMER family, sub-product ZINC YELLOW METAL PRIMER
- DUWEL/DUWEL WB CEMENT PRIMER + PRIMER/DULUX WB CEMENT PRIMER → PRIMER family, sub-product CEMENT PRIMER WB
- PRIMER/SB CEMENT PRIMER + DUWEL/ICI DUWEL SB CEMENT PRIMER + DUWEL/IP DUWEL SB CEMENT PRIMER → PRIMER family, sub-product CEMENT PRIMER SB
- DUWEL/DUWEL INTERIOR ACRYLIC PRIMER → PRIMER family, sub-product INTERIOR ACRYLIC PRIMER
- PRIMER/EXTERIOR ACRYLIC PRIMER → PRIMER family, sub-product EXTERIOR ACRYLIC PRIMER
- PRIMER/ALKALI BLOC PRIMER + DULUX/ALKALI BLOC PRIMER → PRIMER family, sub-product ALKALI BLOC PRIMER
- PRIMER/ROM → PRIMER family, sub-product QUICK DRYING PRIMER
- PRIMER/PROMISE 2IN1 + PRIMER/PROMISE FREEDOM 2IN1 → PRIMER family, sub-product 2IN1 INTERIOR-EXTERIOR PRIMER (cross-list to PROMISE INTERIOR)
- PRIMER/PROMISE PRIMER → PRIMER family, sub-product PROMISE PRIMER (cross-list to PROMISE INTERIOR)
- DUWEL/DUWEL ACRYLIC DISTEMPER + PROMISE SMARTCHOICE/PROMISE SMARTCHOICE ACRYLIC DISTEMPER + DULUX/INTERIOR DISTEMPER → DISTEMPER family, sub-product ACRYLIC DISTEMPER
- DUWEL/DUWEL MAGIK → DISTEMPER family, sub-product MAGIK
- PUTTY/ACRYLIC PUTTY → PUTTY family, sub-product ACRYLIC PUTTY
- DUWEL/DUWEL POLYPUTTY → PUTTY family, sub-product POLYPUTTY
- STAINER/* (10 colour shades) → STAINER family, sub-product UNIVERSAL STAINER (collapse colours into base_colour variants), tinterType=`FAST_STAINER`
- TINTER/GVA → already mapped above (STAINER family, PU STAINER, tinterType=`PU_STAINER`)
- TINTER/Acotone codes (WH1, NO1, YE1, YE2, XY1, RE1, XR1, MA1, OR1, GR1, BU1, BU2, RE2, NO2) → STAINER family, sub-product ACOTONE TINTER, tinterType=`ACOTONE`
- TINTER/JSW Dealer codes (YOX, LFY, GRN, TBL, WHT, MAG, FFR, BLK, OXR) → STAINER family, sub-product MACHINE TINTER, tinterType=`MACHINE_TINTER`
- OTHER/COLORANT → STAINER family, sub-product HP COLORANT, tinterType=`HP_COLORANT`
- DULUX/SMOOTHOVER → SMOOTHOVER family

**Hidden — return `null` from mapping function:**
- AUTO/AUTO STAR
- DUCO/* (all variants)
- M900/M900
- SPRAY PAINT/SR SPRAY PAINT
- DULUX/5IN1
- TOOLS/ROLLER, TOOLS/BRUSH

**Skipped orphans — return `null`:**
- DULUX/SILK FINISH
- DULUX/IAE PROJECT
- DUWEL/DUWEL ENAMEL

### Step C — productType assignment rules

Apply per-row:
- `PLAIN` if the new sub-product is umbrella/headerless (no base or colour to specify) — typical for single-SKU specialty products
- `BASE_VARIANT` if the legacy `baseColour` matches the pattern `\d+\s+BASE` (e.g. "90 BASE", "92 BASE", "93 BASE") or "BRILLIANT WHITE", "WHITE BASE", etc.
- `COLOUR` if the legacy `baseColour` is a named colour ("BLACK", "GOLD", "MAHOGANY", "PHIROZA" etc.)

Use the existing `mo_order_form_index` rows as reference for the rule (you saw the pattern in this prompt's planning conversation: GLO + 90 BASE = BASE_VARIANT; VT FIN + GOLD = COLOUR).

### Step D — sortOrder allocation

Each new family gets a `sortOrder` block of 100. Each sub-product within a family gets a 100-row block within. Within a sub-product, BASE_VARIANT rows come first (90, 92, 93, 94, 95, 96, 97, 98 in numeric order), then COLOUR rows alphabetical, then PLAIN at sortOrder 0 within the block.

Family ordering (recommended top-to-bottom on /place-order):

1. WOODCARE families: LUXURIO, 2K PU, PU PRIME, NC, MELAMINE, WOOD STAIN, WOOD FILLER (sortOrder 100-799)
2. ENAMELS: GLOSS, SATIN, LUSTRE (sortOrder 800-1099)
3. EXTERIOR PAINTS: MAX, POWERFLEXX, PROTECT, RAINPROOF, HISHEEN, TILE, TEXTURE, METALLIC (sortOrder 1100-1899)
4. INTERIOR PAINTS: SUPERCOVER, SUPERCLEAN, VT GLO, VT ETERNA, VT SPECIALTY (sortOrder 1900-2399)
5. PROMISE family + variants: PROMISE, PROMISE ENAMEL, PROMISE INTERIOR, PROMISE EXTERIOR (sortOrder 2400-2799)
6. UTILITY/PREP: AQUATECH, FLOOR PLUS, PRIMER, DISTEMPER, PUTTY, STAINER, SMOOTHOVER (sortOrder 2800-3499)

### Step E — searchTokens

Use the keyword aliases from each section's "Aliases / Parser Keywords" table in the master `.md`. Comma-separated.

Example for VT PEARL GLO:
```
"PEARL GLO, PEARL GLOW, VT PEARL, PEARL, DULUX PEARL GLO"
```

### Step F — Cross-listed Promise rows

For Promise primer variants, the mapping returns 2-3 rows: one under PRIMER family, one under PROMISE INTERIOR (or EXTERIOR) family, one under PROMISE umbrella family. Use distinct `sortOrder` per occurrence (each in its respective family's block).

### Step G — Generate the preview file

Create a script `scripts/preview-new-taxonomy.ts` that:
1. Connects via Prisma to read `mo_sku_lookup`
2. For each unique `(category, product, baseColour)` triple, calls `mapLegacyToNew()`
3. Aggregates results into a JSON file at `docs/prompts/drafts/taxonomy-preview.json` with shape:
   ```json
   {
     "summary": {
       "totalLegacyTriples": ...,
       "totalNewRows": ...,
       "skippedTriples": ...,
       "crossListedRows": ...
     },
     "newRowsByFamily": { "LUXURIO": [...], "2K PU": [...], ... },
     "skippedTriples": [{ category, product, baseColour, reason }, ...],
     "warnings": [...]   // any triples with no mapping rule
   }
   ```
4. Print summary counts to stdout.

The script must be runnable with `pnpm tsx scripts/preview-new-taxonomy.ts`.

---

## OUTPUT EXPECTED FROM THIS PROMPT

1. `lib/mail-orders/taxonomy-mapping.ts` — the mapping function and types
2. `scripts/preview-new-taxonomy.ts` — the preview generator
3. `docs/prompts/drafts/taxonomy-preview.json` — the dry-run output (run the script and check it in)
4. A short summary at the end:
   - Total legacy triples processed
   - Total new rows that would be inserted
   - Number of skipped triples
   - Number of warnings (triples with no mapping rule)
   - Any unexpected patterns found in `mo_sku_lookup` not anticipated by the master `.md`

---

## DO NOT WRITE CODE YET

Read the files listed in "FILES TO READ FIRST". Summarise your understanding in 6-8 lines covering:
- Confirmed source of truth (`mo_order_form_index` + master `.md`)
- The 33 target families and where they come from
- The cross-list rule for Promise products
- The 6 hidden families
- Any concern or ambiguity in the mapping rules

Then wait for me to say **"go"** before writing any code.
