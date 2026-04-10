# Context Update v62

## SCHEMA CHANGES

New table (created via Supabase SQL Editor):

```sql
CREATE TABLE mo_learned_customers (
  id SERIAL PRIMARY KEY,
  "normalizedText" TEXT NOT NULL,
  "customerCode" TEXT NOT NULL,
  "hitCount" INTEGER DEFAULT 1,
  "operators" TEXT NOT NULL DEFAULT '[]',
  "lastConfirmedAt" TIMESTAMPTZ DEFAULT NOW(),
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_learned_text_code
  ON mo_learned_customers ("normalizedText", "customerCode");
```

Prisma model `mo_learned_customers` added to schema. Schema version: **v26.4**.

## NEW/MODIFIED FILES

- `lib/mail-orders/customer-match.ts` — Rewritten `matchByKeywords()` with token-based scoring engine (rarity-weighted tokens, area fuzzy match, consecutive bonuses, exact string fast path)
- `app/api/mail-orders/ingest/route.ts` — Added `bodyCustomerName`/`bodyCustomerCode` to IngestRequest; body fallback when subject match fails; learned keyword auto-match check with 4 guard rules
- `app/api/mail-orders/learn-customer/route.ts` — **NEW** — POST endpoint for saving operator customer corrections
- `lib/mail-orders/api.ts` — Added `learnCustomer()` fire-and-forget helper
- `app/(mail-orders)/mail-orders/mail-orders-page.tsx` — Fires `learnCustomer()` after operator picks customer from Code column picker (only when previous status was unmatched/multiple)
- `Parse-MailOrders-v6_1.ps1` — Added `Extract-BodyCustomer` function; body customer name/code sent in API payload; `_Base` injected into rawText in `Send-ToApi`

## NEW API ENDPOINTS

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /api/mail-orders/learn-customer | Session | Upserts learned customer correction into mo_learned_customers |

## BUSINESS RULES ADDED

**SKU Enrichment — Base injection:** Parser's `Send-ToApi` now injects `_Base` into `rawText` (e.g., `"Promise exter"` + `_Base="93"` → `rawText="Promise exter 93"`). Enrichment engine receives base codes and matches NUMBERED strategy products correctly.

**GEN SKU cleanup:** 8 non-retail "GEN" SKUs deleted from `mo_sku_lookup` (materials: 5860311, 5984151, 5967877, 5955808, 5955810, 5955818, 5955826, 5911947). These shared combo keys with retail SKUs and caused non-deterministic wrong matches.

**Customer matching v2 — Token scoring:** `matchByKeywords()` uses rarity-weighted token overlap instead of substring matching. Token weights: unique (≤2 customers)=10, rare (≤5)=5, moderate (≤15)=3, common (>15)=1. Noise words stripped. Area fuzzy match (Levenshtein ≤1) gives +8 bonus. Exact string match = score 200 fast path.

**Customer matching v2 — Body fallback:** Parser extracts customer name/code from email body (patterns: "Customer:", "Dealer:", "Code:", standalone 5-7 digit codes in first 5 lines). Body match overrides subject only when subject returned non-exact AND body returns exact, or body returns multiple when subject was unmatched.

**Customer matching v2 — Learned auto-match:** Operator picks from Code column picker → saved to `mo_learned_customers`. Auto-match triggers ONLY when ALL guards pass:
1. hitCount >= 3
2. uniqueOperators >= 2 (parsed from JSON `operators` field)
3. No conflict (no other learned row with hitCount >= 2 for same text → different customer)
4. customerCode still exists in `mo_customer_keywords`

If guards fail but learned candidate exists → unmatched upgraded to multiple (candidate shown in picker).

## PENDING ITEMS

1. **Parser file deployment** — Updated `Parse-MailOrders-v6_1.ps1` must be copied to depot PC (base injection + body customer extraction)
2. **Customer matching Phase C** — SO relationship boost (deprioritized, low impact vs Phase A/B/D)
3. **Learned keyword admin view** — No UI to view/delete learned keywords yet; manage via Supabase SQL Editor
4. **Re-enrich existing wrong orders** — Orders with wrong base matches (pre-base-injection) retain wrong data; operators can resolve manually or wait for re-orders

## CHECKLIST UPDATES

Add to session start checklist:
- **Customer matching:** v2 token scoring engine. Body fallback. Learned auto-match (hitCount≥3, 2+ operators, no conflict, code exists).
- **mo_learned_customers table** exists. Do not delete — accumulates operator corrections over time.
- **Parser v6.1** injects `_Base` into rawText and extracts body customer name/code.
- **GEN SKUs** deleted from mo_sku_lookup. If new GEN SKUs appear in future imports, delete them — they are non-retail tinting machine SKUs.
