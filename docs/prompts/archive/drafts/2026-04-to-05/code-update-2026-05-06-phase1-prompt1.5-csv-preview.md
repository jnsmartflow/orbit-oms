# Claude Code prompt — Phase 1 Prompt 1.5: run preview from local CSVs (no DB)

**Why this prompt:** Phase 1 Prompt 1 built the mapping function and preview script, but the local Prisma connection to Supabase failed (network/pooler issue). We have the data we need as CSVs saved to `docs/prompts/drafts/`. This prompt swaps the data source from Prisma to those CSVs, runs the same mapping logic, and produces the preview JSON.

---

## CONSTRAINTS — read carefully before doing anything

1. **No database access.** This prompt does NOT call `prisma.*` against any table. The data source is two local CSV files. Do not import `@/lib/prisma` or `PrismaClient` in any new code.
2. **No schema changes.** Do not modify `prisma/schema.prisma`. Do not run any prisma command.
3. **Reuse the existing mapping function.** `lib/mail-orders/taxonomy-mapping.ts` already exists from Phase 1 Prompt 1. Do not modify it. Just import and use it.
4. **TypeScript must compile.** Run `npx tsc --noEmit` at the end and confirm zero errors.
5. **Do not write code yet.** First, view the files listed below and confirm understanding. Wait for explicit "go" instruction at the bottom of this prompt before generating code.

---

## FILES TO READ FIRST (in this exact order)

1. `lib/mail-orders/taxonomy-mapping.ts` — the existing mapping function. Confirm its `LegacyKey` type and `mapLegacyToNew()` / `getSkipReason()` signatures.
2. `scripts/preview-new-taxonomy.ts` — the existing preview script. Read its output shape so the new CSV-driven script produces the same JSON structure.
3. `docs/prompts/drafts/mo_sku_lookup-triples-2026-05-06.csv` — the input data. Header row: `category,product,baseColour,sku_count,example_description`.
4. `docs/prompts/drafts/mo_order_form_index-backup-2026-05-06.csv` — the existing catalog snapshot. Header row: `id,family,subProduct,displayName,searchTokens,tinterType,sortOrder,isActive,createdAt,baseColour,productType`.

After viewing, summarise back to me in 5-7 lines:
- The exact `LegacyKey` shape expected by `mapLegacyToNew()`
- The output JSON structure produced by the existing preview script
- How the CSV columns map to `LegacyKey` fields
- Any edge cases in the CSV (empty `baseColour` values are common — what does the existing mapping function expect: empty string or null?)

Do NOT yet write the new script.

---

## SCOPE OF WORK

### Step A — Create the CSV-driven preview script

Create a new file `scripts/preview-new-taxonomy-from-csv.ts` that:

1. Reads `docs/prompts/drafts/mo_sku_lookup-triples-2026-05-06.csv` from disk (use `node:fs` and a CSV parser — `csv-parse` if installed, otherwise a small hand-rolled parser since the data has no embedded commas based on inspection).

2. For each CSV row, builds a `LegacyKey`:
   ```ts
   {
     category: row.category,
     product: row.product,
     baseColour: row.baseColour || '',     // empty string for blank cells
     description: row.example_description, // for description-driven splits if needed
   }
   ```

3. Calls `mapLegacyToNew(legacyKey)`. Handles three result types:
   - `null` → record in `skippedTriples` with the reason from `getSkipReason()`
   - `NewRow[]` of length 1 → record in `newRowsByFamily`
   - `NewRow[]` of length 2-3 → record each row, count cross-listed extras

4. Tracks any triples that come back with no mapping rule (warnings).

5. Writes the output to `docs/prompts/drafts/taxonomy-preview.json` with shape:
   ```json
   {
     "summary": {
       "totalLegacyTriples": ...,
       "totalNewRows": ...,
       "crossListedExtraRows": ...,
       "skippedTriples": ...,
       "warnings": ...,
       "familiesProduced": ...
     },
     "newRowsByFamily": { "LUXURIO": [...], "2K PU": [...], ... },
     "skippedTriples": [{ category, product, baseColour, reason }, ...],
     "warnings": [{ category, product, baseColour, exampleDescription }, ...]
   }
   ```

6. Prints summary counts to stdout in the same format the existing script uses:
   ```
   ─── Phase 1 taxonomy preview (from CSV) ───
   Total legacy triples processed : NNN
   Total new rows that would seed : MMM
   Cross-listed extra rows        : KK
   Skipped (intentional)          : SS
   Warnings (no mapping rule)     : WW
   Families produced              : FF (expected 33)
   Output                         : docs/prompts/drafts/taxonomy-preview.json
   ```

### Step B — CSV parsing approach

Inspect the CSV file first. Headers are `category,product,baseColour,sku_count,example_description`. None of the values contain commas based on the data we've seen (paint product names use spaces, not commas).

Use a simple hand-rolled split parser. Do NOT add a new npm dependency for this:

```ts
function parseCsvLine(line: string): string[] {
  // Simple split by comma. Confirm CSV has no embedded commas.
  return line.split(',').map((v) => v.trim());
}
```

If you find any row with quoted fields or embedded commas while reading, switch to a proper parser like `csv-parse/sync` only if it's already in `package.json`. Otherwise reject the CSV and ask the user to clean it.

### Step C — Family/sub-product/SKU count matching

For each `(family, subProduct)` group in the output, also include a `skuCount` derived from the input CSV's `sku_count` column. This helps verify the mapping covers all SKUs (sum of skuCounts in `newRowsByFamily` minus cross-list duplicates should equal sum of skuCounts in input minus skipped).

### Step D — Run the script

Run `npx tsx scripts/preview-new-taxonomy-from-csv.ts` and capture the stdout. Confirm `taxonomy-preview.json` was written to `docs/prompts/drafts/`.

### Step E — Quick sanity report

After running, give me a 4-6 line report covering:
- The 6 summary counts
- Top 3 families by row count
- Bottom 3 families by row count
- Any warnings — list the first 5 warning triples verbatim (`category / product / baseColour / exampleDescription`)
- Whether the cross-list count matches the rough expectation: ~64 PROMISE EXTERIOR + ~64 PROMISE INTERIOR + ~45 PROMISE ENAMEL + Promise primer triples × 2

---

## OUTPUT EXPECTED FROM THIS PROMPT

1. `scripts/preview-new-taxonomy-from-csv.ts` — the new CSV-driven preview script
2. `docs/prompts/drafts/taxonomy-preview.json` — the dry-run output
3. The 4-6 line sanity report at the end of your response

---

## DO NOT WRITE CODE YET

Read the files listed in "FILES TO READ FIRST". Summarise your understanding in 5-7 lines. Then wait for me to say **"go"** before writing any code.
