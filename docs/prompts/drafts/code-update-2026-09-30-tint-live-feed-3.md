# Code update — 2026-09-30 — Tint live feed, Step 3: server narrowing (`?screen=tint`), switch OFF

**Commit:** the single commit on `main` titled *"live feed tint 3: changes?screen=tint (manager board + operator face narrowing, behind live.feed.tint, default off)"* (`git log --grep "live feed tint 3"`).
**Plan:** `docs/prompts/drafts/code-plan-2026-09-30-tint-live-feed.md` §D, §G Step 3. The owner answered "agree all".
**Server only.** No client change, no SQL, and no change to the ledger, the triggers, the Floor / Billing / Picking narrowing or the prune cron.
**Switch:** `app_settings 'live.feed.tint'` AND `'live.feed'` (an absent row = OFF). It stays absent.

## What shipped
| File | Change |
|---|---|
| `lib/live/cursor.ts` | `LIVE_FEED_TINT_KEY = "live.feed.tint"`. `LIVE_SCREENS` gains `"tint"`. `parseFace` accepts `"operator"`. New `faceFitsScreen`: picker ↔ picking, operator ↔ tint. |
| `lib/live/feed.ts` | `isTintFeedOn()`: `'live.feed'` first, then `'live.feed.tint'`, using the same 30 s per-key cache. |
| `lib/tint/live-feed-rule.ts` (new) | The pure rules: `decideTintManager` (keep = on board ∪ held; `missingTouched` = customerMissing now ∪ side-list ids), `decideTintOperator` (his ids ∪ held), the two "today" boundaries, and `operatorSeesAll`. |
| `lib/tint/live-feed.ts` (new) | `classifyTintManager` and `filterTintOperatorOrderIds`. Each is **one** parameterised statement over the changed ids (orders PK + EXISTS on `tint_assignments_orderId_idx` / `order_splits`). |
| `app/api/live/changes/route.ts` | Accepts `?screen=tint`. See the behaviour section below. |
| `lib/tint/live-feed-rule.test.ts` (new, 12 tests) | Covers: tint vs non-tint; the held leaver; a deleted id; `missingTouched` (now / listed / neither); config passing through while "nothing for you" becomes `[]`; operator own vs another operator's job, and held; see-all; screen / face / fit parsing; held/missing validation and cap; the switch key, OFF unless exactly true, global read first; route order (the switch before narrowing); both "today"s. |
| `scripts/parity-tint-classifier.ts` (new) | A read-only replay (below). |
| `package.json` | `test:tint-live` |
| `docs/CLAUDE_CORE.md` | v119. v27.48 is marked **APPLIED TO LIVE 2026-09-30 20:16 IST** (72 → 75 triggers, TEST OK 6/0). The §13 live count is now 75 triggers on 25 tables. Header and footer match. |

## Route behaviour (`GET /api/live/changes?screen=tint…`)
**Gate:**
- the session must be able to view some feed page (`floor | mail_orders | picking | tint_manager | tint_operator`);
- for `screen=tint` it must **also** hold the face's own tick: `tint_manager` for the Manager, `tint_operator` for `face=operator`. Otherwise → 403.

**Validation (all → 400):**
- `face` must be picker or operator;
- `face=operator` only with `screen=tint`, and `picker` only with `picking`;
- `held` / `missing` must be ≤ 100 positive ints;
- `missing` is allowed only with `screen=tint` and no face.

**Switch OFF** → `{ enabled: false }`, exactly as today; nothing else is read.

**Manager (no face):**
- Params: `&held=<ids the board shows ≤ 100>&missing=<ids the side list shows ≤ 100>`, both optional.
- The `order` ids are narrowed to those on the board **now** ∪ `held`. `config` passes through.
- If no tint id and no other entity remains → `changes: []` ("nothing for you"). The cursor still advances.
- `missingTouched` is added to every Manager answer (`false` on reset or a head-cache hit).

**Operator (`face=operator&held=<his ids ≤ 100>`):**
- The `order` ids are narrowed to the **session user's** my-orders set now ∪ `held`. The user is always the session user, never a query param.
- `operations` / `admin` (by primary role, exactly as my-orders decides) get everyone's rows.

**Response:** the same shape as picking (ids only), plus `missingTouched` for the Manager.

## Parity — read-only replay (`npx tsx scripts/parity-tint-classifier.ts`), 2026-09-30 evening
Today's `live_changes` held 2,591 order+config rows (251 distinct order ids). They were replayed in 15 s windows through the **real classifier SQL** with `held = []`, which is the strict case.

| Manager | value |
|---|---|
| 15 s windows with a change | 545 |
| kept (tint id or config) | 172 |
| dropped ("nothing for you") | **373 (68%)** |
| **MISS** — dropped, but a changed id is on the real board | **0** |
| dropped windows touching a tint bill not on the board now (`held` covers a real leaver) | 10 |
| windows with `missingTouched` | 35 |
| classifier statement, median (dev PC incl. ~100 ms round trip) | 155 ms |

| Operator (seen today) | kept | dropped | **MISS** |
|---|---|---|---|
| 22 (25 in my-orders now) | 147 | 398 | **0** |
| 23 (5) | 48 | 497 | **0** |
| 54 (3) | 32 | 513 | **0** |

**PASS — 0 misses.**

What a replay can prove: board membership is evaluated **now**, because history is not stored. It proves the classifier's SQL is a **superset** of both routes' real Prisma predicates (hide rules, the base-operator exclusion and Set B's stage list included) over every id that changed today. Every write to an order, its assignments, splits or challan lands in `live_changes` against that order id, so "the fingerprint moved" means "a changed id is on the board".
- A bill that **left** the board since is covered in production by `held`. The replay cannot reconstruct `held`, so those windows are listed separately (10), not counted as misses.
- The time-true check of the same data is the marker live watch (`scripts/parity-tint-marker.ts`, 0 missed).
- On the dev PC the Manager "today" is IST midnight, and on Vercel it is UTC midnight. The replay used the same function on both sides.

## Differences from the plan / brief (the code wins)
1. **A board predicate that is "tint orders" only would drop leavers.** A bill removed, hidden, or whose bypass is undone is no longer on the board, so classifying on current state alone drops the change that should take it off the screen. Two fixes, both mirroring picking 4a's `held`:
   - the Manager optionally sends `held` (its board ids);
   - it optionally sends `missing` (its side-list ids), because a customer **fix** sets `customerMissing = false`, so "any changed id with customerMissing = true" alone would never refresh the list for it.
   - Without them the Manager still gets every arrival and every change on the board. A leaver would wait for the next other change or the 5-min side-list poll.
2. **The board is not only `orderType = 'tint'`.** Sets C, D and E (active splits, splits done today, assignments done today) have no `orderType` filter. The classifier mirrors that and is deliberately a superset: hide rules, Set B's stage list and the base-operator exclusion are dropped, because they only narrow.
3. **Two different "today"s.** The Manager board and marker use server-local midnight; my-orders uses UTC midnight (`setUTCHours`). The classifier mirrors each exactly (plan decision 8 keeps the fix separate).
4. **The operator's see-all branch.** my-orders drops the assignee filter for `operations` / `admin` by **primary role** (`canSeeAllOperatorRows`, CLAUDE_TINT §13.4). The operator face mirrors it; it is never a tick.
5. **Billing has no narrowing in the changes route** (it classifies in `POST /api/billing/sync`). Only picking narrowed there before this step.
6. **The gate is stricter** than a union: `screen=tint` also re-checks the face's own tick.

## Checks
- `npx tsc --noEmit`: clean.
- `npm run build`: exit 0 (stale `.next` moved to `.next-stale-20260930f-tint`).
- All 16 test files: **207 tests pass** (12 new).

## Rollback
The switch stays absent, so nothing changes for any user. Code: `git revert <hash>`.
