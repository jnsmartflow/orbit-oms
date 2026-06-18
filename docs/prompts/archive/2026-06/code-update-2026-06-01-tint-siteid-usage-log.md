# code-update · 2026-06-01 · Tint usage-log siteId bug + fix + backfill

> Draft for consolidation. Target context files: `CLAUDE_SAMPLING_LIBRARY.md` (landmines + Phase 4), `CLAUDE_TINT.md` (landmines), `ROADMAP.md` (split-done gap).
> Intended repo path: `docs/prompts/drafts/code-update-2026-06-01-tint-siteid-usage-log.md`

## The bug

Tint operator **Mark as Done** was writing `sampling_usage_log` rows with `siteId = null`.

- Writer: `app/api/tint/operator/_lib/usage-log-writer.ts`. Its `UsageLogArgs` interface had no `siteId` field, plus an **incorrect comment** claiming `siteId` is not a column on `sampling_usage_log`. The `create()` set `siteNameRaw` but omitted `siteId`, so Prisma inserted null.
- Live since Sampling Library Phase 4 shipped (2026-05-25). Every whole-OBD Mark-Done since then wrote a blank `siteId`.
- The 27 May row that *was* correct came from the old import/repair script, not the live path — which is why the timeline looked inconsistent at first.

## Downstream effect (why it mattered)

The operator **"other shades at this site"** suggestion (`app/api/sampling-library/_lib/suggest.ts`) matches **strictly on `sampling_usage_log.siteId`** (numeric, from `?siteId=`). It deliberately does NOT use the `sampling_register` join. So any usage row with null `siteId` is invisible to same-site suggestions.

Result: a shade tinted yesterday at a site wouldn't surface there today → operators created duplicate sampling numbers. Confirmed real case: `26-0080` created as a duplicate of `26-0046` (same site Regency Tower, same recipe, same SKU/pack).

## The fix (commit `df7e61e9`, pushed to main)

Two files only:

- `app/api/tint/operator/_lib/usage-log-writer.ts`
  - Added `siteId?: number | null` to `UsageLogArgs`; removed the inaccurate comment.
  - On each `create()`, write `siteId` = passed-in value, with sequential-await fallback to `sampling_register.siteId` (by `samplingNo`) when the passed value is null.
- `app/api/tint/operator/done/route.ts`
  - Passes `siteId: order.customerId` into `writeUsageLogsForAssignment({...})`.

Constraints honoured: sequential awaits (no `$transaction`), `force-dynamic` untouched, camelCase, split-done + suggestion query untouched, `tsc --noEmit` clean.

**Verified live:** post-deploy Mark-Done wrote row `16217` (samplingNo `133843`, Shree Aditya Villa) with `siteId = 1618`.

## Key facts confirmed (keep these)

- **`orders.customerId` IS the resolved ship-to site FK** → `delivery_point_master.id`. It is NOT the bill-to dealer. Verified: a Regency Tower order's `customerId` = 2525 = "REGENCY TOWER".
- The suggestion keys on `usage_log.siteId` only → the **write must populate `siteId`**. (`suggest.ts` even documents the null-siteId failure mode.)

## Backfill (2026-06-01)

Recovered the blank live rows. Two methods used; **prefer OBD over name**:

1. **By OBD → order (canonical, accurate):**
   `sampling_usage_log.deliveryNumber = orders.obdNumber → orders.customerId`.
   This is the same source the write fix uses, so it's exact. Recovered 23 rows, including name-mismatch sites the name method missed.
   ```sql
   update sampling_usage_log u
   set "siteId" = o."customerId"
   from orders o
   where u."siteId" is null
     and u."deliveryNumber" = o."obdNumber"
     and o."customerId" is not null;
   ```
2. **By unique site-name match (fragile, used first):** matched `siteNameRaw` to a single `delivery_point_master.customerName`. Fixed 27 rows but **missed** rows where the logged name differs from the master canonical name — e.g. log `Affordeble Housing ( J.P Iscon ) 1` vs master `AFFORDEBLE HOUSING ( J.P ISCON ) 1 FACE`.

**Recovery preference rule:** OBD → order link  >  unique name match  >  leave null.
**Never fuzzy-match site names.** Suffixes like "FACE" / phase numbers distinguish genuinely different sites; stripping them risks linking the wrong site.

Remaining blanks after backfill = legacy historical-import rows with no matching order. Unrecoverable by any safe method, harmless, not from this bug.

## Open gap to park (ROADMAP)

**Split completion does not log sampling usage.** `app/api/tint/operator/split/done/route.ts` never writes a `sampling_usage_log` row — it only updates splits/logs/orders. So split-completed tints never appear in the Sampling Library usage history or same-site suggestions. Pre-existing, separate from the siteId bug. Decide whether splits should log usage.

## Data-quality note

Many legacy usage rows carry site names that don't match `delivery_point_master` canonical names (the ~2,041 unmatched-sites leftover from the Phase 1 import). Future tints are safe (write uses the FK), but these old rows stay blank in same-site suggestions until names are normalised / sites added to master.
