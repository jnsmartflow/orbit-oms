# Claude Code prompt — Phase 1 Prompt 1.6: fix translator bugs from dry-run

**Why this prompt:** Phase 1 Prompt 1.5 ran the preview against the local CSV and surfaced 96 warnings (legacy triples with no mapping rule). The bugs are documented and most are simple string-matching fixes. This prompt patches them in `lib/mail-orders/taxonomy-mapping.ts`, re-runs the preview, and confirms warnings drop to near-zero.

---

## CONSTRAINTS — read carefully before doing anything

1. **No database access.** Same as previous prompt. No `prisma.*` calls, no schema changes.
2. **Modify ONLY `lib/mail-orders/taxonomy-mapping.ts`.** Do not modify the preview scripts, the schema, the CSV files, or any other file unless explicitly listed.
3. **Re-run the existing CSV-driven preview script** after edits (`npx tsx scripts/preview-new-taxonomy-from-csv.ts`). Do NOT create a new preview script.
4. **TypeScript must compile.** Run `npx tsc --noEmit` at the end and confirm zero errors.
5. **Do not write code yet.** First, view the files, summarise the planned edits, and wait for explicit "go" before patching.

---

## FILES TO READ FIRST (in this exact order)

1. `lib/mail-orders/taxonomy-mapping.ts` — the existing translator. Re-familiarise with how `mapLegacyToNew()` dispatches by category and product.
2. `docs/prompts/drafts/web-update-2026-05-06-master-taxonomy-redesign.md` — re-confirm the canonical taxonomy. Pay attention to Section 1 (WOODCARE / Sadolin sub-products), Section 4C / 6.6 (STAINER family).
3. `docs/prompts/drafts/taxonomy-preview.json` — the dry-run output. Look at `warnings[]` to see exact patterns the translator missed.

After viewing, summarise back to me in 6-8 lines:
- The current dispatch structure in `mapLegacyToNew()` (rough sketch — by category? by product? hybrid?)
- Which dispatch branch handles SADOLIN today and what product strings it expects
- Which dispatch branch handles TINTER today
- The exact list of category values your code currently recognises (so we know what's missing)
- Any concern about the planned edits below

Do NOT yet write code.

---

## SCOPE OF WORK — 10 specific edits to `lib/mail-orders/taxonomy-mapping.ts`

### Edit 1 — SADOLIN 2K PU pattern matching (4 product groups → 1 sub-product)

The actual SADOLIN 2K PU product strings in the live data are:
- `2KPU GLOSS`, `2KPU MATT`, `2KPU THINNER` (generic)
- `EXT CLR 2K PU GLOSS`, `EXT CLR 2K PU MATT`, `EXT CLR 2K PU SEALER` (Exterior Clear variants)
- `INT CLR 2K PU GLOSS`, `INT CLR 2K PU MATT`, `INT CLR 2K PU SEALER` (Interior Clear variants)
- `OPQ 2K PU GLOSS`, `OPQ 2K PU MATT`, `OPQ 2K PU PRIMER SURFACER` (Opaque variants)

Pattern logic: any product matching `/2K?\s?PU/i` AND `category === 'SADOLIN'` AND product does NOT contain "LUXURIO" or "PU PRIME" or "1KPU" → 2K PU family.

Sub-product is determined by the finish keyword in the product string:
- contains "MATT" → sub-product `MATT`
- contains "GLOSS" → sub-product `GLOSS`
- contains "SEALER" → sub-product `SEALER`
- contains "THINNER" → sub-product `2K PU THINNER`
- contains "PRIMER SURFACER" → sub-product `PRIMER SURFACER`

The variant prefix (EXT CLR / INT CLR / OPQ) becomes part of `displayName` (e.g. `"Sadolin 2K PU Matt — Exterior Clear 90"`) but does NOT split into a separate sub-product. Use `baseColour` for the actual base/colour distinction.

### Edit 2 — SADOLIN PU PRIME pattern matching

Live products:
- `PU PRIME GLOSS`, `PU PRIME MATT`, `PU PRIME THINNER`
- `PU PRIME GLOSS CLEAR`, `PU PRIME MATT CLEAR` (Clear variants)
- `PU PRIME WHITE SEALER`, `PU PRIME CLEAR SEALER` (Sealer split)

Pattern: `category === 'SADOLIN'` AND product starts with "PU PRIME".

Sub-product:
- contains "MATT" → `MATT`
- contains "GLOSS" → `GLOSS`
- contains "WHITE SEALER" or "CLEAR SEALER" → `SEALER` (consolidate)
- contains "THINNER" → `MULTI PURPOSE THINNER`

The "CLEAR" / "WHITE" qualifier becomes part of `displayName` (e.g. `"PU Prime Matt — Clear"`) but doesn't split sub-products.

### Edit 3 — SADOLIN LUXURIO

Already correct. No changes needed if the existing rule matches `LUXURIO PU GLOSS / MATT / SEALER`.

### Edit 4 — SADOLIN NC family (add NECOL line + 1KPU)

Existing master `.md` listed NC sub-products: NC LACQUER, NC OPAQUE, SYNTHETIC VARNISH, NC 1KPU GLOSS, NC SANDING SEALER, NC WOOD THINNER.

Live data adds three NECOL products that aren't in the master `.md`:
- `NC NECOL` (3 SKUs)
- `NC NECOL CLEAR` (2)
- `NC NECOL THINNER` (3)

Add 3 new sub-products to NC family: `NC NECOL`, `NC NECOL CLEAR`, `NC NECOL THINNER`. Keep them distinct from regular NC (different chemistry).

Also fix:
- `INT CLR 1K PU GLOSS` (3 SKUs) → NC family, sub-product `NC 1KPU GLOSS` (this product was anticipated but the translator was looking for product name "1KPU GLOSS" not "INT CLR 1K PU GLOSS").

### Edit 5 — SADOLIN EPOXY (3 products, 2 deferrals + 1 new sub-product)

Live data:
- `EPOXY INSULATOR` (2 SKUs) — keep deferred per master `.md` Section 1.1 (skip with reason "deferred to industrial round")
- `EPOXY INSULATOR HARDNER` (1) — same skip reason
- `EPOXY 1K PRIMER` (4) — **NEW FINDING not in master `.md`.** Add to PRIMER family as new sub-product `EPOXY PRIMER`.

### Edit 6 — SADOLIN MELAMINE (already correct — verify)

Live: INT CLR MELAMINE GLOSS / MATT / SEALER + MELAMINE THINNER. Master `.md` planned this. Verify the existing rule matches the `INT CLR MELAMINE` prefix; if not, fix the prefix matching.

### Edit 7 — TINTER pattern matching (replace string-list with regex)

Replace whatever the existing TINTER rule does with this pattern dispatch (within `mapLegacyToNew()`):

```ts
if (legacy.category === 'TINTER') {
  const product = legacy.product.trim();
  
  if (product === 'GVA') {
    // 12 GVA SKUs → STAINER family, PU STAINER sub-product
    return [{ family: 'STAINER', subProduct: 'PU STAINER', tinterType: 'PU_STAINER', ... }];
  }
  
  if (/^[A-Z]{2}[0-9]$/.test(product)) {
    // BU1, NO1, NO2, RE1, RE2, OR1, MA1, GR1, WH1, XR1, XY1, YE1, YE2 → ACOTONE
    return [{ family: 'STAINER', subProduct: 'ACOTONE TINTER', tinterType: 'ACOTONE', ... }];
  }
  
  if (/^[A-Z]{3}$/.test(product)) {
    // BLK, FFR, GRN, LFY, MAG, OXR, TBL, WHT, YOX → MACHINE TINTER
    return [{ family: 'STAINER', subProduct: 'MACHINE TINTER', tinterType: 'MACHINE_TINTER', ... }];
  }
  
  // Unknown TINTER product — return null and log warning
  return null;
}
```

`baseColour` for these rows: use the legacy.baseColour as-is if present; otherwise null. The colour might be in `description` for some Acotone codes but that's fine — display can use the description if needed.

### Edit 8 — PROMISE ENML category fix

Change the existing rule from `category === 'PROMISE' && product === 'PROMISE ENML'` to `category === 'PROMISE ENML' && product === 'PROMISE ENML'`. Routes to PROMISE ENAMEL family + cross-list to PROMISE family. (Same downstream behaviour, just different category check.)

### Edit 9 — PU category routes to GLOSS

Add new rule: `category === 'PU' && product === 'PU ENAMEL'` → GLOSS family, sub-product `GLOSS`. This is the 12-in-1 PU enamel per master `.md` Section 2 ("DULUX/PU ENAMEL → folded into GLOSS family"). Same logic, different actual category in the data.

### Edit 10 — Stragglers + WEATHERCOAT specialty + TEXTURE drift

**a. DULUX/SUPERCOVER stragglers:** add rule `category === 'DULUX' && product === 'SUPERCOVER'` → SUPERCOVER family, sub-product `SUPERCOVER`. (2 SKUs slipped into DULUX category.)

**b. WEATHERCOAT specialty deferral:** add 6 products to the skip list with reason `"deferred specialty exterior — planning doc §3.5"`:
- WS ELASTOMERIC
- WS FLASH
- WS PRIMA E900
- WS PROJECT
- WS TR E2000
- WS ULTRACLEAN

These should appear in `skippedTriples[]`, NOT `warnings[]`.

**c. TEXTURE category data drift:** 2 rows under `category=TEXTURE, product=VT VELVETINO` (Gold and Silver). These are mis-categorised — they belong under VT SPECIALTY/VELVETINO. Route them: `category === 'TEXTURE' && product === 'VT VELVETINO'` → VT SPECIALTY family, sub-product `VELVETINO`. Add a code comment flagging these as "data drift — Phase 2 cleanup: re-categorise from TEXTURE to VT SPECIALTY in mo_sku_lookup".

### Edit 11 — Verify NO1 special case (clarification)

In Edit 7 the regex `/^[A-Z]{2}[0-9]$/` matches `BU1, BU2, NO1, NO2, RE1, RE2, OR1, MA1, GR1, WH1, XR1, XY1, YE1, YE2`. Some of these have actual colour signal:
- `BU1` = Acotone Blue 1, `BU2` = Acotone Blue 2
- `NO1` = Neutral 1 (white-ish base), `NO2` = Neutral 2
- `RE1`, `RE2` = Red 1 and 2
- etc.

Don't try to map these colours yet — let `displayName` carry the colour signal from `description` parsing. Just route them to ACOTONE TINTER sub-product. Phase 2 / Phase 3 can do better display naming if needed.

---

## After applying the edits

Run `npx tsx scripts/preview-new-taxonomy-from-csv.ts` again and report:

```
Total legacy triples processed : NNN
Total new rows that would seed : MMM
Cross-listed extra rows        : KK  (target: ~120-180 — was 43)
Skipped (intentional)          : SS  (target: ~64+ — was 58, +6 WEATHERCOAT specialty)
Warnings (no mapping rule)     : WW  (target: 0-5 — was 96)
Families produced              : FF (expected 33)
```

If warnings are still > 5, list the remaining ones verbatim with category / product / baseColour / exampleDescription. We'll iterate.

If warnings are ≤ 5, give a short report:
- Top 3 families by row count
- Cross-list extras count and expected breakdown (Promise Enamel = 45, Promise Exterior = ~64, Promise Interior = ~64, Promise primers ×2 = ~10)
- Confirm `taxonomy-preview.json` was overwritten cleanly

---

## OUTPUT EXPECTED FROM THIS PROMPT

1. Edited `lib/mail-orders/taxonomy-mapping.ts` (10 edits as listed)
2. Re-run preview → updated `docs/prompts/drafts/taxonomy-preview.json`
3. Stdout summary + warning resolution report

---

## DO NOT WRITE CODE YET

Read the files listed in "FILES TO READ FIRST". Summarise your understanding (6-8 lines):
- Current dispatch structure of `mapLegacyToNew()`
- How SADOLIN, TINTER, PROMISE ENML branches currently work
- Whether all 10 edits above can be implemented as additions/replacements without rewriting the function
- Any concerns about Edits 1-2 (the SADOLIN 2K PU / PU PRIME pattern matching is the most complex change)

Then wait for "go" before patching.
