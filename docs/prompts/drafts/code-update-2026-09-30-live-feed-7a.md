# Code update — 2026-09-30 — live feed 7a: Floor rows / trips-by-id / counts + head cache (server only)

**Commit:** the single commit on `main` titled *"live feed 7a: floor rows/trips-by-id/counts endpoints + head cache (behind live.feed)"* (`git log --grep "live feed 7a"`).
**Design of record:** `docs/prompts/drafts/code-discovery-2026-09-29-live-change-feed.md` §G.1–§G.3 + owner additions of 2026-09-30.
**No client/UI change. Everything new sits behind `app_settings 'live.feed'` (still OFF → every new endpoint answers `{ enabled: false }`).**
**Housekeeping in the same commit:** CORE v27.46 and the step-4 record marked APPLIED TO LIVE 2026-09-30 ~01:38 IST (69 triggers / 23 tables enabled, 7 functions, index 16 kB, TEST OK 23/0/0).

## What shipped
| File | What |
|---|---|
| `lib/floor/queries.ts` | `getFloorBoard({ …, onlyIds })`, `getFloorHold(scope, hide, onlyIds)`, `getFloorCancelled(scope, hide, onlyIds)` — the SAME query / include tree / enrichment / mapping, restricted to ids; without `onlyIds` the `where` is exactly what it was. New export `floorHoldWhere()` (the hold predicate, now one definition used by the feed and the counts). By-id board skips the dead `waitingSkus`/`oilSkus` reads. |
| `lib/trips/queries.ts` | `getTripsForDate(tripDate, today, onlyIds?)` — same desk rule AND `id IN ids` |
| `lib/floor/rows.ts` (new) | `getFloorRowsByIds(ids)` → `{ date, rows: [{ id, tab, row }], soFlags, tripIds, pickers }` |
| `lib/floor/counts.ts` (new) | `getFloorTabCounts()` → hold + cancelled per scope; `FLOOR_TAB_SCOPES` |
| `app/api/floor/rows/route.ts` (new) | `POST { ids ≤ 300 }` |
| `app/api/floor/counts/route.ts` (new) | `GET [?date=today]` |
| `app/api/floor/trips/route.ts` | `GET ?date=&ids=` branch (+ `gone`); without `ids` unchanged |
| `lib/live/cursor.ts` + `app/api/live/changes/route.ts` | Per-instance safe-head cache (5 s) |
| `lib/live/live.test.ts` | +5 head-cache tests (18 total, all pass) |
| `scripts/parity-floor-rows.ts` (new, inside the tsc gate) | Read-only parity: snapshot / compare-snapshot / parity modes |

## The endpoints
- **`POST /api/floor/rows`** `{ ids }` (≤ 300; floor canView) → `{ enabled, date, rows: [{ id, tab: 'board'|'hold'|'cancelled'|null, row }], soFlags, tripIds, pickers }`. `tab` null = left Floor. Extras and why: `soFlags` (a twin's change flips `hasDuplicateSo` on rows that did not change — apply to every row with that SO); `tripIds` (trips the bills are on now — client adds the ones they were on before); `pickers` (on-hand counts move with assign/done); `date` (board anchor — if it is not the client's day, full load instead of merging).
- **`GET /api/floor/trips?date=&ids=1,2`** (floor canEdit, as the trips list) → `{ enabled, date, trips, gone }`, same builder; `gone` = asked ids no longer on this desk (a cancelled trip of the day is still returned, status `cancelled`, exactly as in the full feed).
- **`GET /api/floor/counts`** (floor canView) → `{ enabled, date, hold: {All, Local, Upcountry, IGT / Cross}, cancelled: {…} }` — BEFORE client search/flag filters. The Floor tab's own badge is not served: it is derived client-side (search, filters, the client-only tint-room split) from rows the client always has.

## The head cache (2 lines)
Each instance remembers the latest safe head it handed out (from a non-full read or a fresh-head answer) for 5 s; a caller whose cursor EQUALS it gets "no changes" with its own cursor and no `live_changes` / meta read. It never moves anyone's cursor, so a change committed in that window is read on the first call after it — up to 5 s later, never skipped (proof + test in `lib/live/cursor.ts`, `live.test.ts`).

## Parity — run 2026-09-30 ~01:45 IST, read-only against production
- **Before/after the refactor** (`snapshot` before any edit, `compare-snapshot` after): board, hold, cancelled, trips — **byte-identical**.
- **Full vs by-id:** board **149/149**, hold **179/179**, cancelled **0/0**, trips **2/2**, counts **4 scopes × 2** — **0 differences**. Plus one off-Floor id probed → `tab null` as required.
- ⚠ **Cancelled was empty** (the IST day had just begun), so the cancelled by-id path is proven only on an empty set. **Re-run `npx tsx scripts/parity-floor-rows.ts` during a working day after a cancel or a floor CI** before 7b relies on it.

## Config measurement (owner addition 3)
- `SELECT "sourceTable", count(*), min("createdAt"), max("createdAt") FROM live_changes WHERE entity='config' GROUP BY 1;` → **no rows**. In fact `live_changes` is **empty** (triggers live since ~01:00–01:38 IST, no business writes overnight, both TEST blocks rolled back). **Re-run it after one working day.**
- **Writers of `delivery_point_master` in code (app/, lib/):** only the admin customer routes — `POST /api/admin/customers` (`route.ts:195`, create), `PATCH /api/admin/customers/[id]` (`:186`), CSV import (`import/route.ts:170,177`, superuser). Callers: `/admin/customers`, `/tint/manager/customers`, `/dispatcher/customers`, and **the Tint Manager board's missing-customer sheet** (`components/shared/customer-missing-sheet.tsx`) — the only operational one. **Nothing in import / enrichment / ship-to save / mail ingest writes it** (they read it). Customer create/edit also backfills `orders."customerId"` (`admin/customers/route.ts:215`, `[id]/route.ts:238`), which the `orders` trigger already records per bill.
- **Recommendation for 7b:** (1) debounce config changes 5 s and allow **at most one config-driven full reload per 2 minutes per tab** (queue the rest; one reload covers them all); (2) no narrower `delivery_point_master` mapping yet — writes are rare admin/tint-manager actions, and the bill-level effect of a create/assign already arrives as `order` lines; a pure rename of an existing customer is the only case that needs the reload. Revisit after a week of the measurement above; if customer writes turn out frequent, move the mapping into the trigger (emit the open orders whose `"customerId"` / `"shipToOverrideCustomerId"` match, using `orders_customerId_idx`).

## For 7b (the client)
- Merge rules: by-id rows are unsorted relative to the page — re-sort board with `FLOOR_SPINE`, hold by `heldSince` desc, cancelled by `at` desc (the full feeds' own sorts) after every patch.
- Apply `soFlags` to every loaded row with that SO; refresh trips = `tripIds` ∪ the patched bills' previous `tripDropId` trips.
- `date` ≠ loaded day → full load. Counts endpoint numbers are pre-filter — show them only while the tab's rows are not loaded.
- Head cache means a poll may see a change up to ~5 s later than it committed; with a 15 s poll that is invisible.
- The trips `?ids=` variant is canEdit like the trips list (a view-only floor user already gets a desk with no trips — FLOOR_TRIPS §10).

## Rollback
Everything is behind `live.feed` (OFF): nothing calls the new routes. Code revert = `git revert` this commit (the full feeds are byte-identical either way, proven above).
