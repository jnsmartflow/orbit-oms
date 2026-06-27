# Session draft — Mail enrichment: Table C exact-match fast-path
# Date: 2026-06-19 · Source: Claude Code session
# Consolidate into: CLAUDE_MAIL_ORDERS.md (enrichment section)
# Status: DEPLOYED (commit da219238, main → Vercel). Live-but-DORMANT until app orders flow.

---

## Goal
App orders → ~100% exact SKU match via an exact-name dictionary (Table C). Keyword scoring stays the
fallback for typed/human orders (best-effort, unchanged).

## Shape — STACKED, not forked
Each enrichment line tries Table C FIRST (exact `name|pack` → material); a MISS falls straight through to
the existing keyword-scoring path. Not two separate engines — one pipeline, exact-first. Zero-skip preserved.

```
each line → Table C exact dict (app orders, ~100%)
              │ hit → return matched
              │ miss / unresolved / collision ↓
            keyword scoring + fuzzy (typed orders, unchanged)
```

## Table C
- Built from `mo_sku_lookup_v2` (the V2 catalogue the app shows).
- Key = `tableCKey(nameUpper, cleanPack)`; `nameUpper = emailLineLabel(product, base, subProduct).toUpperCase()`.
- Pack normalised by the SAME `cleanPackCode` logic enrich uses (no drift).
- 1,343 distinct keys; **15 collisions EXCLUDED** (13 double-primary + 2 pack-rounding) → usable keys 1,328.
  Excluded keys are simply absent from the dict → they fall through to keyword, which stays the SOLE
  decision-maker for those ambiguous keys (Table C never auto-picks between two primaries).

## Files
- `lib/mail-orders/table-c.ts` — `buildTableC` now omits every `collisionKeys` member from the returned map.
  Full collisions array kept for review.
- `lib/mail-orders/table-c-context.ts` (NEW) — `buildTableCContext(prisma) → { tableC, tableCResolver, collisionKeys }`.
  Owns the V2 fetch (`mo_order_form_index_v2` isActive + `mo_sku_lookup_v2` isPrimary), calls `buildTableC`,
  AND builds a **V2 resolver** `Map<material, SkuEntry>` — because the engine's in-scope `skuByMaterial` is
  LEGACY-keyed and would miss V2-only materials. The resolver guarantees a Table C hit always resolves.
- `lib/mail-orders/enrich.ts` — `enrichLine` + `enrichLineCore` take optional `tableC?: Map<string,string>` +
  `tableCResolver?: Map<string,SkuEntry>`. New Step 2c fast-path sits AFTER `PACK_ROUND`, BEFORE `packsToTry`:
  `tableC.get(tableCKey(text, cleanPack))` → resolve via `tableCResolver` → return a matched shape that mirrors
  the material-code / "Clear winner" hit field-for-field (productName, baseColour, skuCode=material,
  skuDescription, refSkuCode=refMaterial ?? "", paintType, materialType, packCode, matchStatus="matched").
- `app/api/mail-orders/ingest/route.ts` — calls `buildTableCContext` ONCE per request, threads both maps into `enrichLine`.

## Name-match guarantee (parser side — see the parser v7.2 draft)
The app emits the exact V2 name; `Parse-AppBody`'s **name-lock** pins the text left of the first " - " (after
the `^\d+\.\s*` strip) verbatim as the line rawText — so enrichment's `text` equals the Table C key by
construction, even for bare-code bases like `SUPERCOVER 93` (which the generic engine would otherwise split).

## Proven — offline, self-validating (`scripts/test-tablec-fastpath.ts`, 11/11)
- Dict invariants: 1,343 distinct, 15 excluded, 1,328 usable; no collision key present.
- 5 app keys derived from the dict → matched to the exact authoritative material.
- WITH vs WITHOUT context: **`2K PU GLOSS 90 BASE` RESCUED** — keyword path picked `IN28209072`; Table C pinned
  it to the correct V2 primary `5841673`. Concrete proof the fast-path fires AND corrects the SKU.
- Collision (`WS MAX BRILLIANT WHITE|10`): absent from dict; WITH === WITHOUT (keyword decides) ✓.
- Typed line (`vt pearl glo white|20`): WITH === WITHOUT (Table C miss → keyword) ✓.

## Safety
Fully additive. Miss / unresolved sku / collision → keyword path unchanged. The other 3 enrich callers
(debug / backfill / re-enrich) pass NO context → fast-path block skipped → zero behaviour change for them and
for all typed/human orders.

## DEFERRED / next
- [ ] **Re-enrich wiring:** thread `tableC` into the re-enrich path so historical / re-run orders also get the
      fast-path (currently INGEST-only — new orders only).
- [ ] **Step 7 — reclaim the 13 double-primaries:** pick the keeper per pair → add the loser material to
      `SET_FALSE` in `scripts/v2-sku-seed-from-legacy.ts` + flip `isPrimary=false` in Supabase (SELECT-verify +
      backup first). Those keys then re-enter the fast lane. The 2 pack-rounding artifacts stay excluded.
- [ ] **Live verification:** first real app order → confirm the billed SKU matches the app-catalogue intent
      (the rescue sanity-check), with live keywords.

## Commit
`da219238` — feat(mail-orders): Table C exact-name fast-path for app orders (excludes 15 collisions). 5 files, +282/−6.
