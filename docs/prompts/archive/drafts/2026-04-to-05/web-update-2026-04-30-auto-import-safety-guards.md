# Planning Update — Auto-import gains 3 layered guards against silent line-item drops
Session date: 2026-04-30
Session type: debugging + architecture decision
Target files: app/api/import/obd/route.ts (auto-import handler only)
Implementation status: implemented and deployed to main (commit cc2d378c)

## DECISION SUMMARY
Auto-import path now has 3 independent guards that abort or skip when line-item data is silently lost. Triggered by production failure CHN-2026-00062 where OBD 9106673347 produced summary + order + challan rows but zero `import_raw_line_items` rows, with the API returning `imported=1 skipped=0 errors=0`. Code path looked correct on inspection — root cause likely transient Prisma/pgbouncer issue, unproven. Decision: defence-in-depth at three layers rather than chasing the unrepeatable trigger. Single-guard and two-guard alternatives rejected because the original failure was silent and any one check could itself regress.

## CONTEXT CHANGES
- `app/api/import/obd/route.ts` `handleAutoImport()` now has 3 guards. Manual `handlePreview` / `handleConfirm` flow is untouched — different shape, not affected by this bug class.
- GUARD 1 (write-side): after `import_raw_line_items.createMany`, verifies `result.count === lineItemData.length`. Mismatch → mark batch failed, return HTTP 500, abort. Prevents downstream order/challan creation.
- GUARD 2 (read-side cross-verify): after re-fetching `autoRawSummaries` with `rawLineItems` included, builds `expectedByObd` from in-memory `obdInterims` and compares against actual rows in DB. Catches any future regression that bypasses GUARD 1. Mismatch → batch failed, HTTP 500, abort before `orders.createMany`.
- GUARD 3 (final filter): challan auto-creation filter now requires `o.validLines.length > 0` in addition to challan-eligible SMU. Order is still created; only the challan is suppressed. Final line of defence.
- All three guards log with `[auto-import]` prefix and include `batchId` for cross-reference with `import_batches` table.
- HTTP 500 on guards 1 and 2 is required: `Auto-Import.ps1` keys off HTTP status, not response body, to detect failure.
- Empty `lineItemData` (header-only OBDs / all-duplicates run) is legitimate — guards do not false-positive on it.
- `Auto-Import.ps1` retries naturally next cycle when a batch fails, so abort-on-mismatch does not lose the OBD permanently.

## NEW PENDING ITEMS
- Watch Vercel logs over next 1–2 auto-import cycles for unexpected GUARD trips on healthy data | owner: me | blocker: none
- SKU `5888558` (DP M900 Gloss Enamel Brilliant White 20L) is missing from `sku_master` — confirmed via `enriched_line_items.skuId = null` on the manually inserted CHN-62 line. Add via Shade Master or SKU master | owner: Chandresh | blocker: none
- Document the SKU-master gap as a recurring risk: when SAP ships an OBD with an unknown SKU, the line lands but enrichment is null. Worth a future session to decide whether to surface unknown-SKU warnings somewhere visible | owner: me | blocker: needs design discussion

## SUPERSEDED DECISIONS
None — this is additive defensive code, no prior decisions overridden.

## MOCKUPS / ARTEFACTS PRODUCED
None.

## PROMPTS DRAFTED FOR CLAUDE CODE
The implementation prompt was executed in this session and committed as `cc2d378c`. No further prompts pending from this session.

## CONSOLIDATION NOTES
- CLAUDE_CORE.md §3 (engineering rules) — consider adding a rule: "After bulk Prisma `createMany` writes that the rest of a flow depends on, verify `result.count === input.length`." Currently this is implicit; making it explicit would prevent the same class of bug elsewhere.
- CLAUDE_CORE.md §15 (cross-module pending) — drop the SKU-master-gap pending item if it's deemed not worth a separate session.
- CLAUDE_TINT.md §4.1 (Auto-creation) — update to mention that challan auto-creation now requires `validLines.length > 0`. Currently reads "Created regardless of customer master status" which suggests no gating.
- No CLAUDE_UI.md or CLAUDE_MAIL_ORDERS.md changes needed.

## ONE-OFF MANUAL FIX RECORDED
CHN-2026-00062 was fixed manually via direct SQL (not via any code path). Three INSERT/UPDATE statements were run in Supabase SQL Editor:
- INSERT into `import_raw_line_items` (1 row, rawSummaryId=284)
- UPDATE `import_obd_query_summary` SET totalLines=1, totalUnitQty=5, totalVolume=100 WHERE obdNumber='9106673347'
- INSERT into `import_enriched_line_items` (1 row, skuId=null because SKU not in master)

This was a one-time manual recovery — the new guards prevent recurrence so no backfill endpoint is needed.
