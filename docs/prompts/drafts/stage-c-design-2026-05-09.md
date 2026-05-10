# Stage C — Data migration design (locked decisions)
# OrbitOMS taxonomy migration · Phase 2 prep
# Generated: 2026-05-09

**Stage:** C (data migration design — read-only, no DB writes, no code changes)
**Predecessors:** Stage A audit (`stage-a-final-report-2026-05-07.md`), Stage B schema design (`stage-b-design-2026-05-08.md`)
**Successors:** Stage D (parser/enrichment update) → Stage E (live SKU migration) → Stage F (re-apply taxonomy redesign) → Stage G (Phase 2 hygiene)

---

## 1. Executive summary

Stage C locks the design of the splitter — the helper that converts legacy compound `product` strings into `(product, subVariant)` pairs — and the preview-script that validates the split against all 1,599 SKU rows before any database write.

**The locked scope is narrow.** Only three woodcare families produce non-null `subVariant` values: LUXURIO, 2K PU, and PU PRIME. Three variant tokens: MATT, GLOSS, SEALER. Every other family in the catalog (WS, PROMISE, VT, AQUATECH, MELAMINE, NC, STAINER, etc.) keeps its product string whole with `subVariant = null`.

**Justification for narrow scope:** Stage B's reversibility guard (Q3) requires `legacy === \`${product} ${subVariant ?? ""}\`.trim()` for every row. A `subVariant = null` row trivially satisfies the guard (`product === legacy`). This means the splitter doesn't need to handle every legacy string — only the ones with a genuine finish axis. Families like MELAMINE GLOSS, NC LACQUER, ETERNA HI-SHEEN have named-compound sub-products that aren't parallel finishes of the same product, so they stay whole and the existing `taxonomy-mapping.ts` logic continues to handle them at the form-index side without disruption.

**No DB writes this session.** Output is the splitter spec, the preview-script spec, and the handoff to Stage E.

---

## 2. The splitter — `splitLegacyProduct`

### 2.1 Signature

```ts
function splitLegacyProduct(legacy: string): {
  product: string;
  subVariant: string | null;
  reviewReason: string | null;
}
```

- `product` — the product half (everything except the trailing variant word, if any)
- `subVariant` — `"MATT"`, `"GLOSS"`, `"SEALER"`, or `null`
- `reviewReason` — `null` on success, or one of the failure codes (see §2.6) when the row needs manual review

Three callers (Stage B Q10 lock):
1. Stage E migration script — bulk processes 1,599 SKU rows
2. `EnrichResult` composition (Q9) — runtime, on output
3. `carryProduct` parser hint (Q10) — runtime, on input

One source of truth in TypeScript, in `lib/mail-orders/`.

### 2.2 Variant token catalogue (Section 1 lock)

Exactly three tokens qualify as `subVariant`:

| Token | Fires on family |
|---|---|
| `MATT` | LUXURIO, 2K PU, PU PRIME |
| `GLOSS` | LUXURIO, 2K PU, PU PRIME |
| `SEALER` | LUXURIO, 2K PU, PU PRIME |

Comparisons are case-insensitive on input. Output preserves the original case from the legacy string.

### 2.3 Family detection (Section 1 lock)

The splitter only fires on woodcare families. A legacy string qualifies as woodcare if its **product half** (everything before the trailing variant) contains one of:

- `LUXURIO`
- `2K PU` (or `2KPU` — variant whitespace tolerated)
- `PU PRIME`

The `INT CLR`, `EXT CLR`, `OPQ` prefixes seen on real `legacy.product` strings are kept attached to the product half. Detection is by `contains` (case-insensitive), so `"INT CLR 2K PU"` still triggers the 2K PU rule.

### 2.4 Category prefix handling (Section 2 lock)

Prefixes like `"INT CLR"`, `"EXT CLR"`, `"OPQ"` stay attached to `product`. The splitter does not strip them.

| Legacy | Product (after split) | subVariant |
|---|---|---|
| `"INT CLR 2K PU MATT"` | `"INT CLR 2K PU"` | `"MATT"` |
| `"EXT CLR 2K PU GLOSS"` | `"EXT CLR 2K PU"` | `"GLOSS"` |
| `"OPQ 2K PU PRIMER SURFACER"` | `"OPQ 2K PU PRIMER SURFACER"` | `null` (no trailing variant) |

**Why:** Q3 reversibility holds unconditionally. Stage F's `taxonomy-mapping.ts` rewrite handles prefix-stripping at the join layer when the form-index is rebuilt.

### 2.5 Algorithm (plain English)

```
splitLegacyProduct(legacy):
  1. If legacy is empty, whitespace-only, or null
       → return { product: legacy, subVariant: null, reviewReason: "EMPTY_INPUT" }
  
  2. If legacy contains "|"
       → return { product: legacy, subVariant: null, reviewReason: "PIPE_IN_INPUT" }
  
  3. Trim, uppercase a copy for matching. Keep original case for output.
  
  4. Check if uppercase copy ends with " MATT", " GLOSS", or " SEALER"
       (with leading space — so bare "MATT" doesn't match,
        and "PRIMER SURFACER" doesn't match SEALER).
     If no → return { product: legacy.trim(), subVariant: null, reviewReason: null }
  
  5. The candidate split:
       productHalf = legacy without the trailing variant word (preserve case)
       variant     = the trailing word (preserve case)
  
  6. Check if productHalf (uppercase) contains "LUXURIO", "2K PU", "2KPU", or "PU PRIME"
     If no → return { product: legacy.trim(), subVariant: null, reviewReason: null }
            (woodcare gate — non-woodcare families stay whole)
  
  7. If productHalf is empty after the split (e.g. legacy was just "MATT")
       → return { product: legacy, subVariant: null, reviewReason: "EMPTY_PRODUCT_AFTER_SPLIT" }
  
  8. Reversibility guard:
       composed = `${productHalf} ${variant}`.trim()
       if composed.toUpperCase() !== legacy.trim().toUpperCase()
         → return { product: legacy, subVariant: null, reviewReason: "REVERSIBILITY_FAILED" }
  
  9. return { product: productHalf, subVariant: variant, reviewReason: null }
```

### 2.6 Review reason codes

| Code | Trigger |
|---|---|
| `EMPTY_INPUT` | legacy is `""`, whitespace-only, or null |
| `PIPE_IN_INPUT` | legacy contains `\|` (would break composite key) |
| `EMPTY_PRODUCT_AFTER_SPLIT` | trailing variant detected but no product half remains |
| `REVERSIBILITY_FAILED` | `${product} ${subVariant}`.trim() !== legacy.trim() (case-insensitive) |

Rows with any review code go to the manual-review queue (§4) and **are not** included in the preview JSON.

### 2.7 Worked examples

| Legacy input | Output | Bucket |
|---|---|---|
| `"LUXURIO PU MATT"` | `("LUXURIO PU", "MATT")` | Split |
| `"LUXURIO PU GLOSS"` | `("LUXURIO PU", "GLOSS")` | Split |
| `"LUXURIO PU SEALER"` | `("LUXURIO PU", "SEALER")` | Split |
| `"2K PU MATT"` | `("2K PU", "MATT")` | Split |
| `"PU PRIME GLOSS"` | `("PU PRIME", "GLOSS")` | Split |
| `"INT CLR 2K PU MATT"` | `("INT CLR 2K PU", "MATT")` | Split |
| `"EXT CLR 2K PU GLOSS"` | `("EXT CLR 2K PU", "GLOSS")` | Split |
| `"2K PU THINNER"` | `("2K PU THINNER", null)` | Whole (no trailing MATT/GLOSS/SEALER) |
| `"2K PU PRIMER SURFACER"` | `("2K PU PRIMER SURFACER", null)` | Whole |
| `"MELAMINE GLOSS"` | `("MELAMINE GLOSS", null)` | Whole (not woodcare family) |
| `"MELAMINE MATT"` | `("MELAMINE MATT", null)` | Whole |
| `"NC SANDING SEALER"` | `("NC SANDING SEALER", null)` | Whole (not woodcare family) |
| `"NC LACQUER"` | `("NC LACQUER", null)` | Whole |
| `"WS MAX"` | `("WS MAX", null)` | Whole |
| `"PROMISE INTERIOR"` | `("PROMISE INTERIOR", null)` | Whole |
| `"ETERNA HI-SHEEN"` | `("ETERNA HI-SHEEN", null)` | Whole |
| `"GVA"` | `("GVA", null)` | Whole (tinter code) |
| `"WH1"` | `("WH1", null)` | Whole (tinter code) |
| `""` | flagged | Review (`EMPTY_INPUT`) |
| `"MATT"` | flagged | Review (`EMPTY_PRODUCT_AFTER_SPLIT`) |
| `"FOO\|BAR"` | flagged | Review (`PIPE_IN_INPUT`) |

---

## 3. Same logic for `mo_product_keywords`

The splitter is data-source-agnostic — same input shape, same output shape. Applied to `mo_product_keywords.product`, the rules are identical.

Expected behaviour: keyword rows like `(keyword="LUXURIO MATT", product="LUXURIO PU MATT")` migrate to `(keyword="LUXURIO MATT", product="LUXURIO PU", subVariant="MATT")`. Non-woodcare keywords stay whole.

The Stage A audit (Q1) found one forward-drift case: a `product='VT'` keyword row that has no matching SKU. The splitter doesn't fix this — Stage G handles it. The splitter just leaves it as `("VT", null)` like any other non-woodcare row.

---

## 4. Manual-review queue

### 4.1 Output file

`docs/prompts/drafts/sku-split-manual-review.json` (and `keyword-split-manual-review.json` for the keyword side)

### 4.2 Entry shape

```json
{
  "row_id": "<mo_sku_lookup primary key>",
  "legacy_product": "<original string>",
  "legacy_baseColour": "<for context>",
  "legacy_packCode": "<for context>",
  "splitter_attempted": {
    "product": "...",
    "subVariant": "..."
  },
  "failure_reason": "EMPTY_INPUT | PIPE_IN_INPUT | EMPTY_PRODUCT_AFTER_SPLIT | REVERSIBILITY_FAILED",
  "suggested_action": "manual decision needed"
}
```

### 4.3 Resolution workflow

For each entry in the queue, Smart Flow either:

1. **Edits the splitter** — if the case represents a missing rule that should be coded
2. **Writes a manual override** — if the case is one-off, the resolution goes into a separate override file the Stage E migration reads alongside the preview JSON
3. **Marks as data-bug** — flag the legacy row for cleanup before migration (e.g. fix in `mo_sku_lookup` directly via SQL Editor)

### 4.4 Expected volume

Based on Stage A audit findings, manual-review volume should be very low — estimated **0–5 rows out of 1,599**. If the preview script produces more than 20 review-flagged rows, that's a signal the splitter has a bug or the data has unexpected shape, and Stage C re-opens before Stage E proceeds.

---

## 5. Preview scripts

### 5.1 `scripts/preview-sku-split.ts`

**Purpose:** validate the splitter against all 1,599 `mo_sku_lookup` rows before any DB write.

**Behaviour:**
1. Read all rows from `mo_sku_lookup`
2. For each row, run `splitLegacyProduct(row.product)`
3. Sort each row into one of three buckets based on the result:
   - **Split** — non-null `subVariant` (woodcare matches)
   - **Whole** — `subVariant = null`, no review reason
   - **Review** — non-null `reviewReason`
4. Write three output files (§5.3)
5. Print console summary (§5.4)

**No DB writes. Read-only.**

### 5.2 `scripts/preview-keyword-split.ts`

Same shape, same logic, applied to `mo_product_keywords`. Three output files with `keyword-split-` prefix.

### 5.3 Output files

| File | Contents |
|---|---|
| `docs/prompts/drafts/sku-split-preview.json` | All "Split" rows. Per row: `id`, `legacy_product`, `new_product`, `new_subVariant`, `baseColour`, `packCode` |
| `docs/prompts/drafts/sku-split-whole.json` | All "Whole" rows. Same shape, `new_subVariant: null` |
| `docs/prompts/drafts/sku-split-manual-review.json` | All "Review" rows (§4.2 shape) |
| `docs/prompts/drafts/keyword-split-preview.json` | Same for keywords |
| `docs/prompts/drafts/keyword-split-whole.json` | Same for keywords |
| `docs/prompts/drafts/keyword-split-manual-review.json` | Same for keywords |

### 5.4 Console summary

```
=== mo_sku_lookup ===
Total rows:    1,599
  Split:         XXX  (woodcare: LUXURIO + 2K PU + PU PRIME)
  Whole:       X,XXX
  Review:          X

=== mo_product_keywords ===
Total rows:    XXX
  Split:         XX
  Whole:        XXX
  Review:         X
```

### 5.5 Smart Flow's review-and-approve gate

Smart Flow runs the preview scripts locally, opens the JSON files, eyeballs the splits, resolves any review-queue entries, and explicitly approves the previews before Stage E begins. No automation. Human gate.

---

## 6. Stage C → Stage E handoff

### 6.1 Stage E receives from Stage C

1. **The `splitLegacyProduct` helper** — TypeScript file in `lib/mail-orders/`. Same helper used at runtime (Q9, Q10) and at migration time.
2. **Approved preview JSONs** — Smart Flow's sign-off that the splits look correct.
3. **Manual-review resolutions** — either splitter edits (re-run preview) or override file (Stage E reads alongside preview).

### 6.2 Stage E uses the helper

Stage E's migration script reads the helper and applies it as an UPDATE to `mo_sku_lookup` and `mo_product_keywords`. The migration is idempotent — running it twice produces the same result, because the second run's input rows already have `subVariant` populated and the splitter is a no-op on rows where `legacy === product` and `subVariant` is already set.

(Idempotency note: Stage E's migration script wraps the splitter with `if (row.subVariant !== null) skip` — the helper itself doesn't need to know about that.)

### 6.3 The reversibility guard at migration time

Stage E re-runs the reversibility check during the live migration as a smoke test (Stage B §4). If even one row fails, the migration halts and rolls back. The Stage C preview should catch every failure first — Stage E's check is belt-and-braces.

---

## 7. What Stage C does NOT do

- Write the actual splitter TypeScript (Stage E is when Claude Code writes the helper)
- Run the preview script (Stage E does this)
- Touch the database in any way
- Update any production code (Stage D handles parser/enrichment changes)
- Handle the `taxonomy-mapping.ts` rewrite (Stage F)
- Decide which non-woodcare families might also need splitting (parked indefinitely; revisit only if operator workflow surfaces a need)

---

## 8. Open question parked for Stage D

`productProfiles` Map at `lib/mail-orders/enrich.ts:307` — currently keyed by `s.product` only. After the split, decision needed:

- **Coarser** — stay keyed by `s.product` (recommended: preserves shared cache across variants of the same product)
- **Finer** — extend to `${s.product}|${s.subVariant}`

This is a Stage D detail, not a Stage C lock. Flagged here for continuity.

---

## 9. Engineering rules respected

- Zero `prisma db push` (none would have been valid — design only)
- Zero `prisma.$transaction` use
- Zero schema changes (Stage C is design-only)
- Zero process executions
- All planning written via `create_file` to `docs/prompts/drafts/`
- Production unchanged from session start to session end

---

## 10. Multi-stage workstream — current position

- ✅ **Stage A — Read-only audit** (2026-05-07)
- ✅ **Stage B — Schema design** (2026-05-08)
- ✅ **Stage C — Data migration design** (2026-05-09, this document)
- ⏳ **Stage D — Update parser/enrichment**
- ⏳ **Stage E — Apply SKU migration to live DB**
- ⏳ **Stage F — Re-apply taxonomy redesign**
- ⏳ **Stage G — Phase 2 hygiene**

---

## 11. Decision log (audit trail)

For future-Smart-Flow: every section above was walked through one at a time during the Stage C planning session, with explicit "ok" approval per section.

The defining decision of Stage C was the narrow-splitter scope. Initial Stage B framing implied every legacy row gets split. Cross-checking against `taxonomy-mapping.ts` revealed that most non-woodcare families have named-compound sub-products (MELAMINE GLOSS, NC LACQUER, ETERNA HI-SHEEN) that aren't parallel finishes — they're distinct sub-products that share a prefix. Splitting them mechanically would have collapsed distinct SKUs into the same join key.

Smart Flow approved scoping the splitter to woodcare only (LUXURIO, 2K PU, PU PRIME × MATT/GLOSS/SEALER). Non-woodcare families stay whole with `subVariant = null`, satisfying the Q3 reversibility guard trivially. ETERNA and any other "maybe" families parked — revisit later if operator workflow surfaces a need.

---

*Stage C complete. Stage D begins with a fresh prompt in the next session.*
