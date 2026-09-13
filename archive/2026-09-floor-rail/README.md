# The Floor decision rail — retired 2026-09-13

Four components and the server feed behind them. Nothing here is compiled,
imported or reachable.

| File | What it was |
|---|---|
| `floor-rail.tsx` | The 344px left column on `/floor` — header, scroll body, empty states |
| `rail-card.tsx` | One card per undecided bill: OBD, customer, route, litres, ship-to, the tint strip, and Release / Hold / ✕ with a slot picker |
| `rail-empty.tsx` | Its three empty states |
| `tint-strip.tsx` | The violet-to-green tint bar on a tint card: stage phrase, `3 of 5 shades`, progress bar |

Removed with them, from `lib/floor/queries.ts`: `getFloorRail`,
`buildTintState`, and `RAIL_SUGGESTIONS_ENABLED`. From `lib/floor/scope.ts`:
`railInScope`. From `GET /api/floor/board`: the `rail` and `railCount` keys.

## Why

It stopped rendering on **2026-09-10**, when the trip desk replaced the board
(`bbb9628c`). `TripDesk` was never passed a rail prop and no live file imported
any of these four. The commit that retired it said so at the time; what nobody
noticed is that the **server feed kept running**. For three days every board
call built a full rail payload — dealer names, routes, litres, ages, same-SO
flags, tint state and a slot suggestion per card — and threw it away.

Measured on 2026-09-12: **772 ms and 25 of the board call's 84 statements**,
about **28%** of a request, on a page that is latency-bound rather than
query-bound.

Two vestigial readers survived in `floor-page.tsx` and are gone too: a
`case "rail"` in the detail pager, reachable only from a card that no longer
existed, and a duplicate-SO lookup that always missed and fell through to the
board rows.

## 🔴 What did NOT go, and must not

**`floorUnslottedWhere` is still live in `lib/floor/queries.ts`.** It was the
rail's predicate AND it is **arm 2 of `floorBoardWhere`**, and only the first
use went. The bills the rail used to show are rows on the board and have been
since 2026-09-10 — that is exactly what the trip desk's own header says happened
to them.

Removing a fetch is not removing an arm. Anyone tidying away the "unused rail
predicate" next would drop five live bills off the screen. Board, pool and rail
row counts were taken either side of this change and did not move.

## Where the tint strip went

Its job — telling the desk what is happening in the tint room — moved to two
places built from board rows, in the same commit:

- **Three tint pills** on the row itself, `components/floor/status-pill.tsx`:
  `Tint pending`, `Tinting`, `Tint done`. Before this, all three tint stages
  rendered as grey "Waiting", the same pill as a bill waiting for a picker.
- **An "In tinting" line** above the trips on the rail,
  `components/floor/trip-rail.tsx`: count, litres, and "not loadable yet".

Neither needs this feed. Neither shows a "ready by" time, and neither should:
`tint_assignments` has `startedAt` and `completedAt` and no estimate field, and
there is no duration model anywhere in the app.

## Still live elsewhere

`lib/floor/suggest.ts` is left in place, unimported and unchanged. The
slot-suggestion rule it holds is worth keeping if a surface asks the same
question again, and it is pure, so it costs nothing sitting there.
`CLAUDE_FLOOR.md §8` documents that layer as LIVE and is now out of date.

`components/floor/dispatch-slot-picker.tsx` stays where it is — the detail
panel, the Hold tab and the billing ribbon all still use it.

Method: `archive/RETIREMENT-PLAYBOOK.md`. Index: `archive/README.md`.
