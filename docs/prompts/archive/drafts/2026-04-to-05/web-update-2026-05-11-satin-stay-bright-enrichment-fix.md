# Web Update — 2026-05-11 — Satin Stay Bright enrichment fix

**Type:** Data / keyword fix (SQL only — no code changes)
**Module:** Mail Orders → Enrichment (`mo_product_keywords`, `mo_sku_lookup`)
**Schema:** v26.5 · **Parser:** v6.5 · **Enrichment:** v3
**Triggered by:** S. Mohanlal & Sons order 3147852 — 4 of 6 lines mismatching to wrong product family

---

## Problem

Raw text `"SATIN STAY BRIGHT BRILLIANT WHITE"` (and the `92 BASE` / `93 BASE` variants) was matching to the **SUPER SATIN** (oil-based, "DN SAT FIN") SKU series instead of the **SATIN STAY BRIGHT** (water-based, "DN SATIN STAY BRIGHT") series. Two product families confused.

Original wrong matches on order 3147852:

| Line | Raw text | Wrong match |
|---|---|---|
| 1 | SATIN STAY BRIGHT BRILLIANT WHITE (pk 4) | IN28080071 — DN SAT FIN WHITE 4L |
| 2 | SATIN STAY BRIGHT BRILLIANT WHITE (pk 10) | IN28080082 — DN SAT FIN WHITE 10L |
| 3 | SATIN STAY BRIGHT 92 BASE | IN28099272 — DN SAT FIN INTERMEDIATE BASE 0.9 LT |
| 4 | SATIN STAY BRIGHT 93 BASE | 5867118 — DN SAT FIN 93 BASE 0.925L |

---

## Root cause

The keyword table had **17 contorted keywords** for SATIN STAY BRIGHT (`WB SATIN`, `WATERSATIN`, `WT SATIN`, `STAY BRIGHT WATER BASE SATIN`, etc.) but no keyword for the literal product name `SATIN STAY BRIGHT` or its distinctive partial `STAY BRIGHT`.

When raw text `"SATIN STAY BRIGHT BRILLIANT WHITE"` ran through Phase 2 (keyword search), **none of the SATIN STAY BRIGHT keywords fired** — none of "WB", "WATER", "PU", "DULUX WB" appear in that raw text. Only one keyword fired: the bare `SATIN` (length 5), which mapped to SUPER SATIN.

Engine had only one candidate. Picked it. Wrong family.

Compounding bug found during diagnosis: keyword `SAT FIN` (length 7) was mapped to SATIN STAY BRIGHT. This is incorrect — "SAT FIN" is the SAP description shorthand for **Satin Finish** = SUPER SATIN. Latent bug; would have caused a reverse mismatch if any future email contained "SAT FIN" literally.

---

## Fix (3 SQL blocks)

### Block 1 — Add the missing compound keywords

```sql
INSERT INTO mo_product_keywords (keyword, category, product)
VALUES
  ('SATIN STAY BRIGHT', 'SATIN', 'SATIN STAY BRIGHT'),
  ('STAY BRIGHT',       'SATIN', 'SATIN STAY BRIGHT')
ON CONFLICT DO NOTHING;
```

Lengths 17 and 11 — both out-score the bare `SATIN` (5) → SUPER SATIN.

### Block 2 — Delete the wrong reverse mapping

```sql
DELETE FROM mo_product_keywords
WHERE keyword = 'SAT FIN'
  AND product = 'SATIN STAY BRIGHT';
```

1 row deleted (id 1349). No replacement added — `SATIN FINISH` keyword already exists for SUPER SATIN.

### Block 3 — Category normalization

```sql
UPDATE mo_sku_lookup
SET category = 'SATIN'
WHERE product = 'SATIN STAY BRIGHT'
  AND category = 'DULUX';
```

1 row updated (DN WB SATIN BLACK 200ML — was the only SATIN STAY BRIGHT row with `category = DULUX`; other 25 already on SATIN). Not the cause of the bug, opportunistic cleanup. All 26 SATIN STAY BRIGHT SKUs now under category SATIN.

---

## Re-enrich

Ran from logged-in browser console:

```js
fetch('/api/mail-orders/re-enrich', { method: 'POST' })
  .then(r => r.json())
  .then(console.log)
```

Endpoint re-enriches last 2 days, idempotent, only upgrades match status.

---

## Verification — S. Mohanlal & Sons (3147852)

| Line | Raw text | Now matches |
|---|---|---|
| 1 | SATIN STAY BRIGHT BRILLIANT WHITE (pk 4) | IN28140071 — DN SATIN STAY BRIGHT WHITE 4L ✅ |
| 2 | SATIN STAY BRIGHT BRILLIANT WHITE (pk 10) | IN28140082 — DN SATIN STAY BRIGHT WHITE 10L ✅ |
| 3 | SATIN STAY BRIGHT 92 BASE | IN28129272 — DN SATIN STAY BRIGHT INT. BASE 0.9L ✅ |
| 4 | SATIN STAY BRIGHT 93 BASE | 5867126 — DN SATIN STAY BRIGHT 93 BASE 0.925L ✅ |
| 5 | SUPERCOVER BRILLIANT WHITE | 5853012 (unchanged ✅) |
| 6 | MAX BRILLIANT WHITE | IN46350082 (unchanged ✅) |

All 6 lines correct. Order ready for SO punching.

---

## Lessons

1. **Product name = first keyword.** Whenever a new product family is added to `mo_sku_lookup`, the **literal product name** and any **distinctive partial** must be added to `mo_product_keywords` as compound keywords. Day one. Hack-keywords like `WATERSATIN`, `WB SATIN`, `WT SATIN` only paper over the gap and leave the obvious raw-text match unhandled.

2. **Generic keyword = silent wrong match.** A bare keyword like `SATIN` is dangerous when it points to one family among siblings. It will win by default any time longer compound keywords for other family members fail to fire. Either the generic keyword should be deleted or every sibling family needs a longer compound keyword that out-scores it.

3. **Reverse-direction keyword checks.** Diagnosis pass should always include "what does keyword X map to?" alongside "what keywords match raw text Y?". Block 2 (`SAT FIN` → SATIN STAY BRIGHT) was a latent bug that would have surfaced eventually as a reverse mismatch.

---

## Future cleanup (not done in this session)

The SATIN family keyword list has 17+ legacy entries on SATIN STAY BRIGHT that look like historical parser hacks:

- `WS SATIN`, `WT SATIN`, `WB SATIN`, `WATERSATIN`
- `WATER SATIN:`, `WATER SATIN`, `WATER BASED SATIN`, `WATER BASE PU SATIN`
- `SUPER PU SATIN`, `WB PU SATIN`, `STAY BRIGHT PU  SATIN` (double space — typo)
- `STAY BRIGHT WATER BASE SATIN`, `STAY BRIGHT WB SATIN`
- `DULUX WB SATIN`

Suggest a future SATIN family keyword review session: identify which of these are still in active rawText patterns (query `mo_order_lines.rawText` over last 90 days) vs which are dead. Prune the dead ones. Add any newly-observed dealer variants. Same exercise for SUPER SATIN's keyword list.

Low priority. Current state is correct; cleanup is hygiene.

---

## Files / tables touched

- `mo_product_keywords` — 2 inserts, 1 delete
- `mo_sku_lookup` — 1 category update

No code changes. No schema changes. No parser changes.

---

## Session shape

Single-session SQL diagnostic + fix. ~30 min end-to-end. Followed the standard prompt structure:

1. File reading (silent) → "Ready"
2. Diagnostic SQL → results shared
3. Root cause diagnosed from results
4. Fix SQL (3 blocks, SELECT-before-mutate)
5. Re-enrich + verify

One miscount mid-session (I quoted 70 rows from a CSV `sku_count` column that was per-triple, not total — actual was 26). Caught by Block 3 verify and resolved without rollback.

---

*Filed in `docs/prompts/drafts/` for consolidation into `CLAUDE_MAIL_ORDERS.md` keyword management section (§18) or `mo_product_keywords` notes at next 2-3 week consolidation cycle.*
