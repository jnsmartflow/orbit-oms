# Code update — 2026-09-30 — Tint Manager quick win: blind 60 s refetch removed, marker widened, missing-customers off the board reload

**Commit:** the single commit on `main` titled *"tint: drop the blind 60 s refetch — widened marker (ta/splits/challans) + missing-customers on a visible-only 5 min poll"* (`git log --grep "blind 60 s refetch"`).
**Plan:** `docs/prompts/drafts/code-plan-2026-09-30-tint-live-feed.md` §C (C1 + C2). The owner answered "agree all" to the 10 decisions. **Decision 7 was NOT done** — see "Stopped" below.
**No DB change, no SQL, no switch, no Operator change, no UTC→IST fix (decision 8 is separate).**

> **History:** The 60 s blind refetch was removed 2026-09-30; the widened marker replaces it. Do not re-add.

## What shipped
| File | Change |
|---|---|
| `components/tint/manager/use-tint-manager-sync.ts` | The 60 s `setInterval` and `SLOW_REFETCH_MS` are deleted. The hook is now only the `usePickingMarker` call (15 s probe, pause/defer, one probe on becoming visible), and that call is unchanged. The doc block records why the blind tick went and why it must not come back. |
| `app/api/tint/manager/marker/route.ts` | **+1 statement:** a parameterised `$queryRaw` `SELECT GREATEST(max(updatedAt) of tint_assignments, order_splits, delivery_challans) AS m`. `latest` becomes the later of the orders max and `m`, with nulls handled (`laterOf`). The response shape `{count, latest}` is identical, so the hook is unchanged. `force-dynamic` stays. |
| `components/tint/manager/use-missing-customers-poll.ts` (new) | `useMissingCustomersPoll(fetch)` fetches once on mount, once each time the tab becomes visible, and every 5 min **only while visible**. The timer and the listener are cleared on unmount and while hidden. |
| `components/tint/tint-manager-content.tsx` | The marker's `onChange` now calls `fetchBoard()` only; it no longer calls missing-customers. The init effect no longer fetches missing-customers either, because the poll hook does it on mount. The page's own writes (assign, bulk assign, remove, add-to-tint…) still refetch missing-customers directly, as before. |
| `components/tint/manager/use-tint-manager-sync.test.ts` (new, 5 tests) | Uses a tiny fake React, a fake `document`, a scripted `fetch` and node:test mock timers. It checks: no `setInterval` / `SLOW_REFETCH_MS` left; one probe per 15 s; **no refetch by time alone**; no probe while hidden; **exactly one probe on becoming visible after 10 min hidden**, then the 15 s cadence; a moved `latest` fires once; pause → fire once on resume; missing-customers on mount / every 5 min visible / not while hidden / once on visible / cleared on unmount / mounted-hidden. |
| `lib/tint/marker-coverage.test.ts` (new, 6 tests) | Static audit. Every `app/api/tint/**/route.ts` (plus the `@/lib/tint/*` modules it imports) that writes a table the board shows must also create/update `orders`, `tint_assignments`, `order_splits` or `delivery_challans`; it fails naming the route. The audit also checks: there are no `$executeRaw` writes (they would be invisible to the scanner); the TI-table exemption still holds; the marker reads all four stamps; the scanner works on a sample. |
| `scripts/parity-tint-marker.ts` (new) | Read-only live watch (below). |
| `package.json` | `test:tint-sync` |

## Stopped — decision 7 not done
The grep for `slotSummary` / `allSlots` was run as plain text across the repo, excluding node_modules/.next/archives:
- **`slotSummary`**: no reader outside the route. Only old docs mention it, and `CLAUDE_TINT` itself says "read by nothing".
- **`allSlots` is NOT unused.** The same route builds `slotNameMap` from it (`orders/route.ts:503`). That map fills the payload field `originalSlotName` on every row (:718, :783, :813, :836). The field is typed in `components/tint/manager/types.ts:47/159/205`. Its only reader is `components/tint/tint-table-view.tsx:419`, the **retired** Kanban table: still compiled, imported by nothing live. **So no live screen displays it today.**
- Dropping `allSlots` therefore also means dropping `originalSlotName` from 4 payload shapes, the types and the retired file's synthetic row. That is a bigger change than decision 7 described. Dropping only `slotSummary` saves **0 statements**, since the `slot_master` query must stay for `slotNameMap`.
- Per the brief ("if ANY … reads it, STOP"), the route was left untouched. **The plan's claim that `allSlots` is unused was wrong — the code wins.**
- Owner's call for later: (a) remove `slotSummary` only (cosmetic, 0 statements); or (b) remove `allSlots` + `slotSummary` + `originalSlotName` everywhere (−1 statement per reload, a type change touching a retired file).

## Load, statements per visible Manager tab per hour (plan §F arithmetic)
Assumptions: marker 3 → 4 statements; board reload ≈ 40; missing-customers ≈ 3; busy hour ≈ 45 change windows (+≈10 child-only changes the old marker never saw); quiet hour ≈ 10.

| | Busy hour | Quiet hour |
|---|---|---|
| Before | 240×3 = 720 · blind 60×43 = 2,580 · change reloads 45×43 = 1,935 → **≈ 5,240** | 720 + 2,580 + 430 → **≈ 3,730** |
| After | 240×4 = 960 · reloads (45+10)×40 = 2,200 · missing 12×3 = 36 → **≈ 3,200 (−39%)** | 960 + 400 + 36 → **≈ 1,400 (−62%)** |

- Freshness: a pause/resume, split start/status/reassign, TI entry or challan save/void now shows within **~15 s** (before: up to 60 s, via the blind tick).
- The widened marker's extra SQL cost is ~0.45 ms plus the challan max (~1 ms); measured during the plan.

## Parity — live watch, read-only
`npx tsx scripts/parity-tint-marker.ts 60 15` ran on 2026-09-30, 16:33–17:25 IST, in working hours. **PASS.**

| measure | value |
|---|---|
| windows (every 15 s) | 240 planned · **238 taken** · 237 compared pairs. 2 windows were skipped (82–83): a pooler connection reset and a pool timeout on the read side — a network blip, not a result |
| windows re-taken (a write landed mid-read) | 1 |
| board fingerprint changes | **24** |
| **MISSED** — fingerprint moved, NEW signature did not | **0** |
| OLD signature missed (the blind 60 s tick's real work) | **4** (child-only writes: count and orders max unchanged) |
| NEW false fires (moved, board did not) | **0** |

The 4 OLD-missed windows are exactly the class the plan named: writes to tint_assignments / order_splits / delivery_challans with no `orders` write. The old board showed them only through the blind tick (≤ 60 s). The widened marker catches them on the next 15 s probe.

## Checks
`npx tsc --noEmit` clean · `npm run build` exit 0 (stale `.next` moved to `.next-stale-20260930d-tint`) · all 15 test files: **195 tests pass** (13 existing + the 2 new, 11 new tests).

## Differences from the plan (the code wins)
1. **`allSlots` is read** (it feeds `originalSlotName`), so decision 7 was not done. See above.
2. **The TI tables are not board tables.** The brief listed `tinter_issue_entries(_b)` among the board tables for the audit. The Manager's board reload never reads them: `orders/route.ts` has no `tinter_issue` reference, and the test asserts that. Their only writers without a stamp are the two TI **edit** routes (`operator/tinter-issue/[id]`, `operator/tinter-issue-b/[id]`), which change nothing the board shows (plan decision 5). They are therefore a named exemption (`NOT_ON_BOARD`), guarded by a test that fails if the board starts reading them. If they were counted as board tables, those two routes would fail the audit — as expected, and by design.
3. **Pre-existing `$transaction`s**, not touched: `challans/[orderId]`, `splits/create`, `splits/cancel`, `splits/reassign`, `cancel-assignment` and `operator/split/done` still use `prisma.$transaction` (a CORE §3 landmine, already noted in `operator/split/done`). The audit scans `tx.` writes too, so they are covered.
4. The file path in the brief, `components/tint/manager/tint-manager-content.tsx`, is actually `components/tint/tint-manager-content.tsx`.

## CLAUDE_TINT §1.9 correction (for the next consolidation — NOT applied now)
> **Live sync (since 2026-09-30).** One mechanism: the 15 s marker probe (`usePickingMarker` → `GET /api/tint/manager/marker`). Hidden = no probe; one probe on becoming visible. Paused while the panel is open or rows are selected, and a change during the pause fires once on resume. **There is no blind refetch.** The 60 s `setInterval` was removed 2026-09-30 — do not re-add it. It was not only a fallback: it was the only thing that showed pause/resume, split start/status/reassign, TI entries and challan saves/voids, none of which write `orders`. The marker's `latest` is now the later of MAX(`orders.updatedAt`) over the board set and MAX(`updatedAt`) of `tint_assignments`, `order_splits` and `delivery_challans` (one extra statement, unfiltered on purpose; a false fire costs one reload). `lib/tint/marker-coverage.test.ts` fails if a tint write route writes a board table without moving one of those four stamps. The missing-customers side list no longer rides on the marker: it is fetched on mount, on becoming visible, every 5 min while visible, and after the page's own writes (`use-missing-customers-poll.ts`). The "union approximation" wording in the marker's comment now covers the child tables too. The UTC-midnight "today" is unchanged (fix marker, orders route and my-orders together — plan decision 8).

## Hand test (Smart Flow)
Open the Tint Manager in two windows (A and B, both visible). In a third window, or on the operator's phone:
1. **Pause** a running job, then **Resume** it → A and B show the paused/resumed state within ~15 s, without touching them.
2. **A split change** (start a split, or change its status) → shows within ~15 s.
3. **Save a challan** (edit a line) or void one → the challan number / void pre-warning updates within ~15 s.
4. Open a row's panel in A and make a change from B → A does not reload under the panel; it reloads once when the panel closes.
5. Leave A hidden for 10 min, then return → one reload at most, straight away.

## Rollback
`git revert <hash>`: the blind tick and the orders-only marker come back. No DB state is involved.
