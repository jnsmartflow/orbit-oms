# Code update — 2026-09-30 — live feed billing 2b-i: server side (telephonic bounded, triggers SQL, changes?screen=billing, /api/billing/sync)

**Commit:** the single commit on `main` titled *"live feed billing 2b-i: telephonic bounded, mail_order/so_tag triggers SQL, changes?screen=billing, /api/billing/sync (behind live.feed.billing)"* (`git log --grep "billing 2b-i"`).
**Plan:** `docs/prompts/drafts/code-plan-2026-09-30-billing-live-feed.md` §G steps 2–4, decisions 3, 6, 7 (owner approved all 11). Step 1 (bounded pick-delete) shipped as `29ae80a7`.
**Scope:** server only. No client/UI change (that is 2b-ii). `app_settings 'live.feed.billing'` stays ABSENT (= OFF). Floor untouched and unaffected. Schema **v27.47** (CORE v117), SQL committed, **applied to live: pending**.

## What changed
| File | Change |
|---|---|
| `lib/billing/telephonic.ts` | `getTelephonicMarker` = **one** statement (was 7, including an in-memory `distinct orderId` over every `so_tag_matches` row feeding two `IN (every matched bill ever)` aggregates). Same five fields. `waitingTagWhere` notes its SQL twin. |
| `lib/billing/marker-counts.ts` (new) | `countBillingPending` and `getPrintCount` — lifted VERBATIM out of the Picking / Print marker routes so the sync imports the same functions. |
| `app/api/billing/picking/marker/route.ts`, `print/marker/route.ts` | Call those functions (no logic change). |
| `lib/live/cursor.ts` | `LIVE_TOPICS` + `mail_order`, `so_tag`; `LIVE_FEED_BILLING_KEY = "live.feed.billing"`; `parseScreen`. |
| `lib/live/feed.ts` | Per-key switch cache (30 s each); `isLiveFeedOn()` unchanged; `isBillingFeedOn()` = `live.feed` AND `live.feed.billing` (the global is read first — OFF → the billing key is never read). |
| `app/api/live/changes/route.ts` | `?screen=billing` → enabled = both switches; no `screen` → the global switch alone (unchanged); junk → 400. Page gate: session AND (`floor` canView OR `mail_orders` canView), via `checkAnyPermission`. |
| `lib/billing/sync-rule.ts` (pure, 6 tests) + `lib/billing/sync.ts` + `app/api/billing/sync/route.ts` (new) | `POST /api/billing/sync` — the classifier (below). |
| `sql/2026-09-30-live-changes-billing.sql` + `-TEST.sql` (new) | Widen `chk_live_changes_entity`; 9 triggers on `mo_orders`, `so_tags`, `pick_findings`. |
| `lib/live/live.test.ts` | +4 tests (22 total): Floor's `order,trip,config` unchanged by the new entities; canonical order; numeric ids for the new entities; `parseScreen`. The "no topics → all" default test updated to five. |
| `scripts/parity-billing-sync.ts` (new) | Read-only parity (below). |
| `docs/CLAUDE_CORE.md` | v27.47 chain entry, §13 live-feed landmine lists all 27 triggered tables, change log v117, stamps. |
| `package.json` | `test:billing-sync` |

## pick_findings (decision 3) — TRIGGERED
The only writers are `app/api/picking/findings/confirm` and `report`; both write **only** `pick_findings` (no `orders` write). Confirm's follow-on `reconcileAutoCi` (`lib/ci/auto.ts`) writes only `ci_returns` / `ci_return_lines` (triggered since step 4) and only for an invoiced bill. So a confirmed finding on a pending bill — which removes its Billing Picking checkbox — is invisible to every marker and to the feed today. Triggered as `entity 'order'`, parent `"orderId"`. Side effect: Floor (which asks `order`) will also re-read a bill when its finding changes — correct, and rare.

## POST /api/billing/sync
- **Gates:** session → `mail_orders` canView (403) → `live.feed` AND `live.feed.billing` (`{enabled:false}`, nothing else read) → body (400) → per arm exactly its marker's gate: `billing_picking` / `billing_print` / `billing_telephonic` / `billing_pick_delete` canView. An arm the caller may not see is never read, touched=false, no count.
- **Touched (a superset — a false yes costs one recount):**
  - picking: a changed order now `pick_checked` / `dispatched` / `cancelled`, or `invoicedAt` today (IST), or in `shown.pickingIds`. (Entering / leaving the pending, info and done sets always leaves the bill in one of these states — see `PICKING_TOUCH_STAGES`.)
  - print: a changed trip that is on the tab now OR has a `sent_to_billing` / `taken_back_from_billing` activity row (a take-back clears `sentToBillingAt`, so the current state alone cannot see it leave), or in `shown.printTripIds`. Order changes reach Print as trip ids (the `orders` trigger records the trip of any bill on one).
  - telephonic: `soTagChanged`, or a changed order is in `so_tag_matches`, or in `shown.telephonicOrderIds`.
  - pickDelete: a changed order's SO is carried by ≥ 2 order rows (ANY state — so a group losing a bill still counts), or in `shown.pickDeleteIds`.
  - mailOrders: any `mailOrderIds`.
- **Counts:** only for touched arms, by the SAME function each marker calls: `countBillingPending`, `getPrintCount`, `getTelephonicMarker().count`, `getPickDeleteMarker().count`.
- **Cost:** nothing of Billing's touched → at most 4 small statements (orders by PK · `groupBy soNumber` on `idx_orders_sonumber` · `so_tag_matches` by `orderId` · trips by PK with one EXISTS on `trip_activity`), each only when an arm needs it and there are ids. Touched arms add: picking 2 · print ~5–11 · telephonic 1 · pickDelete 1. Classifier wall from the dev PC: ~400 ms for 92 order + 6 trip ids (4 round trips; lower from bom1).

## Parity — run 2026-09-30 ~10:00 IST, production, read-only (twice; second run after the last code edit)
**7 comparisons, 0 differences**, every one equal on the first try:
1. Telephonic marker OLD (7 statements, frozen verbatim) vs NEW (1): every field. Wall OLD 2214 / 714 / 797 ms (first run 18 s cold) → NEW 140 / 118 / 127 ms.
2. a. Synthetic "everything touched" → all five arms touched, and the four counts = the markers' counts (picking + print = their pre-change route code frozen in the script; telephonic = the frozen old body; pick delete = the frozen pre-`29ae80a7` read path). b. 92 recent order ids + 6 trip ids from today's `live_changes` → touched `{picking, pickDelete}`, their counts = the markers'; plus 40 single-order calls, 23 counts checked individually.
3. An unrelated order (17876: not checked, no shared SO, no tag match) + an unrelated trip (never sent to billing) → nothing touched, no counts; empty batch → nothing; no permission on any arm → nothing even for "everything".

## Smart Flow — run order (after hours)
1. **Pre-check** (top of `sql/2026-09-30-live-changes-billing.sql`, un-comment, run, re-comment) — good: 3 `table` · 3 `key column` (integer) · `entity check` = `CHECK ((entity = ANY (ARRAY['order'::text, 'trip'::text, 'config'::text])))` · 3 `generic function` · **exactly one** `existing trigger` = `mo_orders · trg_mo_orders_updated_at · O` · `live_changes rows` (499 at writing). Read live 2026-09-30: all as expected.
2. **Main** (the whole file) — good: 3 `triggers` rows (`mo_orders`, `pick_findings`, `so_tags`) each `del=O ins=O upd=O` · `entity check` naming all five · `all live_changes triggers` = **81** · `mo_orders stamp trigger` = `trg_mo_orders_updated_at · O`.
3. **TEST** (`sql/2026-09-30-live-changes-billing-TEST.sql`) — good: `ERROR: TEST OK — rolled back (8 checks, 0 tables skipped with no rows, 0 failed)`; NOTICEs show mo_orders (a) 0, (b) 0 with the stamp moved, (c) mail_order line; so_tags (a) 0, (b) 0, (c) so_tag line; pick_findings (a) 0, (c) order line.

## For 2b-ii (the client)
- Ask `GET /api/live/changes?screen=billing&topics=order,trip,config,mail_order,so_tag`.
- **Initial pill counts:** the sync only returns counts for touched arms — at mount / full load read the four markers once (existing routes), then keep them from sync answers.
- **picking and pickDelete will be touched on most busy glances** (any checked bill / any shared-SO change) — both counts are cheap (2 and 1 statements); expect them every 15 s in busy hours, not "rarely".
- `shown` is a belt for rows leaving an OPEN tab; the count rules do not depend on it (pick delete: pass the popup / History group ids when known).
- `mail_order` ids carry no day: refetch the Orders list on any `mail_order` id (plan decision 5), or narrow later with a by-id endpoint.
- `config` stays the client's full-reload signal (tag settings, hide rules, slots).
- The global `live.feed` also gates Billing: turning it OFF turns Billing off too.

## Rollback
Code: `git revert <hash>` (the telephonic / picking / print markers return to their previous bodies; `/api/billing/sync` goes; `changes?screen=` goes). SQL (only if applied): the kill switch / full rollback blocks in `sql/2026-09-30-live-changes-billing.sql`.
