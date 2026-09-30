# Code update — 2026-09-30 — Billing: bounded Pick delete check + popup focus throttle

**Commit:** the single commit on `main` titled *"billing: bounded pick-delete check (1 statement, same answer) + popup focus throttle"* (`git log --grep "bounded pick-delete"`).
**Plan:** `docs/prompts/drafts/code-plan-2026-09-30-billing-live-feed.md` §G steps 1 + 1b, decisions 1–2 (owner approved all 11).
**Scope:** no SQL/DDL, no switch, no feed, no Floor / `lib/live` change, no other Billing tab.

## What changed
| File | Change |
|---|---|
| `lib/billing/pick-delete.ts` | Group discovery is ONE parameterised `$queryRaw` (`openGroupsCte` → `readOpenGroupRows`): the twin rule, "≥ 1 bill before dispatch", minus active All OK, plus an `actionable` EXISTS that is the SQL form of `pickDeleteCheck` (offFloorRefusal + closed + `findLiveCi`, each term cited file:line). `getPickDeleteMarker` = **one statement** (decisions MAX folded in as a scalar sub-select). `getActionableGroups` reads bills and runs `pickDeleteCheck` (the CI read) **only for the shown groups' bills**. The list is unchanged in shape; its group sort gains an SO-number tie-break. Header rewritten (the old "never a scan of the whole table" was false). |
| `lib/billing/pick-delete-rule.ts` (new, pure) + `.test.ts` (4 tests, `npm run test:pick-delete`) | `JS_TRIM_CHARS` — the exact set `String.prototype.trim()` strips, proven against every UTF-16 code unit; passed to `btrim("soNumber", …)` so blank-SO detection equals `nonBlankDistinct`. `markerFromRows`, `compareGroups`. |
| `lib/picking/duplicate-so.ts` | Comments only: the Billing READ no longer comes through this file (one SQL copy, which cites these lines); the writes still do. |
| `lib/hooks/use-picking-marker.ts` | Optional `onResult({count, latest})` after every accepted probe. Additive — every existing caller omits it and is byte-identical. |
| `components/billing/billing-marker-provider.tsx` | The Pick delete provider publishes its last answer (`useBillingPickDeleteMarkerValue` → `{count, latest, at}`). Cadence unchanged (10 s). |
| `components/billing/billing-pick-delete-popup.tsx` | Reads the provider's answer instead of re-fetching the marker on every change; focus check throttled (≥ 10 s since ANY check, looked at 1.5 s after the focus); mount check kept (throttle-subject); import-done and History-Undo checks immediate. |
| `app/api/billing/pick-delete/marker/route.ts` | Comment only. |
| `scripts/parity-pick-delete.ts` + `scripts/parity-pick-delete-legacy.ts` | Read-only parity; the legacy file is the pre-change read path frozen verbatim (48a5e978 lines 24–90, 156–421). |
| `package.json` | `test:pick-delete` |

**Write paths (`markAllOk`, `pickDelete`, `undoDecision`) are untouched** — they never used the discovery; each re-reads the live group through `getTwinIdsBySo` and `pickDeleteRefusal`. The parity run checks their pre-checks against the new list.

## Parity — run 2026-09-30 ~09:30 IST, production, read-only (run twice, after the last code edit too)
10 comparisons, **0 differences**, every one equal on the first try:
1. marker `{count, latest}`; 2. open groups SO → ids; 3. open ids; 4. shown SO list + ids; 5. per-bill `pickDeleteCheck` (canDelete, label, message) of every shown bill; 6. full list payload for 2026-09 — exact, including group order; 7. same, order-insensitive; 8. All OK pre-check (live set = `orderIds`) for the shown group; 9–10. Pick delete pre-check (`pickDelete`'s own read + `pickDeleteRefusal`) for both bills of the shown group vs the list's `canDelete` / `refusal`.
Live state at the run: 6 open groups (13 bills), 1 shown (SO 1046953937, bills 17868/17869). ⚠ Thin coverage of the per-bill path (one group); the `actionable` flag was compared for all 6 groups via the shown-SO list.

## Timings (wall from the dev PC to Supabase, 3 runs each)
| | OLD | NEW |
|---|---|---|
| marker | 1334 / 1316 / 1303 ms (median 1316) | 161 / 140 / 145 ms (median 145) |
| list | 1898 / 1814 / 1966 ms (median 1898) | 1288 / 1296 / 1393 ms (median 1296) |
Marker: ≈ 14 statements → 1; ~3,600 rows shipped → 1 row. Server side (plan §C, EXPLAIN): ~40 ms, one cached pass over `orders` (~700 buffers). The list's remaining time is its lines / catalog / month-decisions reads — unchanged by this step.

## Popup — before / after
| Trigger | Before | After |
|---|---|---|
| Provider change (10 s poll, visible-again) | fetched the marker AGAIN | reads the provider's answer (no fetch); ignored while a decision/confirmation holds the queue; never applied over a newer answer |
| Window focus | fetched the marker every time | fetch only if nothing checked in the last 10 s, looked at 1.5 s after the focus |
| Mount | fetch | fetch (throttle-subject; always fires — nothing has checked yet) |
| Import finished on this screen | fetch at once | unchanged |
| History Undo (`PICK_DELETE_CHECK_EVENT`) | fetch at once | unchanged |

## Checks
`npx tsc --noEmit` clean · `npm run build` exit 0 · unit: load-plan 12, access-notebook 23, live 18, live-client 23, floor-live 13, pick-delete 4 (new), load-plan-check + v2 55 — all pass.

## Behaviour differences (honest list)
1. Two shown groups with the **same** first-punch time now order by SO number; before, by whatever order Postgres returned twins in (unspecified).
2. `getActionableGroups().billsById` holds only the shown groups' bills (nothing read the others).
3. Returning to the tab: one marker call (the provider's) instead of two.

## Rollback
`git revert <hash>` — no schema, no data, no switch involved.
